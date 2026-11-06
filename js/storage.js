// What this browser remembers between visits. Everything is optional: private windows and blocked
// storage just mean nothing is remembered.
const PREFIX = 'edutools-whiteboard:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nothing to do: the page works without it.
  }
}

// The boards this browser created, so an admin can find them again after closing the tab.
export const myBoards = () => read('boards', []).filter((board) => board && typeof board.code === 'string');

export function rememberBoard({ code, title }) {
  write('boards', [{ code, title, createdAt: Date.now() }, ...myBoards().filter((board) => board.code !== code)].slice(0, 30));
}

export function forgetBoard(code) {
  write('boards', myBoards().filter((board) => board.code !== code));
}
