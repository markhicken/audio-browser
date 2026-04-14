import { state, dom } from './state.js';
import { escPath, resolvePath } from './utils.js';
import { renderList, scrollToSelected, prefetchVisiblePages, syncVisibleWindowToScroll, rerenderVisibleWindow } from './filelist.js';

const ROW_HEIGHT = 32;
let resizeReloadTimer = null;

// Get path for URL hash (convert backslashes to forward slashes for clean URLs)
function pathToHash(absPath) {
  return absPath.replace(/\\/g, '/');
}

// Convert a hash back to an absolute path
export function hashToAbsolute(hash) {
  if (!hash) return state.homeDir;
  try {
    const decoded = decodeURIComponent(hash);
    // Preserve the separator style from current directory
    const origSep = state.homeDir.includes('\\') ? '\\' : '/';
    return decoded.replace(/\//g, origSep);
  } catch {
    return state.homeDir;
  }
}

export function renderBreadcrumbs() {
  const current = state.currentDir;
  
  // Special case: drives list view
  if (current === '///drives') {
    dom.breadcrumbs.innerHTML = '<span data-path="">Drives</span>';
    return;
  }
  
  // Detect path separator and normalize
  const isWindows = current.includes('\\');
  const normalized = isWindows ? current : current.replace(/\\/g, '/');
  const separator = isWindows ? '\\' : '/';
  
  // Check if we're at a Windows drive root (C:\, D:\, etc)
  const isAtDriveRoot = isWindows && /^[a-z]:\\$/i.test(current);
  
  // Split and filter empty parts
  const parts = normalized.split(separator).filter((p, i) => p || i === 0);
  
  // Use "Drives" for Windows drive roots, otherwise use "Drives"
  let html = `<span data-path="">Drives</span>`;
  let accumulatedPath = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue; // Skip empty parts except first
    
    html += '<span class="sep">&rsaquo;</span>';
    
    if (i === 0) {
      // First part (drive letter on Windows or root "/" on Unix)
      accumulatedPath = part + (isWindows ? '\\' : '/');
    } else {
      accumulatedPath += part + separator;
    }
    
    // Remove trailing separator, then convert to forward-slash format for URL
    const pathToStore = accumulatedPath.replace(/[\\\/]$/, '');
    const forUrl = pathToStore.replace(/\\/g, '/');
    html += `<span data-path="${forUrl}">${part}</span>`;
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
  if (data.pageSize) {
    state.pageSize = data.pageSize;
  }
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
  // Only render if this page is in the visible window
  if (page >= state.visiblePageStart && page <= state.visiblePageEnd) {
    rerenderVisibleWindow();
  }

  const token = state.listRequestToken;

  try {
    const res = await fetch('/api/list?dir=' + encodeURIComponent(state.currentDir) +
      '&page=' + page +
      '&pageSize=' + state.pageSize +
      '&sort=' + state.sort +
      '&order=' + state.order);
    if (!res.ok) {
      state.loadingPages.delete(page);
      if (page >= state.visiblePageStart && page <= state.visiblePageEnd) {
        rerenderVisibleWindow();
      }
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
    // Only render if this page is in the visible window
    if (page >= state.visiblePageStart && page <= state.visiblePageEnd) {
      rerenderVisibleWindow();
    }
  } catch {
    state.loadingPages.delete(page);
    if (page >= state.visiblePageStart && page <= state.visiblePageEnd) {
      rerenderVisibleWindow();
    }
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
    const res = await fetch('/api/list?dir=' + encodeURIComponent(nextDir) + 
      '&page=1&pageSize=' + state.pageSize +
      '&sort=' + state.sort +
      '&order=' + state.order);
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

    const hashPath = pathToHash(state.currentDir);
    localStorage.setItem('audioBrowser_lastDir', hashPath);
    
    // Use replaceState for initial load, pushState for subsequent navigation
    if (state.isInitialLoad) {
      history.replaceState(null, '', '#' + hashPath);
      state.isInitialLoad = false;
    } else {
      history.pushState(null, '', '#' + hashPath);
    }
    
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

  // Special case: navigating from drives list
  if (state.currentDir === '///drives') {
    // entry.name is like "C:" - convert to "C:\"
    loadDirectory(entry.name + '\\');
    return;
  }

  if (entry.name === '..') {
    const sep = state.currentDir.includes('\\') ? '\\' : '/';
    
    // Special case: if at a Windows drive root, navigate to drives list
    if (sep === '\\' && /^[a-z]:\\$/i.test(state.currentDir)) {
      loadDirectory('///drives');
      return;
    }
    
    let parent = state.currentDir.substring(0, state.currentDir.lastIndexOf(sep))
      || (sep === '/' ? '/' : state.currentDir.substring(0, 3));
    
    // Ensure Windows drive letters have a trailing backslash (e.g., "C:" -> "C:\")
    if (sep === '\\' && /^[a-z]:$/i.test(parent)) {
      parent += '\\';
    }
    
    loadDirectory(parent);
  } else {
    loadDirectory(resolvePath(entry.name));
  }
}

// Breadcrumb click delegation
export function initBreadcrumbEvents() {
  dom.breadcrumbs.addEventListener('click', (e) => {
    const span = e.target.closest('span[data-path]');
    if (span) {
      try {
        const path = span.dataset.path;
        if (!path) {
          // Drives clicked - navigate to drives list
          loadDirectory('///drives');
        } else {
          // Convert forward slashes back to backslashes if needed
          const origSep = state.homeDir.includes('\\') ? '\\' : '/';
          const absPath = path.replace(/\//g, origSep);
          loadDirectory(absPath);
        }
      } catch {
        loadDirectory(state.homeDir);
      }
    }
  });

  dom.filelist.addEventListener('scroll', () => {
    syncVisibleWindowToScroll();

    clearTimeout(state.scrollPrefetchTimer);
    state.scrollPrefetchTimer = setTimeout(() => {
      state.scrollPrefetchTimer = null;
      prefetchVisiblePages();
    }, 200);
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
