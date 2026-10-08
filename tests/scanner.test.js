// Scanner pipeline tests: deterministic, no camera or OCR engine. Camera and
// OCR are replaced with fakes; identification and matching run for real
// against tests/fixtures/scanner-catalog.json. Run: node --test tests/scanner.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CameraCapture,
  CameraError,
  CAMERA_ERROR,
  cameraSupport,
  classifyCameraError,
  mapGuideToVideo,
  sharpness,
} from "../scanner/camera-capture.js";
import {
  bestSearchQuery,
  extractClues,
  hasUsableClues,
} from "../scanner/card-identifier.js";
import {
  matchCatalog,
  MATCH_STATUS,
  nameSimilarity,
  normalizeNumber,
  planQueries,
} from "../scanner/catalog-matcher.js";
import { enhanceContrast, targetSize } from "../scanner/image-preprocessor.js";
import { OcrUnavailableError } from "../scanner/ocr-engine.js";
import {
  createScanSession,
  SCAN_STATE,
  SCAN_ERROR,
} from "../scanner/scan-session.js";
import { calculateOffer, parsePercentageToBasisPoints } from "../lib/money.js";

const fixtureCatalog = JSON.parse(
  readFileSync(new URL("./fixtures/scanner-catalog.json", import.meta.url)),
);
const config = JSON.parse(
  readFileSync(new URL("../data/config.json", import.meta.url)),
);
const CONDITIONS = [
  { name: "Near Mint", code: "NM" },
  { name: "Lightly Played", code: "LP" },
  { name: "Moderately Played", code: "MP" },
  { name: "Heavily Played", code: "HP" },
  { name: "Damaged", code: "DMG" },
];

function searchFixtureCatalog(catalog, query, game) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return (catalog?.cards ?? []).filter(
    (card) =>
      card.game === game &&
      terms.every((term) =>
        `${card.name} ${card.set_name} ${card.card_number}`
          .toLowerCase()
          .includes(term),
      ),
  );
}

const fixtureSearch = async (query, game) =>
  searchFixtureCatalog(fixtureCatalog, query, game);
const ocrPasses = (full, bottom = "") => [
  { region: "full", text: full, confidence: 80 },
  { region: "bottom", text: bottom, confidence: 70 },
];

// ---------- CardIdentifier ----------

test("reads identifiers for each supported game", () => {
  const cases = [
    ["Charizard ex\nHP 330\n199/165 SIR", "pokemon", "199/165"],
    ["Monkey.D.Luffy\nOP05-119 SEC", "one-piece-card-game", "OP05-119"],
    ["Ash Blossom & Joyous Spring\nMACR-EN036", "yugioh", "MACR-EN036"],
    [
      "Sheoldred, the Apocalypse\n0107 M\nDMU • EN",
      "magic-the-gathering",
      "107",
    ],
  ];
  for (const [text, game, query] of cases) {
    const clues = extractClues(ocrPasses(text));
    assert.ok(
      clues.identifiers.some(
        (item) => item.game === game && item.query === query,
      ),
      `${game}: ${JSON.stringify(clues.identifiers)}`,
    );
  }
});

test("fixes OCR look-alike characters inside identifiers", () => {
  const clues = extractClues(ocrPasses("OP0S-1l9"));
  assert.ok(clues.identifiers.some((item) => item.query === "OP05-119"));
  assert.ok(
    extractClues(ocrPasses("LOB-ENOO1")).identifiers.some(
      (item) => item.query === "LOB-EN001",
    ),
  );
});

test("reads set code and language where printed", () => {
  const ygo = extractClues(ocrPasses("MACR-EN036"));
  assert.equal(ygo.language, "en");
  const mtg = extractClues(ocrPasses("0107 M\nDMU • EN"));
  assert.deepEqual(mtg.setCodes, ["DMU"]);
});

test("name candidates skip rules text and card-type words", () => {
  const clues = extractClues(
    ocrPasses(
      "Basic\nCharizard ex\nWeakness Resistance Retreat\nDiscard 2 Energy from this Pokémon\n199/165",
    ),
  );
  assert.equal(clues.names[0], "Charizard ex");
  assert.ok(!clues.names.some((name) => /Weakness|Discard/.test(name)));
});

test("manual-search prefill: name read first, else the printed identifier", () => {
  assert.equal(
    bestSearchQuery(extractClues(ocrPasses("Nami\nOP01-016"))),
    "Nami",
  );
  assert.equal(
    bestSearchQuery(extractClues(ocrPasses("~~", "OP01-016"))),
    "OP01-016",
  );
  assert.equal(bestSearchQuery(extractClues(ocrPasses("~~", ".."))), "");
  assert.equal(bestSearchQuery(null), "");
});

test("OCR junk is not a name: low line confidence or no real word", () => {
  const passes = [
    {
      region: "full",
      text: "op TH\ngain",
      confidence: 18,
      lines: [
        { text: "op TH", confidence: 22 },
        { text: "gain", confidence: 31 },
      ],
    },
  ];
  assert.deepEqual(extractClues(passes).names, []);
  assert.deepEqual(extractClues(ocrPasses("op TH")).names, []); // no 3-letter word even without line scores
});

test("high-confidence lines are names; bottom-strip names (One Piece) count after full-card ones", () => {
  const passes = [
    {
      region: "full",
      text: "",
      confidence: 50,
      lines: [{ text: "Leader", confidence: 90 }],
    },
    {
      region: "bottom",
      text: "Monkey.D.Luffy OP05-119",
      confidence: 85,
      lines: [
        { text: "Monkey.D.Luffy", confidence: 88 },
        { text: "OP05-119", confidence: 80 },
      ],
    },
  ];
  assert.ok(extractClues(passes).names.includes("Monkey.D.Luffy"));
});

test("One Piece code survives a doubled O misread (OPO05-119)", () => {
  assert.ok(
    extractClues(ocrPasses("OPO05-119")).identifiers.some(
      (item) => item.query === "OP05-119",
    ),
  );
});

test("unreadable text yields no usable clues", () => {
  const clues = extractClues(ocrPasses("~~ ;; ..\n# @", "|| --"));
  assert.equal(hasUsableClues(clues), false);
});

// ---------- CatalogMatcher ----------

test("number and name agreement → IDENTIFIED, still a single candidate to confirm", async () => {
  const clues = extractClues(ocrPasses("Charizard ex\n199/165"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: fixtureSearch,
  });
  assert.equal(match.status, MATCH_STATUS.IDENTIFIED);
  assert.equal(match.candidates.length, 1);
  assert.equal(match.candidates[0].card.card_number, "199/165");
});

test("identifier for another game searches that game too", async () => {
  const clues = extractClues(ocrPasses("Monkey.D.Luffy\nOP05-119"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: fixtureSearch,
  });
  assert.equal(match.status, MATCH_STATUS.IDENTIFIED);
  assert.equal(match.candidates[0].game, "one-piece-card-game");
});

test("name-only read never auto-identifies → NEEDS_CONFIRMATION", async () => {
  const clues = extractClues(ocrPasses("Charizard ex"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: fixtureSearch,
  });
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
});

test("multiple plausible matches → NEEDS_CONFIRMATION with all candidates", async () => {
  const cards = [
    { id: "a", name: "Pikachu", set_name: "Base Set", card_number: "58/102" },
    { id: "b", name: "Pikachu", set_name: "Jungle", card_number: "60/64" },
  ];
  const clues = extractClues(ocrPasses("Pikachu"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: async () => cards,
  });
  assert.equal(match.status, MATCH_STATUS.NEEDS_CONFIRMATION);
  assert.equal(match.candidates.length, 2);
});

test("low-confidence matches are dropped → NOT_IDENTIFIED, no guess", async () => {
  const clues = extractClues(ocrPasses("Totally Unknown Thing\n999/998"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: async () => [
      { id: "x", name: "Charizard ex", card_number: "199/165" },
    ],
  });
  assert.equal(match.status, MATCH_STATUS.NOT_IDENTIFIED);
  assert.equal(match.candidates.length, 0);
});

test("no catalog match → NOT_IDENTIFIED (demo catalog is never substituted)", async () => {
  const clues = extractClues(ocrPasses("Mewtwo\n150/165"));
  const match = await matchCatalog(clues, {
    selectedGame: "pokemon",
    search: fixtureSearch,
  });
  assert.equal(match.status, MATCH_STATUS.NOT_IDENTIFIED);
});

test("search errors propagate (no silent fallback)", async () => {
  const clues = extractClues(ocrPasses("Charizard ex\n199/165"));
  await assert.rejects(
    matchCatalog(clues, {
      selectedGame: "pokemon",
      search: async () => {
        throw new Error("Live pricing provider request failed.");
      },
    }),
    /provider request failed/,
  );
});

test("matching helpers", () => {
  assert.equal(normalizeNumber(" 0107 "), "107");
  assert.equal(normalizeNumber("op05-119"), "OP05-119");
  assert.equal(nameSimilarity("Charizard ex", "Charizard ex"), 1);
  assert.equal(nameSimilarity("Charizard", "Blue-Eyes White Dragon"), 0);
  const plan = planQueries(
    extractClues(ocrPasses("Charizard ex\n199/165")),
    "pokemon",
  );
  assert.deepEqual(plan[0], { game: "pokemon", query: "199/165" });
  assert.ok(plan.length <= 4);
});

// ---------- CameraCapture ----------

test("camera support: unsupported browser and insecure context", () => {
  assert.equal(
    cameraSupport({ isSecureContext: true, navigator: {} }),
    CAMERA_ERROR.UNSUPPORTED,
  );
  assert.equal(
    cameraSupport({
      isSecureContext: false,
      navigator: { mediaDevices: { getUserMedia() {} } },
    }),
    CAMERA_ERROR.INSECURE,
  );
  assert.equal(
    cameraSupport({
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia() {} } },
    }),
    null,
  );
});

test("camera errors are classified", () => {
  assert.equal(
    classifyCameraError({ name: "NotAllowedError" }),
    CAMERA_ERROR.DENIED,
  );
  assert.equal(
    classifyCameraError({ name: "NotFoundError" }),
    CAMERA_ERROR.UNAVAILABLE,
  );
  assert.equal(
    classifyCameraError({ name: "OverconstrainedError" }),
    CAMERA_ERROR.UNAVAILABLE,
  );
  assert.equal(
    classifyCameraError({ name: "NotReadableError" }),
    CAMERA_ERROR.BUSY,
  );
  assert.equal(
    classifyCameraError({ name: "NotSupportedError" }),
    CAMERA_ERROR.UNSUPPORTED,
  );
  assert.equal(classifyCameraError({ name: "Weird" }), CAMERA_ERROR.FAILED);
});

test("CameraCapture requests the rear camera and maps denial", async () => {
  let constraints;
  const env = {
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: async (c) => {
          constraints = c;
          throw Object.assign(new Error("no"), { name: "NotAllowedError" });
        },
      },
    },
  };
  await assert.rejects(
    new CameraCapture(env).start({}),
    (error) =>
      error instanceof CameraError && error.code === CAMERA_ERROR.DENIED,
  );
  assert.deepEqual(constraints.video.facingMode, { ideal: "environment" });
  assert.equal(constraints.audio, false);
});

test("sharpness: crisp edges score higher than a blurred copy", () => {
  const w = 40,
    h = 40,
    crisp = new Float32Array(w * h),
    blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      crisp[y * w + x] = ((x >> 2) + (y >> 2)) % 2 ? 255 : 0;
  for (let y = 1; y < h - 1; y += 1)
    for (let x = 1; x < w - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) s += crisp[(y + dy) * w + x + dx];
      blurred[y * w + x] = s / 9;
    }
  assert.ok(sharpness(crisp, w, h) > sharpness(blurred, w, h) * 2);
  assert.equal(sharpness(new Float32Array(w * h).fill(128), w, h), 0);
});

test("guide maps to video pixels under object-fit: cover", () => {
  // 1920x1080 video shown in a 390x600 portrait box: scaled by 600/1080, cropped left/right.
  const rect = mapGuideToVideo({
    containerWidth: 390,
    containerHeight: 600,
    videoWidth: 1920,
    videoHeight: 1080,
    guide: { x: 61, y: 48, width: 268, height: 374 },
    pad: 0,
  });
  const scale = 600 / 1080,
    offsetX = (390 - 1920 * scale) / 2;
  assert.equal(rect.x, Math.round((61 - offsetX) / scale));
  assert.equal(rect.y, Math.round(48 / scale));
  assert.equal(rect.width, Math.round(268 / scale));
  assert.equal(rect.height, Math.round(374 / scale));
});

// ---------- ImagePreprocessor ----------

test("contrast enhancement stretches a dim image to full range in grayscale", () => {
  const data = new Uint8ClampedArray([
    100, 100, 100, 255, 120, 120, 120, 255, 140, 140, 140, 255, 160, 160, 160,
    255,
  ]);
  enhanceContrast(data);
  assert.equal(data[0], 0);
  assert.equal(data[12], 255);
  assert.equal(data[4], data[5]);
  assert.deepEqual(targetSize(300, 50, 1800), { width: 1200, height: 200 }); // capped at 4x
});

// ---------- ScanSession (state machine) ----------

function harness({
  startError,
  captureError,
  ocrText = ["Charizard ex", "199/165"],
  ocrError,
  search = fixtureSearch,
} = {}) {
  const states = [];
  let stopped = 0;
  const camera = {
    start: async () => {
      if (startError) throw startError;
    },
    capture: () => {
      if (captureError) throw captureError;
      return { frame: true };
    },
    stop: () => {
      stopped += 1;
    },
  };
  const ocr = {
    recognize: async (image) => {
      if (ocrError) throw ocrError;
      return {
        text: image === "full" ? ocrText[0] : ocrText[1],
        confidence: 80,
      };
    },
  };
  const session = createScanSession({
    camera,
    preprocess: () => [
      { region: "full", image: "full" },
      { region: "bottom", image: "bottom" },
    ],
    ocr,
    search,
    selectedGame: () => "pokemon",
    onState: (s) => states.push(s),
  });
  return { session, states, stopped: () => stopped };
}

test("permission granted → live → capture → IDENTIFIED", async () => {
  const { session, states } = harness();
  await session.open();
  assert.equal(session.state.status, SCAN_STATE.LIVE);
  await session.capture();
  assert.deepEqual(
    states.map((s) => s.step ?? s.status),
    ["starting", "live", "capturing", "reading", "matching", "result"],
  );
  assert.equal(session.state.match.status, MATCH_STATUS.IDENTIFIED);
});

test("permission denied / unavailable / unsupported → error with code", async () => {
  for (const code of [
    CAMERA_ERROR.DENIED,
    CAMERA_ERROR.UNAVAILABLE,
    CAMERA_ERROR.UNSUPPORTED,
    CAMERA_ERROR.INSECURE,
  ]) {
    const { session } = harness({ startError: new CameraError(code) });
    await session.open();
    assert.equal(session.state.status, SCAN_STATE.ERROR);
    assert.equal(session.state.code, code);
  }
});

test("capture failure → error, retry returns to live", async () => {
  const h = harness({
    captureError: new CameraError(CAMERA_ERROR.CAPTURE_FAILED),
  });
  await h.session.open();
  await h.session.capture();
  assert.equal(h.session.state.code, SCAN_ERROR.CAPTURE_FAILED);
  await h.session.retry();
  assert.equal(h.session.state.status, SCAN_STATE.LIVE);
});

test("OCR engine unavailable → honest error, never a card", async () => {
  const { session } = harness({
    ocrError: new OcrUnavailableError(new Error("wasm")),
  });
  await session.open();
  await session.capture();
  assert.equal(session.state.status, SCAN_STATE.ERROR);
  assert.equal(session.state.code, SCAN_ERROR.OCR_UNAVAILABLE);
  assert.equal(session.state.match, undefined);
});

test("unreadable, low-confidence photo → NOT_IDENTIFIED, nothing searched", async () => {
  const states = [];
  const session = createScanSession({
    camera: {
      start: async () => {},
      capture: async () => ({}),
      stop: () => {},
    },
    preprocess: () => [{ region: "full", image: 1 }],
    ocr: {
      recognize: async () => ({
        text: "hh\nos N",
        confidence: 16,
        lines: [{ text: "os N", confidence: 16 }],
      }),
    },
    search: async () => assert.fail("must not search"),
    selectedGame: () => "pokemon",
    onState: (s) => states.push(s),
  });
  await session.open();
  await session.capture();
  assert.equal(session.state.match.status, MATCH_STATUS.NOT_IDENTIFIED);
  assert.equal(session.state.match.reason, "no_text");
});

test("no readable text → NOT_IDENTIFIED without searching", async () => {
  let searched = false;
  const { session } = harness({
    ocrText: ["~~", ".."],
    search: async () => {
      searched = true;
      return [];
    },
  });
  await session.open();
  await session.capture();
  assert.equal(session.state.match.status, MATCH_STATUS.NOT_IDENTIFIED);
  assert.equal(session.state.match.reason, "no_text");
  assert.equal(searched, false);
});

test("provider failure during matching → search_failed error, no demo fallback", async () => {
  const { session } = harness({
    search: async () => {
      throw new Error("Live pricing provider request failed.");
    },
  });
  await session.open();
  await session.capture();
  assert.equal(session.state.code, SCAN_ERROR.SEARCH_FAILED);
  assert.match(session.state.message, /provider request failed/);
});

test("cancel mid-scan stops the camera and ignores late results", async () => {
  let release;
  const slowOcr = new Promise((resolve) => {
    release = resolve;
  });
  const states = [];
  const camera = {
    start: async () => {},
    capture: () => ({}),
    stop: () => states.push("stopped"),
  };
  const session = createScanSession({
    camera,
    preprocess: () => [{ region: "full", image: 1 }],
    ocr: { recognize: () => slowOcr },
    search: fixtureSearch,
    selectedGame: () => "pokemon",
    onState: (s) => states.push(s.status),
  });
  await session.open();
  const pending = session.capture();
  session.close();
  release({ text: "Charizard ex\n199/165", confidence: 90 });
  await pending;
  assert.deepEqual(states, [
    "starting",
    "live",
    "processing",
    "stopped",
    "idle",
  ]); // cancelled during capture: no later state leaks through
  assert.equal(session.state.status, SCAN_STATE.IDLE);
});

// ---------- Calculator integration (60% buy rate unchanged) ----------

test("a scanned card enters calculateOffer at the configured 60% buy rate", async () => {
  const { session } = harness();
  await session.open();
  await session.capture();
  const card = session.state.match.candidates[0].card;
  const rate = parsePercentageToBasisPoints(config.buy_rate ?? "60%");
  assert.equal(rate, 6000);
  assert.equal(config.buy_rate, "60%");
  for (const { code } of CONDITIONS) {
    const pricing = card.pricing[code];
    assert.ok(Number.isSafeInteger(pricing.reference_cents), code);
    const result = calculateOffer(pricing.reference_cents, rate);
    assert.equal(
      result.offerCents,
      Number((BigInt(pricing.reference_cents) * 6000n + 5000n) / 10000n),
      code,
    );
  }
});
