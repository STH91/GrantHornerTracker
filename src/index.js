import { LISTS, LIST_COUNT, advance, rewind, describe } from './bible.js';
import {
  generateId, normaliseId, hashPassphrase, verifyPassphrase, iterationCount,
  createSession, authenticate, destroySession, sessionCookie, clearedCookie,
  clientIp, isThrottled, recordAttempt,
} from './auth.js';
import { verify as verifyTurnstile, isConfigured as turnstileConfigured } from './turnstile.js';

const MIN_PASSPHRASE = 8;
const MAX_PASSPHRASE = 200;
const SIGNIN_LIMIT = 10;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

function fail(status, message) {
  return json({ error: message }, { status });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function validPassphrase(value) {
  return typeof value === 'string' && value.length >= MIN_PASSPHRASE && value.length <= MAX_PASSPHRASE;
}

function parseListNo(value) {
  const listNo = Number.parseInt(value, 10);
  return Number.isInteger(listNo) && listNo >= 1 && listNo <= LIST_COUNT ? listNo : null;
}

// --- State ------------------------------------------------------------------

async function loadState(env, accountId) {
  const [positions, undoable] = await env.DB.batch([
    env.DB.prepare('SELECT list_no, chapter_offset, cycles FROM position WHERE account_id = ?').bind(accountId),
    env.DB.prepare('SELECT DISTINCT list_no FROM read_log WHERE account_id = ?').bind(accountId),
  ]);
  const byList = new Map(positions.results.map((row) => [row.list_no, row]));
  const canUndo = new Set(undoable.results.map((row) => row.list_no));
  return LISTS.map((list) => {
    const row = byList.get(list.no) ?? { chapter_offset: 0, cycles: 0 };
    return describe(list.no, row.chapter_offset, row.cycles, canUndo.has(list.no));
  });
}

async function readPosition(env, accountId, listNo) {
  return env.DB.prepare('SELECT chapter_offset, cycles FROM position WHERE account_id = ? AND list_no = ?')
    .bind(accountId, listNo).first();
}

async function hasLog(env, accountId, listNo) {
  const row = await env.DB.prepare('SELECT 1 AS present FROM read_log WHERE account_id = ? AND list_no = ? LIMIT 1')
    .bind(accountId, listNo).first();
  return Boolean(row);
}

// The update is guarded on the values we read, so a double-tap cannot advance
// the list twice. A losing write simply reports the current position.
async function writePosition(env, accountId, listNo, from, to) {
  const result = await env.DB.prepare(
    `UPDATE position SET chapter_offset = ?, cycles = ?
       WHERE account_id = ? AND list_no = ? AND chapter_offset = ? AND cycles = ?`,
  ).bind(to.offset, to.cycles, accountId, listNo, from.chapter_offset, from.cycles).run();
  return result.meta.changes === 1;
}

async function markRead(env, accountId, listNo) {
  const current = await readPosition(env, accountId, listNo);
  if (!current) return fail(404, 'No position for that list.');
  const next = advance(listNo, current.chapter_offset, current.cycles);
  if (await writePosition(env, accountId, listNo, current, next)) {
    await env.DB.prepare('INSERT INTO read_log (account_id, list_no, chapter_offset, read_at) VALUES (?, ?, ?, ?)')
      .bind(accountId, listNo, current.chapter_offset, Date.now()).run();
    return json({ list: describe(listNo, next.offset, next.cycles, true) });
  }
  const settled = await readPosition(env, accountId, listNo);
  return json({ list: describe(listNo, settled.chapter_offset, settled.cycles, await hasLog(env, accountId, listNo)) });
}

async function undoRead(env, accountId, listNo) {
  const entry = await env.DB.prepare(
    'SELECT id, chapter_offset FROM read_log WHERE account_id = ? AND list_no = ? ORDER BY id DESC LIMIT 1',
  ).bind(accountId, listNo).first();
  if (!entry) return fail(409, 'Nothing to undo in that list.');

  const current = await readPosition(env, accountId, listNo);
  const previous = rewind(listNo, entry.chapter_offset, current.cycles);
  if (await writePosition(env, accountId, listNo, current, previous)) {
    await env.DB.prepare('DELETE FROM read_log WHERE id = ?').bind(entry.id).run();
    return json({ list: describe(listNo, previous.offset, previous.cycles, await hasLog(env, accountId, listNo)) });
  }
  const settled = await readPosition(env, accountId, listNo);
  return json({ list: describe(listNo, settled.chapter_offset, settled.cycles, await hasLog(env, accountId, listNo)) });
}

// --- Accounts ---------------------------------------------------------------

async function signUp(env, request) {
  const ip = clientIp(request);
  if (await isThrottled(env, `signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)) {
    return fail(429, 'Too many new IDs from this connection. Try again later.');
  }
  const { passphrase, turnstileToken } = await readJson(request);
  if (!validPassphrase(passphrase)) {
    return fail(400, `Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  await recordAttempt(env, `signup:${ip}`);

  // Nothing is created until the challenge has been checked.
  const rejection = await verifyTurnstile(env, request, turnstileToken);
  if (rejection) return fail(rejection.status, rejection.message);

  const passHash = await hashPassphrase(passphrase, iterationCount(env));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    const seed = LISTS.map((list) => env.DB
      .prepare('INSERT INTO position (account_id, list_no, chapter_offset, cycles) VALUES (?, ?, 0, 0)')
      .bind(id, list.no));
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO account (id, pass_hash, created_at) VALUES (?, ?, ?)')
          .bind(id, passHash, Date.now()),
        ...seed,
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE')) continue;
      throw error;
    }
    const token = await createSession(env, id);
    return json({ id, lists: await loadState(env, id) }, { headers: { 'Set-Cookie': sessionCookie(token) } });
  }
  return fail(503, 'Could not allocate an ID. Try again.');
}

async function signIn(env, request) {
  const ip = clientIp(request);
  if (await isThrottled(env, `signin:${ip}`, SIGNIN_LIMIT, SIGNIN_WINDOW_MS)) {
    return fail(429, 'Too many attempts. Wait fifteen minutes and try again.');
  }
  await recordAttempt(env, `signin:${ip}`);

  const body = await readJson(request);
  const id = normaliseId(body.id);
  const account = await env.DB.prepare('SELECT id, pass_hash FROM account WHERE id = ?').bind(id).first();
  // Hash regardless, so a missing ID and a wrong passphrase take similar time.
  const stored = account?.pass_hash ?? `pbkdf2-sha256$${iterationCount(env)}$${btoa('decoy-salt-16by')}$${btoa('x'.repeat(32))}`;
  const ok = await verifyPassphrase(String(body.passphrase ?? ''), stored);
  if (!account || !ok) return fail(401, 'That ID and passphrase do not match.');

  const token = await createSession(env, account.id);
  return json(
    { id: account.id, lists: await loadState(env, account.id) },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}

// --- Routing ----------------------------------------------------------------

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === '/api/config' && method === 'GET') {
    return json({ turnstileSiteKey: turnstileConfigured(env) ? env.TURNSTILE_SITE_KEY : '' });
  }
  if (path === '/api/signup' && method === 'POST') return signUp(env, request);
  if (path === '/api/signin' && method === 'POST') return signIn(env, request);
  if (path === '/api/signout' && method === 'POST') {
    await destroySession(env, request);
    return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } });
  }

  const accountId = await authenticate(env, request);
  if (!accountId) return fail(401, 'Not signed in.');

  if (path === '/api/state' && method === 'GET') {
    return json({ id: accountId, lists: await loadState(env, accountId) });
  }
  if ((path === '/api/read' || path === '/api/undo') && method === 'POST') {
    const listNo = parseListNo((await readJson(request)).list);
    if (!listNo) return fail(400, 'Unknown list.');
    return path === '/api/read' ? markRead(env, accountId, listNo) : undoRead(env, accountId, listNo);
  }
  return fail(404, 'No such endpoint.');
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, pathname);
      } catch (error) {
        console.error(error);
        return fail(500, 'Something went wrong.');
      }
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
