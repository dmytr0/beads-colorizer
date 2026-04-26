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
    resetState();
  }
});

// ── Process ───────────────────────────────────────────────────────────────────
processBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;

  processBtn.disabled = true;
  downloadBtn.disabled = true;
  legendBtn.disabled = true;
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

  const img = new Image();
  img.src = '/result/' + job_id + '/image';
  img.onload = () => {
    sourceImage = img;
    canvas.width  = beadData.image_width;
    canvas.height = beadData.image_height;
    ctx.drawImage(img, 0, 0);
    drawNumbers();
    renderLegend();

    // Fit image to canvas-area and center it
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
  const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
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

// ── Download Legend ───────────────────────────────────────────────────────────
legendBtn.addEventListener('click', () => {
  const SCALE  = 2;          // retina multiplier
  const PAD    = 16 * SCALE;
  const SQ     = 64 * SCALE; // colored square size
  const GAP    = 12 * SCALE; // gap between rows
  const ROW_H  = SQ + GAP;
  const W      = 280 * SCALE;

  // Sort by displayed number; skipped at the end
  const sorted = [...beadData.colors].sort((a, b) => {
    const da = getDisplayNumber(a.number);
    const db = getDisplayNumber(b.number);
    const sa = skipped.has(a.number) ? 1 : 0;
    const sb = skipped.has(b.number) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return da - db;
  });

  const H = PAD * 2 + sorted.length * ROW_H - GAP;

  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const oc = off.getContext('2d');

  // Background
  oc.fillStyle = '#161b22';
  oc.fillRect(0, 0, W, H);

  sorted.forEach((color, i) => {
    const isSkip = skipped.has(color.number);
    const displayNum = getDisplayNumber(color.number);
    const x = PAD;
    const y = PAD + i * ROW_H;

    // Colored square (rounded)
    const r = 8 * SCALE;
    oc.fillStyle = color.hex;
    oc.beginPath();
    oc.roundRect(x, y, SQ, SQ, r);
    oc.fill();

    // Number on square (skip → no number)
    if (!isSkip) {
      const textColor = overrides[color.number] || autoContrast(color.hex);
      oc.fillStyle = textColor;
      oc.font = `bold ${26 * SCALE}px Arial`;
      oc.textAlign = 'center';
      oc.textBaseline = 'middle';
      oc.fillText(String(displayNum), x + SQ / 2, y + SQ / 2);
    }

    // "— count" text
    oc.fillStyle = '#c9d1d9';
    oc.font = `${15 * SCALE}px Arial`;
    oc.textAlign = 'left';
    oc.textBaseline = 'middle';
    const label = isSkip ? `— ${color.count}` : `— ${color.count}`;
    oc.fillText(label, x + SQ + 14 * SCALE, y + SQ / 2);
  });

  off.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beads-legend.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});
