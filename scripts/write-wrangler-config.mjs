// Writes wrangler.generated.jsonc, which is wrangler.jsonc with the D1
// database id filled in from the environment.
//
// The id is held as a repository secret rather than committed, so the tracked
// config carries a placeholder and deploys are pointed at the generated file.
// Generating a second file rather than rewriting the tracked one means the id
// can never end up in a commit by accident.
//
//   D1_DATABASE_ID=<id> node scripts/write-wrangler-config.mjs
//   wrangler deploy -c wrangler.generated.jsonc

import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'wrangler.jsonc';
const TARGET = 'wrangler.generated.jsonc';
const PLACEHOLDER = 'D1_DATABASE_ID_FROM_SECRET';

function fail(message) {
  // Never echo the id itself: this runs in CI logs.
  console.error(`${TARGET}: ${message}`);
  process.exit(1);
}

const id = (process.env.D1_DATABASE_ID ?? '').trim();
if (!id) {
  fail('D1_DATABASE_ID is not set. Add CLOUDFLARE_D1_DATABASE_ID to the repository secrets, or export it locally.');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  fail('D1_DATABASE_ID is not a database id. Expected the UUID printed by: wrangler d1 create horner-tracker');
}

const config = await readFile(SOURCE, 'utf8');
if (!config.includes(PLACEHOLDER)) {
  fail(`${SOURCE} no longer contains ${PLACEHOLDER}. Has the D1 binding changed?`);
}

await writeFile(TARGET, config.replaceAll(PLACEHOLDER, id));
console.log(`Wrote ${TARGET} with the database id from the environment.`);
