import { state, dom } from './state.js';
import { fmtTime, resolvePath } from './utils.js';
import { updatePlayingRow, focusRow, scrollToSelected } from './filelist.js';
import { ensureEntryLoaded } from './navigation.js';

function updatePlayingClass() {
  dom.filelist.classList.toggle('audio-active', state.isAudioPlaying);
  dom.transport.classList.toggle('audio-playing', !!state.playingFile);
}

export function playFile(entry, index = state.selectedIndex) {
  const filePath = resolvePath(entry.name);
  const previousPath = state.playingFile;
  state.playingFile = filePath;
  state.isAudioPlaying = true;
  dom.audio.src = '/api/audio?file=' + encodeURIComponent(filePath);
  dom.audio.load();
  dom.audio.play().catch(() => {});
  dom.transportName.textContent = entry.name;
  dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" rx="0.5" fill="currentColor"/></svg>';
  state.selectedIndex = index;
  updatePlayingRow(previousPath, filePath);
  updatePlayingClass();
}

export function stopPlayback() {
  const previousPath = state.playingFile;
  dom.audio.pause();
  dom.audio.removeAttribute('src');
  dom.audio.load();
  state.playingFile = null;
  state.isAudioPlaying = false;
  dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>';
  dom.transportName.textContent = 'No file selected';
  dom.progressSlider.value = 0;
  updateProgressSliderFill(0);
  dom.transportTime.textContent = '0:00 / 0:00';
  updatePlayingRow(previousPath, null);
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
  // Drag state (shared between timeupdate and seek handler)
  let isDragging = false;

  // Progress updates
  dom.audio.addEventListener('timeupdate', () => {
    if (isDragging) return; // Don't fight with drag
    if (dom.audio.duration) {
      const pct = (dom.audio.currentTime / dom.audio.duration) * 100;
      dom.progressSlider.value = pct;
      updateProgressSliderFill(pct);
      dom.transportTime.textContent = fmtTime(dom.audio.currentTime) + ' / ' + fmtTime(dom.audio.duration);
    }
  });

  // Auto-advance on track end
  dom.audio.addEventListener('ended', async () => {
    if (dom.autoplayCb.checked) {
      for (let i = state.selectedIndex + 1; i < state.entries.length; i++) {
        const entry = await ensureEntryLoaded(i);
        if (entry && entry.type === 'file') {
          await focusRow(i);
          scrollToSelected();
          playFile(entry, i);
          return;
        }
      }
    }
    // Don't clear playingFile when audio ends - keep the file selected
    state.isAudioPlaying = false;
    dom.playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>';
    updatePlayingClass();
  });

  dom.progressSlider.addEventListener('input', () => {
    if (!dom.audio.duration) return;
    const pct = Number(dom.progressSlider.value);
    const time = (pct / 100) * dom.audio.duration;
    dom.transportTime.textContent = fmtTime(time) + ' / ' + fmtTime(dom.audio.duration);
    updateProgressSliderFill(pct);
    dom.audio.currentTime = time;
  });

  dom.progressSlider.addEventListener('mousedown', () => {
    if (!dom.audio.duration) return;
    isDragging = true;
    dom.progressWrap.classList.add('dragging');
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    dom.progressWrap.classList.remove('dragging');
  });

  // Play button click
  dom.playBtn.addEventListener('click', () => {
    if (state.playingFile) {
      togglePause();
    } else if (state.selectedIndex >= 0 && state.entries[state.selectedIndex].type === 'file') {
      playFile(state.entries[state.selectedIndex]);
    }
  });

  // === Volume control ===
  const savedVolume = localStorage.getItem('audioBrowser_volume');
  const initialVolume = savedVolume !== null ? Number(savedVolume) : 100;
  dom.volumeSlider.value = initialVolume;
  dom.audio.volume = initialVolume / 100;
  updateVolumeIcon(initialVolume);
  updateVolumeSliderFill(initialVolume);

  dom.volumeSlider.addEventListener('input', () => {
    const vol = Number(dom.volumeSlider.value);
    dom.audio.volume = vol / 100;
    localStorage.setItem('audioBrowser_volume', vol);
    updateVolumeIcon(vol);
    updateVolumeSliderFill(vol);
    // Clear muted state when user drags slider
    dom.volumeIcon.classList.remove('muted');
  });

  // Mute toggle on icon click
  let volumeBeforeMute = initialVolume;
  dom.volumeIcon.addEventListener('click', () => {
    if (dom.audio.volume > 0) {
      volumeBeforeMute = Number(dom.volumeSlider.value);
      dom.volumeSlider.value = 0;
      dom.audio.volume = 0;
      dom.volumeIcon.classList.add('muted');
      updateVolumeIcon(0);
      updateVolumeSliderFill(0);
    } else {
      const restore = volumeBeforeMute > 0 ? volumeBeforeMute : 50;
      dom.volumeSlider.value = restore;
      dom.audio.volume = restore / 100;
      dom.volumeIcon.classList.remove('muted');
      updateVolumeIcon(restore);
      updateVolumeSliderFill(restore);
      localStorage.setItem('audioBrowser_volume', restore);
    }
  });
}

function updateVolumeSliderFill(vol) {
  const pct = vol;
  dom.volumeSlider.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--progress-bg) ${pct}%)`;
}

function updateProgressSliderFill(pct) {
  dom.progressSlider.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--progress-bg) ${pct}%)`;
}

function updateVolumeIcon(vol) {
  const wave1 = document.getElementById('vol-wave1');
  const wave2 = document.getElementById('vol-wave2');
  if (vol === 0) {
    wave1.style.display = 'none';
    wave2.style.display = 'none';
  } else if (vol < 50) {
    wave1.style.display = '';
    wave2.style.display = 'none';
  } else {
    wave1.style.display = '';
    wave2.style.display = '';
  }
}
