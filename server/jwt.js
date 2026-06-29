import crypto from 'node:crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 8) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = base64url(
    crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest()
  );

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

export function verifyJwt(token, secret) {
  const [encodedHeader, encodedBody, signature] = String(token || '').split('.');
  if (!encodedHeader || !encodedBody || !signature) return null;

  const expected = base64url(
    crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest()
  );

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const payload = JSON.parse(decodeBase64url(encodedBody));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
