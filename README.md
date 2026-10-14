# THINK&STUFF — concept-first trivia

A static, no-backend trivia game with a host who has opinions. Open it on a phone or laptop, pick a category, answer fast. Live at https://jshcrtmcd.github.io/knowjack/

## File structure

```
trivia/
├── index.html                  # the whole UI (menu, category info, question, results)
├── css/style.css               # mobile-first theme + animations
├── js/validator.js             # JSON validation + prerequisite (topological) ordering
├── js/audio.js                 # synthesized buzzer sounds (Web Audio, no files), mute toggle
├── js/host.js                  # Vivian Vex: all host lines + optional browser voice (edit the jokes here)
├── js/game.js                  # rounds, clocks, elimination, scoring, results
├── visuals/heart-simplified.svg
├── visuals/ecg-waveform.svg
├── categories/manifest.json    # list of built-in categories shown on the menu
├── categories/ccrn-concepts.json
└── README.md
```

## How it plays

- **3 rounds × 90 s + a 45 s Rapid Fire** — about five minutes, built to be replayed.
- Rounds follow the concept ladder: Round 1 draws from the foundational third of the concepts, Round 2 the middle, Round 3 the applied third. Questions inside a round are random and interleaved across concepts, so you won't see every question every game.
- **The clock only runs while you're choosing.** Each question gets ~2 s of reading time with the options hidden; the round clock and the 12 s question timer start when the options appear and stop the moment you answer, while the host talks, and between rounds.
- **Elimination:** with 4 choices, one wrong answer is struck out at half time and another at a quarter. Points scale with time remaining (150 for an instant answer, 50 at the buzzer), so waiting for the freebies is a losing trade.
- **Rapid Fire:** 6 s per question, 2 choices, double points, no explanations — missed ones are collected in the "What you missed" review at the end.
- Wrong answers show the correct answer plus the explanation; correct ones auto-advance after a few seconds (or tap Next).
- Choices are shuffled every time. Keyboard: A–D / 1–4 to answer, Enter or Space to continue.
- 🗣 toggles the host's voice (uses the browser's built-in speech synthesis; off by default). 🔊 mutes the sound effects. Both settings are remembered.
- Results: total score, per-round scores, accuracy, average answer time, breakdown by concept, "review next" list, and every missed question with its explanation. Your best score per category is saved on the device.

Tunables (round lengths, reading time, points) are constants at the top of `js/game.js`.

### The host

Vivian Vex lives in `js/host.js`. Every line is in the `LINES` object, grouped by moment (`welcome`, `roundIntro`, `correctFast`, `wrong`, `timeout`, `streak`, `roundEndGood`, `finalRough`, …). Add, delete, or rewrite lines freely; `{answer}`, `{score}`, `{streak}`, `{round}` and `{name}` are filled in at runtime.

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

   **Visual questions (optional):** add `"image": "visuals/heart-simplified.svg"` to a question to show a picture above it, and `"highlight": "lv"` to pulse the element with that id inside the SVG and drop a "?" marker on it. The built-in heart SVG has ids `ra`, `rv`, `la`, `lv`, `aorta`, `pa`, `svc`, `ivc`, `septum`, `tricuspid`, `mitral`; the ECG SVG has `p`, `pr`, `qrs`, `st`, `t`, `pr-interval`, `qt-interval`. Any SVG you add with ids works the same way; a PNG/JPG path shows as a plain image.

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
