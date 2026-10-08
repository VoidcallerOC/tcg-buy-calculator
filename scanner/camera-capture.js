// CameraCapture: browser camera access and frame capture. The browser owns the
// permission prompt; we only ask after the customer taps "Scan a card".

export const CAMERA_ERROR = {
  UNSUPPORTED: "unsupported",
  INSECURE: "insecure",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  BUSY: "busy",
  FAILED: "failed",
  CAPTURE_FAILED: "capture_failed",
};

export class CameraError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "CameraError";
    this.code = code;
    this.cause = cause;
  }
}

export function cameraSupport(env = globalThis) {
  if (env.isSecureContext === false) return CAMERA_ERROR.INSECURE;
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== "function")
    return CAMERA_ERROR.UNSUPPORTED;
  return null;
}

export function classifyCameraError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return CAMERA_ERROR.DENIED;
    case "SecurityError":
      return CAMERA_ERROR.INSECURE;
    case "NotSupportedError":
      return CAMERA_ERROR.UNSUPPORTED;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return CAMERA_ERROR.UNAVAILABLE;
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return CAMERA_ERROR.BUSY;
    default:
      return CAMERA_ERROR.FAILED;
  }
}

// Maps the on-screen guide (container coordinates) onto the video's own pixels
// for a <video> rendered with object-fit: cover. `pad` keeps a little margin so
// slightly loose framing does not crop the card edge.
export function mapGuideToVideo({
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight,
  guide,
  pad = 0.04,
}) {
  const scale = Math.max(
    containerWidth / videoWidth,
    containerHeight / videoHeight,
  );
  const offsetX = (containerWidth - videoWidth * scale) / 2;
  const offsetY = (containerHeight - videoHeight * scale) / 2;
  const padX = guide.width * pad,
    padY = guide.height * pad;
  const x = Math.max(0, (guide.x - padX - offsetX) / scale);
  const y = Math.max(0, (guide.y - padY - offsetY) / scale);
  const width = Math.min(videoWidth - x, (guide.width + 2 * padX) / scale);
  const height = Math.min(videoHeight - y, (guide.height + 2 * padY) / scale);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

// Focus measure: variance of the Laplacian over a grayscale image. Blurry
// frames have weak edges and score low. Pure, so it is unit-testable.
export function sharpness(gray, width, height) {
  let sum = 0,
    sumSq = 0,
    count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap =
        gray[i - width] +
        gray[i + width] +
        gray[i - 1] +
        gray[i + 1] -
        4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CameraCapture {
  constructor(env = globalThis) {
    this.env = env;
    this.stream = null;
  }

  async start(video) {
    const unsupported = cameraSupport(this.env);
    if (unsupported) throw new CameraError(unsupported);
    if (!this.stream) {
      try {
        this.stream = await this.env.navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (error) {
        throw new CameraError(classifyCameraError(error), error);
      }
    }
    this.requestContinuousFocus();
    video.srcObject = this.stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    try {
      await video.play();
    } catch (error) {
      this.stop(video);
      throw new CameraError(CAMERA_ERROR.FAILED, error);
    }
  }

  // Ask for continuous autofocus where the browser exposes it (e.g. Android
  // Chrome); browsers without the capability ignore this.
  requestContinuousFocus() {
    const track = this.stream?.getVideoTracks?.()[0];
    try {
      if (track?.getCapabilities?.().focusMode?.includes("continuous"))
        track
          .applyConstraints({ advanced: [{ focusMode: "continuous" }] })
          .catch(() => {});
    } catch {
      /* focus control is optional */
    }
  }

  // Samples several frames over ~half a second and keeps the sharpest, so a
  // moment of hand shake or refocus does not ruin the read.
  async captureSharpest(
    video,
    guideElement,
    { frames = 6, intervalMs = 90 } = {},
  ) {
    let best = null;
    for (let index = 0; index < frames; index += 1) {
      if (index) await wait(intervalMs);
      const canvas = this.capture(video, guideElement);
      const score = this.frameSharpness(canvas);
      if (!best || score > best.score) best = { canvas, score };
    }
    return best.canvas;
  }

  frameSharpness(canvas) {
    const width = 240,
      height = Math.max(1, Math.round((canvas.height / canvas.width) * 240));
    const small = this.env.document.createElement("canvas");
    small.width = width;
    small.height = height;
    const context = small.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i += 1)
      gray[i] =
        0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    return sharpness(gray, width, height);
  }

  // Copies the guide region of the current frame into a new canvas.
  capture(video, guideElement) {
    const { videoWidth, videoHeight } = video;
    if (!this.stream || !videoWidth || !videoHeight)
      throw new CameraError(CAMERA_ERROR.CAPTURE_FAILED);
    const box = video.getBoundingClientRect();
    const guideBox = guideElement.getBoundingClientRect();
    const rect = mapGuideToVideo({
      containerWidth: box.width,
      containerHeight: box.height,
      videoWidth,
      videoHeight,
      guide: {
        x: guideBox.left - box.left,
        y: guideBox.top - box.top,
        width: guideBox.width,
        height: guideBox.height,
      },
    });
    if (rect.width < 50 || rect.height < 50)
      throw new CameraError(CAMERA_ERROR.CAPTURE_FAILED);
    const canvas = this.env.document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext("2d");
    if (!context) throw new CameraError(CAMERA_ERROR.CAPTURE_FAILED);
    context.drawImage(
      video,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    return canvas;
  }

  stop(video) {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (video) video.srcObject = null;
  }
}
