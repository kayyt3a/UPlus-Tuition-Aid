# U Plus Practice

A grind-able question bank for tuition-centre families: pick a year group, subject and topic, answer 10 questions with instant marking and explanations, earn XP and streaks. Parents get a progress page. Questions the child gets wrong come up more often. A "Holiday challenge" gives a mixed 20-question set.

No backend: progress is stored in the child's browser, so it hosts free anywhere static (GitHub Pages, Vercel, Netlify).

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

## Add questions from your booklets
1. Copy `tools/template.csv`, fill one row per question (`type` = `mc` or `short`; separate accepted short answers with `|`).
2. `node tools/csv-to-json.js yourfile.csv` appends them to `data/questions.json`.

## Known limits / next steps
- Progress lives on one device (no login, parents can't see it remotely). Next step: Supabase accounts + invite codes.
- Auto-marking only (multiple choice / short answer). Written answers would need self-marking.
- Sample questions are placeholders; replace with your booklet content.
