import { state, dom } from './state.js';
import { fmtTime, escPath, resolvePath } from './utils.js';
import { renderList, scrollToSelected } from './filelist.js';

// Get path relative to home, using / separators
function relativeToHome(absPath) {
  const home = state.homeDir;
  if (absPath === home) return '';
  const rel = absPath.startsWith(home) ? absPath.slice(home.length) : absPath;
  return rel.replace(/^[/\\]+/, '').replace(/\\/g, '/');
}

// Convert a relative hash path back to absolute
export function hashToAbsolute(hash) {
  if (!hash) return state.homeDir;
  const sep = state.homeDir.includes('\\') ? '\\' : '/';
  return state.homeDir + sep + hash.replace(/\//g, sep);
}

export function renderBreadcrumbs() {
  const rel = relativeToHome(state.currentDir);
  const parts = rel ? rel.split('/') : [];

  let html = '<span data-path="">Home</span>';
  for (let i = 0; i < parts.length; i++) {
    html += '<span class="sep">&rsaquo;</span>';
    const partialRel = parts.slice(0, i + 1).join('/');
    html += `<span data-path="${escPath(partialRel)}">${parts[i]}</span>`;
  }
  dom.breadcrumbs.innerHTML = html;
}

export async function loadDirectory(dir) {
  try {
    const res = await fetch('/api/list?dir=' + encodeURIComponent(dir));
    if (!res.ok) {
      loadDirectory(state.homeDir);
      return;
    }
    const data = await res.json();
    state.currentDir = data.path;
    state.entries = data.entries;
    state.selectedIndex = state.entries.length > 0 ? 0 : -1;

    const rel = relativeToHome(state.currentDir);
    localStorage.setItem('audioBrowser_lastDir', rel);
    history.replaceState(null, '', rel ? '#' + rel : '#');
    renderBreadcrumbs();
    renderList();
    scrollToSelected();
    dom.filelist.focus();
    fetchDurations();
  } catch (err) {
    alert('Failed to load directory: ' + err.message);
  }
}

async function fetchDurations() {
  const dir = state.currentDir;
  const audioEntries = state.entries.filter(e => e.type === 'file');
  for (const entry of audioEntries) {
    if (state.currentDir !== dir) return;
    try {
      const sep = dir.includes('\\') ? '\\' : '/';
      const res = await fetch('/api/duration?file=' + encodeURIComponent(dir + sep + entry.name));
      if (!res.ok) continue;
      const data = await res.json();
      if (data.duration != null) {
        entry.duration = data.duration;
        const el = dom.filelist.querySelector(`.row-duration[data-file="${CSS.escape(entry.name)}"]`);
        if (el) el.textContent = fmtTime(data.duration);
      }
    } catch {}
  }
}

export function openSelected() {
  const entry = state.entries[state.selectedIndex];
  if (!entry || entry.type !== 'folder') return;

  if (entry.name === '..') {
    const sep = state.currentDir.includes('\\') ? '\\' : '/';
    const parent = state.currentDir.substring(0, state.currentDir.lastIndexOf(sep))
      || (sep === '/' ? '/' : state.currentDir.substring(0, 3));
    loadDirectory(parent);
  } else {
    loadDirectory(resolvePath(entry.name));
  }
}

// Breadcrumb click delegation
export function initBreadcrumbEvents() {
  dom.breadcrumbs.addEventListener('click', (e) => {
    const span = e.target.closest('span[data-path]');
    if (span) loadDirectory(hashToAbsolute(span.dataset.path));
  });
}
