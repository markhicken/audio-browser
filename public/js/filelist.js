import { state, dom } from './state.js';
import { fmtSize, fmtTime, escHtml, resolvePath } from './utils.js';
import { playFile, stopPlayback } from './playback.js';
import { ensureEntryLoaded, loadDirectoryPage, loadDirectory } from './navigation.js';

const ROW_HEIGHT = 32;
const PAGE_WINDOW_RADIUS = 1; // Number of pages to load before/after visible page

function getFileCount() {
  return state.entryCounts.files || state.entries.filter(e => e?.type === 'file').length;
}

function getFolderCount() {
  return state.entryCounts.folders || state.entries.filter(e => e?.type === 'folder' && e.name !== '..').length;
}

function getTotalPages() {
  return Math.max(1, Math.ceil(state.totalEntries / state.pageSize));
}

function getPageRangeForScroll(scrollTop = dom.filelist.scrollTop) {
  const firstVisiblePage = Math.floor(scrollTop / (ROW_HEIGHT * state.pageSize)) + 1;
  const totalPages = getTotalPages();
  const start = Math.max(1, firstVisiblePage - PAGE_WINDOW_RADIUS);
  const end = Math.min(totalPages, firstVisiblePage + PAGE_WINDOW_RADIUS);
  return { start, end };
}

function getPageRangeForIndex(index) {
  if (index < 0) return { start: 1, end: Math.min(getTotalPages(), 2) };
  const page = Math.floor(index / state.pageSize) + 1;
  const totalPages = getTotalPages();
  return {
    start: Math.max(1, page - PAGE_WINDOW_RADIUS),
    end: Math.min(totalPages, page + PAGE_WINDOW_RADIUS)
  };
}

function renderWindow(startPage, endPage) {
  state.visiblePageStart = startPage;
  state.visiblePageEnd = endPage;

  const startIndex = (startPage - 1) * state.pageSize;
  const endIndex = Math.min(state.totalEntries, endPage * state.pageSize);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (state.totalEntries - endIndex) * ROW_HEIGHT);

  let rowsHtml = '';
  for (let page = startPage; page <= endPage; page++) {
    const pageStart = (page - 1) * state.pageSize;
    const pageEnd = Math.min(pageStart + state.pageSize, state.totalEntries);
    if (state.loadedPages.has(page)) {
      for (let index = pageStart; index < pageEnd; index++) {
        const entry = state.entries[index];
        if (entry) rowsHtml += createRowHtml(entry, index);
      }
    } else {
      rowsHtml += createPlaceholderRows(pageStart, pageEnd);
    }
  }

  dom.filelist.innerHTML = `<div class="list-spacer" style="height:${topSpacer}px"></div>${rowsHtml}<div class="list-spacer" style="height:${bottomSpacer}px"></div>`;
}

export function updateLoadProgress() {
  const spinner = dom.loadingSpinner;
  if (!spinner) return;

  const isLoading = state.isLoadingDirectory || state.loadingPages.size > 0;
  spinner.hidden = !isLoading;
  
  // Update search spinner visibility
  dom.searchSpinner.hidden = !(state.isApiLoading || state.loadingPages.size > 0);
}

export function rerenderVisibleWindow() {
  if (state.totalEntries === 0) {
    renderList();
    return;
  }
  const range = getPageRangeForScroll();
  renderWindow(range.start, range.end);
  updateLoadProgress();
}

function createRowHtml(entry, index) {
  const isSelected = index === state.selectedIndex;
  const isPlaying = state.playingFile && entry.type === 'file' && resolvePath(entry.name) === state.playingFile;
  const classes = ['row'];
  if (isSelected) classes.push('selected');
  if (isPlaying) classes.push('playing');

  const icon = entry.type === 'folder'
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.8.4L4.5 11H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5L8.7 2.1A.5.5 0 0 1 9 2.5z"/><path d="M11.3 4.7a.5.5 0 0 1 .7 0 5 5 0 0 1 0 6.6.5.5 0 0 1-.7-.7 4 4 0 0 0 0-5.2.5.5 0 0 1 0-.7z"/></svg>';
  const badge = entry.type === 'folder'
    ? '<span class="row-badge badge-folder">folder</span>'
    : `<span class="row-badge badge-${entry.ext}">${entry.ext}</span>`;
  const dur = entry.type === 'file'
    ? `<span class="row-duration" data-index="${index}">${entry.duration != null ? fmtTime(entry.duration) : ''}</span>`
    : '<span class="row-duration"></span>';
  const size = entry.type === 'file' ? `<span class="row-size">${fmtSize(entry.size)}</span>` : '<span class="row-size"></span>';

  return `<div class="${classes.join(' ')}" data-index="${index}">
    <span class="row-icon">${icon}</span>
    <span class="row-name">${escHtml(entry.name)}</span>
    ${badge}${dur}${size}
  </div>`;
}

function createPlaceholderRows(start, end) {
  let html = '';
  for (let index = start; index < end; index++) {
    html += `<div class="row row-placeholder" data-index="${index}">
      <span class="row-icon"></span>
      <span class="row-name">Loading...</span>
      <span class="row-badge"></span>
      <span class="row-duration"></span>
      <span class="row-size"></span>
    </div>`;
  }
  return html;
}

export function updateFileCount() {
  const files = getFileCount();
  const folders = getFolderCount();
  const parts = [];
  if (files) parts.push(files + ' file' + (files !== 1 ? 's' : ''));
  if (folders) parts.push(folders + ' folder' + (folders !== 1 ? 's' : ''));
  dom.fileCount.textContent = parts.join(', ') || 'Empty folder';
}

export function renderList() {
  updateFileCount();
  updateLoadProgress();
  
  // Show directory error if present
  if (state.directoryError) {
    dom.filelist.style.display = 'none';
    dom.empty.style.display = 'flex';
    dom.emptyText.textContent = '';
    dom.loadingProgress.hidden = true;
    dom.empty.innerHTML = `
      <div style="text-align: center;">
        <div style="margin-bottom: 10px; color: #ff6b6b;">${escHtml(state.directoryError.message)}</div>
        <div>
          <button class="error-link" data-action="go-home" style="color: #007acc; background: none; border: none; cursor: pointer; text-decoration: underline;">Go to Home</button>
          ${state.homeDir !== '///drives' ? ' | <button class="error-link" data-action="go-drives" style="color: #007acc; background: none; border: none; cursor: pointer; text-decoration: underline;">Go to Drives</button>' : ''}
        </div>
      </div>
    `;
    
    // Add event listeners for the error links
    const errorLinks = dom.empty.querySelectorAll('.error-link');
    errorLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'go-home') {
          loadDirectory(state.homeDir);
        } else if (action === 'go-drives') {
          loadDirectory('///drives');
        }
      });
    });
    
    return;
  }
  
  if (state.totalEntries === 0) {
    if (state.isLoadingDirectory) {
      // Still loading - show spinner and keep filelist visible for initial viewport population
      dom.filelist.style.display = '';
      dom.empty.style.display = 'none';
      return;
    }
    dom.emptyText.textContent = 'No audio files in this folder';
    dom.filelist.style.display = 'none';
    dom.empty.style.display = 'flex';
    return;
  }

  dom.empty.textContent = 'No audio files in this folder';
  dom.filelist.style.display = '';
  dom.empty.style.display = 'none';
  const range = getPageRangeForIndex(state.selectedIndex);
  renderWindow(range.start, range.end);
}

export function updateSelectedRow(previousIndex, nextIndex) {
  if (previousIndex >= 0) {
    const prev = dom.filelist.querySelector(`.row.selected[data-index="${previousIndex}"]`);
    if (prev) prev.classList.remove('selected');
  }
  if (nextIndex >= 0) {
    const next = dom.filelist.querySelector(`.row[data-index="${nextIndex}"]`);
    if (next) next.classList.add('selected');
  }
}

export function updatePlayingRow(previousPath, nextPath) {
  if (previousPath) {
    const prev = dom.filelist.querySelector('.row.playing');
    if (prev) prev.classList.remove('playing');
  }

  if (nextPath) {
    const entry = state.entries[state.selectedIndex];
    if (entry && entry.type === 'file' && resolvePath(entry.name) === nextPath) {
      const next = dom.filelist.querySelector(`.row[data-index="${state.selectedIndex}"]`);
      if (next) next.classList.add('playing');
      return;
    }

    for (let i = state.visiblePageStart - 1; i < state.visiblePageEnd; i++) {
      const pageStart = i * state.pageSize;
      const pageEnd = Math.min(pageStart + state.pageSize, state.entries.length);
      for (let index = pageStart; index < pageEnd; index++) {
        const rowEntry = state.entries[index];
        if (rowEntry && rowEntry.type === 'file' && resolvePath(rowEntry.name) === nextPath) {
          const row = dom.filelist.querySelector(`.row[data-index="${index}"]`);
          if (row) row.classList.add('playing');
          return;
        }
      }
    }
  }
}

export function ensureIndexVisible(index) {
  if (index < 0) return;

  const viewTop = dom.filelist.scrollTop;
  const viewBottom = viewTop + dom.filelist.clientHeight;
  const rowTop = index * ROW_HEIGHT;
  const rowBottom = rowTop + ROW_HEIGHT;

  if (rowTop < viewTop) {
    dom.filelist.scrollTop = rowTop;
  } else if (rowBottom > viewBottom) {
    dom.filelist.scrollTop = rowBottom - dom.filelist.clientHeight;
  }
}

export function scrollToSelected() {
  if (state.selectedIndex < 0) return;
  ensureIndexVisible(state.selectedIndex);

  const row = dom.filelist.querySelector(`.row[data-index="${state.selectedIndex}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

export function syncVisibleWindowToScroll() {
  const scrollTop = dom.filelist.scrollTop;
  const scrollRange = getPageRangeForScroll(scrollTop);

  if (scrollRange.start !== state.visiblePageStart || scrollRange.end !== state.visiblePageEnd) {
    // Check if any visible page is not loaded - show loading indicator instead of blank space
    let hasUnloadedVisiblePage = false;
    for (let p = scrollRange.start; p <= scrollRange.end; p++) {
      if (!state.loadedPages.has(p)) {
        hasUnloadedVisiblePage = true;
        break;
      }
    }

    // Only re-render if we have content or are loading visible pages
    if (hasUnloadedVisiblePage || state.loadingPages.size > 0) {
      renderWindow(scrollRange.start, scrollRange.end);
    } else {
      // Just update the visible page range without re-rendering
      state.visiblePageStart = scrollRange.start;
      state.visiblePageEnd = scrollRange.end;
    }

    // Debounced prefetch - only trigger after scrolling stops
    clearTimeout(state.scrollPrefetchTimer);
    state.scrollPrefetchTimer = setTimeout(() => {
      state.scrollPrefetchTimer = null;
      for (let p = scrollRange.start; p <= scrollRange.end; p++) {
        if (!state.loadedPages.has(p) && !state.loadingPages.has(p)) {
          loadDirectoryPage(p);
        }
      }
    }, 200);
  }
}

export async function prefetchVisiblePages() {
  const { start, end } = getPageRangeForScroll();

  for (let page = start; page <= end; page++) {
    if (!state.loadedPages.has(page) && !state.loadingPages.has(page)) {
      loadDirectoryPage(page);
    }
  }
}

async function setSelectedIndex(index, shouldPlay) {
  if (index < 0 || index >= state.totalEntries) return;

  const previousIndex = state.selectedIndex;
  state.selectedIndex = index;
  await ensureEntryLoaded(index);

  const range = getPageRangeForIndex(index);
  const needsRerender = index < state.visiblePageStart * state.pageSize - state.pageSize ||
    index >= state.visiblePageEnd * state.pageSize ||
    range.start !== state.visiblePageStart ||
    range.end !== state.visiblePageEnd;

  if (needsRerender) {
    renderList();
  } else {
    updateSelectedRow(previousIndex, index);
  }

  scrollToSelected();
  prefetchVisiblePages();

  const entry = state.entries[index];
  if (!entry || entry.type === 'folder') {
    clearTimeout(state.playTimeout);
    return;
  }

  if (shouldPlay === 'immediate') {
    playFile(entry, index);
    return;
  }

  if (shouldPlay === 'debounced') {
    clearTimeout(state.playTimeout);
    state.playTimeout = setTimeout(() => playFile(entry, index), 150);
  }
}

export async function selectRow(index) {
  await setSelectedIndex(index, 'immediate');
}

export async function activateRow(index) {
  const entry = state.entries[index];
  if (!entry || entry.type !== 'folder') return;

  // Navigate immediately, don't wait for page load
  import('./navigation.js').then(m => m.loadDirectory(resolvePath(entry.name)));
}

export async function selectWithDebounce(index) {
  await setSelectedIndex(index, 'debounced');
}

export async function focusRow(index) {
  await setSelectedIndex(index, null);
}

export async function deleteSelected() {
  const entry = await ensureEntryLoaded(state.selectedIndex);
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
    state.totalEntries -= 1;
    state.entryCounts.files = Math.max(0, state.entryCounts.files - 1);
    if (state.selectedIndex >= state.totalEntries) state.selectedIndex = state.totalEntries - 1;

    const loadedPages = new Set();
    const totalPages = getTotalPages();
    for (const page of state.loadedPages) {
      if (page <= totalPages) loadedPages.add(page);
    }
    state.loadedPages = loadedPages;

    renderList();
    scrollToSelected();
    dom.filelist.focus();
    prefetchVisiblePages();
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
    if (!row || row.classList.contains('row-placeholder')) return;
    const index = parseInt(row.dataset.index, 10);
    const now = Date.now();

    if (index === lastClickIndex && now - lastClickTime < 400) {
      lastClickIndex = -1;
      activateRow(index);
    } else {
      lastClickIndex = index;
      lastClickTime = now;
      selectRow(index);
    }
  });

  const header = document.getElementById('list-header');
  if (header) {
    updateSortIndicators();
    header.addEventListener('click', (e) => {
      const sortable = e.target.closest('.sortable');
      if (!sortable) return;
      const sortBy = sortable.dataset.sort;
      if (state.sort === sortBy) {
        state.order = state.order === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = sortBy;
        state.order = 'asc';
      }
      localStorage.setItem('audioBrowser_sort', state.sort);
      localStorage.setItem('audioBrowser_order', state.order);
      updateSortIndicators();
      import('./navigation.js').then(m => m.loadDirectory(state.currentDir));
    });
  }
}

export function updateSortIndicators() {
  const header = document.getElementById('list-header');
  if (!header) return;
  const sortables = header.querySelectorAll('.sortable');
  sortables.forEach(el => {
    const indicator = el.querySelector('.sort-indicator');
    if (el.dataset.sort === state.sort) {
      indicator.innerHTML = state.order === 'asc' ? '&#8593;' : '&#8595;';
      el.style.color = 'var(--text-primary)';
    } else {
      indicator.innerHTML = '';
      el.style.color = '';
    }
  });
}
