// The "Background" dialog on the admin page: choose a picture or a PDF, preview it (and pick a page), then put it
// behind the board for everyone. Also removes the current background.
import { BACKGROUND_NAME_MAX, MAX_FILE_BYTES, STORED_MAX_H, STORED_MAX_W } from './background.js';
import { UploadError, encodeBackground, openSource } from './background-prep.js';
import { clearBackground, setBackground } from './db.js';
import { iconHtml } from './icons.js';
import { el, explainError, toast } from './ui.js';
import { clamp, truncate } from './util.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const messageOf = (error) => (error instanceof UploadError ? error.message : explainError(error));

// `current` is the background now on the board ({ img, name } or null).
export function showBackgroundDialog({ code, current }) {
  let source = null;
  let pageNumber = 1;
  let latest = 0; // which preview request is newest, so a slow one can't overwrite a newer one
  let busy = false;

  const fileInput = el('input', { type: 'file', name: 'background', accept: 'image/*,application/pdf,.pdf', hidden: true });
  const chooseButton = el('button', { class: 'btn', type: 'button', html: `${iconHtml('upload', 18)}<span>Choose a picture or PDF</span>` });
  const hint = el('p', { class: 'dialog-hint' }, `JPEG, PNG or PDF, up to ${MAX_FILE_BYTES / 1024 / 1024} MB. You can also drop a file here.`);

  const preview = el('div', { class: 'bg-preview' });
  const status = el('p', { class: 'field-error', role: 'alert' });

  const previous = el('button', { class: 'btn btn-small btn-icon', type: 'button', 'aria-label': 'Previous page', html: iconHtml('chevronLeft', 18) });
  const next = el('button', { class: 'btn btn-small btn-icon', type: 'button', 'aria-label': 'Next page', html: iconHtml('chevronRight', 18) });
  const pageInput = el('input', { class: 'page-input', type: 'text', name: 'page', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Page number' });
  const pageCount = el('span', {});
  const pager = el('div', { class: 'pager', hidden: true }, previous, el('span', {}, 'Page'), pageInput, pageCount, next);

  const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
  const remove = current ? el('button', { class: 'btn btn-danger-quiet', type: 'button' }, 'Remove background') : null;
  const use = el('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, 'Use as background');

  const form = el(
    'form',
    { novalidate: true },
    el('h2', { id: 'background-title' }, 'Background'),
    el('p', {}, 'Put a picture or a PDF page behind the board. Everyone can write on top of it.'),
    el('div', { class: 'bg-choose' }, chooseButton, hint),
    fileInput,
    preview,
    pager,
    status,
    el('div', { class: 'dialog-actions' }, remove, cancel, use),
  );
  const dialog = el('dialog', { class: 'dialog dialog-bg', 'aria-labelledby': 'background-title' }, form);

  // ---- What the preview shows

  function showCurrent() {
    preview.replaceChildren(
      current
        ? el('img', { src: current.img, alt: `Current background${current.name ? `: ${current.name}` : ''}` })
        : el('p', {}, 'No background yet. Choose a picture or a PDF.'),
    );
  }
  showCurrent();

  function setBusy(on, label) {
    busy = on;
    dialog.toggleAttribute('aria-busy', on);
    for (const control of [chooseButton, previous, next, pageInput, cancel, remove, use]) if (control) control.disabled = on;
    if (!on) updatePager();
    use.textContent = on && label ? label : 'Use as background';
    if (!on) use.disabled = !source;
  }

  function updatePager() {
    pager.hidden = !source || source.pages < 2;
    if (!source) return;
    pageInput.value = String(pageNumber);
    pageCount.textContent = `of ${source.pages}`;
    previous.disabled = pageNumber <= 1;
    next.disabled = pageNumber >= source.pages;
  }

  async function showPage() {
    const mine = ++latest;
    try {
      const canvas = await source.render(pageNumber, 960, 540);
      if (mine === latest) preview.replaceChildren(canvas);
    } catch (error) {
      if (mine === latest) status.textContent = messageOf(error);
    }
    updatePager();
  }

  async function goToPage(n) {
    if (!source || busy) return;
    pageNumber = clamp(Math.round(Number(n)) || pageNumber, 1, source.pages);
    updatePager();
    await showPage();
  }

  // ---- Choosing a file

  async function pick(file) {
    if (!file || busy) return;
    status.textContent = '';
    setBusy(true, 'Opening…');
    try {
      const opened = await openSource(file);
      source?.destroy();
      source = opened;
      pageNumber = 1;
      await showPage();
    } catch (error) {
      status.textContent = messageOf(error);
    } finally {
      setBusy(false);
    }
  }

  chooseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    pick(fileInput.files[0]);
    fileInput.value = '';
  });
  dialog.addEventListener('dragover', (event) => {
    event.preventDefault();
    dialog.classList.add('is-over');
  });
  dialog.addEventListener('dragleave', (event) => {
    if (event.target === dialog) dialog.classList.remove('is-over');
  });
  dialog.addEventListener('drop', (event) => {
    event.preventDefault();
    dialog.classList.remove('is-over');
    pick(event.dataTransfer?.files?.[0]);
  });

  previous.addEventListener('click', () => goToPage(pageNumber - 1));
  next.addEventListener('click', () => goToPage(pageNumber + 1));
  pageInput.addEventListener('change', () => goToPage(pageInput.value));
  pageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToPage(pageInput.value);
    }
  });

  // ---- Using it, or taking it away

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!source || busy) return;
    status.textContent = '';
    setBusy(true, 'Preparing…');
    try {
      await nextFrame(); // let "Preparing…" show before the heavy part starts
      const canvas = await source.render(pageNumber, STORED_MAX_W, STORED_MAX_H);
      const picture = encodeBackground(canvas);
      const label = source.pages > 1 ? `${source.name} (page ${pageNumber})` : source.name;
      await setBackground(code, { ...picture, name: truncate(label, BACKGROUND_NAME_MAX) });
      toast('Background updated.');
      dialog.close();
    } catch (error) {
      status.textContent = messageOf(error);
      setBusy(false);
    }
  });

  remove?.addEventListener('click', async () => {
    setBusy(true);
    try {
      await clearBackground(code);
      toast('Background removed.');
      dialog.close();
    } catch (error) {
      status.textContent = messageOf(error);
      setBusy(false);
    }
  });

  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    source?.destroy();
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  chooseButton.focus();
}
