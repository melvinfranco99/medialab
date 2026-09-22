import { uid, loadImage, downloadBlob, showToast, clamp } from './utils.js';

const CANVAS_SIZES = {
  square: { w: 1200, h: 1200 },
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};

const STAGE_HEIGHT_RATIO = () => (window.innerWidth <= 640 ? 0.34 : window.innerWidth <= 860 ? 0.4 : 0.55);

/** Free-form photo compositor: drag, resize, rotate and reorder photos on a canvas. */
export class Collage {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('collageModal');
    this.stageWrap = document.getElementById('collageStageWrap');
    this.viewport = document.getElementById('fcViewport');
    this.canvasEl = document.getElementById('fcCanvas');
    this.layerPanel = document.getElementById('fcLayerPanel');

    this.sizeId = 'square';
    this.radius = 0;
    this.bg = '#ffffff';
    this.layers = []; // z-order: index 0 = bottom
    this.selectedId = null;
    this.displayScale = 1;

    this._onResize = () => this._layoutViewport();
    this._bindUI();
  }

  async open(items) {
    this.modal.hidden = true; // laid out while hidden would measure 0 — show after building
    document.documentElement.classList.add('modal-open');
    const loaded = await Promise.all(items.map(async (it) => ({ img: await loadImage(it.url), name: it.name })));

    this.sizeId = 'square';
    this._syncSizeChips();
    this.selectedId = null;
    this.layerPanel.hidden = true;
    this.radius = 0;
    document.getElementById('collageRadius').value = 0;
    document.getElementById('collageRadiusVal').textContent = '0px';
    this.bg = '#ffffff';
    document.getElementById('collageBg').value = '#ffffff';

    const { w: cw, h: ch } = CANVAS_SIZES[this.sizeId];
    const cols = Math.ceil(Math.sqrt(loaded.length));
    const rows = Math.ceil(loaded.length / cols);
    const cellW = cw / cols, cellH = ch / rows;
    const boxSize = Math.min(cellW, cellH) * 0.86;

    this.layers = loaded.map((entry, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const ratio = entry.img.naturalWidth / entry.img.naturalHeight;
      let w = boxSize, h = boxSize / ratio;
      if (h > boxSize) { h = boxSize; w = boxSize * ratio; }
      const cx = cellW * col + cellW / 2;
      const cy = cellH * row + cellH / 2;
      return {
        id: uid(), img: entry.img, name: entry.name,
        x: cx - w / 2, y: cy - h / 2, w, h, rot: 0,
      };
    });

    this.modal.hidden = false;
    this._layoutViewport();
    window.addEventListener('resize', this._onResize);
    this._renderLayers();
  }

  close() {
    this.modal.hidden = true;
    document.documentElement.classList.remove('modal-open');
    window.removeEventListener('resize', this._onResize);
  }

  _syncSizeChips() {
    document.querySelectorAll('#collageSizeRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.size === this.sizeId));
  }

  _layoutViewport() {
    const { w: cw, h: ch } = CANVAS_SIZES[this.sizeId];
    const maxW = this.stageWrap.clientWidth || 320;
    const maxH = window.innerHeight * STAGE_HEIGHT_RATIO();
    const scale = Math.min(maxW / cw, maxH / ch, 1);
    this.displayScale = scale;
    this.viewport.style.width = `${cw * scale}px`;
    this.viewport.style.height = `${ch * scale}px`;
    this.viewport.style.background = this.bg;
    this.canvasEl.style.width = `${cw}px`;
    this.canvasEl.style.height = `${ch}px`;
    this.canvasEl.style.transform = `scale(${scale})`;
  }

  _renderLayers() {
    this.canvasEl.innerHTML = '';
    this.layers.forEach((layer, index) => {
      const el = document.createElement('div');
      el.className = `fc-layer ${layer.id === this.selectedId ? 'selected' : ''}`;
      el.dataset.layerId = layer.id;
      el.style.left = `${layer.x}px`;
      el.style.top = `${layer.y}px`;
      el.style.width = `${layer.w}px`;
      el.style.height = `${layer.h}px`;
      el.style.transform = `rotate(${layer.rot}deg)`;
      el.style.zIndex = String(index + 1);

      // The image clip (rounded corners) lives on an inner wrapper, not on .fc-layer
      // itself — the rotate handle sits above the layer's own box (top:-28px), and an
      // overflow:hidden on .fc-layer would clip it away, making it unclickable.
      const imgWrap = document.createElement('div');
      imgWrap.className = 'fc-layer-imgwrap';
      imgWrap.style.borderRadius = `${Math.min(this.radius, layer.w / 2, layer.h / 2)}px`;
      const img = document.createElement('img');
      img.src = layer.img.src;
      imgWrap.appendChild(img);
      el.appendChild(imgWrap);

      const stick = document.createElement('div');
      stick.className = 'fc-rotate-stick';
      el.appendChild(stick);

      // Counter-scale the handles so they stay a comfortable, constant screen size no
      // matter how small the canvas is shown at — otherwise they shrink along with
      // everything else inside the scaled .fc-canvas and become nearly unclickable.
      const invScale = 1 / (this.displayScale || 1);

      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'fc-layer-handle fc-rotate-handle';
      rotateHandle.style.transform = `scale(${invScale})`;
      el.appendChild(rotateHandle);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'fc-layer-handle fc-resize-handle';
      resizeHandle.style.transform = `scale(${invScale})`;
      el.appendChild(resizeHandle);

      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._select(layer.id);
        if (e.target === resizeHandle) this._startResize(e, layer, el);
        else if (e.target === rotateHandle) this._startRotate(e, layer, el);
        else this._startMove(e, layer, el);
      });

      this.canvasEl.appendChild(el);
    });
  }

  // Toggles classes directly instead of a full re-render, so an in-flight drag on a layer's
  // own element (which selects it first, on pointerdown) never has its element ripped out
  // from under it — that broke setPointerCapture with an InvalidStateError.
  _select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.layerPanel.hidden = !id;
    this.canvasEl.querySelectorAll('.fc-layer').forEach((el) => {
      el.classList.toggle('selected', el.dataset.layerId === id);
    });
  }

  // Move/resize/rotate mutate the dragged element's own style directly and use pointer
  // capture, instead of re-rendering the whole layer list on every pointermove — that kept
  // destroying and recreating every handle mid-drag, which could drop the active gesture.
  _startMove(e, layer, el) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const origX = layer.x, origY = layer.y;
    const move = (ev) => {
      layer.x = origX + (ev.clientX - startX) / this.displayScale;
      layer.y = origY + (ev.clientY - startY) / this.displayScale;
      el.style.left = `${layer.x}px`;
      el.style.top = `${layer.y}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  _startResize(e, layer, el) {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const origW = layer.w, origH = layer.h;
    const ratio = origW / origH;
    const origDiag = Math.hypot(origW, origH);
    const move = (ev) => {
      const dx = (ev.clientX - startX) / this.displayScale;
      const dy = (ev.clientY - startY) / this.displayScale;
      const newDiag = Math.max(20, origDiag + (dx + dy));
      const scale = newDiag / origDiag;
      layer.w = clamp(origW * scale, 24, 6000);
      layer.h = layer.w / ratio;
      el.style.width = `${layer.w}px`;
      el.style.height = `${layer.h}px`;
      el.querySelector('.fc-layer-imgwrap').style.borderRadius = `${Math.min(this.radius, layer.w / 2, layer.h / 2)}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  _startRotate(e, layer, el) {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const cx = rect.left + (layer.x + layer.w / 2) * this.displayScale;
      const cy = rect.top + (layer.y + layer.h / 2) * this.displayScale;
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI) + 90;
      layer.rot = Math.round(angle);
      el.style.transform = `rotate(${layer.rot}deg)`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  _reorder(delta) {
    if (!this.selectedId) return;
    const i = this.layers.findIndex((l) => l.id === this.selectedId);
    if (i === -1) return;
    let j = clamp(i + delta, 0, this.layers.length - 1);
    if (j === i) return;
    const [layer] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, layer);
    this._renderLayers();
  }

  _bindUI() {
    document.getElementById('collageClose').addEventListener('click', () => this.close());

    this.canvasEl.addEventListener('pointerdown', (e) => {
      if (e.target === this.canvasEl) this._select(null);
    });

    document.getElementById('collageSizeRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const newSize = btn.dataset.size;
      if (newSize === this.sizeId) return;
      const { w: oldW, h: oldH } = CANVAS_SIZES[this.sizeId];
      const { w: newW, h: newH } = CANVAS_SIZES[newSize];
      const sx = newW / oldW, sy = newH / oldH;
      this.layers.forEach((l) => { l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy; });
      this.sizeId = newSize;
      this._syncSizeChips();
      this._layoutViewport();
      this._renderLayers();
    });

    document.getElementById('collageRadius').addEventListener('input', (e) => {
      this.radius = Number(e.target.value);
      document.getElementById('collageRadiusVal').textContent = `${this.radius}px`;
      this._renderLayers();
    });
    document.getElementById('collageBg').addEventListener('input', (e) => {
      this.bg = e.target.value;
      this.viewport.style.background = this.bg;
    });

    document.getElementById('fcFront').addEventListener('click', () => this._reorder(this.layers.length));
    document.getElementById('fcBack').addEventListener('click', () => this._reorder(-this.layers.length));
    document.getElementById('fcForward').addEventListener('click', () => this._reorder(1));
    document.getElementById('fcBackward').addEventListener('click', () => this._reorder(-1));
    document.getElementById('fcDeleteLayer').addEventListener('click', () => {
      this.layers = this.layers.filter((l) => l.id !== this.selectedId);
      this.selectedId = null;
      this.layerPanel.hidden = true;
      this._renderLayers();
    });

    document.getElementById('collageDownloadBtn').addEventListener('click', () => this._export('download'));
    document.getElementById('collageSaveGalleryBtn').addEventListener('click', () => this._export('gallery'));
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _renderToCanvas() {
    const { w: cw, h: ch } = CANVAS_SIZES[this.sizeId];
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const ctx = out.getContext('2d');
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, cw, ch);
    for (const layer of this.layers) {
      ctx.save();
      ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
      ctx.rotate((layer.rot * Math.PI) / 180);
      this._roundRectPath(ctx, -layer.w / 2, -layer.h / 2, layer.w, layer.h, this.radius);
      ctx.clip();
      const img = layer.img;
      const scale = Math.max(layer.w / img.naturalWidth, layer.h / img.naturalHeight);
      const sw = layer.w / scale, sh = layer.h / scale;
      const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
      ctx.restore();
    }
    return out;
  }

  _export(mode) {
    if (this.layers.length === 0) { showToast('No hay fotos en el collage', 'error'); return; }
    const out = this._renderToCanvas();
    out.toBlob((blob) => {
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
