import test from 'node:test';
import assert from 'node:assert/strict';
import { presignR2Url } from './r2.js';

test('presignR2Url creates a scoped R2 S3 URL', () => {
  const previous = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };

  process.env.R2_ACCOUNT_ID = 'account123';
  process.env.R2_ACCESS_KEY_ID = 'access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'secret-key';
  process.env.R2_BUCKET_NAME = 'proofs';

  const url = new URL(presignR2Url({
    method: 'PUT',
    key: 'payment-proofs/2026/07/pay-1/proof.pdf',
    expiresSeconds: 60,
    now: new Date('2026-07-07T10:00:00.000Z'),
  }));

  assert.equal(url.origin, 'https://account123.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/proofs/payment-proofs/2026/07/pay-1/proof.pdf');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
  assert.match(url.searchParams.get('X-Amz-Credential'), /^access-key\/20260707\/auto\/s3\/aws4_request$/);
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);

  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});
