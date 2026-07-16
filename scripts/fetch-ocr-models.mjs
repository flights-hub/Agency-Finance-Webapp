#!/usr/bin/env node
/**
 * Provision the PP-OCRv5 + ONNX Runtime Web assets that the OCR worker needs.
 *
 *   node scripts/fetch-ocr-models.mjs
 *
 * What it does:
 *   1. Copies the self-hosted ONNX Runtime Web files (ort.min.js + *.wasm)
 *      from node_modules/onnxruntime-web into public/ocr/onnxruntime-web/.
 *   2. Ensures the PP-OCRv5 det/rec/cls ONNX models and the character
 *      dictionary exist in public/ocr/ppocrv5/. Missing files are downloaded
 *      when a source URL is available (env override or the defaults below);
 *      otherwise the script prints exactly which files to drop in by hand.
 *   3. Flips manifest.json "enabled" to true ONLY when every required asset is
 *      present, so the app never advertises OCR it cannot run.
 *
 * Model source URLs can be overridden per file, e.g.:
 *   OCR_DET_URL=https://.../det.onnx OCR_REC_URL=https://.../rec.onnx \
 *   OCR_CLS_URL=https://.../cls.onnx OCR_DICT_URL=https://.../keys.txt \
 *   node scripts/fetch-ocr-models.mjs
 */

import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, readFile, writeFile, access, readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ocrDir = path.join(root, 'public', 'ocr', 'ppocrv5');
const ortDir = path.join(root, 'public', 'ocr', 'onnxruntime-web');
const manifestPath = path.join(ocrDir, 'manifest.json');

// Defaults point at a public PP-OCRv5 *mobile* ONNX mirror (small, browser
// friendly) plus the matching v5 dictionary from the PaddleOCR repo. Override
// any of them with the OCR_*_URL env vars if a download 404s.
const HF = 'https://huggingface.co/ilaylow/PP_OCRv5_mobile_onnx/resolve/main';
const DICT = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt';
const MODELS = [
  { file: 'det.onnx', env: 'OCR_DET_URL', url: process.env.OCR_DET_URL || `${HF}/ppocrv5_det.onnx` },
  { file: 'rec.onnx', env: 'OCR_REC_URL', url: process.env.OCR_REC_URL || `${HF}/ppocrv5_rec.onnx` },
  { file: 'cls.onnx', env: 'OCR_CLS_URL', url: process.env.OCR_CLS_URL || '', optional: true },
  { file: 'ppocrv5_dict.txt', env: 'OCR_DICT_URL', url: process.env.OCR_DICT_URL || DICT },
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function copyOnnxRuntime() {
  const src = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  if (!(await exists(src))) {
    console.warn('! onnxruntime-web is not installed. Run: npm install onnxruntime-web');
    return false;
  }
  await mkdir(ortDir, { recursive: true });
  const entries = await readdir(src);
  // Copy the UMD bundle plus every wasm binary and its loader glue.
  const wanted = entries.filter((name) =>
    name === 'ort.min.js'
    || name === 'ort.wasm.min.js'
    || name.endsWith('.wasm')
    || name.endsWith('.mjs'));
  let copied = 0;
  for (const name of wanted) {
    await copyFile(path.join(src, name), path.join(ortDir, name));
    copied++;
  }
  console.log(`✓ Copied ${copied} ONNX Runtime Web files -> public/ocr/onnxruntime-web/`);
  return await exists(path.join(ortDir, 'ort.min.js'));
}

async function ensureModels() {
  await mkdir(ocrDir, { recursive: true });
  const missing = [];
  for (const model of MODELS) {
    const dest = path.join(ocrDir, model.file);
    if (await exists(dest)) {
      const info = await stat(dest);
      console.log(`✓ ${model.file} present (${(info.size / 1024).toFixed(0)} KB)`);
      continue;
    }
    if (model.url) {
      try {
        console.log(`… downloading ${model.file} from ${model.url}`);
        await download(model.url, dest);
        console.log(`✓ ${model.file} downloaded`);
        continue;
      } catch (error) {
        console.warn(`! Failed to download ${model.file}: ${error.message}`);
      }
    }
    if (!model.optional) missing.push(model);
    else console.warn(`- ${model.file} missing (optional; angle classification disabled)`);
  }
  return missing;
}

async function updateManifest(enabled) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.enabled === enabled) return;
  manifest.enabled = enabled;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ manifest.enabled set to ${enabled}`);
}

async function main() {
  const ortOk = await copyOnnxRuntime();
  const missing = await ensureModels();

  if (!ortOk || missing.length) {
    await updateManifest(false);
    console.log('\nOCR is NOT yet enabled. Still needed:');
    if (!ortOk) console.log('  - ONNX Runtime Web (npm install onnxruntime-web, then re-run)');
    for (const model of missing) {
      console.log(`  - public/ocr/ppocrv5/${model.file} (set ${model.env} or drop the file in)`);
    }
    console.log('\nPP-OCRv5 ONNX models + ppocr_keys_v1.txt: see PaddleOCR / RapidOCR releases.');
    process.exitCode = 1;
    return;
  }

  await updateManifest(true);
  console.log('\n✓ OCR enabled. PP-OCRv5 will run in the browser worker; Tesseract stays as fallback.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
