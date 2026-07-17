import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_PROOF_MAX_BYTES,
  completeProofUpload,
  createProofUpload,
  signedProofViewUrl,
  validateProofFile,
} from './paymentProofs.js';
import { emptyResponse, installFetch, jsonResponse, withStubbedEnv } from './testHelpers.js';

const USER = { id: 'user-1' };
const SHA = 'a'.repeat(64);

const PROOF_ROW = {
  id: 'proof-1',
  payment_id: 'pay-1',
  r2_bucket: 'proofs',
  r2_key: 'payment-proofs/2026/07/pay-1/abc-proof.pdf',
  original_filename: 'proof.pdf',
  content_type: 'application/pdf',
  size_bytes: 1234,
  created_by: 'user-1',
};

test('validateProofFile accepts allowed types and rejects the rest', () => {
  assert.doesNotThrow(() => validateProofFile({ contentType: 'image/jpeg', size: 10 }));
  assert.doesNotThrow(() => validateProofFile({ contentType: 'image/png', size: 10 }));
  assert.doesNotThrow(() => validateProofFile({ contentType: 'application/pdf', size: 10 }));

  assert.throws(() => validateProofFile({ contentType: 'text/html', size: 10 }), { status: 400 });
  assert.throws(() => validateProofFile({ contentType: 'image/gif', size: 10 }), { status: 400 });
});

test('validateProofFile rejects empty and oversized files', () => {
  assert.throws(() => validateProofFile({ contentType: 'image/png', size: 0 }), { status: 400 });
  assert.throws(() => validateProofFile({ contentType: 'image/png', size: -1 }), { status: 400 });
  assert.throws(() => validateProofFile({ contentType: 'image/png', size: 'abc' }), { status: 400 });
  assert.throws(
    () => validateProofFile({ contentType: 'image/png', size: PAYMENT_PROOF_MAX_BYTES + 1 }),
    { status: 400 },
  );
  assert.doesNotThrow(() => validateProofFile({ contentType: 'image/png', size: PAYMENT_PROOF_MAX_BYTES }));
});

test('createProofUpload writes a PENDING_UPLOAD row and returns a scoped PUT url', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'POST') return emptyResponse();
    return null;
  });

  try {
    const result = await createProofUpload({
      paymentId: 'pay-1',
      fileName: 'my receipt.pdf',
      contentType: 'application/pdf',
      size: 1234,
      user: USER,
    });

    const insert = stub.supabaseCalls().find((c) => c.method === 'POST');
    assert.ok(insert, 'expected a payment_proofs insert');
    assert.match(insert.path, /^\/rest\/v1\/payment_proofs/);
    assert.equal(insert.body.status, 'PENDING_UPLOAD');
    assert.equal(insert.body.payment_id, 'pay-1');
    assert.equal(insert.body.size_bytes, 1234);
    assert.equal(insert.body.created_by, 'user-1');
    assert.equal(insert.body.r2_bucket, 'proofs');

    // Key shape: payment-proofs/<year>/<month>/<paymentId>/<uuid>-<sanitized>
    assert.match(insert.body.r2_key, /^payment-proofs\/\d{4}\/\d{2}\/pay-1\/[0-9a-f-]{36}-my-receipt\.pdf$/);

    assert.equal(result.proof.upload_status, 'PENDING_UPLOAD');
    assert.equal(result.expiresIn, 900);
    const url = new URL(result.uploadUrl);
    assert.equal(url.origin, 'https://account123.r2.cloudflarestorage.com');
    assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('createProofUpload rejects a disallowed file before touching the database', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch(() => emptyResponse());

  try {
    await assert.rejects(
      createProofUpload({ paymentId: 'pay-1', fileName: 'x.exe', contentType: 'application/x-msdownload', size: 10, user: USER }),
      { status: 400 },
    );
    assert.equal(stub.calls.length, 0, 'no request should be made for an invalid file');
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload flips to UPLOADED and stores sha256 when the object landed', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    return null;
  });

  try {
    const result = await completeProofUpload({
      paymentId: 'pay-1', proofId: 'proof-1', sha256: SHA, ocr: null, user: USER,
    });

    const patch = stub.supabaseCalls().find((c) => c.method === 'PATCH');
    assert.ok(patch, 'expected the proof row to be patched');
    assert.equal(patch.body.status, 'UPLOADED');
    assert.equal(patch.body.sha256, SHA);
    assert.ok(patch.body.uploaded_at, 'uploaded_at should be stamped');

    assert.equal(result.proof.upload_status, 'UPLOADED');
    assert.equal(result.proof.sha256, SHA);
    assert.equal(result.ocr, null);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload accepts a missing sha256 but rejects a malformed one', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    return null;
  });

  try {
    // Older clients may not send a hash: completion still succeeds, sha256 stays null.
    const result = await completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', sha256: null, user: USER });
    const patch = stub.supabaseCalls().find((c) => c.method === 'PATCH');
    assert.equal(patch.body.sha256, undefined, 'no sha256 key should be written when absent');
    assert.equal(result.proof.sha256, null);

    // A malformed hash is rejected outright, before any network call.
    for (const bad of ['not-hex', 'abc', SHA + 'a', 'g'.repeat(64)]) {
      await assert.rejects(
        completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', sha256: bad, user: USER }),
        { status: 400 },
        `expected ${bad} to be rejected`,
      );
    }
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload uppercase sha256 is normalized to lowercase', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    return null;
  });

  try {
    await completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', sha256: 'A'.repeat(64), user: USER });
    const patch = stub.supabaseCalls().find((c) => c.method === 'PATCH');
    assert.equal(patch.body.sha256, 'a'.repeat(64));
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload stays PENDING_UPLOAD with a 409 when the object is missing', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 404 });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    return null;
  });

  try {
    await assert.rejects(
      completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', sha256: SHA, user: USER }),
      (error) => error.status === 409 && /did not reach storage/i.test(error.message),
    );
    // The critical guarantee: the row was never flipped to UPLOADED.
    assert.equal(stub.supabaseCalls().filter((c) => c.method === 'PATCH').length, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload rejects a size mismatch without marking UPLOADED', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    // Stored 500 bytes but the row expects 1234: a truncated upload.
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '500' } });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    return null;
  });

  try {
    await assert.rejects(
      completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', sha256: SHA, user: USER }),
      (error) => error.status === 409 && /incomplete \(stored 500 of 1234 bytes\)/.test(error.message),
    );
    assert.equal(stub.supabaseCalls().filter((c) => c.method === 'PATCH').length, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload surfaces a 502 when storage is unreachable or erroring', async () => {
  const restoreEnv = withStubbedEnv();

  // Transport failure (DNS/socket): must not be mistaken for "object missing".
  let stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2) throw new Error('socket hang up');
    return null;
  });
  try {
    await assert.rejects(
      completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', user: USER }),
      (error) => error.status === 502 && /could not reach/i.test(error.message),
    );
  } finally {
    stub.restore();
  }

  // Unexpected status from R2 is also a 502, never a silent success.
  stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 403 });
    return null;
  });
  try {
    await assert.rejects(
      completeProofUpload({ paymentId: 'pay-1', proofId: 'proof-1', user: USER }),
      (error) => error.status === 502 && /unexpected status \(403\)/i.test(error.message),
    );
    assert.equal(stub.supabaseCalls().filter((c) => c.method === 'PATCH').length, 0);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload 404s when the proof row was never initialized', async () => {
  const restoreEnv = withStubbedEnv();
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([]);
    return null;
  });

  try {
    await assert.rejects(
      completeProofUpload({ paymentId: 'pay-1', proofId: 'nope', user: USER }),
      { status: 404 },
    );
    assert.equal(stub.r2Calls().length, 0, 'must not touch R2 for an unknown proof');
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('completeProofUpload records OCR output when provided', async () => {
  const restoreEnv = withStubbedEnv();
  const ocrRow = {
    id: 'ocr-1', engine: 'ppocr', parser_version: 'payment-proof-v1', status: 'EXTRACTED',
    confidence: 0.97, extracted: { amount: 485 }, warnings: [], raw_text: 'x'.repeat(2000),
  };
  const stub = installFetch((req) => {
    if (req.isSupabase && req.method === 'GET') return jsonResponse([PROOF_ROW]);
    if (req.isR2 && req.method === 'HEAD') return emptyResponse({ status: 200, headers: { 'content-length': '1234' } });
    if (req.isSupabase && req.method === 'PATCH') return emptyResponse();
    if (req.isSupabase && req.method === 'POST') return jsonResponse([ocrRow]);
    return null;
  });

  try {
    const result = await completeProofUpload({
      paymentId: 'pay-1',
      proofId: 'proof-1',
      sha256: SHA,
      ocr: { engine: 'ppocr', confidence: 0.97, extracted: { amount: 485 }, raw_text: 'x'.repeat(2000) },
      user: USER,
    });

    const insert = stub.supabaseCalls().find((c) => c.method === 'POST');
    assert.match(insert.path, /^\/rest\/v1\/payment_proof_ocr/);
    assert.equal(insert.body.proof_id, 'proof-1');
    assert.equal(insert.body.confidence, 0.97);

    assert.equal(result.ocr.id, 'ocr-1');
    // Raw text is previewed, not returned wholesale.
    assert.equal(result.ocr.raw_text_preview.length, 1200);
  } finally {
    stub.restore();
    restoreEnv();
  }
});

test('signedProofViewUrl returns a short-lived GET url and 404s without a key', () => {
  const restoreEnv = withStubbedEnv();
  try {
    const result = signedProofViewUrl({ object_key: 'payment-proofs/2026/07/pay-1/abc-proof.pdf' });
    assert.equal(result.expiresIn, 300);
    const url = new URL(result.url);
    assert.equal(url.pathname, '/proofs/payment-proofs/2026/07/pay-1/abc-proof.pdf');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');

    assert.throws(() => signedProofViewUrl({}), { status: 404 });
    assert.throws(() => signedProofViewUrl(null), { status: 404 });
  } finally {
    restoreEnv();
  }
});
