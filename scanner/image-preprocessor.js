// ImagePreprocessor: prepares a captured card for OCR. Produces a full-card
// image (names, Yu-Gi-Oh! set codes) and an enlarged bottom strip, where most
// games print the collector number in small type.

// Grayscale + contrast stretch between the 2nd and 98th luminance percentiles.
// Operates in place on RGBA pixel data; pure, so it is unit-testable.
export function enhanceContrast(data) {
  const histogram = new Uint32Array(256);
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
    );
    data[i] = data[i + 1] = data[i + 2] = luma;
    histogram[luma] += 1;
  }
  const percentile = (target) => {
    let count = 0;
    for (let value = 0; value < 256; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  };
  const low = percentile(pixels * 0.02),
    high = percentile(pixels * 0.98);
  const range = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.max(
      0,
      Math.min(255, Math.round(((data[i] - low) * 255) / range)),
    );
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  return data;
}

// Output size for a region so the card text is large enough for OCR.
export function targetSize(width, height, targetWidth) {
  const scale = Math.min(4, targetWidth / width);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function binarize(data) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) histogram[data[i]] += 1;

  // Otsu's threshold adapts to dark sleeves and bright foil instead of using
  // one fixed cutoff for every phone, lighting condition, and card finish.
  const total = data.length / 4;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let background = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;
    background += value * histogram[value];
    const meanBackground = background / weightBackground;
    const meanForeground = (sum - background) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  return data;
}

function renderRegion(source, region, targetWidth, doc, mode = "contrast") {
  const sx = Math.round(source.width * region.x),
    sy = Math.round(source.height * region.y);
  const sw = Math.round(source.width * region.width),
    sh = Math.round(source.height * region.height);
  const size = targetSize(sw, sh, targetWidth);
  const canvas = doc.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingQuality = "high";
  context.drawImage(source, sx, sy, sw, sh, 0, 0, size.width, size.height);
  const pixels = context.getImageData(0, 0, size.width, size.height);
  enhanceContrast(pixels.data);
  if (mode === "binary") binarize(pixels.data);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export function preprocessCard(canvas, doc = globalThis.document) {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  const leftBottom = { x: 0, y: 0.84, width: 0.55, height: 0.16 };
  const rightBottom = { x: 0.45, y: 0.84, width: 0.55, height: 0.16 };
  return [
    // Keep both a natural grayscale pass and an adaptive black/white pass:
    // foil, shadows, and textured artwork tend to win on different passes.
    { region: "full", image: renderRegion(canvas, full, 1200, doc) },
    { region: "full", image: renderRegion(canvas, full, 1200, doc, "binary") },
    // Collector numbers are small and sit bottom-left (Pokémon, Magic) or
    // bottom-right (One Piece): read each half of the bottom strip enlarged.
    { region: "bottom", image: renderRegion(canvas, leftBottom, 1600, doc) },
    {
      region: "bottom",
      image: renderRegion(canvas, leftBottom, 1600, doc, "binary"),
    },
    { region: "bottom", image: renderRegion(canvas, rightBottom, 1600, doc) },
    {
      region: "bottom",
      image: renderRegion(canvas, rightBottom, 1600, doc, "binary"),
    },
  ];
}
