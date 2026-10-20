// Finds a PNG template inside a page screenshot. Used by Click when selectorType is "image".
// The search is a sampled absolute-difference scan (no extra native dependency). Coordinates
// are returned in the original screenshot's pixels, which match Playwright's mouse coordinates.
import { AppError } from '../../lib/errors.js';

export async function findTemplate(haystack, needle, { threshold = 0.18, maxSide = 900 } = {}) {
  let canvas;
  try {
    canvas = await import('@napi-rs/canvas');
  } catch {
    throw new AppError(500, 'CANVAS_MISSING', 'Image click needs @napi-rs/canvas, which is a backend dependency');
  }
  const hayImg = await canvas.loadImage(haystack);
  const needleImg = await canvas.loadImage(needle);
  if (!needleImg.width || !needleImg.height) throw new AppError(400, 'VALIDATION', 'The template image is empty');
  const scale = Math.min(1, maxSide / Math.max(hayImg.width, hayImg.height, 1));
  const hw = Math.max(1, Math.round(hayImg.width * scale));
  const hh = Math.max(1, Math.round(hayImg.height * scale));
  const nw = Math.max(1, Math.round(needleImg.width * scale));
  const nh = Math.max(1, Math.round(needleImg.height * scale));
  if (nw > hw || nh > hh) return null;
  const hayCanvas = canvas.createCanvas(hw, hh);
  const needleCanvas = canvas.createCanvas(nw, nh);
  hayCanvas.getContext('2d').drawImage(hayImg, 0, 0, hw, hh);
  needleCanvas.getContext('2d').drawImage(needleImg, 0, 0, nw, nh);
  const hayData = hayCanvas.getContext('2d').getImageData(0, 0, hw, hh).data;
  const needleData = needleCanvas.getContext('2d').getImageData(0, 0, nw, nh).data;
  const stride = Math.max(1, Math.floor(Math.min(nw, nh) / 8));
  const samples = [];
  for (let y = 0; y < nh; y += stride) {
    for (let x = 0; x < nw; x += stride) samples.push([x, y]);
  }
  let best = { diff: Infinity, x: 0, y: 0 };
  for (let y = 0; y <= hh - nh; y += stride) {
    for (let x = 0; x <= hw - nw; x += stride) {
      let sum = 0;
      for (const [sx, sy] of samples) {
        const hi = ((y + sy) * hw + (x + sx)) * 4;
        const ni = (sy * nw + sx) * 4;
        sum += Math.abs(hayData[hi] - needleData[ni]) + Math.abs(hayData[hi + 1] - needleData[ni + 1]) + Math.abs(hayData[hi + 2] - needleData[ni + 2]);
      }
      const diff = sum / (samples.length * 255 * 3);
      if (diff < best.diff) best = { diff, x, y };
    }
  }
  if (!Number.isFinite(best.diff) || best.diff > threshold) return null;
  return {
    x: Math.round(best.x / scale),
    y: Math.round(best.y / scale),
    width: needleImg.width,
    height: needleImg.height,
    difference: Number(best.diff.toFixed(4)),
  };
}
