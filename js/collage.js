import { loadImage, downloadBlob, showToast } from './utils.js';

function gridLayout(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cells = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const itemsInRow = Math.min(cols, n - idx);
    const w = 1 / itemsInRow;
    for (let c = 0; c < itemsInRow; c++) {
      cells.push({ x: c * w, y: r / rows, w, h: 1 / rows });
      idx++;
    }
  }
  return cells;
}
function rowLayout(n) {
  return Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0, w: 1 / n, h: 1 }));
}
function columnLayout(n) {
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n }));
}
function featuredLayout(n) {
  if (n < 2) return gridLayout(n);
  const rest = n - 1;
  const cells = [{ x: 0, y: 0, w: 0.62, h: 1 }];
  for (let i = 0; i < rest; i++) cells.push({ x: 0.62, y: i / rest, w: 0.38, h: 1 / rest });
  return cells;
}

const LAYOUTS = [
  { id: 'grid', label: 'Cuadrícula', fn: gridLayout, size: [1600, 1600] },
  { id: 'row', label: 'Fila', fn: rowLayout, size: [1600, 900] },
  { id: 'col', label: 'Columna', fn: columnLayout, size: [900, 1600] },
  { id: 'featured', label: 'Destacado', fn: featuredLayout, size: [1600, 1000], minN: 2 },
];

export class Collage {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('collageModal');
    this.canvas = document.getElementById('collageCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.layoutId = 'grid';
    this.gap = 8;
    this.radius = 0;
    this.bg = '#ffffff';
    this.images = [];
    this.assignment = [];
    this.selectedSlot = null;
    this._bindUI();
  }

  async open(items) {
    this.modal.hidden = false;
    document.documentElement.classList.add('modal-open');
    this.canvas.style.opacity = '0.4';
    this.images = await Promise.all(items.map(async (it) => ({ img: await loadImage(it.url), name: it.name })));
    this.canvas.style.opacity = '1';
    this.assignment = this.images.map((_, i) => i);
    this.selectedSlot = null;
    this.layoutId = 'grid';
    this._renderLayoutOptions();
    this._render();
  }

  close() {
    this.modal.hidden = true;
    document.documentElement.classList.remove('modal-open');
  }

  _renderLayoutOptions() {
    const row = document.getElementById('collageLayoutRow');
    row.innerHTML = '';
    LAYOUTS.forEach((l) => {
      if (l.minN && this.images.length < l.minN) return;
      const btn = document.createElement('button');
      btn.className = `chip ${l.id === this.layoutId ? 'active' : ''}`;
      btn.textContent = l.label;
      btn.addEventListener('click', () => {
        this.layoutId = l.id;
        row.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        this._render();
      });
      row.appendChild(btn);
    });
  }

  _currentLayout() {
    return LAYOUTS.find((l) => l.id === this.layoutId) || LAYOUTS[0];
  }

  _cells() {
    return this._currentLayout().fn(this.images.length);
  }

  _render() {
    const layout = this._currentLayout();
    const [W, H] = layout.size;
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, W, H);

    const cells = this._cells();
    cells.forEach((cell, slot) => {
      const entry = this.images[this.assignment[slot]];
      if (!entry) return;
      const x = cell.x * W + this.gap;
      const y = cell.y * H + this.gap;
      const w = cell.w * W - this.gap * 2;
      const h = cell.h * H - this.gap * 2;
      if (w <= 0 || h <= 0) return;

      ctx.save();
      this._roundRectPath(ctx, x, y, w, h, this.radius);
      ctx.clip();
      const img = entry.img;
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw = w / scale, sh = h / scale;
      const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      ctx.restore();

      if (this.selectedSlot === slot) {
        ctx.save();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#5b5fee';
        this._roundRectPath(ctx, x + 3, y + 3, w - 6, h - 6, this.radius);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _slotAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const cells = this._cells();
    return cells.findIndex((c) => fx >= c.x && fx <= c.x + c.w && fy >= c.y && fy <= c.y + c.h);
  }

  _bindUI() {
    document.getElementById('collageClose').addEventListener('click', () => this.close());

    this.canvas.addEventListener('click', (e) => {
      const slot = this._slotAt(e.clientX, e.clientY);
      if (slot === -1) return;
      if (this.selectedSlot === null) {
        this.selectedSlot = slot;
      } else if (this.selectedSlot === slot) {
        this.selectedSlot = null;
      } else {
        [this.assignment[this.selectedSlot], this.assignment[slot]] = [this.assignment[slot], this.assignment[this.selectedSlot]];
        this.selectedSlot = null;
      }
      this._render();
    });

    document.getElementById('collageGap').addEventListener('input', (e) => {
      this.gap = Number(e.target.value);
      document.getElementById('collageGapVal').textContent = `${this.gap}px`;
      this._render();
    });
    document.getElementById('collageRadius').addEventListener('input', (e) => {
      this.radius = Number(e.target.value);
      document.getElementById('collageRadiusVal').textContent = `${this.radius}px`;
      this._render();
    });
    document.getElementById('collageBg').addEventListener('input', (e) => {
      this.bg = e.target.value;
      this._render();
    });

    document.getElementById('collageDownloadBtn').addEventListener('click', () => this._export('download'));
    document.getElementById('collageSaveGalleryBtn').addEventListener('click', () => this._export('gallery'));
  }

  _export(mode) {
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      if (mode === 'download') {
        downloadBlob(blob, 'collage.png');
        showToast('Collage descargado');
      } else {
        this.onSaveToGallery(blob, 'collage.png', 'image');
        showToast('Collage guardado en la galería');
      }
    }, 'image/png');
  }
}
