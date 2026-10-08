// ScanSession: CameraCapture → ImagePreprocessor → OCR → CardIdentifier →
// CatalogMatcher, as a DOM-free state machine. The UI renders each state; the
// confirmed card is handed back to the existing calculator by the caller.
import { CameraError, CAMERA_ERROR } from "./camera-capture.js";
import { extractClues, hasUsableClues } from "./card-identifier.js";
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

/**
 * @param {object} deps
 * @param {{ start(view): Promise<void>, capture(view): any | Promise<any>, stop(view): void }} deps.camera
 * @param {(frame) => { region: string, image: any }[]} deps.preprocess
 * @param {{ recognize(image): Promise<{ text: string, confidence: number }> }} deps.ocr
 * @param {(query: string, game: string) => Promise<object[]>} deps.search the calculator's lookup
 * @param {() => string} deps.selectedGame
 * @param {(state: object) => void} deps.onState
 */
export function createScanSession({
  camera,
  preprocess,
  ocr,
  search,
  selectedGame,
  onState,
}) {
  let run = 0;
  let view = null;
  let state = { status: SCAN_STATE.IDLE };
  const set = (next, token) => {
    if (token !== undefined && token !== run) return false; // cancelled or superseded
    state = next;
    onState(next);
    return true;
  };
  const fail = (code, token, detail = {}) =>
    set({ status: SCAN_STATE.ERROR, code, ...detail }, token);

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
        set({ status: SCAN_STATE.LIVE }, token);
      } catch (error) {
        fail(
          error instanceof CameraError ? error.code : SCAN_ERROR.FAILED,
          token,
        );
      }
    },

    async capture() {
      if (state.status !== SCAN_STATE.LIVE) return;
      const token = ++run;
      set({ status: SCAN_STATE.PROCESSING, step: "capturing" }, token);
      let frame;
      try {
        frame = await camera.capture(view);
      } catch {
        return fail(SCAN_ERROR.CAPTURE_FAILED, token);
      }
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
      if (
        !set({ status: SCAN_STATE.PROCESSING, step: "matching", clues }, token)
      )
        return;
      try {
        const match = await matchCatalog(clues, {
          selectedGame: selectedGame(),
          search,
        });
        set({ status: SCAN_STATE.RESULT, match, clues }, token);
      } catch (error) {
        fail(SCAN_ERROR.SEARCH_FAILED, token, { message: error?.message });
      }
    },

    // Back to the live camera (camera keeps running between scans).
    async retry() {
      return this.open(view);
    },

    close() {
      run += 1;
      camera.stop(view);
      set({ status: SCAN_STATE.IDLE });
    },
  };
}
