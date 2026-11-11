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

## Environment variables
| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `SIGNUP_CODE` | code parents need to create an account |
| `ANTHROPIC_API_KEY` | enables AI marking of `written` questions. Without it, children self-mark against the model answer |
| `MARK_MODEL` | override marking model |
| `EXTRACT_MODEL` | model used for booklet extraction |
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
