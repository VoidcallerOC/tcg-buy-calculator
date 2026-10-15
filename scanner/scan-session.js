// ScanSession: CameraCapture → ImagePreprocessor → OCR → CardIdentifier →
// CatalogMatcher, as a DOM-free state machine. The UI renders each state; the
// confirmed card is handed back to the existing calculator by the caller.
import { CameraError, CAMERA_ERROR } from "./camera-capture.js";
import {
  correctClues,
  extractClues,
  hasUsableClues,
} from "./card-identifier.js";
import { matchCatalog, MATCH_STATUS } from "./catalog-matcher.js";
import { OcrUnavailableError } from "./ocr-engine.js";

export const SCAN_STATE = {
  IDLE: "idle",
  STARTING: "starting",
  LIVE: "live",
  PROCESSING: "processing",
  RESULT: "result",
  ERROR: "error",
};

export const SCAN_ERROR = {
  ...CAMERA_ERROR,
  OCR_UNAVAILABLE: "ocr_unavailable",
  OCR_FAILED: "ocr_failed",
  SEARCH_FAILED: "search_failed",
};

const NOT_IDENTIFIED = (reason) => ({
  status: MATCH_STATUS.NOT_IDENTIFIED,
  candidates: [],
  reason,
});

/**
 * @param {object} deps
 * @param {{ start(view): Promise<void>, capture(view): any | Promise<any>, stop(view): void }} deps.camera
 * @param {(frame) => { region: string, image: any }[]} deps.preprocess
 * @param {{ recognize(image): Promise<{ text: string, confidence: number }> }} deps.ocr
 * @param {(query: string, game: string) => Promise<object[]>} deps.search the calculator's lookup
 * @param {() => string} deps.selectedGame
 * @param {(state: object) => void} deps.onState
 * @param {(frame, game: string) => Promise<{ name: string, number: string, game: string|null } | null>} [deps.identify]
 *   optional AI reader; runs only when the customer asks for it
 */
export function createScanSession({
  camera,
  preprocess,
  ocr,
  search,
  selectedGame,
  onState,
  identify,
}) {
  let run = 0;
  let view = null;
  let lastFrame = null; // the captured photo, kept only for an AI request
  let state = { status: SCAN_STATE.IDLE };
  const set = (next, token) => {
    if (token !== undefined && token !== run) return false; // cancelled or superseded
    state = next;
    onState(next);
    return true;
  };
  const fail = (code, token, detail = {}) =>
    set({ status: SCAN_STATE.ERROR, code, ...detail }, token);
  const match = async (clues, token) => {
    if (!set({ status: SCAN_STATE.PROCESSING, step: "matching", clues }, token))
      return;
    try {
      const result = await matchCatalog(clues, {
        selectedGame: selectedGame(),
        search,
      });
      set({ status: SCAN_STATE.RESULT, match: result, clues }, token);
    } catch (error) {
      fail(SCAN_ERROR.SEARCH_FAILED, token, {
        message: error?.message,
        clues,
      });
    }
  };

  return {
    get state() {
      return state;
    },

    async open(target) {
      view = target ?? view;
      const token = ++run;
      set({ status: SCAN_STATE.STARTING }, token);
      try {
        await camera.start(view);
      } catch (error) {
        fail(
          error instanceof CameraError ? error.code : SCAN_ERROR.FAILED,
          token,
        );
        return;
      }
      // Closed (or superseded by close) while the camera was starting: the
      // stream that just arrived must not keep running behind a hidden dialog.
      if (token !== run) {
        if (state.status === SCAN_STATE.IDLE) camera.stop(view);
        return;
      }
      set({ status: SCAN_STATE.LIVE }, token);
    },

    async capture() {
      if (state.status !== SCAN_STATE.LIVE) return;
      const token = ++run;
      set({ status: SCAN_STATE.PROCESSING, step: "capturing" }, token);
      let frame;
      lastFrame = null;
      try {
        frame = await camera.capture(view);
      } catch {
        return fail(SCAN_ERROR.CAPTURE_FAILED, token);
      }
      lastFrame = frame;
      if (!set({ status: SCAN_STATE.PROCESSING, step: "reading" }, token))
        return;
      const passes = [];
      try {
        for (const { region, image } of preprocess(frame)) {
          const result = await ocr.recognize(image);
          if (token !== run) return;
          passes.push({ region, ...result });
        }
      } catch (error) {
        return fail(
          error instanceof OcrUnavailableError
            ? SCAN_ERROR.OCR_UNAVAILABLE
            : SCAN_ERROR.OCR_FAILED,
          token,
        );
      }
      const clues = extractClues(passes);
      if (!hasUsableClues(clues))
        return set(
          {
            status: SCAN_STATE.RESULT,
            match: {
              status: MATCH_STATUS.NOT_IDENTIFIED,
              candidates: [],
              reason: "no_text",
            },
            clues,
          },
          token,
        );
      return match(clues, token);
    },

    // Search again with corrected clues (typed by the customer after a scan).
    // The camera keeps running; nothing is matched without a search.
    async rematch(clues) {
      if (
        state.status !== SCAN_STATE.RESULT &&
        !(
          state.status === SCAN_STATE.ERROR &&
          state.code === SCAN_ERROR.SEARCH_FAILED
        )
      )
        return;
      const token = ++run;
      if (!hasUsableClues(clues))
        return set(
          {
            status: SCAN_STATE.RESULT,
            match: {
              status: MATCH_STATUS.NOT_IDENTIFIED,
              candidates: [],
              reason: "no_text",
            },
            clues,
          },
          token,
        );
      return match(clues, token);
    },

    // AI fallback, only on the customer's request: the AI's reading of the
    // last photo becomes clues for the same catalog search. It never picks or
    // prices a card itself.
    get canIdentifyWithAi() {
      return (
        typeof identify === "function" &&
        Boolean(lastFrame) &&
        state.status === SCAN_STATE.RESULT &&
        state.clues?.source !== "ai"
      );
    },

    async identifyWithAi() {
      if (!this.canIdentifyWithAi) return;
      const previous = state;
      const token = ++run;
      set(
        { status: SCAN_STATE.PROCESSING, step: "ai", clues: previous.clues },
        token,
      );
      let card;
      try {
        card = await identify(lastFrame, selectedGame());
      } catch (error) {
        // Keep the OCR result and its correction form; say what failed.
        return set({ ...previous, aiError: error?.message || "failed" }, token);
      }
      if (token !== run) return;
      const clues = {
        ...correctClues(
          previous.clues,
          {
            name: card?.name,
            number: card?.number,
            setName: card?.set_name,
          },
          card?.game || selectedGame(),
        ),
        corrected: false,
        source: "ai",
      };
      if (!hasUsableClues(clues))
        return set(
          {
            status: SCAN_STATE.RESULT,
            match: NOT_IDENTIFIED("ai_unread"),
            clues,
          },
          token,
        );
      return match(clues, token);
    },

    // Back to the live camera (camera keeps running between scans).
    async retry() {
      return this.open(view);
    },

    close() {
      run += 1;
      lastFrame = null;
      camera.stop(view);
      set({ status: SCAN_STATE.IDLE });
    },
  };
}
