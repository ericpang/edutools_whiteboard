// QR codes for join links. The encoder is the vendored qrcode-generator (MIT, see assets/vendor); this module
// only turns its grid into an SVG. No DOM and no Firebase, so Node can test it.
import qrcode from '../assets/vendor/qrcode-generator/qrcode.mjs';

// The grid of modules for `text` as rows of booleans (true is dark). The smallest QR version that fits is used.
export function qrMatrix(text, level = 'M') {
  const code = qrcode(0, level);
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

const escapeAttribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// An SVG on a white square: one path for every dark module, and the four-module blank border scanners need.
export function qrSvg(text, { level = 'M', margin = 4, label = 'QR code' } = {}) {
  const matrix = qrMatrix(text, level);
  const size = matrix.length;
  const full = size + margin * 2;
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; ) {
      if (!matrix[row][col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && matrix[row][col]) col++;
      path += `M${start + margin} ${row + margin}h${col - start}v1h-${col - start}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="${escapeAttribute(label)}"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
