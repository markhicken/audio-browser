import { state } from './state.js';

export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function fmtTime(s) {
  if (!s || !isFinite(s)) return '0.0s';
  if (s < 10) return s.toFixed(1) + 's';
  if (s < 60) return s.toFixed(0) + 's';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

export function escPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function resolvePath(name) {
  // Paths are normalized to use forward slashes
  return state.currentDir + '/' + name;
}
