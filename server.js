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

function normalizeRequestPath(requestPath) {
  if (!requestPath) return requestPath;
  const decoded = requestPath.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    const driveRootMatch = /^([a-z]):\/?$/i.exec(decoded);
    if (driveRootMatch) {
      return driveRootMatch[1].toUpperCase() + ':' + path.sep;
    }
  }
  return decoded;
}

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

// Shared cache for durations and sizes
const metadataCache = new Map(); // AbsolutePath -> { size, duration, mtimeMs }

// Directory listing cache: key -> { mtime, folders, files }
const dirListCache = new Map();

// File size cache: AbsolutePath -> { size, mtimeMs }
const fileSizeCache = new Map();

// Get file stats with caching (mtime validation only)
async function getFileStatsWithCache(filePath) {
  const cached = fileSizeCache.get(filePath);

  if (cached) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs === cached.mtimeMs) {
        return { size: cached.size, mtimeMs: cached.mtimeMs };
      }
    } catch {
      fileSizeCache.delete(filePath);
    }
  }

  // Cache miss or stale - fetch fresh
  try {
    const stat = await fs.promises.stat(filePath);
    fileSizeCache.set(filePath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs
    });
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { size: 0, mtimeMs: 0 };
  }
}

// Sort folders and files by the specified criterion
function sortFolderAndFiles(folders, files, sort, order) {
  const nameCmp = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  folders.sort((a, b) => {
    let cmp = nameCmp(a, b);
    return order === 'desc' ? -cmp : cmp;
  });

  files.sort((a, b) => {
    if (sort === 'size') {
      return order === 'desc' ? b.size - a.size : a.size - b.size;
    }
    if (sort === 'ext') {
      const extA = a.ext || '';
      const extB = b.ext || '';
      const cmp = extA.localeCompare(extB, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
      return nameCmp(a, b);
    }
    let cmp = nameCmp(a, b);
    return order === 'desc' ? -cmp : cmp;
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

// Get available drives on Windows
async function getAvailableDrives() {
  const drives = [];
  if (process.platform !== 'win32') {
    return [{ name: '/', type: 'folder' }];
  }

  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ':';
    try {
      await fs.promises.access(path.join(drive, path.sep));
      drives.push({ name: drive, type: 'folder' });
    } catch {
      // Drive doesn't exist or isn't accessible
    }
  }
  return drives;
}

// List directory contents
app.get('/api/list', async (req, res) => {
  const dir = decodeURIComponent(req.query.dir);
  if (!dir) return res.status(400).json({ error: 'dir parameter required' });
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const requestedPageSize = parseInt(req.query.pageSize, 10) || 200;
  const pageSize = Math.min(Math.max(requestedPageSize, 25), 500);

  const sort = req.query.sort || 'name'; // 'name', 'size'
  const order = req.query.order || 'asc'; // 'asc', 'desc'
  const searchQuery = (req.query.search || '').trim().toLowerCase();

  // Special case: list available drives
  if (dir === '///drives') {
    const drives = await getAvailableDrives();
    drives.sort((a, b) => {
      let cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return order === 'desc' ? -cmp : cmp;
    });

    return res.json({
      path: '///drives',
      entries: drives,
      page: 1,
      pageSize: drives.length,
      offset: 0,
      totalEntries: drives.length,
      hasMore: false,
      counts: { files: 0, folders: drives.length }
    });
  }

  const normalizedDir = normalizeRequestPath(dir);
  const resolved = process.platform === 'win32' && /^[a-z]:\\$/i.test(normalizedDir)
    ? normalizedDir
    : path.resolve(normalizedDir);

  const isUnixRoot = process.platform !== 'win32' && resolved === '/';
  let folders, files, totalEntries, hiddenFiles = 0;

  // Check cache first
  const cached = dirListCache.get(resolved);
  if (cached) {
    try {
      const dirStat = await fs.promises.stat(resolved);
      if (dirStat.mtimeMs === cached.mtime) {
        // Cache hit - apply sort/filter from cache data
        folders = cached.folders.filter(e => !searchQuery || e.nameLower.includes(searchQuery));
        files = cached.files.filter(e => !searchQuery || e.nameLower.includes(searchQuery));
        hiddenFiles = cached.hiddenFiles || 0;

        if (sort === 'size') {
          // Only stat files that don't already have size cached
          const filesToStat = files.filter(f => f.size === undefined);
          if (filesToStat.length > 0) {
            await mapWithConcurrency(filesToStat, 32, async (file) => {
              const filePath = path.join(resolved, file.name);
              const stats = await getFileStatsWithCache(filePath);
              file.size = stats.size;
              file.mtimeMs = stats.mtimeMs;
              return file;
            });
          }
        }

        sortFolderAndFiles(folders, files, sort, order);
        totalEntries = (isUnixRoot ? 0 : 1) + folders.length + files.length;
      } else {
        throw new Error('Directory changed');
      }
    } catch {
      dirListCache.delete(resolved);
    }
  }

  // Cache miss - read and cache
  if (folders === undefined) {
    let dirEntries;
    try {
      dirEntries = await fs.promises.readdir(resolved, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found' });
      }
      return res.status(403).json({ error: 'Cannot read directory: ' + err.message });
    }

    folders = [];
    files = [];

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.')) continue;

      const nameLower = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        folders.push({ name: entry.name, type: 'folder', nameLower });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          files.push({ name: entry.name, type: 'file', ext: ext.slice(1), nameLower });
        } else {
          hiddenFiles += 1;
        }
      }
    }

    // Cache the base list
    try {
      const dirStat = await fs.promises.stat(resolved);
      dirListCache.set(resolved, {
        mtime: dirStat.mtimeMs,
        folders: [...folders],
        files: [...files],
        hiddenFiles
      });
    } catch {}

    if (searchQuery) {
      folders = folders.filter(entry => entry.nameLower.includes(searchQuery));
      files = files.filter(entry => entry.nameLower.includes(searchQuery));
    }

    // Pre-calculate stats if sorting by size
    if (sort === 'size') {
      await mapWithConcurrency(files, 32, async (file) => {
        const filePath = path.join(resolved, file.name);
        const stats = await getFileStatsWithCache(filePath);
        file.size = stats.size;
        file.mtimeMs = stats.mtimeMs;
        return file;
      });
      
      // Update cache with stats so subsequent requests don't need to re-stat
      const cachedEntry = dirListCache.get(resolved);
      if (cachedEntry) {
        // Create a map of files for quick lookup
        const fileMap = new Map(files.map(f => [f.name, { size: f.size, mtimeMs: f.mtimeMs }]));
        cachedEntry.files.forEach(f => {
          const stats = fileMap.get(f.name);
          if (stats) {
            f.size = stats.size;
            f.mtimeMs = stats.mtimeMs;
          }
        });
      }
    }

    sortFolderAndFiles(folders, files, sort, order);
    totalEntries = (isUnixRoot ? 0 : 1) + folders.length + files.length;
  }

  // Build entries array and paginate
  const entries = [];
  if (!isUnixRoot) {
    entries.push({ name: '..', type: 'folder' });
  }
  entries.push(...folders, ...files);

  const start = (page - 1) * pageSize;
  const pageEntries = entries.slice(start, start + pageSize);

  // Hydrate files with size/duration (only for visible page)
  const hydratedEntries = await mapWithConcurrency(pageEntries, 8, async (entry) => {
    if (entry.type !== 'file') return entry;

    const filePath = path.join(resolved, entry.name);
    let size = entry.size;
    let mtimeMs = entry.mtimeMs;

    if (size === undefined) {
      const stats = await getFileStatsWithCache(filePath);
      size = stats.size;
      mtimeMs = stats.mtimeMs;
    }

    const cached = metadataCache.get(filePath);
    let duration = null;

    if (cached && cached.mtimeMs === mtimeMs) {
      duration = cached.duration;
    } else {
      duration = await probeDuration(filePath);
      metadataCache.set(filePath, { duration, size, mtimeMs });
    }

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
      folders: folders.length,
      nonAudioFiles: hiddenFiles
    }
  });
});

// Serve or transcode audio file
app.get('/api/audio', (req, res) => {
  const file = decodeURIComponent(req.query.file);
  if (!file) return res.status(400).json({ error: 'file parameter required' });

  const normalizedFile = normalizeRequestPath(file);
  const resolved = process.platform === 'win32' && /^[a-z]:\\$/i.test(normalizedFile)
    ? normalizedFile
    : path.resolve(normalizedFile);

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
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  probeDuration(resolved).then(duration => res.json({ duration }));
});

// Delete file (send to recycle bin or trash on all platforms)
app.delete('/api/file', async (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'file parameter required' });

  const resolved = path.resolve(file);

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const { default: trash } = await import('trash');
    await trash([resolved]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
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
  const url = `http://localhost:${PORT}`;
  console.log(`Audio Browser running at ${url}`);
  console.log(`ffmpeg: ${ffmpegAvailable ? 'available' : 'NOT FOUND'}`);
});
