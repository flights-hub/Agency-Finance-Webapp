import crypto from 'node:crypto';

const REGION = 'auto';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Missing required R2 environment variable: ${name}`);
    error.status = 503;
    throw error;
  }
  return value;
}

export function r2BucketName() {
  return requiredEnv('R2_BUCKET_NAME');
}

export function assertR2Env() {
  return {
    accountId: requiredEnv('R2_ACCOUNT_ID'),
    accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    bucket: r2BucketName(),
  };
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key) {
  return String(key).split('/').map(encodeRfc3986).join('/');
}

function canonicalQuery(params) {
  return Object.entries(params)
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || String(aValue).localeCompare(String(bValue)))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function signingKey(secretAccessKey, stamp) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, stamp);
  const regionKey = hmac(dateKey, REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

export function presignR2Url({ method, key, expiresSeconds = 300, now = new Date() }) {
  const verb = String(method || '').toUpperCase();
  if (!['GET', 'PUT', 'HEAD'].includes(verb)) {
    const error = new Error('R2 presigned URLs only support GET, PUT, or HEAD.');
    error.status = 400;
    throw error;
  }

  if (!key || String(key).includes('..')) {
    const error = new Error('Invalid R2 object key.');
    error.status = 400;
    throw error;
  }

  const { accountId, accessKeyId, secretAccessKey, bucket } = assertR2Env();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const stamp = dateStamp(now);
  const scope = `${stamp}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${scope}`;
  const canonicalUri = `/${encodeRfc3986(bucket)}/${encodeKey(key)}`;
  const expires = String(Math.max(1, Math.min(Number(expiresSeconds) || 300, 604800)));

  const query = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate(now),
    'X-Amz-Expires': expires,
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalRequest = [
    verb,
    canonicalUri,
    canonicalQuery(query),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    amzDate(now),
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(signingKey(secretAccessKey, stamp), stringToSign, 'hex');
  return `https://${host}${canonicalUri}?${canonicalQuery({ ...query, 'X-Amz-Signature': signature })}`;
}
