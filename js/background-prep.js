// Turns a file the teacher picked into a picture ready to store: opens images and PDFs, draws a chosen page onto
// a canvas, and encodes it small enough for the database. Browser only (it needs canvas, and pdf.js for PDFs).
import { BACKGROUND_MAX_CHARS, MAX_FILE_BYTES, kindOfFile, scaleToFit } from './background.js';
import { clamp } from './util.js';

// Its message is written for the teacher and is shown as it is.
export class UploadError extends Error {}

const PDFJS = new URL('../assets/vendor/pdfjs/', import.meta.url);

// pdf.js is large, so it is only fetched when a PDF is actually chosen.
let pdfjs = null;
function loadPdfjs() {
  pdfjs ??= import('../assets/vendor/pdfjs/pdf.min.mjs').then(
    (lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDFJS).href;
      return lib;
    },
    () => {
      pdfjs = null;
      throw new UploadError('This browser can’t open PDFs. Use a newer browser, or choose a picture of the page instead.');
    },
  );
  return pdfjs;
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function whiteCanvas(width, height) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  return canvas;
}

// A file ready to preview and use: { kind, name, pages, render(page, maxW, maxH) -> canvas, destroy() }.
async function openImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty picture');
  } catch {
    URL.revokeObjectURL(url);
    throw new UploadError('This picture can’t be opened here. Try a JPEG or PNG.');
  }
  return {
    kind: 'image',
    name: file.name,
    pages: 1,
    async render(_page, maxW, maxH) {
      const scale = scaleToFit(image.naturalWidth, image.naturalHeight, maxW, maxH);
      const canvas = whiteCanvas(image.naturalWidth * scale, image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    },
    destroy: () => URL.revokeObjectURL(url),
  };
}

async function openPdf(file) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: new URL('cmaps/', PDFJS).href,
    cMapPacked: true,
    wasmUrl: new URL('wasm/', PDFJS).href,
    iccUrl: new URL('iccs/', PDFJS).href,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    task.destroy().catch(() => {});
    if (error?.name === 'PasswordException') throw new UploadError('This PDF is password protected. Save a copy without the password and try again.');
    throw new UploadError('This PDF can’t be opened. Check that the file isn’t damaged, or choose a picture of the page instead.');
  }

  return {
    kind: 'pdf',
    name: file.name,
    pages: pdf.numPages,
    async render(pageNumber, maxW, maxH) {
      const page = await pdf.getPage(clamp(Math.round(pageNumber), 1, pdf.numPages));
      const natural = page.getViewport({ scale: 1 });
      // A PDF page is vector art, so it can be drawn larger than its nominal size and stay sharp.
      const viewport = page.getViewport({ scale: scaleToFit(natural.width, natural.height, maxW, maxH, true) });
      const canvas = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      page.cleanup();
      return canvas;
    },
    destroy: () => task.destroy().catch(() => {}),
  };
}

export async function openSource(file) {
  if (file.size > MAX_FILE_BYTES) throw new UploadError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB. Choose a smaller one.`);
  const kind = kindOfFile(file);
  if (kind === 'image') return openImage(file);
  if (kind === 'pdf') return openPdf(file);
  throw new UploadError('Choose a picture (JPEG or PNG) or a PDF.');
}

// Encodes the canvas as PNG or JPEG, whichever is smaller (PNG wins for text and line art, JPEG for photos), and
// shrinks it until it fits under the cap the database rules enforce. Returns { img, w, h }.
export function encodeBackground(canvas) {
  let source = canvas;
  for (let attempt = 0; attempt < 8; attempt++) {
    const jpeg = source.toDataURL('image/jpeg', 0.85);
    // A photo's PNG is huge and slow to make, so only try PNG when the picture looks simple.
    const png = jpeg.length < 600_000 ? source.toDataURL('image/png') : null;
    const best = png && png.length <= jpeg.length ? png : jpeg;
    if (best.length <= BACKGROUND_MAX_CHARS) return { img: best, w: source.width, h: source.height };

    const smaller = whiteCanvas(source.width * 0.8, source.height * 0.8);
    smaller.getContext('2d').drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
  }
  throw new UploadError('That picture is too detailed to share. Try a smaller or simpler one.');
}
