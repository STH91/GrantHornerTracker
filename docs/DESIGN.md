# Design decisions

The choices behind this app, and what was traded away for each. Recorded so
future changes are made deliberately rather than by accident.

## The problem

Horner's system needs ten bookmarks. A bookmark marks a page, not a chapter, so
every morning starts with working out which chapter on the page comes next,
ten times over. Ten integers in a database removes that entirely.

## Scope

Minimum viable, explicitly. The app records where you are in each of the ten
lists and moves you forward. It does not show scripture text, link out to a
translation, track days or streaks, or present a daily checklist.

## Decisions

| Area | Decision | Why, and what it costs |
| ---- | -------- | ---------------------- |
| Hosting | Cloudflare Workers + D1 | One deploy, no cold starts, free tier is ample, and static assets and API live in one place. Ties the app to Cloudflare's platform. |
| Build | None. Vanilla HTML, CSS, ES modules | Readable in five years without reinstalling a toolchain, no dependency upgrades, no supply chain. No framework conveniences: DOM building is manual. |
| Day model | Pure position. No concept of a day | Lists advance independently, in any order, across any number of sittings, with no timezone logic anywhere. No streaks and no "have I done today?" signal. |
| History | Ten positions, plus a `read_log` row per mark | Undo works, and streaks or history can be added later without a migration. Costs one small write per tap. |
| Identity | Generated ID, user-chosen passphrase | Nothing identifying is stored, and IDs cannot be enumerated or guessed. You must record the ID somewhere. |
| Recovery | None | No email, no reset flow, no second secret to store. Losing both ID and passphrase loses the data — mitigated by a year-long session, a blunt warning at signup, a copy button, and the ID staying visible while signed in. |
| Session | One-year `HttpOnly` cookie, refreshed on use | Sign in once per device and never think about it. The device effectively becomes the credential. |
| Signup | Open to anyone with the URL | In keeping with a system its author asks you to share, and it costs nothing on free tier. Requires rate limiting and Turnstile. |
| Onboarding | All ten lists start at chapter 1 | No wizard to build. Anyone joining mid-system must tap forward to their real position, which is why there is no position picker. |
| Corrections | Undo only, one step at a time, repeatable | Covers the mis-tap, which is the realistic error. No way to jump a list forwards other than marking chapters read. |
| Bulk actions | None. Ten individual taps | Every mark is a deliberate act; you cannot claim a day you did not finish. Ten taps on a complete day. |
| Row content | Reference, position in list, cycles completed | Cycles are motivating over a year. The count is hidden until it is greater than zero, which keeps the row on one line. |
| Platform | Installable PWA, online only | Home screen icon and app-like launch for about thirty lines. Marking a chapter read still needs connectivity. |
| Look | Warm serif, paper light and dark themes | It is opened daily for years. Costs nothing beyond considered CSS. |

## Notable implementation points

**Bible data is server-side only.** The API returns resolved state
(`Psalms 47`, `47 of 150`), so there is exactly one source of truth for chapter
counts and the client holds no scripture knowledge.

**Marking read is a guarded update.** The `UPDATE` carries the offset and cycle
count that were read, so a double-tap cannot advance a list twice; the losing
write reports the current position instead.

**Undo derives the wrap.** A logged offset equal to the last chapter in a list
means that mark wrapped the list, so undoing it also unbanks the cycle.

**PBKDF2 iterations are a platform compromise, not a preference.** The Workers
free plan allows 10ms of CPU per request; 310,000 iterations takes over 150ms
and would fail outright, while 12,000 measures about 6.4ms. Each stored hash
records the count it was created with, so the value can be raised on Workers
Paid without invalidating existing accounts. Random IDs and per-IP rate limits
carry the rest of the weight.

**Turnstile fails closed.** Embedding the widget protects nothing on its own,
so the token is verified server-side before an account exists, and on `action`
and `hostname` as well as `success` — a token solved against another widget, or
on `localhost`, is refused. The only way to run without a challenge is to clear
the site key; a missing secret returns 503 rather than accepting unverified
signups, because a security control that silently switches itself off when
misconfigured is worse than none.

**Nothing identifying a deployment is committed.** The database id, serving
hostname and Turnstile site key are all repository secrets. None is a
credential — and a hostname reaches the public Certificate Transparency logs
the moment its certificate is issued — but the repository is public, and this
code should say nothing about where any particular copy of it runs.
`npm run config` fills them into a gitignored `wrangler.generated.jsonc` that
deploys use, so the tracked config is never rewritten and the values cannot be
committed by accident. Absent values degrade rather than break: no hostname
serves on workers.dev, no site key runs without the challenge.

## If it grows

The read log is the seam. Streaks, "what did I read yesterday", chapters per
day and per-list history are all queries against data already being written.
Adding a position picker and a bulk "mark all ten" would each be small; both
were deliberately declined for the first version.
