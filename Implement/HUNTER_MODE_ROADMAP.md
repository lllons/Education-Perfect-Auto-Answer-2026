# Hunter Mode — Roadmap

> A planned addition to **EP Answer Assistant** (`script.js`, v4.0.x) that turns the
> userscript into an autonomous, self-driving runner that moves from one question
> to the next without user intervention, recovers from wrong answers, and keeps
> learning from its own mistakes.

---

## 1. Why "Hunter Mode"?

Today the script is **reactive**: a `MutationObserver` + interval poll detect the
current question, fuzzy-match it against the loaded `answerMap`, and type the
answer at the cursor. The user still has to:

* Hit **Load** when the list opens.
* Press **Enter / Submit** after each fill.
* Manually click **Next question** when one finishes.
* Babysit the script when EP shows a "Wrong — correct answer was X" overlay.

**Hunter Mode** flips that to **proactive**: as soon as a question is finished,
the script detects the success/wrong feedback UI, advances to the next
question, keeps the `answerMap` warm across the whole list, and (optionally)
walks straight into the next list when the current one completes.

The name matches the behaviour: the script "hunts" the next question the moment
the current one is dead.

---

## 2. Goals

1. **Zero-click completion of a loaded list** — once `Load` is pressed, the
   script finishes the list on its own.
2. **Automatic list hopping** — when a list finishes, open the next list in the
   same session (configurable).
3. **Survive wrong answers** — either dismiss the error and continue, *or*
   learn the correct answer from the feedback the moment EP reveals it.
4. **Stay out of the user's way** — if a human starts typing, hand control back
   instantly.
5. **Be safe to leave running** — bounded iterators, kill-switches, and visible
   state at all times.

---

## 3. Non-Goals (out of scope for v1)

* Bypassing EP's network/API — Hunter Mode is purely a DOM driver, same as the
  rest of the script.
* Logging into multiple accounts in parallel.
* Solving non-vocab activities (free writing, dictation, listening) — those are
  branch-`full`'s territory and stay separate.
* A full settings UI rewrite. Hunter Mode is mostly new state + new buttons
  inside the existing `#ep-panel`.

---

## 4. Current Architecture (relevant bits)

```
Vocabulary Loader ─► Answer Map Builder ─► Question Detector ─► Fuzzy Matcher ─► Cursor Typing
                                                                  │
                                                                  ▼
                                                          MutationObserver + poll
                                                                  │
                                                                  ▼
                                                          extension points:
                                                           • game-action-bar
                                                             "information" auto-next
                                                             (3500ms timed click)
                                                           • #start-button-school /
                                                             #start-button-main-label
                                                             start helpers
```

Hunter Mode sits **on top** of this pipeline as a small controller that
manages *question lifecycle* rather than answer typing.

---

## 5. Hunter Mode — Core Design

### 5.1 Question state machine

Introduce a single finite-state object per question to replace the loose flags
(`filling`, `lastFilled`, `cooldownUntil`, `pageChanging`):

```
IDLE  ─► DETECTED (question-word seen)
        │
        ▼
   TYPING (typeAtCursor running)
        │
        ▼
  AWAIT_VERDICT (waiting for EP to mark right/wrong)
        │      ▲
   "next" click│      │ wrong-answer overlay handled by ErrorPassPolicy
        ▼      │
     ADVANCE  ─┘
        │
   LIST_DONE ─► NEXT_LIST (if configured) or STOP
```

This replaces ad-hoc cooldowns with explicit transitions, which makes "what
happens after a wrong answer" a discrete hook instead of a heuristic.

### 5.2 "Question finished" detection

Hunter Mode needs to know **the moment a question is over**. Any of the below
counts as a verdict signal (highest priority first):

| Signal | DOM hint |
|---|---|
| Result overlay appears | `#incorrect-feedback`, `.feedback.incorrect`, `[data-result="wrong"]`, etc. |
| Correct toast / animation | `#correct-feedback`, `.feedback.correct`, green flash on the word |
| "Next" button becomes enabled | `#next-question`, `.sa-navigation-controls button`, `[data-action="next"]` |
| Question text disappears | `#question-text` removed or replaced |
| Score / progress increments | progress bar selector TBD |

The first one wins. Each signal fires the **Advance** transition.

### 5.3 Advance transition

* Wait **CFG.advanceDelay** ms (default ~600 ms) so EP animations settle.
* If there is an enabled **Next** button, click it.
* Otherwise click the **Continue** / **OK** button on whatever overlay exists.
* If neither exists but the question text changed, treat the new text as the
  next question immediately.
* Reset `lastFilled`, `cooldownUntil`, `filling = false`.

### 5.4 End-of-list handling

When the last question of a list finishes:

1. Detect list-done UI (e.g. EP's "List complete — score: X%" screen).
2. If `hunter.autoContinueLists` is on, click the **Next list / Start next**
   button (the script already knows how to click `#start-button-main-label`).
3. Else surface a toast: `🏁 List done — Hunter stopped`.
4. Persist progress to `localStorage.ep.progress[listId]` so a refresh can
   resume or skip already-completed lists.

### 5.5 Configuration additions

Insert into the existing `CFG` block:

```js
hunter: {
  enabled              : false,   // master toggle
  advanceDelay         : 600,     // ms after verdict before clicking Next
  maxQuestionsPerRun   : 0,       // 0 = unlimited
  autoContinueLists    : false,   // walk straight into the next list
  betweenListDelay     : 1500,    // ms pause between lists
  errorPolicy          : 'dismiss', // 'dismiss' | 'learn' | 'hybrid'
  humanPresenceWindow  : 1500,    // ms of user typing that suspends Hunter
  killOnUrlChange      : true,    // stop Hunter if user navigates manually
}
```

A new `Hunter` button is added next to `Pause` in `#ep-panel`. It lights up
green when on, red when paused.

---

## 6. Error Handling — Two Policies

Error handling is the second pillar of Hunter Mode. A wrong answer is currently
a hard stop: the script types something, EP grades it wrong, and the user has
to dismiss the overlay and move on. Hunter Mode formalises what the script
does *instead*.

### 6.1 Policy A — **Dismiss & Continue** (`errorPolicy: 'dismiss'`)

Goal: never get stuck on a wrong answer.

1. The **AWAIT_VERDICT** state notices a wrong-answer overlay (column 1 of the
   table above).
2. Capture the question word that was just answered (for logging).
3. Wait `errorDismissDelay` ms (default 250 ms) for EP to finish animating.
4. Locate and click the "Continue" / "Try again" / "Next" button on the overlay.
   Selector priority:
   * `[data-action="continue"]`
   * `button.continue, button.try-again, button.next`
   * Generic: any visible button whose text matches
     `/continue|try again|next|got it|ok/i`.
5. If multiple candidates exist, prefer the one closest to the overlay's root
   element.
6. If no overlay exists, do nothing — the Question Detector will simply not
   find the old word anymore and the Advance transition handles it.

This is the safe default: nothing is learned, nothing is overwritten, Hunter
just keeps moving.

### 6.2 Policy B — **Learn from Error** (`errorPolicy: 'learn'`) 🌟 preferred

Goal: every wrong answer makes the script permanently smarter.

1. Same detection as 6.1.
2. **Read the correct answer out of the overlay.** EP usually reveals it on a
   wrong-answer screen (e.g. *"Correct answer: hola"*). Match by:
   * `[data-correct-answer]` attribute, when present.
   * Text inside `.correct-answer`, `.answer-reveal`, `#solution`,
     `[class*="solution"]`.
   * Fallback: any element inside the overlay whose label says
     "Correct answer:".
3. **Update** `answerMap` for the current question word:
   ```js
   answerMap[norm(questionWord)] = stripAlts(correctAnswer);
   ```
   Also add the inverse if the dataset is bidirectional.
4. **Persist** the new pair to `localStorage.ep.learned` so reloads keep it.
   Use a small ring buffer (e.g. last 500 pairs) to avoid runaway growth.
5. Click the **Continue** button (same logic as 6.1 step 4).
6. Hunter Mode then re-types the *new* answer on the retry question (now that
   the same word is in `answerMap`) — naturally producing a correct retry.

This is the "even better" option the user asked for: the script improves
itself in real time.

### 6.3 Hybrid (`errorPolicy: 'hybrid'`)

If the overlay reveals a parseable correct answer → do **Policy B**. If it
doesn't (e.g. small free-text input where EP just animates a red flash without
text), fall back to **Policy A**. Recommended default.

### 6.4 Conflict prevention

Both policies must respect:

* `humanPresenceWindow` — never click through an overlay if a human is typing
  inside it.
* `filling` flag — never overwrite a half-typed answer.
* Cooldown — after a wrong answer, lengthen `typeCooldown` for that word by
  ~250 ms so Hunter doesn't fire twice.

---

## 7. Other Autonomous-Thinking Additions

Small features in the same spirit as Hunter Mode, all of which can land
together:

### 7.1 Human-presence detector
Watch for `keydown`, `click`, `input` events originating from a real user in
the answer field. When one fires, Hunter Mode drops back to **Monitor Only**:
it still detects questions and *would* answer, but holds back and surfaces a
subtle badge: `👤 Human typing — Hunter idle`. Auto-resumes after
`hunter.humanPresenceWindow` ms of silence.

### 7.2 Smart list navigation
Reuse the existing `fullList()` flow but in reverse: detect the "List complete"
screen, then `#slim-scroll-content .preview-grid` and pick the row immediately
after the one we just finished. Open it, click its start button, repeat.

### 7.3 Adaptive fuzzy threshold
Track `similarity()` score distribution per session. If many questions are
landing near the `fuzzyThreshold` boundary, raise the threshold a tick. If
questions are consistently missing by a hair, lower it. Self-tuning, but
clamped to a `[0.4, 0.9]` band so it can't drift to nonsense.

### 7.4 Adaptive typing speed
If EP grades more than ~90 % of the script's answers correct, gradually drop
`typeDelay` toward 0. If grades start failing, raise it. Keeps the script as
fast as the current Exercise/teacher allows.

### 7.5 Progress badge & ETA
Add a tiny line to the floating panel: `⚡ 37/120 · ~1m 12s left`. Computed
from a rolling average of time-per-question. Disappears when Hunter is off.

### 7.6 Self-healing answers
The script already runs `stripAlts()` at load and at fill time. Extend this to:

* Detect when an answer key has a `;` separator and split into alternates,
  storing **all** alternates in `answerMap` keyed off the same question.
* Strip EP's occasional " (← hint)" / "with accent" trailers when reading the
  pair grid.

### 7.7 Idle / between-list sleep
After a list completes, emit a single calming toast `💤 Sleeping 1.5s before
next list…` so the user understands the pause. Configurable
`betweenListDelay`.

### 7.8 Telemetry dump (opt-in)
When a debug flag `hunter.telemetry` is on, write a daily JSON of:

* questions attempted
* right / wrong counts per list
* new pairs learned
* avg time per question

Stored in `localStorage.ep.telemetry` and downloadable via a new tiny
`Export` button. Zero external network used.

### 7.9 Per-word confidence
Tag each entry in `answerMap` with a confidence score:

* `1.0` from official pair grid at load.
* `+1` every time the script gets it right.
* `0.5` from `learn` policy (uncertain until verified).
* Decay slowly over time so stale "learned" pairs can be re-verified.

When matching, prefer high-confidence keys over fuzzy lookups.

### 7.10 Visible kill-switch
Big red `🛑 STOP` button in the panel that clears `hunter.enabled`, cancels
all timers, and (importantly) leaves the script in its current mode rather
than fully tearing down. One click = Hunter off, original assistant still on.

---

## 8. Suggested Implementation Order

1. **Question state machine refactor** (`IDLE → DETECTED → TYPING →
   AWAIT_VERDICT → ADVANCE`). Non-breaking; everything else still works.
2. **Verdict detection** (table from §5.2) — purely passive, no clicks.
3. **Advance transition** — first end-to-end "no user input needed" demo for
   *one* question.
4. **Dismiss policy** (Policy A) — minimal risk, shippable.
5. **Learn policy** (Policy B) — the headline feature.
6. **End-of-list + auto-continue lists.**
7. **Human-presence detector + kill-switch.** (Required safety before opening
   it up to long sessions.)
8. **Progress badge + adaptive typing speed.**
9. **Per-word confidence + self-healing alternates.**
10. **Telemetry opt-in + slow fuzz adaptation.**

Steps 1–4 land in a single PR on `full` first, then get promoted to `main`
once they survive a couple of full lists on a real EP account.

---

## 9. Open Risks

* **EP DOM churn.** Every selector above is best-effort. Need fallbacks and a
  way for users to file selector reports from a `Report broken selector`
  button in the panel.
* **Page re-renders wiping Hunter state.** Re-attach Hunter from the existing
  `updatePanelVisibility()` interval and not from `init()` only.
* **Learning wrong answers.** If Policy B misreads the overlay (e.g. tips
  vs. correct answer), the script will keep filling the wrong word. Need a
  sanity check: the new answer must also pass `similarity()` against the
  *next* time the same question appears, and learned entries are dropped
  after N consecutive regressions.
* **Teacher visibility.** Hunter Mode on a normal school account will trivially
  produce perfect scores. That's the user's call (existing disclaimer still
  applies); not a code problem, just worth documenting in the README before
  public-facing deploy.

---

## 10. Status

| Item | State |
|---|---|
| Question state machine | **Done** (v1) |
| Verdict detection | **Done** (v1) |
| Advance transition | **Done** (v1) |
| Dismiss policy (A) | **Done** (v1) |
| Learn policy (B) | **Done** (v2) |
| End-of-list autopilot | **Done** (v2) |
| Human-presence detector | **Done** (v3) |
| Progress badge | **Done** (v2 — debug line shows score + timer) |
| Per-word confidence | **Done** (v3) |
| Telemetry opt-in | **Done** (v3) |
| Adaptive fuzzy threshold | **Done** (v3) |
| Adaptive typing speed | **Done** (v3) |
| Self-healing answers | **Done** (v3 — semicolon alts, smartStrip) |

This file lives in `Implement/` so it can be referenced from the README without
polluting the script root. Update status here as PRs land.
