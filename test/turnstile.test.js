import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, allowedHostnames, isConfigured, SIGNUP_ACTION } from '../src/turnstile.js';

const EXPECTED = { action: SIGNUP_ACTION, hostnames: ['horner.example.com'] };

function passing(overrides = {}) {
  return {
    success: true,
    action: SIGNUP_ACTION,
    hostname: 'horner.example.com',
    challenge_ts: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

test('a solved challenge for this form on this host passes', () => {
  assert.deepEqual(judge(passing(), EXPECTED), { ok: true });
});

test('a replayed token is recognised as already spent', () => {
  const result = { success: false, 'error-codes': ['timeout-or-duplicate'] };
  assert.deepEqual(judge(result, EXPECTED), { ok: false, reason: 'replayed' });
});

test('other siteverify failures are reported with their codes', () => {
  const result = { success: false, 'error-codes': ['invalid-input-response'] };
  assert.deepEqual(judge(result, EXPECTED), {
    ok: false, reason: 'failed', codes: ['invalid-input-response'],
  });
});

test('a missing or malformed response never passes', () => {
  for (const result of [null, undefined, {}, { success: 'true' }, { success: 1 }]) {
    assert.equal(judge(result, EXPECTED).ok, false, `${JSON.stringify(result)} passed`);
  }
});

test('a token solved against another form is refused', () => {
  assert.deepEqual(judge(passing({ action: 'signin' }), EXPECTED), { ok: false, reason: 'action' });
  assert.deepEqual(judge(passing({ action: undefined }), EXPECTED), { ok: false, reason: 'action' });
});

test('a token solved on another host is refused', () => {
  // The case that matters: widgets usually allow localhost for development,
  // and such a token must not be spendable against production.
  assert.deepEqual(judge(passing({ hostname: 'localhost' }), EXPECTED), { ok: false, reason: 'hostname' });
  assert.deepEqual(judge(passing({ hostname: 'evil.example' }), EXPECTED), { ok: false, reason: 'hostname' });
});

test('several deployment hostnames can be allowed at once', () => {
  const expected = { action: SIGNUP_ACTION, hostnames: ['horner.example.com', 'localhost'] };
  assert.equal(judge(passing({ hostname: 'localhost' }), expected).ok, true);
});

test('hostnames default to the host serving the request', () => {
  const request = new Request('https://horner.example.com/api/signup');
  assert.deepEqual(allowedHostnames({}, request), ['horner.example.com']);
  assert.deepEqual(allowedHostnames({ TURNSTILE_HOSTNAMES: '' }, request), ['horner.example.com']);
});

test('configured hostnames are parsed and trimmed', () => {
  const request = new Request('https://horner.example.com/api/signup');
  assert.deepEqual(
    allowedHostnames({ TURNSTILE_HOSTNAMES: ' a.example.com , b.example.com ,' }, request),
    ['a.example.com', 'b.example.com'],
  );
});

test('Turnstile is on exactly when a site key is set', () => {
  // Cloudflare's documented always-passes test key, so no real widget appears here.
  assert.equal(isConfigured({ TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }), true);
  assert.equal(isConfigured({ TURNSTILE_SITE_KEY: '' }), false);
  assert.equal(isConfigured({}), false);
});
