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

export async function completeProofUpload({ paymentId, proofId, ocr, user }) {
  const uploadedAt = new Date().toISOString();
  const rows = await supabaseRequest(
    `/rest/v1/payment_proofs?id=eq.${encodeURIComponent(proofId)}&payment_id=eq.${encodeURIComponent(paymentId)}&select=*`,
  );
  const proofRow = rows?.[0];
  if (!proofRow) {
    const error = new Error('Payment proof upload was not initialized.');
    error.status = 404;
    throw error;
  }

  await supabaseRequest(`/rest/v1/payment_proofs?id=eq.${encodeURIComponent(proofId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'UPLOADED',
      uploaded_at: uploadedAt,
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
