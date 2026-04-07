// Shared application state
export const state = {
  currentDir: '',
  entries: [],
  selectedIndex: -1,
  playingFile: null,
  isAudioPlaying: false,
  playTimeout: null,
  ffmpegAvailable: false,
  homeDir: '',
  pageSize: 200,
  totalEntries: 0,
  hasMoreEntries: false,
  entryCounts: { files: 0, folders: 0 },
  loadedPages: new Set(),
  loadingPages: new Set(),
  visiblePageStart: 1,
  visiblePageEnd: 1,
  listRequestToken: 0,
  scrollPrefetchTimer: null,
  isLoadingDirectory: false,
  sort: 'name',
  order: 'asc'
};

// DOM element references
export const dom = {
  audio: document.getElementById('audio'),
  filelist: document.getElementById('filelist'),
  breadcrumbs: document.getElementById('breadcrumbs'),
  warning: document.getElementById('warning'),
  empty: document.getElementById('empty'),
  playBtn: document.getElementById('play-btn'),
  transportName: document.getElementById('transport-name'),
  progressBar: document.getElementById('progress-bar'),
  progressWrap: document.getElementById('progress-wrap'),
  transportTime: document.getElementById('transport-time'),
  autoplayCb: document.getElementById('autoplay-cb'),
  fileCount: document.getElementById('file-count'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeIcon: document.getElementById('volume-icon')
};
