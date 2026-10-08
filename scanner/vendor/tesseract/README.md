# Vendored OCR engine (self-hosted)

Unmodified files from npm, served from this site so no card image leaves the browser and no third-party CDN is contacted.

| File | Package | Version | License |
|---|---|---|---|
| `tesseract.esm.min.js`, `worker.min.js` | tesseract.js | 7.0.0 | Apache-2.0 |
| `tesseract-core-{simd-,}lstm.{js,wasm}` | tesseract.js-core | 7.0.0 | Apache-2.0 |
| `lang/eng.traineddata.gz` | @tesseract.js-data/eng (4.0.0_best_int) | 1.0.0 | Apache-2.0 |

Only the LSTM cores are shipped (SIMD and non-SIMD); they sit beside `worker.min.js` because the engine resolves its `.wasm` relative to the worker. Loaded lazily, only after the customer taps **Scan a card**.
