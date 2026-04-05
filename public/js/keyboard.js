import { state, dom } from './state.js';
import { selectWithDebounce, deleteSelected } from './filelist.js';
import { togglePause, stopPlayback } from './playback.js';
import { openSelected } from './navigation.js';

export function initKeyboard() {
  dom.filelist.addEventListener('keydown', (e) => {
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
