// Identity is deliberately thin: a generated ID, a passphrase, and a
// long-lived session cookie. Nothing here identifies a person.

const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o
const SESSION_COOKIE = 's';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 180 * 24 * 60 * 60 * 1000;
const DEFAULT_ITERATIONS = 12_000; // measured ~6.4ms: fits the free-tier 10ms CPU cap

const encoder = new TextEncoder();

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Reads like 'k7m2-q4xp': short enough to type on a phone, random enough that
// IDs cannot be walked.
export function generateId() {
  const pick = () => Array.from(randomBytes(4), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
  return `${pick()}-${pick()}`;
}

export function normaliseId(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function derive(passphrase, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function iterationCount(env) {
  const configured = Number.parseInt(env.PBKDF2_ITERATIONS ?? '', 10);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : DEFAULT_ITERATIONS;
}

// Stored as pbkdf2-sha256$<iterations>$<salt>$<hash> so the cost can be raised
// later without invalidating existing accounts.
export async function hashPassphrase(passphrase, iterations) {
  const salt = randomBytes(16);
  const hash = await derive(passphrase, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassphrase(passphrase, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2-sha256') return false;
  const expected = fromBase64(hash);
  const actual = await derive(passphrase, fromBase64(salt), Number.parseInt(iterations, 10));
  return timingSafeEqual(expected, actual);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(env, accountId) {
  const token = toBase64(randomBytes(32)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO session (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(await sha256Hex(token), accountId, now, now + SESSION_TTL_MS).run();
  return token;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// Returns the account ID for a valid session, refreshing the expiry when it is
// well through its life so daily use never signs you out.
export async function authenticate(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT account_id, expires_at FROM session WHERE token_hash = ?',
  ).bind(tokenHash).first();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM session WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (row.expires_at - now < SESSION_REFRESH_MS) {
    await env.DB.prepare('UPDATE session SET expires_at = ? WHERE token_hash = ?')
      .bind(now + SESSION_TTL_MS, tokenHash).run();
  }
  return row.account_id;
}

export async function destroySession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM session WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// --- Abuse protection -------------------------------------------------------

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export async function isThrottled(env, bucket, limit, windowMs) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS attempts FROM throttle WHERE bucket = ? AND at > ?')
    .bind(bucket, Date.now() - windowMs).first();
  return (row?.attempts ?? 0) >= limit;
}

export async function recordAttempt(env, bucket) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO throttle (bucket, at) VALUES (?, ?)').bind(bucket, now),
    env.DB.prepare('DELETE FROM throttle WHERE at < ?').bind(now - 24 * 60 * 60 * 1000),
  ]);
}
