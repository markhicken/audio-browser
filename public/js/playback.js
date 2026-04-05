import { state, dom } from './state.js';
import { fmtTime, resolvePath } from './utils.js';
import { renderList, scrollToSelected } from './filelist.js';

function updatePlayingClass() {
  dom.filelist.classList.toggle('audio-active', state.isAudioPlaying);
}

export function playFile(entry) {
  const filePath = resolvePath(entry.name);
  state.playingFile = filePath;
  state.isAudioPlaying = true;
  dom.audio.src = '/api/audio?file=' + encodeURIComponent(filePath);
  dom.audio.load();
  dom.audio.play().catch(() => {});
  dom.transportName.textContent = entry.name;
  dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/></svg>';
  renderList();
  updatePlayingClass();
}

export function stopPlayback() {
  dom.audio.pause();
  dom.audio.removeAttribute('src');
  dom.audio.load();
  state.playingFile = null;
  state.isAudioPlaying = false;
  dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>';
  dom.transportName.textContent = 'No file selected';
  dom.progressBar.style.width = '0%';
  dom.transportTime.textContent = '0:00 / 0:00';
  renderList();
  updatePlayingClass();
}

export function togglePause() {
  if (!state.playingFile) return;
  if (dom.audio.paused) {
    dom.audio.play().catch(() => {});
    dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/></svg>';
    state.isAudioPlaying = true;
  } else {
    dom.audio.pause();
    dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>';
    state.isAudioPlaying = false;
  }
  updatePlayingClass();
}

export function initTransport() {
  // Progress updates
  dom.audio.addEventListener('timeupdate', () => {
    if (dom.audio.duration) {
      const pct = (dom.audio.currentTime / dom.audio.duration) * 100;
      dom.progressBar.style.width = pct + '%';
      dom.transportTime.textContent = fmtTime(dom.audio.currentTime) + ' / ' + fmtTime(dom.audio.duration);
    }
  });

  // Auto-advance on track end
  dom.audio.addEventListener('ended', () => {
    if (dom.autoplayCb.checked) {
      for (let i = state.selectedIndex + 1; i < state.entries.length; i++) {
        if (state.entries[i].type === 'file') {
          state.selectedIndex = i;
          renderList();
          scrollToSelected();
          playFile(state.entries[i]);
          return;
        }
      }
    }
    state.playingFile = null;
    state.isAudioPlaying = false;
    dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>';
    renderList();
    updatePlayingClass();
  });

  // Seek on progress bar click
  dom.progressWrap.addEventListener('click', (e) => {
    if (!dom.audio.duration) return;
    const rect = dom.progressWrap.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    dom.audio.currentTime = pct * dom.audio.duration;
  });

  // Play button click
  dom.playBtn.addEventListener('click', () => {
    if (state.playingFile) {
      togglePause();
    } else if (state.selectedIndex >= 0 && state.entries[state.selectedIndex].type === 'file') {
      playFile(state.entries[state.selectedIndex]);
    }
  });
}
