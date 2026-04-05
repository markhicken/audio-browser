import { state, dom } from './state.js';
import { fmtSize, fmtTime, escHtml, resolvePath } from './utils.js';
import { playFile, stopPlayback } from './playback.js';

export function updateFileCount() {
  const files = state.entries.filter(e => e.type === 'file').length;
  const folders = state.entries.filter(e => e.type === 'folder' && e.name !== '..').length;
  const parts = [];
  if (files) parts.push(files + ' file' + (files !== 1 ? 's' : ''));
  if (folders) parts.push(folders + ' folder' + (folders !== 1 ? 's' : ''));
  dom.fileCount.textContent = parts.join(', ') || 'Empty folder';
}

export function renderList() {
  updateFileCount();
  if (state.entries.length === 0) {
    dom.filelist.style.display = 'none';
    dom.empty.style.display = 'flex';
    return;
  }
  dom.filelist.style.display = '';
  dom.empty.style.display = 'none';

  let html = '';
  for (let i = 0; i < state.entries.length; i++) {
    const e = state.entries[i];
    const isSelected = i === state.selectedIndex;
    const isPlaying = state.playingFile && e.type === 'file' && resolvePath(e.name) === state.playingFile;
    const classes = ['row'];
    if (isSelected) classes.push('selected');
    if (isPlaying) classes.push('playing');

    const icon = e.type === 'folder'
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.8.4L4.5 11H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5L8.7 2.1A.5.5 0 0 1 9 2.5z"/><path d="M11.3 4.7a.5.5 0 0 1 .7 0 5 5 0 0 1 0 6.6.5.5 0 0 1-.7-.7 4 4 0 0 0 0-5.2.5.5 0 0 1 0-.7z"/></svg>';
    const badge = e.type === 'folder'
      ? '<span class="row-badge badge-folder">folder</span>'
      : `<span class="row-badge badge-${e.ext}">${e.ext}</span>`;
    const dur = e.type === 'file'
      ? `<span class="row-duration" data-file="${escHtml(e.name)}">${e.duration != null ? fmtTime(e.duration) : ''}</span>`
      : '<span class="row-duration"></span>';
    const size = e.type === 'file' ? `<span class="row-size">${fmtSize(e.size)}</span>` : '<span class="row-size"></span>';

    html += `<div class="${classes.join(' ')}" data-index="${i}">
      <span class="row-icon">${icon}</span>
      <span class="row-name">${escHtml(e.name)}</span>
      ${badge}${dur}${size}
    </div>`;
  }
  dom.filelist.innerHTML = html;
}

export function scrollToSelected() {
  const row = dom.filelist.querySelector('.row.selected');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

export function selectRow(index) {
  state.selectedIndex = index;
  renderList();
  scrollToSelected();

  const entry = state.entries[index];
  if (!entry || entry.type === 'folder') return;
  playFile(entry);
}

export function activateRow(index) {
  const entry = state.entries[index];
  if (!entry) return;
  if (entry.type === 'folder') {
    state.selectedIndex = index;
    // openSelected is imported dynamically to avoid circular dep
    import('./navigation.js').then(m => m.openSelected());
  }
}

export function selectWithDebounce(index) {
  state.selectedIndex = index;
  renderList();
  scrollToSelected();

  const entry = state.entries[index];
  if (!entry || entry.type === 'folder') {
    clearTimeout(state.playTimeout);
    return;
  }

  clearTimeout(state.playTimeout);
  state.playTimeout = setTimeout(() => playFile(entry), 150);
}

export async function deleteSelected() {
  const entry = state.entries[state.selectedIndex];
  if (!entry || entry.type === 'folder') return;

  if (!confirm('Move "' + entry.name + '" to Recycle Bin?')) return;

  const filePath = resolvePath(entry.name);
  if (state.playingFile === filePath) stopPlayback();

  try {
    const res = await fetch('/api/file?file=' + encodeURIComponent(filePath), { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      alert('Delete failed: ' + err.error);
      return;
    }
    state.entries.splice(state.selectedIndex, 1);
    if (state.selectedIndex >= state.entries.length) state.selectedIndex = state.entries.length - 1;
    renderList();
    scrollToSelected();
    dom.filelist.focus();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// Click/double-click delegation on file list
export function initFileListEvents() {
  let lastClickIndex = -1;
  let lastClickTime = 0;

  dom.filelist.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const index = parseInt(row.dataset.index);
    const now = Date.now();

    // Detect double-click manually since re-render kills the DOM element
    if (index === lastClickIndex && now - lastClickTime < 400) {
      lastClickIndex = -1;
      activateRow(index);
    } else {
      lastClickIndex = index;
      lastClickTime = now;
      selectRow(index);
    }
  });
}
