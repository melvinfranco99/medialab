import { mergeVideos } from './ffmpegService.js';
import { downloadBlob, showToast } from './utils.js';

export class MergeBuilder {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('mergeModal');
    this.listEl = document.getElementById('mergeList');
    this.items = [];
    this.resultBlob = null;
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
  }

  close() {
    this.modal.hidden = true;
  }

  _renderList() {
    this.listEl.innerHTML = '';
    this.items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'merge-item';
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
