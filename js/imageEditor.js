import { CropOverlay } from './cropOverlay.js';
import { buildCssFilter } from './filterPresets.js';
import { loadImage, downloadBlob, parseRatio, showToast } from './utils.js';

export class ImageEditor {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('imageEditorModal');
    this.canvas = document.getElementById('imgCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.working = document.createElement('canvas'); // baked (rotated/flipped) pixels
    this.workCtx = this.working.getContext('2d');
    this.drawLayer = document.createElement('canvas'); // transparent annotations (drawing + text)
    this.item = null;

    this.state = {
      brightness: 100, contrast: 100, saturate: 100, blur: 0, preset: 'none',
      tool: 'crop', brushColor: '#ff3b30', brushSize: 10, eraser: false,
      textColor: '#ffffff', textSize: 48,
    };

    this.crop = new CropOverlay({
      overlayEl: document.getElementById('imgCropOverlay'),
      rectEl: document.getElementById('imgCropRect'),
      containerEl: document.getElementById('imgFrame'),
      onChange: () => {},
    });
    this.crop.setEnabled(true);

    this._bindUI();
    this._bindDrawing();
  }

  async open(item) {
    this.item = item;
    const img = await loadImage(item.url);
    this.working.width = img.naturalWidth;
    this.working.height = img.naturalHeight;
    this.workCtx.clearRect(0, 0, this.working.width, this.working.height);
    this.workCtx.drawImage(img, 0, 0);
    this._resetDrawLayer();

    this.state = {
      brightness: 100, contrast: 100, saturate: 100, blur: 0, preset: 'none',
      tool: 'crop', brushColor: '#ff3b30', brushSize: 10, eraser: false,
      textColor: '#ffffff', textSize: 48,
    };
    this._syncControls();
    this._setTool('crop');
    this.crop.ratio = null;
    this.crop.reset();
    this._render();
    this.modal.hidden = false;
    document.documentElement.classList.add('modal-open');
  }

  _resetDrawLayer() {
    this.drawLayer.width = this.working.width;
    this.drawLayer.height = this.working.height;
  }

  close() {
    this.modal.hidden = true;
    document.documentElement.classList.remove('modal-open');
  }

  _render() {
    this.canvas.width = this.working.width;
    this.canvas.height = this.working.height;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.filter = buildCssFilter(this.state);
    this.ctx.drawImage(this.working, 0, 0);
    this.ctx.filter = 'none';
    this.ctx.drawImage(this.drawLayer, 0, 0);
  }

  _bake(newCanvas) {
    this.working = newCanvas;
    this.workCtx = this.working.getContext('2d');
    this._resetDrawLayer();
    this.crop.reset();
    this._render();
  }

  _rotate(dir) {
    const w = this.working.width, h = this.working.height;
    const nc = document.createElement('canvas');
    nc.width = h; nc.height = w;
    const c = nc.getContext('2d');
    c.translate(nc.width / 2, nc.height / 2);
    c.rotate((dir * Math.PI) / 2);
    c.drawImage(this.working, -w / 2, -h / 2);
    this._bake(nc);
  }

  _flip(axis) {
    const w = this.working.width, h = this.working.height;
    const nc = document.createElement('canvas');
    nc.width = w; nc.height = h;
    const c = nc.getContext('2d');
    if (axis === 'h') { c.translate(w, 0); c.scale(-1, 1); }
    else { c.translate(0, h); c.scale(1, -1); }
    c.drawImage(this.working, 0, 0);
    this._bake(nc);
  }

  _syncControls() {
    document.getElementById('imgBrightness').value = this.state.brightness;
    document.getElementById('imgContrast').value = this.state.contrast;
    document.getElementById('imgSaturate').value = this.state.saturate;
    document.getElementById('imgBlur').value = this.state.blur;
    document.getElementById('imgBrightnessVal').textContent = `${this.state.brightness}%`;
    document.getElementById('imgContrastVal').textContent = `${this.state.contrast}%`;
    document.getElementById('imgSaturateVal').textContent = `${this.state.saturate}%`;
    document.getElementById('imgBlurVal').textContent = `${this.state.blur}px`;
    document.querySelectorAll('#imgPresetRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.preset === this.state.preset));
    document.querySelectorAll('#imgAspectRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.ratio === 'free'));
    document.getElementById('imgBrushSize').value = this.state.brushSize;
    document.getElementById('imgBrushSizeVal').textContent = `${this.state.brushSize}px`;
    document.getElementById('imgBrushColor').value = this.state.brushColor;
    document.getElementById('imgTextSize').value = this.state.textSize;
    document.getElementById('imgTextSizeVal').textContent = `${this.state.textSize}px`;
    document.getElementById('imgTextColor').value = this.state.textColor;
    document.getElementById('imgEraserToggle').classList.toggle('active', this.state.eraser);
  }

  _setTool(tool) {
    this.state.tool = tool;
    document.querySelectorAll('#imgToolRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.tool === tool));
    document.getElementById('imgCropTools').hidden = tool !== 'crop';
    document.getElementById('imgDrawTools').hidden = tool !== 'draw';
    document.getElementById('imgTextTools').hidden = tool !== 'text';
    this.crop.setEnabled(tool === 'crop');
    this.canvas.classList.toggle('tool-draw', tool === 'draw');
    this.canvas.classList.toggle('tool-text', tool === 'text');
  }

  _bindUI() {
    document.getElementById('imageEditorClose').addEventListener('click', () => this.close());

    document.getElementById('imgRotateLeft').addEventListener('click', () => this._rotate(-1));
    document.getElementById('imgRotateRight').addEventListener('click', () => this._rotate(1));
    document.getElementById('imgFlipH').addEventListener('click', () => this._flip('h'));
    document.getElementById('imgFlipV').addEventListener('click', () => this._flip('v'));

    const sliderMap = { imgBrightness: 'brightness', imgContrast: 'contrast', imgSaturate: 'saturate', imgBlur: 'blur' };
    Object.entries(sliderMap).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('input', (e) => {
        this.state[key] = Number(e.target.value);
        document.getElementById(`${id}Val`).textContent = key === 'blur' ? `${e.target.value}px` : `${e.target.value}%`;
        this._render();
      });
    });

    document.getElementById('imgPresetRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      this.state.preset = btn.dataset.preset;
      document.querySelectorAll('#imgPresetRow .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      this._render();
    });

    document.getElementById('imgAspectRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      document.querySelectorAll('#imgAspectRow .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      this.crop.setRatioValue(parseRatio(btn.dataset.ratio));
    });

    document.getElementById('imgToolRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      this._setTool(btn.dataset.tool);
    });

    document.getElementById('imgBrushSize').addEventListener('input', (e) => {
      this.state.brushSize = Number(e.target.value);
      document.getElementById('imgBrushSizeVal').textContent = `${e.target.value}px`;
    });
    document.getElementById('imgBrushColor').addEventListener('input', (e) => { this.state.brushColor = e.target.value; });
    document.getElementById('imgEraserToggle').addEventListener('click', (e) => {
      this.state.eraser = !this.state.eraser;
      e.currentTarget.classList.toggle('active', this.state.eraser);
    });
    document.getElementById('imgClearDrawing').addEventListener('click', () => {
      this._resetDrawLayer();
      this._render();
    });
    document.getElementById('imgTextSize').addEventListener('input', (e) => {
      this.state.textSize = Number(e.target.value);
      document.getElementById('imgTextSizeVal').textContent = `${e.target.value}px`;
    });
    document.getElementById('imgTextColor').addEventListener('input', (e) => { this.state.textColor = e.target.value; });

    document.getElementById('imgResetBtn').addEventListener('click', () => {
      this.state = {
        brightness: 100, contrast: 100, saturate: 100, blur: 0, preset: 'none',
        tool: 'crop', brushColor: '#ff3b30', brushSize: 10, eraser: false,
        textColor: '#ffffff', textSize: 48,
      };
      this._syncControls();
      this._setTool('crop');
      this.crop.ratio = null;
      this.crop.reset();
      this._resetDrawLayer();
      this._render();
    });

    document.getElementById('imgDownloadBtn').addEventListener('click', () => this._export('download'));
    document.getElementById('imgSaveGalleryBtn').addEventListener('click', () => this._export('gallery'));
  }

  _bindDrawing() {
    let drawing = false;
    let last = null;

    const getPoint = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.working.width / rect.width;
      const scaleY = this.working.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY, scaleX };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.state.tool === 'crop') return;
      e.preventDefault();
      const p = getPoint(e);

      if (this.state.tool === 'text') {
        const text = window.prompt('Escribe el texto:');
        if (text) {
          const ctx = this.drawLayer.getContext('2d');
          ctx.font = `bold ${this.state.textSize}px sans-serif`;
          ctx.fillStyle = this.state.textColor;
          ctx.textBaseline = 'middle';
          ctx.fillText(text, p.x, p.y);
          this._render();
        }
        return;
      }

      drawing = true;
      last = p;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!drawing || this.state.tool !== 'draw') return;
      const p = getPoint(e);
      const ctx = this.drawLayer.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = this.state.eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = this.state.brushColor;
      ctx.lineWidth = this.state.brushSize * p.scaleX;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      this._render();
    });

    const stop = () => { drawing = false; last = null; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('pointerleave', stop);
  }

  _exportCanvas() {
    const r = this.crop.getRect();
    const sx = Math.round(r.x * this.working.width);
    const sy = Math.round(r.y * this.working.height);
    const sw = Math.max(1, Math.round(r.w * this.working.width));
    const sh = Math.max(1, Math.round(r.h * this.working.height));

    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const octx = out.getContext('2d');
    octx.filter = buildCssFilter(this.state);
    octx.drawImage(this.working, sx, sy, sw, sh, 0, 0, sw, sh);
    octx.filter = 'none';
    octx.drawImage(this.drawLayer, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }

  _export(mode) {
    const out = this._exportCanvas();
    out.toBlob((blob) => {
      if (!blob) return;
      if (mode === 'download') {
        downloadBlob(blob, `${(this.item.name || 'foto').replace(/\.[^.]+$/, '')}-editada.png`);
        showToast('Foto descargada');
      } else {
        this.onSaveToGallery(blob, `${(this.item.name || 'foto').replace(/\.[^.]+$/, '')}-editada.png`, 'image');
        showToast('Guardada en la galería');
      }
    }, 'image/png');
  }
}
