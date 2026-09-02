// Writes wrangler.generated.jsonc: wrangler.jsonc with its deployment-specific
// values filled in from the environment.
//
// Nothing that identifies a particular deployment — the database, the serving
// hostname, the Turnstile widget — is committed. The tracked config carries
// _FROM_SECRET placeholders, and deploys are pointed at the generated file.
// Generating a second file rather than rewriting the tracked one means those
// values can never end up in a commit by accident.
//
//   D1_DATABASE_ID=<id> APP_HOSTNAME=<host> TURNSTILE_SITE_KEY=<key> \
//     node scripts/write-wrangler-config.mjs
//   wrangler deploy -c wrangler.generated.jsonc

import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'wrangler.jsonc';
const TARGET = 'wrangler.generated.jsonc';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const SITE_KEY = /^[0-9]x[A-Za-z0-9_-]{10,}$/;

// Never echo a value: this runs in CI logs.
function fail(message) {
  console.error(`${TARGET}: ${message}`);
  process.exit(1);
}

function read(name) {
  return (process.env[name] ?? '').trim();
}

function fill(config, placeholder, value) {
  if (!config.includes(placeholder)) {
    fail(`${SOURCE} no longer contains ${placeholder}. Has the config changed?`);
  }
  return config.replaceAll(placeholder, value);
}

let config = await readFile(SOURCE, 'utf8');

// The database id is required: without it the Worker has no storage.
const databaseId = read('D1_DATABASE_ID');
if (!databaseId) {
  fail('D1_DATABASE_ID is not set. Add CLOUDFLARE_D1_DATABASE_ID to the repository secrets, or export it locally.');
}
if (!UUID.test(databaseId)) {
  fail('D1_DATABASE_ID is not a database id. Expected the UUID printed by: wrangler d1 create horner-tracker');
}
config = fill(config, 'D1_DATABASE_ID_FROM_SECRET', databaseId);

// The serving hostname is optional. Without one the Worker stays on its
// workers.dev URL, so the route is dropped rather than left as a placeholder.
const hostname = read('APP_HOSTNAME');
if (hostname) {
  if (!HOSTNAME.test(hostname)) {
    fail('APP_HOSTNAME is not a hostname. Expected something like app.example.com, with no scheme or path.');
  }
  config = fill(config, 'APP_HOSTNAME_FROM_SECRET', hostname);
} else {
  const withoutRoutes = config.replace(/^\s*"routes":.*\n/m, '');
  if (withoutRoutes === config) fail(`${SOURCE} has no "routes" line to drop. Has the config changed?`);
  config = withoutRoutes;
}

// The Turnstile site key is optional; empty switches the challenge off.
const siteKey = read('TURNSTILE_SITE_KEY');
if (siteKey && !SITE_KEY.test(siteKey)) {
  fail('TURNSTILE_SITE_KEY is not a Turnstile site key. Expected something like 0xAAAAAAAA...');
}
config = fill(config, 'TURNSTILE_SITE_KEY_FROM_SECRET', siteKey);

// Nothing may reach a deploy still holding a placeholder.
const leftover = config.match(/\w*_FROM_SECRET/);
if (leftover) fail(`${leftover[0]} was not filled in.`);

await writeFile(TARGET, config);
console.log(
  `Wrote ${TARGET}: database id set, hostname ${hostname ? 'set' : 'omitted (workers.dev)'}, `
  + `Turnstile ${siteKey ? 'enabled' : 'off'}.`,
);
