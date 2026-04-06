import { state, dom } from './state.js';
import { deleteSelected, focusRow } from './filelist.js';

const menu = document.getElementById('context-menu');
let contextIndex = -1;

function resolvePath(name) {
  const sep = state.currentDir.includes('\\') ? '\\' : '/';
  return state.currentDir + sep + name;
}

function hide() {
  menu.classList.remove('visible');
  contextIndex = -1;
}

function show(x, y, index) {
  const entry = state.entries[index];
  if (!entry || entry.type === 'folder') return;

  contextIndex = index;
  focusRow(index);

  menu.classList.add('visible');

  // Position, keeping on screen
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 4) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 4) + 'px';
}

export function initContextMenu() {
  // Right-click on file list
  dom.filelist.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.row');
    if (!row) return;
    show(e.clientX, e.clientY, parseInt(row.dataset.index));
  });

  // Handle menu item clicks
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item || contextIndex < 0) return;

    const action = item.dataset.action;
    const entry = state.entries[contextIndex];

    if (action === 'copypath' && entry) {
      const fullPath = resolvePath(entry.name);
      navigator.clipboard.writeText(fullPath).then(() => {
        item.textContent = 'Copied!';
        setTimeout(() => { item.textContent = 'Copy Path'; }, 1000);
      });
      hide();
    }

    if (action === 'delete' && entry) {
      hide();
      state.selectedIndex = contextIndex;
      deleteSelected();
    }
  });

  // Close on click anywhere else
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) hide();
  });

  // Close on scroll or keydown
  dom.filelist.addEventListener('scroll', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}
