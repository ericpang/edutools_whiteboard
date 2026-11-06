// The marker tray under the board: tools, colors and sizes, wired to a board from board.js.
// Picking a color lifts that marker out of the tray (see .marker in styles.css).
import { iconHtml } from './icons.js';
import { el } from './ui.js';
import { MARKERS } from './util.js';

const TOOLS = [
  { id: 'pen', label: 'Pen', key: 'P', icon: 'pen' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'text', label: 'Text', key: 'T', icon: 'text' },
];

const SIZES = [
  { label: 'Small', dot: 8 },
  { label: 'Medium', dot: 14 },
  { label: 'Large', dot: 22 },
];

const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// Fills `root` with the tray and returns a function that removes the keyboard shortcuts again.
export function mountTray(root, board) {
  const toolButtons = TOOLS.map((tool) =>
    el('button', { class: 'tool', type: 'button', 'data-tool': tool.id, title: `${tool.label} (${tool.key})`, html: `${iconHtml(tool.icon, 22)}<span>${tool.label}</span>` }),
  );
  const undoButton = el('button', { class: 'tool', type: 'button', title: 'Undo your last drawing (Ctrl+Z)', html: `${iconHtml('undo', 22)}<span>Undo</span>` });
  const markerButtons = MARKERS.map(({ name, color }) =>
    el('button', { class: 'marker', type: 'button', 'data-color': color, style: `--c: ${color}`, 'aria-label': name, title: name }, el('span', { class: 'marker-body' })),
  );
  const sizeButtons = SIZES.map(({ label, dot }) =>
    el('button', { class: 'size', type: 'button', 'aria-label': label, title: label }, el('i', { style: `--d: ${dot}px` })),
  );

  root.replaceChildren(
    el(
      'div',
      { class: 'tray', role: 'toolbar', 'aria-label': 'Drawing tools' },
      el('div', { class: 'tray-group', role: 'group', 'aria-label': 'Tools' }, ...toolButtons, undoButton),
      el('div', { class: 'markers', role: 'group', 'aria-label': 'Color' }, ...markerButtons),
      el('div', { class: 'tray-group', role: 'group', 'aria-label': 'Size' }, ...sizeButtons),
    ),
  );
  const tray = root.firstElementChild;

  toolButtons.forEach((button) => button.addEventListener('click', () => board.setTool(button.dataset.tool)));
  markerButtons.forEach((button) => button.addEventListener('click', () => board.setColor(button.dataset.color)));
  sizeButtons.forEach((button, index) => button.addEventListener('click', () => board.setSize(index)));
  undoButton.addEventListener('click', () => board.undo());

  function sync({ tool, color, size, canDraw }) {
    tray.dataset.tool = tool;
    toolButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    markerButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === color && tool !== 'eraser')));
    sizeButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === size)));
    for (const button of tray.querySelectorAll('button')) button.disabled = !canDraw;
  }
  const stopListening = board.onChange(sync);
  sync(board.state);

  function onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || isTyping(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      board.undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tool = TOOLS.find(({ key }) => key.toLowerCase() === event.key.toLowerCase());
    if (tool) board.setTool(tool.id);
    else if (['1', '2', '3'].includes(event.key)) board.setSize(Number(event.key) - 1);
  }
  document.addEventListener('keydown', onKeyDown);

  return () => {
    stopListening();
    document.removeEventListener('keydown', onKeyDown);
  };
}
