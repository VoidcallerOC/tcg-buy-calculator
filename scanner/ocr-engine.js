// OCR engine boundary. The shipped engine is Tesseract.js, self-hosted under
// ./vendor and run in a Web Worker inside the browser: captured images are
// never uploaded. Any other engine (e.g. a server-side vision service) only
// needs to implement `recognize(image) -> { text, confidence }`.

export class OcrUnavailableError extends Error {
  constructor(cause) {
    super("Card text reader could not be loaded on this device.");
    this.name = "OcrUnavailableError";
    this.cause = cause;
  }
}

const VENDOR = new URL("./vendor/tesseract/", import.meta.url).href;
const LOAD_TIMEOUT_MS = 45_000;
const RECOGNIZE_TIMEOUT_MS = 60_000;

// The engine can abort inside its worker without rejecting; never wait forever.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Same byte check wasm-feature-detect uses for WebAssembly SIMD.
function supportsSimd() {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10,
        1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

export function createTesseractEngine({ base = VENDOR, onProgress } = {}) {
  let workerPromise = null;
  async function getWorker() {
    workerPromise ??= (async () => {
      if (typeof WebAssembly !== "object" || typeof Worker !== "function")
        throw new Error("WebAssembly workers unsupported");
      const { default: Tesseract } = await import(
        `${base}tesseract.esm.min.js`
      );
      const { createWorker } = Tesseract;
      const worker = await withTimeout(
        createWorker("eng", 1, {
          workerPath: `${base}worker.min.js`,
          corePath: `${base}${supportsSimd() ? "tesseract-core-simd-lstm.js" : "tesseract-core-lstm.js"}`,
          langPath: `${base}lang`,
          workerBlobURL: false,
          logger: (message) => onProgress?.(message),
          errorHandler: () => {},
        }),
        LOAD_TIMEOUT_MS,
        "OCR engine load",
      );
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        preserve_interword_spaces: "1",
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw new OcrUnavailableError(error);
    });
    return workerPromise;
  }
  return {
    name: "tesseract.js",
    async recognize(image) {
      const worker = await getWorker();
      const { data } = await withTimeout(
        worker.recognize(image, {}, { text: true, blocks: true }),
        RECOGNIZE_TIMEOUT_MS,
        "OCR",
      );
      const lines = (data.blocks ?? [])
        .flatMap((block) => block.paragraphs ?? [])
        .flatMap((paragraph) => paragraph.lines ?? [])
        .map((line) => ({
          text: String(line.text ?? "").trim(),
          confidence: Number(line.confidence) || 0,
        }))
        .filter((line) => line.text);
      return {
        text: data.text ?? "",
        confidence: Number(data.confidence) || 0,
        lines,
      };
    },
    async terminate() {
      const pending = workerPromise;
      workerPromise = null;
      if (pending) await (await pending.catch(() => null))?.terminate();
    },
  };
}
