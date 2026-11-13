# UPlus Practice

Question bank for UPlus Education families (Perth Modern selective-entry prep): practice, flashcard blitz, timed mock tests, AI marking of written answers, progress tracking for kids and parents, and a tutor admin page with a manual "paid until" switch.

Zero dependencies. Needs Node 22.5+ (uses built-in SQLite).

## Branding
Colours follow the UPlus website: orange `#F1AF59`, indigo `#3949AB`, dark ink `#1F2937`, off-white `#F8F8F8`. `public/logo.png` and `public/favicon.png` were cut from a screenshot of the website — replace them with the official logo files (transparent PNG or SVG) for sharper results.

## Run
    npm start            # http://localhost:3000

First start seeds demo data:
- Parent: `parent@uplus.test` / `parent123` (child Mia, 10 days of history)
- Admin (tutor): `admin@uplus.test` / `admin123`
- New families sign up with the family code (default `UPLUS`, set `SIGNUP_CODE` to change) and get a 7-day free trial.

## Deploying (Render) and capacity
**Render steps:** push the repo, create a *Blueprint* from `render.yaml` (or a Web Service with the same settings), then enter `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SIGNUP_CODE` and `ANTHROPIC_API_KEY` when asked. Open the URL and sign in as that admin. In production the app refuses to start without those settings and creates **no demo accounts**.
- The free Render tier has no persistent disk and sleeps when idle, so data would be lost. Use a paid plan with the disk attached (the blueprint does this). A service with a disk is a single instance and redeploys cause a brief pause.
- Data is one SQLite file on the disk. The app writes a consistent copy every night to `BACKUP_DIR` (keeps 7). Also turn on Render's disk snapshots, and download a backup off-site occasionally.
- `GET /healthz` is the health check.

**Measured capacity** (load test on a 4-core dev machine, then again with the server limited to one core, as a rough stand-in for a small instance):
| | 4 cores | 1 core |
|---|---|---|
| 150 students answering non-stop | ~2,700 req/s, p95 70 ms | ~3,100 req/s, p95 63 ms |
| 300 families signing up | p95 0.2 s | p95 0.8 s |
| 200 logins in the same instant | p95 1.7 s | p95 6.8 s |
| Admin families page, 300 families, 900k saved answers | 0.12 s | n/a |
Real students pause to think, so 150 non-stop students is far heavier than 150 real ones. The practical ceilings are AI cost/rate limits (handwriting marking is capped at 6 simultaneous calls with a queue) and the single-instance design. Plan to move to Postgres if you outgrow roughly several thousand active students or need zero-downtime deploys. Not yet tested on Render itself, over a real network, or with a real AI key.

## Environment variables
| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `SIGNUP_CODE` | code parents need to create an account |
| `ANTHROPIC_API_KEY` | enables AI marking of `written` questions. Without it, children self-mark against the model answer |
| `MARK_MODEL` | override marking model |
| `EXTRACT_MODEL` | model used for booklet extraction |
| `NODE_ENV=production` | requires `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SIGNUP_CODE`; secure cookies; no demo data |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | create the admin on first start of an empty database |
| `TRUST_PROXY` | set to `1` behind a proxy such as Render so rate limits use the real client address |
| `BACKUP_DIR` | nightly SQLite backups (default `./backups`) |
| `AI_CONCURRENCY` | max simultaneous AI calls (default 6) |
| `RATE_LIMIT=off` | disables login/signup rate limits (load testing only) |
| `DB_FILE` | SQLite path (default `./uplus.db`) |

## Answering by hand: photo, writing pad or typing
- **Written questions** offer three input modes: *Photo of paper*, *Write on screen* (a drawing pad for finger, stylus or mouse, with pen, eraser, undo and clear), or *Type*. The last choice is remembered.
- **Short-answer questions** default to typing, with an option to *Write on screen*; handwritten answers are read by AI.
- Photos and drawings are shrunk in the browser, sent to Claude for marking (final answer and method), and **not stored**. If the image is unreadable the child is asked to try again and no attempt is recorded. Palm rejection ignores touch while a stylus is in use.
- Multiple choice and typed short answers are marked instantly in the browser/server at no AI cost.
- Without `ANTHROPIC_API_KEY` the child self-marks against the model answer instead.

## Importing booklets (drag & drop)
Log in as admin → **Import booklet**. Pick the year group, drop a PDF (or page photos, max 30 MB each; split long booklets). Claude extracts every question into a review queue, flagging answers it had to work out itself and questions that depend on a diagram. Edit anything, then approve; approved questions go live immediately. Needs `ANTHROPIC_API_KEY` (optional `EXTRACT_MODEL`). Always check flagged answers before approving.

## Managing questions (admin → Questions)
All questions live in the database and are managed in the app: add one at a time with the form, edit, delete (students stop seeing it; past results are kept), search and filter. New year groups, subjects and topics are created just by typing them. The 20 sample questions that ship with the app can be removed with one button. To add many at once, use **Import** (below).

## Language
A 中文 / English toggle in the header switches the whole interface (Simplified Chinese). The choice is remembered per device, and defaults to Chinese on Chinese-language browsers. Strings live in `public/i18n.js` (keys are the English text; anything missing falls back to English). AI marking feedback is written in Chinese when the child is using the Chinese interface. Question content is shown exactly as entered, so a bilingual question is simply typed bilingually.

## Before real families use it
- Change the seeded admin password (or delete the demo users) and run behind HTTPS on a domain.
- Test from a phone in mainland China, including inside WeChat.
- Add a privacy notice (children's names and results are stored).
- Confirm you may reuse the booklet/past-paper content.
