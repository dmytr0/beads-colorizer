'use strict';

const fileInput = document.getElementById('file-input');
const processBtn = document.getElementById('process-btn');
const downloadBtn = document.getElementById('download-btn');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdValueEl = document.getElementById('threshold-value');
const progressArea = document.getElementById('progress-area');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const legendBar = document.getElementById('legend-bar');
const legendEl = document.getElementById('legend');
const placeholder = document.getElementById('placeholder');
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');

let beadData = null;
let overrides = {};       // {color_number: hex_string} — колір тексту
let displayNumbers = {};  // {color_number: displayed_number} — перестановка номерів
let skipped = new Set();  // set of color_numbers — виключити з нумерації
let sourceImage = null;

function resetState() {
  beadData = null;
  overrides = {};
  displayNumbers = {};
  skipped = new Set();
  sourceImage = null;
}

thresholdSlider.addEventListener('input', () => {
  thresholdValueEl.textContent = thresholdSlider.value;
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    processBtn.disabled = false;
    downloadBtn.disabled = true;
    canvas.hidden = true;
    placeholder.hidden = false;
    legendBar.hidden = true;
    resetState();
  }
});

processBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;

  processBtn.disabled = true;
  downloadBtn.disabled = true;
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
    canvas.width = beadData.image_width;
    canvas.height = beadData.image_height;
    ctx.drawImage(img, 0, 0);
    drawNumbers();
    renderLegend();

    placeholder.hidden = true;
    canvas.hidden = false;
    legendBar.hidden = false;
    progressArea.hidden = true;
    downloadBtn.disabled = false;
    processBtn.disabled = false;
  };
}

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

// Swap displayed numbers between two colors.
// newNum — the number the user typed for colorNumber.
function swapNumbers(colorNumber, newNum) {
  const currentNum = getDisplayNumber(colorNumber);
  if (newNum === currentNum) return;

  // Find which other color currently shows newNum
  const other = beadData.colors.find(c => getDisplayNumber(c.number) === newNum);

  displayNumbers[colorNumber] = newNum;
  if (other) displayNumbers[other.number] = currentNum;

  renderLegend();
  redrawNumbers();
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderLegend() {
  clearChildren(legendEl);
  beadData.colors.forEach(color => {
    const isSkipped = skipped.has(color.number);
    const displayNum = getDisplayNumber(color.number);

    const chip = document.createElement('div');
    const classes = ['color-chip'];
    if (overrides[color.number]) classes.push('overridden');
    if (isSkipped) classes.push('skipped');
    chip.className = classes.join(' ');

    // Colored circle with displayed number
    const circle = document.createElement('div');
    circle.className = 'chip-circle';
    circle.style.background = color.hex;
    circle.style.color = overrides[color.number] || autoContrast(color.hex);
    circle.textContent = String(displayNum);

    // Hex code
    const hexSpan = document.createElement('span');
    hexSpan.className = 'chip-hex';
    hexSpan.textContent = color.hex;

    // Count
    const countSpan = document.createElement('span');
    countSpan.className = 'chip-count';
    countSpan.textContent = 'x' + color.count;

    // Number input — swap on change
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'chip-num-input';
    numInput.value = displayNum;
    numInput.min = 1;
    numInput.addEventListener('change', e => {
      const val = parseInt(e.target.value);
      if (val > 0) swapNumbers(color.number, val);
    });

    // Skip checkbox
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

    // Color picker
    const pickerEl = document.createElement('div');
    if (overrides[color.number]) {
      pickerEl.className = 'color-square';
      pickerEl.style.background = overrides[color.number];
      pickerEl.title = 'Подвійний клік — скинути на авто-контраст';
      pickerEl.addEventListener('click', () => openPicker(color.number, color.hex));
      pickerEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        delete overrides[color.number];
        renderLegend();
        redrawNumbers();
      });
    } else {
      pickerEl.className = 'auto-icon';
      pickerEl.textContent = 'A';
      pickerEl.title = 'Авто-контраст — клік щоб змінити';
      pickerEl.addEventListener('click', () => openPicker(color.number, color.hex));
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
