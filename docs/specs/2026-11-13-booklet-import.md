# Booklet Import: Product Spec

Status: agreed with the product owner on 2026-11-13. Diagrams are deferred (see "Out of scope").

## Purpose
UPlus tutors write booklets that mix teaching content (explanations, notes, worked examples) with questions for students. The admin (the centre's director, who is not technical) needs to turn a booklet into student flashcards inside UPlus Ascend, without using any other website or tool.

The flow is: **upload a booklet → questions are extracted automatically → they appear as flashcards for students → the admin reads over them and edits anything that needs it.**

## Users
- **Admin (tutor or director):** uploads booklets, reads over and edits extracted questions. Not technical, so every step must be obvious and need no instructions.
- **Students:** see the extracted questions in Flashcard blitz, Practice and Mock tests, like any other question in the bank.

## Constraints
1. **Everything happens inside UPlus Ascend.** The admin never visits Claude.ai or any other service.
2. **Claude is the only AI provider.** Every uploaded booklet goes to Claude (Anthropic API) via the server's existing `ANTHROPIC_API_KEY`. No separate OCR service, other AI provider or self-hosted model.
3. **Accepted uploads:** PDF and page photos (PNG, JPEG), as today. Word booklets are saved as PDF first. The existing per-file size limit stays, and long booklets are uploaded in parts.
4. **No approval stage.** Extracted questions go live for students as soon as extraction finishes. The admin does not approve them one by one.
5. **The review stage is a read-over-and-edit list, not a gate.** Edits apply to the live question straight away.
6. **The interface must work in English and Chinese,** like the rest of the app. Any new text needs a Chinese translation.
7. **Low cost and simplicity come before flashiness.** Plain, well-organised screens; no extra services or subscriptions.

## What counts as a question (extraction rules)
Claude extracts **only questions the student is expected to answer**:
- **Include:** exercises, practice sets, homework, quizzes and test sections; multiple-choice, short-answer and written-answer questions.
- **Exclude all teaching content:** explanations, notes, key points, tips, summaries, headings and instructions.
- **Exclude worked examples,** even when they are phrased as a question, because the booklet already solves them in front of the student.
- **Exclude answer keys as separate items.** Use them only to fill in answers for the matching questions.
- **No duplicates.** If a question appears twice (for example on a revision page), extract it once.
- **Keep the booklet's original wording.** Do not reword, simplify or "improve" questions. Only the short explanation for students is written by Claude.
- **Answers:** use the booklet's answer when it gives one. If not, Claude works one out and the question is marked **"Answer written by AI: check it"**.
- **Diagrams (for now):** if a question depends on a picture, graph or table, Claude describes it in words inside the question and marks it **"Refers to a diagram"**.

Each extracted question keeps what the app already uses: year group, subject, topic, question type (multiple choice / short / written), question text, options (multiple choice only), accepted answers, explanation. It also records the booklet page it came from and the two markers above.

## Admin experience

### 1. Upload
Admin → **Import**. Choose the year group (and optionally the subject), then drag and drop the booklet or click to choose it. A clear progress message shows while Claude reads it (this can take a minute or two). When it finishes, the admin sees how many questions were added. Those questions are now live.

If something goes wrong (no API key, file too large, unreadable file), the admin sees a plain-language message saying what to do. Nothing is half-added.

### 2. Read over and edit (the review list)
Straight after upload, the admin lands on a **neatly organised, read-friendly list** of the questions from that booklet:
- **Grouped by booklet** (file name and upload date), then **by subject and topic**, in the order the questions appear in the booklet, with the page number shown.
- Each question is shown **the way a student would read it**: question text, options, the correct answer highlighted, and the explanation. It is not shown as a wall of form fields.
- **Markers stand out:** "Answer written by AI: check it" and "Refers to a diagram" are clearly visible. The admin can show only marked questions, to check the riskiest ones first.
- **Edit in place:** clicking **Edit** on a question turns it into an editable form: question text, options, answer(s), explanation, type, topic, subject, year group. The admin can fix extraction errors or change a question to make it harder or easier. **Save** updates the live question immediately; **Cancel** discards changes.
- **Remove:** the admin can remove a question that should not be there (for example a worked example that slipped through). Students stop seeing it; past results are kept, matching how removing a question already works in the app.
- Earlier imports stay reachable from the Import page, so the admin can come back later and re-check a booklet.

Editing manually is enough for making questions harder or easier. There is no AI "make harder/easier" button in this scope.

### 3. Students
Imported questions appear in Flashcard blitz, Practice and Mock tests for the chosen year group as soon as the import finishes, like any other question in the bank.

## Changes from current behaviour
- **Today:** extracted questions wait in a review queue and only go live after **Approve** or **Approve all**. **New:** they go live immediately, and the approve/reject buttons are removed.
- **Today:** the review queue is a stack of form fields. **New:** a read-friendly list grouped by booklet, subject and topic, with edit-on-demand.
- **Today:** the extraction instructions skip headings, instructions and answer keys. **New:** they also skip all teaching content and worked examples, avoid duplicates, and keep original wording.
- Questions already waiting in the old review queue when this ships should be made live and shown in the new list, so nothing is lost.

## Risks accepted
- Because there is no approval gate, an AI-written answer or a mis-extracted question can reach students before the admin reads it. This is mitigated by the visible markers and the "show only marked questions" filter, and the admin is expected to read over each import soon after uploading.

## Out of scope (for later)
- Diagram images on flashcards (cropping figures from the booklet). Deferred; diagrams stay as text descriptions with a marker for now.
- Other AI or OCR providers.
- Uploading Word (.docx) files directly.
- AI-assisted "make this harder/easier" rewriting.

## How to check it works
1. Upload a real booklet that contains teaching sections, worked examples and an answer key.
2. Confirm that no worked examples or teaching text appear in the list, that answers come from the answer key where one exists, and that no question appears twice.
3. Confirm the questions are immediately available to a student of that year group in Flashcard blitz.
4. Edit a question and confirm a student sees the new version. Remove one and confirm students no longer see it.
5. Switch the interface to Chinese and confirm the new screens are fully translated.
