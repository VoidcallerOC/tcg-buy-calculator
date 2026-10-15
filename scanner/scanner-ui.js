// CandidateConfirmation + camera view for the Buy Calculator. Loaded on demand
// when the customer taps "Scan a card". Hands a confirmed card (the
// calculator's own card shape) to `onConfirm`; never selects one by itself.
import { CameraCapture } from "./camera-capture.js";
import { preprocessCard } from "./image-preprocessor.js";
import { createTesseractEngine } from "./ocr-engine.js";
import { createScanSession, SCAN_STATE, SCAN_ERROR } from "./scan-session.js";
import { MATCH_STATUS, printedName, variantLabels } from "./catalog-matcher.js";
import { gameLabel } from "./game-patterns.js";
import { bestSearchQuery, correctClues } from "./card-identifier.js";
import { formatMoney } from "../lib/money.js";

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

const AI_TIMEOUT_MS = 35_000;
const AI_MAX_SIDE = 1024;

// The captured card as a JPEG (base64, no data: prefix), small enough to send.
function frameToJpeg(frame) {
  const scale = Math.min(1, AI_MAX_SIDE / Math.max(frame.width, frame.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  canvas.getContext("2d").drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
}

// Sends one photo to this site's /api/identify; returns { name, number, game } or null.
async function identifyWithServer(frame, game) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: frameToJpeg(frame), game }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error || "AI identification is unavailable.");
    return body.card ?? null;
  } catch (error) {
    if (error?.name === "AbortError")
      throw new Error("AI identification timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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
      identify: identifyWithServer,
    }),
  };

  // The AI button appears only when the server has a model key configured.
  let aiEnabled = false;
  fetch("/api/identify")
    .then((response) => (response.ok ? response.json() : {}))
    .then((body) => {
      aiEnabled = body?.enabled === true;
      if (aiEnabled && state.session.state.status === SCAN_STATE.RESULT)
        render(state.session.state);
    })
    .catch(() => {});

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
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    // Modal dialog: keep Tab focus inside the scanner.
    if (event.key !== "Tab") return;
    const focusable = [
      ...root.querySelectorAll(
        "button:not([disabled]), [href], input, summary",
      ),
    ].filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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

  // What the camera read (or the customer typed) is text, not a verified
  // card: say which, so it is never mistaken for the catalog match.
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
        ? `${clues.corrected ? "You entered" : clues.source === "ai" ? "Read by AI (not verified)" : "Read from card (text only, not verified)"}: ${read.join(" · ")}`
        : "No readable text found on the card.",
    );
  }

  // Manual correction: edit the name/number that were read, then search the
  // catalog again. Open by default when nothing was identified.
  function correctionForm(clues, open) {
    const details = el("details", "scanner-correct");
    details.open = open;
    details.append(
      el(
        "summary",
        "",
        clues?.names?.length || clues?.identifiers?.length
          ? "Fix what was read"
          : "Type the card details",
      ),
    );
    const form = el("form", "scanner-correct-form");
    const field = (label, name, value, placeholder) => {
      const wrap = el("label", "scanner-field");
      const input = el("input");
      input.name = name;
      input.value = value;
      input.placeholder = placeholder;
      input.autocomplete = "off";
      input.spellcheck = false;
      wrap.append(el("span", "", label), input);
      return wrap;
    };
    const readNumber = clues?.identifiers?.find((item) => item.query);
    form.append(
      field("Card name", "name", clues?.names?.[0] ?? "", "e.g. Charizard ex"),
      field(
        "Card number",
        "number",
        readNumber?.query ?? "",
        "e.g. 199/165 or OP05-119",
      ),
    );
    const submit = el("button", "button button--secondary", "Search again");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      state.session.rematch(
        correctClues(
          clues,
          { name: data.get("name"), number: data.get("number") },
          state.options.selectedGame(),
        ),
      );
    });
    details.append(form);
    return details;
  }

  // Offered after OCR, never automatically: the photo leaves the device only
  // when the customer taps the button.
  function aiBlock(next, primary) {
    if (!aiEnabled || !state.session.canIdentifyWithAi) return null;
    const block = el("div", "scanner-ai");
    block.append(
      button(
        "Identify with AI",
        primary ? "button" : "button button--secondary",
        () => state.session.identifyWithAi(),
      ),
      el(
        "p",
        "scanner-ai-note",
        "Sends this card photo to our server, where Anthropic’s Claude AI reads the name and number. The photo isn’t saved by this site. You still confirm the card.",
      ),
    );
    if (next.aiError)
      block.append(
        el("p", "scanner-read", `AI identification failed: ${next.aiError}`),
      );
    return block;
  }

  function candidate(item, primary, { emphasizeSet = false } = {}) {
    const { card } = item;
    const row = el(
      "div",
      primary ? "scan-candidate is-primary" : "scan-candidate",
    );
    const info = el("div", "scan-candidate-info");
    // Character name without catalog-only tags — set/product carry the
    // One Piece reprint identity (ST-32 vs Learn Together vs Parallel).
    const title = printedName(card.name) || card.name;
    const name = el("strong", "", title);
    if (card.demo) name.append(" ", el("em", "demo-tag", "Demo"));
    info.append(name);
    const labels = variantLabels(card.name);
    if (labels.length)
      info.append(el("span", "scan-candidate-variant", labels.join(" · ")));
    info.append(
      el(
        "span",
        emphasizeSet ? "scan-candidate-set is-emphasis" : "scan-candidate-set",
        card.set_name || "Set not listed",
      ),
    );
    info.append(
      el(
        "span",
        "scan-candidate-printing",
        [
          card.card_number,
          card.printing,
          card.rarity,
          card.language && card.language !== "English" ? card.language : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Printing not listed",
      ),
    );
    const meta = gameLabel(item.game);
    if (meta) info.append(el("small", "", meta));
    if (item.numberConflict)
      info.append(
        el(
          "small",
          "scan-candidate-conflict",
          `Number on this card: ${card.card_number}. Read from your card: ${item.readNumbers.join(", ")}.`,
        ),
      );
    if (item.nameConflict)
      info.append(
        el(
          "small",
          "scan-candidate-conflict",
          "Only the number matches: the name read from your card is not this card's name.",
        ),
      );
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
            "Your browser may ask to use the camera. Photos stay on this device unless you choose AI identification.",
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
              : next.step === "ai"
                ? "AI is reading the card…"
                : "Reading the card…";
        fill(
          el(
            "p",
            "scanner-note",
            next.step === "ai"
              ? "Sending the photo for AI identification. This can take up to 20 seconds."
              : "Reading printed text on the card. This can take a few seconds.",
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
        const matchNote = el(
          "p",
          "scanner-note",
          `Catalog match from ${clues?.source === "ai" ? "the AI’s reading of" : "the text on"} the card. Check the set and printing (foil, edition) yourself; condition is never judged from the photo.`,
        );
        if (match.status === MATCH_STATUS.IDENTIFIED) {
          hint.textContent = "Card found";
          fill(
            el("span", "eyebrow", "Card found"),
            candidate(match.candidates[0], true),
            matchNote,
            cluesLine(clues),
            correctionForm(clues, false),
            actions(againButton(), manualButton()),
          );
        } else if (match.status === MATCH_STATUS.NEEDS_CONFIRMATION) {
          hint.textContent = "Confirm your card";
          const list = el("div", "scan-candidates");
          // Only a card whose evidence beats the rest is highlighted, and all
          // of its printings equally: the scan says which card, never which
          // printing (1st Edition and Unlimited can differ several-fold).
          // Same-number multi-set groups (OP12-020 ST-32 vs Learn Together)
          // never get a lead — set/product must be chosen explicitly.
          const cardOf = (item) => item.card.provider_card_id ?? item.card.id;
          const lead =
            match.leader === true ? cardOf(match.candidates[0]) : null;
          const setChoice = match.setChoice === true;
          match.candidates.forEach((item) =>
            list.append(
              candidate(item, lead !== null && cardOf(item) === lead, {
                emphasizeSet: setChoice,
              }),
            ),
          );
          const readNumbers = (clues?.identifiers ?? [])
            .filter((item) => item.query)
            .map((item) => item.raw ?? item.query);
          const cardCount = new Set(
            match.candidates.map(
              (item) => item.card.provider_card_id ?? item.card.id,
            ),
          ).size;
          // Printings that share the number read (alternate art, manga, SP,
          // reprints…) print the same name and number, so the text read
          // cannot choose between them, yet their values can differ several
          // hundredfold. Say so, with the range, instead of implying a pick.
          const numbered = match.candidates.filter(
            (item) => item.numberMatch && !item.nameConflict,
          );
          const printingChoice =
            !match.leader && new Set(numbered.map(cardOf)).size > 1;
          const nm = numbered
            .map((item) => item.card.pricing?.NM?.reference_cents)
            .filter(Number.isSafeInteger);
          const unpriced = numbered.length - nm.length;
          const valueRange =
            nm.length > 1 && Math.max(...nm) > Math.min(...nm)
              ? `their Near Mint market references range from ${formatMoney(Math.min(...nm))} to ${formatMoney(Math.max(...nm))}`
              : "they can differ in value";
          // needsNumber is about missing collector-number evidence; the title
          // must match what is actually listed (never "several" for one row).
          const askForNumber =
            match.needsNumber === true ||
            (cardCount >= 1 &&
              !readNumbers.length &&
              !numbered.length &&
              (cardCount > 1 || match.moreCards > 0));
          const setCount = match.setCount || numbered.length;
          fill(
            el("span", "eyebrow", "Needs confirmation"),
            el(
              "p",
              "scanner-title",
              match.checkNumber
                ? "The name and number we read point to different cards."
                : setChoice
                  ? `${setCount} sets share this number. Which set and printing is yours?`
                  : askForNumber && cardCount > 1
                    ? "Several cards match the name. Which one is yours?"
                    : askForNumber && cardCount === 1
                      ? "We need the card number to confirm this printing."
                      : printingChoice
                        ? `${new Set(numbered.map(cardOf)).size} printings share this number. Which one is yours?`
                        : match.candidates.length > 1
                          ? "Which card is in your hand?"
                          : "Is this your card?",
            ),
            setChoice
              ? el(
                  "p",
                  "scanner-note scanner-set-choice",
                  `One Piece reprints keep the same collector number across starter decks, Learn Together products, parallels and promos. Check the set or product name on each row (not just the number) — prices differ${nm.length > 1 && Math.max(...nm) > Math.min(...nm) ? ` (${valueRange})` : ""}. The shop confirms set and printing in person.`,
                )
              : printingChoice
                ? el(
                    "p",
                    "scanner-note scanner-printing-choice",
                    `They print the same name and number but differ in artwork, and ${valueRange}${unpriced ? ` (${unpriced} with no online price)` : ""}. Compare the artwork, set and label (e.g. Alternate Art, Manga, SP) with your card. The shop checks the printing in person.`,
                  )
                : null,
            match.checkNumber
              ? el(
                  "p",
                  "scanner-note scanner-needs-number",
                  clues?.corrected
                    ? `Check the name and number (${readNumbers.join(", ")}) printed on your card and correct them below.`
                    : `We may have misread the number (${readNumbers.join(", ")}). Check the name and number printed on your card and correct them below if they differ.`,
                )
              : askForNumber
                ? el(
                    "p",
                    "scanner-note scanner-needs-number",
                    readNumbers.length
                      ? `The number we read (${readNumbers.join(", ")}) doesn't match any of these cards. Check the number printed at the bottom of your card and type it below, or compare the set and number of each match.`
                      : "We read the name but not the card number, so we can't tell which set or printing this is. Type the number at the bottom of your card (e.g. OP02-030 or 43/64) below — that finds parallels and alternate arts the name alone cannot.",
                  )
                : match.numberOnly && !clues?.corrected
                  ? el(
                      "p",
                      "scanner-note scanner-number-only",
                      `Matched only by the number we read (${readNumbers.join(", ")}); we could not read the name. Check that the name and number match your card.`,
                    )
                  : null,
            list,
            match.moreCards > 0
              ? el(
                  "p",
                  "scanner-note",
                  numbered.length
                    ? `${match.moreCards} more cards with a different number are not shown.`
                    : `Showing ${cardCount} matching cards; ${match.moreCards} more match. Type the card number to reach other printings (including alternate arts).`,
                )
              : null,
            matchNote,
            cluesLine(clues),
            aiBlock(next, false),
            correctionForm(
              clues,
              match.needsNumber === true ||
                match.checkNumber === true ||
                askForNumber,
            ),
            actions(againButton(), manualButton()),
          );
        } else {
          hint.textContent = "Not identified";
          // In demo mode a readable name usually means "not one of the sample cards", not a bad photo.
          const notInDemo = state.options?.isDemo() && clues?.names?.length;
          // Nothing usable read: blur, glare, distance or a blank face look the same to OCR, so give the advice for all.
          const unread = match.reason === "no_text";
          const aiUnread = match.reason === "ai_unread";
          fill(
            el("span", "eyebrow", "Could not identify"),
            el(
              "p",
              "scanner-title",
              aiUnread
                ? "The AI couldn’t read this card either."
                : unread
                  ? "We couldn’t read the card."
                  : notInDemo
                    ? `We read “${clues.names[0]}”, but it isn’t in the demo catalog.`
                    : "We couldn’t confidently identify this card.",
            ),
            el(
              "p",
              "scanner-note",
              aiUnread
                ? "Try another photo with the whole card in the frame and less glare, or type the card details below."
                : unread
                  ? "Hold the phone steady about 15–20 cm (6–8 in) from the card, wait for it to focus, then capture. Good light helps; avoid glare."
                  : notInDemo
                    ? "Demo mode can only match its few sample cards. With live pricing connected, the full catalog is searched."
                    : "Try again with the whole card in the frame and less glare, fix what was read below, or search by name.",
            ),
            cluesLine(clues),
            aiBlock(next, true),
            correctionForm(clues, true),
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
        if (next.code === SCAN_ERROR.SEARCH_FAILED && next.clues)
          fill(cluesLine(next.clues), correctionForm(next.clues, false));
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
