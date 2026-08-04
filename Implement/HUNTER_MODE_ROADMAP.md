# Hunter Mode — Roadmap

> A planned addition to **EP Answer Assistant** (`script.js`, v4.0.x) that turns the
> userscript into an autonomous, self-driving runner that moves from one question
> to the next without user intervention, recovers from wrong answers, and keeps
> learning from its own mistakes.

---

## Current Shipped State (as of `script.js` on `main`)

**v1 + v2 + Phase 3 robustness** are all landed; the v3 exploratory spike
(adaptive threshold, adaptive typing speed, confidence scoring, telemetry
Export button, self-healing alternates) was rolled back. The script currently
ships **only defensibility — no new user-visible features** — so what is in
`CFG.hunter` matches what is wired into the Hunter tick.

### Behaviour shipped

1. **Auto-advance** — when the current question is graded correct or wrong,
   click `#continue-button` (the EP "Next question" button) and move to the
   next question without user input.
2. **Dismiss & Continue** (`errorPolicy: 'dismiss'`) — when a wrong-answer
   overlay appears, click the dismiss / try-again / continue button on it. The
   script is never stuck.
3. **Skip list** — a new "Skip list" button on `#ep-panel` jumps straight to the
   next task in the sidebar of the list-starter page.
4. **Learn & Hybrid policies** (`errorPolicy: 'learn' | 'hybrid'`, default
   `'hybrid'`) — when EP reveals the correct answer in a wrong overlay, the
   script scrapes it via `#correct-answer-field` / `.modeless-answer-dialog
   tr.correct`, persists it to `localStorage.ep.learned`, and re-types it on
   the retry.
5. **End-of-list detection + auto-continue** (`autoContinueLists: false` by
   default) — the script detects the list-complete screen and either walks
   into the next available list or stops cleanly.
6. **Human-presence detector** (`humanPresenceWindow: 1500` ms) — Hunter
   pauses itself while a human is typing in the answer field.
7. **Visible kill-switch STOP button** (`#ep-stop`) — dark-red button clears
   every pending timer AND every event listener.

### Defensive infrastructure shipped (Phase 3 — not a feature, a hardener)

* **Universal DOM helpers** (`isVisible`, `isEnabled`, `queryVisible`,
  `queryAllVisible`, `safeClick`, `clampMs`, `waitFor`, `isModalShown`) —
  every element interaction goes through these before any click fires.
* **Stuck-state watchdog** — if Hunter lingers in any state for more than
  `CFG.hunter.stuckStateMs` (30 s default), force-reset to `IDLE`.
* **Global inactivity watchdog** — if Hunter produces no state change for
  `CFG.hunter.watchdogMs` (120 s default), force-reset (`🛟 Hunter reset`
  toast).
* **Tick try/catch** — a thrown bug in any helper resets to IDLE and never
  kills the loop.
* **`hunterDefer()`** — every `setTimeout` inside the Hunter life-cycle is
  tracked in `hunterDelayedTimers` and clocked by `clampMs()` so a
  misconfigured CFG cannot fire clicks during EP's animation frames.
* **Hard cap on failed advance clicks** (`CFG.hunter.maxAdvanceAttempts: 5`)
  — if `#continue-button` cannot be located 5 times in a row, Hunter stops
  with a clear toast instead of looping forever.
* **Safe ring-buffer for learned pairs** — paraphrased/punctoated scrapes
  are stripped, length-capped at 200 chars, and dropped instead of poisoned.
* **Defensive localStorage load** — a malformed `ep.learned` blob no longer
  crashes Hunter; bad entries are skipped.

### What is still planned (NOT shipped)

* Adaptive fuzzy threshold (7.3)
* Adaptive typing speed (7.4)
* Per-word confidence scoring (7.9)
* Telemetry opt-in + Export button (7.8)
* Self-healing alternates (7.6)
* Daily list-id progress persistence (post §5.4)

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
   same session (configurable). *(planned, not shipped)*
3. **Survive wrong answers** — either dismiss the error and continue, *or*
   learn the correct answer from the feedback the moment EP reveals it.
   *(dismiss shipped; learn planned)*
4. **Stay out of the user's way** — if a human starts typing, hand control back
   instantly. *(planned)*
5. **Be safe to leave running** — bounded iterators, kill-switches, and visible
   state at all times.

---

## 3. Non-Goals (out of scope)

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

Hunter Mode (v1) sits ON TOP of this pipeline as a small state machine that
manages *question lifecycle* rather than answer typing:

               ┌─── start-button-main click (idle on list-starter)
Hunter.tick ───┤
  (500 ms)     └─── start-button-school click (idle on activity-starter)
                  │
                  ▼
        IDLE → DETECTED → AWAIT_VERDICT → ADVANCE → IDLE
                                  │
                  ┌─── dismissWrongAnswer()  (errorPolicy = 'dismiss')
                  └─── clickAdvanceButton()   (#continue-button)
```

---

## 5. Hunter Mode — Core Design (v1 shipped)

### 5.1 Question state machine (v1)

A single finite-state object per question replaces the loose flags (`filling`,
`lastFilled`, `cooldownUntil`, `pageChanging`):

```
IDLE  ─► DETECTED (question-word seen via #question-text)
        │
        ▼
   AWAIT_VERDICT (waiting for EP to mark right/wrong)
        │      ▲
   advance click│      │ wrong-answer overlay handled by Policy A
        ▼      │
     ADVANCE  ─┘
        │
   back to IDLE
```

The full pipeline (TYPING) stays inside the existing `tryFill()` —
Hunter just waits for `filling = false` before polling for a verdict.

### 5.2 "Question finished" detection (v1)

Hunter Mode needs to know **the moment a question is over**. Any of the below
counts as a verdict signal (highest priority first):

| Signal | DOM selector (verified in `Implement/*.html`) | Verdict |
|---|---|---|
| Result overlay — incorrect row | `.modeless-answer-dialog tr.incorrect` | `incorrect` |
| Result overlay — correct row | `.modeless-answer-dialog tr.correct` | `correct` |
| Try-again button visible | `.action-bar-button.try-again` (with `button:not([disabled])`) | `incorrect` |
| Cheer-button visible | `.cheer-button:not(.ng-hide):not(.sf-hidden)` | `correct` |
| Paper-mode next button | `.next-question-button:not([disabled])` | `correct` |
| SA navigation / info button | `#sa-navigation-controls button`, `.information-controls button` | `correct` |

The first one wins. Each signal fires the **Advance** transition.

### 5.3 Advance transition (v1)

`clickAdvanceButton()` tries a priority list of selectors, starting with
`#continue-button:not([disabled])` — the canonical "Next question" button
in the EP game-page DOM (`<button class="nice-button ng-binding"
id="continue-button … > Next question </button>`, verified in
`(5) EP (8_4_2026 3：48：24 PM).html`). After clicking, Hunter waits
`CFG.hunter.advanceDelay` ms (default `600`) before resetting
`lastFilled`, `cooldownUntil`, `filling = false` and returning to `IDLE`.

### 5.4 End-of-list handling (planned)

*(Not in v1.)* When the last question of a list finishes:

1. Detect list-done UI (e.g. EP's "List complete — score: X%" screen).
2. If `hunter.autoContinueLists` is on, click the **Next list / Start next**
   button (the script already knows how to click `#start-button-main-label`).
3. Else surface a toast: `🏁 List done — Hunter stopped`.
4. Persist progress to `localStorage.ep.progress[listId]` so a refresh can
   resume or skip already-completed lists.

### 5.5 Configuration (v1 — actual values in `script.js`)

```js
hunter: {
  enabled      : false,        // master toggle (state at install)
  advanceDelay : 600,          // ms after verdict before clicking Next
  errorPolicy  : 'dismiss',    // v1: dismiss-only. Learn / hybrid are planned.
  autoStart    : true,         // tick.idle clicks #start-button-main / #start-button-school
}
```

A new **Hunter** button (`#ep-hunter`) is added below the existing row in
`#ep-panel`. It lights up green (`#1b6d2a`) when on. A new **Skip list**
button (`#ep-skip`, amber `#6d3f1b`) sits next to it.

---

## 6. Error Handling

### 6.1 Policy A — **Dismiss & Continue** (`errorPolicy: 'dismiss'`) — v1 ✅

Goal: never get stuck on a wrong answer.

1. The **AWAIT_VERDICT** state notices a wrong-answer overlay (column 1 of the
   table in §5.2).
2. Capture the question word that was just answered (for scoring).
3. Wait `CFG.hunter.advanceDelay` ms for EP to finish animating.
4. Locate and click the dismiss button. Selector priority (from the real EP
   DOM in `Implement/*.html`):
   * `#continue-button:not([disabled])`
   * `.modeless-answer-dialog #continue-button:not([disabled])`
   * `.action-bar-button.try-again button:not([disabled])`
   * `.feedback-button:not([disabled])`
   * `#sa-navigation-controls button:not([disabled])`
   * generic `.game-action-bar .action-bar-button button:not([disabled])`
   * text fallback: `/try again|continue|next|next question|ok|got it|retry/i`
5. If no overlay exists, do nothing — the Question Detector will simply not
   find the old word anymore and the Advance transition handles it.

This is the safe default: nothing is learned, nothing is overwritten, Hunter
just keeps moving.

### 6.2 Policy B — **Learn from Error** (`errorPolicy: 'learn'`) — planned 🌟

Goal: every wrong answer makes the script permanently smarter.

1. Same detection as 6.1.
2. **Read the correct answer out of the overlay.** EP usually reveals it on a
   wrong-answer screen (e.g. *"Correct answer: hola"*). Match by:
   * `[data-correct-answer]` attribute, when present.
   * `#correct-answer-field` (verified in `(5) EP (8_4_2026 3：48：24 PM).html`).
   * Text inside `.correct-answer`, `.answer-reveal`, `#solution`,
     `[class*="solution"]`.
   * Fallback: any element inside the overlay whose label says
     "Correct answer:".
3. **Update** `answerMap` for the current question word:
   ```js
   answerMap[norm(questionWord)] = stripAlts(correctAnswer);
   ```
4. **Persist** the new pair to `localStorage.ep.learned` so reloads keep it
   (ring buffer, last 500 pairs).
5. Click the **Continue** button (same logic as 6.1 step 4).
6. Hunter Mode then re-types the *new* answer on the retry question.

### 6.3 Hybrid (`errorPolicy: 'hybrid'`) — planned

If the overlay reveals a parseable correct answer → do **Policy B**. If it
doesn't (e.g. EP animates a red flash without text), fall back to **Policy A**.
Recommended once B is implemented.

### 6.4 Conflict prevention (planned for B/C)

* `humanPresenceWindow` — never click through an overlay while a human is
  typing inside it.
* `filling` flag — never overwrite a half-typed answer.
* Cooldown — after a wrong answer, lengthen `typeCooldown` for that word by
  ~250 ms.

---

## 7. Other Autonomous-Thinking Additions (all planned, none shipped)

### 7.1 Human-presence detector
Watch for `keydown`, `click`, `input` events from a real user on the answer
field. Hunter Mode drops back to **Monitor Only** and surfaces
`👤 Human typing — Hunter idle`. Auto-resumes after
`hunter.humanPresenceWindow` ms of silence.

### 7.2 Smart list navigation
Detect the "List complete" screen, then `#slim-scroll-content .preview-grid`
and pick the row immediately after the one we just finished. Open it, click
its start button, repeat.

### 7.3 Adaptive fuzzy threshold
Track `similarity()` score distribution per session. If many questions land
near `fuzzyThreshold` boundary → raise it. If they consistently miss by a
hair → lower it. Self-tuning, clamped to `[0.4, 0.9]`.

### 7.4 Adaptive typing speed
If EP grades > 90 % correct, gradually drop `typeDelay` toward 0. If grades
start failing, raise it.

### 7.5 Progress badge & ETA
Tiny line in the floating panel: `⚡ 37/120 · ~1m 12s left`. Currently the
debug line shows `🕵️ N✓ N✗ · Xm Ys · "word"`.

### 7.6 Self-healing answers
Extend `stripAlts()` to: detect `;` separators and split into alternates;
strip EP's occasional " (← hint)" / "with accent" trailers.

### 7.7 Idle / between-list sleep
After a list completes, emit `💤 Sleeping 1.5s before next list…` so the user
understands the pause. Configurable `betweenListDelay`.

### 7.8 Telemetry dump (opt-in)
Daily JSON of right / wrong counts, learned pairs, avg time per question.
Stored in `localStorage.ep.telemetry`. New tiny `Export` button to download.

### 7.9 Per-word confidence
Tag each `answerMap` entry with `1.0` (grid) / `0.5` (learned) / `+0.2` per
verified correct / decay over time. Prefer high-confidence keys over fuzzy
lookups.

### 7.10 Visible kill-switch
Big red `🛑 STOP` button in the panel that clears `hunter.enabled`, cancels
all timers, and leaves the rest of the script intact.

---

## 8. Suggested Implementation Order

Status legend: ✅ shipped in v1 · 🟡 planned · ❌ deferred / out of scope.

| # | Step | Status |
|---|---|---|
| 1 | Question state machine (`IDLE → DETECTED → AWAIT_VERDICT → ADVANCE`) | ✅ v1 |
| 2 | Verdict detection (table in §5.2) | ✅ v1 |
| 3 | Advance transition (`#continue-button` + fallbacks) | ✅ v1 |
| 4 | Dismiss policy (Policy A) | ✅ v1 |
| 5 | Skip-list button on panel (`#stats-parent .starter-panel .grouped-options > li.item`) | ✅ v1 (+ extras) |
| 6 | Learn policy (Policy B) — `errorPolicy: 'learn'` | 🟡 |
| 7 | End-of-list + auto-continue lists | 🟡 |
| 8 | Human-presence detector + kill-switch | 🟡 |
| 9 | Progress badge + adaptive typing speed | 🟡 |
| 10 | Per-word confidence + self-healing alternates | 🟡 |
| 11 | Telemetry opt-in + slow fuzz adaptation | 🟡 |

Steps 1–5 land as a single working slice ("Hunter Mode v1") on `main`. They
are safe — Policy A never touches `answerMap`, never persists anything to
`localStorage`, and the Hunter toggle is opt-in. Steps 6+ should each be
their own PR with a clear toggle (`CFG.hunter.errorPolicy = 'learn'|'hybrid'|
'adaptive'|...`) so v1 users can keep `errorPolicy: 'dismiss'` until they're
ready.

---

## 9. Open Risks

* **EP DOM churn.** Every selector above is best-effort. Need fallbacks and a
  way for users to file selector reports from a `Report broken selector`
  button in the panel. The 8 HTML snapshots in `Implement/` (3 from Aug 4,
  5 from Aug 5) reinforce the selector reference; check there first when
  investigating a regression.
* **Page re-renders wiping Hunter state.** Re-attach Hunter from the existing
  `updatePanelVisibility()` interval and not from `init()` only.
* **Learning wrong answers.** *(only relevant if Policy B is enabled.)* If
  `learnFromError` misreads the overlay (e.g. tips vs. correct answer), the
  script will keep filling the wrong word. Need a sanity check: the new
  answer must also pass `similarity()` against the *next* time the same word
  appears, and learned entries are dropped after N consecutive regressions.
* **Teacher visibility.** Hunter Mode on a normal school account will trivially
  produce perfect scores. That's the user's call (existing disclaimer in
  `README.md` still applies).

---

## 10. Status

Status legend: ✅ shipped on `main` · 🟡 Planned — not in current release

| Item | State | In `script.js`? |
|---|---|---|
| Question state machine (IDLE → DETECTED → TYPING → AWAIT_VERDICT → ADVANCE → LIST_DONE) | **Done** (Phase 2) | ✅ yes |
| Verdict detection | **Done** (Phase 1 + 2 hardening) | ✅ yes |
| Advance transition (`#continue-button` first, ng-disabled-aware) | **Done** (Phase 2) | ✅ yes |
| Dismiss policy (A) | **Done** (Phase 1) | ✅ yes — `errorPolicy: 'dismiss'` is a valid choice |
| Learn policy (B) | **Done** (Phase 2) | ✅ yes — `errorPolicy: 'learn'`; reads `#correct-answer-field`, persists to `localStorage.ep.learned` with ring buffer |
| Hybrid policy | **Done** (Phase 2) | ✅ yes — `errorPolicy: 'hybrid'` (default); tries learn, falls back to dismiss |
| End-of-list detection | **Done** (Phase 2) | ✅ yes — `detectListDone()` |
| End-of-list auto-continue | **Done** (Phase 2) | ✅ yes — `autoNextList()` driven by `CFG.hunter.autoContinueLists` |
| Human-presence detector | **Done** (Phase 2) | ✅ yes — `onHumanInteraction()` listener, `CFG.hunter.humanPresenceWindow` ms pause |
| Visible kill-switch STOP button | **Done** (Phase 2) | ✅ yes — `#ep-stop` button on the panel, dark red |
| Skip-list button | **Done** (Phase 1) | ✅ yes — `#ep-skip` button |
| IDLE auto-start on starter screens | **Done** (Phase 1) | ✅ yes — clicks `#start-button-main` / `#start-button-school` |
| Progress badge (debug line only) | **Partial** — debug shows `🕵️ N✓ N✗ · Xm Ys · STATE · "word"`; no ETA yet | ✅ partial |

### Phase 3 (robustness hardening — defensibility only, no new user behaviour)

| Item | State | In `script.js`? |
|---|---|---|
| Universal DOM helpers (`isVisible`, `isEnabled`, `safeClick`, `queryVisible`, `queryAllVisible`, `clampMs`, `waitFor`, `isModalShown`) | **Done** (Phase 3) | ✅ yes |
| Stuck-state watchdog (`stuckStateMs: 30000`) | **Done** (Phase 3) | ✅ yes — `hunterWatchdog()` |
| Global inactivity watchdog (`watchdogMs: 120000`) | **Done** (Phase 3) | ✅ yes — `hunterWatchdog()` |
| Tick try/catch (any thrown bug resets state) | **Done** (Phase 3) | ✅ yes |
| `hunterDefer()` tracking + `clampMs()` on every setTimeout | **Done** (Phase 3) | ✅ yes |
| Hard cap on failed advance clicks (`maxAdvanceAttempts: 5`) | **Done** (Phase 3) | ✅ yes |
| Defensive localStorage parser (drops malformed entries) | **Done** (Phase 3) | ✅ yes — `loadLearnedAnswers()` |
| `scrapeCorrectAnswer` hygiene (strips `Correct answer:`, hint trailers, length cap, prefix/suffix noise) | **Done** (Phase 3) | ✅ yes — `cleanScrapedAnswer()` |
| URL-change observer (resets Hunter to IDLE on SPA nav away) | **Done** (Phase 3) | ✅ yes — top of `hunterTick()` |
| `skipToNextTask` fallback chain (`<li title>`, `<li.item>`, breadcrumb, multiple back-button selectors) | **Done** (Phase 3) | ✅ yes |
| `addHumanListeners` / `removeHumanListeners` symmetric pair | **Done** (Phase 3) | ✅ yes — used by start/stop/STOP |
| `clearHunterDelayedTimers` cleanup helper | **Done** (Phase 3) | ✅ yes |

### Phase 3 (robustness hardening — defensibility only, no new user behaviour)

| Item | State | In `script.js`? |
|---|---|---|
| Universal DOM helpers (`isVisible`, `isEnabled`, `safeClick`, `queryVisible`, `queryAllVisible`, `clampMs`, `waitFor`, `isModalShown`) | **Done** (Phase 3) | ✅ yes |
| Stuck-state watchdog (`stuckStateMs: 30000`) | **Done** (Phase 3) | ✅ yes — `hunterWatchdog()` |
| Global inactivity watchdog (`watchdogMs: 120000`) | **Done** (Phase 3) | ✅ yes — `hunterWatchdog()` |
| Tick try/catch (any thrown bug resets state) | **Done** (Phase 3) | ✅ yes |
| `hunterDefer()` tracking + `clampMs()` on every setTimeout | **Done** (Phase 3) | ✅ yes |
| Hard cap on failed advance clicks (`maxAdvanceAttempts: 5`) | **Done** (Phase 3) | ✅ yes |
| Defensive localStorage parser (drops malformed entries) | **Done** (Phase 3) | ✅ yes — `loadLearnedAnswers()` |
| `scrapeCorrectAnswer` hygiene (strips `Correct answer:`, hint trailers, length cap, prefix/suffix noise) | **Done** (Phase 3 → Phase 4 enhanced) | ✅ yes — `cleanScrapedAnswer()` |
| URL-change observer (resets Hunter to IDLE on SPA nav away) | **Done** (Phase 3) | ✅ yes — top of `hunterTick()` |
| `skipToNextTask` fallback chain (`<li title>`, `<li.item>`, breadcrumb, multiple back-button selectors) | **Done** (Phase 3) | ✅ yes |
| `addHumanListeners` / `removeHumanListeners` symmetric pair | **Done** (Phase 3) | ✅ yes — used by start/stop/STOP |
| `clearHunterDelayedTimers` cleanup helper | **Done** (Phase 3) | ✅ yes |

### Phase 4 (usability + Learn-path hardening — landed on `main`)

| Item | State | In `script.js`? |
|---|---|---|
| **Highest-priority Learn path: green-span reconstruction from `#users-answer-field`** (EP colors correct portions green `#0a0`) | **Done** (Phase 4) | ✅ yes — `scrapeCorrectAnswer` priority 2 |
| **Highest-priority Continue path: click `#continue-button` ("Next question") FIRST after Learn** | **Done** (Phase 4) | ✅ yes — `clickContinueButton()` |
| Modal-footer Continue fallback chain (`.modal-footer #continue-button`, `.modal-footer button.nice-button`) | **Done** (Phase 4) | ✅ yes — `clickContinueButton()` |
| Learn toast: `🧠 Learned "...word..." · Next...` | **Done** (Phase 4) | ✅ yes |
| Wrong toast (non-dismiss policy, fallback): `❌ Wrong · continuing...` | **Done** (Phase 4) | ✅ yes |
| Human-presence detector (already in Phase 2; Phase 3 widened event types) | **Done** (Phase 2 / 3) | ✅ yes |
| Stop button as one-shot kill-switch | **Done** (Phase 3) | ✅ yes — `#ep-stop` |
| Smoother list navigation (dual selector chain + already-completed guard) | **Done** (Phase 3) | ✅ yes — `autoNextList` / `skipToNextTask` |
| Smoother back-button chain on activity-starter / game pages | **Done** (Phase 3) | ✅ yes |
| Progress badge + ETA (live rolling-avg format `⚡ N answered · ~Xs/q`) | **Partial** — `recordQuestionDuration` + `updateProgressBadge` + `fmtDuration` helpers added; UI element wiring pending (tool-cache issue prevented completing the `<div id="ep-badge">` insert in this turn). | 🟡 partial |
| Between-list sleep toast (`💤 Sleeping Xs before next list…`) | **Partial** — `autoContinueLists` already awaits `betweenListDelay`; informational toast pending | 🟡 partial |

### Phase 5+ (planned, NOT shipped)

| Item | State |
|---|---|
| Per-word confidence scoring (7.9) | 🟡 |
| Adaptive fuzzy threshold (7.3) | 🟡 |
| Adaptive typing speed (7.4) | 🟡 |
| Self-healing alternates (7.6) | 🟡 |
| Telemetry opt-in + Export button (7.8) | 🟡 |
| Daily list-id progress persistence | 🟡 |
| Detect in-game navigate to next-list | 🟡 |
| Per-word confidence | Planned | 🟡 |
| Adaptive fuzzy threshold | Planned | 🟡 |
| Adaptive typing speed | Planned | 🟡 |
| Self-healing alternates / smartStrip | Planned | 🟡 |
| Telemetry opt-in + Export button | Planned | 🟡 |
| Daily list-id progress persistence | Planned | 🟡 |
| Detect in-game navigate to next-list | Planned | 🟡 |

> Update this table when a new feature lands.

---

## Appendix — Selector Reference (v1 selectors actually used)

All selectors below are derived from EP HTML snapshots in `Implement/`.
`$(...)` shorthand assumes `document.querySelector(...)`.

### Verdict detection (hunter.js)
```
.modeless-answer-dialog tr.incorrect   → 'incorrect'
.modeless-answer-dialog tr.correct     → 'correct'
.action-bar-button.try-again button     → 'incorrect'
.cheer-button:not(.ng-hide):not(.sf-hidden) → 'correct'
.next-question-button:not([disabled])   → 'correct'
#sa-navigation-controls button:not([disabled]) / .information-controls button → 'correct'
```

### Advance click
```
$(#continue-button:not([disabled]))     ← primary (verified in game-page HTML)
$(.next-question-button:not([disabled]))
$(#correct-button:not([disabled]))
$(.information-controls button:not([disabled]))
$(#sa-navigation-controls button:not([disabled]))
$(.nav-bar-exit:not([disabled]))
$(.game-action-bar button:not([disabled]))
$(.cheer-button:not(.ng-hide):not(.sf-hidden))
```

### Dismiss click
```
$(#continue-button:not([disabled]))
$(.action-bar-button.try-again button:not([disabled]))
$(.feedback-button:not([disabled]))
$(#sa-navigation-controls button:not([disabled]))
$(.game-action-bar .action-bar-button button:not([disabled]))
```

### Skip list
On `list-starter`:
```
$all(#stats-parent .starter-panel .grouped-options > li.item)
   .classList.contains('selected') | 'active'   ← current task
   click the *next* item
fallback: $('.breadcrumbs .crumb, .crumb-child')
```
On `game` or `activity-starter`:
```
$('#sa-navigation-controls .back-button, .back-button, [data-action="back"]')
   OR an `<a href="...list-starter...">` link.
```

### Idle auto-start
```
on list-starter     → $(#start-button-main)
on activity-starter → $(#start-button-school)
```

---

This file lives in `Implement/` so it can be referenced from the README without
polluting the script root. Update status here as PRs land.
