import os
import base64
import json
import uuid
import queue
import shutil
import threading
import cv2
from datetime import datetime, timedelta, timezone

from flask import Flask, request, jsonify, send_file, Response, render_template
from processing.detector import upscale, detect_circles
from processing.colorizer import sample_circle_color, cluster_colors
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(BASE_DIR, 'tmp')
PROJECTS_DIR = os.path.join(BASE_DIR, 'projects')
os.makedirs(TMP_DIR, exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)

app = Flask(__name__)
jobs = {}  # job_id -> {"queue": Queue}

PROJECT_TTL_DAYS = 30


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cleanup_expired_projects():
    now = _now_utc()
    for pid in os.listdir(PROJECTS_DIR):
        state_path = os.path.join(PROJECTS_DIR, pid, 'state.json')
        if not os.path.exists(state_path):
            continue
        try:
            with open(state_path) as f:
                state = json.load(f)
            expires = datetime.fromisoformat(state['expires_at'])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if now > expires:
                shutil.rmtree(os.path.join(PROJECTS_DIR, pid), ignore_errors=True)
        except Exception:
            pass


def _make_thumbnail(src_path: str, dst_path: str):
    img = Image.open(src_path)
    img.thumbnail((280, 400))
    img.save(dst_path, 'JPEG', quality=75)


# ── Image processing pipeline ─────────────────────────────────────────────────

def process_image(job_id: str, image_path: str, threshold: int):
    q = jobs[job_id]['queue']
    try:
        q.put({'step': 'upscaling', 'label': 'Збільшення зображення', 'progress': 10})
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError('Не вдалося відкрити зображення')
        image = upscale(image)

        q.put({'step': 'detecting', 'label': 'Детекція кружечків', 'progress': 35})
        circles = detect_circles(image)
        if not circles:
            raise ValueError('Кружечки не знайдено. Спробуйте інше зображення.')

        q.put({'step': 'clustering', 'label': 'Кластеризація кольорів', 'progress': 65})
        colors_rgb = [sample_circle_color(image, x, y, r) for x, y, r in circles]
        assignments, clusters = cluster_colors(colors_rgb, threshold)

        q.put({'step': 'rendering', 'label': 'Підготовка результату', 'progress': 90})

        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        Image.fromarray(img_rgb).save(os.path.join(TMP_DIR, job_id, 'image.png'))

        circle_data = [
            {'x': x, 'y': y, 'radius': r, 'color_number': assignments[i]}
            for i, (x, y, r) in enumerate(circles)
        ]
        color_data = [
            {'number': c['number'], 'hex': c['hex'], 'count': len(c['indices'])}
            for c in clusters
        ]
        result = {
            'image_width': image.shape[1],
            'image_height': image.shape[0],
            'circles': circle_data,
            'colors': color_data,
        }
        with open(os.path.join(TMP_DIR, job_id, 'data.json'), 'w') as f:
            json.dump(result, f)

        q.put({'step': 'done', 'label': 'Готово', 'progress': 100})

    except Exception as e:
        q.put({'step': 'error', 'label': f'Помилка: {e}', 'progress': 0})


# ── Main routes ───────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'no file'}), 400
    file = request.files['file']
    threshold = int(request.form.get('threshold', 12))
    job_id = uuid.uuid4().hex[:8]
    job_dir = os.path.join(TMP_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    ext = os.path.splitext(file.filename)[1] or '.jpg'
    image_path = os.path.join(job_dir, 'original' + ext)
    file.save(image_path)
    jobs[job_id] = {'queue': queue.Queue()}
    t = threading.Thread(
        target=process_image, args=(job_id, image_path, threshold), daemon=True
    )
    t.start()
    return jsonify({'job_id': job_id})


@app.route('/progress/<job_id>')
def progress(job_id):
    if job_id not in jobs:
        return jsonify({'error': 'unknown job'}), 404

    def generate():
        q = jobs[job_id]['queue']
        while True:
            event = q.get()
            yield f'data: {json.dumps(event)}\n\n'
            if event['step'] in ('done', 'error'):
                break

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/result/<job_id>/image')
def result_image(job_id):
    path = os.path.join(TMP_DIR, job_id, 'image.png')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='image/png')


@app.route('/result/<job_id>/data')
def result_data(job_id):
    path = os.path.join(TMP_DIR, job_id, 'data.json')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='application/json')


# ── Project routes ────────────────────────────────────────────────────────────

@app.route('/project', methods=['POST'])
def save_project():
    _cleanup_expired_projects()
    data = request.get_json()

    source_type = data.get('source_type', 'job')   # 'job' | 'project'
    source_id   = data.get('source_id', '')

    project_id  = uuid.uuid4().hex[:8]
    project_dir = os.path.join(PROJECTS_DIR, project_id)
    os.makedirs(project_dir)

    now  = _now_utc()
    name = data.get('name') or now.strftime('%d.%m.%Y %H:%M')

    state = {
        'id':             project_id,
        'name':           name,
        'created_at':     now.isoformat(),
        'expires_at':     (now + timedelta(days=PROJECT_TTL_DAYS)).isoformat(),
        'threshold':      data.get('threshold', 12),
        'overrides':      data.get('overrides', {}),
        'display_numbers': data.get('display_numbers', {}),
        'skipped':        data.get('skipped', []),
        'bead_data':      data['bead_data'],
    }

    with open(os.path.join(project_dir, 'state.json'), 'w') as f:
        json.dump(state, f)

    # Locate source image
    if source_type == 'job':
        src_image = os.path.join(TMP_DIR, source_id, 'image.png')
    else:
        src_image = os.path.join(PROJECTS_DIR, source_id, 'image.png')

    if os.path.exists(src_image):
        shutil.copy2(src_image, os.path.join(project_dir, 'image.png'))
        try:
            _make_thumbnail(src_image, os.path.join(project_dir, 'thumb.jpg'))
        except Exception:
            pass

    # Save legend PNG from base64 if provided
    legend_b64 = data.get('legend_b64')
    if legend_b64:
        try:
            legend_bytes = base64.b64decode(legend_b64)
            with open(os.path.join(project_dir, 'legend.png'), 'wb') as f:
                f.write(legend_bytes)
        except Exception:
            pass

    return jsonify({'project_id': project_id, 'name': name})


@app.route('/projects')
def list_projects():
    _cleanup_expired_projects()
    projects = []
    for pid in os.listdir(PROJECTS_DIR):
        state_path = os.path.join(PROJECTS_DIR, pid, 'state.json')
        if not os.path.exists(state_path):
            continue
        try:
            with open(state_path) as f:
                state = json.load(f)
            colors = state.get('bead_data', {}).get('colors', [])
            circles = state.get('bead_data', {}).get('circles', [])
            projects.append({
                'id':         state['id'],
                'name':       state['name'],
                'created_at': state['created_at'],
                'expires_at': state['expires_at'],
                'color_count':  len(colors),
                'circle_count': len(circles),
                'has_thumb': os.path.exists(os.path.join(PROJECTS_DIR, pid, 'thumb.jpg')),
            })
        except Exception:
            pass

    projects.sort(key=lambda p: p['created_at'], reverse=True)
    return jsonify(projects)


@app.route('/project/<project_id>')
def load_project(project_id):
    state_path = os.path.join(PROJECTS_DIR, project_id, 'state.json')
    if not os.path.exists(state_path):
        return jsonify({'error': 'not found'}), 404
    with open(state_path) as f:
        state = json.load(f)
    return jsonify(state)


@app.route('/project/<project_id>/image')
def project_image(project_id):
    path = os.path.join(PROJECTS_DIR, project_id, 'image.png')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='image/png')


@app.route('/project/<project_id>/legend')
def project_legend(project_id):
    path = os.path.join(PROJECTS_DIR, project_id, 'legend.png')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='image/png')


@app.route('/project/<project_id>/thumb')
def project_thumb(project_id):
    path = os.path.join(PROJECTS_DIR, project_id, 'thumb.jpg')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='image/jpeg')


@app.route('/project/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    project_dir = os.path.join(PROJECTS_DIR, project_id)
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir)
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5999, debug=True, threaded=True, use_reloader=False)
