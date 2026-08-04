# DOM Structure Overview — Education Perfect

> Extracted from the three HTML snapshots in `Implement/` (captured August 4, 2026).
> These are **full-page SingleFile** exports of the real EP website, so every
> element is real — no mocking, no guessing.
>
> **Files:**
> - `EP (8_4_2026 3：48：05 PM).html` — **Wrong-answer / list-starter view** (page URL: `/app/French/1373/187197/list-starter`)
> - `(5) EP (8_4_2026 3：48：24 PM).html` — **In-game activity / pre-task screen** (page URL: `/app/French/1373/187197/game?mode=1`)
> - `(5) EP (8_4_2026 3：53：53 PM).html` — **List / course-browser view** (task grid)

---

## Table of Contents

1. [Page Routes & AngularJS Patterns](#1-page-routes--angularjs-patterns)
2. [File 1 — List Starter (Wrong-Answer State)](#2-file-1--list-starter-wrong-answer-state)
3. [File 2 — In-Game Activity (Game Question)](#3-file-2--in-game-activity-game-question)
4. [File 3 — Course Browser (List View)](#4-file-3--course-browser-list-view)
5. [Key Selectors for Scripting](#5-key-selectors-for-scripting)
6. [AngularJS Scopes & Controllers](#6-angularjs-scopes--controllers)
7. [Navigation Flow](#7-navigation-flow)
8. [Appendix: Full Class & ID Reference](#8-appendix-full-class--id-reference)

---

## 1. Page Routes & AngularJS Patterns

EP is an **AngularJS** single-page application (Angular 1.x) with a **micro-frontend** shell
(`single-spa`). Key routes:

| Route pattern | Description | File |
|---|---|---|
| `/app/{subject}/{id}/{listId}/list-starter` | Vocabulary list — shows pairs grid, modes, start button | File 1 |
| `/app/{subject}/{id}/{listId}/game?mode=1` | Active game — question, answer input, action bar, scoreboard | File 2 |
| `/app/{subject}/{id}/{listId}/activity-starter` | Activity pre-task screen (not directly captured) | — |
| `/browse/...` | Course/lesson browser (tailwind-based new UI) | File 3 |

**AngularJS conventions visible:**
- `ng-scope` — every AngularJS component
- `ng-isolate-scope` — directive/component with isolated scope
- `ng-repeat`, `ng-if`, `ng-show`, `ng-hide`, `ng-class`, `ng-click`, `ng-disabled`, `ng-model`, `ng-bind`
- `ng-hide` / `sf-hidden` — both used for hiding elements (Angular's `ng-hide` + `sf-hidden` from SingleFile)
- `ng-class="{correct: ..., incorrect: ..., current: ...}"` — common pattern for question items
- `starter.*` — controller alias for list-starter pages
- `self.*` / `game.*` — controller aliases for game pages
- `model=game.model` — passing game model into child directives

---

## 2. File 1 — List Starter (Wrong-Answer State)

**URL:** `/app/French/1373/187197/list-starter`

This is the vocabulary list page. It shows the word pairs, lets you select modes,
and has the "Start" button. The snapshot was taken **while a wrong answer was
visible on the in-game overlay** (the game portion is embedded in a modal).

### 2.1 Top-level Structure

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

### 2.2 Key IDs & Selectors

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
| Grid item (incorrect) | `.stats-item` with `.incorrect` class (when `item.started && item.percentage < 50`) |
| Grid item (current) | `.stats-item.current` |
| Grid item target word | `.targetLanguage.question-label` |
| Grid item base word | `.baseLanguage.question-label` |
| Sidebar browse | `#section-browse-dropdown-button` |
| Full list toggle | `#full-list-switcher` (ID from script.js, may not exist in every version) |
| Slim scroll content | `#slim-scroll-content` |
| Preview grid container | `#preview-grid-container` |

### 2.3 ng-class patterns for list items

```js
ng-class="{
  'current': starter.selectedQuestion == item,
  'correct': item.learnt,
  'incorrect': item.started && item.percentage < 50,
  'partial': !item.learnt && item.started && item.percentage >= 50
}"
```

---

## 3. File 2 — In-Game Activity (Game Question)

**URL:** `/app/French/1373/187197/game?mode=1`

This is the active game page — where the user answers questions. The snapshot
was taken during a **pre-task / start screen** (the game has loaded but the
question hasn't been answered yet). Contains the full game shell.

### 3.1 Top-level Structure

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
  │     │                 └── (answer input area — may be hidden on this screen)
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
              │     "Continue" / "Next"
              ├── <button id="feedback-button" class="minimal-button ng-hide"
              │     ng-show="self.isEP && self.model.showFeedbackBar">
              ├── <button id="sound-button" class="minimal-button ignore-click">
              │     (sound toggle)
              └── <div id="exit-button" class="h-group v-align-center h-align-center ng-hide"
                    ng-click="self.onExitClick()">
```

### 3.2 Key IDs & Selectors (Game Page)

| Purpose | Selector |
|---|---|
| Game page container | `#game-page-container` |
| Question text | `#question-text` |
| Question block | `#question-block` |
| Continue button | `#continue-button` |
| Correct popup | `#correct-popup` |
| Game action bar | `.game-action-bar` |
| Classic action bar content | `.classic-action-bar-content` |
| Feedback button | `#feedback-button` |
| Hint button | `#hint-button` |
| Refresh / replay button | `#refresh-button` |
| Game question content | `#game-question-content` |
| Question group | `#question-group` |
| Answer block | `#answer-block` |
| Classic game panel | `.classic-game-panel` |
| History items | `.history-item` (with `.current`, `.incorrect`, `.correct`) |
| Question history bar | `.translation-question-history-bar` |
| Scoreboard | `.in-game-scoreboard-bar` |
| Cheer buttons | `.cheer-button` |
| Cheer result labels | `.cheer-result-label` |

### 3.3 Verdict Detection Signals

**Correct answer, visible:**
- `#correct-popup` — visible (not `ng-hide`/`sf-hidden`)
- `#continue-button` — enabled (no `ng-disabled`/`[disabled]` attribute)
- `.cheer-button:not(.ng-hide):not(.sf-hidden)` — post-correct animation buttons
- `.history-item.correct` — history bar shows a green dot

**Wrong answer, visible:**
- `.history-item.incorrect` — history bar shows a red dot
- `.action-bar-button.try-again` — try-again button appears in action bar
- Try-again button with class `.action-bar-button.try-again` + `button:not([disabled])`

**Question finished / verdict available:**
- `.next-question-button:not([disabled])` — if EP shows a "next" button
- `#question-text` text content changes or disappears

### 3.4 Action Bar Button Types (from CSS)

The CSS reveals these button types in the action bar:
- `.action-bar-button` — generic button wrapper
- `.action-bar-button.arrow` — button with arrow indicator
- `.action-bar-button.try-again` — the try-again button (wrong answer)
- `.action-bar-button.try-again.arrow` — try-again with arrow

### 3.5 history-item ng-class

```js
ng-class="{
  current: item.isCurrent,
  correct: item.status == 0,
  incorrect: item.status == 1
}"
```

---

## 4. File 3 — Course Browser (List View)

**URL:** `/app/French/1373/187197/browse` (or similar)

This is the newer **Tailwind-styled** course browser. It shows the breadcrumb
navigation and the grid of lessons/tasks. This page uses the newer React-based
micro-frontend rather than the AngularJS ones.

### 4.1 Top-level Structure

```
<div class="mfeLearnerExperience ...">
  └── (layout with Tailwind classes)
        ├── ... (global navigation sidebar)
        │
        └── <div class="content-browser v-group">
              └── <div class="browse-container v-group">
                    ├── <div class="breadcrumbs h-group v-align-center">
                    │     └── <div class="crumb">
                    │     │     └── <span class="name"> French </span>
                    │     └── <div class="crumb">
                    │     │     └── <span class="name"> Vocabulary </span>
                    │     └── <div class="crumb is-active">
                    │           └── <span class="name"> Basic Vocabulary </span>
                    │
                    └── <div class="dashboard-page ng-scope scrollable">
                          └── (task grid with Tailwind cards)
                                └── <button class="flex gap-2 ...">
                                      └── (task card with icon, name, progress)
```

### 4.2 Key Selectors (Course Browser)

| Purpose | Selector |
|---|---|
| Content browser | `.content-browser` |
| Browse container | `.browse-container` |
| Breadcrumbs | `.breadcrumbs` |
| Breadcrumb item | `.crumb` |
| Active breadcrumb | `.crumb.is-active` |
| Dashboard page | `.dashboard-page` |
| Task cards | `.flex.gap-2` buttons (Tailwind) |
| Class items (sidebar) | `.flex.items-center.justify-start.h-14` (collection of sidebar navigation items) |

### 4.3 Tailwind-based Task Cards

The task cards use Tailwind utility classes, not the old AngularJS pattern:
```html
<button class="flex gap-2 text-neutral-1000 focusable active:bg-neutral-200
               hover:bg-neutral-100 py-2 text-sm font-medium cursor-pointer
               items-center justify-between rounded border border-b-[3px]
               border-neutral-600 bg-white px-3 outline-none transition
               ease-in-out hover:shadow-lg">
```

---

## 5. Key Selectors for Scripting

### 5.1 Question Detection

```js
// The current question word
document.getElementById('question-text');

// Junk filters (words that are not real questions)
const JUNK = /^(replay|hint|submit|electronic|voice|translate|from|to|
               french|english|writing|reading|listening|dictation|speaking|
               practise|pronunciation|master|advanced|unit|vocab|list|\d+%?)$/i;
```

### 5.2 Answer Input

```js
// The answer text field
document.querySelector('#answer-text');

// The active editable element (could be input, textarea, or contenteditable)
document.activeElement;
```

### 5.3 Vocabulary Pairs

```js
// Target language words (e.g. French)
document.querySelectorAll('.targetLanguage.question-label');

// Base language words (e.g. English)
document.querySelectorAll('.baseLanguage.question-label');
```

### 5.4 Start / Continue Buttons

```js
// List-starter main start button
document.getElementById('start-button-main');

// Activity-starter start button  
document.getElementById('start-button-school');

// Preview header start button (alternative)
document.getElementById('preview-header-start-button');

// In-game continue button
document.getElementById('continue-button');
```

### 5.5 Navigation / Advance

```js
// Next question button (EP paper-mode)
document.querySelector('.next-question-button:not([disabled])');

// Generic next question
document.querySelector('#next-question:not([disabled])');

// SA navigation controls (game bar)
document.querySelector('#sa-navigation-controls');
document.querySelector('.sa-navigation-controls');

// Information controls (the "i" button that acts as continue)
document.querySelector('.information-controls');
```

### 5.6 Wrong-Answer Dismissal

```js
// Try-again button (classic action bar)
document.querySelector('.action-bar-button.try-again button:not([disabled])');

// Game action bar try-again
document.querySelector('.game-action-bar .action-bar-button.try-again button:not([disabled])');

// Any feedback button
document.querySelector('.feedback-button:not([disabled])');
```

### 5.7 Correct-Answer Detection

```js
// Correct popup (shows "Correct!" + score)
document.querySelector('#correct-popup');
document.querySelector('.correct-popup');

// Correct button
document.querySelector('#correct-button, .correct-button');

// Cheer button (post-correct animation)
document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
```

### 5.8 History Bar (Verdict Signals)

```js
// Incorrect history item
document.querySelector('.history-item.incorrect');

// Correct history item
document.querySelector('.history-item.correct');

// Current history item
document.querySelector('.history-item.current');
```

### 5.9 List / Task Navigation

```js
// Task items in the list-starter sidebar
document.querySelectorAll('#left-controls-panel .grouped-options > li.item');

// Full list switcher
document.getElementById('full-list-switcher');

// Preview grid scroll area
document.querySelector('#slim-scroll-content .preview-grid');

// Breadcrumb navigation (course browser)
document.querySelector('.breadcrumbs .crumb');
```

### 5.10 Game Action Bar

```js
// The action bar container
document.querySelector('.game-action-bar');

// The action bar when it has the 'information' class (question answered)
document.querySelector('.game-action-bar.sa-action-bar');

// Try-again specific action bar
document.querySelector('.action-bar-button.try-arrow');
```

---

## 6. AngularJS Scopes & Controllers

### 6.1 List-Starter Controller

The `#list-starter` div is an AngularJS scope with controller alias `starter`:

| Scope property | Type | Description |
|---|---|---|
| `starter.questions` | Array | The list of word pairs |
| `starter.selectedQuestion` | Object | Currently selected question |
| `starter.availableModes` | Array | Available learning modes (Learn, Spell, Test, etc.) |
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

### 6.2 Game Page Controller

The game page uses controller alias `self` or `game`:

| Scope property | Type | Description |
|---|---|---|
| `self.model` | Object | Game model |
| `self.model.gameMode` | Number | 1 = classic, 2 = ... |
| `self.model.minimalUI` | Boolean | Minimal UI mode |
| `self.model.hideActionUI` | Boolean | Hide action UI |
| `self.model.sketchPadShown` | Boolean | Sketch pad state |
| `self.model.lpAnswerEntered` | Boolean | Answer entered |
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
| `self.continueButtonDisabled` | Boolean | Continue button disabled state |
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
| `self.arrowController` | Object | Arrow/number mode controller |
| `self.displayedAnswers` | Array | Currently displayed answers |
| `self.selectedClassicTestMode` | Number | Selected test mode |

---

## 7. Navigation Flow

### 7.1 Typical User Flow

```
1. User lands on course browser (file 3)
   └── URL: /app/French/1373/187197/browse
   └── Clicks a lesson → navigates to list-starter

2. List-starter page (file 1)
   └── URL: /app/French/1373/187197/list-starter
   └── Shows word pairs in preview grid
   └── User selects mode + number of questions
   └── Clicks "Start" → navigates to game

3. Game page (file 2)
   └── URL: /app/French/1373/187197/game?mode=1
   └── Shows question, answer input, action bar
   └── After answering: correct-popup or try-again
   └── Clicks Continue/Next → next question or back to list-starter

4. After list completes
   └── Returns to list-starter (file 1)
   └── Shows updated stats in preview grid
   └── User can start a different mode or go to course browser
```

### 7.2 Route Detection for Scripting

```js
const url = window.location.href.toLowerCase();

const isListStarter = url.includes('list-starter');
const isActivityStarter = url.includes('activity-starter');
const isGame = url.includes('game');
const isBrowse = url.includes('browse');

// Combined checks
const isTaskPage = isListStarter || isActivityStarter || isGame;
const isVocabPage = isListStarter;  // vocab loading only on list-starter
```

---

## 8. Appendix: Full Class & ID Reference

### 8.1 All Unique IDs Across All Three Files

| ID | File | Element |
|---|---|---|
| `list-starter` | 1, 3 | Root list-starter div |
| `left-controls-panel` | 1, 3 | Left panel with mode selector + start button |
| `right-list-preview-panel` | 1, 3 | Right panel with word grid |
| `stats-parent` | 1, 3 | Flex container for both panels |
| `start-container` | 1, 3 | Start button wrapper |
| `start-button-main` | 1, 3 | Primary start button |
| `start-button-main-content` | 1, 3 | Start button inner content |
| `start-button-main-icon` | 1, 3 | Start button icon |
| `start-button-main-label` | 1, 3 | Start button label text |
| `preview-header-start-button` | 1, 3 | Alternative start button in preview header |
| `preview-grid-container` | 1, 3 | Word grid scroll container |
| `preview-grid-header` | 1, 3 | Grid header with labels |
| `preview-footer` | 1, 3 | Grid footer with edit/delete |
| `list-preview-panel-header` | 1, 3 | Preview panel header |
| `list-progress-group` | 1, 3 | Progress bar group |
| `section-controls-group` | 1, 3 | Section browse controls |
| `section-browse-dropdown-button` | 1, 3 | Browse dropdown |
| `test-mode-options` | 1, 3 | Mode options list |
| `number-of-questions-selector` | 1, 3 | Question count selector |
| `slim-scroll-content` | 1, 3 | Scrollable content area |
| `game-page-container` | 2 | Game page root |
| `game-page-main` | 2 | Main game content area |
| `game-question-content` | 2 | Question content area |
| `question-group` | 2 | Question wrapper |
| `question-action-bar` | 2 | Question action bar (refresh, hint) |
| `question-block` | 2 | Question text block |
| `question-text` | 2 | The question word |
| `answer-block` | 2 | Answer input area |
| `correct-popup` | 2 | Correct answer popup |
| `action-bar` | 2 | Game action bar |
| `continue-button` | 2 | Continue/Next button |
| `feedback-button` | 2 | Feedback button |
| `sound-button` | 2 | Sound toggle |
| `exit-button` | 2 | Exit button |
| `refresh-button` | 2 | Refresh/replay |
| `hint-button` | 2 | Hint button |
| `react-aria-*` | 1, 2, 3 | React Aria internal IDs (dynamic) |
| `single-spa-application:*` | 1, 2, 3 | Micro-frontend mount points |

### 8.2 Key CSS Classes (AngularJS Era)

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
| `.game-action-bar` | Bottom action bar in game |
| `.classic-action-bar` | Classic mode action bar |
| `.classic-action-bar-content` | Inner content of classic action bar |
| `.action-bar-button` | Button inside action bar |
| `.action-bar-button.try-again` | Try-again button (wrong answer) |
| `.action-bar-button.arrow` | Arrow-styled button |
| `.game-page` | Game page container |
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

### 8.3 Key CSS Classes (Tailwind Era — File 3)

| Class | Purpose |
|---|---|
| `.content-browser` | Course/content browser |
| `.browse-container` | Browse layout container |
| `.breadcrumbs` | Breadcrumb navigation |
| `.crumb` | Individual breadcrumb |
| `.crumb.is-active` | Active breadcrumb |
| `.dashboard-page` | Dashboard/task grid |
| `.flex` | Display flex |
| `.flex-col` | Flex column |
| `.items-center` | Align items center |
| `.justify-center` | Justify content center |
| `.justify-start` | Justify content start |
| `.gap-2` | Gap 8px |
| `.gap-4` | Gap 16px |
| `.focusable` | Focusable element with outline |
| `.bg-neutral-*` | Neutral background shades |
| `.border-neutral-*` | Neutral border shades |
| `.text-neutral-*` | Neutral text shades |
| `.font-medium` | Font weight 500 |
| `.font-semibold` | Font weight 600 |
| `.font-bold` | Font weight 700 |
| `.rounded` | Border radius |
| `.rounded-sm` | Small border radius |
| `.transition` | Transition effects |
| `.ease-in-out` | Easing function |
| `.w-full` | Width 100% |
| `.h-full` | Height 100% |
| `.aspect-square` | Aspect ratio 1:1 |
| `.cursor-pointer` | Pointer cursor |
| `.[disabled]` | Disabled state |
| `.hover:bg-*` | Hover state background |
| `.active:bg-*` | Active/pressed state background |
| `.mfeLearnerExperience` | Root micro-frontend |
| `.mfeGlobalNavigation` | Global navigation (sidebar) |
| `.mfeAppShell-*` | App shell layout |

---

> **Last updated:** August 4, 2026
> **Source files:** `Implement/EP (8_4_2026 3：48：05 PM).html`, `Implement/(5) EP (8_4_2026 3：48：24 PM).html`, `Implement/(5) EP (8_4_2026 3：53：53 PM).html`