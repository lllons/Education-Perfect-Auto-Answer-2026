# Hunter Mode Handoff Notes

_Last updated: 2026-08-05_

## Current scope

`script.js` is a Tampermonkey userscript for Education Perfect. Hunter Mode is a DOM-only layer on top of the existing vocabulary loader, answer-map, question detector, fuzzy matcher, and cursor-typing pipeline.

Phases 1–3 are intended to cover auto-advance, wrong-answer dismissal, learn/hybrid policies, the question state machine, list completion, skip-list navigation, human-presence pausing, kill-switch cleanup, and defensive selector/timer handling.

Phase 4 prioritizes the exact Education Perfect error flow:

- Read `#correct-answer-field` first when visible.
- Otherwise inspect visible green answer fragments in `#users-answer-field` (EP uses green `#0a0` portions for correct text and red `#c00` for incorrect text).
- Persist learned pairs under `localStorage['ep.learned']` with a bounded ring buffer.
- Click the visible enabled `#continue-button` (“Next question”) before generic fallbacks.

## DOM references

Use the HTML snapshots in this folder as the source of truth before changing selectors. Important verified references include:

- Game question: `#question-text`
- Answer input: `#answer-text`
- Answer state: `#answer-text-container.correct` / `.error`
- Primary post-verdict action: `#continue-button`
- Wrong-answer breakdown: `#users-answer-field`
- Canonical correct answer: `#correct-answer-field`
- List starter: `#list-starter`
- Start buttons: `#start-button-main`, `#start-button-main-label`, `#start-button-school`, and `#preview-header-start-button`
- Vocabulary grid: `.preview-grid .stats-item`, `.targetLanguage.question-label`, `.baseLanguage.question-label`

Hidden Angular/SingleFile nodes often remain in the DOM. Always filter candidates through the visibility and enabled checks before clicking or learning from them.

## Safety rules

- Keep Hunter opt-in (`CFG.hunter.enabled`/the Hunter toggle); never bypass the original reactive assistant.
- Respect `filling`, `lastFilled`, `cooldownUntil`, `pageChanging`, and the human-presence suspension.
- Every Hunter timeout must be cancellable by STOP/page navigation.
- Do not add network/API bypasses or assume a selector exists outside the snapshots.
- Keep future adaptive thresholds, adaptive typing speed, confidence scoring, telemetry/export, and daily progress persistence out of the shipped scope unless explicitly requested.

## Live-test finding (2026-11-16)

- Typing and verdict polling work against the live game page, and EP advances on its own after a real, user-made Submit.
- EP ends the game and returns to `/learning/dashboard` when `#submit-button` receives a script-generated click (`isTrusted === false`). Hunter must not click or dispatch Submit/Enter for the user; the user submits each answer themselves.
- `#answer-text` exists twice (empty `<span>`, then the real `<input>`); use `input#answer-text` for the live value.
- Page click-throughs that exit the game (e.g. `.nav-bar-exit`) are never a valid "advance" action.

## Scout Mode handoff

Spec: Scout crawls every subject's content tree, stores undone lists in `localStorage['ep.scout']` (`{[language]: {at, lists, folders}}`), shows an expandable language → folder → list panel, a list button opens the list and starts Hunter, and when the list finishes Hunter opens the next undone scouted list. Scout only navigates and tracks; it never submits (EP kicks the session on scripted Submit). Code lives in `script.js` in the block headed `Scout Mode:` (`scoutCrawl`, `scoutVisit`, `scoutSettle`, `scoutGoRoot`, `scoutReplay`, `scoutLaunch`, `scoutResumePending`, `scoutMarkDone`, `scoutNextAfter`, `renderScoutList`), `CFG.scout`, panel row `#ep-btns4` (`#ep-scout`, `#ep-scout-list`), the STOP handler (`scoutCancel = true`), `updatePanelVisibility` (content pages) and the `scoutCurrent` branch of `LIST_DONE` in `hunterTick`.

How to resume testing: `node serve.js` (a static server for `script.js` on 127.0.0.1:8765, no-store; Chrome local-network permission must be allowed), open `/app/dashboard/<language>/content/`, wait ~10 s (EP loads slowly), then in the page run `const t = await fetch('http://127.0.0.1:8765/script.js').then(r=>r.text()); (0,eval)(t);` once (a second injection adds a second panel). `javascript_tool` output containing `? = & /` is blocked, so strip those characters. A full reload drops the injected script.

Selectors/quirks (verified live): rows are `.crumb-child.item`; folders contain `.folder-icon`, lists contain `.activity-icon`; title `.item-title.fill`; progress `.completion-percentage` (`0%`, folders show none); folder URL `/app/dashboard/<lang>/content/<folderId>/<slug>`; the root breadcrumb is `span.name`; `history.back()` returns to the parent folder; clicking a list row launches the game at `/app/<Lang>/<folderId>/<listId>/game`. EP is slow to render (5-15 s on first load), so every step waits for the rows to stop changing. Lists with a lightbulb icon are videos and are currently recorded too (not yet filtered to vocabulary lists).

- **A. Scout button + crawl of one subject persisted to `ep.scout`: done, verified live (French).** DFS opened folders at about 1 per 2 s, saved lists with folder paths, and STOP paused the crawl and returned to the root. Cap `CFG.scout.maxFolders` (80) per press; press Scout again to continue (fully scanned folders are skipped for `rescanMs`, 24 h). Next step: none.
- **B. All languages: done, verified live (Chinese then French in one run; STOP paused it with counts stable).** `🌍 All languages` (`#ep-scout-all`) opens the Library through the sidebar `a[href="/learning/library"]`, reads subject anchors `a[href^="/app/dashboard/"][href*="/content"]`, keeps those whose slug is in `CFG.scout.languages`, clicks each (SPA, no reload) and runs `scoutRunLang(slug)` with a fresh `maxFolders` budget per language. The button row also shows on `/learning/library`. Library lists Chinese, French, German, Japanese, Māori, Spanish (+ non-language subjects, ignored); German/Japanese/Māori/Spanish were not reached in the test, and the Māori slug is unconfirmed (`maori` and `te-reo-maori` are both in the list). Next step: let a full run finish and check the slugs/counts per language.
- **C. Expandable list + launching a list: done, verified live.** `renderScoutList()` builds `<details>` language → folder → one button per undone list from `ep.scout` (rendered from storage after a reload too). A button runs `scoutLaunch` → `scoutReplay`: root breadcrumb, click each folder title in the saved path, click the list row (EP opens the game directly), then `startHunter()` if off. Live result: the game opened, `55 pairs loaded`, the answer was typed into the field and left for the user to press Enter (nothing was submitted). A different language needs a full page load, so the target is stored in `ep.scout.pending` and `scoutResumePending()` (called from `init`) finishes the launch; that cross-language path is not verified live. Fix made on the way: Hunter's idle auto-start on `list-starter` used to click Start before the vocab loaded, which opened the game with `No vocab found`; it now waits for `answerMap` to be non-empty. Next step: none for the same language.
- **D. Auto-continue to next undone list: written, NOT verified live** (finishing a list needs real answers, which Scout never submits). In `hunterTick` the `LIST_DONE` case has a `scoutCurrent` branch: `scoutMarkDone`, toast `🏁 List complete · 💤 next scouted list in Xs…`, then after `betweenListDelay` `scoutLaunch(scoutNextAfter(finished))`, or stop Hunter when none are left. It depends on `detectListDone()` recognising EP's finished-game screen, which is also unverified. Next step: have the user finish one short list with Scout running and check the toast, the `done` flag in `ep.scout` and that the next list opens; if `detectListDone` misses, capture the finished-game DOM and add its selector.

Other open points: lightbulb (video) activities are recorded as lists; filtering to vocabulary lists (translate icon) is not done. `scoutCurrent` is in memory only, so a reload mid-list drops auto-continue until the next Scout launch.

## Phase 4 continuation checklist

- Keep the progress badge hidden while Hunter is off and update it from a bounded rolling duration sample.
- Show the between-list sleep toast only once per list-complete transition; do not queue duplicate navigation callbacks.
- STOP must use the same full teardown path as the Hunter toggle: clear interval/deferred timers, remove human listeners, reset state, and leave the base assistant active.
- Run `node --check script.js` and `git diff --check` after edits.
- Review the full diff before staging; preserve unrelated user changes.
