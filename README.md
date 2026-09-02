# Grant Horner Tracker

A small web app that replaces the ten bookmarks used by [Professor Grant
Horner's Bible-Reading System](https://www.thevinehouston.com/wp-content/uploads/2015/03/professorgranthornersbiblereadingsystem.pdf).

The system asks you to read one chapter a day from each of ten lists, with each
list advancing independently and looping back to its start on completion.
Tracking that on paper means ten bookmarks, and a bookmark only tells you the
page — not which chapter on it you are up to. This app tells you exactly.

Sign in on any device with an ID and a passphrase, tap **Mark read** on a list,
and it moves on. Nothing about you is stored: the ID identifies a set of
reading positions and nothing else.

## How it works

A reader's entire state is ten integers. Each list is an ordered sequence of
books, flattened into a chapter sequence, and your position in a list is an
offset into that sequence. Resolving an offset to "Psalms 47" is a short walk
down cumulative chapter counts, and marking a chapter read is `offset + 1`,
wrapping to zero and banking a cycle at the end of the list.

Every mark also writes a row to `read_log`, which is what undo reverses. Nothing
in the interface reads that log beyond undo yet — it is there so streaks and
history can be added later without a migration.

| List | Contents | Chapters |
| ---- | -------- | -------- |
| 1 | Gospels | 89 |
| 2 | Pentateuch | 187 |
| 3 | Pauline Letters | 78 |
| 4 | Letters & Revelation | 65 |
| 5 | Wisdom | 62 |
| 6 | Psalms | 150 |
| 7 | Proverbs | 31 |
| 8 | Old Testament History | 249 |
| 9 | Prophets | 250 |
| 10 | Acts | 28 |

## Stack

One Cloudflare Worker serving both the static app and a small JSON API, backed
by D1. No build step and no runtime dependencies: the front end is plain HTML,
CSS and ES modules, served straight from `public/`.

```
public/        the app: HTML, CSS, one ES module, PWA manifest, service worker
src/bible.js   the ten lists, chapter counts, and all position arithmetic
src/auth.js    ID generation, PBKDF2 hashing, sessions, throttling, Turnstile
src/index.js   API routes
schema.sql     D1 schema
scripts/       writes wrangler.generated.jsonc with the D1 id from the environment
test/          node:test coverage of the position arithmetic
```

## Setting it up

You need a Cloudflare account. Everything below fits the free tier.

1. **Install wrangler and sign in.**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create the database.**
   ```bash
   wrangler d1 create horner-tracker
   ```
   The `database_id` it prints is not committed. Add it as a repository secret
   named `CLOUDFLARE_D1_DATABASE_ID` (Settings → Secrets and variables →
   Actions), and keep a copy for your own use — see
   [The generated config](#the-generated-config) below.

3. **Apply the schema.** The local database is keyed by name, so it needs
   nothing extra; the remote one needs the id.
   ```bash
   wrangler d1 execute horner-tracker --local --file=./schema.sql

   export D1_DATABASE_ID=<the id from step 2>
   npm run config
   wrangler d1 execute horner-tracker --remote -c wrangler.generated.jsonc --file=./schema.sql
   ```

4. **Deploy.** With `D1_DATABASE_ID` still exported:
   ```bash
   npm run deploy
   ```
   Or skip this entirely and let the merge to `main` deploy it.

5. **Point your domain at it** (optional). Add the hostname as a DNS record in
   Cloudflare, then uncomment the `routes` block at the bottom of
   `wrangler.jsonc` and set your hostname. Without it the app is served on
   `horner-tracker.<your-subdomain>.workers.dev`.

6. **Turn on Turnstile** (optional but recommended, since signup is open to
   anyone who finds the URL). Create a Turnstile widget in the Cloudflare
   dashboard, put the site key in `vars.TURNSTILE_SITE_KEY` in
   `wrangler.jsonc`, then:
   ```bash
   wrangler secret put TURNSTILE_SECRET
   ```
   With no secret configured the app runs unchallenged; the per-IP throttle
   applies either way.

### The generated config

`wrangler.jsonc` is committed with a `D1_DATABASE_ID_FROM_SECRET` placeholder
where the database id would normally sit. `npm run config` reads the real id
from the `D1_DATABASE_ID` environment variable and writes
`wrangler.generated.jsonc`, which is gitignored and is what deploys and remote
D1 commands are pointed at with `-c`.

Generating a second file rather than rewriting the tracked one means the id
cannot end up in a commit by accident. `wrangler dev` needs none of this: the
local database is keyed by name, so the placeholder is fine.

### Continuous deployment

`.github/workflows/deploy.yml` runs the tests on every pull request, and
deploys on pushes to `main`. Two repository secrets are needed:

| Secret | What it is |
| ------ | ---------- |
| `CLOUDFLARE_API_TOKEN` | An API token with the *Edit Cloudflare Workers* template permissions |
| `CLOUDFLARE_D1_DATABASE_ID` | The id printed by `wrangler d1 create` |

The deploy job generates the wrangler config from the second one before
calling wrangler.

## Working on it locally

```bash
npm run dev       # http://localhost:8787, against the local D1 copy
npm test          # position arithmetic
```

There is nothing to build. Editing a file in `public/` and reloading is the
whole loop.

## Security, plainly

- Passphrases are stored as PBKDF2-SHA256 with a per-account salt. The
  iteration count is recorded alongside each hash, so raising
  `PBKDF2_ITERATIONS` later does not lock anyone out.
- The default of 12,000 iterations is well below current OWASP guidance
  (310,000). This is a platform constraint, not a preference: the Workers free
  plan allows 10ms of CPU per request, and 12,000 iterations measures around
  6.4ms while 310,000 takes over 150ms and would fail the request outright.
  On Workers Paid the CPU ceiling is 30s, so set `PBKDF2_ITERATIONS` to
  `310000` there and redeploy. Accounts created under the old value keep
  working, and re-hash on nothing — the count travels with each hash.
- What carries the weight in the meantime: IDs are random rather than chosen,
  so an attacker must guess the ID as well as the passphrase, and both signup
  and sign-in are rate limited per IP.
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and last a year,
  refreshed as they are used.
- Sign-in is limited to 10 attempts per IP per 15 minutes, and signup to 5 per
  IP per hour. A sign-in for an unknown ID still performs the hash, so a
  missing ID and a wrong passphrase take a similar amount of time.
- The D1 database id is held as a repository secret rather than committed. It
  is an identifier rather than a credential — useless without the API token —
  but there is no reason for it to sit in a public repository.
- **There is no account recovery.** Losing the ID and passphrase means losing
  the positions behind them, by design — there is no email or any other
  identifier on file to recover through.

## Licence

GPL-3.0. See `LICENSE`.
