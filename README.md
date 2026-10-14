# Know Jack — concept-first trivia

A static, no-backend trivia game (inspired by *You Don't Know Jack*). Open it on a phone or laptop, pick a category, answer fast.

## File structure

```
trivia/
├── index.html                  # the whole UI (menu, category info, question, results)
├── css/style.css               # mobile-first theme + animations
├── js/validator.js             # JSON validation + prerequisite (topological) ordering
├── js/audio.js                 # synthesized buzzer sounds (Web Audio, no files), mute toggle
├── js/game.js                  # game loop: timer, scoring, feedback, results breakdown
├── categories/manifest.json    # list of built-in categories shown on the menu
├── categories/ccrn-concepts.json
└── README.md
```

## How it plays

- 15 seconds per question (change `QUESTION_SECONDS` at the top of `js/game.js`).
- Correct = 100 points + a speed bonus of up to 50 (scales down to 0 at the buzzer).
- Wrong or out of time = the correct answer is highlighted and the explanation is shown.
- Answer choices are shuffled each game so positions can't be memorized.
- Concepts are played in prerequisite order (foundational → applied). Options on the category screen let you shuffle questions within a concept and limit questions per concept for a quick round.
- Keyboard: A–D or 1–4 to answer, Enter/Space for next. 🔊 button mutes; the setting is remembered.
- Results show score, accuracy, average answer time, a per-concept breakdown, and a "review next" list of concepts under 60%.

## Adding a category

1. Create `categories/your-topic.json` using this exact structure:

```json
{
  "category": "string",
  "description": "string",
  "concepts": [
    {
      "id": "string",
      "title": "string",
      "prerequisites": ["concept ids"],
      "questions": [
        { "question": "string", "choices": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "string" }
      ]
    }
  ]
}
```

   Rules the validator enforces: ids unique; 3–4 choices; `answerIndex` within range; prerequisites must reference existing ids and not form a loop.

2. Add it to `categories/manifest.json`:

```json
{ "name": "Your Topic", "file": "your-topic.json", "description": "One line shown on the menu." }
```

No code changes needed. Or skip the manifest entirely and use **Load custom category** on the menu — the file is read on-device (works offline) and never uploaded.

## Running locally

Built-in categories are fetched with `fetch()`, which browsers block for `file://` pages, so serve the folder:

```
cd trivia
python3 -m http.server 8000      # then open http://localhost:8000
```

(Opening `index.html` directly still works for **Load custom category**.)

## Free hosting

**GitHub Pages**
1. Create a repo and push this folder's contents to it (keep `index.html` at the repo root).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
3. Your site appears at `https://<username>.github.io/<repo>/` in a minute or two. Updating a category is just a commit.

**Netlify Drop**
1. Go to https://app.netlify.com/drop
2. Drag the `trivia` folder onto the page. Done — you get a public URL immediately; sign in to keep it or set a custom name.

**Cloudflare Pages / Vercel** also work the same way (static site, no build step).

## Clinical content — please verify before studying from it

`ccrn-concepts.json` was written to teach concepts, not to mirror the exam, and it has **not** been reviewed by a clinician. Check it against the AACN CCRN (Adult) exam handbook / test plan and a current critical-care reference. Items most worth checking are listed in the project notes that came with this build (numeric thresholds, sepsis definitions, hyperkalemia ECG progression, CPP targets, ARDS ventilation specifics, and the HIT management statement).
