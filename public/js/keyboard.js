import { state, dom } from './state.js';
import { selectWithDebounce, deleteSelected } from './filelist.js';
import { togglePause, stopPlayback } from './playback.js';
import { openSelected } from './navigation.js';

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (state.selectedIndex < state.entries.length - 1) {
          selectWithDebounce(state.selectedIndex + 1);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (state.selectedIndex > 0) {
          selectWithDebounce(state.selectedIndex - 1);
        }
        break;

      case 'Enter':
        e.preventDefault();
        openSelected();
        break;

      case 'Backspace':
        e.preventDefault();
        if (state.entries.length > 0 && state.entries[0].name === '..') {
          state.selectedIndex = 0;
          openSelected();
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (dom.audio.duration) {
          dom.audio.currentTime = Math.max(0, dom.audio.currentTime - 10);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (dom.audio.duration) {
          dom.audio.currentTime = Math.min(dom.audio.duration, dom.audio.currentTime + 10);
        }
        break;

      case ' ':
        e.preventDefault();
        togglePause();
        break;

      case 'Escape':
        e.preventDefault();
        stopPlayback();
        break;

      case 'Delete':
        e.preventDefault();
        deleteSelected();
        break;
    }
  });
}
