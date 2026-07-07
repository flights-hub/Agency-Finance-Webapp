const MANIFEST_URL = '/ocr/ppocrv5/manifest.json';

function browserReady() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ppocr-script="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.ppocrScript = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load OCR runtime ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

export async function extractTextWithPpOcr(input, options = {}) {
  if (!browserReady()) return null;

  const manifest = await loadManifest().catch(() => null);
  if (!manifest?.enabled || !manifest.runner) return null;

  if (manifest.ortScript && !window.ort) {
    await loadScript(manifest.ortScript);
  }

  const runner = await import(/* @vite-ignore */ manifest.runner).catch(() => null);
  if (!runner?.recognize) return null;

  const result = await runner.recognize(input, {
    ort: window.ort,
    manifest,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  if (!result) return null;
  if (typeof result === 'string') {
    return { text: result, engine: 'PP-OCRv5 ONNX', confidence: null };
  }
  return {
    text: result.text || '',
    engine: result.engine || 'PP-OCRv5 ONNX',
    confidence: result.confidence ?? null,
  };
}
