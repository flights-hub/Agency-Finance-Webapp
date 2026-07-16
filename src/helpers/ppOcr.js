// Main-thread entry point for PP-OCRv5 recognition.
//
// The heavy ONNX inference runs in a dedicated Web Worker
// (public/ocr/ppocrv5/worker.js). This module only: reads the manifest,
// lazily spawns the worker, normalises the input into a transferable
// ImageBitmap, and awaits the recognised text. When the manifest is disabled
// or the models/worker are unavailable it returns null so callers fall back to
// their existing OCR path (Tesseract) with no regression.

const MANIFEST_URL = '/ocr/ppocrv5/manifest.json';

let manifestPromise = null;
let worker = null;
let workerReady = false;
let requestSeq = 0;
const pending = new Map();

function browserReady() {
  return typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof createImageBitmap === 'function';
}

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

function ensureWorker(manifest) {
  if (worker) return worker;
  worker = new Worker(manifest.worker, { type: 'classic' });
  worker.onmessage = (event) => {
    const msg = event.data || {};
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.onProgress?.(msg);
      return;
    }
    if (msg.type === 'result') {
      pending.delete(msg.id);
      entry.resolve(msg.result);
    } else if (msg.type === 'error') {
      pending.delete(msg.id);
      entry.reject(new Error(msg.message || 'OCR worker error'));
    }
  };
  worker.onerror = (event) => {
    // Fail every in-flight request; the worker is unusable after a hard error.
    for (const [, entry] of pending) entry.reject(new Error(event.message || 'OCR worker crashed'));
    pending.clear();
    worker = null;
    workerReady = false;
  };
  return worker;
}

function initWorker(manifest) {
  const w = ensureWorker(manifest);
  if (!workerReady) {
    w.postMessage({
      type: 'init',
      config: {
        ortScript: manifest.ortScript,
        wasmPaths: manifest.wasmPaths || null,
        models: manifest.models,
        clsEnabled: manifest.clsEnabled,
        detLimitSideLen: manifest.detLimitSideLen,
        detThresh: manifest.detThresh,
        detBoxThresh: manifest.detBoxThresh,
        detUnclipRatio: manifest.detUnclipRatio,
        recImageHeight: manifest.recImageHeight,
        recMaxWidth: manifest.recMaxWidth,
        clsThresh: manifest.clsThresh,
        useSpaceChar: manifest.useSpaceChar,
      },
    });
    workerReady = true;
  }
  return w;
}

// Accepts a File/Blob, an HTMLCanvasElement/OffscreenCanvas, or an ImageBitmap
// and returns a transferable ImageBitmap.
async function toBitmap(input) {
  if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) return input;
  return createImageBitmap(input);
}

export async function extractTextWithPpOcr(input, options = {}) {
  if (!browserReady()) return null;

  const manifest = await loadManifest();
  if (!manifest?.enabled || !manifest.worker || !manifest.models?.det || !manifest.models?.rec) {
    return null;
  }

  let bitmap;
  try {
    bitmap = await toBitmap(input);
  } catch {
    return null;
  }

  const w = initWorker(manifest);
  const id = ++requestSeq;

  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress: options.onProgress });

    if (options.signal) {
      if (options.signal.aborted) {
        pending.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new DOMException('Aborted', 'AbortError'));
        }
      }, { once: true });
    }

    w.postMessage({ type: 'recognize', id, bitmap }, [bitmap]);
  }).catch(() => null);

  if (!result || !result.text?.trim()) return null;
  return {
    text: result.text,
    engine: manifest.engine || 'PP-OCRv5 ONNX',
    confidence: result.confidence ?? null,
  };
}
