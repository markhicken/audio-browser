const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = 3000;

// Audio extensions we support
const AUDIO_EXTS = new Set([
  '.wav', '.mp3', '.aiff', '.aif', '.flac', '.ogg',
  '.m4a', '.aac', '.wma', '.opus', '.ape', '.wv'
]);

// Extensions that need ffmpeg transcoding (not natively supported by browsers)
const NEEDS_TRANSCODE = new Set(['.aiff', '.aif', '.wma', '.ape', '.wv']);

// MIME types for direct-serve formats
const MIME_TYPES = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg'
};

const HOME = os.homedir();

// Check ffmpeg availability
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch {
  console.warn('ffmpeg not found - AIFF/WMA files will not be playable');
}

// Return home directory and server info
app.get('/api/home', (req, res) => {
  res.json({ home: os.homedir(), ffmpeg: ffmpegAvailable });
});

function probeDuration(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) {
      resolve(null);
      return;
    }

    const probe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let out = '';
    probe.stdout.on('data', (d) => { out += d; });
    probe.on('error', () => resolve(null));
    probe.on('close', () => {
      try {
        const info = JSON.parse(out);
        resolve(parseFloat(info.format.duration) || null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// List directory contents
app.get('/api/list', async (req, res) => {
  const dir = req.query.dir;
  if (!dir) return res.status(400).json({ error: 'dir parameter required' });
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const requestedPageSize = parseInt(req.query.pageSize, 10) || 200;
  const pageSize = Math.min(Math.max(requestedPageSize, 25), 500);

  const resolved = path.resolve(dir);

  if (!resolved.startsWith(HOME)) {
    return res.status(403).json({ error: 'Access restricted to home folder' });
  }

  let dirEntries;
  try {
    dirEntries = await fs.promises.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    return res.status(403).json({ error: 'Cannot read directory: ' + err.message });
  }

  const folders = [];
  const files = [];

  for (const entry of dirEntries) {
    if (entry.name.startsWith('.')) continue; // skip hidden files

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, type: 'folder' });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTS.has(ext)) {
        files.push({ name: entry.name, type: 'file', ext: ext.slice(1) });
      }
    }
  }

  const cmp = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  folders.sort(cmp);
  files.sort(cmp);

  const entries = [];
  if (resolved !== HOME) {
    entries.push({ name: '..', type: 'folder' });
  }
  entries.push(...folders, ...files);

  const totalEntries = entries.length;
  const start = Math.min((page - 1) * pageSize, totalEntries);
  const pageEntries = entries.slice(start, start + pageSize);

  const hydratedEntries = await mapWithConcurrency(pageEntries, 8, async (entry) => {
    if (entry.type !== 'file') return entry;

    let size = 0;
    try {
      const stat = await fs.promises.stat(path.join(resolved, entry.name));
      size = stat.size;
    } catch {}

    const duration = await probeDuration(path.join(resolved, entry.name));
    return { ...entry, size, duration };
  });

  res.json({
    path: resolved,
    entries: hydratedEntries,
    page,
    pageSize,
    offset: start,
    totalEntries,
    hasMore: start + pageEntries.length < totalEntries,
    counts: {
      files: files.length,
      folders: folders.length
    }
  });
});

// Serve or transcode audio file
app.get('/api/audio', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'file parameter required' });

  const resolved = path.resolve(file);

  if (!resolved.startsWith(HOME)) {
    return res.status(403).json({ error: 'Access restricted to home folder' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = path.extname(resolved).toLowerCase();

  if (NEEDS_TRANSCODE.has(ext)) {
    if (!ffmpegAvailable) {
      return res.status(415).json({ error: 'ffmpeg required for ' + ext + ' files' });
    }

    res.set('Content-Type', 'audio/wav');
    res.set('Transfer-Encoding', 'chunked');

    const ffmpeg = spawn('ffmpeg', [
      '-i', resolved,
      '-f', 'wav',
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    ffmpeg.stdout.pipe(res);

    ffmpeg.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Transcoding failed' });
    });

    // Kill ffmpeg if client disconnects
    req.on('close', () => ffmpeg.kill());
    return;
  }

  // Direct serve
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.sendFile(resolved);
});

// Get audio duration via ffprobe
app.get('/api/duration', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'file parameter required' });
  if (!ffmpegAvailable) return res.json({ duration: null });

  const resolved = path.resolve(file);
  if (!resolved.startsWith(HOME)) return res.status(403).json({ error: 'Access restricted to home folder' });
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  probeDuration(resolved).then(duration => res.json({ duration }));
});

// Delete file (send to recycle bin)
app.delete('/api/file', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'file parameter required' });

  const resolved = path.resolve(file);

  if (!resolved.startsWith(HOME)) {
    return res.status(403).json({ error: 'Access restricted to home folder' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Use PowerShell to send to recycle bin
  const psCmd = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${resolved.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;

  const ps = spawn('powershell', ['-NoProfile', '-Command', psCmd], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  ps.stderr.on('data', (d) => { stderr += d; });

  ps.on('close', (code) => {
    if (code === 0) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to delete: ' + stderr.trim() });
    }
  });
});


// Shared batch operation progress state
const jobState = {
  active: false,
  type: '',   // 'normalize' or 'convert'
  current: 0,
  total: 0,
  currentFile: '',
  phase: '',
  error: null,
  results: null
};

// Get batch job status
app.get('/api/job-status', (req, res) => {
  res.json({ ...jobState });
});

// Generate timestamped backup folder name
function backupDirName(prefix) {
  const now = new Date();
  const ts = now.toISOString().replace(/[T:]/g, '-').replace(/\..+/, '');
  return `${prefix}_${ts}`;
}

// Back up files to a timestamped subfolder, returns backup dir path
async function backupFiles(resolved, audioFiles, prefix) {
  const backupDir = path.join(resolved, backupDirName(prefix));
  await fs.promises.mkdir(backupDir, { recursive: true });
  for (let i = 0; i < audioFiles.length; i++) {
    jobState.current = i + 1;
    jobState.currentFile = audioFiles[i];
    const src = path.join(resolved, audioFiles[i]);
    const dst = path.join(backupDir, audioFiles[i]);
    await fs.promises.copyFile(src, dst);
  }
  return backupDir;
}

// List audio files in a directory
async function listAudioFiles(dirPath) {
  const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return dirEntries
    .filter(e => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name);
}

// Run an ffmpeg command with a timeout, returns stderr
function runFfmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; proc.kill(); reject(new Error('ffmpeg timed out')); }
    }, timeoutMs);
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', err => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
    proc.on('close', code => {
      if (!done) { done = true; clearTimeout(timer); resolve({ code, stderr }); }
    });
  });
}

// Detect peak level of an audio file (returns max_volume in dB)
async function detectPeak(filePath) {
  const { code, stderr } = await runFfmpeg([
    '-i', filePath, '-af', 'volumedetect', '-f', 'null', 'NUL'
  ]);
  const match = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
  if (match) return parseFloat(match[1]);
  throw new Error('Could not detect peak level');
}

// Apply volume adjustment to a file
async function applyGain(inputPath, outputPath, gainDb) {
  const { code, stderr } = await runFfmpeg([
    '-y', '-i', inputPath, '-af', `volume=${gainDb}dB`, outputPath
  ]);
  if (code !== 0) throw new Error(stderr.slice(-200));
}

// Validate and prepare a batch job, returns { resolved, audioFiles } or sends error response
async function prepareBatchJob(req, res) {
  const dir = req.query.dir;
  if (!dir) { res.status(400).json({ error: 'dir parameter required' }); return null; }
  if (!ffmpegAvailable) { res.status(400).json({ error: 'ffmpeg is required' }); return null; }
  if (jobState.active) { res.status(409).json({ error: 'A batch operation is already in progress' }); return null; }

  const resolved = path.resolve(dir);
  if (!resolved.startsWith(HOME)) { res.status(403).json({ error: 'Access restricted to home folder' }); return null; }

  try {
    const audioFiles = await listAudioFiles(resolved);
    if (audioFiles.length === 0) { res.status(400).json({ error: 'No audio files in this folder' }); return null; }
    return { resolved, audioFiles };
  } catch (err) {
    res.status(403).json({ error: 'Cannot read directory: ' + err.message }); return null;
  }
}

function startJob(type, total) {
  jobState.active = true;
  jobState.type = type;
  jobState.current = 0;
  jobState.total = total;
  jobState.currentFile = '';
  jobState.phase = 'backup';
  jobState.error = null;
  jobState.results = null;
}

function finishJob(results, error) {
  jobState.results = results || null;
  jobState.error = error || null;
  jobState.active = false;
  jobState.currentFile = '';
}

// Start normalization (peak-based)
app.post('/api/normalize', async (req, res) => {
  const job = await prepareBatchJob(req, res);
  if (!job) return;
  const { resolved, audioFiles } = job;

  startJob('normalize', audioFiles.length);
  res.json({ started: true, total: audioFiles.length });

  (async () => {
    const TARGET_PEAK = -1.0;
    const results = [];

    try {
      await backupFiles(resolved, audioFiles, 'before_normalization');

      // Pass 1: detect peaks
      jobState.phase = 'analyzing';
      const peaks = [];
      for (let i = 0; i < audioFiles.length; i++) {
        jobState.current = i + 1;
        jobState.currentFile = audioFiles[i];
        try {
          const peak = await detectPeak(path.join(resolved, audioFiles[i]));
          peaks.push({ name: audioFiles[i], peak });
        } catch (err) {
          peaks.push({ name: audioFiles[i], peak: null, error: err.message });
        }
      }

      // Pass 2: apply gain
      jobState.phase = 'normalizing';
      for (let i = 0; i < peaks.length; i++) {
        const { name, peak, error } = peaks[i];
        jobState.current = i + 1;
        jobState.currentFile = name;

        if (peak === null) { results.push({ name, ok: false, error }); continue; }

        const gain = TARGET_PEAK - peak;
        if (Math.abs(gain) < 0.1) { results.push({ name, ok: true, gain: 0 }); continue; }

        const src = path.join(resolved, name);
        const ext = path.extname(name).toLowerCase();
        const tmpFile = src + '.normalized' + ext;

        try {
          await applyGain(src, tmpFile, gain);
          await fs.promises.rename(tmpFile, src);
          results.push({ name, ok: true, gain: Math.round(gain * 10) / 10 });
        } catch (err) {
          try { await fs.promises.unlink(tmpFile); } catch {}
          results.push({ name, ok: false, error: err.message });
        }
      }

      finishJob(results);
    } catch (err) {
      finishJob(null, err.message);
    }
  })();
});

// Convert all files to WAV
app.post('/api/convert-wav', async (req, res) => {
  const job = await prepareBatchJob(req, res);
  if (!job) return;
  const { resolved, audioFiles } = job;

  // Filter to non-WAV files
  const toConvert = audioFiles.filter(f => path.extname(f).toLowerCase() !== '.wav');
  if (toConvert.length === 0) {
    return res.status(400).json({ error: 'All files are already WAV' });
  }

  startJob('convert', toConvert.length);
  res.json({ started: true, total: toConvert.length });

  (async () => {
    const results = [];

    try {
      await backupFiles(resolved, toConvert, 'before_conversion');

      jobState.phase = 'converting';
      for (let i = 0; i < toConvert.length; i++) {
        const name = toConvert[i];
        jobState.current = i + 1;
        jobState.currentFile = name;

        const src = path.join(resolved, name);
        const baseName = path.basename(name, path.extname(name));
        const wavFile = path.join(resolved, baseName + '.wav');

        try {
          const { code, stderr } = await runFfmpeg([
            '-y', '-i', src, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', wavFile
          ]);
          if (code !== 0) throw new Error(stderr.slice(-200));

          // Remove original non-WAV file
          await fs.promises.unlink(src);
          results.push({ name, ok: true });
        } catch (err) {
          // Clean up partial WAV if it exists
          try { await fs.promises.unlink(wavFile); } catch {}
          results.push({ name, ok: false, error: err.message });
        }
      }

      finishJob(results);
    } catch (err) {
      finishJob(null, err.message);
    }
  })();
});

// Serve static files from public/ (after API routes)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Audio Browser running at http://localhost:${PORT}`);
  console.log(`ffmpeg: ${ffmpegAvailable ? 'available' : 'NOT FOUND'}`);
});
