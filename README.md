# UPlus Practice

Question bank for UPlus Education families (Perth Modern selective-entry prep): practice, flashcard blitz, timed mock tests, AI marking of written answers, progress tracking for kids and parents, and a tutor admin page with a manual "paid until" switch.

Zero dependencies. Needs Node 22.5+ (uses built-in SQLite).

## Run
    npm start            # http://localhost:3000

First start seeds demo data:
- Parent: `parent@uplus.test` / `parent123` (child Mia, 10 days of history)
- Admin (tutor): `admin@uplus.test` / `admin123`
- New families sign up with the family code (default `UPLUS`, set `SIGNUP_CODE` to change) and get a 7-day free trial.

## Environment variables
| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `SIGNUP_CODE` | code parents need to create an account |
| `ANTHROPIC_API_KEY` | enables AI marking of `written` questions. Without it, children self-mark against the model answer |
| `MARK_MODEL` | override marking model |
| `DB_FILE` | SQLite path (default `./uplus.db`) |

## Adding questions
Fill `tools/template.csv`, then `node tools/csv-to-json.js yourfile.csv`; restart the server. Types: `mc`, `short`, `written`. The sample questions are placeholders.

## Before real families use it
- Change the seeded admin password (or delete the demo users) and run behind HTTPS on a domain.
- Test from a phone in mainland China, including inside WeChat.
- Add a privacy notice (children's names and results are stored).
- Confirm you may reuse the booklet/past-paper content.
