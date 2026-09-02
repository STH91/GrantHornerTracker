// Turnstile verification, following Cloudflare's canonical siteverify flow.
//
// Embedding the widget does nothing on its own: a request is only protected
// once the token it carries has been checked here. Beyond `success`, the
// result's `action` and `hostname` are checked too, so a token solved against
// another form or on another host (localhost, say, which widgets commonly
// allow for development) cannot be replayed against production.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 10_000;

// Set as `action` when the widget is rendered, and required to match here.
export const SIGNUP_ACTION = 'signup';

export function isConfigured(env) {
  return Boolean(env.TURNSTILE_SITE_KEY);
}

// A token is only acceptable if it was solved on a hostname this deployment
// serves. With nothing configured that is the host handling the request, which
// is both correct per deployment and impossible to leave stale.
export function allowedHostnames(env, request) {
  const configured = String(env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [new URL(request.url).hostname];
}

// Pure: turns a siteverify response into a verdict. Kept separate from the
// network call so every branch can be tested directly.
export function judge(result, { action, hostnames }) {
  if (!result || result.success !== true) {
    const codes = result?.['error-codes'] ?? [];
    // Tokens are single use; a replayed one comes back as already spent.
    if (codes.includes('timeout-or-duplicate')) return { ok: false, reason: 'replayed' };
    return { ok: false, reason: 'failed', codes };
  }
  if (result.action !== action) return { ok: false, reason: 'action' };
  if (!hostnames.includes(result.hostname)) return { ok: false, reason: 'hostname' };
  return { ok: true };
}

// Returns null when the visitor passed, or { status, message } to reject with.
export async function verify(env, request, token) {
  // Turnstile deliberately switched off: no site key, no challenge, no check.
  if (!isConfigured(env)) return null;

  // Configured but unusable. Refusing is the only safe answer: accepting
  // unverified signups because a secret went missing is the exact failure
  // Turnstile is here to prevent.
  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET is missing. Refusing signups.');
    return { status: 503, message: 'Signup is temporarily unavailable. Please try again later.' };
  }

  if (!token) {
    return { status: 400, message: 'Complete the verification challenge and try again.' };
  }

  let result;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') ?? '',
      }),
    });
    if (!response.ok) throw new Error(`siteverify returned ${response.status}`);
    result = await response.json();
  } catch (error) {
    // Unreachable or misbehaving siteverify fails closed, never open.
    console.error('Turnstile siteverify call failed:', error);
    return { status: 403, message: 'Verification could not be completed. Please try again.' };
  }

  const verdict = judge(result, {
    action: SIGNUP_ACTION,
    hostnames: allowedHostnames(env, request),
  });
  if (verdict.ok) return null;

  console.warn(`Turnstile rejected a signup (${verdict.reason}).`);
  return verdict.reason === 'replayed'
    ? { status: 403, message: 'That challenge has already been used. Reload the page and try again.' }
    : { status: 403, message: 'Verification failed. Reload the page and try again.' };
}
