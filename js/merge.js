import { mergeVideos } from './ffmpegService.js';
import { downloadBlob, showToast } from './utils.js';

export class MergeBuilder {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('mergeModal');
    this.listEl = document.getElementById('mergeList');
    this.items = [];
    this.resultBlob = null;
    this.draggingId = null;
    this._bindUI();
  }

  open(items) {
    this.items = items.slice();
    this.resultBlob = null;
    document.getElementById('mergeResultWrap').hidden = true;
    document.getElementById('mergeProgressWrap').hidden = true;
    document.getElementById('mergeDownloadBtn').disabled = true;
    document.getElementById('mergeSaveGalleryBtn').disabled = true;
    document.getElementById('mergeGrayscale').checked = false;
    this._renderList();
    this.modal.hidden = false;
    document.documentElement.classList.add('modal-open');
  }

  close() {
    this.modal.hidden = true;
    document.documentElement.classList.remove('modal-open');
  }

  _renderList() {
    this.listEl.innerHTML = '';
    this.items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'merge-item';
      li.dataset.id = item.id;
      if (item.id === this.draggingId) li.classList.add('dragging-placeholder');

      const handle = document.createElement('span');
      handle.className = 'merge-drag-handle';
      handle.textContent = '⠿';
      handle.title = 'Arrastrar para reordenar';
      handle.addEventListener('pointerdown', (e) => this._startDrag(e, item));

      const video = document.createElement('video');
      video.src = item.url;
      video.muted = true;
      const name = document.createElement('span');
      name.className = 'merge-item-name';
      name.textContent = `${i + 1}. ${item.name}`;
      const order = document.createElement('div');
      order.className = 'merge-item-order';
      const up = document.createElement('button');
      up.textContent = '▲';
      up.disabled = i === 0;
      up.addEventListener('click', () => this._move(i, -1));
      const down = document.createElement('button');
      down.textContent = '▼';
      down.disabled = i === this.items.length - 1;
      down.addEventListener('click', () => this._move(i, 1));
      order.appendChild(up);
      order.appendChild(down);
      li.appendChild(handle);
      li.appendChild(video);
      li.appendChild(name);
      li.appendChild(order);
      this.listEl.appendChild(li);
    });
  }

  _move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= this.items.length) return;
    [this.items[index], this.items[target]] = [this.items[target], this.items[index]];
    this._renderList();
  }

  /** Pointer-based drag-and-drop reorder (works with touch too, unlike native HTML5 DnD). */
  _startDrag(e, item) {
    e.preventDefault();
    const li = this.listEl.querySelector(`[data-id="${item.id}"]`);
    if (!li) return;
    const rect = li.getBoundingClientRect();
    const grabOffsetY = e.clientY - rect.top;

    this.draggingId = item.id;
    const clone = li.cloneNode(true);
    clone.classList.add('merge-item-clone');
    clone.style.width = `${rect.width}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    document.body.appendChild(clone);
    this._renderList();

    const move = (ev) => {
      clone.style.top = `${ev.clientY - grabOffsetY}px`;
      const others = [...this.listEl.querySelectorAll('.merge-item:not(.dragging-placeholder)')];
      let targetIndex = this.items.length - 1;
      for (let k = 0; k < others.length; k++) {
        const r = others[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          const id = others[k].dataset.id;
          targetIndex = this.items.findIndex((it) => it.id === id);
          break;
        }
      }
      const currentIndex = this.items.findIndex((it) => it.id === item.id);
      if (targetIndex !== currentIndex) {
        const [moved] = this.items.splice(currentIndex, 1);
        this.items.splice(targetIndex, 0, moved);
        this._renderList();
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clone.remove();
      this.draggingId = null;
      this._renderList();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _bindUI() {
    document.getElementById('mergeClose').addEventListener('click', () => this.close());
    document.getElementById('mergeProcessBtn').addEventListener('click', () => this._process());
    document.getElementById('mergeDownloadBtn').addEventListener('click', () => {
      if (this.resultBlob) {
        downloadBlob(this.resultBlob, 'video-unido.mp4');
        showToast('Vídeo descargado');
      }
    });
    document.getElementById('mergeSaveGalleryBtn').addEventListener('click', () => {
      if (this.resultBlob) {
        this.onSaveToGallery(this.resultBlob, 'video-unido.mp4', 'video');
        showToast('Guardado en la galería');
      }
    });
  }

  async _process() {
    if (this.items.length < 2) {
      showToast('Selecciona al menos 2 vídeos', 'error');
      return;
    }
    const [width, height] = document.getElementById('mergeResolution').value.split('x').map(Number);
    const grayscale = document.getElementById('mergeGrayscale').checked;

    const progressWrap = document.getElementById('mergeProgressWrap');
    const progressFill = document.getElementById('mergeProgressFill');
    const progressLabel = document.getElementById('mergeProgressLabel');
    progressWrap.hidden = false;
    document.getElementById('mergeProcessBtn').disabled = true;

    try {
      const blob = await mergeVideos({
        files: this.items.map((i) => i.file),
        width, height, grayscale,
        onProgress: (pct) => {
          progressFill.style.width = `${pct}%`;
          progressLabel.textContent = `Procesando… ${pct}%`;
        },
      });
      this.resultBlob = blob;
      const url = URL.createObjectURL(blob);
      document.getElementById('mergeResultPreview').src = url;
      document.getElementById('mergeResultWrap').hidden = false;
      document.getElementById('mergeDownloadBtn').disabled = false;
      document.getElementById('mergeSaveGalleryBtn').disabled = false;
      showToast('Vídeos unidos correctamente');
    } catch (err) {
      console.error(err);
      showToast('Error al unir los vídeos', 'error');
    } finally {
      progressWrap.hidden = true;
      document.getElementById('mergeProcessBtn').disabled = false;
    }
  }
}
