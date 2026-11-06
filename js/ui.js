// Small DOM helpers shared by the pages. No Firebase in here, so the landing page stays light.
import { iconHtml } from './icons.js';

export const $ = (selector, root = document) => root.querySelector(selector);

// Static markup asks for an icon with data-icon="copy" (and optionally data-icon-size); this puts it in.
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    node.insertAdjacentHTML('afterbegin', iconHtml(node.dataset.icon, Number(node.dataset.iconSize) || 20));
    node.removeAttribute('data-icon');
  }
}

// el('button', { class: 'btn', onclick: fn, 'aria-pressed': 'true' }, 'Label', childNode)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

// Shows the one [data-screen] section with this name and hides the others.
export function showScreen(name, root = document) {
  for (const screen of root.querySelectorAll('[data-screen]')) screen.hidden = screen.dataset.screen !== name;
}

export function toast(message, kind = 'info') {
  let region = document.getElementById('toasts');
  if (!region) {
    region = el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  if ([...region.children].some((node) => node.textContent === message)) return;
  const node = el('div', { class: `toast toast-${kind}` }, message);
  region.append(node);
  setTimeout(() => node.remove(), 5000);
}

// Asks before doing something that can't be undone. Resolves { ok, checked }.
export function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', danger = false, checkbox = null }) {
  return new Promise((resolve) => {
    const box = checkbox ? el('input', { type: 'checkbox', checked: checkbox.checked ?? false }) : null;
    const dialog = el(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      el(
        'form',
        { method: 'dialog' },
        el('h2', { id: 'dialog-title' }, title),
        el('p', {}, body),
        box && el('label', { class: 'check' }, box, el('span', {}, checkbox.label)),
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { class: 'btn', value: 'cancel', autofocus: true }, cancelLabel),
          el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'ok' }, confirmLabel),
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      resolve({ ok: dialog.returnValue === 'ok', checked: box?.checked ?? false });
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    const copied = document.execCommand?.('copy') ?? false;
    area.remove();
    return copied;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// While a page is starting up, a refusal most likely means the security rules are missing, not that the person did anything wrong.
export function explainSetupError(error) {
  if (/permission[_ ]denied/i.test(`${error?.code ?? ''} ${error?.message ?? ''}`)) {
    return 'The database refused the request. If you host this site yourself, check that the whiteboard security rules are deployed.';
  }
  return explainError(error);
}

// Turns a Firebase error into something a person can act on.
export function explainError(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (/permission[_ ]denied/i.test(text)) {
    return 'The board refused that. It may be locked, or you may have been removed.';
  }
  if (/auth\//i.test(text)) return 'Couldn’t sign in. Check your connection and try again.';
  if (/network|offline|unavailable|disconnected/i.test(text)) return 'Can’t reach the board. Check your connection.';
  return 'Something went wrong. Try again.';
}
