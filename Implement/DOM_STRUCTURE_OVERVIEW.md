# DOM Structure Overview — Education Perfect

> Extracted from the eight HTML snapshots in `Implement/` (captured August 4–5,
> 2026). These are **full-page SingleFile** exports of the real EP website, so
> every element is real — no mocking, no guessing.
>
> **Files (newest last):**
> - `Implement/EP (8_4_2026 3：48：05 PM).html` — Wrong-answer / list-starter view
> - `Implement/(5) EP (8_4_2026 3：48：24 PM).html` — In-game activity / pre-task screen
> - `Implement/(5) EP (8_4_2026 3：53：53 PM).html` — Course browser (Tailwind/React)
> - `Implement/EP (8_5_2026 8：53：36 AM).html` — Pure Tailwind/React shell (no quiz mounted)
> - `Implement/EP (8_5_2026 8：54：05 AM).html` — Pure Tailwind/React shell
> - `Implement/EP (8_5_2026 8：54：21 AM).html` — Pure Tailwind/React shell
> - `Implement/EP (8_5_2026 8：54：41 AM).html` — **Modern hybrid list-starter** (Tailwind shell + Angular slot)
> - `Implement/(5) EP (8_5_2026 8：55：00 AM).html` — In-game activity (pre-answer state)

---

## Table of Contents

1. [Page Routes & AngularJS Patterns](#1-page-routes--angularjs-patterns)
2. [General Layout — AngularJS vs Tailwind/React](#2-general-layout--angularjs-vs-tailwindreact)
3. [File 1 / Hybrid list-starter — primary DOM reference](#3-file-1--hybrid-list-starter--primary-dom-reference)
4. [File 2 / In-game activity — primary DOM reference](#4-file-2--in-game-activity--primary-dom-reference)
5. [Tailwind/React shell (Files 3, 5–7)](#5-tailwindreact-shell-files-3-5-7)
6. [Key Selectors for Scripting (Hunter Mode v1)](#6-key-selectors-for-scripting-hunter-mode-v1)
7. [AngularJS Scopes & Controllers](#7-angularjs-scopes--controllers)
8. [Navigation Flow](#8-navigation-flow)
9. [Appendix: Full Class & ID Reference](#9-appendix-full-class--id-reference)

---

## 1. Page Routes & AngularJS Patterns

EP is an **AngularJS 1.x** single-page application wrapped in a **micro-frontend
shell** (`single-spa`). Currently two coexisting UIs are in the wild:

| Era | Module | Where |
|---|---|---|
| Legacy | AngularJS components (`starter.*`, `self.*`) | The vocab list + game flow |
| Modern | React micro-frontend (`mfeLearnerExperience`) wrapping Tailwind UI | The course browser / breadcrumb |
| Hybrid | React shell **+** AngularJS slot mounted inside | The modern list-starter (file 7) |

Key routes:

| Route pattern | Description | Reference file |
|---|---|---|
| `/app/{subject}/{id}/{listId}/list-starter` | Vocabulary list — pairs grid, modes, start button | File 1, File 7 |
| `/app/{subject}/{id}/{listId}/game?mode=1` | Active game — question, answer input, action bar | File 2, File 8 |
| `/app/{subject}/{id}/{listId}/activity-starter` | Activity pre-task screen | (verifiable via `#start-button-school`) |
| `/app/{subject}/{id}/{listId}/browse` | Course/lesson browser | File 3 |
| `/app/{subject}/{id}/{listId}/...` no Angular slot | Tailwind/React shell, no quiz | Files 4–6 |

**AngularJS conventions visible:**
- `ng-scope` — every AngularJS component
- `ng-isolate-scope` — directive/component with isolated scope
- `ng-repeat`, `ng-if`, `ng-show`, `ng-hide`, `ng-class`, `ng-click`,
  `ng-disabled`, `ng-model`, `ng-bind`
- `ng-hide` / `sf-hidden` — both used for hiding elements (Angular's
  `ng-hide` + SingleFile's `sf-hidden`)
- `ng-class="{correct: …, incorrect: …, current: …}"` — common pattern for
  question items
- `starter.*` — controller alias for list-starter pages
- `self.*` / `game.*` — controller aliases for game pages
- `model=game.model` — passing game model into child directives

---

## 2. General Layout — AngularJS vs Tailwind/React

The reactivity of `script.js`'s selector lists matters here: when no Angular
slot is mounted (files 4–6), many of the selectors below will resolve to
nothing — that's normal, not a bug.

| File | Has `#list-starter`? | Has `#game-page`? | Era |
|---|---|---|---|
| 1 (`EP 8_4 3:48:05`) | ✅ (visible) | (modal embedded) | Legacy AngularJS |
| 2 (`(5) EP 8_4 3:48:24`) | ❌ | ✅ (visible) | Legacy AngularJS |
| 3 (`(5) EP 8_4 3:53:53`) | ❌ | ❌ | Tailwind/React shell only |
| 4 (`EP 8_5 8:53:36`) | ❌ | ❌ | Tailwind/React shell only |
| 5 (`EP 8_5 8:54:05`) | ❌ | ❌ | Tailwind/React shell only |
| 6 (`EP 8_5 8:54:21`) | ❌ | ❌ | Tailwind/React shell only |
| 7 (`EP 8_5 8:54:41`) | ✅ (visible) | ❌ | **Hybrid** |
| 8 (`(5) EP 8_5 8:55:00`) | ❌ | ✅ (visible, pre-answer) | Legacy AngularJS |

> The Hybrid case (file 7) is the most interesting because it shows both
> styles on the same page. The Tailwind/React shell provides the breadcrumb
> (`crumb-child`) and global nav, while the Angular slot provides the
> `#start-button-main` and `#test-mode-options`.

---

## 3. File 1 / Hybrid list-starter — primary DOM reference

**Reference files:** `EP (8_4_2026 3：48：05 PM).html`, `EP (8_5_2026 8：54：41 AM).html`

These show the vocabulary list page (the word pairs, the mode selector, and
the Start button). File 1 captured it during an embedded wrong-answer modal;
file 7 shows the modern hybrid layout.

### 3.1 Top-level Structure

```
<div id="list-starter" class="ng-scope">          ← Root container
  └── <div id="stats-parent" class="h-group h-align-center">
        ├── <div id="left-controls-panel" class="v-group starter-panel">
        │     ├── <div id="list-progress-group">  ← Progress bar + list name
        │     ├── <div class="starter-panel arrow">  ← Mode selector arrows
        │     ├── <ul id="test-mode-options" class="grouped-options h-group">
        │     │     └── <li class="item" ng-repeat="item in starter.availableModes">
        │     │           └── <div class="main-text ng-binding">  ← Mode name
        │     ├── <ul id="number-of-questions-selector" class="h-group grouped-options">
        │     │     └── <li class="item" ng-repeat="item in starter.numberQuestionOptions">
        │     ├── <div id="start-container">
        │     │     └── <button id="start-button-main" ng-click="starter.onStartClick()">
        │     │           ├── <div id="start-button-main-icon" class="start-icon">
        │     │           └── <div id="start-button-main-label" class="ng-binding">
        │     │                 "Start" (or "Continue")
        │     └── <div id="section-controls-group">
        │           └── <button id="section-browse-dropdown-button">
        │
        └── <div id="right-list-preview-panel" class="v-group starter-panel">
              ├── <div id="list-preview-panel-header">
              │     └── <button id="preview-header-start-button">
              ├── <div id="preview-grid-header">
              │     └── Labels: "Target", "Base", "Progress"
              ├── <div id="preview-grid-container">
              │     └── <ul class="preview-grid">
              │           └── <li class="stats-item" ng-repeat="item in starter.questions | limitTo: starter.listLimit"
              │                 ng-class="{'current': ..., 'correct': item.learnt,
              │                           'incorrect': item.started && item.percentage < 50,
              │                           'partial': ...}">
              │                 ├── <div class="targetLanguage question-label native-font ng-binding">
              │                 └── <div class="baseLanguage question-label native-font ng-binding">
              │
              └── <div id="preview-footer">
                    └── <button class="edit-button"> / <button class="delete-button">
```

### 3.2 Key IDs & Selectors

| Purpose | Selector |
|---|---|
| Root container | `#list-starter` |
| Start button | `#start-button-main` |
| Start button label | `#start-button-main-label` |
| Preview start button | `#preview-header-start-button` |
| Mode options list | `#test-mode-options` or `.grouped-options` |
| Mode options items | `#left-controls-panel .grouped-options > li.item` |
| Question count selector | `#number-of-questions-selector` |
| Word pairs grid | `.preview-grid` |
| Grid item (correct) | `.stats-item` with `.correct` class |
| Grid item (incorrect) | `.stats-item` with `.incorrect` class (`item.started && item.percentage < 50`) |
| Grid item (current) | `.stats-item.current` |
| Grid item target word | `.targetLanguage.question-label` |
| Grid item base word | `.baseLanguage.question-label` |
| Sidebar browse | `#section-browse-dropdown-button` |
| Full list toggle | `#full-list-switcher` (referenced by `script.js`'s legacy `fullList()`) |
| Slim scroll content | `#slim-scroll-content` |

### 3.3 ng-class patterns for list items

```js
ng-class="{
  'current': starter.selectedQuestion == item,
  'correct': item.learnt,
  'incorrect': item.started && item.percentage < 50,
  'partial': !item.learnt && item.started && item.percentage >= 50
}"
```

---

## 4. File 2 / In-game activity — primary DOM reference

**Reference files:** `(5) EP (8_4_2026 3：48：24 PM).html`, `(5) EP (8_5_2026 8：55：00 AM).html`

These are the active game page. File 2 captured it during a pre-task / start
screen; file 8 captured an empty-question state.

### 4.1 Top-level Structure

```
<div id="game-page-container" class="v-group game-page notranslate ng-scope">
  ├── <div class="game-dialogs-container ng-scope ng-isolate-scope">
  │     └── <div id="correct-popup" class="correct-popup ng-binding ng-isolate-scope"
  │           ng-class="{ shown: self.isShown }">
  │           "Correct!" (or score)
  │
  ├── <div class="main fill question-content-container v-group" id="game-page-main">
  │     ├── <div id="game-question-content" class="game-question-content lp">
  │     │     └── <div class="lp-question-content v-group ng-scope ng-isolate-scope">
  │     │           ├── <div id="question-group" class="ep-animate">
  │     │           │     ├── <div id="question-action-bar">
  │     │           │     │     ├── <button id="refresh-button" class="nice-button grey"> ↻ </button>
  │     │           │     │     └── <button id="hint-button" class="nice-button grey"> Hint </button>
  │     │           │     └── <div id="question-block">
  │     │           │           └── <span id="question-text" class="native-font"
  │     │           │                 ng-click="self.onRefreshClick()">
  │     │           │                 "bonjour" ← The question word
  │     │           └── <div id="answer-block" ng-class="{ show: self.showAnswerForSpeakingMode }">
  │     │                 └── <input id="answer-text" autofocus type=text … >  ← verified in file 8
  │     │
  │     └── <div class="classic-game-panel ng-scope ng-isolate-scope lp-mode">
  │           └── (classic game panel — scoreboard, progress, etc.)
  │
  └── <div class="game-action-bar classic-action-bar v-group ng-scope ng-isolate-scope"
        ng-class="{'minimal-action-bar': self.model.minimalUI,
                   'semi-transparent': self.isSemiTransparent }">
        └── <div id="action-bar" class="classic-action-bar-content h-group">
              ├── <button class="nav-bar-exit" ng-click="self.onExitClick()"> ← Exit / back
              ├── <button id="continue-button" class="nice-button ng-binding"
              │     ng-click="self.continueButtonClicked()"
              │     ng-disabled="self.continueButtonDisabled">
              │     "Continue" / "Next question"   ← Hunter Mode advance target (file 2)
              ├── <button id="feedback-button" class="minimal-button ng-hide"
              │     ng-show="self.isEP && self.model.showFeedbackBar">
              ├── <button id="sound-button" class="minimal-button ignore-click">
              │     (sound toggle)
              ├── <button id="submit-button" ng-click="self.onSubmitClick($event)"
              │     ng-disabled="self.model.lpInputDisabled" ng-if="!self.isSpeakingMode">
              └── <div id="exit-button" class="h-group v-align-center h-align-center ng-hide"
                    ng-click="self.onExitClick()">
```

### 4.2 Key IDs & Selectors (Game Page)

| Purpose | Selector |
|---|---|
| Game page container | `#game-page-container` |
| Question text | `#question-text` |
| Question block | `#question-block` |
| Answer input | `#answer-text` |
| Submit button | `#submit-button` |
| Continue button (Hunter Mode primary target) | `#continue-button` |
| Correct popup | `#correct-popup` |
| Game action bar | `.game-action-bar` |
| Classic action bar content | `.classic-action-bar-content` |
| Feedback button | `#feedback-button` |
| Hint button | `#hint-button` |
| Refresh / replay button | `#refresh-button` |
| Sound toggle | `#sound-button` |
| Notifications | `.notifications-button` |
| Nav-bar exit button | `.nav-bar-exit` |
| Game question content | `#game-question-content` |
| Question group | `#question-group` |
| Answer block | `#answer-block` |
| Classic game panel | `.classic-game-panel` |
| History items | `.history-item` (with `.current`, `.incorrect`, `.correct`) |
| Question history bar | `.translation-question-history-bar` |
| Scoreboard | `.in-game-scoreboard-bar` |
| Cheer buttons | `.cheer-button` |
| Cheer result labels | `.cheer-result-label` |

### 4.3 Verdict Detection Signals (Hunter Mode v1)

**Correct answer, visible:**
- `#correct-popup` — visible (not `ng-hide`/`sf-hidden`)
- `#continue-button` — enabled (no `ng-disabled`/`[disabled]` attribute)
- `.cheer-button:not(.ng-hide):not(.sf-hidden)` — post-correct animation buttons
- `.history-item.correct` — history bar shows a green dot

**Wrong answer, visible:**
- `.history-item.incorrect` — history bar shows a red dot
- `.action-bar-button.try-again` — try-again button appears in action bar
- `tr.incorrect` inside `.modeless-answer-dialog` — wrong-answer modal

**Question finished / verdict available:**
- `.next-question-button:not([disabled])` — if EP shows a "next" button
- `#question-text` text content changes or disappears
- `.information-controls button:not([disabled])` — info "i" button acts as continue

### 4.4 Action Bar Button Types (from CSS)

The CSS reveals these button types in the action bar:
- `.action-bar-button` — generic button wrapper
- `.action-bar-button.arrow` — button with arrow indicator
- `.action-bar-button.try-again` — the try-again button (wrong answer)
- `.action-bar-button.try-again.arrow` — try-again with arrow

### 4.5 history-item ng-class

```js
ng-class="{
  current: item.isCurrent,
  correct: item.status == 0,
  incorrect: item.status == 1
}"
```

### 4.6 modeless-answer-dialog (correct/wrong overlay)

When a question is graded, the modeless-answer-dialog modal opens with:

| Element | Selector | Purpose |
|---|---|---|
| Question | `#question-field` | The word being asked |
| Correct answer | `#correct-answer-field` | EP reveals the right answer here |
| Your (wrong) answer | `#users-answer-field` | What the user typed |
| Continue button | `#continue-button` | Same button as on the game page |

This is what future "Learn from Error" policy (Hunter Mode v2) will read
from.

---

## 5. Tailwind/React shell (Files 3, 5–7)

Files 3–6 share the same Tailwind/React `mfeLearnerExperience` shell. They
differ only in which Angular slot, if any, is mounted.

### 5.1 Top-level Structure

```
<div class="mfeLearnerExperience ...">
  └── (single-spa app shell)
        ├── ... (global navigation sidebar)
        ├── <div class="sticky left-0 top-0 z-10 grid …" id="react-aria671737047-:r0:">
        │     └── <button class="…rounded-sm border…" id="react-aria671737047-:r0:">
        │           "Skip to content" (accessibility)
        ├── <div class="fixed bottom-0 left-0 top-0">  ← global left nav
        │     └── ...
        ├── <div class="content-browser v-group">
        │     └── (breadcrumb row)
        │           └── <div class="crumb is-active">
        │                 └── <span class="name"> French </span>
        ├── <div class="dashboard-page ng-scope scrollable">
        │     └── (task grid with Tailwind cards)
        └── <div class="mfeAppShell-Alert__container">  ← alert stack
```

### 5.2 Key Selectors (Tailwind Era)

| Purpose | Selector |
|---|---|
| Content browser | `.content-browser` |
| Browse container | `.browse-container` |
| Breadcrumbs (Angular) | `.breadcrumbs` |
| Breadcrumb item (Angular) | `.crumb` |
| Active breadcrumb | `.crumb.is-active` |
| Breadcrumb item (React/Tailwind) | `.crumb-child` |
| Dashboard page | `.dashboard-page` |
| Subject content page | `.subject-content-page` |
| Skip-to-content button | `#react-aria…` (id varies per render) |
| Task cards (Tailwind) | `button.flex.gap-2.…` (use `crumb-child` as fallback) |
| Sidebar items | `.flex.items-center.justify-start.h-14` |

### 5.3 Tailwind-based Task Cards

The task cards use Tailwind utility classes, not the old AngularJS pattern:
```html
<button class="flex gap-2 text-neutral-1000 focusable active:bg-neutral-200
               hover:bg-neutral-100 py-2 text-sm font-medium cursor-pointer
               items-center justify-between rounded border border-b-[3px]
               border-neutral-600 bg-white px-3 outline-none transition
               ease-in-out hover:shadow-lg">
```

---

## 6. Key Selectors for Scripting (Hunter Mode v1)

These are the selectors **actually used by `script.js` on `main` right now**.
Each one was verified against the HTML snapshots above.

### 6.1 Question Detection
```js
document.getElementById('question-text');   // verified in files 2, 8

// Junk filters
const JUNK = /^(replay|hint|submit|electronic|voice|translate|from|to|
               french|english|writing|reading|listening|dictation|speaking|
               practise|pronunciation|master|advanced|unit|vocab|list|\d+%?)$/i;
```

### 6.2 Answer Input
```js
document.querySelector('#answer-text');     // verified in file 8
document.activeElement;                     // contenteditable fallback
```

### 6.3 Vocabulary Pairs
```js
document.querySelectorAll('.targetLanguage.question-label');   // files 1, 7
document.querySelectorAll('.baseLanguage.question-label');     // files 1, 7
```

### 6.4 Start Buttons
```js
document.getElementById('start-button-main');                   // files 1, 7
document.getElementById('start-button-school');                 // activity-starter only
document.getElementById('start-button-main-label');             // same, targets label
document.getElementById('preview-header-start-button');         // files 1, 7 (alt)
```

### 6.5 Advance (Hunter Mode — primary target)
```js
document.querySelector('#continue-button:not([disabled])');    // verified in file 2
document.querySelector('.modeless-answer-dialog #continue-button:not([disabled])');
document.querySelector('.next-question-button:not([disabled])');
document.querySelector('#correct-button:not([disabled]), .correct-button:not([disabled])');
document.querySelector('.information-controls button:not([disabled])');
document.querySelector('#sa-navigation-controls button:not([disabled])');
document.querySelector('.sa-navigation-controls button:not([disabled])');
document.querySelector('.nav-bar-exit:not([disabled])');
document.querySelector('.game-action-bar button:not([disabled])');
document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
// Last-resort text match
// /^(next|continue|next question|ok|got it|done)$/i
```

### 6.6 Wrong-Answer Dismissal (Hunter Mode — Policy A)
```js
document.querySelector('#continue-button:not([disabled])');              // primary
document.querySelector('.modeless-answer-dialog #continue-button:not([disabled])');
document.querySelector('.action-bar-button.try-again button:not([disabled])');
document.querySelector('.action-bar-button.try-again:not(.ng-hide):not(.sf-hidden) button');
document.querySelector('.game-action-bar .action-bar-button.try-again button:not([disabled])');
document.querySelector('.feedback-button:not([disabled])');
document.querySelector('#sa-navigation-controls button:not([disabled])');
document.querySelector('.game-action-bar .action-bar-button button:not([disabled])');
// Last-resort text match
// /^(try again|continue|next|next question|ok|got it|retry|try it again)$/i
```

### 6.7 Correct-Answer Detection
```js
document.querySelector('#correct-popup, .correct-popup');
document.querySelector('#correct-button, .correct-button');
document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
```

### 6.8 History Bar (Verdict Signals)
```js
document.querySelector('.history-item.incorrect');   // wrong answer
document.querySelector('.history-item.correct');     // right answer
document.querySelector('.history-item.current');
```

### 6.9 List / Task Navigation
```js
// Angular list-starter sidebar (file 1, 7)
document.querySelectorAll('#left-controls-panel .grouped-options > li.item');

// Modern hybrid list-starter (file 7 — same selector usually, but if missing
// the Tailwind breadcrumbs take over)
document.querySelectorAll('.crumb-child');    // alternative back-link

// Fallbacks (script.js's skipToNextTask covers both)
document.querySelector('.breadcrumbs .crumb, .crumb-child');
document.querySelector('#sa-navigation-controls .back-button, .back-button, [data-action="back"]');
document.querySelector('a[href*="list-starter"], [ng-click*="list-starter"]');

// Full-list switcher (old UI)
document.getElementById('full-list-switcher');
document.querySelector('#slim-scroll-content .preview-grid');
```

### 6.10 Game Action Bar (Hunter Mode — last resort)
```js
document.querySelector('.game-action-bar');
document.querySelector('.game-action-bar.sa-action-bar');
document.querySelector('.game-action-bar.sa-action-bar.information');  // post-answer
document.querySelector('.information-controls button:not([disabled])');  // i-button
```

---

## 7. AngularJS Scopes & Controllers

### 7.1 List-Starter Controller

The `#list-starter` div is an AngularJS scope with controller alias `starter`:

| Scope property | Type | Description |
|---|---|---|
| `starter.questions` | Array | The list of word pairs |
| `starter.selectedQuestion` | Object | Currently selected question |
| `starter.availableModes` | Array | Available learning modes (Learn, Spell, Test, …) |
| `starter.numberQuestionOptions` | Array | Options for number of questions |
| `starter.numberQuestions` | Number | Selected number of questions |
| `starter.INFINITY` | Constant | Represents "unlimited" mode |
| `starter.isDashMode` | Boolean | Whether the dashboard mode is active |
| `starter.isSpelling` | Boolean | Whether spelling mode is active |
| `starter.onStartClick()` | Function | Called when start button is clicked |
| `starter.hasQuestions` | Boolean | Whether any questions are loaded |
| `starter.quizService` | Object | Dashboard quiz service |
| `starter.selectedTestMode` | Number | Selected test mode |
| `starter.seededWordAvailable` | Boolean | Whether seeded word is available |
| `starter.showLearningOptions` | Boolean | Whether to show learning options |
| `starter.showEditButton` | Boolean | Whether to show edit button |
| `starter.listLimit` | Number | Limit for displayed questions |
| `starter.increaseLimit()` | Function | Load more questions (infinite scroll) |

### 7.2 Game Page Controller

The game page uses controller alias `self` or `game`:

| Scope property | Type | Description |
|---|---|---|
| `self.model` | Object | Game model |
| `self.model.gameMode` | Number | 1 = classic, 2 = … |
| `self.model.minimalUI` | Boolean | Minimal UI mode |
| `self.model.hideActionUI` | Boolean | Hide action UI |
| `self.model.sketchPadShown` | Boolean | Sketch pad state |
| `self.model.lpAnswerEntered` | Boolean | Answer entered |
| `self.model.lpInputDisabled` | Boolean | Input disabled (e.g. submitted) |
| `self.isEP` | Boolean | Is EP mode |
| `self.isSpeakingMode` | Boolean | Speaking mode |
| `self.isSmartLesson` | Boolean | Smart lesson mode |
| `self.isQuestionLoaded` | Boolean | Whether question is loaded |
| `self.isSemiTransparent` | Boolean | Semi-transparent action bar |
| `self.isSmallActionBar` | Boolean | Compact action bar |
| `self.displayState` | Number | 0=neutral, 1=error, 2=correct |
| `self.currentMode` | Number | Current game mode |
| `self.showReplayButton` | Boolean | Show replay button |
| `self.showHintButton` | Boolean | Show hint button |
| `self.showFeedbackBar` | Boolean | Show feedback bar |
| `self.continueButtonDisabled` | Boolean | Continue button disabled |
| `self.continueButtonClicked()` | Function | Continue button handler |
| `self.onRefreshClick()` | Function | Refresh/replay handler |
| `self.onHintClick()` | Function | Hint handler |
| `self.onExitClick()` | Function | Exit handler |
| `self.questionHistoryItems` | Array | Question history items for progress bar |
| `self.rankingGroups` | Array | Scoreboard ranking groups |
| `self.scoreData` | Array | Scoreboard data |
| `self.cheersEnabled` | Boolean | Cheers enabled |
| `self.displayBar` | Boolean | Display action bar |
| `self.enabled` | Boolean | Action bar enabled |
| `self.selectedClassicTestMode` | Number | Selected test mode |

---

## 8. Navigation Flow

### 8.1 Typical User Flow

```
1. User lands on course browser (file 3)
   └── URL: /app/French/1373/187197/browse
   └── Clicks a lesson → navigates to list-starter

2. List-starter page (files 1, 7)
   └── URL: /app/French/1373/187197/list-starter
   └── Shows word pairs in preview grid
   └── User selects mode + number of questions
   └── Clicks "Start" → navigates to game

3. Game page (files 2, 8)
   └── URL: /app/French/1373/187197/game?mode=1
   └── Shows question, answer input, action bar
   └── After answering: correct-popup or try-again
   └── Clicks Continue/Next → next question or back to list-starter

4. After list completes
   └── Returns to list-starter
   └── Shows updated stats in preview grid
   └── User can start a different mode or go to course browser
```

### 8.2 Route Detection for Scripting

```js
const url = window.location.href.toLowerCase();

const isListStarter     = url.includes('list-starter');
const isActivityStarter = url.includes('activity-starter');
const isGame            = url.includes('game');
const isBrowse          = url.includes('browse');

const isTaskPage = isListStarter || isActivityStarter || isGame;
const isVocabPage = isListStarter;  // vocab loading only on list-starter
```

---

## 9. Appendix: Full Class & ID Reference

### 9.1 All Unique IDs Across All Eight Files

| ID | File(s) | Element |
|---|---|---|
| `list-starter` | 1, 7 | Root list-starter div |
| `left-controls-panel` | 1, 7 | Left panel with mode selector + start button |
| `right-list-preview-panel` | 1, 7 | Right panel with word grid |
| `stats-parent` | 1, 7 | Flex container for both panels |
| `start-container` | 1, 7 | Start button wrapper |
| `start-button-main` | 1, 7 | Primary start button |
| `start-button-main-content` | 1, 7 | Start button inner content |
| `start-button-main-icon` | 1, 7 | Start button icon |
| `start-button-main-label` | 1, 7 | Start button label text |
| `preview-header-start-button` | 1, 7 | Alternative start button in preview header |
| `preview-grid-container` | 1, 7 | Word grid scroll container |
| `preview-grid-header` | 1, 7 | Grid header with labels |
| `preview-footer` | 1, 7 | Grid footer with edit/delete |
| `list-preview-panel-header` | 1, 7 | Preview panel header |
| `list-progress-group` | 1, 7 | Progress bar group |
| `section-controls-group` | 1, 7 | Section browse controls |
| `section-browse-dropdown-button` | 1, 7 | Browse dropdown |
| `test-mode-options` | 1, 7 | Mode options list |
| `number-of-questions-selector` | 1, 7 | Question count selector |
| `slim-scroll-content` | 1 | Scrollable content area (legacy) |
| `game-page-container` | 2, 8 | Game page root |
| `game-page-main` | 2, 8 | Main game content area |
| `game-question-content` | 2, 8 | Question content area |
| `question-group` | 2, 8 | Question wrapper |
| `question-action-bar` | 2, 8 | Question action bar (refresh, hint) |
| `question-block` | 2, 8 | Question text block |
| `question-text` | 2, 8 | The question word |
| `answer-block` | 2, 8 | Answer input area |
| `answer-text` | 8 | The answer input element |
| `correct-popup` | 2, 8 | Correct answer popup |
| `action-bar` | 2, 8 | Game action bar |
| `continue-button` | 2 | Continue/Next question button (Hunter Mode primary) |
| `feedback-button` | 2, 8 | Feedback button |
| `sound-button` | 2, 8 | Sound toggle |
| `exit-button` | 2, 8 | Exit button |
| `refresh-button` | 2, 8 | Refresh/replay |
| `hint-button` | 2, 8 | Hint button |
| `submit-button` | 8 | Submit answer button |
| `modeless-answer-dialog` (overlay) | (rendered at answer time) | Wrong/correct answer modal |
| `correct-answer-field` | (in modal) | EP reveals correct answer here (Learning-from-Error hook) |
| `users-answer-field` | (in modal) | User's typed (wrong) answer |
| `question-field` | (in modal) | Question word in modal |
| `react-aria-*` | 1, 2, 3, 4–8 | React Aria internal IDs (dynamic) |
| `single-spa-application:*` | 1–8 | Micro-frontend mount points |

### 9.2 Key CSS Classes (AngularJS Era)

| Class | Purpose |
|---|---|
| `.ng-scope` | AngularJS scope |
| `.ng-isolate-scope` | Isolated scope component |
| `.ng-binding` | Data-bound element |
| `.ng-hide` | Hidden by Angular (Angular's `ng-hide` directive) |
| `.sf-hidden` | Hidden by SingleFile (preserved state) |
| `.h-group` | Horizontal flex container |
| `.v-group` | Vertical flex container |
| `.h-align-center` | Horizontal alignment center |
| `.v-align-center` | Vertical alignment center |
| `.h-align-space-between` | Justify-content: space-between |
| `.starter-panel` | Panel in the list-starter view |
| `.grouped-options` | Grouped option list (modes, counts) |
| `.preview-grid` | Word pair grid |
| `.stats-item` | Individual word pair in grid |
| `.targetLanguage.question-label` | Target language word |
| `.baseLanguage.question-label` | Base language word |
| `.game-page` | Game page container |
| `.game-action-bar` | Bottom action bar in game |
| `.classic-action-bar` | Classic mode action bar |
| `.classic-action-bar-content` | Inner content of classic action bar |
| `.action-bar-button` | Button inside action bar |
| `.action-bar-button.try-again` | Try-again button (wrong answer) |
| `.action-bar-button.arrow` | Arrow-styled button |
| `.ep-animate` | Animation-enabled element |
| `.native-font` | Uses native font |
| `.nice-button` | Styled button |
| `.minimal-button` | Minimal style button |
| `.history-item` | Question history bar item |
| `.history-item.current` | Current question |
| `.history-item.correct` | Correctly answered |
| `.history-item.incorrect` | Incorrectly answered |
| `.correct-popup` | Correct answer popup |
| `.cheer-button` | Cheer/send encouragement button |
| `.cheer-result-label` | Cheer result display |
| `.in-game-scoreboard-bar` | Live scoreboard during game |
| `.scrollable` | Scrollable container |
| `.printRemove` | Hidden when printing |
| `.printSection` | Visible when printing |
| `.question-label` | Question label style |
| `.main-text` | Main text of an item |
| `.infinity` | Infinity symbol (unlimited mode) |
| `.quiz-locked` | Locked quiz mode item |
| `.lp` | LanguagePerfect (LP) mode |
| `.lp-mode` | LP mode active |
| `.lp-question-content` | LP question content |
| `.modeless-answer-dialog` | Correct/wrong answer modal |
| `.notifications-button` | Notifications bell |

### 9.3 Key CSS Classes (Tailwind/React Era — Files 3–7)

| Class | Purpose |
|---|---|
| `.content-browser` | Course/content browser |
| `.browse-container` | Browse layout container |
| `.breadcrumbs` | Breadcrumb navigation (Angular) |
| `.crumb` | Individual breadcrumb (Angular) |
| `.crumb.is-active` | Active breadcrumb (Angular) |
| `.crumb-child` | Tailwind breadcrumb chip |
| `.dashboard-page` | Dashboard/task grid |
| `.subject-content-page` | Subject content page |
| `.view-segment-dashboard` | Dashboard view segment |
| `.main-view-segment` | Main view segment |
| `.main-content` | Main content area |
| `.flex` | Display flex |
| `.flex-col` | Flex column |
| `.items-center` | Align items center |
| `.justify-center` | Justify content center |
| `.justify-start` | Justify content start |
| `.gap-2` / `.gap-4` | Gap (8px / 16px) |
| `.focusable` | Focusable element (custom outline) |
| `.bg-neutral-*` / `.border-neutral-*` / `.text-neutral-*` | Neutral color shades |
| `.bg-primary` / `.bg-theme-*` | Theme / primary backgrounds |
| `.font-medium` / `.font-semibold` / `.font-bold` | Font weights |
| `.rounded` / `.rounded-sm` | Border radii |
| `.transition` / `.ease-in-out` | Transitions |
| `.w-full` / `.h-full` / `.h-9` | Width/height |
| `.aspect-square` | Aspect ratio 1:1 |
| `.cursor-pointer` | Pointer cursor |
| `.hover:bg-*` / `.active:bg-*` | Hover / active states |
| `.mfeLearnerExperience` | Root micro-frontend |
| `.mfeGlobalNavigation` | Global navigation (sidebar) |
| `.mfeAppShell-*` | App shell layout |
| `.mfeAppShell-Scaffold__item` | App shell scaffold item |

---

First commit and push the current work with a clear message, then confirm the push succeeded.

---

Then implement the next improvements to **Hunter Mode list navigation**, using the exact DOM structures below.

### Real navigation structure (use these)

Education Perfect list browsing works like this:

1. **Folder / breadcrumb level**
   ```html
   <div class="crumb-child item h-group v-align-center">
     ...folder icon...
     <div class="item-title fill">Vocabulary</div>
     <div class="official-content">Official</div>
   </div>
   ```
   and deeper folders such as:
   ```html
   <div class="item-title fill">Basic Vocabulary</div>
   ```

2. **Individual list / activity**
   ```html
   <div class="item-title fill">Body Parts</div>
   <!-- or "Classroom objects" etc. -->
   ```
   These sit inside the folder view and represent the actual vocabulary lists.

3. **Mode selection (after opening a list)**
   ```html
   <li class="item h-group v-align-center mode-1 selected" ...>
     <div class="main-text">Writing</div>
     <div class="sub-text">English Text to French</div>
   </li>
   ```
   and the opposite direction:
   ```html
   <div class="sub-text">French Text to English</div>
   ```

4. **After answering – advance button**
   ```html
   <button id="continue-button" ...>Next question</button>
   ```

### What Hunter Mode must do with these

When Hunter needs to move to another list (auto-continue or the “Skip whole list” button), follow this exact flow:

1. Detect that the current list is finished (or the user clicked Skip).
2. Navigate back to the folder view if necessary.
3. Find the next available list by reading the `.item-title` elements (e.g. “Body Parts”, “Classroom objects”, etc.).
4. Click the next list that has not been completed yet.
5. On the mode-selection screen, prefer the **Writing** mode.  
   - Choose “English Text to French” or “French Text to English” according to whatever the current session is using (or a configurable preference).
6. Click the Start button (reuse the existing start-button logic already in `script.js`).
7. Once inside the activity, normal Hunter Mode (answer → learn on error → click `#continue-button`) takes over again.

### Concrete implementation tasks

- Add reliable selectors for:
  - Folder items (`.crumb-child.item` + `.item-title`)
  - List/activity titles (`.item-title.fill`)
  - Mode list items (`li.item` with `.main-text` = “Writing” and the two `.sub-text` directions)
  - `#continue-button`
- Write a clear `findNextList()` (or equivalent) function that walks the visible list of `.item-title` elements and returns the next uncompleted one.
- Make both **auto-continue lists** and the **Skip whole list** button use this new navigation logic.
- Keep using the highest-priority error path: learn correct answer → click `#continue-button`.
- Do not hard-code list names; always read them live from the DOM.

### Mandatory documentation updates (every time)
After the code changes:

1. Update `Implement/HUNTER_MODE_ROADMAP.md` – mark the new navigation work as done and note the folder → list → mode → start flow.
2. Update the DOM layout reference with the new selectors (folders, item-titles, mode list, `#continue-button`).
3. Update the AI context file with a short description of how Hunter now finds and starts the next list.

### Rules
- Search **all** HTML files in the folder for every selector.
- Re-use existing start-button and state-machine logic.
- Everything stays behind `hunter.enabled` and the `hunter: {}` config.
- Pure DOM only.
- Do not break previous phases.

### Deliverable
1. Commit + push of previous work.
2. Updated `script.js` that can reliably walk folders → pick the next list → choose Writing mode → start it → then continue normal Hunter answering.
3. Updated roadmap, DOM layout reference, and AI context file.<div theme-hover-background-color="accentColorLight" theme-active-background-color="accentColorLight" class="crumb-child item h-group v-align-center"><div data-v-44fdd2a3="" class="eds-mr-100 EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-44fdd2a3="" class="h-group h-align-center v-align-center folder-icon"><svg data-v-44fdd2a3="" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="e13b5759-b971-4c8d-9b8b-f94620fa5b82" class="EdsIcon_eds-component_24CuF EdsIcon_base-theme_2Vikr EdsIcon_variant-type-one--large_1KtD8" style="--eds-icon-color: #6b748e;"><title id="e13b5759-b971-4c8d-9b8b-f94620fa5b82" lang="en">folder icon</title><g class="EdsIcon_variant-type-one__group_UZVhj"><path data-v-44fdd2a3="" d="M10.731 5.516A1.832 1.832 0 009.453 5H4.8c-.99 0-1.791.787-1.791 1.75L3 17.25c0 .962.81 1.75 1.8 1.75h14.4c.99 0 1.8-.788 1.8-1.75V9.5c0-.963-.81-1.75-1.8-1.75H12l-1.269-2.234z"></path></g></svg> <!----></div></div> <div class="item-title fill">Vocabulary</div> <div theme-color="accentColor" theme-background-color="accentColorLight" class="official-content"> Official </div></div><div theme-hover-background-color="accentColorLight" theme-active-background-color="accentColorLight" class="crumb-child item h-group v-align-center"><div data-v-44fdd2a3="" class="eds-mr-100 EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-44fdd2a3="" class="h-group h-align-center v-align-center folder-icon"><svg data-v-44fdd2a3="" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="977fb6b9-7779-4383-94ea-56f7072f08ce" class="EdsIcon_eds-component_24CuF EdsIcon_base-theme_2Vikr EdsIcon_variant-type-one--large_1KtD8" style="--eds-icon-color: #6b748e;"><title id="977fb6b9-7779-4383-94ea-56f7072f08ce" lang="en">folder icon</title><g class="EdsIcon_variant-type-one__group_UZVhj"><path data-v-44fdd2a3="" d="M10.731 5.516A1.832 1.832 0 009.453 5H4.8c-.99 0-1.791.787-1.791 1.75L3 17.25c0 .962.81 1.75 1.8 1.75h14.4c.99 0 1.8-.788 1.8-1.75V9.5c0-.963-.81-1.75-1.8-1.75H12l-1.269-2.234z"></path></g></svg> <!----></div></div> <div class="item-title fill">Basic Vocabulary</div></div><div class="item-title fill">Classroom objects</div><div theme-hover-background-color="accentColorLight" theme-active-background-color="accentColorLight" class="crumb-child item h-group v-align-center"><div data-v-614e6d2e="" class="eds-mr-100 EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-614e6d2e="" class="activity-icon h-group h-align-center v-align-center"><svg data-v-614e6d2e="" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="bea1a65f-334a-4217-adfe-ad6c858e4b48" class="EdsIcon_eds-component_24CuF EdsIcon_base-theme_2Vikr EdsIcon_variant-type-one--large_1KtD8" style="--eds-icon-color: #6b748e;"><title id="bea1a65f-334a-4217-adfe-ad6c858e4b48" lang="en">Translation list</title><g class="EdsIcon_variant-type-one__group_UZVhj"><path data-v-614e6d2e="" d="M5.25 3H16.5L21 7.5v11.25c0 1.24-1 2.25-2.25 2.25H5.25C4.01 21 3 20 3 18.75V5.25C3 4.01 4 3 5.25 3z" fill="#4f46e5"></path><path data-v-614e6d2e="" d="M10.5 6c.4 0 .72.3.75.7v.05h2.25c.41 0 .75.34.75.75 0 .4-.3.72-.7.75h-.8V9a3 3 0 01-1.12 2.34l-.25.2.77.58c.14-.09.3-.17.47-.24.45-.18 1-.27 1.68-.27.74 0 1.33.09 1.76.26.43.18.73.46.9.84.18.38.27.89.27 1.52v1.18l-.01.76c0 .32.05.65.16 1l.02.08.05.16.03.13.03.11.01.1.01.09c0 .17-.08.33-.24.48a.82.82 0 01-.56.21c-.17 0-.34-.08-.51-.25-.18-.16-.36-.4-.55-.7-.4.31-.8.55-1.19.71-.38.16-.81.24-1.3.24-.43 0-.8-.09-1.14-.26a1.84 1.84 0 01-1.03-1.66c0-.46.15-.86.44-1.19.27-.3.64-.5 1.1-.63l.2-.05 1.03-.2.42-.1.25-.06.12-.02 1-.27a1.77 1.77 0 00-.28-.98c-.16-.21-.49-.32-1-.32-.42 0-.75.06-.97.18-.21.12-.4.3-.56.54l-.14.22-.07.1-.07.1-.05.06c-.06.08-.2.11-.41.11a.72.72 0 01-.5-.18.6.6 0 01-.2-.47v-.08l-1.2-.9-2.17 1.63a.75.75 0 01-.45.15.75.75 0 01-.75-.75c0-.23.1-.41.26-.55l.05-.04-.01-.01 1.82-1.37-.17-.13a3 3 0 01-1.2-2.29V9H9c0 .47.21.89.55 1.16l.06.05.51.38.51-.38c.36-.26.6-.66.62-1.12v-.84h-4.5A.75.75 0 016 7.5c0-.4.3-.72.7-.75H9c0-.4.3-.72.7-.75h.8zm5.06 9.11l-.07.03c-.1.04-.24.07-.38.11l-.23.06-.26.06-.63.14-.35.08-.15.04a1.2 1.2 0 00-.52.28.72.72 0 00-.25.58c0 .26.1.47.29.66.2.18.45.27.76.27a2 2 0 00.94-.22c.28-.15.49-.34.62-.57.14-.24.22-.63.23-1.16v-.36z" fill="#ffffff"></path></g></svg> <div data-v-614e6d2e="" class="activity-icon__status"><div data-v-2ca5d1d6="" data-v-614e6d2e="" class="EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-2ca5d1d6="" class="h-group h-align-center v-align-center"><div data-v-2ca5d1d6="" class="status status--none status--large"><!----> <!----> <!----></div></div></div></div></div></div> <div class="item-title fill">Body Parts</div> <!----> <!----></div><li class="item h-group v-align-center mode-1 selected" ng-repeat="item in starter.availableModes" ng-click="starter.selectLearningMode(item)" ng-class="{ selected: item.id === starter.selectedMode.id, 'quiz-locked': starter.isDashMode &amp;&amp; (!starter.quizService.isModeUnlockedForLPMode(item.id) || !starter.dashAvailableForMode(item.id)) }" style=""> <div class="icon" ng-attr-mode="{{ ::item.name }}" mode="Writing"></div> <div class="v-group"> <div class="h-group"> <div class="main-text ng-binding">Writing</div> <!-- ngIf: starter.selectedMode.id == 8 && item.id == 8 --> </div> <div class="sub-text ng-binding">English Text to French</div> <!-- ngIf: !starter.isDashMode --><div ng-if="!starter.isDashMode" ng-show="item.percentage &gt; 0" ng-class="{ learnt: item.percentage == 100 }" class="percentage-label ng-binding ng-scope ng-hide"> 0%</div><!-- end ngIf: !starter.isDashMode --> <!-- ngIf: starter.isDashMode && starter.dashAvailableForMode(item.id) && !starter.quizService.isModeUnlockedForLPMode(item.id) --> <!-- ngIf: starter.isDashMode && !starter.dashAvailableForMode(item.id) && item.id != 8 --> <!-- ngIf: starter.isDashMode && !starter.dashAvailableForMode(item.id) && item.id == 8 --> </div> </li><div class="sub-text ng-binding">French Text to English</div> and this is the move to the next questino when it appers <button class="nice-button ng-binding" id="continue-button" ng-click="self.continueButtonClicked()" ng-disabled="self.continueButtonDisabled"> Next question </button> make me a promt using all of these and there places bcause one of tehem is the menu then the menu in side that go into a folder and then in that folder then eaither the writing english or "language" button then start and normal scripf then just make sure to say what all of these do and how to use them and makeing sure that hunter mode uses these while searching for other lists to do<button class="nice-button ng-binding" id="continue-button" ng-click="self.continueButtonClicked()" ng-disabled="self.continueButtonDisabled"> Next question </button><div class="sub-text ng-binding">French Text to English</div><li class="item h-group v-align-center mode-1 selected" ng-repeat="item in starter.availableModes" ng-click="starter.selectLearningMode(item)" ng-class="{ selected: item.id === starter.selectedMode.id, 'quiz-locked': starter.isDashMode &amp;&amp; (!starter.quizService.isModeUnlockedForLPMode(item.id) || !starter.dashAvailableForMode(item.id)) }" style=""> <div class="icon" ng-attr-mode="{{ ::item.name }}" mode="Writing"></div> <div class="v-group"> <div class="h-group"> <div class="main-text ng-binding">Writing</div> <!-- ngIf: starter.selectedMode.id == 8 && item.id == 8 --> </div> <div class="sub-text ng-binding">English Text to French</div> <!-- ngIf: !starter.isDashMode --><div ng-if="!starter.isDashMode" ng-show="item.percentage &gt; 0" ng-class="{ learnt: item.percentage == 100 }" class="percentage-label ng-binding ng-scope ng-hide"> 0%</div><!-- end ngIf: !starter.isDashMode --> <!-- ngIf: starter.isDashMode && starter.dashAvailableForMode(item.id) && !starter.quizService.isModeUnlockedForLPMode(item.id) --> <!-- ngIf: starter.isDashMode && !starter.dashAvailableForMode(item.id) && item.id != 8 --> <!-- ngIf: starter.isDashMode && !starter.dashAvailableForMode(item.id) && item.id == 8 --> </div> </li><div theme-hover-background-color="accentColorLight" theme-active-background-color="accentColorLight" class="crumb-child item h-group v-align-center"><div data-v-614e6d2e="" class="eds-mr-100 EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-614e6d2e="" class="activity-icon h-group h-align-center v-align-center"><svg data-v-614e6d2e="" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="bea1a65f-334a-4217-adfe-ad6c858e4b48" class="EdsIcon_eds-component_24CuF EdsIcon_base-theme_2Vikr EdsIcon_variant-type-one--large_1KtD8" style="--eds-icon-color: #6b748e;"><title id="bea1a65f-334a-4217-adfe-ad6c858e4b48" lang="en">Translation list</title><g class="EdsIcon_variant-type-one__group_UZVhj"><path data-v-614e6d2e="" d="M5.25 3H16.5L21 7.5v11.25c0 1.24-1 2.25-2.25 2.25H5.25C4.01 21 3 20 3 18.75V5.25C3 4.01 4 3 5.25 3z" fill="#4f46e5"></path><path data-v-614e6d2e="" d="M10.5 6c.4 0 .72.3.75.7v.05h2.25c.41 0 .75.34.75.75 0 .4-.3.72-.7.75h-.8V9a3 3 0 01-1.12 2.34l-.25.2.77.58c.14-.09.3-.17.47-.24.45-.18 1-.27 1.68-.27.74 0 1.33.09 1.76.26.43.18.73.46.9.84.18.38.27.89.27 1.52v1.18l-.01.76c0 .32.05.65.16 1l.02.08.05.16.03.13.03.11.01.1.01.09c0 .17-.08.33-.24.48a.82.82 0 01-.56.21c-.17 0-.34-.08-.51-.25-.18-.16-.36-.4-.55-.7-.4.31-.8.55-1.19.71-.38.16-.81.24-1.3.24-.43 0-.8-.09-1.14-.26a1.84 1.84 0 01-1.03-1.66c0-.46.15-.86.44-1.19.27-.3.64-.5 1.1-.63l.2-.05 1.03-.2.42-.1.25-.06.12-.02 1-.27a1.77 1.77 0 00-.28-.98c-.16-.21-.49-.32-1-.32-.42 0-.75.06-.97.18-.21.12-.4.3-.56.54l-.14.22-.07.1-.07.1-.05.06c-.06.08-.2.11-.41.11a.72.72 0 01-.5-.18.6.6 0 01-.2-.47v-.08l-1.2-.9-2.17 1.63a.75.75 0 01-.45.15.75.75 0 01-.75-.75c0-.23.1-.41.26-.55l.05-.04-.01-.01 1.82-1.37-.17-.13a3 3 0 01-1.2-2.29V9H9c0 .47.21.89.55 1.16l.06.05.51.38.51-.38c.36-.26.6-.66.62-1.12v-.84h-4.5A.75.75 0 016 7.5c0-.4.3-.72.7-.75H9c0-.4.3-.72.7-.75h.8zm5.06 9.11l-.07.03c-.1.04-.24.07-.38.11l-.23.06-.26.06-.63.14-.35.08-.15.04a1.2 1.2 0 00-.52.28.72.72 0 00-.25.58c0 .26.1.47.29.66.2.18.45.27.76.27a2 2 0 00.94-.22c.28-.15.49-.34.62-.57.14-.24.22-.63.23-1.16v-.36z" fill="#ffffff"></path></g></svg> <div data-v-614e6d2e="" class="activity-icon__status"><div data-v-2ca5d1d6="" data-v-614e6d2e="" class="EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-2ca5d1d6="" class="h-group h-align-center v-align-center"><div data-v-2ca5d1d6="" class="status status--none status--large"><!----> <!----> <!----></div></div></div></div></div></div> <div class="item-title fill">Body Parts</div> <!----> <!----></div><div theme-hover-background-color="accentColorLight" theme-active-background-color="accentColorLight" class="crumb-child item h-group v-align-center"><div data-v-44fdd2a3="" class="eds-mr-100 EdsSetTheme_variant-type-one_iscs6 EdsSetTheme_variant-type-one--theme-type-two_1e7KR"><div data-v-44fdd2a3="" class="h-group h-align-center v-align-center folder-icon"><svg data-v-44fdd2a3="" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="977fb6b9-7779-4383-94ea-56f7072f08ce" class="EdsIcon_eds-component_24CuF EdsIcon_base-theme_2Vikr EdsIcon_variant-type-one--large_1KtD8" style="--eds-icon-color: #6b748e;"><title id="977fb6b9-7779-4383-94ea-56f7072f08ce" lang="en">folder icon</title><g class="EdsIcon_variant-type-one__group_UZVhj"><path data-v-44fdd2a3="" d="M10.731 5.516A1.832 1.832 0 009.453 5H4.8c-.99 0-1.791.787-1.791 1.75L3 17.25c0 .962.81 1.75 1.8 1.75h14.4c.99 0 1.8-.788 1.8-1.75V9.5c0-.963-.81-1.75-1.8-1.75H12l-1.269-2.234z"></path></g></svg> <!----></div></div> <div class="item-title fill">Basic Vocabulary</div></div><div class="item-title fill">Classroom objects</div>

> **Last updated:** August 5, 2026 (after the morning snapshots arrived)
> **Source files:** all 8 `Implement/*.html` snapshots
> **Companion docs:** `Implement/HUNTER_MODE_ROADMAP.md` — current status,
> implementation order, error policies, configuration.
