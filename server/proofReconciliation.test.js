import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProofUploads } from './proofReconciliation.js';
import { emptyResponse, installFetch, jsonResponse, withStubbedEnv } from './testHelpers.js';

const NOW = new Date('2026-07-17T12:00:00.000Z');

function staleProof(overrides = {}) {
  return {
    id: 'proof-1',
    payment_id: 'pay-1',
    r2_key: 'payment-proofs/2026/07/pay-1/abc-proof.pdf',
    size_bytes: 1234,
    created_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

// Routes the four Supabase reads/writes the sweep makes, keyed by URL shape.
function supabaseRouter({ proofs = [], survivors = [], payment = undefined }) {
  return (req) => {
    if (!req.isSupabase) return null;
    if (req.method === 'GET' && req.path.includes('/payment_proofs?status=eq.PENDING_UPLOAD')) return jsonResponse(proofs);
    if (req.method === 'GET' && req.path.includes('/payment_proofs?payment_id=eq.')) return jsonResponse(survivors);
    if (req.method === 'GET' && req.path.includes('/payments?id=eq.')) return jsonResponse(payment === undefined ? [] : [payment]);
    if (req.method === 'PATCH') return emptyResponse();
    return null;
  };
}

test('recovers a proof whose object landed but never completed', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    return supabaseRouter({ proofs: [staleProof()] })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.scanned, 1);
    assert.equal(summary.recovered.length, 1);
    assert.equal(summary.orphaned.length, 0);
    assert.equal(summary.recovered[0].id, 'proof-1');

    const patch = stub.supabaseCalls().find((c) => c.method === 'PATCH');
    assert.equal(patch.body.status, 'UPLOADED');
    assert.equal(patch.body.uploaded_at, NOW.toISOString());

    // Nothing was deleted: the bytes are good.
    assert.equal(stub.r2Calls().filter((c) => c.method === 'DELETE').length, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('orphans a proof whose object is missing and fails the payment', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 404 });
    return supabaseRouter({
      proofs: [staleProof()],
      survivors: [],
      payment: { id: 'pay-1', data: { verification_status: 'PENDING_UPLOAD', amount_paid: 485 } },
    })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.orphaned.length, 1);
    assert.equal(summary.orphaned[0].reason, 'object missing in R2');
    assert.equal(summary.orphaned[0].payment_outcome, 'marked UPLOAD_FAILED');
    assert.deepEqual(summary.paymentsFailed, ['pay-1']);

    const patches = stub.supabaseCalls().filter((c) => c.method === 'PATCH');
    const proofPatch = patches.find((c) => c.path.includes('/payment_proofs'));
    const paymentPatch = patches.find((c) => c.path.includes('/payments?id='));

    assert.equal(proofPatch.body.status, 'ORPHANED');
    assert.equal(paymentPatch.body.data.verification_status, 'UPLOAD_FAILED');
    assert.equal(paymentPatch.body.data.ledger_posting_status, 'NOT_ELIGIBLE');
    assert.equal(paymentPatch.body.data.upload_failed_at, NOW.toISOString());
    // Untouched fields survive the merge.
    assert.equal(paymentPatch.body.data.amount_paid, 485);

    // Nothing to delete when the object was never there.
    assert.equal(stub.r2Calls().filter((c) => c.method === 'DELETE').length, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('deletes stray bytes and orphans when the stored size does not match', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '500' } });
    if (req.isR2 && req.method === 'DELETE') return emptyResponse({ status: 204 });
    return supabaseRouter({
      proofs: [staleProof()],
      payment: { id: 'pay-1', data: { verification_status: 'PENDING_UPLOAD' } },
    })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.orphaned.length, 1);
    assert.match(summary.orphaned[0].reason, /size mismatch \(stored 500 of 1234\)/);

    // The partial object must be removed, not left to rot in the bucket.
    const del = stub.r2Calls().find((c) => c.method === 'DELETE');
    assert.ok(del, 'expected the partial object to be deleted');
    assert.ok(del.url.includes('abc-proof.pdf'));
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('does not fail a payment that still has a viable proof', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 404 });
    return supabaseRouter({
      proofs: [staleProof()],
      // A second proof for the same payment is still in flight / already good.
      survivors: [{ id: 'proof-2' }],
      payment: { id: 'pay-1', data: { verification_status: 'PENDING_UPLOAD' } },
    })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.orphaned.length, 1, 'the dead proof is still orphaned');
    assert.equal(summary.paymentsFailed.length, 0, 'but the payment must survive');
    assert.match(summary.orphaned[0].payment_outcome, /another proof is still viable/);

    const paymentPatch = stub.supabaseCalls().find((c) => c.method === 'PATCH' && c.path.includes('/payments?id='));
    assert.equal(paymentPatch, undefined, 'the payment row must not be patched');
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('does not clobber a payment that has moved past PENDING_UPLOAD', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 404 });
    return supabaseRouter({
      proofs: [staleProof()],
      survivors: [],
      // Already verified by a human: reconciliation must never undo that.
      payment: { id: 'pay-1', data: { verification_status: 'VERIFIED' } },
    })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.paymentsFailed.length, 0);
    assert.match(summary.orphaned[0].payment_outcome, /payment is VERIFIED/);

    const paymentPatch = stub.supabaseCalls().find((c) => c.method === 'PATCH' && c.path.includes('/payments?id='));
    assert.equal(paymentPatch, undefined, 'a verified payment must not be touched');
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('a failing key is collected and does not stall the sweep', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isR2 && req.method === 'HEAD') {
      // First proof's storage is unreachable; second one is fine.
      if (req.url.includes('bad-key')) throw new Error('socket hang up');
      return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    }
    return supabaseRouter({
      proofs: [
        staleProof({ id: 'proof-bad', r2_key: 'payment-proofs/2026/07/pay-1/bad-key.pdf' }),
        staleProof({ id: 'proof-good', payment_id: 'pay-2' }),
      ],
    })(req);
  });

  try {
    const summary = await reconcileProofUploads({ now: NOW });

    assert.equal(summary.scanned, 2);
    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].id, 'proof-bad');
    assert.match(summary.failed[0].error, /socket hang up/);

    // The sweep continued past the failure.
    assert.equal(summary.recovered.length, 1);
    assert.equal(summary.recovered[0].id, 'proof-good');
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('scans with the configured cutoff and limit', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => supabaseRouter({ proofs: [] })(req));

  try {
    const summary = await reconcileProofUploads({ olderThanHours: 6, limit: 50, now: NOW });

    const scan = stub.supabaseCalls()[0];
    // 6 hours before 12:00 UTC.
    assert.ok(scan.path.includes(encodeURIComponent('2026-07-17T06:00:00.000Z')), `cutoff not in query: ${scan.path}`);
    assert.ok(scan.path.includes('limit=50'));
    assert.ok(scan.path.includes('status=eq.PENDING_UPLOAD'));
    assert.equal(summary.cutoff, '2026-07-17T06:00:00.000Z');
    assert.equal(summary.scanned, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('olderThanHours: 0 sweeps everything still pending', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => supabaseRouter({ proofs: [] })(req));

  try {
    const summary = await reconcileProofUploads({ olderThanHours: 0, now: NOW });
    assert.equal(summary.cutoff, NOW.toISOString());
  } finally {
    stub.restore();
    restoreEnv();
  }
});
