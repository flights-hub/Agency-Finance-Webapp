/* eslint-disable */
/**
 * PP-OCRv5 Web Worker (classic worker).
 *
 * Runs the full PaddleOCR v5 pipeline entirely off the main thread:
 *   detection (DB)  ->  optional angle classification  ->  recognition (CTC)
 *
 * ONNX Runtime Web is loaded via importScripts() from a self-hosted copy
 * (manifest.ortScript) so nothing here is bundled into the app; the models
 * and dictionary are fetched from the paths in the manifest. The main thread
 * (helpers/ppOcr.js) owns this worker, transfers an ImageBitmap in, and gets
 * `{ text, confidence, lines }` back.
 *
 * Everything is deliberately dependency-free (no npm imports) so the file can
 * be dropped into /public and served as-is.
 */

let ort = null;
let config = null;
let dictionary = null; // string[] of characters, blank NOT included
let sessions = { det: null, cls: null, rec: null };
let initPromise = null;

const DEFAULTS = {
  detLimitSideLen: 960,
  detThresh: 0.3,
  detBoxThresh: 0.5,
  detUnclipRatio: 1.6,
  detMinBoxSize: 3,
  recImageHeight: 48,
  recMaxWidth: 1600,
  clsThresh: 0.9,
  useSpaceChar: true,
  // ImageNet normalisation for detection input (RGB order).
  detMean: [0.485, 0.456, 0.406],
  detStd: [0.229, 0.224, 0.225],
};

function cfg(key) {
  return config?.[key] ?? DEFAULTS[key];
}

// --- lazy initialisation -------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.text();
}

async function ensureReady() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!ort) {
      importScripts(config.ortScript);
      // ort.min.js publishes the namespace on the worker global scope.
      ort = self.ort;
      if (!ort) throw new Error('ONNX Runtime Web failed to initialise in worker');
      if (config.wasmPaths) ort.env.wasm.wasmPaths = config.wasmPaths;
      // Receipts are small; a single worker thread keeps memory predictable.
      ort.env.wasm.numThreads = 1;
    }

    const dictText = await fetchText(config.models.dict);
    dictionary = dictText.replace(/\r/g, '').split('\n');
    // PaddleOCR keeps a trailing blank line in the keys file; drop it but keep
    // legitimate internal blanks by only trimming the final empty entry.
    if (dictionary.length && dictionary[dictionary.length - 1] === '') dictionary.pop();

    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    sessions.det = await ort.InferenceSession.create(config.models.det, opts);
    sessions.rec = await ort.InferenceSession.create(config.models.rec, opts);
    if (config.models.cls && cfg('clsEnabled') !== false) {
      sessions.cls = await ort.InferenceSession.create(config.models.cls, opts).catch(() => null);
    }
  })();
  return initPromise;
}

// --- small canvas / pixel helpers ---------------------------------------

function makeCanvas(w, h) {
  return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
}

// Draw (a sub-rectangle of) the source bitmap into a w x h RGBA ImageData.
function rasterize(bitmap, sx, sy, sw, sh, w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// --- detection -----------------------------------------------------------

function detResize(srcW, srcH) {
  const limit = cfg('detLimitSideLen');
  let ratio = 1;
  const maxSide = Math.max(srcW, srcH);
  if (maxSide > limit) ratio = limit / maxSide;
  let rw = Math.round((srcW * ratio) / 32) * 32;
  let rh = Math.round((srcH * ratio) / 32) * 32;
  rw = Math.max(32, rw);
  rh = Math.max(32, rh);
  return { rw, rh, ratioW: rw / srcW, ratioH: rh / srcH };
}

function toDetTensor(imageData, w, h) {
  const { data } = imageData;
  const mean = cfg('detMean');
  const std = cfg('detStd');
  const chw = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    chw[i] = (data[p] / 255 - mean[0]) / std[0]; // R
    chw[i + plane] = (data[p + 1] / 255 - mean[1]) / std[1]; // G
    chw[i + 2 * plane] = (data[p + 2] / 255 - mean[2]) / std[2]; // B
  }
  return new ort.Tensor('float32', chw, [1, 3, h, w]);
}

// Connected-component boxes from the binarised probability map. This is a
// pragmatic stand-in for PaddleOCR's contour+min-area-rect step: for receipts
// (near axis-aligned text) tight bounding boxes plus an unclip pad recognise
// well, without pulling in a full geometry/clipper dependency.
function boxesFromProbMap(prob, w, h) {
  const thresh = cfg('detThresh');
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = prob[i] > thresh ? 1 : 0;

  const visited = new Uint8Array(w * h);
  const boxes = [];
  const stack = new Int32Array(w * h);
  const minSize = cfg('detMinBoxSize');
  const boxThresh = cfg('detBoxThresh');

  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || visited[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0, scoreSum = 0;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx - x) / w;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      count++;
      scoreSum += prob[idx];

      // 8-connectivity flood fill.
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const nIdx = ny * w + nx;
          if (bin[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack[sp++] = nIdx;
          }
        }
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (Math.min(bw, bh) < minSize) continue;
    const score = scoreSum / count;
    if (score < boxThresh) continue;

    // Unclip: expand the box outward. dist approximates the polygon offset
    // PaddleOCR derives from area * ratio / perimeter.
    const dist = (bw * bh * cfg('detUnclipRatio')) / (2 * (bw + bh));
    boxes.push({
      x0: Math.max(0, minX - dist),
      y0: Math.max(0, minY - dist),
      x1: Math.min(w - 1, maxX + dist),
      y1: Math.min(h - 1, maxY + dist),
      score,
    });
  }
  return boxes;
}

async function detect(bitmap) {
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const { rw, rh, ratioW, ratioH } = detResize(srcW, srcH);
  const imageData = rasterize(bitmap, 0, 0, srcW, srcH, rw, rh);
  const input = toDetTensor(imageData, rw, rh);

  const feeds = { [sessions.det.inputNames[0]]: input };
  const output = await sessions.det.run(feeds);
  const prob = output[sessions.det.outputNames[0]].data; // [1,1,rh,rw]

  const boxes = boxesFromProbMap(prob, rw, rh);
  // Map boxes back to original-image coordinates.
  return boxes.map((b) => ({
    x0: b.x0 / ratioW,
    y0: b.y0 / ratioH,
    x1: b.x1 / ratioW,
    y1: b.y1 / ratioH,
    score: b.score,
  }));
}

// --- reading order -------------------------------------------------------

// Group boxes into lines (by vertical overlap) then order left-to-right, so
// the recognised text reads the way a human scans the receipt.
function orderBoxes(boxes) {
  const sorted = boxes.slice().sort((a, b) => a.y0 - b.y0);
  const lines = [];
  for (const box of sorted) {
    const cy = (box.y0 + box.y1) / 2;
    const height = box.y1 - box.y0;
    let placed = false;
    for (const line of lines) {
      if (Math.abs(line.cy - cy) < Math.max(height, line.height) * 0.6) {
        line.boxes.push(box);
        line.cy = (line.cy * line.count + cy) / (line.count + 1);
        line.height = Math.max(line.height, height);
        line.count++;
        placed = true;
        break;
      }
    }
    if (!placed) lines.push({ cy, height, count: 1, boxes: [box] });
  }
  return lines
    .sort((a, b) => a.cy - b.cy)
    .map((line) => line.boxes.sort((a, b) => a.x0 - b.x0));
}

// --- recognition ---------------------------------------------------------

function toRecTensor(imageData, w, h) {
  const { data } = imageData;
  const chw = new Float32Array(3 * w * h);
  const plane = w * h;
  // PaddleOCR rec normalisation: (x/255 - 0.5) / 0.5.
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    chw[i] = (data[p] / 255 - 0.5) / 0.5;
    chw[i + plane] = (data[p + 1] / 255 - 0.5) / 0.5;
    chw[i + 2 * plane] = (data[p + 2] / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor('float32', chw, [1, 3, h, w]);
}

function ctcDecode(logits, dims) {
  // logits: [1, T, C]; blank is class 0, chars map to dictionary[cls-1],
  // final class is the space char when useSpaceChar is set.
  const T = dims[1];
  const C = dims[2];
  const useSpace = cfg('useSpaceChar');
  let text = '';
  let scoreSum = 0;
  let scoreCount = 0;
  let prev = 0;
  for (let t = 0; t < T; t++) {
    const base = t * C;
    let best = 0;
    let bestVal = logits[base];
    for (let c = 1; c < C; c++) {
      const v = logits[base + c];
      if (v > bestVal) { bestVal = v; best = c; }
    }
    if (best !== 0 && best !== prev) {
      let ch;
      if (best - 1 < dictionary.length) ch = dictionary[best - 1];
      else if (useSpace) ch = ' ';
      else ch = '';
      text += ch;
      scoreSum += bestVal;
      scoreCount++;
    }
    prev = best;
  }
  return { text, score: scoreCount ? scoreSum / scoreCount : 0 };
}

async function recognizeBox(bitmap, box) {
  const targetH = cfg('recImageHeight');
  const bw = Math.max(1, Math.round(box.x1 - box.x0));
  const bh = Math.max(1, Math.round(box.y1 - box.y0));
  let targetW = Math.round((targetH * bw) / bh);
  targetW = Math.max(targetH, Math.min(targetW, cfg('recMaxWidth')));

  let imageData = rasterize(bitmap, box.x0, box.y0, bw, bh, targetW, targetH);

  if (sessions.cls) {
    const flip = await classify(imageData, targetW, targetH);
    if (flip) imageData = rotate180(imageData, targetW, targetH);
  }

  const input = toRecTensor(imageData, targetW, targetH);
  const feeds = { [sessions.rec.inputNames[0]]: input };
  const output = await sessions.rec.run(feeds);
  const outTensor = output[sessions.rec.outputNames[0]];
  return ctcDecode(outTensor.data, outTensor.dims);
}

function rotate180(imageData, w, h) {
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    dst[j * 4] = src[i * 4];
    dst[j * 4 + 1] = src[i * 4 + 1];
    dst[j * 4 + 2] = src[i * 4 + 2];
    dst[j * 4 + 3] = src[i * 4 + 3];
  }
  return new ImageData(dst, w, h);
}

async function classify(imageData, w, h) {
  // cls model expects 3x48x192; letterbox the crop into that width.
  const clsW = 192;
  const scaled = makeCanvas(clsW, h);
  const ctx = scaled.getContext('2d', { willReadFrequently: true });
  const drawW = Math.min(clsW, Math.round((h * w) / h));
  const tmp = makeCanvas(w, h);
  tmp.getContext('2d').putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0, w, h, 0, 0, drawW, h);
  const clsData = ctx.getImageData(0, 0, clsW, h);
  const input = toRecTensor(clsData, clsW, h);
  const feeds = { [sessions.cls.inputNames[0]]: input };
  const output = await sessions.cls.run(feeds);
  const out = output[sessions.cls.outputNames[0]].data; // [1,2] -> [0deg,180deg]
  return out[1] > out[0] && out[1] > cfg('clsThresh');
}

// --- orchestration -------------------------------------------------------

async function recognize(bitmap, { onProgress } = {}) {
  await ensureReady();
  const boxes = await detect(bitmap);
  if (onProgress) onProgress({ stage: 'detected', boxes: boxes.length });
  if (!boxes.length) return { text: '', confidence: null, lines: [] };

  const lines = orderBoxes(boxes);
  const outLines = [];
  const scores = [];
  let done = 0;
  const total = boxes.length;

  for (const line of lines) {
    const parts = [];
    for (const box of line) {
      const { text, score } = await recognizeBox(bitmap, box);
      if (text.trim()) {
        parts.push(text);
        scores.push(score);
      }
      done++;
      if (onProgress) onProgress({ stage: 'recognize', done, total });
    }
    if (parts.length) outLines.push(parts.join(' '));
  }

  const confidence = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 10
    : null;
  return { text: outLines.join('\n'), confidence, lines: outLines };
}

// --- message plumbing ----------------------------------------------------

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === 'init') {
    config = { ...msg.config };
    return;
  }
  if (msg.type !== 'recognize') return;

  const { id, bitmap } = msg;
  const onProgress = (payload) => self.postMessage({ type: 'progress', id, ...payload });
  try {
    if (!config) throw new Error('Worker received recognize before init');
    const result = await recognize(bitmap, { onProgress });
    self.postMessage({ type: 'result', id, result });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
};
