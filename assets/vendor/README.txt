Third-party code that is served with the site. Nothing here is loaded from a CDN.

qrcode-generator 2.0.4 (MIT), https://github.com/kazuhikoarase/qrcode-generator
  qrcode-generator/qrcode.mjs    Draws the join QR code (see js/qr.js).

pdf.js 6.5.438 (Apache-2.0), https://github.com/mozilla/pdf.js  (npm package: pdfjs-dist)
  pdfjs/pdf.min.mjs              Opens a PDF in the browser.
  pdfjs/pdf.worker.min.mjs       Its worker. Both load only when a teacher picks a PDF
                                 (see js/background-prep.js); students never download them.
  pdfjs/wasm/                    Decoders for JBIG2 and JPEG 2000 images and for color
                                 profiles, which scanned PDFs often need.
  pdfjs/iccs/                    A color profile, used with the above.
  pdfjs/cmaps/                   Character maps for PDFs in older Chinese, Japanese and
                                 Korean encodings. Fetched only when a PDF asks for one.

The licenses sit next to the files they cover. To update, copy the same files from a newer
pdfjs-dist or qrcode-generator release and re-run the tests (npm test, npm run test:e2e).
