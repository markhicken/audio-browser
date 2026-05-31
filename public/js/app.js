import { state, dom } from './state.js';
import { loadDirectory, initBreadcrumbEvents } from './navigation.js';
import { initFileListEvents } from './filelist.js';
import { initTransport, stopPlayback } from './playback.js';
import { initKeyboard } from './keyboard.js';
import { initContextMenu } from './contextmenu.js';
import { normalizePath } from './utils.js';

// Auto-play persistence
dom.autoplayCb.checked = localStorage.getItem('audioBrowser_autoNext') === 'true';
dom.autoplayCb.addEventListener('change', () => {
  localStorage.setItem('audioBrowser_autoNext', dom.autoplayCb.checked);
});

// Sort persistence
const savedSort = localStorage.getItem('audioBrowser_sort');
const savedOrder = localStorage.getItem('audioBrowser_order');
if (savedSort) state.sort = savedSort;
if (savedOrder) state.order = savedOrder;

// Title click -> home
document.getElementById('app-title').addEventListener('click', () => {
  if (state.homeDir) loadDirectory(state.homeDir);
});

// Back button
dom.backBtn.addEventListener('click', () => {
  if (state.currentHistoryIndex > 0) {
    history.back();
  }
});

// Forward button
dom.forwardBtn.addEventListener('click', () => {
  if (state.currentHistoryIndex < state.historyStack.length - 1) {
    history.forward();
  }
});

let searchDebounce = null;
if (dom.searchInput) {
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = dom.searchInput.value.trim();
      if (state.currentDir) loadDirectory(state.currentDir);
    }, 700);
  });
}

// Navigate when hash changes (manual URL edit, back/forward)
window.addEventListener('hashchange', () => {
  const hash = location.hash ? location.hash.slice(1) : '';
  if (hash) {
    try {
      const decoded = decodeURIComponent(hash);
      // Paths in hash are normalized to forward slashes
      if (decoded !== state.currentDir) loadDirectory(decoded);
    } catch {
      // Invalid hash, ignore
    }
  } else {
    loadDirectory(state.homeDir);
  }
});

// === Batch job modal (shared by normalize + convert) ===
const btnActions = document.getElementById('btn-actions');
const actionsMenu = document.getElementById('actions-menu');
const btnNormalize = document.getElementById('btn-normalize');
const btnConvertWav = document.getElementById('btn-convert-wav');
const btnConvertMp3 = document.getElementById('btn-convert-mp3');
const overlay = document.getElementById('norm-overlay');
const dlgTitle = document.getElementById('norm-title');
const dlgPhase = document.getElementById('norm-phase');
const dlgFile = document.getElementById('norm-file');
const dlgBar = document.getElementById('norm-progress-bar');
const dlgCount = document.getElementById('norm-count');
const dlgResult = document.getElementById('norm-result');
const dlgClose = document.getElementById('norm-close');

const PHASE_LABELS = {
  backup: 'Backing up files',
  analyzing: 'Analyzing peak levels',
  normalizing: 'Applying normalization',
  converting: 'Converting files'
};

const JOB_TITLES = {
  normalize: 'Normalizing Audio Levels',
  convert: 'Converting Files'
};

function showModal(type) {
  dlgTitle.textContent = JOB_TITLES[type] || 'Processing';
  overlay.classList.add('visible');
  btnNormalize.disabled = true;
  btnConvertWav.disabled = true;
  btnConvertMp3.disabled = true;
  btnActions.disabled = true;
}

function hideModal() {
  overlay.classList.remove('visible');
  btnNormalize.disabled = false;
  btnConvertWav.disabled = false;
  btnConvertMp3.disabled = false;
  btnActions.disabled = false;
  state.isApiLoading = false;
}

const convertConfirmOverlay = document.getElementById('convert-confirm-overlay');
const convertConfirmMessage = document.getElementById('convert-confirm-message');
const convertKeepOriginals = document.getElementById('convert-keep-originals');
const convertBackupFiles = document.getElementById('convert-backup-files');
const convertKeepLabel = document.getElementById('convert-keep-label');
const convertBackupLabel = document.getElementById('convert-backup-label');
const convertConfirmOk = document.getElementById('convert-confirm-ok');
const convertConfirmCancel = document.getElementById('convert-confirm-cancel');

function showActionConfirm(message, options = {}) {
  return new Promise(resolve => {
    convertConfirmMessage.textContent = message;
    convertKeepLabel.hidden = !options.showKeepOption;
    convertBackupLabel.hidden = !options.showBackupOption;
    convertKeepOriginals.checked = true;
    convertBackupFiles.checked = true;
    convertConfirmOverlay.classList.add('visible');

    function cleanup() {
      convertConfirmOverlay.classList.remove('visible');
      convertConfirmOk.removeEventListener('click', onOk);
      convertConfirmCancel.removeEventListener('click', onCancel);
    }
    function onOk() {
      cleanup();
      resolve({
        confirmed: true,
        keepOriginals: options.showKeepOption ? convertKeepOriginals.checked : false,
        backupFiles: options.showBackupOption ? convertBackupFiles.checked : false,
      });
    }
    function onCancel() {
      cleanup();
      resolve({ confirmed: false });
    }
    convertConfirmOk.addEventListener('click', onOk);
    convertConfirmCancel.addEventListener('click', onCancel);
  });
}

let _modalResultShouldReload = false;
let _jobRunning = false;

function showCancelButton() {
  _jobRunning = true;
  dlgClose.textContent = 'Cancel';
  dlgClose.disabled = false;
  dlgClose.hidden = false;
}

dlgClose.addEventListener('click', async () => {
  if (_jobRunning) {
    dlgClose.disabled = true;
    dlgClose.textContent = 'Cancelling…';
    try { await fetch('/api/cancel-job', { method: 'POST' }); } catch {}
    return;
  }
  _modalResultShouldReload = false;
  dlgResult.hidden = true;
  dlgClose.hidden = true;
  dlgResult.textContent = '';
  dlgClose.disabled = false;
  hideModal();
});

function showModalResult(data, shouldReload = false) {
  _jobRunning = false;
  _modalResultShouldReload = shouldReload;
  let text = '';

  if (data.cancelled) {
    hideModal();
    if (shouldReload) loadDirectory(state.currentDir);
    return;
  } else if (data.error) {
    dlgPhase.textContent = 'Failed';
    text = data.error;
  } else if (data.results) {
    const failed = data.results.filter(r => !r.ok);
    const skipped = data.results.filter(r => r.ok && r.skipped);
    const succeeded = data.results.filter(r => r.ok && !r.skipped);
    const label = data.type === 'convert' ? 'Converted' : 'Normalized';

    dlgPhase.textContent = failed.length > 0 ? 'Completed with errors' : 'Complete';

    const parts = [];
    if (succeeded.length > 0) parts.push(`${label} ${succeeded.length} file${succeeded.length !== 1 ? 's' : ''}`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);
    text = parts.join(', ') + '.';

    if (failed.length > 0) {
      text += '\n' + failed.map(f => `${f.name}: ${f.error}`).join('\n');
    }
  }

  dlgFile.textContent = '';
  dlgResult.textContent = text;
  dlgResult.hidden = false;
  dlgClose.textContent = 'Close';
  dlgClose.disabled = false;
  dlgClose.hidden = false;

  if (shouldReload) loadDirectory(state.currentDir);
}

function updateProgress(data) {
  dlgPhase.textContent = PHASE_LABELS[data.phase] || data.phase;
  dlgFile.textContent = data.currentFile || '';
  const pct = data.total > 0 ? (data.current / data.total) * 100 : 0;
  dlgBar.style.width = pct + '%';
  dlgCount.textContent = data.current + ' / ' + data.total;
}

async function pollJobStatus(jobType) {
  while (true) {
    try {
      const res = await fetch('/api/job-status');
      const data = await res.json();

      if (!data.active) {
        showModalResult(data, true);
        return;
      }

      dlgTitle.textContent = JOB_TITLES[data.type] || 'Processing';
      updateProgress(data);
    } catch {}

    await new Promise(r => setTimeout(r, 500));
  }
}

async function startBatchJob(endpoint, type, confirmMsg, options = {}) {
  const fileCount = state.entryCounts.files;

  const result = await showActionConfirm(confirmMsg, options);
  if (!result.confirmed) return;

  if (fileCount === 0) {
    showModal(type);
    showModalResult({ error: 'No audio files in this folder.' });
    return;
  }

  stopPlayback();
  showModal(type);
  showCancelButton();
  state.isApiLoading = true;
  updateProgress({ phase: 'backup', currentFile: '', current: 0, total: fileCount });

  try {
    let url = endpoint + '?dir=' + encodeURIComponent(state.currentDir);
    if (options.showKeepOption) url += '&keepOriginals=' + result.keepOriginals + '&backup=' + result.backupFiles;
    else if (options.showBackupOption) url += '&backup=' + result.backupFiles;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      showModalResult({ error: data.error || 'Operation failed' });
      return;
    }

    pollJobStatus(type);
  } catch (err) {
    showModalResult({ error: 'Operation failed: ' + err.message });
  }
}

// Actions dropdown toggle
btnActions.addEventListener('click', (e) => {
  e.stopPropagation();
  actionsMenu.classList.toggle('visible');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#actions-dropdown')) {
    actionsMenu.classList.remove('visible');
  }
});
actionsMenu.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    actionsMenu.classList.remove('visible');
  }
});

// Normalize button
btnNormalize.addEventListener('click', () => {
  const count = state.entryCounts.files;
  startBatchJob('/api/normalize', 'normalize',
    `Normalize levels for ${count} file${count !== 1 ? 's' : ''} in this folder?\n\nThis may take a while for many files.`,
    { showBackupOption: true }
  );
});

// Convert to WAV button
btnConvertWav.addEventListener('click', () => {
  startBatchJob('/api/convert-wav', 'convert',
    `Convert all non-WAV files in this folder to WAV format?\n\nIf keeping originals is disabled, they will be backed up to a timestamped subfolder before removal.`,
    { showKeepOption: true, showBackupOption: true }
  );
});

// Convert to MP3 button
btnConvertMp3.addEventListener('click', () => {
  startBatchJob('/api/convert-mp3', 'convert',
    `Convert all non-MP3 files in this folder to MP3 format (320k CBR)?\n\nIf keeping originals is disabled, they will be backed up to a timestamped subfolder before removal.`,
    { showKeepOption: true, showBackupOption: true }
  );
});

// Drag-and-drop folder navigation
const dragOverlay = document.getElementById('drag-overlay');
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dragOverlay.classList.add('visible');
});

document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dragOverlay.classList.remove('visible');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dragOverlay.classList.remove('visible');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  // file.path is Electron-specific — full OS path
  const filePath = file.path;
  if (!filePath) return;

  // Check if it's a directory via webkitGetAsEntry, fall back to navigating directly
  const entry = e.dataTransfer.items[0]?.webkitGetAsEntry?.();
  if (entry && entry.isFile) return; // ignore file drops

  loadDirectory(normalizePath(filePath));
});

// Open in Explorer/Finder button
document.getElementById('btn-open-folder').addEventListener('click', async () => {
  if (!state.currentDir) return;
  try {
    const res = await fetch('/api/open-folder?dir=' + encodeURIComponent(state.currentDir), { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      alert('Could not open folder: ' + data.error);
    }
  } catch (err) {
    alert('Could not open folder: ' + err.message);
  }
});

// Wire up all event handlers
initBreadcrumbEvents();
initFileListEvents();
initTransport();
initKeyboard();
initContextMenu();

async function loadAppVersion() {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const data = await res.json();
    const el = document.getElementById('app-version');
    if (el && data.version) {
      el.textContent = `v${data.version}`;
    }
  } catch {
    // ignore if version endpoint is unavailable
  }
}

loadAppVersion();

// Boot
async function init() {
  const res = await fetch('/api/home');
  const data = await res.json();
  state.ffmpegAvailable = data.ffmpeg;
  state.homeDir = normalizePath(data.home);

  if (!state.ffmpegAvailable) {
    dom.warning.innerHTML = 'ffmpeg not found. Some files will not play or convert properly. <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener">Install ffmpeg</a> to enable full format support.';
    dom.warning.style.display = 'block';
  }

  // Check if a batch job is already running (page refresh)
  try {
    const statusRes = await fetch('/api/job-status');
    const statusData = await statusRes.json();
    if (statusData.active) {
      showModal(statusData.type);
      showCancelButton();
      updateProgress(statusData);
      pollJobStatus(statusData.type);
    }
  } catch {}

  const hashPath = location.hash ? location.hash.slice(1) : '';
  let savedPath = hashPath || localStorage.getItem('audioBrowser_lastDir') || '';
  
  // Paths in hash/storage are normalized to forward slashes
  if (savedPath) {
    try {
      savedPath = decodeURIComponent(savedPath);
    } catch {
      savedPath = state.homeDir;
    }
  }
  
  loadDirectory(savedPath || state.homeDir);
}

init();
