import { uid, isImage, isVideo, loadVideoMeta, formatTime, showToast } from './utils.js';
import { ImageEditor } from './imageEditor.js';
import { VideoEditor } from './videoEditor.js';
import { Collage } from './collage.js';
import { MergeBuilder } from './merge.js';

const library = [];

const els = {
  uploadPanel: document.getElementById('uploadPanel'),
  libraryPanel: document.getElementById('libraryPanel'),
  dropzone: document.getElementById('dropzone'),
  pickFilesBtn: document.getElementById('pickFilesBtn'),
  addMoreBtn: document.getElementById('addMoreBtn'),
  fileInput: document.getElementById('fileInput'),
  grid: document.getElementById('libraryGrid'),
  itemCount: document.getElementById('itemCount'),
  collageBtn: document.getElementById('collageBtn'),
  mergeBtn: document.getElementById('mergeBtn'),
  deleteSelectedBtn: document.getElementById('deleteSelectedBtn'),
  themeToggle: document.getElementById('themeToggle'),
};

function addItemFromBlob(blob, name, type) {
  const file = new File([blob], name, { type: blob.type });
  addFiles([file]);
}

const imageEditor = new ImageEditor({ onSaveToGallery: addItemFromBlob });
const videoEditor = new VideoEditor({ onSaveToGallery: addItemFromBlob });
const collage = new Collage({ onSaveToGallery: addItemFromBlob });
const merge = new MergeBuilder({ onSaveToGallery: addItemFromBlob });

function addFiles(fileList) {
  const files = Array.from(fileList);
  let added = 0;
  for (const file of files) {
    if (!isImage(file) && !isVideo(file)) continue;
    const item = {
      id: uid(),
      type: isImage(file) ? 'image' : 'video',
      file,
      url: URL.createObjectURL(file),
      name: file.name || (isImage(file) ? 'foto.png' : 'video.mp4'),
      duration: null,
      selected: false,
    };
    library.unshift(item);
    added++;
    if (item.type === 'video') {
      loadVideoMeta(item.url).then((meta) => {
        item.duration = meta.duration;
        renderGrid();
      }).catch(() => {});
    }
  }
  if (added === 0 && files.length > 0) {
    showToast('Selecciona archivos de foto o vídeo válidos', 'error');
  }
  if (added > 0) {
    renderGrid();
  }
}

function renderGrid() {
  els.uploadPanel.hidden = library.length > 0;
  els.libraryPanel.hidden = library.length === 0;
  els.itemCount.textContent = library.length;
  els.grid.innerHTML = '';

  for (const item of library) {
    const card = document.createElement('div');
    card.className = `card ${item.selected ? 'selected' : ''}`;
    card.dataset.id = item.id;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'card-thumb-wrap';
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.src = item.url;
      img.loading = 'lazy';
      thumbWrap.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = item.url;
      video.muted = true;
      video.preload = 'metadata';
      thumbWrap.appendChild(video);
    }

    const badge = document.createElement('span');
    badge.className = 'card-badge';
    badge.textContent = item.type === 'image' ? 'Foto' : `Vídeo${item.duration ? ' · ' + formatTime(item.duration) : ''}`;
    thumbWrap.appendChild(badge);

    const checkbox = document.createElement('div');
    checkbox.className = 'card-checkbox';
    checkbox.textContent = item.selected ? '✓' : '';
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelect(item);
    });
    thumbWrap.appendChild(checkbox);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'card-action-btn';
    editBtn.title = 'Editar';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(item);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'card-action-btn danger';
    delBtn.title = 'Eliminar';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItems([item.id]);
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    thumbWrap.appendChild(actions);

    card.appendChild(thumbWrap);

    const info = document.createElement('div');
    info.className = 'card-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'card-name';
    nameEl.textContent = item.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'card-meta';
    metaEl.textContent = item.type === 'image' ? 'Imagen' : 'Vídeo';
    info.appendChild(nameEl);
    info.appendChild(metaEl);
    card.appendChild(info);

    card.addEventListener('click', () => toggleSelect(item));

    els.grid.appendChild(card);
  }

  updateToolbar();
}

function toggleSelect(item) {
  item.selected = !item.selected;
  renderGrid();
}

function updateToolbar() {
  const selected = library.filter((i) => i.selected);
  const selImages = selected.filter((i) => i.type === 'image');
  const selVideos = selected.filter((i) => i.type === 'video');
  els.collageBtn.disabled = selImages.length < 2;
  els.mergeBtn.disabled = selVideos.length < 2;
  els.deleteSelectedBtn.disabled = selected.length === 0;
}

function removeItems(ids) {
  for (const id of ids) {
    const idx = library.findIndex((i) => i.id === id);
    if (idx !== -1) {
      URL.revokeObjectURL(library[idx].url);
      library.splice(idx, 1);
    }
  }
  renderGrid();
}

function openEditor(item) {
  if (item.type === 'image') imageEditor.open(item);
  else videoEditor.open(item);
}

// ---------- Upload wiring ----------
els.pickFilesBtn.addEventListener('click', () => els.fileInput.click());
els.addMoreBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('drag-over');
  });
});
els.dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
els.dropzone.addEventListener('click', (e) => {
  if (e.target === els.pickFilesBtn) return;
  els.fileInput.click();
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- Toolbar actions ----------
els.collageBtn.addEventListener('click', () => {
  const items = library.filter((i) => i.selected && i.type === 'image');
  collage.open(items);
});
els.mergeBtn.addEventListener('click', () => {
  const items = library.filter((i) => i.selected && i.type === 'video');
  merge.open(items);
});
els.deleteSelectedBtn.addEventListener('click', () => {
  const ids = library.filter((i) => i.selected).map((i) => i.id);
  removeItems(ids);
});

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('medialab-theme'); } catch { /* ignore */ }
  if (saved) applyTheme(saved);
})();
els.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('medialab-theme', next); } catch { /* ignore */ }
});

renderGrid();
