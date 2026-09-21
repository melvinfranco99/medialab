import { clamp } from './utils.js';

/**
 * Draggable / resizable crop rectangle over a container.
 * Rect is tracked in relative [0..1] coordinates so it survives resizes.
 */
export class CropOverlay {
  constructor({ overlayEl, rectEl, containerEl, onChange }) {
    this.overlay = overlayEl;
    this.rect = rectEl;
    this.container = containerEl;
    this.onChange = onChange || (() => {});
    this.ratio = null; // width/height, null = free
    this.r = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    this._bind();
  }

  setEnabled(enabled) {
    this.overlay.hidden = !enabled;
  }

  setRatioValue(ratio) {
    this.ratio = ratio;
    if (ratio) {
      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      if (!cw || !ch) return;
      let w = this.r.w;
      let h = (w * cw) / (ratio * ch);
      if (h > 1) { h = 1; w = (h * ch * ratio) / cw; }
      const x = clamp(this.r.x, 0, 1 - w);
      const y = clamp(this.r.y, 0, 1 - h);
      this.r = { x, y, w, h };
      this._render();
      this.onChange(this.getRect());
    }
  }

  reset() {
    this.r = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    this._render();
  }

  /** Returns rect in relative coords {x,y,w,h} each in [0,1]. */
  getRect() {
    return { ...this.r };
  }

  _render() {
    this.rect.style.left = `${this.r.x * 100}%`;
    this.rect.style.top = `${this.r.y * 100}%`;
    this.rect.style.width = `${this.r.w * 100}%`;
    this.rect.style.height = `${this.r.h * 100}%`;
  }

  _bind() {
    this._render();
    let mode = null; // 'move' | handle name
    let start = null;

    const pointerDown = (e, handleName) => {
      e.preventDefault();
      e.stopPropagation();
      mode = handleName || 'move';
      const p = this._point(e);
      start = { px: p.x, py: p.y, r: { ...this.r } };
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerUp);
    };

    const pointerMove = (e) => {
      if (!mode) return;
      const p = this._point(e);
      const dx = p.x - start.px;
      const dy = p.y - start.py;
      let { x, y, w, h } = start.r;

      if (mode === 'move') {
        x = clamp(start.r.x + dx, 0, 1 - w);
        y = clamp(start.r.y + dy, 0, 1 - h);
      } else {
        // resize
        let nx = x, ny = y, nw = w, nh = h;
        if (mode.includes('e')) nw = clamp(w + dx, 0.03, 1 - x);
        if (mode.includes('s')) nh = clamp(h + dy, 0.03, 1 - y);
        if (mode.includes('w')) { nx = clamp(x + dx, 0, x + w - 0.03); nw = x + w - nx; }
        if (mode.includes('n')) { ny = clamp(y + dy, 0, y + h - 0.03); nh = y + h - ny; }

        if (this.ratio) {
          // enforce aspect ratio using width as driver, anchored appropriately
          const cw = this.container.clientWidth;
          const ch = this.container.clientHeight;
          if (cw && ch) {
            const targetH = (nw * cw) / (this.ratio * ch);
            if (mode.includes('n')) {
              const bottom = y + h;
              ny = clamp(bottom - targetH, 0, bottom - 0.03);
              nh = bottom - ny;
            } else {
              nh = clamp(targetH, 0.03, 1 - ny);
            }
          }
        }
        x = nx; y = ny; w = nw; h = nh;
      }

      this.r = { x, y, w, h };
      this._render();
      this.onChange(this.getRect());
    };

    const pointerUp = () => {
      mode = null;
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
    };

    this.rect.addEventListener('pointerdown', (e) => {
      if (e.target.dataset.handle) {
        pointerDown(e, e.target.dataset.handle);
      } else {
        pointerDown(e, null);
      }
    });
  }

  _point(e) {
    const b = this.container.getBoundingClientRect();
    return {
      x: (e.clientX - b.left) / b.width,
      y: (e.clientY - b.top) / b.height,
    };
  }
}
