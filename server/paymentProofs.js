import crypto from 'node:crypto';
import { presignR2Url, r2BucketName } from './r2.js';
import { supabaseRequest } from './supabase.js';

export const PAYMENT_PROOF_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
export const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(fileName) {
  const base = String(fileName || 'payment-proof')
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 96);
  return base || 'payment-proof';
}

function proofObjectKey(paymentId, fileName, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return [
    'payment-proofs',
    String(year),
    month,
    encodeURIComponent(paymentId),
    `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`,
  ].join('/');
}

export function validateProofFile({ contentType, size }) {
  if (!PAYMENT_PROOF_TYPES.has(contentType)) {
    const error = new Error('Payment proof must be a JPG, PNG, or PDF file.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > PAYMENT_PROOF_MAX_BYTES) {
    const error = new Error('Payment proof must be between 1 byte and 10 MB.');
    error.status = 400;
    throw error;
  }
}

export async function createProofUpload({ paymentId, fileName, contentType, size, user }) {
  validateProofFile({ contentType, size });

  const now = new Date();
  const proofId = crypto.randomUUID();
  const objectKey = proofObjectKey(paymentId, fileName, now);
  const row = {
    id: proofId,
    payment_id: paymentId,
    r2_bucket: r2BucketName(),
    r2_key: objectKey,
    original_filename: fileName || 'payment-proof',
    content_type: contentType,
    size_bytes: Number(size),
    status: 'PENDING_UPLOAD',
    created_by: user.id,
  };

  await supabaseRequest('/rest/v1/payment_proofs', {
    method: 'POST',
    prefer: 'return=minimal',
    body: row,
  });

  const proof = {
    id: proofId,
    storage: 'r2',
    bucket: row.r2_bucket,
    object_key: objectKey,
    file_name: row.original_filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    upload_status: row.status,
    created_at: now.toISOString(),
    created_by_user_id: user.id,
  };

  return {
    proof,
    uploadUrl: presignR2Url({ method: 'PUT', key: objectKey, expiresSeconds: 900, now }),
    expiresIn: 900,
  };
}

function normalizeSha256(value) {
  if (value === null || value === undefined || value === '') return null;
  const hex = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    const error = new Error('Payment proof sha256 must be a 64-character hex digest.');
    error.status = 400;
    throw error;
  }
  return hex;
}

// Confirm the client's PUT actually landed in R2 before we trust the row as
// UPLOADED. Without this a failed/partial upload could still be marked complete
// and later verified against evidence that isn't really there.
async function assertR2ObjectLanded({ key, expectedBytes }) {
  const headUrl = presignR2Url({ method: 'HEAD', key, expiresSeconds: 120 });
  let res;
  try {
    res = await fetch(headUrl, { method: 'HEAD' });
  } catch (cause) {
    const error = new Error('Could not reach payment proof storage to confirm the upload.');
    error.status = 502;
    error.cause = cause;
    throw error;
  }

  if (res.status === 404) {
    const error = new Error('Payment proof upload did not reach storage. Please retry.');
    error.status = 409;
    throw error;
  }
  if (res.status !== 200) {
    const error = new Error(`Payment proof storage returned an unexpected status (${res.status}).`);
    error.status = 502;
    throw error;
  }

  const contentLength = Number(res.headers.get('content-length'));
  const expected = Number(expectedBytes);
  if (!Number.isFinite(contentLength) || contentLength !== expected) {
    const error = new Error(
      `Payment proof upload is incomplete (stored ${res.headers.get('content-length')} of ${expected} bytes). Please retry.`,
    );
    error.status = 409;
    throw error;
  }
}

export async function completeProofUpload({ paymentId, proofId, sha256, ocr, user }) {
  const uploadedAt = new Date().toISOString();
  const sha256Hex = normalizeSha256(sha256);
  const rows = await supabaseRequest(
    `/rest/v1/payment_proofs?id=eq.${encodeURIComponent(proofId)}&payment_id=eq.${encodeURIComponent(paymentId)}&select=*`,
  );
  const proofRow = rows?.[0];
  if (!proofRow) {
    const error = new Error('Payment proof upload was not initialized.');
    error.status = 404;
    throw error;
  }

  // Gate: never flip to UPLOADED unless the object is actually in R2 at the
  // expected size. On failure the row stays PENDING_UPLOAD and the reconciliation
  // job (Step 4) will later resolve or orphan it.
  await assertR2ObjectLanded({ key: proofRow.r2_key, expectedBytes: proofRow.size_bytes });

  await supabaseRequest(`/rest/v1/payment_proofs?id=eq.${encodeURIComponent(proofId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'UPLOADED',
      uploaded_at: uploadedAt,
      ...(sha256Hex ? { sha256: sha256Hex } : {}),
    },
  });

  let ocrRecord = null;
  if (ocr) {
    const ocrRows = await supabaseRequest('/rest/v1/payment_proof_ocr', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        proof_id: proofId,
        payment_id: paymentId,
        engine: ocr.engine || 'unknown',
        parser_version: ocr.parser_version || 'payment-proof-v1',
        raw_text: ocr.raw_text || '',
        extracted: ocr.extracted || {},
        confidence: Number.isFinite(Number(ocr.confidence)) ? Number(ocr.confidence) : null,
        status: ocr.status || 'EXTRACTED',
        warnings: Array.isArray(ocr.warnings) ? ocr.warnings : [],
        created_by: user.id,
      },
    });
    ocrRecord = ocrRows?.[0] || null;
  }

  return {
    proof: {
      id: proofRow.id,
      storage: 'r2',
      bucket: proofRow.r2_bucket,
      object_key: proofRow.r2_key,
      file_name: proofRow.original_filename,
      content_type: proofRow.content_type,
      size_bytes: Number(proofRow.size_bytes || 0),
      sha256: sha256Hex || proofRow.sha256 || null,
      upload_status: 'UPLOADED',
      uploaded_at: uploadedAt,
      created_by_user_id: proofRow.created_by,
    },
    ocr: ocrRecord ? {
      id: ocrRecord.id,
      engine: ocrRecord.engine,
      parser_version: ocrRecord.parser_version,
      status: ocrRecord.status,
      confidence: ocrRecord.confidence,
      extracted: ocrRecord.extracted || {},
      warnings: ocrRecord.warnings || [],
      raw_text_preview: String(ocrRecord.raw_text || '').slice(0, 1200),
    } : null,
  };
}

export function signedProofViewUrl(proof) {
  if (!proof?.object_key) {
    const error = new Error('Payment proof does not have an R2 object key.');
    error.status = 404;
    throw error;
  }
  return {
    url: presignR2Url({ method: 'GET', key: proof.object_key, expiresSeconds: 300 }),
    expiresIn: 300,
  };
}
