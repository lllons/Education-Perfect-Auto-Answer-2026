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

## Phase 4 continuation checklist

- Keep the progress badge hidden while Hunter is off and update it from a bounded rolling duration sample.
- Show the between-list sleep toast only once per list-complete transition; do not queue duplicate navigation callbacks.
- STOP must use the same full teardown path as the Hunter toggle: clear interval/deferred timers, remove human listeners, reset state, and leave the base assistant active.
- Run `node --check script.js` and `git diff --check` after edits.
- Review the full diff before staging; preserve unrelated user changes.
