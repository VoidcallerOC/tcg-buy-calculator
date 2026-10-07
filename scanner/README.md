# Buy Calculator card scanner

An input method for the existing calculator: **physical card → camera → capture → read printed text → match against the catalog → customer confirms → existing calculator**. The calculator (`lib/money.js` + `data/config.json` 60% buy rate; live `/api/cards` lookup) is unchanged and knows nothing about the scanner.

## Pipeline

| Stage                 | File                                     | Role                                                                                                                                                                                 |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CameraCapture         | `camera-capture.js`                      | `getUserMedia` (rear camera preferred), permission/unsupported/insecure/busy classification, crops the on-screen card guide out of the video frame                                   |
| ImagePreprocessor     | `image-preprocessor.js`                  | Grayscale + contrast stretch; a full-card image and an enlarged bottom strip (where most games print collector numbers)                                                              |
| OCR                   | `ocr-engine.js`                          | Tesseract.js, self-hosted in `vendor/tesseract/`, runs in a Web Worker in the browser. Swappable: any engine implementing `recognize(image) → { text, confidence }`                  |
| CardIdentifier        | `card-identifier.js`, `game-patterns.js` | Extracts printed identifiers (per-game patterns), set codes, language and plausible name lines. Never picks a card                                                                   |
| CatalogMatcher        | `catalog-matcher.js`                     | Searches with the calculator's own lookup (live `/api/cards`, via the injected calculator lookup), scores candidates, returns `IDENTIFIED`, `NEEDS_CONFIRMATION` or `NOT_IDENTIFIED` |
| Session               | `scan-session.js`                        | DOM-free state machine: idle → starting → live → processing → result / error                                                                                                         |
| CandidateConfirmation | `scanner-ui.js`                          | Camera view, guide, and result panels. Hands the confirmed card to `app.js` (`confirmScannedCard`)                                                                                   |

`app.js` loads the scanner only when **Scan a card** is tapped. The OCR engine (~8.8 MB) loads on the first capture.

## What "identified" means

Identification is **text-based**: the scanner reads printed text and looks the card up. It does **not** recognize artwork.

- `IDENTIFIED`: a printed identifier matched a catalog card's number, and the name read agrees, with a clear lead over any other candidate. Shown as **Card found**; the customer still taps **Use this card**.
- `NEEDS_CONFIRMATION`: several plausible cards, or only the name could be read (name-only reads are never `IDENTIFIED`). The customer chooses.
- `NOT_IDENTIFIED`: nothing readable, or nothing in the catalog scored high enough. No guess is shown.
- Errors (camera denied/unavailable/unsupported, capture failed, OCR engine unavailable, catalog lookup failed) each have their own message. Every state offers **Search manually**.

Provider failures during matching are errors; they never fall back to demo data. In demo mode, matching uses only the 8-card demo catalog and the panel says so.

## Supported games

`game-patterns.js` has patterns for Pokémon (`199/165`, `TG05/TG30`, `SVP 123`), One Piece (`OP05-119`, `ST01-001`, `P-001`), Yu-Gi-Oh! (`MACR-EN036`, with language) and Magic (`0107 M` + `DMU • EN`). Add a game by adding an entry; the camera, OCR and matching code do not change.

## Privacy and security

- Camera access is browser-controlled and requested only after **Scan a card**. `vercel.json` sets `Permissions-Policy: camera=(self)` and CSP `wasm-unsafe-eval` / `worker-src 'self'`.
- **No image leaves the browser.** OCR runs locally; only the extracted text is sent, as an ordinary search query, to the site's own `/api/cards`.
- No third-party CDN: the engine and English language data are served from this site. The CSP adds only `'wasm-unsafe-eval'` (to compile the engine) and `worker-src 'self'`.
- No credentials are involved.

## Limits (honest)

- OCR quality on real phones with foil, glare, small type and angled cards is **not yet verified**; only synthetic card images through a real camera stream have been tested.
- Live JustTCG lookups by collector number alone (e.g. `199/165`) are unverified; the matcher also searches by the name read from the card.
- Visual (artwork) recognition would need an external service. The boundary is `ocr-engine.js`'s `recognize()` / a server-side `/api/identify`; none is configured, and adding one means documenting exactly what image data leaves the browser and keeping its key server-side.

## Tests

- `node --test tests/scanner.test.js`: deterministic unit tests (fake camera and OCR, real identification and matching).
- Playwright browser fixtures in `tests/browser/` (camera/OCR live path UNVERIFIED in CI): real Chromium with a fake camera device fed synthetic card images, real OCR, production headers. Needs Playwright: `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/scanner-e2e.mjs`.
