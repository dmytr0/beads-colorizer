'use strict';

// ── Tooltip system ────────────────────────────────────────────────────────────
const tipEl = document.createElement('div');
tipEl.id = 'tooltip';
tipEl.hidden = true;
document.body.appendChild(tipEl);

let tipTimer   = null;
let tipMouseX  = 0;
let tipMouseY  = 0;

function addTip(el, text) {
  el.addEventListener('mouseenter', e => {
    tipMouseX = e.clientX;
    tipMouseY = e.clientY;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.textContent = text;
      tipEl.hidden = false;
      const x = tipMouseX + 14;
      const y = tipMouseY + 18;
      tipEl.style.left = Math.min(x, window.innerWidth  - tipEl.offsetWidth  - 8) + 'px';
      tipEl.style.top  = Math.min(y, window.innerHeight - tipEl.offsetHeight - 8) + 'px';
    }, 2000);
  });
  el.addEventListener('mousemove', e => {
    tipMouseX = e.clientX;
    tipMouseY = e.clientY;
  });
  el.addEventListener('mouseleave', () => {
    clearTimeout(tipTimer);
    tipEl.hidden = true;
  });
}

// Attach to all elements with data-tip in HTML
document.querySelectorAll('[data-tip]').forEach(el => addTip(el, el.dataset.tip));

const fileInput    = document.getElementById('file-input');
const processBtn   = document.getElementById('process-btn');
const downloadBtn  = document.getElementById('download-btn');
const legendBtn    = document.getElementById('legend-btn');
const saveBtn       = document.getElementById('save-btn');
const saveFeedback  = document.getElementById('save-feedback');
const projectsBtn   = document.getElementById('projects-btn');
const projectsPanel = document.getElementById('projects-panel');
const projectsClose = document.getElementById('projects-close');
const thresholdSlider  = document.getElementById('threshold-slider');
const thresholdValueEl = document.getElementById('threshold-value');
const progressArea = document.getElementById('progress-area');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const legendBar    = document.getElementById('legend-bar');
const legendEl     = document.getElementById('legend');
const placeholder  = document.getElementById('placeholder');
const canvasArea    = document.getElementById('canvas-area');
const canvasWrapper = document.getElementById('canvas-wrapper');
const zoomIndicator = document.getElementById('zoom-indicator');
const canvas = document.getElementById('main-canvas');
const ctx    = canvas.getContext('2d');

let beadData       = null;
let overrides      = {};
let displayNumbers = {};
let skipped        = new Set();
let sourceImage    = null;
let currentSource  = null;  // {type: 'job'|'project', id: string}

let zoom        = 1.0;
let targetZoom  = 1.0;
let panX        = 0;
let panY        = 0;
let zoomPivotX  = 0;
let zoomPivotY  = 0;
let zoomRaf     = null;

function resetState() {
  beadData = null;
  overrides = {};
  displayNumbers = {};
  skipped = new Set();
  sourceImage = null;
  currentSource = null;
  zoom = 1.0;
  targetZoom = 1.0;
  panX = 0;
  panY = 0;
  if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = null; }
}

// ── Threshold slider ──────────────────────────────────────────────────────────
thresholdSlider.addEventListener('input', () => {
  thresholdValueEl.textContent = thresholdSlider.value;
});

// ── File select ───────────────────────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    processBtn.disabled = false;
    downloadBtn.disabled = true;
    legendBtn.disabled = true;
    canvasWrapper.hidden = true;
    zoomIndicator.hidden = true;
    placeholder.hidden = false;
    legendBar.hidden = true;
    saveBtn.disabled = true;
    resetState();
  }
});

// ── Process ───────────────────────────────────────────────────────────────────
processBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;

  processBtn.disabled = true;
  downloadBtn.disabled = true;
  legendBtn.disabled = true;
  saveBtn.disabled = true;
  legendBar.hidden = true;
  progressArea.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Завантаження...';
  resetState();

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('threshold', thresholdSlider.value);

  const res = await fetch('/upload', { method: 'POST', body: formData });
  const { job_id } = await res.json();
  listenProgress(job_id);
});

function listenProgress(job_id) {
  const es = new EventSource('/progress/' + job_id);

  es.onmessage = async (e) => {
    const event = JSON.parse(e.data);
    progressFill.style.width = event.progress + '%';
    progressLabel.textContent = event.label;

    if (event.step === 'done') {
      es.close();
      await loadResult(job_id);
    } else if (event.step === 'error') {
      es.close();
      processBtn.disabled = false;
    }
  };

  es.onerror = () => {
    es.close();
    progressLabel.textContent = 'Помилка з\'єднання';
    processBtn.disabled = false;
  };
}

async function loadResult(job_id) {
  const dataRes = await fetch('/result/' + job_id + '/data');
  beadData = await dataRes.json();
  currentSource = { type: 'job', id: job_id };
  _showCanvas('/result/' + job_id + '/image');
}

function _showCanvas(imageUrl) {
  const img = new Image();
  img.src = imageUrl;
  img.onload = () => {
    sourceImage = img;
    canvas.width  = beadData.image_width;
    canvas.height = beadData.image_height;
    ctx.drawImage(img, 0, 0);
    drawNumbers();
    renderLegend();

    const fitZ = Math.min(
      canvasArea.clientWidth  / beadData.image_width,
      canvasArea.clientHeight / beadData.image_height,
      1
    );
    zoom = fitZ;
    targetZoom = fitZ;
    panX = (canvasArea.clientWidth  - beadData.image_width  * fitZ) / 2;
    panY = (canvasArea.clientHeight - beadData.image_height * fitZ) / 2;
    applyTransform();

    placeholder.hidden = true;
    canvasWrapper.hidden = false;
    zoomIndicator.hidden = false;
    legendBar.hidden = false;
    progressArea.hidden = true;
    downloadBtn.disabled = false;
    legendBtn.disabled = false;
    saveBtn.disabled = false;
    processBtn.disabled = false;
  };
}

// ── Transform ─────────────────────────────────────────────────────────────────
function applyTransform() {
  canvasWrapper.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  zoomIndicator.textContent = Math.round(zoom * 100) + '%';
}

// ── Smooth zoom (RAF lerp, zoom toward cursor) ────────────────────────────────
canvasArea.addEventListener('wheel', e => {
  if (canvasWrapper.hidden) return;
  e.preventDefault();
  const rect = canvasArea.getBoundingClientRect();
  zoomPivotX = e.clientX - rect.left;
  zoomPivotY = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
  targetZoom = Math.max(0.05, Math.min(10, targetZoom * factor));
  if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomTick);
}, { passive: false });

function zoomTick() {
  const diff = targetZoom - zoom;
  if (Math.abs(diff) < zoom * 0.0005) {
    zoom = targetZoom;
    applyTransform();
    zoomRaf = null;
    return;
  }
  // Keep the canvas point under zoomPivot fixed during lerp
  const canvasX = (zoomPivotX - panX) / zoom;
  const canvasY = (zoomPivotY - panY) / zoom;
  zoom += diff * 0.08;
  panX = zoomPivotX - canvasX * zoom;
  panY = zoomPivotY - canvasY * zoom;
  applyTransform();
  zoomRaf = requestAnimationFrame(zoomTick);
}

// ── Pan (drag canvas freely) ──────────────────────────────────────────────────
let isPanning  = false;
let panDragX   = 0;
let panDragY   = 0;

canvasArea.addEventListener('mousedown', e => {
  if (e.button !== 0 || canvasWrapper.hidden) return;
  isPanning = true;
  panDragX = e.clientX - panX;
  panDragY = e.clientY - panY;
  canvasArea.classList.add('is-panning');
  e.preventDefault();
});

window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  panX = e.clientX - panDragX;
  panY = e.clientY - panDragY;
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  canvasArea.classList.remove('is-panning');
});

// ── Canvas rendering ──────────────────────────────────────────────────────────
function autoContrast(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

function getColorHex(colorNumber) {
  const found = beadData.colors.find(c => c.number === colorNumber);
  return found ? found.hex : '#888888';
}

function getDisplayNumber(colorNumber) {
  return displayNumbers[colorNumber] !== undefined ? displayNumbers[colorNumber] : colorNumber;
}

function computeFontSize(radius, text) {
  const maxWidth = radius * 1.6;
  let size = radius * 1.2;
  ctx.font = 'bold ' + size + 'px Arial';
  const w = ctx.measureText(text).width;
  if (w > maxWidth) size = size * (maxWidth / w);
  return Math.max(size, 6);
}

function drawNumbers() {
  if (!beadData) return;
  beadData.circles.forEach(circle => {
    if (skipped.has(circle.color_number)) return;
    const hex = getColorHex(circle.color_number);
    const textColor = overrides[circle.color_number] || autoContrast(hex);
    const text = String(getDisplayNumber(circle.color_number));
    const size = computeFontSize(circle.radius, text);
    ctx.font = 'bold ' + size + 'px Arial';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, circle.x, circle.y);
  });
}

function redrawNumbers() {
  if (!beadData || !sourceImage) return;
  ctx.drawImage(sourceImage, 0, 0);
  drawNumbers();
  if (currentSource?.type === 'project') scheduleAutoSave();
}

// ── Number swap ───────────────────────────────────────────────────────────────
function swapNumbers(colorNumber, newNum) {
  const currentNum = getDisplayNumber(colorNumber);
  if (newNum === currentNum) return;
  const other = beadData.colors.find(c => getDisplayNumber(c.number) === newNum);
  displayNumbers[colorNumber] = newNum;
  if (other) displayNumbers[other.number] = currentNum;
  renderLegend();
  redrawNumbers();
}

// ── Legend ────────────────────────────────────────────────────────────────────
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderLegend() {
  clearChildren(legendEl);
  beadData.colors.forEach(color => {
    const isSkipped  = skipped.has(color.number);
    const displayNum = getDisplayNumber(color.number);

    const chip = document.createElement('div');
    const classes = ['color-chip'];
    if (overrides[color.number]) classes.push('overridden');
    if (isSkipped) classes.push('skipped');
    chip.className = classes.join(' ');

    const circle = document.createElement('div');
    circle.className = 'chip-circle';
    circle.style.background = color.hex;
    circle.style.color = overrides[color.number] || autoContrast(color.hex);
    circle.textContent = String(displayNum);
    addTip(circle, `Зразок кольору ${color.hex}\nПоточний номер: ${displayNum}`);

    const hexSpan = document.createElement('span');
    hexSpan.className = 'chip-hex';
    hexSpan.textContent = color.hex;
    addTip(hexSpan, `HEX-код розпізнаного кольору.\nКлікніть на поле номера щоб змінити прив'язку.`);

    const countSpan = document.createElement('span');
    countSpan.className = 'chip-count';
    countSpan.textContent = 'x' + color.count;
    addTip(countSpan, `На схемі ${color.count} кружечків цього кольору.`);

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'chip-num-input';
    numInput.value = displayNum;
    numInput.min = 1;
    numInput.addEventListener('change', e => {
      const val = parseInt(e.target.value);
      if (val > 0) swapNumbers(color.number, val);
    });
    addTip(numInput, 'Введіть новий номер і натисніть Enter.\nЯкщо такий номер вже є — кольори поміняються місцями (swap).');

    const skipLabel = document.createElement('label');
    skipLabel.className = 'chip-skip';
    const skipCheck = document.createElement('input');
    skipCheck.type = 'checkbox';
    skipCheck.checked = isSkipped;
    skipCheck.addEventListener('change', () => {
      if (skipCheck.checked) skipped.add(color.number);
      else skipped.delete(color.number);
      renderLegend();
      redrawNumbers();
    });
    skipLabel.append(skipCheck, document.createTextNode('skip'));
    addTip(skipLabel, 'Виключити цей колір з нумерації.\nКружечки залишаться без цифр.\nУ легенді-файлі буде показано тільки кількість.');

    const pickerEl = document.createElement('div');
    if (overrides[color.number]) {
      pickerEl.className = 'color-square';
      pickerEl.style.background = overrides[color.number];
      pickerEl.addEventListener('click', () => openPicker(color.number, color.hex));
      pickerEl.addEventListener('dblclick', e => {
        e.stopPropagation();
        delete overrides[color.number];
        renderLegend();
        redrawNumbers();
      });
      addTip(pickerEl, 'Власний колір цифр.\nКлік — змінити колір.\nПодвійний клік — скинути на авто-контраст (WCAG).');
    } else {
      pickerEl.className = 'auto-icon';
      pickerEl.textContent = 'A';
      pickerEl.addEventListener('click', () => openPicker(color.number, color.hex));
      addTip(pickerEl, 'Авто-контрастний колір цифр за формулою WCAG.\nЧорний на світлих, білий на темних фонах.\nКлік — вибрати власний колір.');
    }

    chip.append(circle, hexSpan, countSpan, numInput, skipLabel, pickerEl);
    legendEl.appendChild(chip);
  });
}

function openPicker(colorNumber, bgHex) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = overrides[colorNumber] || autoContrast(bgHex);
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(input);
  input.addEventListener('input', e => {
    overrides[colorNumber] = e.target.value;
    renderLegend();
    redrawNumbers();
  });
  input.addEventListener('change', () => {
    if (document.body.contains(input)) document.body.removeChild(input);
  });
  input.click();
}

// ── Download PNG ──────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beads-numbered.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

// ── Legend canvas builder ─────────────────────────────────────────────────────
function buildLegendCanvas() {
  const SCALE = 2;
  const PAD   = 16 * SCALE;
  const SQ    = 64 * SCALE;
  const GAP   = 12 * SCALE;
  const ROW_H = SQ + GAP;
  const W     = 280 * SCALE;

  const sorted = [...beadData.colors].sort((a, b) => {
    const sa = skipped.has(a.number) ? 1 : 0;
    const sb = skipped.has(b.number) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return getDisplayNumber(a.number) - getDisplayNumber(b.number);
  });

  const H = PAD * 2 + sorted.length * ROW_H - GAP;
  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const oc = off.getContext('2d');

  oc.fillStyle = '#161b22';
  oc.fillRect(0, 0, W, H);

  sorted.forEach((color, i) => {
    const isSkip     = skipped.has(color.number);
    const displayNum = getDisplayNumber(color.number);
    const x = PAD;
    const y = PAD + i * ROW_H;

    oc.fillStyle = color.hex;
    oc.beginPath();
    oc.roundRect(x, y, SQ, SQ, 8 * SCALE);
    oc.fill();

    if (!isSkip) {
      oc.fillStyle = overrides[color.number] || autoContrast(color.hex);
      oc.font = `bold ${26 * SCALE}px Arial`;
      oc.textAlign = 'center';
      oc.textBaseline = 'middle';
      oc.fillText(String(displayNum), x + SQ / 2, y + SQ / 2);
    }

    oc.fillStyle = '#c9d1d9';
    oc.font = `${15 * SCALE}px Arial`;
    oc.textAlign = 'left';
    oc.textBaseline = 'middle';
    oc.fillText(`— ${color.count}`, x + SQ + 14 * SCALE, y + SQ / 2);
  });

  return off;
}

// ── Legend modal ──────────────────────────────────────────────────────────────
const legendModal       = document.getElementById('legend-modal');
const legendModalOverlay = document.getElementById('legend-modal-overlay');
const legendModalClose  = document.getElementById('legend-modal-close');
const legendModalImg    = document.getElementById('legend-modal-img');
const legendDownloadBtn = document.getElementById('legend-download-btn');

legendBtn.addEventListener('click', () => {
  legendModalImg.src = buildLegendCanvas().toDataURL('image/png');
  legendModal.hidden = false;
});
legendModalOverlay.addEventListener('click', () => { legendModal.hidden = true; });
legendModalClose.addEventListener('click',   () => { legendModal.hidden = true; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { legendModal.hidden = true; closeProjectsPanel(); }
});

legendDownloadBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = legendModalImg.src;
  a.download = 'beads-legend.png';
  a.click();
});

// ── Auto-save for loaded projects ─────────────────────────────────────────────
let autoSaveTimer = null;

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  _setFeedback('• Зберігається...', '#8b949e', false);
  autoSaveTimer = setTimeout(() => doUpdateProject(true), 2000);
}

function _setFeedback(text, color, hidden) {
  saveFeedback.textContent = text;
  saveFeedback.style.color = color || '#3fb950';
  saveFeedback.hidden = hidden;
}

function _buildSavePayload() {
  return {
    threshold:       parseInt(thresholdSlider.value),
    overrides:       overrides,
    display_numbers: displayNumbers,
    skipped:         [...skipped],
    legend_b64:      buildLegendCanvas().toDataURL('image/png').split(',')[1],
  };
}

async function doUpdateProject(silent = false) {
  if (!currentSource || currentSource.type !== 'project') return;
  try {
    await fetch(`/project/${currentSource.id}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(_buildSavePayload()),
    });
    if (!silent) {
      _setFeedback('✓ Проєкт оновлено', '#3fb950', false);
      loadProjectsList();
    } else {
      _setFeedback('✓ Автозбережено', '#484f58', false);
      setTimeout(() => { saveFeedback.hidden = true; }, 2500);
    }
  } catch {
    _setFeedback('✗ Помилка оновлення', '#f78166', false);
  }
}

let _conflictProjectId = null;  // set when 409 duplicate detected

async function doSaveNew(ignoreHash = false) {
  if (!beadData || !currentSource) return;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Зберігаємо...';
  saveFeedback.hidden = true;

  const payload = Object.assign(_buildSavePayload(), {
    source_type:  currentSource.type,
    source_id:    currentSource.id,
    bead_data:    beadData,
    ignore_hash:  ignoreHash,
  });

  const res  = await fetch('/project', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();

  saveBtn.textContent = 'Зберегти проєкт';
  saveBtn.disabled = false;

  if (res.status === 409 && data.conflict) {
    // Duplicate detected — show confirm with project name
    _conflictProjectId = data.project_id;
    saveConfirmMsg.textContent = `Картинка вже збережена як «${data.name}». Що зробити?`;
    saveConfirm.hidden = false;
    saveBtn.hidden = true;
    return;
  }

  if (!res.ok) {
    _setFeedback('✗ Помилка збереження', '#f78166', false);
    return;
  }

  currentSource = { type: 'project', id: data.project_id };
  _conflictProjectId = null;
  _setFeedback(`✓ Збережено: ${data.name}`, '#3fb950', false);
  loadProjectsList();
}

// ── Save project button + confirm ─────────────────────────────────────────────
const saveConfirm    = document.getElementById('save-confirm');
const saveConfirmMsg = document.getElementById('save-confirm-msg');
const saveUpdateBtn  = document.getElementById('save-update-btn');
const saveNewBtn     = document.getElementById('save-new-btn');
const saveCancelBtn  = document.getElementById('save-cancel-btn');

function _hideConfirm() {
  saveConfirm.hidden = true;
  saveBtn.hidden = false;
  _conflictProjectId = null;
}

saveBtn.addEventListener('click', () => {
  if (!beadData || !currentSource) return;
  if (currentSource.type === 'project') {
    // Already a saved project
    saveConfirmMsg.textContent = 'Цей проєкт вже збережений. Що зробити?';
    saveConfirm.hidden = false;
    saveBtn.hidden = true;
    saveFeedback.hidden = true;
  } else {
    doSaveNew(false);
  }
});

saveUpdateBtn.addEventListener('click', () => {
  const targetId = _conflictProjectId || (currentSource?.type === 'project' ? currentSource.id : null);
  _hideConfirm();
  if (targetId) {
    currentSource = { type: 'project', id: targetId };
    doUpdateProject(false).then(() => {
      // If we updated a different project, keep the new currentSource
    });
  }
});

saveNewBtn.addEventListener('click', () => {
  _hideConfirm();
  doSaveNew(true);  // ignore_hash = true
});

saveCancelBtn.addEventListener('click', _hideConfirm);

// ── Projects sidebar ──────────────────────────────────────────────────────────
const projectsList = document.getElementById('projects-list');

function openProjectsPanel() {
  saveConfirm.hidden = true;
  saveBtn.hidden = false;
  projectsPanel.classList.add('open');
  loadProjectsList();
}
function closeProjectsPanel() {
  projectsPanel.classList.remove('open');
}

projectsBtn.addEventListener('click', () => {
  projectsPanel.classList.contains('open') ? closeProjectsPanel() : openProjectsPanel();
});
projectsClose.addEventListener('click', closeProjectsPanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProjectsPanel(); });

async function loadProjectsList() {
  clearChildren(projectsList);
  projectsList.textContent = '';

  const res      = await fetch('/projects');
  const projects = await res.json();

  if (!projects.length) return;  // empty state via CSS :empty

  projects.forEach(p => {
    const now        = new Date();
    const expires    = new Date(p.expires_at);
    const daysLeft   = Math.ceil((expires - now) / 86400000);
    const colorsMeta = `${p.color_count} кол. · ${p.circle_count} кружечків`;
    const created    = new Date(p.created_at).toLocaleString('uk-UA', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});

    const card = document.createElement('div');
    card.className = 'project-card';

    // Thumbnail
    const thumb = document.createElement(p.has_thumb ? 'img' : 'div');
    if (p.has_thumb) {
      thumb.className = 'project-thumb';
      thumb.src = `/project/${p.id}/thumb`;
      thumb.alt = p.name;
    } else {
      thumb.className = 'project-thumb-placeholder';
      thumb.textContent = '🧵';
    }

    // Info
    const info = document.createElement('div');
    info.className = 'project-info';

    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = p.name;

    const meta = document.createElement('div');
    meta.className = 'project-meta';
    meta.textContent = `${colorsMeta} · ${created}`;

    const exp = document.createElement('div');
    exp.className = 'project-expires ' + (daysLeft <= 5 ? 'soon' : 'ok');
    exp.textContent = daysLeft <= 5
      ? `⚠ Залишилось ${daysLeft} дн.`
      : `Зберігається до ${expires.toLocaleDateString('uk-UA')}`;

    info.append(name, meta, exp);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'project-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary';
    openBtn.textContent = 'Відкрити';
    openBtn.addEventListener('click', () => { closeProjectsPanel(); openProject(p.id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async () => {
      await fetch(`/project/${p.id}`, { method: 'DELETE' });
      card.remove();
    });

    actions.append(openBtn, delBtn);
    card.append(thumb, info, actions);
    projectsList.appendChild(card);
  });
}

async function openProject(project_id) {
  resetState();

  saveBtn.disabled = true;
  downloadBtn.disabled = true;
  legendBtn.disabled = true;
  canvasWrapper.hidden = true;
  legendBar.hidden = true;
  progressArea.hidden = false;
  progressFill.style.width = '80%';
  progressLabel.textContent = 'Завантаження проєкту...';

  const res   = await fetch(`/project/${project_id}`);
  const state = await res.json();

  // Restore settings
  beadData        = state.bead_data;
  overrides       = _intKeys(state.overrides       || {});
  displayNumbers  = _intKeys(state.display_numbers || {});
  skipped         = new Set((state.skipped || []).map(Number));
  currentSource   = { type: 'project', id: project_id };

  thresholdSlider.value    = state.threshold ?? 12;
  thresholdValueEl.textContent = thresholdSlider.value;

  progressFill.style.width = '100%';
  progressArea.hidden = true;

  _showCanvas(`/project/${project_id}/image`);
}

// JSON keys are always strings; convert back to numbers for overrides/displayNumbers
function _intKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[parseInt(k)] = v;
  return out;
}
