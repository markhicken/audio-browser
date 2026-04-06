import { state, dom } from './state.js';
import { loadDirectory, hashToAbsolute, initBreadcrumbEvents } from './navigation.js';
import { initFileListEvents } from './filelist.js';
import { initTransport, stopPlayback } from './playback.js';
import { initKeyboard } from './keyboard.js';
import { initContextMenu } from './contextmenu.js';

// Auto-play persistence
dom.autoplayCb.checked = localStorage.getItem('audioBrowser_autoNext') === 'true';
dom.autoplayCb.addEventListener('change', () => {
  localStorage.setItem('audioBrowser_autoNext', dom.autoplayCb.checked);
});

// Title click -> home
document.getElementById('app-title').addEventListener('click', () => {
  if (state.homeDir) loadDirectory(state.homeDir);
});

// Navigate when hash changes (manual URL edit, back/forward)
window.addEventListener('hashchange', () => {
  const rel = location.hash ? location.hash.slice(1) : '';
  const abs = hashToAbsolute(rel);
  if (abs !== state.currentDir) loadDirectory(abs);
});

// === Batch job modal (shared by normalize + convert) ===
const btnNormalize = document.getElementById('btn-normalize');
const btnConvertWav = document.getElementById('btn-convert-wav');
const overlay = document.getElementById('norm-overlay');
const dlgTitle = document.getElementById('norm-title');
const dlgPhase = document.getElementById('norm-phase');
const dlgFile = document.getElementById('norm-file');
const dlgBar = document.getElementById('norm-progress-bar');
const dlgCount = document.getElementById('norm-count');

const PHASE_LABELS = {
  backup: 'Backing up files',
  analyzing: 'Analyzing peak levels',
  normalizing: 'Applying normalization',
  converting: 'Converting to WAV'
};

const JOB_TITLES = {
  normalize: 'Normalizing Audio Levels',
  convert: 'Converting to WAV'
};

function showModal(type) {
  dlgTitle.textContent = JOB_TITLES[type] || 'Processing';
  overlay.classList.add('visible');
  btnNormalize.disabled = true;
  btnConvertWav.disabled = true;
}

function hideModal() {
  overlay.classList.remove('visible');
  btnNormalize.disabled = false;
  btnConvertWav.disabled = false;
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
        hideModal();

        if (data.error) {
          alert('Operation failed: ' + data.error);
        } else if (data.results) {
          const failed = data.results.filter(r => !r.ok);
          const total = data.results.length;
          const label = data.type === 'convert' ? 'Converted' : 'Normalized';
          if (failed.length > 0) {
            alert(`${label} with ${failed.length} error(s):\n` + failed.map(f => f.name + ': ' + f.error).join('\n'));
          } else {
            alert(`${label} ${total} file(s).`);
          }
        }

        loadDirectory(state.currentDir);
        return;
      }

      dlgTitle.textContent = JOB_TITLES[data.type] || 'Processing';
      updateProgress(data);
    } catch {}

    await new Promise(r => setTimeout(r, 500));
  }
}

async function startBatchJob(endpoint, type, confirmMsg) {
  const fileCount = state.entryCounts.files;
  if (fileCount === 0) {
    alert('No audio files in this folder.');
    return;
  }

  if (!confirm(confirmMsg)) return;

  stopPlayback();
  showModal(type);
  updateProgress({ phase: 'backup', currentFile: '', current: 0, total: fileCount });

  try {
    const res = await fetch(endpoint + '?dir=' + encodeURIComponent(state.currentDir), { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      hideModal();
      alert('Operation failed: ' + data.error);
      return;
    }

    pollJobStatus(type);
  } catch (err) {
    hideModal();
    alert('Operation failed: ' + err.message);
  }
}

// Normalize button
btnNormalize.addEventListener('click', () => {
  const count = state.entryCounts.files;
  startBatchJob('/api/normalize', 'normalize',
    `Normalize levels for ${count} file${count !== 1 ? 's' : ''} in this folder?\n\n` +
    `Originals will be backed up to a timestamped subfolder.\n\n` +
    `This may take a while for many files.`
  );
});

// Convert to WAV button
btnConvertWav.addEventListener('click', () => {
  startBatchJob('/api/convert-wav', 'convert',
    `Convert all non-WAV files in this folder to WAV format?\n\n` +
    `Originals will be backed up to a timestamped subfolder.\n` +
    `Original non-WAV files will be removed after conversion.`
  );
});

// Wire up all event handlers
initBreadcrumbEvents();
initFileListEvents();
initTransport();
initKeyboard();
initContextMenu();

// Boot
async function init() {
  const res = await fetch('/api/home');
  const data = await res.json();
  state.ffmpegAvailable = data.ffmpeg;
  state.homeDir = data.home;

  if (!state.ffmpegAvailable) {
    dom.warning.textContent = 'ffmpeg not found. AIFF and WMA files cannot be played. Install ffmpeg to enable full format support.';
    dom.warning.style.display = 'block';
  }

  // Check if a batch job is already running (page refresh)
  try {
    const statusRes = await fetch('/api/job-status');
    const statusData = await statusRes.json();
    if (statusData.active) {
      showModal(statusData.type);
      updateProgress(statusData);
      pollJobStatus(statusData.type);
    }
  } catch {}

  const hashRel = location.hash ? location.hash.slice(1) : '';
  const savedRel = hashRel || localStorage.getItem('audioBrowser_lastDir') || '';
  loadDirectory(hashToAbsolute(savedRel));
}

init();
