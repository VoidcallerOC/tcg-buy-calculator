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

function renderRegion(source, region, targetWidth, doc) {
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
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export function preprocessCard(canvas, doc = globalThis.document) {
  return [
    {
      region: "full",
      image: renderRegion(
        canvas,
        { x: 0, y: 0, width: 1, height: 1 },
        1200,
        doc,
      ),
    },
    // Collector numbers are small and sit bottom-left (Pokémon, Magic) or
    // bottom-right (One Piece): read each half of the bottom strip enlarged.
    {
      region: "bottom",
      image: renderRegion(
        canvas,
        { x: 0, y: 0.84, width: 0.55, height: 0.16 },
        1600,
        doc,
      ),
    },
    {
      region: "bottom",
      image: renderRegion(
        canvas,
        { x: 0.45, y: 0.84, width: 0.55, height: 0.16 },
        1600,
        doc,
      ),
    },
  ];
}
