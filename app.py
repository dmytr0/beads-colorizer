import os
import json
import uuid
import queue
import threading
import cv2

from flask import Flask, request, jsonify, send_file, Response, render_template
from processing.detector import upscale, detect_circles
from processing.colorizer import sample_circle_color, cluster_colors
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(BASE_DIR, 'tmp')
os.makedirs(TMP_DIR, exist_ok=True)

app = Flask(__name__)
jobs = {}  # job_id -> {"queue": Queue}


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


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'no file'}), 400
    file = request.files['file']
    threshold = int(request.form.get('threshold', 30))
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5999, debug=True, threaded=True, use_reloader=False)
