# Caderno de Línguas

A daily study planner for French and Spanish (CEFR A2 → C1), built as a Claude Artifact. It focuses on **written accuracy**: you produce answers, Claude corrects them like a strict examiner, every mistake becomes a new exercise, and spaced repetition brings it back until it sticks.

## Features

- **Fixed weekly plan driven by your real classes.** Toggle "had a class today" and the day adapts (class + 1 block, or a long day). A "hard day?" button drops the day to the minimum. Nothing piles up: missed work is not carried over as debt.
- **10-minute blocks** of 8 mixed questions: fill-in, multiple choice, translation from Portuguese, transformation, find-the-error, dictation and short production tasks.
- **Examiner-mode correction** by Claude for open answers; closed answers are graded locally. Each error is stored with a fixed category, the wrong fragment, the fix, an explanation (in the target language, with a Portuguese toggle), and flags for Portuguese interference and spelling.
- **Spaced repetition** with difficulty classified automatically (score, time, questions asked, replays). No self-rating.
- **Ask / contest** buttons on every correction. A successful contest re-scores the attempt.
- **Dictation** using native device voices only (`fr-FR` and `es-ES`; multilingual and novelty voices are filtered out).
- **Essays** on weekends: plan → write → examiner correction (6 general writing scores + language scores + errors per 100 words) → mandatory rewrite from memory → re-correction. Errors turn into new questions.
- **Class log**: note the class topic and the teacher's corrections; the app maps the topic to the syllabus and only generates new questions if there are fewer than 8 unseen ones.
- **Unlimited questions**: a hand-written A2 seed bank (≈230 French, ≈200 Spanish) plus automatic generation when a topic runs low, and a "generate from my history" button.
- **Level-up rule**: at least 28 days at the level, ≥85 % accuracy over the last 28 days, and every topic of the level at ≥80 % with at least 5 attempts.
- **Progress**: last-7-days summary, error heatmap by category and week, what improved vs. got worse, essay trends, accuracy per topic, time per question type, streak.
- **The whole interface switches to the language of the day.**

The questions and the correction prompts are written for a **native Brazilian Portuguese speaker** (Portuguese interference, false friends, translation prompts in Portuguese). Other learners can use it, but that is who it is tuned for.

## How it works

The app is a single HTML page (`caderno.html`) that runs inside the Claude Artifact runtime. It does not work as a standalone website, because it relies on three runtime capabilities that only exist there:

| Capability | Used for |
|---|---|
| `db` | Storing answers, errors, essays, blocks and settings. Data lives in each user's private folder (`data/users/<id>/caderno/…`), so nobody else can read it, not even the artifact owner. |
| `user` | Getting the current user's id to locate their private folder. |
| `sample` | Calling Claude for corrections, explanations and question generation. Calls run on **the viewer's own Claude account and usage**. |

There are no API keys or secrets in this repository. If you open `caderno.html` directly in a browser, it shows a message saying it must be opened in Claude.

## How to use it

### Option 1 — Publish your own copy (recommended)

You need a Claude account with Artifacts enabled.

1. Clone this repository and build the page:
   ```bash
   python3 build.py   # writes caderno.html
   ```
2. In Claude (claude.ai or Claude Code), attach `caderno.html` and ask Claude to **publish it as an Artifact with these capabilities**:
   ```json
   {
     "db": {
       "rules": [
         { "path": "", "read": "admin", "write": "owner" },
         { "path": "data/users/{self}", "read": "interact", "write": "interact" }
       ]
     },
     "user": {},
     "sample": {}
   }
   ```
3. Open the artifact link while signed in. On the first correction, Claude asks you to allow the page to use Claude; accept it.
4. Optional: on iPhone, open the link in Safari → Share → **Add to Home Screen**.

Your progress is saved to your account and syncs across devices.

### Option 2 — Use someone else's published copy

The owner can share their artifact from its **Share** menu. Each person gets their own private notebook, but:

- The person needs at least **Contributor** access. Viewers and commenters can open the page but cannot save anything.
- Corrections use **the viewer's own** Claude usage, and each viewer approves the Claude permission once.
- People outside the owner's organization, or arriving through a public link, may only get view access. In that case, Option 1 is the way to go.

### Dictation voices

Dictation uses the voices installed on the device:

- **Chrome:** uses "Google français" / "Google español" when available. Nothing to install.
- **Safari / iPhone / Mac:** download native voices in Settings → Accessibility → Spoken Content → Voices: French (France) → *Thomas* or *Audrey*, Spanish (Spain) → *Mónica*, preferably the "Enhanced" versions.

Pick the voice in **Settings → Dictation voices** and press **Test**. If the device has no native voice, dictation is disabled automatically. You can also turn it off per language.

## Customizing

| What | Where |
|---|---|
| Weekly schedule (which days have classes, long days, essays) | `template()` in `core.js` |
| Topics per level, error categories, essay formats and tasks | `topics.js` |
| Seed questions | `seed_fr.js`, `seed_es.js` (`[topic, type, prompt, answers, {c: category, o: options, i: instruction}]`) |
| Correction and generation prompts, learner profile | `claude.js` (`LEARNER`, `correctOpen`, `correctEssay`, `generate*`) |
| Interface texts | `i18n.js` |
| Spaced-repetition intervals, level-up rule, block size | `core.js` (`applySrs`, `levelStatus`, `buildBlockItems`) |
| Look and feel | `style.css` |

After any change, run `python3 build.py` and republish `caderno.html` to the same artifact. Stored data is kept across republishes.

## Project structure

| File | Contents |
|---|---|
| `topics.js` | Topics per level (A2–C1), error categories, question types, essay formats and A2 essay tasks |
| `seed_fr.js`, `seed_es.js` | Hand-written A2 question bank |
| `i18n.js` | Interface texts in French and Spanish |
| `core.js` | Calendar, block assembly, spaced repetition, local grading, statistics |
| `claude.js` | Prompts for correction, doubts, contests and question generation |
| `ui.js` | Screens and actions |
| `style.css`, `shell_head.html` | Styles and page head |
| `build.py` | Concatenates everything into `caderno.html` |
