export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function isVideo(file) {
  return file.type.startsWith('video/');
}

export function isImage(file) {
  return file.type.startsWith('image/');
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function loadVideoMeta(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
    });
    v.onerror = reject;
    v.src = src;
  });
}

export function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/** Parse "a:b" ratio string to a number, or null for free-form. */
export function parseRatio(str) {
  if (!str || str === 'free') return null;
  const [a, b] = str.split(':').map(Number);
  return a / b;
}
