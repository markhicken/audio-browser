import { state, dom } from './state.js';
import { escPath, resolvePath } from './utils.js';
import { renderList, scrollToSelected, prefetchVisiblePages, syncVisibleWindowToScroll, rerenderVisibleWindow } from './filelist.js';

const ROW_HEIGHT = 32;
let resizeReloadTimer = null;

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

function getViewportPageSize() {
  const visibleHeight = dom.filelist.clientHeight || window.innerHeight || ROW_HEIGHT;
  return Math.max(1, Math.ceil(visibleHeight / ROW_HEIGHT));
}

function syncPageSize() {
  const nextPageSize = getViewportPageSize();
  const changed = state.pageSize !== nextPageSize;
  state.pageSize = nextPageSize;
  return changed;
}

function resetDirectoryState() {
  state.entries = [];
  state.selectedIndex = -1;
  state.totalEntries = 0;
  state.hasMoreEntries = false;
  state.entryCounts = { files: 0, folders: 0 };
  state.loadedPages = new Set();
  state.loadingPages = new Set();
  state.visiblePageStart = 1;
  state.visiblePageEnd = 1;
  clearTimeout(state.scrollPrefetchTimer);
  state.scrollPrefetchTimer = null;
}

function mergePage(data) {
  if (state.entries.length !== data.totalEntries) {
    state.entries = new Array(data.totalEntries);
  }

  for (let i = 0; i < data.entries.length; i++) {
    state.entries[data.offset + i] = data.entries[i];
  }

  state.totalEntries = data.totalEntries;
  state.hasMoreEntries = data.hasMore;
  state.entryCounts = data.counts || state.entryCounts;
}

export async function loadDirectoryPage(page) {
  if (!state.currentDir || state.loadedPages.has(page) || state.loadingPages.has(page)) return;

  state.loadingPages.add(page);
  rerenderVisibleWindow();

  const token = state.listRequestToken;

  try {
    const res = await fetch('/api/list?dir=' + encodeURIComponent(state.currentDir) +
      '&page=' + page +
      '&pageSize=' + state.pageSize);
    if (!res.ok) {
      state.loadingPages.delete(page);
      rerenderVisibleWindow();
      return;
    }

    const data = await res.json();
    if (token !== state.listRequestToken || data.path !== state.currentDir) {
      state.loadingPages.delete(page);
      return;
    }

    mergePage(data);
    state.loadedPages.add(page);
    state.loadingPages.delete(page);
    rerenderVisibleWindow();
  } catch {
    state.loadingPages.delete(page);
    rerenderVisibleWindow();
  }
}

export async function loadDirectory(dir) {
  syncPageSize();

  const nextDir = dir || state.homeDir;
  const token = state.listRequestToken + 1;
  state.listRequestToken = token;
  state.isLoadingDirectory = true;
  state.currentDir = nextDir;
  resetDirectoryState();
  renderBreadcrumbs();
  renderList();

  try {
    const res = await fetch('/api/list?dir=' + encodeURIComponent(nextDir) + '&page=1&pageSize=' + state.pageSize);
    if (!res.ok) {
      if (nextDir !== state.homeDir) {
        loadDirectory(state.homeDir);
      } else {
        state.isLoadingDirectory = false;
        renderList();
      }
      return;
    }

    const data = await res.json();
    if (token !== state.listRequestToken) return;

    state.currentDir = data.path;
    mergePage(data);
    state.loadedPages.add(1);
    state.loadingPages.clear();
    state.selectedIndex = data.totalEntries > 0 ? 0 : -1;
    state.isLoadingDirectory = false;

    const rel = relativeToHome(state.currentDir);
    localStorage.setItem('audioBrowser_lastDir', rel);
    history.replaceState(null, '', rel ? '#' + rel : '#');
    renderBreadcrumbs();
    renderList();
    scrollToSelected();
    dom.filelist.focus();

    prefetchVisiblePages();
    if (data.hasMore) loadDirectoryPage(2);
  } catch (err) {
    state.isLoadingDirectory = false;
    alert('Failed to load directory: ' + err.message);
  }
}

export async function ensureEntryLoaded(index) {
  if (index < 0 || index >= state.entries.length) return null;
  if (state.entries[index]) return state.entries[index];

  const page = Math.floor(index / state.pageSize) + 1;
  await loadDirectoryPage(page);
  return state.entries[index] || null;
}

export async function openSelected() {
  const entry = await ensureEntryLoaded(state.selectedIndex);
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

  dom.filelist.addEventListener('scroll', () => {
    syncVisibleWindowToScroll();

    clearTimeout(state.scrollPrefetchTimer);
    state.scrollPrefetchTimer = setTimeout(() => {
      state.scrollPrefetchTimer = null;
      prefetchVisiblePages();
    }, 500);
  }, { passive: true });

  window.addEventListener('resize', () => {
    clearTimeout(resizeReloadTimer);
    resizeReloadTimer = setTimeout(() => {
      resizeReloadTimer = null;
      if (!state.currentDir) return;
      if (syncPageSize()) loadDirectory(state.currentDir);
    }, 150);
  });
}
