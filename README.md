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
src/auth.js    ID generation, PBKDF2 hashing, sessions, throttling
src/turnstile.js  siteverify validation of the signup challenge
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
   [Deployment values](#deployment-values) below.

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

5. **Set the serving hostname** (optional). Add it as a repository secret
   named `APP_HOSTNAME`, as a bare hostname with no scheme or path. It is a
   `custom_domain` route, so wrangler creates the DNS record and orders the
   certificate on deploy — there is nothing to add by hand. The zone must be
   active on the same Cloudflare account, and the certificate usually takes a
   few minutes.

   Without `APP_HOSTNAME` the route is dropped and the Worker is served on its
   `workers.dev` URL. That URL stays live alongside a custom domain too, which
   helps while a certificate issues; once the domain works, adding
   `"workers_dev": false` to `wrangler.jsonc` leaves only one way in.

6. **Turn on Turnstile** (optional). Add the widget's site key as a repository
   secret named `TURNSTILE_SITE_KEY`, then set the matching secret on the
   Worker, which requires the Worker to exist, so deploy first:
   ```bash
   wrangler secret put TURNSTILE_SECRET
   ```
   Then check the widget's **Hostname management** in the Turnstile dashboard
   lists every hostname the app is served on, the `workers.dev` one included
   while it is in use. A token solved on a hostname the app is not serving is
   refused, so a missing entry shows up as every signup failing verification. A token solved on a hostname the
   app is not serving is refused, so a missing entry here shows up as every
   signup failing verification.

   With a site key set, signup will not proceed unless the token verifies. If
   the Worker secret is missing, signup returns 503 rather than quietly
   accepting unverified requests — leaving `TURNSTILE_SITE_KEY` unset is the
   only way to turn the challenge off.

### Turnstile

Signup is challenged by Turnstile; nothing else is. The client renders the
widget explicitly with `action: "signup"`, and the Worker checks three things
about the siteverify response, not just one:

| Check | Why |
| ----- | --- |
| `success` | The challenge was actually solved |
| `action` | The token came from this form, not some other widget on the account |
| `hostname` | The token was solved on a host this deployment serves |

The hostname check matters because widgets commonly allow `localhost` for
development. Without it, a token solved locally could be spent against
production. `TURNSTILE_HOSTNAMES` overrides the allowed list; left empty it is
the host serving the request, which is right for every deployment and cannot
go stale.

Tokens are single use and expire after five minutes. A replayed token comes
back from siteverify as `timeout-or-duplicate` and is refused.

Failures close rather than open. An unreachable siteverify, a non-200 from it,
a request that takes more than ten seconds, or a missing secret all reject the
signup.

To run locally without a challenge:

```bash
npx wrangler dev --var TURNSTILE_SITE_KEY:      # switched off entirely
```

Or put a secret in `.dev.vars` (gitignored) to exercise the real path.

### Deployment values

Nothing that identifies a particular deployment is committed. `wrangler.jsonc`
carries placeholders, and `npm run config` fills them from the environment into
`wrangler.generated.jsonc` — gitignored, and what deploys and remote D1
commands are pointed at with `-c`.

| Variable | Required | Missing means |
| -------- | -------- | ------------- |
| `D1_DATABASE_ID` | Yes | The script refuses to write a config |
| `APP_HOSTNAME` | No | The route is dropped; served on `workers.dev` |
| `TURNSTILE_SITE_KEY` | No | The signup challenge is switched off |

Generating a second file rather than rewriting the tracked one means those
values cannot end up in a commit by accident. Each is checked for shape, and a
placeholder that somehow survives aborts the run, so a misconfigured secret
fails at this step rather than reaching Cloudflare.

`wrangler dev` needs none of this: the local database is keyed by name, so the
placeholders are fine.

### Continuous deployment

`.github/workflows/deploy.yml` runs the tests on every pull request, and
deploys on pushes to `main`. The repository secrets it reads:

| Secret | What it is |
| ------ | ---------- |
| `CLOUDFLARE_API_TOKEN` | An API token with the *Edit Cloudflare Workers* template permissions |
| `CLOUDFLARE_D1_DATABASE_ID` | The id printed by `wrangler d1 create` |
| `APP_HOSTNAME` | The hostname to serve on, if any |
| `TURNSTILE_SITE_KEY` | The Turnstile widget's site key, if used |

The deploy job generates the wrangler config from these before calling
wrangler.

Note that a hostname is not really a secret: the moment a certificate is
issued for it, it is published to the public Certificate Transparency logs.
Keeping it out of the repository decouples this code from any particular
deployment; it does not make the address private.

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
- Signup is protected by Turnstile, verified server-side on `success`, `action`
  and `hostname`. Verification failures — including an unreachable siteverify —
  reject the signup rather than letting it through.
- The database id, serving hostname and Turnstile site key are held as
  repository secrets rather than committed. None is a credential, and a
  hostname is published to Certificate Transparency logs regardless, but
  keeping them out means this code says nothing about where it runs.
- **There is no account recovery.** Losing the ID and passphrase means losing
  the positions behind them, by design — there is no email or any other
  identifier on file to recover through.

## Licence

GPL-3.0. See `LICENSE`.
