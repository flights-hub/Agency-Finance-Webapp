import { presignR2Url } from './r2.js';
import { supabaseRequest } from './supabase.js';

// A proof row is written as PENDING_UPLOAD before the browser uploads to R2, so
// any interruption (network failure, closed tab, blocked request) leaves the row
// stranded. This job reconciles those stragglers against what is actually in R2:
// recover the ones whose object landed, orphan the rest and drop stray bytes.
export const DEFAULT_STALE_HOURS = 24;
const DEFAULT_LIMIT = 200;

async function headProofObject(key) {
  const res = await fetch(presignR2Url({ method: 'HEAD', key, expiresSeconds: 120 }), { method: 'HEAD' });
  if (res.status === 404) return { present: false, contentLength: null };
  if (res.status !== 200) {
    throw new Error(`R2 HEAD returned ${res.status} for ${key}`);
  }
  const raw = res.headers.get('content-length');
  return { present: true, contentLength: raw === null ? null : Number(raw) };
}

async function deleteProofObject(key) {
  const res = await fetch(presignR2Url({ method: 'DELETE', key, expiresSeconds: 120 }), { method: 'DELETE' });
  // R2 returns 204 on delete and 404 when the object is already gone; both mean
  // "no bytes left behind", which is all this job needs to guarantee.
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    throw new Error(`R2 DELETE returned ${res.status} for ${key}`);
  }
}

async function markProof(proofId, patch) {
  await supabaseRequest(`/rest/v1/payment_proofs?id=eq.${encodeURIComponent(proofId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: patch,
  });
}

// A payment whose evidence never arrived cannot be verified as recorded, so it
// is failed terminally rather than left cluttering the ledger as Pending Upload.
// Call only AFTER the proof is marked ORPHANED, so the surviving-proof check
// below does not count the proof we just gave up on.
async function failPaymentWithoutEvidence(paymentId, now) {
  const survivors = await supabaseRequest(
    `/rest/v1/payment_proofs?payment_id=eq.${encodeURIComponent(paymentId)}`
    + `&status=in.(PENDING_UPLOAD,UPLOADED,VERIFIED)&select=id&limit=1`,
  ) || [];
  // Another proof may still rescue this payment — leave it alone.
  if (survivors.length) return { updated: false, reason: 'another proof is still viable' };

  const rows = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(paymentId)}&select=id,data`) || [];
  const row = rows[0];
  if (!row) return { updated: false, reason: 'payment row not found' };

  const data = row.data || {};
  // Only fail a payment that is still waiting on this upload. If it advanced on
  // its own (verified, edited, already failed), that state wins.
  if (data.verification_status !== 'PENDING_UPLOAD') {
    return { updated: false, reason: `payment is ${data.verification_status || 'grandfathered'}` };
  }

  await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(paymentId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      data: {
        ...data,
        verification_status: 'UPLOAD_FAILED',
        ledger_posting_status: 'NOT_ELIGIBLE',
        upload_failed_at: now.toISOString(),
      },
    },
  });
  return { updated: true };
}

export async function reconcileProofUploads({
  olderThanHours = DEFAULT_STALE_HOURS,
  limit = DEFAULT_LIMIT,
  now = new Date(),
} = {}) {
  const cutoff = new Date(now.getTime() - olderThanHours * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRequest(
    `/rest/v1/payment_proofs?status=eq.PENDING_UPLOAD&created_at=lt.${encodeURIComponent(cutoff)}`
    + `&select=id,payment_id,r2_key,size_bytes,created_at&order=created_at.asc&limit=${Number(limit)}`,
  ) || [];

  const summary = { scanned: rows.length, recovered: [], orphaned: [], paymentsFailed: [], failed: [], cutoff };

  for (const row of rows) {
    try {
      const head = await headProofObject(row.r2_key);
      const expected = Number(row.size_bytes);

      if (head.present && head.contentLength === expected) {
        // The bytes are there — completion just never ran. Trust the object.
        await markProof(row.id, { status: 'UPLOADED', uploaded_at: now.toISOString() });
        summary.recovered.push({ id: row.id, payment_id: row.payment_id, r2_key: row.r2_key });
        continue;
      }

      // Absent, or present at the wrong size (a partial/aborted PUT). Either way
      // this is not usable evidence: drop any stray bytes, then orphan the row.
      if (head.present) await deleteProofObject(row.r2_key);
      await markProof(row.id, { status: 'ORPHANED' });

      // Resolve the payment this proof was evidence for, so the ledger self-heals
      // instead of showing a Pending Upload row that will never complete.
      const payment = await failPaymentWithoutEvidence(row.payment_id, now);
      if (payment.updated) summary.paymentsFailed.push(row.payment_id);

      summary.orphaned.push({
        id: row.id,
        payment_id: row.payment_id,
        r2_key: row.r2_key,
        reason: head.present ? `size mismatch (stored ${head.contentLength} of ${expected})` : 'object missing in R2',
        payment_outcome: payment.updated ? 'marked UPLOAD_FAILED' : `left as-is (${payment.reason})`,
      });
    } catch (error) {
      // Keep going: one unreachable key must not stall the whole sweep. The row
      // stays PENDING_UPLOAD and will be retried on the next run.
      summary.failed.push({ id: row.id, r2_key: row.r2_key, error: error.message });
    }
  }

  return summary;
}
