// CandidateConfirmation + camera view for the Buy Calculator. Loaded on demand
// when the customer taps "Scan a card". Hands a confirmed card (the
// calculator's own card shape) to `onConfirm`; never selects one by itself.
import { CameraCapture } from "./camera-capture.js";
import { preprocessCard } from "./image-preprocessor.js";
import { createTesseractEngine } from "./ocr-engine.js";
import { createScanSession, SCAN_STATE, SCAN_ERROR } from "./scan-session.js";
import { MATCH_STATUS } from "./catalog-matcher.js";
import { gameLabel } from "./game-patterns.js";
import { bestSearchQuery } from "./card-identifier.js";

const ERRORS = {
  [SCAN_ERROR.DENIED]: [
    "Camera access is blocked.",
    "Allow camera access for this site in your browser settings, then try again. Or search for the card by name.",
    true,
  ],
  [SCAN_ERROR.UNAVAILABLE]: [
    "No camera found.",
    "This device has no camera we can use. Search for the card by name instead.",
    false,
  ],
  [SCAN_ERROR.BUSY]: [
    "The camera is in use.",
    "Close any other app or tab using the camera, then try again.",
    true,
  ],
  [SCAN_ERROR.UNSUPPORTED]: [
    "This browser can’t open the camera.",
    "Try a current version of Safari or Chrome, or search for the card by name.",
    false,
  ],
  [SCAN_ERROR.INSECURE]: [
    "The camera needs a secure connection.",
    "Open this page over https to scan. You can still search by name.",
    false,
  ],
  [SCAN_ERROR.FAILED]: [
    "The camera didn’t start.",
    "Try again, or search for the card by name.",
    true,
  ],
  [SCAN_ERROR.CAPTURE_FAILED]: [
    "That photo didn’t capture.",
    "Hold steady with the whole card in the frame and try again.",
    true,
  ],
  [SCAN_ERROR.OCR_UNAVAILABLE]: [
    "The card reader couldn’t load on this device.",
    "Scanning isn’t available here right now. Search for the card by name instead.",
    true,
  ],
  [SCAN_ERROR.OCR_FAILED]: [
    "We couldn’t read that photo.",
    "Try again with less glare, or search by name.",
    true,
  ],
  [SCAN_ERROR.SEARCH_FAILED]: [
    "Card lookup is unavailable right now.",
    "We read the card but couldn’t search the catalog. No price has been estimated.",
    true,
  ],
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, className, onClick) => {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

let ui = null;

/**
 * @param {{ search: (q: string, game: string) => Promise<object[]>, selectedGame: () => string,
 *   isDemo: () => boolean, onConfirm: (card: object) => void, onManual: (query: string) => void, returnFocus?: HTMLElement }} options
 */
export function openScanner(options) {
  ui ??= createUi();
  ui.options = options;
  ui.root.hidden = false;
  document.body.classList.add("scanner-open");
  ui.closeButton.focus();
  ui.session.open();
}

function createUi() {
  const root = document.getElementById("scanner");
  const video = root.querySelector("#scanner-video");
  const guide = root.querySelector("#scanner-guide");
  const panel = root.querySelector("#scanner-panel");
  const hint = root.querySelector("#scanner-hint");
  const closeButton = root.querySelector("[data-scan-close]");
  const camera = new CameraCapture();
  const ocr = createTesseractEngine({
    onProgress: (message) => {
      if (
        state.session.state.status === SCAN_STATE.PROCESSING &&
        /loading/.test(message.status ?? "")
      )
        hint.textContent = "Loading the card reader (first scan only)…";
    },
  });
  const state = {
    root,
    closeButton,
    options: null,
    session: createScanSession({
      camera: {
        start: () => camera.start(video),
        capture: () => camera.captureSharpest(video, guide),
        stop: () => camera.stop(video),
      },
      preprocess: (frame) => preprocessCard(frame),
      ocr,
      search: (query, game) => state.options.search(query, game),
      selectedGame: () => state.options.selectedGame(),
      onState: (next) => render(next),
    }),
  };

  const close = () => {
    state.session.close();
    root.hidden = true;
    document.body.classList.remove("scanner-open");
    state.options?.returnFocus?.focus();
  };
  let lastQuery = "";
  const manual = () => {
    const query = lastQuery;
    close();
    state.options.onManual(query);
  };
  const confirm = (card) => {
    close();
    state.options.onConfirm(card);
  };
  closeButton.addEventListener("click", close);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  function actions(...nodes) {
    const row = el("div", "scanner-actions");
    row.append(...nodes);
    return row;
  }
  const manualButton = () =>
    button(
      lastQuery ? `Search “${lastQuery}”` : "Search manually",
      "button button--ghost scanner-manual",
      manual,
    );
  const againButton = () =>
    button("Scan again", "button button--ghost", () => state.session.retry());

  function cluesLine(clues) {
    if (!clues) return null;
    const read = [
      ...clues.identifiers.map((item) => item.raw),
      ...clues.names.slice(0, 2),
    ];
    return el(
      "p",
      "scanner-read",
      read.length
        ? `Read from card: ${read.join(" · ")}`
        : "No readable text found on the card.",
    );
  }

  function candidate(item, primary) {
    const { card } = item;
    const row = el(
      "div",
      primary ? "scan-candidate is-primary" : "scan-candidate",
    );
    const info = el("div", "scan-candidate-info");
    const name = el("strong", "", card.name);
    if (card.demo) name.append(" ", el("em", "demo-tag", "Demo"));
    info.append(name);
    info.append(
      el(
        "span",
        "",
        [card.set_name, card.card_number].filter(Boolean).join(" · ") ||
          "Set not listed",
      ),
    );
    const meta = [gameLabel(item.game), card.rarity]
      .filter(Boolean)
      .join(" · ");
    if (meta) info.append(el("small", "", meta));
    row.append(
      info,
      button(
        "Use this card",
        primary ? "button" : "button button--secondary",
        () => confirm(card),
      ),
    );
    return row;
  }

  function render(next) {
    root.dataset.state = next.status;
    lastQuery = bestSearchQuery(next.clues);
    panel.replaceChildren();
    const fill = (...nodes) => panel.append(...nodes.filter(Boolean));
    const demoNote = state.options?.isDemo()
      ? el(
          "p",
          "scanner-demo",
          "Demo mode: matching against a small demo catalog. Prices are illustrative, not a quote.",
        )
      : null;
    switch (next.status) {
      case SCAN_STATE.STARTING:
        hint.textContent = "Starting camera…";
        fill(
          el(
            "p",
            "scanner-note",
            "Your browser may ask to use the camera. Photos stay on this device.",
          ),
          actions(manualButton()),
        );
        break;
      case SCAN_STATE.LIVE:
        hint.textContent = "Place the whole card inside the frame";
        fill(
          el(
            "p",
            "scanner-note",
            "Fill the frame, avoid glare, and keep the card flat.",
          ),
          actions(
            button("Capture", "button scanner-capture", () =>
              state.session.capture(),
            ),
            manualButton(),
          ),
        );
        break;
      case SCAN_STATE.PROCESSING:
        hint.textContent =
          next.step === "capturing"
            ? "Hold steady…"
            : next.step === "matching"
              ? "Looking up the card…"
              : "Reading the card…";
        fill(
          el(
            "p",
            "scanner-note",
            "Reading printed text on the card. This can take a few seconds.",
          ),
          cluesLine(next.clues),
          actions(
            button("Cancel", "button button--ghost", () =>
              state.session.retry(),
            ),
          ),
        );
        break;
      case SCAN_STATE.RESULT: {
        const { match, clues } = next;
        if (match.status === MATCH_STATUS.IDENTIFIED) {
          hint.textContent = "Card found";
          fill(
            el("span", "eyebrow", "Card found"),
            candidate(match.candidates[0], true),
            cluesLine(clues),
            actions(againButton(), manualButton()),
          );
        } else if (match.status === MATCH_STATUS.NEEDS_CONFIRMATION) {
          hint.textContent = "Confirm your card";
          const list = el("div", "scan-candidates");
          match.candidates.forEach((item, index) =>
            list.append(candidate(item, index === 0)),
          );
          fill(
            el("span", "eyebrow", "Needs confirmation"),
            el(
              "p",
              "scanner-title",
              match.candidates.length > 1
                ? "Which card is in your hand?"
                : "Is this your card?",
            ),
            list,
            cluesLine(clues),
            actions(againButton(), manualButton()),
          );
        } else {
          hint.textContent = "Not identified";
          // In demo mode a readable name usually means "not one of the sample cards", not a bad photo.
          const notInDemo = state.options?.isDemo() && clues?.names?.length;
          // Nothing usable read: blur, glare, distance or a blank face look the same to OCR, so give the advice for all.
          const unread = match.reason === "no_text";
          fill(
            el("span", "eyebrow", "Could not identify"),
            el(
              "p",
              "scanner-title",
              unread
                ? "We couldn’t read the card."
                : notInDemo
                  ? `We read “${clues.names[0]}”, but it isn’t in the demo catalog.`
                  : "We couldn’t confidently identify this card.",
            ),
            el(
              "p",
              "scanner-note",
              unread
                ? "Hold the phone steady about 15–20 cm (6–8 in) from the card, wait for it to focus, then capture. Good light helps; avoid glare."
                : notInDemo
                  ? "Demo mode can only match its few sample cards. With live pricing connected, the full catalog is searched."
                  : "Try again with the whole card in the frame and less glare, or search by name.",
            ),
            cluesLine(clues),
            actions(againButton(), manualButton()),
          );
        }
        if (demoNote) fill(demoNote);
        break;
      }
      case SCAN_STATE.ERROR: {
        const [title, body, canRetry] =
          ERRORS[next.code] ?? ERRORS[SCAN_ERROR.FAILED];
        hint.textContent = "";
        fill(
          el("span", "eyebrow", "Scanner"),
          el("p", "scanner-title", title),
          el("p", "scanner-note", body),
        );
        if (next.code === SCAN_ERROR.SEARCH_FAILED && next.message)
          fill(el("p", "scanner-read", next.message));
        fill(
          actions(
            ...(canRetry
              ? [button("Try again", "button", () => state.session.retry())]
              : []),
            manualButton(),
          ),
        );
        break;
      }
      default:
        break;
    }
  }
  return state;
}
