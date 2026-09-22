import { CropOverlay } from './cropOverlay.js';
import { CSS_PRESETS } from './filterPresets.js';
import { processVideo } from './ffmpegService.js';
import { clamp, formatTime, downloadBlob, parseRatio, showToast } from './utils.js';

export class VideoEditor {
  constructor({ onSaveToGallery }) {
    this.onSaveToGallery = onSaveToGallery;
    this.modal = document.getElementById('videoEditorModal');
    this.video = document.getElementById('vidPreview');
    this.item = null;
    this.resultBlob = null;

    this.trimStart = 0;
    this.trimEnd = 0;
    this.state = { brightness: 0, contrast: 100, saturate: 100, preset: 'none', speed: 100 };

    this.track = document.getElementById('vidTrimTrack');
    this.fillEl = document.getElementById('vidTrimFill');
    this.startHandle = document.getElementById('vidTrimStart');
    this.endHandle = document.getElementById('vidTrimEnd');
    this.playhead = document.getElementById('vidPlayhead');

    this.crop = new CropOverlay({
      overlayEl: document.getElementById('vidCropOverlay'),
      rectEl: document.getElementById('vidCropRect'),
      containerEl: document.getElementById('vidFrame'),
      onChange: () => {},
    });
    this.crop.setEnabled(false);

    this._bindUI();
    this._raf = null;
  }

  async open(item) {
    this.item = item;
    this.resultBlob = null;
    document.getElementById('vidResultWrap').hidden = true;
    document.getElementById('vidProgressWrap').hidden = true;
    document.getElementById('vidDownloadBtn').disabled = true;
    document.getElementById('vidSaveGalleryBtn').disabled = true;

    this.video.src = item.url;
    await new Promise((resolve) => {
      this.video.onloadedmetadata = resolve;
    });
    this.trimStart = 0;
    this.trimEnd = this.video.duration;
    this.state = { brightness: 0, contrast: 100, saturate: 100, preset: 'none', speed: 100 };
    document.getElementById('vidCropEnable').checked = false;
    this.crop.setEnabled(false);
    this.crop.ratio = null;
    this.crop.reset();
    this._syncControls();
    this._renderTrack();
    this._applyLiveFilter();
    this.modal.hidden = false;
    document.documentElement.classList.add('modal-open');
  }

  close() {
    this.video.pause();
    cancelAnimationFrame(this._raf);
    this.modal.hidden = true;
    document.documentElement.classList.remove('modal-open');
  }

  _syncControls() {
    document.getElementById('vidBrightness').value = this.state.brightness;
    document.getElementById('vidContrast').value = this.state.contrast;
    document.getElementById('vidSaturate').value = this.state.saturate;
    document.getElementById('vidSpeed').value = this.state.speed;
    document.getElementById('vidBrightnessVal').textContent = this.state.brightness;
    document.getElementById('vidContrastVal').textContent = `${this.state.contrast}%`;
    document.getElementById('vidSaturateVal').textContent = `${this.state.saturate}%`;
    document.getElementById('vidSpeedVal').textContent = `${(this.state.speed / 100).toFixed(2)}×`;
    document.querySelectorAll('#vidPresetRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.preset === this.state.preset));
    document.querySelectorAll('#vidAspectRow .chip').forEach((c) => c.classList.toggle('active', c.dataset.ratio === 'free'));
  }

  _applyLiveFilter() {
    const preset = CSS_PRESETS[this.state.preset] || '';
    const b = 100 + this.state.brightness;
    const filter = `${preset} brightness(${b}%) contrast(${this.state.contrast}%) saturate(${this.state.saturate}%)`.trim();
    this.video.style.filter = filter;
    this.video.playbackRate = clamp(this.state.speed / 100, 0.25, 4);
  }

  _renderTrack() {
    const dur = this.video.duration || 1;
    const sPct = (this.trimStart / dur) * 100;
    const ePct = (this.trimEnd / dur) * 100;
    this.startHandle.style.left = `${sPct}%`;
    this.endHandle.style.left = `${ePct}%`;
    this.fillEl.style.left = `${sPct}%`;
    this.fillEl.style.width = `${ePct - sPct}%`;
    document.getElementById('vidStartLabel').textContent = formatTime(this.trimStart);
    document.getElementById('vidEndLabel').textContent = formatTime(this.trimEnd);
    document.getElementById('vidDurationLabel').textContent = `Duración seleccionada: ${formatTime(this.trimEnd - this.trimStart)}`;
  }

  _updatePlayheadLoop() {
    const dur = this.video.duration || 1;
    const pct = (this.video.currentTime / dur) * 100;
    this.playhead.style.left = `${pct}%`;
    document.getElementById('vidTimeLabel').textContent = `${formatTime(this.video.currentTime)} / ${formatTime(dur)}`;
    if (!this.video.paused) {
      if (this.video.currentTime >= this.trimEnd) {
        this.video.currentTime = this.trimStart;
      }
      this._raf = requestAnimationFrame(() => this._updatePlayheadLoop());
    }
  }

  _bindTrimHandle(handle, isStart) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const move = (ev) => {
        const rect = this.track.getBoundingClientRect();
        const pct = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
        const t = pct * this.video.duration;
        if (isStart) {
          this.trimStart = clamp(t, 0, this.trimEnd - 0.1);
        } else {
          this.trimEnd = clamp(t, this.trimStart + 0.1, this.video.duration);
        }
        this._renderTrack();
        this.video.currentTime = isStart ? this.trimStart : this.trimEnd;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  _bindUI() {
    document.getElementById('videoEditorClose').addEventListener('click', () => this.close());
    this._bindTrimHandle(this.startHandle, true);
    this._bindTrimHandle(this.endHandle, false);

    document.getElementById('vidPlayBtn').addEventListener('click', () => {
      if (this.video.paused) {
        if (this.video.currentTime < this.trimStart || this.video.currentTime >= this.trimEnd) {
          this.video.currentTime = this.trimStart;
        }
        this.video.play();
        document.getElementById('vidPlayBtn').textContent = '⏸';
        this._updatePlayheadLoop();
      } else {
        this.video.pause();
        document.getElementById('vidPlayBtn').textContent = '▶';
      }
    });
    this.video.addEventListener('pause', () => { document.getElementById('vidPlayBtn').textContent = '▶'; });

    document.getElementById('vidCropEnable').addEventListener('change', (e) => {
      this.crop.setEnabled(e.target.checked);
    });

    document.getElementById('vidAspectRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      document.querySelectorAll('#vidAspectRow .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      this.crop.setRatioValue(parseRatio(btn.dataset.ratio));
    });

    document.getElementById('vidPresetRow').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      this.state.preset = btn.dataset.preset;
      document.querySelectorAll('#vidPresetRow .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      this._applyLiveFilter();
    });

    const sliderMap = { vidBrightness: 'brightness', vidContrast: 'contrast', vidSaturate: 'saturate', vidSpeed: 'speed' };
    Object.entries(sliderMap).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('input', (e) => {
        this.state[key] = Number(e.target.value);
        if (key === 'speed') document.getElementById(`${id}Val`).textContent = `${(this.state.speed / 100).toFixed(2)}×`;
        else document.getElementById(`${id}Val`).textContent = key === 'brightness' ? this.state.brightness : `${e.target.value}%`;
        this._applyLiveFilter();
      });
    });

    document.getElementById('vidResetBtn').addEventListener('click', () => {
      this.state = { brightness: 0, contrast: 100, saturate: 100, preset: 'none', speed: 100 };
      document.getElementById('vidCropEnable').checked = false;
      this.crop.setEnabled(false);
      this.crop.ratio = null;
      this.crop.reset();
      this._syncControls();
      this._applyLiveFilter();
    });

    document.getElementById('vidProcessBtn').addEventListener('click', () => this._process());
    document.getElementById('vidDownloadBtn').addEventListener('click', () => {
      if (this.resultBlob) {
        downloadBlob(this.resultBlob, `${(this.item.name || 'video').replace(/\.[^.]+$/, '')}-editado.mp4`);
        showToast('Vídeo descargado');
      }
    });
    document.getElementById('vidSaveGalleryBtn').addEventListener('click', () => {
      if (this.resultBlob) {
        this.onSaveToGallery(this.resultBlob, `${(this.item.name || 'video').replace(/\.[^.]+$/, '')}-editado.mp4`, 'video');
        showToast('Guardado en la galería');
      }
    });
  }

  async _process() {
    this.video.pause();
    const wasCropEnabled = document.getElementById('vidCropEnable').checked;
    let crop = null;
    if (wasCropEnabled) {
      const r = this.crop.getRect();
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      crop = {
        x: Math.round(r.x * vw) & ~1,
        y: Math.round(r.y * vh) & ~1,
        w: Math.max(2, Math.round(r.w * vw)) & ~1,
        h: Math.max(2, Math.round(r.h * vh)) & ~1,
      };
    }

    const progressWrap = document.getElementById('vidProgressWrap');
    const progressFill = document.getElementById('vidProgressFill');
    const progressLabel = document.getElementById('vidProgressLabel');
    progressWrap.hidden = false;
    document.getElementById('vidProcessBtn').disabled = true;

    try {
      const blob = await processVideo({
        file: this.item.file,
        start: this.trimStart,
        end: this.trimEnd,
        crop,
        brightness: this.state.brightness,
        contrast: this.state.contrast,
        saturate: this.state.saturate,
        preset: this.state.preset,
        speed: this.state.speed,
        onProgress: (pct) => {
          progressFill.style.width = `${pct}%`;
          progressLabel.textContent = `Procesando… ${pct}%`;
        },
      });
      this.resultBlob = blob;
      const url = URL.createObjectURL(blob);
      const resultPreview = document.getElementById('vidResultPreview');
      resultPreview.src = url;
      document.getElementById('vidResultWrap').hidden = false;
      document.getElementById('vidDownloadBtn').disabled = false;
      document.getElementById('vidSaveGalleryBtn').disabled = false;
      showToast('Vídeo procesado correctamente');
    } catch (err) {
      console.error(err);
      showToast('Error al procesar el vídeo', 'error');
    } finally {
      progressWrap.hidden = true;
      document.getElementById('vidProcessBtn').disabled = false;
    }
  }
}
