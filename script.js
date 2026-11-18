// ==UserScript==
// @name         🎓 Education Perfect - Auto Answer (2026) 🎓
// @namespace    https://educationperfect.com
// @version      4.0.093
// @description  Auto-fills answers on Education Perfect. (Working 2026)
// @author       lllons and Otjl12
// @match        https://app.educationperfect.com/*
// @match        https://*.educationperfect.com/*
// @icon         https://raw.githubusercontent.com/lllons/Education-Perfect-Auto-Answer-2026/main/R.png
// @grant        none
// @run-at       document-idle
// @license      MIT
// @compatible   chrome
// @compatible   firefox
// @compatible   edge
// @compatible   brave
// @compatible   opera
// @compatible   safari
// ==/UserScript==

(function () {
  'use strict';

  const debug = true;
  const hints = true;

  const hintsList = {
    list: "Auto-types at your cursors selected location. Press Enter to submit.",
    activity: "Auto-selects or type the correct answer using AI.",
  };

  // ── Hunter Mode Config (Phase 2 + Phase 3 + Phase 4 + Phase 5) ──────────────
  // Per-flag notes:
  //   enabled            master toggle; default OFF (user must opt in)
  //   advanceDelay       ms after verdict before clicking Next
  //   betweenListDelay   ms pause between finishing one list and starting the next
  //   errorPolicy        'dismiss' | 'learn' | 'hybrid' (default; auto-fallback)
  //   autoStart          auto-click #start-button-main / #start-button-school on idle
  //   autoContinueLists  when a list finishes, hunt straight into the next
  //                         undone list (default ON; scouted lists first, else
  //                         the sibling-list walk). Only counts once questions
  //                         of the current list were actually seen.
  //   maxQuestionsPerRun soft cap on questions before auto-stopping Hunter (0 = ∞)
  //   humanPresenceWindow  ms of real-user activity that pauses Hunter before
  //                         resuming automatically
  // ── Phase 3 knobs ──
  //   maxAdvanceAttempts   how many "advance click failed" cycles before Hunter
  //                         gives up and assumes the list/page is done.
  //   stuckStateMs         if the Hunter state hasn't transitioned out of the
  //                         current node in this many ms, force-reset to IDLE.
  //   safeMinDelayMs       lower bound for any setTimeout inside the tick loop
  //                         (so misconfigurations can't fire clicks during
  //                         EP's animation frames).
  //   safeMaxDelayMs       upper bound for any setTimeout (sanity).
  //   watchdogMs           if no state change for this many ms, force-reset.
  // ── Phase 5 navigation ──
  //   modeDirection        'auto' preserves the current Writing direction;
  //                        explicit values select English↔French.
  const CFG = {
    fuzzyThreshold : 10,
    typeDelay      : 0,
    toastDuration  : 5000,
    pollInterval   : 0,
    cooldown       : 0.5,
    typeCooldown   : 0.1,
    hunter: {
      enabled            : false,
      advanceDelay       : 600,
      betweenListDelay   : 1500,
      errorPolicy        : 'hybrid',
      autoStart          : true,
      autoContinueLists  : true,
      // 'auto' preserves the current Writing direction; explicit values are
      // 'english-to-french' or 'french-to-english'.
      modeDirection      : 'auto',
      maxQuestionsPerRun : 0,
      humanPresenceWindow: 1500,
      // ms to wait after each navigation click, and how many navigation steps
      // to try before giving up.
      navigationSettleMs : 1200,
      maxNavigationAttempts: 120,
      // Start gate: Start is only clicked once the vocab grid was read. After
      // startRetriggerMs without vocab the loader is triggered again; after
      // startWaitMs a "vocab did not load" toast is shown (still no Start).
      startRetriggerMs   : 4000,
      startWaitMs        : 20000,
      // Mode check on a starter: the per-mode progress must read the same for
      // modeSettleMs before it decides; a mode that was run maxModeRuns times
      // without reaching 100% is given up on (no endless repeat).
      modeSettleMs       : 1500,
      maxModeRuns        : 3,
      // ── Phase 3 additions ──
      maxAdvanceAttempts : 5,
      stuckStateMs       : 30000,
      safeMinDelayMs     : 80,
      safeMaxDelayMs     : 5000,
      watchdogMs         : 120000,
      // ── Phase 4 additions ──
      // Progress is discovered from the real #preview-grid/.stats-item DOM;
      // no hard-coded list length is assumed.
    },
    // Scout Mode: renderTimeoutMs = max wait for a folder to render,
    // maxFolders = folders opened per Scout press (press again to continue),
    // rescanMs = a fully scanned folder is skipped for this long.
    scout: {
      // Library subjects treated as languages by "All languages". Slugs that the
      // Library does not list are ignored, so extra names are harmless.
      languages       : ['afrikaans', 'albanian', 'amharic', 'arabic', 'australian-languages', 'azerbaijani',
                         'bosnian', 'bulgarian', 'cantonese', 'chin-hakha', 'chinese', 'cook-islands-maori',
                         'croatian', 'dari', 'dinka', 'dutch', 'esperanto', 'fijian', 'filipino', 'finnish',
                         'french', 'german', 'greek', 'hebrew', 'hindi', 'hungarian', 'indonesian', 'irish',
                         'italian', 'japanese', 'kannada', 'karen', 'khmer', 'korean', 'latin', 'macedonian',
                         'malay', 'malayalam', 'maltese', 'maori', 'mizo', 'mongolian', 'myanmar-language',
                         'papiamento', 'pashto', 'persian', 'polish', 'portuguese', 'punjabi', 'romanian',
                         'russian', 'samoan', 'serbian', 'sign-language', 'sinhala', 'slovene', 'spanish',
                         'swahili', 'swedish', 'syriac', 'tamil', 'telugu', 'thai', 'tongan', 'turkish',
                         'ukrainian', 'urdu', 'vietnamese', 'welsh'],
      renderTimeoutMs : 12000,
      maxFolders      : 80,
      rescanMs        : 24 * 60 * 60 * 1000,
    },
  };

  const SEL = {
    targetLang        : '.targetLanguage.question-label',
    baseLang          : '.baseLanguage.question-label',
    answerInput       : '#answer-text',
    prompt            : '.prompt.ng-binding',
  };

  // Navigation selectors are intentionally based on the live EP structures
  // found in every Implement/*.html snapshot. Keep folders and activities
  // separate: both can contain `.item-title.fill`, but only folders contain
  // `.folder-icon`.
  const NAV_SEL = {
    folderItems       : '.crumb-child.item',
    listTitles        : '.item-title.fill',
    modeItems         : 'li.item',
    continueButton    : '#continue-button',
    startButtons       : ['#start-button-main', '#preview-header-start-button', '#start-button-school'],
  };

  // ── Module-level constants ────────────────────────────────────────────────
  const LEARNED_KEY   = 'ep.learned';   // localStorage key for learned pairs
  const LEARNED_CAP   = 500;            // ring-buffer cap on learned pairs

  // ── Pipeline state ────────────────────────────────────────────────────────
  let answerMap     = {};
  let enabled       = true;
  let lastFilled    = '';
  let filling       = false;            // set true while typeAtCursor() is running
  let cooldownUntil = 0;
  let observer      = null;
  let pollTimer     = null;
  let activeEditable = null;
  let pageChanging  = false;
  let lastTypeTime  = 0;
  let auto          = true;
  let panelUnlocked = false;
  let vocabUnlocked = false;
  let vocabFromGrid = false;   // answerMap was read from the list's vocab grid (learned pairs alone don't count)
  let aiUnlocked    = false;

  // ─── Phase 3: Universal DOM helpers ───────────────────────────────────────
  //  These are deliberately conservative. Every check below protects against
  //  a class of failure observed on real Education Perfect snapshots:
  //   - elements can be in the DOM tree but invisible (opacity:0,
  //     visibility:hidden, display:none, ng-hide, sf-hidden, zero-size)
  //   - buttons can be disabled in three ways simultaneously
  //     (HTML disabled, ng-disabled="x", aria-disabled="true")
  //   - elements can disappear between queries and clicks (SP navigation,
  //     CSS animations, v-if removal)
  //   - selectors can match more than one element (we always pick the FIRST
  //     or the LAST truly-visible one)
  //  Rule: never click anything that isVisible() / isEnabled() rejects.
  // ──────────────────────────────────────────────────────────────────────────

  /** Returns true only when el is connected AND has a non-zero bounding box
   *  AND does not carry any of EP's "hidden" markers. */
  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!el.isConnected) return false;
    // offsetParent === null catches display:none + detached nodes.
    // BUT — position:fixed elements also have null offsetParent, so we
    // additionally check getBoundingClientRect().
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    // EP-specific: ng-hide / sf-hidden classes that EP injects when an
    // element should be visually gone but isn't removed from the DOM.
    if (el.classList.contains('ng-hide') || el.classList.contains('sf-hidden')) return false;
    if (el.closest && (el.closest('.ng-hide') || el.closest('.sf-hidden') ||
                        el.closest('[hidden]'))) return false;
    return true;
  }

  /** True when a <button>-ish element is enabled from all three angles. */
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const ngDisabled = el.getAttribute && el.getAttribute('ng-disabled');
    if (ngDisabled === 'true' || ngDisabled === true) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    // EP reads disabled state through JS too; the [disabled] attribute is
    // a normal HTML attribute, but ng-disabled is a string expression.
    return true;
  }

  /** Like document.querySelector but only returns the first isVisible match.
   *  Returns null if nothing is visible. */
  function queryVisible(selector, root) {
    const list = (root || document).querySelectorAll(selector);
    for (const el of list) {
      if (isVisible(el)) return el;
    }
    return null;
  }

  /** Like Array.from(querySelectorAll(...)).filter(isVisible). */
  function queryAllVisible(selector, root) {
    return Array.from((root || document).querySelectorAll(selector))
                .filter(isVisible);
  }

  /** Safe click — only fires if visible AND enabled. Returns true on click. */
  function safeClick(el) {
    if (!isVisible(el) || !isEnabled(el)) return false;
    try {
      // Scroll into view so EP's click handler has a real target and so the
      // offscreen-but-not-display:none case is handled.
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return true;
    } catch (e) {
      console.warn('[Hunter] safeClick threw:', e);
      return false;
    }
  }

  /** Clamp a numeric duration to a safe range so a misconfigured CFG can't
   *  freeze the page or race EP's animations. */
  function clampMs(ms, lo, hi) {
    ms = Number(ms);
    if (!isFinite(ms) || isNaN(ms)) return lo;
    if (ms < lo) return lo;
    if (ms > hi) return hi;
    return ms;
  }

  // PURE-LOGIC-BEGIN (no DOM / storage access; unit-tested in Node)
  /** Stage that follows `stage`: Reading → Writing; null = both modes done. */
  function nextStage(stage) { return stage === 'reading' ? 'writing' : null; }

  /** Start gate on a list-starter: 'ready' once the vocab was read from the
   *  grid, else 'wait' (or 'timeout' after `timeoutMs`; still no Start). */
  function startGate(onStarter, vocabReady, waitedMs, timeoutMs) {
    if (!onStarter) return 'wait';
    if (vocabReady) return 'ready';
    return waitedMs > timeoutMs ? 'timeout' : 'wait';
  }

  /** Key of the next undone list after `key` in scan order (wraps), or null.
   *  `isUsable` filters lists that may be hunted (vocab kind, not skipped). */
  function pickNextKey(lists, key, isUsable) {
    const keys = Object.keys(lists), i = keys.indexOf(key);
    const rest = keys.slice(i + 1).concat(keys.slice(0, Math.max(i, 0)));
    return rest.find(k => !lists[k].done && isUsable(lists[k]) && k !== key) || null;
  }

  /** What is left to run on a list, from the starter's per-mode progress.
   *  Each status is 'learnt' | 'open' | 'unknown' (item without a readable
   *  percentage) | 'absent' (no such mode item). Returns 'reading' | 'writing',
   *  null = both learnt (list complete), undefined = cannot tell (no item at all
   *  or unreadable progress → caller falls back to the stage order). */
  function remainingMode(reading, writing) {
    if (reading === 'unknown' || writing === 'unknown') return undefined;
    if (reading === 'absent' && writing === 'absent') return undefined;
    if (reading === 'open') return 'reading';
    if (writing === 'open') return 'writing';
    return null;
  }
  // PURE-LOGIC-END

  /** waitFor: polls the selector until visible or timeout. Resolves with
   *  the element or null. Caller decides what to do with null. */
  function waitFor(selector, timeoutMs, intervalMs) {
    timeoutMs  = clampMs(timeoutMs,  50,  15000);
    intervalMs = clampMs(intervalMs, 25,   1000);
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const el = queryVisible(selector);
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  /** Returns true when a modal / overlay is currently shown. Treats
   *  `.modal.in`, `.modal.fade.in`, and `.ng-hide` absence. */
  function isModalShown(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!isVisible(el)) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  // ── Hunter Mode runtime state ─────────────────────────────────────────────
  // 6-state machine:
  //   IDLE          : waiting for a new question to appear
  //   DETECTED      : question visible, but tryFill hasn't started yet
  //   TYPING        : tryFill() is in progress (filling === true)
  //   AWAIT_VERDICT : answer submitted, polling EP DOM for correct/incorrect verdict
  //   ADVANCE       : verdict seen, clicking "Next question" / dismissing overlay
  //   LIST_DONE     : end-of-list reached (or no more next-list items)
  let hunterEnabled            = false;
  let hunterTimer              = null;
  let hunterDelayedTimers      = [];   // setTimeout handles inside Hunter — all cleared on stop
  let hunterState              = 'IDLE';
  let hunterPrevState          = 'IDLE';
  let hunterStateEntryMs       = 0;    // wall-clock at last state change (for watchdog)
  let hunterQuestion           = '';
  let hunterAdvancing          = false;
  let hunterScore              = { correct: 0, incorrect: 0 };
  let hunterStartTime          = 0;
  let hunterNoAdvance           = 0;
  let hunterQuestionStart      = 0;
  // Phase 4 timing/progress state. Keep these declarations together so a
  // partially applied patch can never turn them into strict-mode assignments.
  let hunterQuestionStartMs    = 0;
  let hunterQuestionTimes      = [];
  let hunterEtaTimer           = null;
  let hunterBadgeEl            = null;
  let hunterAdvanceReadyAt     = 0;
  let hunterListSleepScheduled = false;
  let hunterListPlayed         = false;   // a question of the current list was seen
  let hunterListStage          = 'reading'; // 'reading' → 'writing' → list complete (see nextStage)
  let hunterStartWaitSince     = 0;       // start gate: when waiting for the vocab began
  let hunterStartRetriggered   = false;   // start gate: loader re-triggered once
  let hunterStartTimedOut      = false;   // start gate: timeout toast shown once
  let hunterModeTries          = 0;       // start gate: mode-item clicks for this start
  let hunterModeRuns           = { reading: 0, writing: 0 };  // finished runs of this list, per mode
  let hunterDecisionKey        = '';      // mode check: last reading of the starter's per-mode progress
  let hunterDecisionSince      = 0;       // mode check: since when it read the same
  let hunterSyntheticInput     = false;
  let hunterTypingTransitionScheduled = false;
  let hunterVerdictHandledKey  = '';
  let hunterProgressTotal      = 0;
  let hunterCurrentListTitle   = '';
  let hunterLastDirection      = 'auto';
  let hunterNavigationPending  = false;
  let hunterNavigationStage    = 'idle'; // idle → folder → find → start
  let hunterNavigationTarget   = '';
  let hunterNavigationAttempts = 0;
  let hunterNavigationReadyAt  = 0;
  let hunterVisitedLists     = new Set();
  let hunterVisitedFolders    = new Set();

  // Phase 2: human-presence detector
  let hunterHumanActive      = false;
  let hunterHumanSuspended   = false;
  let hunterHumanTimer       = null;

  // Phase 2: learn-from-error + cap
  let    hunterQuestionsAnswered = 0;
  CFG.hunter.enabled = true;

  /** Clear list-navigation state. Called on every Hunter start / stop / STOP. */
  function resetHunterNavigation() {
    hunterNavigationPending  = false;
    hunterNavigationStage    = 'idle';
    hunterNavigationTarget   = '';
    hunterNavigationAttempts = 0;
    hunterVisitedLists       = new Set();
    hunterVisitedFolders     = new Set();
    hunterCurrentListTitle   = '';
    hunterLastDirection      = 'auto';
    hunterListSleepScheduled = false;
    hunterListPlayed         = false;
    hunterModeRuns           = { reading: 0, writing: 0 };
  }

  // ─── Phase 3: lifecycle / watcher plumbing ───────────────────────────────
  let hunterLastPageUrl      = '';   // detect SPA route changes
  let hunterLastActiveMs     = 0;    // last tick observed activity on the page

  // ── Page-change / unload guards ───────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    pageChanging = true;
    if (hunterEnabled) stopHunter();
  });
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
      activeEditable = el;
    }
  });

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ── Text helpers ──────────────────────────────────────────────────────────
  function stripAlts(s) {
    if (!s) return s;
    const idx = s.indexOf(';');
    return idx === -1 ? s : s.slice(0, idx).trim();
  }

  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      // Unicode letters/digits, not just a-z: non-Latin scripts (Chinese,
      // Japanese, Arabic…) otherwise normalise to '' and every pair is dropped.
      .replace(/[^\p{L}\p{N}\s+\-*/=]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) / Math.max(la, lb) > 0.55) return 0;
    const dp = Array.from({ length: la + 1 }, (_, i) => [i]);
    for (let j = 0; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++)
      for (let j = 1; j <= lb; j++)
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  function findAnswer(raw) {
    const q = norm(raw);
    if (!q) return null;
    if (answerMap[q]) return answerMap[q];
    for (const [k, v] of Object.entries(answerMap)) {
      if (k.includes(q) || q.includes(k)) return v;
    }
    let best = 0, bestVal = null;
    for (const [k, v] of Object.entries(answerMap)) {
      const sc = similarity(q, k);
      if (sc >= CFG.fuzzyThreshold && sc > best) {
        best = sc;
        bestVal = v;
      }
    }
    return bestVal;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function fullList() {
    const full = document.getElementById("full-list-switcher");
    if (full) full.click();
    setTimeout(() => {
      document.querySelector('#slim-scroll-content .preview-grid')?.lastElementChild?.scrollIntoView({ block: 'end' });
      setTimeout(() => { loadAnswers(); }, 1000);
      document.getElementsByClassName("main-text ng-binding infinity")[0]?.click();
    }, 500);
  }

  function loadAnswers(attempt = 0) {
    document.querySelector('#slim-scroll-content .preview-grid')?.lastElementChild?.scrollIntoView({ block: 'end' });
    const map = {};
    let count = 0;
    const targets = [...document.querySelectorAll(SEL.targetLang)];
    const bases   = [...document.querySelectorAll(SEL.baseLang)];
    const len = Math.min(targets.length, bases.length);
    for (let i = 0; i < len; i++) {
      const rawTarget = (targets[i].textContent || '').trim();
      const rawBase   = (bases[i].textContent   || '').trim();
      const t = stripAlts(rawTarget);
      const b = stripAlts(rawBase);
      const normT = norm(t);
      const normB = norm(b);
      if (normT && normB) {
        if (!map[normT]) { map[normT] = b; count++; }
        if (!map[normB]) { map[normB] = t; count++; }
      }
    }
    // Slow subjects render the vocab grid late: retry instead of starting a
    // game the assistant has no answers for.
    if (count === 0 && attempt < 12 && window.location.href.toLowerCase().includes('list-starter')) {
      setTimeout(() => loadAnswers(attempt + 1), 1000);
      return 0;
    }
    answerMap = map;
    vocabFromGrid = count > 0;
    lastFilled = '';
    cooldownUntil = 0;
    updatePanel(count);
    showToast(count > 0 ? `✅ ${count} pairs loaded` : `⚠️ No vocab found`);
    console.log('[EP] Loaded', count, 'pairs');
    // With Hunter on, hunterStartWhenReady() picks the mode and clicks Start.
    if (count > 0 && !hunterEnabled) document.getElementById("start-button-main-label")?.click();
    return count;
  }

  function getQuestionWord() {
    const JUNK = /^(replay|hint|submit|electronic|voice|translate|from|to|french|english|writing|reading|listening|dictation|speaking|practise|pronunciation|master|advanced|unit|vocab|list|\d+%?)$/i;
    const span = document.getElementById("question-text");
    if (!span) return null;
    const text = (span.textContent || '').trim();
    console.log('[EP] Question text:', text);
    if (text.length >= 2 && text.length <= 80 && !JUNK.test(text)) return text;
    return null;
  }

  function setNativeValue(el, value) {
    const proto      = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  async function typeAtCursor(el, text) {
    if (!el) return;
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      let range = sel.getRangeAt(0);
      for (const ch of text) {
        range.deleteContents();
        const node = document.createTextNode(ch);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        if (CFG.typeDelay > 0) await sleep(CFG.typeDelay);
      }
      return;
    }
    for (const ch of text) {
      const start    = el.selectionStart ?? el.value.length;
      const end      = el.selectionEnd ?? start;
      const newValue = el.value.slice(0, start) + ch + el.value.slice(end);
      setNativeValue(el, newValue);
      el.setSelectionRange(start + 1, start + 1);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      if (CFG.typeDelay > 0) await sleep(CFG.typeDelay);
    }
  }

  async function tryFill() {
    if (!enabled || filling || pageChanging) return;
    if (Date.now() < cooldownUntil) return;
    if (Date.now() - lastTypeTime < CFG.typeCooldown) return;

    const input = activeEditable || document.activeElement || document.querySelector(SEL.answerInput);
    if (!input) return;
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      if ((input.value || '').trim().length > 0) return;
    }
    const word = getQuestionWord();
    if (!word) return;

    let answer = findAnswer(word);
    if (!answer) {
      cooldownUntil = Date.now() + CFG.cooldown;
      setDebug(`No match: "${word}"`);
      return;
    }
    answer = stripAlts(answer);

    const key = `${word}→${answer}`;
    if (key === lastFilled) return;
    lastFilled = key;

    filling      = true;
    lastTypeTime = Date.now();
    if (hunterEnabled && hunterState === 'DETECTED') hunterSetState('TYPING');
    setDebug(`Typing: "${word}" → "${answer}"`);
    console.log(`[EP] "${word}" → "${answer}"`);

    hunterSyntheticInput = true;
    try {
      await typeAtCursor(input, answer);
      showToast(`💡 ${answer.length > 48 ? answer.slice(0,48)+'…' : answer}`);
    } catch (e) {
      console.warn('[EP] Typing error:', e);
    } finally {
      hunterSyntheticInput = false;
      filling = false;
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => { tryFill(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { tryFill(); }, CFG.pollInterval);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //   Hunter Mode (Phase 2)
  // ──────────────────────────────────────────────────────────────────────────
  //
  //   Phase-2 deliverables:
  //     1. Phase-1 regression fixes (selector robustness, race-condition
  //        hardening, better flag handling, visible kill-switch STOP btn).
  //     2. Full 6-state question lifecycle:
  //        IDLE → DETECTED → TYPING → AWAIT_VERDICT → ADVANCE → LIST_DONE.
  //     3. Learn-from-error policy (errorPolicy: 'learn' | 'hybrid')
  //        — scrapes #correct-answer-field, persists the pair to
  //        localStorage.ep.learned with a 500-pair ring buffer.
  //     4. End-of-list detection + auto-continue.
  //     5. Human-presence detector: pauses Hunter when a real user is typing
  //        in the answer field; resumes after humanPresenceWindow ms.
  //
  //   NOT in Phase 2 (later phases):
  //     - Adaptive fuzzy threshold / typing speed
  //     - Confidence tracking
  //     - Telemetry / Export button
  // ══════════════════════════════════════════════════════════════════════════

  /** Returns true when a button is neither `disabled` nor `ng-disabled="true"`.
   *  EP is Angular so `ng-disabled` is just as real as the HTML `disabled`.
   */
  function isButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('ng-disabled') === 'true') return false;
    return true;
  }

  // ── Phase 2: scrape / learn / persist ─────────────────────────────────────

  /** Read EP's revealed correct answer from the wrong-answer modal.
   *  Phase 3 hardening:
   *   - Searches through several known field selectors (verified across
   *     Implement/*), checking isVisible + non-empty text in each.
   *   - Strips things like "Correct answer:" / leading colons / hint
   *     trailers so we don't poison the learned map.
   *   - Caps answer length at 200 chars so an accidental tooltip / banner
   *     grab can't pollute the answerMap.
   *   - Returns null cleanly so the caller can fall back to dismiss.
   *  Selectors verified in `Implement/(5) EP (8_4_2026 3：48：24 PM).html`.
   */
  /**
   * Read the CORRECT answer out of the error modal. This is the highest-
   * priority Learn path so it tries every signal in document order:
   *   1. `#correct-answer-field` (the canonical EP "correct answer" cell)
   *   2. The green spans inside `#users-answer-field` (the breakdown — the
   *      correct portion is colored #0a0; red (#c00) is wrong)
   *   3. `tr.correct` inside the modeless-answer-dialog
   *   4. `.correct-popup` fallback
   * Returns the cleaned answer or null.
   */
  function scrapeCorrectAnswer() {
    // 1. Prefer an explicit "Correct answer: …" label in the visible modal.
    //    This is stronger than any styled fragment because it is EP's direct
    //    answer reveal, not a rendering hint.
    const dialog = queryVisible('.modeless-answer-dialog');
    if (dialog) {
      const explicitNodes = Array.from(dialog.querySelectorAll('*'))
        .filter(el => /^\s*correct\s*answer\s*:/i.test(el.textContent || ''))
        // Prefer the smallest matching node, not a parent containing the
        // entire modal transcript.
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      for (const el of explicitNodes) {
        const match = (el.textContent || '').match(/^\s*correct\s*answer\s*:\s*(.+)$/i);
        const explicit = cleanScrapedAnswer(match ? match[1] : el.textContent);
        if (explicit) return explicit;
      }
    }

    // 2. Canonical EP field — verified in Implement/* (multiple files).
    const canonical = document.getElementById('correct-answer-field');
    // A stale/hidden Angular template can retain the field in the DOM. Never
    // learn from it unless it is the currently displayed feedback value.
    if (canonical && isVisible(canonical) && (canonical.textContent || '').trim()) {
      const t = cleanScrapedAnswer(canonical.textContent);
      if (t) return t;
    }

    // 3. Green-span reconstruction from #users-answer-field breakdown.
    //    Inside there:
    //      style="color:#0a0"           = part of the correct answer
    //      style="color:#c00"           = user got this part wrong
    //      style="color:rgba(0,0,0,.25)" = gray, partial correctness / hint
    //    We concatenate ONLY the green spans in DOM order — they're the
    //    parts the system knew were correct, regardless of what the user
    //    typed.
    const usersField = document.getElementById('users-answer-field');
    if (usersField && isVisible(usersField)) {
      const spans = Array.from(usersField.querySelectorAll('span'));
      const colorOf = span => {
        const style = (span.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
        let color = style.match(/color:([^;]+)/)?.[1] || '';
        if (!color && typeof getComputedStyle === 'function') color = getComputedStyle(span).color || '';
        return color.toLowerCase().replace(/\s+/g, '');
      };
      const isRed = color => /#c00|#cc0000|rgb\(204,0,0\)|rgb\(255,0,0\)|red/.test(color);
      const isGreen = color => /#0a0|#00aa00|rgb\(0,170,0\)|rgb\(0,128,0\)|green/.test(color);
      const greenPieces = spans.filter(span => isGreen(colorOf(span)));
      if (greenPieces.length > 0) {
        const merged = greenPieces.map(s => (s.textContent || '').trim()).filter(Boolean).join(' ').trim();
        const t = cleanScrapedAnswer(merged);
        if (t) return t;
      }
      // Do not use neutral/grey text as a fallback. The requested learn path
      // is intentionally conservative: green #0a0 fragments only, with red
      // and grey fragments ignored rather than guessed.
    }

    // No explicit answer and no green fragments means the modal is not safe
    // to learn from. The caller will still advance using its normal fallback.
    return null;
  }

  /** Pick the longest non-empty textContent from a NodeList. EP renders the
   *  answer in the LAST td of the correct-row, not the first. */
  function lastFieldText(nodes) {
    let best = null;
    for (const n of nodes) {
      const t = (n && n.textContent || '').trim();
      if (t && (!best || t.length > best.length)) best = t;
    }
    return best;
  }

  /** Strip the noise EP sometimes tacks onto the answer: "Correct answer: x",
   *  trailing hints in parentheses, leading quotes / colons. */
  function cleanScrapedAnswer(raw) {
    if (!raw) return null;
    let s = String(raw).trim().replace(/\s+/g, ' ');
    // Strip a "Correct answer:" prefix (any locale-friendly variant).
    s = s.replace(/^(correct\s*answer\s*[:\-]?\s*)/i, '');
    s = s.replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '');
    s = s.replace(/^[:\-ï¼š]\s*/, '');
    s = s.replace(/\s*\([^)]*(hint|exemple|example|note)[^)]*\)\s*$/i, '');
    s = s.trim();
    if (s.length < 1 || s.length > 200) return null;
    return s;
  }

  /** Read the question word from the wrong-answer modal so we can attribute
   *  the learned answer to the correct key. Phase 3: also falls back to the
   *  left-side label inside the modal before falling back to the live
   *  question span. */
  function scrapeQuestionFromModal() {
    const direct = document.getElementById('question-field');
    if (direct && (direct.textContent || '').trim()) {
      return cleanScrapedAnswer(direct.textContent);
    }
    const dialog = queryVisible('.modeless-answer-dialog');
    if (dialog) {
      const q = dialog.querySelector('#question-field, .question.native-font');
      if (q && (q.textContent || '').trim()) {
        return cleanScrapedAnswer(q.textContent);
      }
    }
    // Fallback to the live question span if the modal didn't render it.
    return getQuestionWord();
  }

  /** Apply learn-from-error: update answerMap + persist to localStorage.
   *  Uses a ring buffer (LEARNED_CAP) so storage can't grow unchecked.
   *  Returns the learned answer text, or null if nothing was learned.
   */
  function learnFromError() {
    const correctAnswer = scrapeCorrectAnswer();
    const modalQuestion = scrapeQuestionFromModal();
    const qSrc = modalQuestion || hunterQuestion;
    if (!correctAnswer || !qSrc) {
      // Nothing usable — return null so caller can fall back to dismiss.
      return null;
    }
    const q = norm(qSrc);
    const a = stripAlts(correctAnswer);
    if (!q || !a) return null;

    // Learning is authoritative for this failed question: replace the bad
    // pair and keep the inverse pair for both translation directions.
    answerMap[q] = a;
    const aKey = norm(a);
    if (aKey && aKey !== q) answerMap[aKey] = qSrc;

    // Let the re-typing of this question happen cleanly.
    lastFilled = '';

    try {
      let learned = {};
      const stored = localStorage.getItem(LEARNED_KEY);
      if (stored) {
        try { learned = JSON.parse(stored) || {}; } catch (e) { learned = {}; }
      }
      // Delete before setting so Object.keys() order remains a small
      // least-recently-written-first ring buffer when a pair is relearned.
      delete learned[q];
      if (aKey && aKey !== q) delete learned[aKey];
      learned[q] = a;
      // Keep the reverse pair too; this preserves the existing bidirectional
      // vocabulary behavior for either translation direction.
      if (aKey && aKey !== q) learned[aKey] = qSrc;
      const keys = Object.keys(learned);
      if (keys.length > LEARNED_CAP) {
        const drop = keys.slice(0, keys.length - LEARNED_CAP);
        for (const k of drop) delete learned[k];
      }
      localStorage.setItem(LEARNED_KEY, JSON.stringify(learned));
      console.log('[Hunter] Learned:', q, '→', a);
    } catch (e) {
      console.warn('[Hunter] Failed to persist learned pair:', e);
    }
    // The verdict handler owns the question counter. Learning corrects the
    // current question; it must not count as a second question.
    setDebug(`🧠 Learned "${qSrc}" → "${a}"`);
    return a;
  }

  /** Load previously-learned pairs from localStorage into answerMap.
   *  Phase 3 hardening: drops malformed entries instead of throwing.
   *  A poisoned localStorage can't crash Hunter. */
  function loadLearnedAnswers() {
    try {
      const stored = localStorage.getItem(LEARNED_KEY);
      if (!stored) return 0;
      const learned = JSON.parse(stored) || {};
      if (typeof learned !== 'object' || Array.isArray(learned)) return 0;
      let count = 0;
      for (const [q, a] of Object.entries(learned)) {
        if (typeof q === 'string' && typeof a === 'string' &&
            q.length > 0 && a.length > 0 &&
            q.length < 200 && a.length < 200 &&
            !answerMap[q]) {
          answerMap[q] = a;
          count++;
        }
      }
      if (count > 0) console.log('[Hunter] Loaded', count, 'learned pairs from localStorage');
      return count;
    } catch (e) {
      console.warn('[Hunter] Failed to load learned pairs:', e);
      return 0;
    }
  }

  // ── Phase 2: list-done / auto-next ───────────────────────────────────────

  /** Detect whether we've reached the end of a list / list-complete screen.
   *  - On `list-starter`: when `#start-button-main-label` switches to
   *    "Continue" / "Restart" / "Start again" / "Finished" (EP shows that
   *    text after the player finishes a list).
   *  - On `list-statistics` or when an inline `.list-statistics` /
   *    `.list-complete` block is rendered.
   *  - In-game: when the action-bar flips to `information` mode AND the
   *    question span is empty (EP displays the per-list end-of-list screen).
   */
  function detectListDone() {
    const url = window.location.href.toLowerCase();
    if (url.includes('list-starter')) {
      const label = document.getElementById('start-button-main-label');
      if (label) {
        const text = (label.textContent || '').trim().toLowerCase();
        if (/continue|restart|redo|start again|list complete|finished/.test(text)) return true;
      }
      if (url.includes('list-statistics')) return true;
      if (document.querySelector('.list-statistics, .list-complete, .stats-summary')) return true;
      return false;
    }
    if (url.includes('game')) {
      const qSpan = document.getElementById('question-text');
      const qText = qSpan ? (qSpan.textContent || '').trim() : '';
      const bar = document.querySelector('.game-action-bar');
      if (bar && /information|summary|finished|list-summary/.test(bar.className || '')) {
        return qText.length === 0;
      }
    }
    return false;
  }

  /** Auto-navigate to the next list / task. Returns true if a next
   *  item was clicked. Best-effort DOM driver covering both legacy
   *  list-starter and modern hybrid pages.
   *  Phase 3 hardening:
   *   - Uses isVisible() on every candidate so off-screen / hidden / ng-hide
   *     items cannot drive Hunter into a no-op loop.
   *   - Considers BOTH the sidebar task list (`<li title="...">`) and the
   *     mode-locked options (`<li class="item mode-X">`) so it works across
   *     EP's list-starter reorganisations (verified across files 1, 4, 5, 7).
   *   - Logs every attempt and what was visible at the moment.
   */
  function isCompletedTask(el) {
    if (!el) return true;
    const cls = String(el.className || '').toLowerCase();
    const status = [
      el.getAttribute && el.getAttribute('aria-disabled'),
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-status'),
      el.getAttribute && el.getAttribute('data-state'),
    ].filter(Boolean).join(' ').toLowerCase();
    const progress = navText(el.querySelector && el.querySelector('.percentage-label, [class*="progress"], [class*="status"]')).toLowerCase();
    const stateText = cls + ' ' + status + ' ' + progress;
    return /(^|[\s_-])(completed|complete|finished|done|learnt|correct)([\s_-]|$)/.test(stateText) ||
      /(?:^|\s)100%?(?:\s|$)/.test(stateText);
  }

  function legacyAutoNextList() {
    const url = window.location.href.toLowerCase();

    if (url.includes('list-starter')) {
      // Two distinct kinds of li items live in list-starter:
      //   ① sidebar task list — `<li title="11ENG Line 2.1 English">` style
      //   ② mode/option items — `<li class="item mode-X selected">`
      // We try both selector chains as fallbacks.
      const itemSelectors = [
        '#stats-parent li[title]',
        '#stats-parent .starter-panel li[title]',
        '#left-controls-panel li[title]',
        '#stats-parent .starter-panel .grouped-options > li.item',
        '#left-controls-panel .grouped-options > li.item',
        '.grouped-options > li.item',
        '#preview-grid-container .preview-grid .stats-item',
        '.preview-grid .stats-item',
      ];
      let items = [];
      for (const sel of itemSelectors) {
        items = queryAllVisible(sel);
        if (items.length > 0) break;
      }
      if (items.length === 0) {
        console.warn('[Hunter] autoNext: no list items visible');
        return false;
      }

      let foundCurrent = false;
      for (const item of items) {
        const current = item.classList.contains('selected') ||
          item.classList.contains('active') ||
          item.classList.contains('current') ||
          item.getAttribute('aria-selected') === 'true';
        if (foundCurrent && !current && !isCompletedTask(item) && safeClick(item)) {
          console.log('[Hunter] autoNext: clicked next available task');
          return true;
        }
        if (current) foundCurrent = true;
      }
      // No item follows the current one. Start the first genuinely available
      // task, never a completed/learnt item and never the current item again.
      for (const item of items) {
        if (!isCompletedTask(item) && safeClick(item)) {
          console.log('[Hunter] autoNext: opened first available task');
          return true;
        }
      }
      return false;
    }

    if (url.includes('game')) {
      for (const b of queryAllVisible('button')) {
        if (!isEnabled(b)) continue;
        const t = (b.textContent || '').trim().toLowerCase();
        if (/next list|next task|continue|finish/.test(t)) {
          if (safeClick(b)) {
            console.log('[Hunter] autoNext: clicked next-list button in-game');
            return true;
          }
        }
      }
      const listLink = queryVisible(
        'a[href*="list-starter"], [ng-click*="list-starter"]'
      );
      if (listLink && safeClick(listLink)) return true;
    }
    return false;
  }

  // ── Phase 2: human-presence detector (Phase 3 hardened) ──────────────────────────────────────
  //  Phase 3 hardening:
  //   - Listens on keydown / click / input / paste / scroll / wheel / blur
  //     (capture phase, beats EP's Angular handlers).
  //   - All event handling is short-circuited when Hunter is off so we
  //     don't waste cycles.
  //   - The reset timer ref is tracked so stopHunter() can clear it.
  //   - Idle callback bumps the watchdog so consecutive user interactions
  //     never let Hunter get stuck suspended.
  function onHumanInteraction(e) {
    if (!hunterEnabled || hunterSyntheticInput) return;
    // Ignore programmatic events; Hunter should yield only to real user input.
    if (e && e.isTrusted === false) return;
    const target = e && e.target;
    if (!target) return;
    const isAnswerField = target.matches && (
      target.matches('#answer-text, [contenteditable]') ||
      target.isContentEditable ||
      (target.closest && (
        target.closest('#answer-text') ||
        target.closest('#answer-block') ||
        target.closest('.lp-question-content') ||
        target.closest('[contenteditable]')
      ))
    );
    if (!isAnswerField) return;

    hunterHumanActive = true;
    if (!hunterHumanSuspended) {
      hunterHumanSuspended = true;
      console.log('[Hunter] Human detected — suspending');
      showToast('👤 Human typing — Hunter idle');
      setDebug('👤 Human typing — Hunter idle');
    }
    if (hunterHumanTimer) clearTimeout(hunterHumanTimer);
    hunterHumanTimer = setTimeout(() => {
      if (!hunterEnabled) return;
      hunterHumanActive = false;
      hunterHumanSuspended = false;
      console.log('[Hunter] Human idle — resuming');
      showToast('👤 Human idle — Hunter resumed');
      // Bump watchdog so we don't reset mid-resume.
      hunterStateEntryMs = Date.now();
      updateHunterDebug();
    }, clampMs(CFG.hunter.humanPresenceWindow, 100, 30000));

    // Reset the global "last activity" so the watchdog doesn't fire.
    hunterLastActiveMs = Date.now();
  }

  // ── Verdict detection (Phase 2) ───────────────────────────────────────────

  function detectVerdict() {
    // 1. PRIMARY live signal: #answer-text-container ng-class. Verified in
    //    file 1 (`Implement/(5) EP (8_4_2026 3：48：24 PM).html`):
    //    "<div id=answer-text-container ... ng-class=\" { correct: ..==2,
    //    error: ..==1 }\">" — Angular flips these classes synchronously
    //    when grading completes, so this is far more reliable than the
    //    modal-row / cheer-button heuristics.
    const answerContainer = document.getElementById('answer-text-container');
    if (answerContainer && isVisible(answerContainer)) {
      const cls = answerContainer.className || '';
      if (/\bcorrect\b/.test(cls)) return 'correct';
      if (/\berror\b/.test(cls))   return 'incorrect';
    }

    // 2. modeless-answer-dialog: tr.correct/incorrect (only when modal open).
    const dialog = queryVisible('.modeless-answer-dialog');
    if (dialog) {
      if (dialog.querySelector('tr.incorrect')) return 'incorrect';
      if (dialog.querySelector('tr.correct'))   return 'correct';
    }

    // 3. action-bar-button.try-again visible
    const tryAgainBtn = queryVisible('.action-bar-button.try-again button, .action-bar-button.try-again');
    if (tryAgainBtn) return 'incorrect';

    // 4. cheer-button appears AFTER a correct answer (it's an ng-show
    //    div, not a real button — hence isVisible() check, not tag check).
    const cheerBtn = queryVisible('.cheer-button');
    if (cheerBtn) return 'correct';

    // 5. paper-mode "Next question" button.
    const nextQBtn = queryVisible('.next-question-button');
    if (nextQBtn && isEnabled(nextQBtn)) return 'correct';

    // 6. SA navigation / information controls.
    const infoBtn = queryVisible('.information-controls button, #sa-navigation-controls button');
    if (infoBtn && isEnabled(infoBtn)) return 'correct';

    // 7. Enabled #continue-button present alone means we're sitting in the
    //    post-verdict screen but we can't tell correct/wrong yet. Return
    //    'unknown' so the watchdog can move us out of AWAIT_VERDICT.
    const continueBtn = document.getElementById('continue-button');
    if (continueBtn && isVisible(continueBtn) && isEnabled(continueBtn)) {
      return 'unknown';
    }

    // 8. #question-text disappeared → unknown (next question loading or
    //    list-complete). Helps the watchdog break us out of AWAIT_VERDICT.
    const qSpan = document.getElementById('question-text');
    if (qSpan && (qSpan.textContent || '').trim().length === 0) return 'unknown';

    return null;
  }

  // ── Clicks (Phase 2: more selectors, ng-disabled-aware) ───────────────────

  /** Click the **Continue / “Next question” button** — Phase 4's preferred
   *  post-error dismissal path. Tries in order:
   *    1. `#continue-button` (verified in game-page HTML)
   *       → outside the modal first (regular Next-question)
   *       → then inside the modal footer (post-verdict "Next question")
   *    2. `.modal-footer #continue-button`
   *    3. `.modal-footer button` (any button in the modal footer)
   *    4. Same fallbacks as clickAdvanceButton() (for the non-error case)
   *  Returns true if anything was clicked.
   */
  function clickContinueButton() {    // 1. The modal footer is the highest-priority error path. EP reuses the
    //    same ID in the footer, so scope it first before broader fallbacks.
    const selectors = [
      '.modeless-answer-dialog .modal-footer #continue-button:not([disabled])',
      '.modal-footer #continue-button:not([disabled])',
      '#continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      '.modal-footer button.nice-button:not([disabled])',
      '.modeless-answer-dialog .modal-footer #continue-button',
      '.modal-footer #continue-button',
      '#continue-button',
      '.modeless-answer-dialog #continue-button',
    ];

    for (const sel of selectors) {
      const btn = queryVisible(sel);
      if (btn && isEnabled(btn)) {
        console.log('[Hunter] Clicking Continue:', sel, '·', (btn.textContent || '').trim().slice(0, 30));
        if (safeClick(btn)) return true;
      }
    }
    // 2. Fall through to the broader advance selector chain.
    return clickAdvanceButton();
  }

  /** Click the "Next question" button to advance past the current question.
   *  Phase 3 hardening:
   *   - Every selector goes through safeClick() (isVisible + isEnabled).
   *   - Primary `#continue-button` (verified in `Implement/(5) EP (8_4_2026
   *     3：48：24 PM).html`: `<button class="nice-button ng-binding"
   *     id=continue-button ng-click=self.continueButtonClicked()
   *     ng-disabled=self.continueButtonDisabled>`).
   *   - Re-query each iteration since EP's DOM can swap elements in/out
   *     mid-animation; we don't trust a captured reference.
   *   - When all selectors fail, fall through to the verbose text-match
   *     loop, which prints the candidate's text into the console for the
   *     user to copy into the road-map if they hit an unsupported layout.
   *  Returns true when something was clicked.
   */
  function clickAdvanceButton() {
    // 1. ID-based / class-based selectors (highest signal).
    const baseSelectors = [
      '#continue-button',
      '.modeless-answer-dialog #continue-button',
      '.next-question-button',
      '#next-question',
      '#correct-button',
      '.correct-button',
      'button[name="continue"]',
      'button[data-action="continue"]',
      'button[data-action="next"]',
    ];
    for (const sel of baseSelectors) {
      const btn = queryVisible(sel);
      if (btn && isEnabled(btn)) {
        console.log('[Hunter] Clicking advance:', sel, '·', (btn.textContent || '').trim().slice(0, 30));
        if (safeClick(btn)) return true;
      }
    }

    // 2. wider: any button inside the in-game action-bar / nav controls.
    const fallbackSelectors = [
      '.information-controls button',
      '#sa-navigation-controls button',
      '.sa-navigation-controls button',
      '.game-action-bar button',
      '.cheer-button',
    ];
    for (const sel of fallbackSelectors) {
      const btn = queryVisible(sel);
      if (btn && (btn.tagName !== 'BUTTON' || isEnabled(btn)) && isVisible(btn)) {
        console.log('[Hunter] Clicking advance (fallback):', sel);
        if (safeClick(btn)) return true;
      }
    }

    // 3. Last resort: scan every visible button for content matching the
    //    known "next / continue / done" set. Track non-matches so we can
    //    tell the user what we DID see in the toast.
    const seen = [];
    for (const btn of document.querySelectorAll('button')) {
      if (!isVisible(btn) || !isEnabled(btn)) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      seen.push(text.slice(0, 30));
      if (/^(next|continue|next question|ok|got it|done|done!)$/i.test(text)) {
        console.log('[Hunter] Clicking advance by text:', text);
        if (safeClick(btn)) return true;
      }
    }
    console.warn('[Hunter] No advance button found. Visible buttons:', seen.slice(0, 8));
    return false;
  }

  /** Click the dismiss / try-again / next button on a wrong-answer overlay.
   *  Phase 3 hardening:
   *   - In EP's actual flow the wrong-answer overlay REUSES the same
   *     `#continue-button` that the correct-answer screen uses; in both
   *     cases the button's text is "Next question" / "Try again" depending
   *     on game mode. So the primary dismiss target IS the continue-button.
   *   - All clicks go through safeClick() — isVisible() then isEnabled().
   *   - We re-query each attempt because EP swaps the wrong overlay out
   *     and in within ~300 ms; a cached reference could be a detached node.
   *   - Always returns true/false cleanly so callers can chain.
   */
  function dismissWrongAnswer() {
    // 1. Try the most common dismiss targets first.
    const baseSelectors = [
      '#continue-button',
      '.modeless-answer-dialog #continue-button',
      '.action-bar-button.try-again button',
      '.action-bar-button.try-again',
      '.game-action-bar .action-bar-button.try-again button',
      '.feedback-button',
      'button[name="continue"]',
      'button[data-action="continue"]',
      'button[data-action="next"]',
      'button[data-action="got-it"]',
    ];
    for (const sel of baseSelectors) {
      const btn = queryVisible(sel);
      if (btn && (btn.tagName !== 'BUTTON' || isEnabled(btn))) {
        console.log('[Hunter] Dismissing wrong answer via:', sel, '·', (btn.textContent || '').trim().slice(0, 30));
        if (safeClick(btn)) return true;
      }
    }

    // 2. Wider fallbacks (any enabled action-bar / sa-nav button).
    const fallbackSelectors = [
      '.game-action-bar .action-bar-button button',
      '#sa-navigation-controls button',
      '.sa-navigation-controls button',
    ];
    for (const sel of fallbackSelectors) {
      const btn = queryVisible(sel);
      if (btn && isEnabled(btn)) {
        console.log('[Hunter] Dismissing wrong answer (fallback):', sel);
        if (safeClick(btn)) return true;
      }
    }

    // 3. Last-resort: scan every visible button for any text matching.
    //    Bumped the verb list to match EP's actual labels (verified across
    //    files 1–4 in /Implement).
    for (const btn of document.querySelectorAll('button')) {
      if (!isVisible(btn) || !isEnabled(btn)) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(try again|continue|next|next question|ok|got it|retry|try it again|i was right|done)$/i.test(text)) {
        console.log('[Hunter] Dismissing wrong answer by text:', text);
        if (safeClick(btn)) return true;
      }
    }
    return false;
  }

  // ── Skip whole list (Phase 1 carry-over, hardened in Phase 3) ────────────────────────────
  //  Phase 3 hardening:
  //   - Uses isVisible() + safeClick() throughout so off-screen / disabled
  //     items can never be clicked.
  //   - Recognizes BOTH the sidebar task list (<li title="...">) and the
  //     option-locked list (<li class="item ...">), mirroring autoNextList.
  //   - Handles "no more tasks" gracefully with a clearer toast + doesn't
  //     loop forever on the same selected item.
  //   - activity-starter uses an explicit fallback chain (back-button by
  //     aria-label, href, ng-click) so the back action always finds SOMETHING.
  function legacySkipToNextTask() {
    const url = window.location.href.toLowerCase();

    if (url.includes('list-starter')) {
      // Two kinds of lists: sidebar (li[title]) and mode picker (li.item).
      const itemSelectors = [
        '#stats-parent li[title]',
        '#left-controls-panel li[title]',
        '#stats-parent .starter-panel li.item',
        '#stats-parent .starter-panel .grouped-options > li.item',
        '.grouped-options > li.item',
        '#preview-grid-container .preview-grid .stats-item',
        '.preview-grid .stats-item',
      ];
      let items = [];
      for (const sel of itemSelectors) {
        items = queryAllVisible(sel);
        if (items.length > 0) break;
      }

      if (items.length === 0) {
        // Nothing to click — try to nav back via breadcrumb.
        const crumb = queryVisible('.breadcrumbs .crumb, .crumb-child');
        if (crumb && safeClick(crumb)) {
          showToast('⏭ Back to course view');
        } else {
          showToast('⚠️ No skip target on this screen');
        }
        return;
      }

      let foundCurrent = false;
      for (const item of items) {
        const current = item.classList.contains('selected') ||
          item.classList.contains('active') ||
          item.classList.contains('current') ||
          item.getAttribute('aria-selected') === 'true';
        if (foundCurrent && !current && !isCompletedTask(item)) {
          if (safeClick(item)) {
            showToast('⏭ Skipped to next available task');
            console.log('[Hunter] Skipped sidebar item');
          } else {
            showToast('⚠️ Could not click next available item');
          }
          return;
        }
        if (current) foundCurrent = true;
      }

      if (!foundCurrent) {
        const firstAvailable = items.find(item => !isCompletedTask(item));
        if (firstAvailable && safeClick(firstAvailable)) {
          showToast('⏭ Skipped to first available task');
          console.log('[Hunter] Skipped to first available sidebar item');
        } else {
          showToast('🏁 No more available tasks');
        }
        return;
      }

      // foundCurrent but no next-after: the list is exhausted.
      showToast('🏁 No more available tasks here — back to course view');
      const crumb = queryVisible('.breadcrumbs .crumb, .crumb-child');
      if (crumb) safeClick(crumb);
      return;
    }

    if (url.includes('game') || url.includes('activity-starter')) {
      const backSelectors = [
        '#sa-navigation-controls .back-button',
        '#sa-navigation-controls [data-action="back"]',
        '.navigation-controls button.back-button',
        '.navigation-controls .back-button',
        'button[aria-label="Back"]',
        'button[aria-label*="back" i]',
        '.back-button',
        '[data-action="back"]',
        'a[href*="list-starter"]',
      ];
      for (const sel of backSelectors) {
        const btn = queryVisible(sel);
        if (btn && safeClick(btn)) {
          showToast('⏭ Going back to list');
          return;
        }
      }
      // ng-click link to list-starter.
      const listLink = queryVisible('[ng-click*="list-starter"]');
      if (listLink && safeClick(listLink)) {
        showToast('⏭ Navigating to list');
        return;
      }
      showToast('⚠️ No back button on this screen');
      return;
    }
    showToast('⚠️ Not on a task page');
  }

  // ── Phase 5: folder → list → Writing mode navigation ─────────────────────

  function navText(el) {
    return (el && (el.textContent || '').replace(/\s+/g, ' ').trim()) || '';
  }

  function navRowFor(el) {
    return el && (el.closest('.crumb-child.item, li.item, .stats-item, [role="button"]') || el.parentElement);
  }

  function clickNavigationEntry(entry) {
    if (!entry) return false;
    // EP attaches the click handler to either the complete row or the title
    // itself depending on whether the browser is rendered by React or Angular.
    return safeClick(entry.row) || safeClick(entry.title);
  }

  function isFolderNavigationRow(el) {
    const row = navRowFor(el) || el;
    return !!(row && row.querySelector && (
      row.querySelector('.folder-icon') ||
      row.querySelector('[title="folder icon"]') ||
      row.classList.contains('folder')
    ));
  }

  function navigationTitleEntries() {
    const seen = new Set();
    return queryAllVisible(NAV_SEL.listTitles)
      .filter(title => !title.closest('#ep-panel'))
      .filter(title => !title.closest('li.item .main-text, li.item .sub-text'))
      .filter(title => !isFolderNavigationRow(title))
      .map(title => {
        const label = navText(title);
        const row = navRowFor(title);
        return { title, row: row && isVisible(row) ? row : title, label };
      })
      .filter(entry => {
        const key = entry.label.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getCurrentNavigationListTitle() {
    const title = queryVisible('#list-title');
    return navText(title) || hunterCurrentListTitle;
  }

  /** Return the next live, visible, uncompleted list title; never hard-code a name. */
  function findNextList() {
    const entries = navigationTitleEntries();
    if (entries.length === 0) return null;

    const current = (getCurrentNavigationListTitle() || '').toLowerCase();
    const currentIndex = current
      ? entries.findIndex(entry => entry.label.toLowerCase() === current)
      : -1;
    const ordered = currentIndex >= 0
      ? entries.slice(currentIndex + 1).concat(entries.slice(0, currentIndex))
      : entries;

    return ordered.find(entry => {
      const key = entry.label.toLowerCase();
      return !isCompletedTask(entry.row) && !hunterVisitedLists.has(key);
    }) || null;
  }

  function preferredHunterDirection() {
    const configured = String(CFG.hunter.modeDirection || 'auto').toLowerCase();
    if (configured === 'english-to-french' || configured === 'french-to-english') {
      hunterLastDirection = configured;
      return configured;
    }
    const prompt = navText(queryVisible(SEL.prompt)).toLowerCase();
    const placeholder = (queryVisible(SEL.answerInput)?.getAttribute('placeholder') || '').toLowerCase();
    if (/english\s+to\s+french|write your answer in french/.test(prompt + ' ' + placeholder)) {
      hunterLastDirection = 'english-to-french';
    } else if (/french\s+to\s+english|write your answer in english/.test(prompt + ' ' + placeholder)) {
      hunterLastDirection = 'french-to-english';
    }
    return hunterLastDirection === 'auto' ? 'english-to-french' : hunterLastDirection;
  }

  function modeMatchesDirection(mode, direction) {
    const text = navText(mode).toLowerCase();
    if (direction === 'french-to-english') return /french\s+text\s+to\s+english/.test(text);
    return /english\s+text\s+to\s+french/.test(text);
  }

  /** Visible starter mode items (`li.item`) whose `.main-text` is `name`
   *  ('reading' / 'writing'). */
  function hunterModeItems(name) {
    return queryAllVisible(NAV_SEL.modeItems)
      .filter(mode => navText(mode.querySelector('.main-text')).toLowerCase() === name);
  }

  /** The item to select for `name`; Writing preserves the translation direction. */
  function hunterPickMode(name) {
    const modes = hunterModeItems(name);
    if (modes.length === 0) return null;
    if (name !== 'writing') return modes[0];
    const direction = preferredHunterDirection();
    return modes.find(mode => modeMatchesDirection(mode, direction)) || modes[0];
  }

  /** A mode item shows its own progress (`.percentage-label`, class `learnt`
   *  at 100%; verified live on a French list-starter). */
  function hunterModeLearnt(item) {
    const label = item && item.querySelector('.percentage-label');
    return !!(label && isVisible(label) &&
      (label.classList.contains('learnt') || parseInt(navText(label), 10) >= 100));
  }

  /** Progress status of a mode item for remainingMode(). EP hides the label at
   *  0% (`ng-show="item.percentage > 0"`, class `ng-hide`) but keeps its text
   *  ("0%", verified live), so the text is read even when it is not visible. */
  function hunterModeStatus(item) {
    if (!item) return 'absent';
    const label = item.querySelector('.percentage-label');
    if (!label) return 'unknown';
    if (hunterModeLearnt(item)) return 'learnt';
    return isNaN(parseInt(navText(label), 10)) ? 'unknown' : 'open';
  }

  /** Reuse the existing EP start controls, including the modern preview header button. */
  function clickHunterStartButton() {
    for (const selector of NAV_SEL.startButtons) {
      const button = queryVisible(selector);
      if (button && isEnabled(button) && safeClick(button)) {
        console.log('[Hunter] Started list via:', selector);
        return true;
      }
    }
    return false;
  }

  function clickHunterBackToFolderView() {
    const backSelectors = [
      '#sa-navigation-controls .back-button',
      '#sa-navigation-controls [data-action="back"]',
      '.navigation-controls button.back-button',
      '.navigation-controls .back-button',
      'button[aria-label="Back"]',
      'button[aria-label*="back" i]',
      '#exit-button',
      '.back-button',
      '[data-action="back"]',
      'a[href*="browse"]',
      'a[href*="list-starter"]',
      '[ng-click*="list-starter"]',
    ];
    for (const selector of backSelectors) {
      const button = queryVisible(selector);
      if (button && safeClick(button)) return true;
    }

    // On the hybrid browser, the deepest visible folder breadcrumb is the
    // reliable way back from a list view to its containing folder.
    const folders = queryAllVisible(NAV_SEL.folderItems)
      .filter(row => isFolderNavigationRow(row));
    const folder = folders[folders.length - 1];
    if (folder && safeClick(folder)) return true;

    const browseButton = queryVisible('#section-browse-dropdown-button');
    if (browseButton && safeClick(browseButton)) return true;
    // On a starter/game page none of the above exists; browser Back lands in the
    // folder view there (verified live, same as hunterReopenList).
    if (/\/(game|list-starter)/i.test(window.location.pathname) && window.history.length > 1) {
      window.history.back();
      return true;
    }
    return false;
  }

  /**
   * Unified navigation driver used by both auto-continue and Skip list.
   * Returns `moved`, `waiting`, or `exhausted`; it is intentionally DOM-only
   * and leaves the normal Hunter question state machine in charge after Start.
   */
  function navigateToNextList(reason) {
    if (!hunterEnabled || !CFG.hunter.enabled) return 'waiting';

    // Keep driving the DOM across SPA renders until the selected list has
    // reached Writing mode and a real EP Start button has been clicked.
    // Intermediate calls may only return to the browser or open a folder.
    hunterNavigationPending = true;

    const url = window.location.href.toLowerCase();
    if (url.includes('game') || url.includes('activity-starter')) {
      // Capture the active Writing direction before leaving the question page;
      // the starter screen does not necessarily retain the prompt/placeholder.
      preferredHunterDirection();
      if (clickHunterBackToFolderView()) {
        hunterNavigationStage = 'folder';
        console.log('[Hunter] Navigation: returned to folder/list browser');
        return 'moved';
      }
      return 'waiting';
    }

    // A return from a completed game lands on the old list's starter screen.
    // Do not restart it: first leave that screen for the folder/list browser.
    // A newly clicked list uses the `find` stage and is allowed to select mode.
    if (hunterNavigationStage === 'folder' && queryAllVisible(NAV_SEL.modeItems).length > 0) {
      if (clickHunterBackToFolderView()) return 'moved';
      return 'waiting';
    }

    // A new list's starter is on screen. Hand over to the idle auto-start
    // (hunterStartWhenReady): it waits for the vocab, selects Reading first
    // and clicks Start. Never start from here: the vocab is not read yet.
    if (hunterNavigationStage !== 'folder' && queryAllVisible(NAV_SEL.modeItems).some(mode =>
        /^(reading|writing)$/.test(navText(mode.querySelector('.main-text')).toLowerCase()))) {
      hunterListStage = 'reading';
      hunterNavigationPending = false;
      hunterNavigationStage = 'idle';
      hunterNavigationAttempts = 0;
      return 'moved';
    }

    const next = findNextList();
    if (next) {
      const key = next.label.toLowerCase();
      hunterCurrentListTitle = next.label;
      hunterNavigationTarget = next.label;
      hunterVisitedLists.add(key);
      hunterNavigationStage = 'find';
      if (clickNavigationEntry(next)) {
        console.log('[Hunter] Navigation:', reason, 'opened list', next.label);
        return 'moved';
      }
      return 'waiting';
    }

    // If this view only exposes folders, descend into the first folder not
    // visited in this run and search its live list titles on the next tick.
    const folder = queryAllVisible(NAV_SEL.folderItems)
      .filter(row => isFolderNavigationRow(row))
      .find(row => {
        const key = navText(row).toLowerCase();
        return key && !hunterVisitedFolders.has(key) && !isCompletedTask(row);
      });
    if (folder) {
      const key = navText(folder).toLowerCase();
      hunterVisitedFolders.add(key);
      hunterNavigationStage = 'folder';
      if (safeClick(folder)) {
        console.log('[Hunter] Navigation: opened folder', navText(folder));
        return 'moved';
      }
      return 'waiting';
    }

    // A list-starter can contain no list titles because it is showing the
    // current list's details. Leave it once, then let the browser view expose
    // the next folder/list titles.
    if (url.includes('list-starter') && hunterNavigationStage !== 'folder') {
      hunterNavigationStage = 'folder';
      if (clickHunterBackToFolderView()) return 'moved';
      return 'waiting';
    }

    hunterNavigationPending = false;
    hunterNavigationStage = 'idle';
    return 'exhausted';
  }

  /** Arm multi-step navigation; hunterTick → driveHunterNavigation() runs it. */
  function beginHunterNavigation() {
    const current = getCurrentNavigationListTitle();
    if (current) hunterVisitedLists.add(current.toLowerCase());
    hunterNavigationPending  = true;
    hunterNavigationStage    = 'folder';
    hunterNavigationAttempts = 0;
    hunterNavigationReadyAt  = 0;
    hunterListPlayed         = false;
    hunterListStage          = 'reading';   // every list starts with Reading
    hunterModeRuns           = { reading: 0, writing: 0 };
  }

  /** One navigation step per tick. After each click wait for EP to re-render
   *  so the same screen is never acted on twice. */
  function driveHunterNavigation() {
    hunterStateEntryMs = Date.now(); // navigation is progress, not a stuck state
    if (Date.now() < hunterNavigationReadyAt) return;
    if (++hunterNavigationAttempts > CFG.hunter.maxNavigationAttempts) {
      showToast('🛑 Navigation timed out — Hunter stopped');
      stopHunter();
      return;
    }
    const result = navigateToNextList('drive');
    if (result === 'exhausted') {
      showToast('🏁 No more lists — Hunter stopped');
      stopHunter();
    } else if (result === 'moved') {
      hunterNavigationReadyAt = Date.now() + CFG.hunter.navigationSettleMs;
      if (!hunterNavigationPending) {
        // The new list's starter is open; hunterStartWhenReady() takes over.
        hunterListSleepScheduled = false;
        hunterQuestion  = '';
        lastFilled      = '';
        hunterAdvancing = false;
        hunterSetState('IDLE');
        updateHunterDebug();
      }
    }
  }

  // ── Skip whole list shares the exact same folder/list/mode/start driver. ──
  /** Skip list: the list being hunted is flagged `skipped` in ep.scout (removed
   *  from the panel, the counts and the next-list choice; a re-scout keeps the
   *  flag), then Hunter opens the next undone list. Without scouted data it falls
   *  back to the sibling-list walk. */
  function skipToNextTask() {
    if (!hunterEnabled || !CFG.hunter.enabled) {
      showToast('🕵️ Enable Hunter mode before skipping a list');
      return;
    }
    if (!scoutCurrent) scoutAdoptCurrent();
    const cur = scoutCurrent;
    // A pending finish / stage switch must not fire after the skip.
    clearHunterDelayedTimers();
    hunterListSleepScheduled = false;
    if (!cur) {
      beginHunterNavigation();
      showToast('⏭ Finding next available list…');
      return;
    }
    scoutMarkSkipped(cur);
    const next = scoutNextAfter(cur);
    hunterListStage = 'reading';
    hunterModeRuns  = { reading: 0, writing: 0 };
    hunterResetListRun();
    scoutSetCurrent(null);
    if (next) {
      showToast('⏭ Skipped “' + cur.title.slice(0, 24) + '” · opening next list…');
      scoutLaunch(next);
    } else {
      showToast('⏭ Skipped · no more scouted lists — Hunter stopped');
      stopHunter();
    }
  }

  // ── Scout Mode: crawl a subject's content tree → ep.scout → launch lists ──
  // DOM-only. Scout navigates (folders, list rows) and tracks lists; it never
  // submits answers. The user presses Enter; the base assistant types.
  const SCOUT_KEY         = 'ep.scout';          // { [language]: { at, lists, folders } }
  const SCOUT_PENDING_KEY = 'ep.scout.pending';  // list to open after a full page load
  const SCOUT_CURRENT_KEY = 'ep.scout.current';  // list in progress, survives a reload
  const SCOUT_ROOT_RE     = /\/app\/dashboard\/([^/]+)\/content\/?$/i;
  const scoutSleep        = ms => new Promise(r => setTimeout(r, ms));
  let scoutRunning = false;
  let scoutCancel  = false;
  let scoutSteps   = 0;
  let scoutCurrent = null;   // { lang, path[], title, played } of the list being hunted
  // Finish-detection trackers for the current scouted list (see detectScoutFinished).
  let scoutNoQuestionSince = 0, scoutStarterTicks = 0, scoutGameIds = '', scoutFinishRule = '';
  let scoutAdoptKey = '', scoutLastRowTitle = '';
  const FINISHLOG_KEY = 'ep.finishlog';   // evidence snapshots of finish screens

  function scoutLoad() {
    try {
      const d = JSON.parse(localStorage.getItem(SCOUT_KEY) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch (e) { return {}; }
  }
  function scoutSave(d) { try { localStorage.setItem(SCOUT_KEY, JSON.stringify(d)); } catch (e) {} }
  function scoutLang() {
    const m = window.location.pathname.match(/\/app\/dashboard\/([^/]+)\/content/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : '';
  }

  /** Visible rows of the content browser: folders and lists with progress. */
  function scoutRows() {
    return queryAllVisible(NAV_SEL.folderItems)
      .filter(row => !row.closest('#ep-panel'))
      .map(row => {
        const pct = parseInt(navText(row.querySelector('.completion-percentage')), 10);
        return { row, title: navText(row.querySelector('.item-title')),
                 folder: isFolderNavigationRow(row), progress: isNaN(pct) ? 0 : pct,
                 // Activity icon <title>: "Translation list" = vocab, "Smart lesson" = video.
                 kind: navText(row.querySelector('.activity-icon title')) };
      })
      .filter(r => r.title);
  }

  /** Only vocabulary lists are queued; unknown kinds (older scans) stay visible. */
  function scoutIsVocab(l) { return !l.kind || /translation list|vocab/i.test(l.kind); }

  /** Lists Hunter may still complete: vocabulary lists the user did not skip. */
  function scoutIsPossible(l) { return scoutIsVocab(l) && !l.skipped; }

  /** Remember the launched list (also across a page reload) or clear it. */
  function scoutSetCurrent(t) {
    if (!scoutCurrent || !t || scoutCurrent.title !== t.title) {
      scoutNoQuestionSince = 0; scoutStarterTicks = 0; scoutGameIds = '';
    }
    scoutCurrent = t;
    try {
      // `stage` (reading/writing) is persisted so a reload resumes the right mode.
      if (t) localStorage.setItem(SCOUT_CURRENT_KEY, JSON.stringify(Object.assign({}, t, { stage: hunterListStage })));
      else localStorage.removeItem(SCOUT_CURRENT_KEY);
    } catch (e) {}
  }

  /** Wait until the rows stop changing. `urlBefore` = wait for the click to
   *  change the URL first. Resolves true when stable, false on timeout/cancel. */
  async function scoutSettle(urlBefore, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || CFG.scout.renderTimeoutMs);
    let last = '', stable = 0;
    while (Date.now() < deadline && !scoutCancel) {
      await scoutSleep(350);
      if (urlBefore && window.location.href === urlBefore) continue;
      const sig = scoutRows().map(r => r.title + r.progress).join('|');
      if (sig && sig === last) { if (++stable >= 2) return true; }
      else { stable = 0; last = sig; }
    }
    return false;
  }

  /** Back to the subject's content root via the breadcrumb (SPA, no reload). */
  async function scoutGoRoot() {
    if (!SCOUT_ROOT_RE.test(window.location.pathname)) {
      const name = queryVisible('span.name');
      const crumb = name && (name.closest('a, button, [role="button"], li, [class*="crumb"]') || name);
      const before = window.location.href;
      if (!crumb || !safeClick(crumb)) return false;
      await scoutSettle(before);
    } else {
      await scoutSettle(null, 30000);
    }
    return SCOUT_ROOT_RE.test(window.location.pathname);
  }

  /** Depth-first walk of the folder currently on screen. Returns true when the
   *  whole subtree was scanned (false = cancelled or capped). */
  async function scoutVisit(store, path, folderId, all) {
    for (const r of scoutRows().filter(x => !x.folder)) {
      const key = path.concat(r.title).join(' › ');
      store.lists[key] = Object.assign(store.lists[key] || {}, {
        title: r.title, folderPath: path, folderId, progress: r.progress, kind: r.kind,
        done: r.progress >= 100 || isCompletedTask(r.row),
      });
    }
    scoutSave(all);
    for (const f of scoutRows().filter(x => x.folder)) {
      if (scoutCancel || scoutSteps >= CFG.scout.maxFolders) return false;
      const sub = path.concat(f.title), key = sub.join(' › ');
      if (store.folders[key] && Date.now() - store.folders[key] < CFG.scout.rescanMs) continue;
      const cur = scoutRows().find(x => x.folder && x.title === f.title);
      const before = window.location.href;
      if (!cur || !safeClick(cur.row)) continue;
      scoutSteps++;
      setDebug('🔭 ' + scoutSteps + ' folders · ' + Object.keys(store.lists).length + ' lists · ' + key.slice(-30));
      await scoutSettle(before);
      const ok = await scoutVisit(store, sub, (window.location.pathname.match(/\/content\/(\d+)/) || [])[1] || '', all);
      window.history.back();
      for (let i = 0; i < 30 && window.location.href !== before && !scoutCancel; i++) await scoutSleep(300);
      await scoutSettle();
      if (!ok) return false;
      store.folders[key] = Date.now();
      scoutSave(all);
    }
    return true;
  }

  /** Crawl the language whose content browser is on screen, from its root. */
  async function scoutRunLang(lang) {
    const all = scoutLoad();
    const store = all[lang] = all[lang] || { at: 0, lists: {}, folders: {} };
    scoutSteps = 0;
    // Scans from before list kinds were recorded must be redone once.
    if (Object.values(store.lists).some(l => !('kind' in l))) store.folders = {};
    showToast('🔭 Scouting ' + lang + '…');
    if (!(await scoutGoRoot())) { showToast('🔭 Could not reach the ' + lang + ' content root'); return false; }
    const complete = await scoutVisit(store, [], '', all);
    store.at = Date.now();
    scoutSave(all);
    renderScoutList();
    return complete;
  }

  /** Language subjects listed on the Library page (links are SPA anchors). */
  function scoutLanguageLinks() {
    return [...document.querySelectorAll('a[href^="/app/dashboard/"][href*="/content"]')]
      .map(a => ({ slug: decodeURIComponent(a.getAttribute('href').split('/')[3] || '').toLowerCase(), link: a }))
      .filter(x => CFG.scout.languages.includes(x.slug));
  }

  /** Go to the Library through the sidebar link (no page reload). */
  async function scoutOpenLibrary() {
    if (!window.location.pathname.startsWith('/learning/library')) {
      const link = queryVisible('a[href="/learning/library"]');
      if (!link || !safeClick(link)) return false;
    }
    for (let i = 0; i < 60 && !scoutCancel && scoutLanguageLinks().length === 0; i++) await scoutSleep(500);
    return scoutLanguageLinks().length > 0;
  }

  /** Scout button = current language; `everyLanguage` walks the Library list. */
  async function scoutCrawl(everyLanguage) {
    if (scoutRunning) { scoutCancel = true; return; }
    const lang = scoutLang();
    if (!everyLanguage && !lang) { showToast('🔭 Open a subject’s content page first'); return; }
    scoutRunning = true; scoutCancel = false;
    if (scoutBtn) scoutBtn.textContent = '⏹ Scouting…';
    let complete = true;
    try {
      if (!everyLanguage) complete = await scoutRunLang(lang);
      else if (await scoutOpenLibrary()) {
        const slugs = [...new Set(scoutLanguageLinks().map(x => x.slug))];
        for (const slug of slugs) {
          if (scoutCancel) { complete = false; break; }
          if (!(await scoutOpenLibrary())) break;
          const item = scoutLanguageLinks().find(x => x.slug === slug);
          if (!item || !safeClick(item.link)) continue;
          for (let i = 0; i < 60 && !scoutCancel && scoutLang() !== slug; i++) await scoutSleep(500);
          await scoutSettle(null, 30000);
          if (!(await scoutRunLang(slug))) complete = false;
        }
      } else showToast('🔭 Could not open the Library');
      const open = Object.values(scoutLoad()).reduce((n, s) => n + Object.values(s.lists).filter(l => !l.done && scoutIsPossible(l)).length, 0);
      showToast(complete ? '🔭 Scout done · ' + open + ' undone lists'
                         : '🔭 Scout paused (' + (scoutCancel ? 'stopped' : 'cap') + ') · ' + open + ' undone — press Scout to continue');
    } catch (e) {
      console.warn('[Scout] crawl threw', e);
      showToast('🔭 Scout error — see console');
    }
    scoutRunning = false; scoutCancel = false; setDebug('');
    if (scoutBtn) scoutBtn.textContent = '🔭 Scout';
    renderScoutList();
  }

  /** Replay a folder path from the root, then click the list row (EP launches
   *  the game straight from the row) and make sure Hunter is on. */
  async function scoutReplay(target) {
    scoutCancel = false;
    if (!(await scoutGoRoot())) { showToast('🔭 Could not reach the content root'); return false; }
    for (const name of target.path) {
      const f = scoutRows().find(x => x.folder && x.title === name);
      const before = window.location.href;
      if (!f || !safeClick(f.row)) { showToast('🔭 Folder “' + name + '” not found'); return false; }
      await scoutSettle(before);
    }
    const l = scoutRows().find(x => !x.folder && x.title === target.title);
    if (!l || !safeClick(l.row)) { showToast('🔭 List “' + target.title + '” not found'); return false; }
    hunterListStage = target.stage === 'writing' ? 'writing' : 'reading';
    if (!target.stage) hunterModeRuns = { reading: 0, writing: 0 };   // a new list; a reopen keeps its run counts
    hunterResetListRun();   // a new list starts clean (played flag of the previous list would block the start gate)
    scoutSetCurrent({ lang: target.lang, path: target.path, title: target.title, played: false });
    showToast('🔭 Launching ' + target.title);
    if (!hunterEnabled) startHunter();
    return true;
  }

  /** Open a scouted list. On a task page of the same language, Back lands in
   *  the folder view (verified live: EP replaces the starter history entry with
   *  the game), so replay from there; otherwise do a full load of the content
   *  root and finish the launch in scoutResumePending(). */
  function scoutLaunch(target) {
    if (scoutLang() === target.lang) return scoutReplay(target);
    const task = window.location.pathname.match(/^\/app\/([^/]+)\/\d+\/\d+\/(game|list-starter)/i);
    const fullLoad = () => {
      console.log('[Scout] launch via full page load');
      try { localStorage.setItem(SCOUT_PENDING_KEY, JSON.stringify(target)); } catch (e) {}
      window.location.assign('/app/dashboard/' + encodeURIComponent(target.lang) + '/content/');
    };
    if (!task || decodeURIComponent(task[1]).toLowerCase() !== target.lang) return fullLoad();
    const before = window.location.href;
    console.log('[Scout] launch via history.back from a task page');
    window.history.back();
    return scoutSettle(before).then(() => {
      console.log('[Scout] after back: lang=' + scoutLang());
      return scoutLang() === target.lang ? scoutReplay(target) : fullLoad();
    });
  }

  /** After a full page load: finish a launch that was waiting for it. */
  function scoutResumePending() {
    let target = null;
    try { target = JSON.parse(localStorage.getItem(SCOUT_PENDING_KEY) || 'null'); } catch (e) {}
    if (!target || scoutLang() !== target.lang) return;
    try { localStorage.removeItem(SCOUT_PENDING_KEY); } catch (e) {}
    scoutReplay(target);
  }

  /** After a reload in the middle of a scouted list: keep auto-continue alive. */
  function scoutRestoreCurrent() {
    if (scoutCurrent) return;
    const url = window.location.href.toLowerCase();
    if (!(url.includes('game') || url.includes('list-starter') || url.includes('activity-starter'))) return;
    let t = null;
    try { t = JSON.parse(localStorage.getItem(SCOUT_CURRENT_KEY) || 'null'); } catch (e) {}
    if (!t || !t.lang || !Array.isArray(t.path) || !t.title) return;
    scoutCurrent = t;
    hunterListStage = t.stage === 'writing' ? 'writing' : 'reading';
    if (!hunterEnabled) startHunter();
  }

  /** Hunter is on and the user started a list by hand: if it was scouted, track
   *  it as the current list so finish → next undone list works for it too.
   *  Matched by list title (`#list-title`) + the folder id in the URL; without a
   *  title only a folder holding exactly one vocab list is trusted. */
  function scoutAdoptCurrent() {
    const m = window.location.pathname.match(/^\/app\/([^/]+)\/(\d+)\/(\d+)\/(list-starter|game)/i);
    if (!m) return;
    // The game page shows no list title; fall back to the last list row opened
    // in the content browser (trusted only together with the URL's folder id).
    const shown = navText(queryVisible('#list-title'));
    const title = shown || scoutLastRowTitle;
    const key = m[0] + '|' + title;
    if (key === scoutAdoptKey) return;
    scoutAdoptKey = key;
    const store = scoutLoad()[decodeURIComponent(m[1]).toLowerCase()];
    if (!store) return;
    // The URL's folder id is not always the id Scout stored (nested folders), so
    // match by title and use the folder id only to narrow duplicates.
    const vocab = Object.values(store.lists || {}).filter(scoutIsVocab);
    const sameTitle = title ? vocab.filter(l => l.title.toLowerCase() === title.toLowerCase()) : [];
    const inFolder = (title ? sameTitle : vocab).filter(l => String(l.folderId) === m[2]);
    const pool = (inFolder.length || !shown) ? inFolder : sameTitle;
    const undone = pool.filter(l => !l.done);
    // A folder shared under several parents is scanned once per parent: same
    // title + folder id = the same list.
    const oneList = pool.length > 0 && pool.every(l => l.title === pool[0].title && l.folderId === pool[0].folderId);
    const pick = oneList ? (undone[0] || pool[0]) : (title && undone.length === 1 ? undone[0] : null);
    if (!pick) return;
    scoutSetCurrent({ lang: decodeURIComponent(m[1]).toLowerCase(), path: pick.folderPath, title: pick.title, played: false });
    showToast('🔭 Tracking “' + pick.title.slice(0, 30) + '”');
  }

  /** Remember the last list row opened in the content browser (see above). */
  function scoutTrackRowClicks() {
    document.addEventListener('click', e => {
      const row = e.target && e.target.closest && e.target.closest('.crumb-child.item');
      if (row && !isFolderNavigationRow(row)) {
        scoutLastRowTitle = navText(row.querySelector('.item-title')) || scoutLastRowTitle;
      }
    }, true);
  }

  /** Finished-list detection for the tracked list. Only called once its questions
   *  were seen (`played`). Rules: (a) on the game page, no question and no answer
   *  box for >4 s; (b) EP returned to the same list's list-starter for 2 ticks.
   *  The dashboard (Exit button) is never "finished". Sets `scoutFinishRule`. */
  function detectScoutFinished() {
    const path = window.location.pathname;
    const g = path.match(/^\/app\/[^/]+\/(\d+)\/(\d+)\/(game|list-starter)/i);
    if (/\/learning\/dashboard/i.test(path) || !g) {
      scoutNoQuestionSince = 0; scoutStarterTicks = 0;
      return false;
    }
    const ids = g[1] + '/' + g[2];
    if (g[3].toLowerCase() === 'game') {
      scoutGameIds = ids;
      scoutStarterTicks = 0;
      const q = document.getElementById('question-text');
      if ((q && isVisible(q) && navText(q)) || queryVisible('input#answer-text')) {
        scoutNoQuestionSince = 0;
        return false;
      }
      if (!scoutNoQuestionSince) scoutNoQuestionSince = Date.now();
      if (Date.now() - scoutNoQuestionSince <= 4000) return false;
      scoutFinishRule = 'game: no question or answer box for 4s';
      return true;
    }
    scoutNoQuestionSince = 0;
    if (ids !== scoutGameIds) { scoutStarterTicks = 0; return false; }
    if (++scoutStarterTicks < 2) return false;
    scoutFinishRule = 'returned to list-starter of the played list';
    return true;
  }

  /** Keep the last 5 finish-screen snapshots so the real screen can be read later. */
  function scoutLogFinish(rule) {
    try {
      const log = JSON.parse(localStorage.getItem(FINISHLOG_KEY) || '[]');
      const dialog = queryVisible('.modeless-answer-dialog, .modal, [role="dialog"]');
      log.push({
        at: new Date().toISOString(),
        path: window.location.pathname,
        rule,
        stage: hunterListStage,
        // Per-mode progress on a starter page (e.g. "Reading 100% learnt").
        modes: queryAllVisible(NAV_SEL.modeItems).map(m => ({
          m: navText(m.querySelector('.main-text')).slice(0, 12),
          p: navText(m.querySelector('.percentage-label')).slice(0, 5),
          learnt: hunterModeLearnt(m),
        })).filter(x => x.p).slice(0, 8),
        buttons: queryAllVisible('button').filter(b => !b.closest('#ep-panel'))
                   .map(b => navText(b).slice(0, 30)).filter(Boolean).slice(0, 12),
        dialog: dialog ? navText(dialog).slice(0, 200) : '',
        startLabel: navText(document.getElementById('start-button-main-label')).slice(0, 40),
        bar: ((document.querySelector('.game-action-bar') || {}).className || '').slice(0, 120),
      });
      localStorage.setItem(FINISHLOG_KEY, JSON.stringify(log.slice(-5)));
    } catch (e) {}
  }

  /** Apply `patch` to the list and to the same list scanned under another
   *  parent folder (same title + folder id), save, refresh the panel. */
  function scoutFlag(t, patch) {
    const all = scoutLoad();
    const lists = all[t.lang] && all[t.lang].lists;
    const e = lists && lists[t.path.concat(t.title).join(' › ')];
    if (e) {
      Object.values(lists).forEach(l => {
        if (l.title === e.title && l.folderId === e.folderId) Object.assign(l, patch);
      });
      scoutSave(all);
    }
    renderScoutList();
  }
  function scoutMarkDone(t)    { scoutFlag(t, { done: true, progress: 100 }); }
  function scoutMarkSkipped(t) { scoutFlag(t, { skipped: true }); }

  /** Next undone scouted list after `t` in the same language (scan order). */
  function scoutNextAfter(t) {
    const all = scoutLoad(), store = all[t.lang];
    if (!store) return null;
    const nk = pickNextKey(store.lists, t.path.concat(t.title).join(' › '), scoutIsPossible);
    return nk ? { lang: t.lang, path: store.lists[nk].folderPath, title: store.lists[nk].title } : null;
  }

  /** Expandable language → folder → undone-list buttons in the panel. */
  function renderScoutList() {
    const box = document.getElementById('ep-scout-list');
    if (!box) return;
    box.textContent = '';
    const all = scoutLoad();
    for (const lang of Object.keys(all).sort()) {
      const undone = Object.values(all[lang].lists || {}).filter(l => !l.done && scoutIsPossible(l));
      const group = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = lang + ' (' + undone.length + ' undone)';
      group.appendChild(sum);
      const byFolder = {};
      undone.forEach(l => (byFolder[l.folderPath.join(' › ') || '(root)'] = byFolder[l.folderPath.join(' › ') || '(root)'] || []).push(l));
      for (const folder of Object.keys(byFolder)) {
        const fd = document.createElement('details');
        const fs = document.createElement('summary');
        fs.textContent = folder + ' (' + byFolder[folder].length + ')';
        fd.appendChild(fs);
        for (const l of byFolder[folder]) {
          const b = document.createElement('button');
          b.className = 'scout-list-btn';
          b.textContent = l.title + (l.progress ? ' · ' + l.progress + '%' : '');
          b.addEventListener('click', () => scoutLaunch({ lang, path: l.folderPath, title: l.title }));
          fd.appendChild(b);
        }
        group.appendChild(fd);
      }
      box.appendChild(group);
    }
  }

  // ── Main Hunter tick (Phase 3 hardened) ──────────────────────────────────
  //   Phase 3 helpers used inside hunterTick:
  //   - hunterDefer() schedules a callback; tracks handle in
  //     hunterDelayedTimers so STOP / page-change can clear them.
  //   - hunterSetState() transitions AND bumps hunterStateEntryMs so the
  //     watchdog can detect staleness.
  //   - hunterWatchdog() runs at the top of every tick — if Hunter has
  //     been stuck in a state for stuckStateMs or idle for watchdogMs,
  //     it force-resets to IDLE so we never spin forever.
  //   - try/catch wraps the whole tick so a thrown bug in any helper
  //     just resets the state — never wedges the loop.
  // ──────────────────────────────────────────────────────────────────────────

  function hunterDefer(fn, ms) {
    const safe = clampMs(ms, CFG.hunter.safeMinDelayMs, CFG.hunter.safeMaxDelayMs);
    const h = setTimeout(() => {
      // Remove ourselves from the tracker, then run.
      const i = hunterDelayedTimers.indexOf(h);
      if (i !== -1) hunterDelayedTimers.splice(i, 1);
      try { fn(); } catch (e) { console.warn('[Hunter] deferred fn threw', e); }
    }, safe);
    hunterDelayedTimers.push(h);
    return h;
  }

  function hunterSetState(next) {
    if (next === hunterState) return;
    hunterPrevState    = hunterState;
    hunterState        = next;
    hunterStateEntryMs = Date.now();
    if (next !== 'TYPING') hunterTypingTransitionScheduled = false;
  }

  function hunterWatchdog() {
    if (!hunterEnabled) return;
    const now = Date.now();
    const stuck = now - hunterStateEntryMs;
    if (stuck > CFG.hunter.stuckStateMs &&
        hunterState !== 'IDLE' &&
        !hunterHumanSuspended) {
      console.warn('[Hunter] Watchdog: stuck in', hunterState, 'for',
                   Math.floor(stuck/1000), 's — resetting to IDLE');
      hunterSetState('IDLE');
      lastFilled = '';
      hunterAdvancing = false;
      hunterNoAdvance = 0;
      hunterQuestion = '';
      showToast('🛟 Hunter unstuck (was in ' + hunterPrevState + ')');
      updateHunterDebug();
    }
    if (now - hunterLastActiveMs > CFG.hunter.watchdogMs) {
      console.warn('[Hunter] Global watchdog: no activity for',
                   Math.floor((now - hunterLastActiveMs) / 1000), 's');
      hunterLastActiveMs = now;
      showToast('🛟 Hunter reset — returning to idle');
      hunterSetState('IDLE');
    }
  }

  // ── Per-list pipeline: Reading → Writing → list complete → next list ────────

  /** Change the stage and persist it (scouted lists keep it in ep.scout.current). */
  function hunterSetStage(stage) {
    hunterListStage = stage;
    if (scoutCurrent) scoutSetCurrent(scoutCurrent);
  }

  /** Forget everything about the run that just ended; the next one starts clean. */
  function hunterResetListRun() {
    hunterListPlayed = false;
    if (scoutCurrent) { scoutCurrent.played = false; scoutSetCurrent(scoutCurrent); }
    hunterQuestion = ''; lastFilled = ''; hunterVerdictHandledKey = ''; hunterAdvancing = false;
    scoutNoQuestionSince = 0; scoutStarterTicks = 0; scoutGameIds = '';
    hunterStartWaitSince = 0; hunterStartRetriggered = false; hunterStartTimedOut = false; hunterModeTries = 0;
    hunterDecisionKey = '';
    hunterSetState('IDLE');
  }

  /** From a finished game back to the list's starter: Back lands in the folder
   *  view (verified live), then the list row opens the starter again (SPA, no
   *  reload). Resolves false when the row can't be found. */
  async function hunterReopenList() {
    const title = (scoutCurrent && scoutCurrent.title) || scoutLastRowTitle;
    if (!title) return false;
    if (/\/(game|list-starter)/i.test(window.location.pathname)) {
      const before = window.location.href;
      window.history.back();
      await scoutSettle(before);
    }
    if (!hunterEnabled) return false;
    const row = scoutRows().find(x => !x.folder && x.title === title);
    return !!(row && safeClick(row.row));
  }

  /** A mode run is over (finished). Count it, get back to the list's starter and
   *  let hunterStartWhenReady() read what is left there: a mode that is not 100%
   *  runs (again), and only when Reading and Writing are both learnt is the
   *  list complete (hunterListComplete). */
  function hunterStageDone() {
    if (hunterListSleepScheduled) return;
    hunterListSleepScheduled = true;
    const finished = scoutCurrent;
    const ran = hunterListStage;
    hunterModeRuns[ran]++;
    scoutLogFinish(scoutFinishRule || 'detectListDone');
    scoutFinishRule = '';
    const sleepMs = clampMs(CFG.hunter.betweenListDelay, CFG.hunter.safeMinDelayMs, CFG.hunter.safeMaxDelayMs);
    showToast((ran === 'writing' ? '✍️ Writing' : '📖 Reading') + ' run finished · checking what is left in ' +
              (sleepMs / 1000).toFixed(1) + 's…');
    hunterDefer(() => {
      hunterListSleepScheduled = false;
      hunterResetListRun();
      if (/\/list-starter/i.test(window.location.pathname)) return; // start gate reads the modes
      hunterReopenList().then(ok => {
        if (ok || !hunterEnabled) return;
        if (finished) scoutLaunch({ lang: finished.lang, path: finished.path, title: finished.title, stage: ran });
        else { showToast('⚠️ Could not reopen the list — moving on'); beginHunterNavigation(); }
      });
    }, sleepMs);
  }

  /** Reading and Writing are both learnt: mark the list done in ep.scout (it
   *  leaves the panel until a re-scout) and move on to the next undone list. */
  function hunterListComplete() {
    if (hunterListSleepScheduled) return;
    hunterListSleepScheduled = true;
    const finished = scoutCurrent;
    const sleepMs = clampMs(CFG.hunter.betweenListDelay, CFG.hunter.safeMinDelayMs, CFG.hunter.safeMaxDelayMs);
    const secs = (sleepMs / 1000).toFixed(1);
    if (finished) scoutMarkDone(finished);
    showToast('🏁 List complete (Reading + Writing) · 💤 next list in ' + secs + 's…');
    hunterDefer(() => {
      hunterListSleepScheduled = false;
      hunterSetStage('reading');
      hunterResetListRun();
      if (finished) {
        const nextList = scoutNextAfter(finished);
        scoutSetCurrent(null);
        if (nextList) scoutLaunch(nextList);
        else { showToast('🏁 No more scouted lists — Hunter stopped'); stopHunter(); }
      } else if (CFG.hunter.autoContinueLists) {
        if (hunterEnabled) beginHunterNavigation();
      } else {
        showToast('🏁 List complete — Hunter stopped');
        stopHunter();
      }
    }, sleepMs);
  }

  /** Idle auto-start on a list-starter, vocab-gated: never selects a mode or
   *  clicks Start before the vocab grid was read (`vocabFromGrid`; learned pairs
   *  hydrated by startHunter() don't count). Runs once per tick; STOP and page
   *  changes cancel it by stopping the tick / resetting the wait. */
  function hunterStartWhenReady() {
    if (hunterListPlayed || hunterListSleepScheduled) return;   // finish check / stage switch pending
    if (scoutCurrent && scoutCurrent.played) return;
    const now = Date.now();
    if (!hunterStartWaitSince) hunterStartWaitSince = now;
    const waited = now - hunterStartWaitSince;
    const ready = vocabFromGrid && !!document.querySelector(SEL.targetLang);
    const gate = startGate(true, ready, waited, CFG.hunter.startWaitMs);
    if (gate !== 'ready') {
      setDebug('⏳ Waiting for vocab…');
      if (!hunterStartRetriggered && waited > CFG.hunter.startRetriggerMs) {
        hunterStartRetriggered = true;
        console.log('[Hunter] Vocab not read yet — loading again');
        fullList();
      }
      if (gate === 'timeout' && !hunterStartTimedOut) {
        hunterStartTimedOut = true;
        showToast('⚠️ Vocab did not load — not starting this list');
      }
      return;
    }

    // What is left? Read the starter's per-mode progress: Reading first, then
    // Writing; a mode that is not 100% (also one that just ran) is run (again).
    const readingItem = hunterPickMode('reading'), writingItem = hunterPickMode('writing');
    const capped = m => hunterModeRuns[m] >= CFG.hunter.maxModeRuns;
    const status = (item, m) => { const s = hunterModeStatus(item); return s === 'open' && capped(m) ? 'learnt' : s; };
    const rs = status(readingItem, 'reading'), ws = status(writingItem, 'writing');
    if (rs === 'absent' && ws === 'absent' && waited <= CFG.hunter.startWaitMs) return;   // mode items not rendered yet
    let mode = remainingMode(rs, ws);
    if (mode === undefined) {
      // No readable per-mode progress on this starter: fall back to the stage
      // order (Reading → Writing → complete), one run per mode.
      mode = hunterListStage === 'writing' ? 'writing' : 'reading';
      while (mode && hunterModeRuns[mode] > 0) mode = nextStage(mode);
    }
    // The reading must hold still for modeSettleMs before it is trusted (the
    // progress can lag behind a run that just ended).
    const decision = mode + '|' + rs + ',' + ws;
    if (decision !== hunterDecisionKey) { hunterDecisionKey = decision; hunterDecisionSince = now; return; }
    if (now - hunterDecisionSince < CFG.hunter.modeSettleMs) return;
    if (mode === null) {
      if (capped('reading') || capped('writing')) console.warn('[Hunter] mode run cap reached — treating the list as complete');
      console.log('[Hunter] Reading + Writing both done');
      hunterListComplete();
      return;
    }
    if (mode !== hunterListStage) hunterSetStage(mode);
    const pick = mode === 'writing' ? writingItem : readingItem;
    if (pick && !pick.classList.contains('selected')) {
      if (++hunterModeTries > 8) {
        if (!hunterStartTimedOut) { hunterStartTimedOut = true; showToast('⚠️ Could not select ' + mode + ' mode'); }
        return;
      }
      console.log('[Hunter] Selecting ' + mode + ' mode');
      safeClick(pick);                                // verified `selected` on the next tick
      return;
    }
    if (clickHunterStartButton()) {
      console.log('[Hunter] Start (' + mode + ') after vocab loaded in ' + waited + ' ms');
      hunterStartWaitSince = 0; hunterModeTries = 0; hunterDecisionKey = '';
    }
  }

  function hunterTick() {
    if (!hunterEnabled || !CFG.hunter.enabled || pageChanging) return;

    try {
      // URL-change detection (SPA navigation).
      const url = window.location.href.toLowerCase();
      if (hunterLastPageUrl && hunterLastPageUrl !== url &&
          !url.includes('list-starter') && !url.includes('game') &&
          !url.includes('activity-starter')) {
        hunterSetState('IDLE');
        hunterQuestion  = '';
        lastFilled      = '';
        hunterAdvancing = false;
        console.log('[Hunter] SPA nav away — reset to IDLE');
      }
      hunterLastPageUrl = url;

      // Human-presence suspension.
      if (hunterHumanSuspended) {
        setDebug('👤 Human typing — Hunter idle');
        return;
      }

      // Watchdog first so nothing below can loop forever.
      hunterWatchdog();
      hunterLastActiveMs = Date.now();

      // Auto-continue / Skip list navigation spans several SPA screens; keep
      // driving it every tick until the next list's Start button was clicked.
      if (hunterNavigationPending) {
        driveHunterNavigation();
        return;
      }

      // A list the user started by hand: track it if it was scouted.
      if (!scoutCurrent) scoutAdoptCurrent();

    // LIST_DONE short-circuit: detected at top, even mid-state. A tracked list
    // uses the played-list rules; otherwise the generic detector, which only
    // counts once a question was seen (an unplayed list's starter screen also
    // reads Continue/Restart).
    const played = scoutCurrent ? scoutCurrent.played : hunterListPlayed;
    const finishedNow = played && (detectScoutFinished() ||
      (scoutCurrent ? url.includes('game') && detectListDone() : detectListDone()));
    if (finishedNow &&
        hunterState !== 'LIST_DONE' &&
        hunterState !== 'ADVANCE') {
      console.log('[Hunter] Detected list-complete state');
      hunterSetState('LIST_DONE');
      updateHunterDebug();
    }

    switch (hunterState) {

      case 'IDLE': {
        const word = getQuestionWord();
        if (word) {
          hunterQuestion       = word;
          hunterQuestionStart  = Date.now();
          hunterQuestionStartMs = Date.now();
          hunterListPlayed     = true;
          if (scoutCurrent && !scoutCurrent.played) {
            scoutCurrent.played = true;
            scoutSetCurrent(scoutCurrent);
          }
          hunterSetState('DETECTED');
          hunterNoAdvance      = 0;
          console.log('[Hunter] DETECTED:', word);
          updateHunterDebug();
        }
        break;
      }

      case 'DETECTED': {
        // Question visible, wait for tryFill() pipeline to start typing. The
        // direct transition in tryFill() covers zero-delay answers that finish
        // between two 500 ms Hunter ticks; this fallback covers slower input.
        if (filling || (hunterQuestion && lastFilled.startsWith(hunterQuestion + '→'))) {
          hunterSetState('TYPING');
          console.log('[Hunter] TYPING');
          setDebug('⌨️ Typing answer…');
        }
        break;
      }

      case 'TYPING': {
        // Pipeline finished; transition to verdict polling after EP has
        // had a moment to submit + grade. Only arm this once: the 500 ms
        // tick must not queue a second transition for the same answer.
        if (!filling && !hunterTypingTransitionScheduled) {
          hunterTypingTransitionScheduled = true;
          hunterDefer(() => {
            hunterTypingTransitionScheduled = false;
            if (hunterState === 'TYPING') hunterSetState('AWAIT_VERDICT');
          }, Math.max(120, CFG.typeCooldown * 1000));
        }
        break;
      }

      case 'AWAIT_VERDICT': {
        const verdict = detectVerdict();
        if (!verdict) break; // still waiting

        // EP can leave the feedback DOM mounted for more than one tick. The
        // state transition normally protects us, while this key also guards
        // against a synchronous re-entry from MutationObserver callbacks.
        const verdictKey = `${hunterQuestion}|${lastFilled}|${verdict}`;
        if (verdictKey === hunterVerdictHandledKey) break;
        hunterVerdictHandledKey = verdictKey;

        if (verdict === 'incorrect') {
          hunterScore.incorrect++;
          hunterQuestionsAnswered++;
          recordQuestionDuration();
          console.log('[Hunter] Verdict: INCORRECT');

          const policy = CFG.hunter.errorPolicy;
          let learned = null;
          if (policy === 'learn' || policy === 'hybrid') {
            try { learned = learnFromError(); }
            catch (e) { console.warn('[Hunter] learnFromError threw', e); }
          }

          // The exact EP #continue-button is the primary learn-and-advance
          // path. Move to ADVANCE immediately and arm hunterAdvancing so the
          // next tick cannot click the same overlay twice.
          const continued = clickContinueButton();
          if (!continued) dismissWrongAnswer();
          hunterAdvancing    = continued;
          hunterAdvanceReadyAt = Date.now() + clampMs(CFG.hunter.advanceDelay, CFG.hunter.safeMinDelayMs, CFG.hunter.safeMaxDelayMs);
          hunterSetState('ADVANCE');
          hunterDefer(() => {
            if (hunterState === 'ADVANCE') {
              hunterAdvancing = false;
              hunterSetState('IDLE');
              hunterQuestion = '';
              lastFilled = '';
              updateHunterDebug();
            }
          }, CFG.hunter.advanceDelay);
          if (learned) {
            showToast('🧠 Learned “' + learned.slice(0, 22) + '” · Next...');
          } else if (policy !== 'dismiss') {
            showToast('❌ Wrong · continuing...');
          }
          updateHunterDebug();
        } else if (verdict === 'correct') {
          hunterScore.correct++;
          hunterQuestionsAnswered++;
          recordQuestionDuration();
          console.log('[Hunter] Verdict: CORRECT');
          setDebug('✅ Correct — advancing');
          hunterAdvanceReadyAt = Date.now() + clampMs(CFG.hunter.advanceDelay, CFG.hunter.safeMinDelayMs, CFG.hunter.safeMaxDelayMs);
          hunterSetState('ADVANCE');
          updateHunterDebug();
        } else if (verdict === 'unknown') {
          console.log('[Hunter] Verdict: UNKNOWN — advancing');
          hunterSetState('ADVANCE');
          updateHunterDebug();
        }
        break;
      }

      case 'ADVANCE': {
        if (hunterAdvancing || Date.now() < hunterAdvanceReadyAt) break;
        hunterAdvancing = true;
        console.log('[Hunter] ADVANCE: clicking Next…');

        const advanced = clickAdvanceButton();
        if (advanced) {
          hunterNoAdvance = 0;
          hunterAdvancing = false;

          // Soft cap on questions per run.
          if (CFG.hunter.maxQuestionsPerRun > 0 &&
              hunterQuestionsAnswered >= CFG.hunter.maxQuestionsPerRun) {
            showToast('🕵️ Reached cap (' + CFG.hunter.maxQuestionsPerRun + ') — stopping');
            stopHunter();
            return;
          }
          hunterDefer(() => {
            if (hunterState === 'ADVANCE') {
              hunterSetState('IDLE');
              hunterQuestion = '';
              lastFilled = '';
              updateHunterDebug();
            }
          }, CFG.hunter.advanceDelay);
        } else {
          hunterNoAdvance++;
          if (detectListDone()) {
            hunterAdvancing = false;
            hunterSetState('LIST_DONE');
            updateHunterDebug();
            break;
          }
          // Hard cap on consecutive failed advance clicks.
          if (hunterNoAdvance >= CFG.hunter.maxAdvanceAttempts) {
            console.warn('[Hunter] Too many failed advance clicks — stopping');
            showToast('🛑 Can’t find Next button (Hunter stopped)');
            stopHunter();
            return;
          }
          hunterDefer(() => {
            hunterAdvancing = false;
            if (hunterState === 'ADVANCE') {
              hunterSetState('IDLE');
              hunterQuestion = '';
              lastFilled = '';
            }
            // Try again to click start buttons after many failures.
            if (hunterNoAdvance >= 5) {
              if (CFG.hunter.autoStart) {
                if (url.includes('list-starter') && vocabUnlocked && vocabFromGrid) {
                  const sm = queryVisible('#start-button-main');
                  if (sm) safeClick(sm);
                } else if (url.includes('activity-starter')) {
                  const ss = queryVisible('#start-button-school');
                  if (ss) safeClick(ss);
                }
              }
            }
            updateHunterDebug();
          }, Math.max(CFG.hunter.advanceDelay, 1000));
        }
        break;
      }

      case 'LIST_DONE': {
        console.log('[Hunter] List / task complete.');
        // Only a run whose questions were seen is finished (a starter screen
        // also reads Continue/Restart). Reading → Writing → next list.
        if (!(scoutCurrent ? scoutCurrent.played : hunterListPlayed)) { hunterSetState('IDLE'); break; }
        hunterStageDone();
        return;
      }
    }

    // Idle auto-start: keep Hunter busy by clicking start buttons on the
    // right page.
    if (CFG.hunter.autoStart && hunterState === 'IDLE') {
      if (url.includes('list-starter') && vocabUnlocked) {
        hunterStartWhenReady();   // vocab-gated; picks Reading/Writing, then Start
      } else {
        hunterStartWaitSince = 0;
        if (url.includes('activity-starter')) {
          const startSchool = queryVisible('#start-button-school');
          if (startSchool) safeClick(startSchool);
        }
      }
    }
    } catch (e) {
      // A thrown bug somewhere inside the tick should NEVER wedge the loop.
      console.warn('[Hunter] tick threw; resetting to IDLE:', e);
      hunterSetState('IDLE');
      hunterAdvancing = false;
      hunterQuestion  = '';
      lastFilled      = '';
      updateHunterDebug();
    }
  }

  // ── Debug / start / stop (Phase 2) ─────────────────────────────────────────

  /** ── Phase 4: record the duration of a finished question so the rolling
   *  ETA stays accurate. Keeps only the last 80 samples. */
  function recordQuestionDuration() {
    if (!hunterQuestionStartMs) return;
    const dur = Date.now() - hunterQuestionStartMs;
    if (dur > 0 && dur < 600000) {
      hunterQuestionTimes.unshift(dur);
      if (hunterQuestionTimes.length > 80) hunterQuestionTimes.pop();
    }
    hunterQuestionStartMs = Date.now();
  }

  /** Format `ms` as `Xm Ys` or `Ys`. Compact, easy to embed in toast / panel. */
  function fmtDuration(ms) {
    ms = Math.max(0, Math.round(ms / 1000));
    if (ms < 60) return ms + 's';
    const m = Math.floor(ms / 60);
    const s = ms % 60;
    return m + 'm ' + s + 's';
  }

  /** Update the progress badge element (added by Phase 4 CSS).
   *  Format: `⚡ 37/120 · ~1m 12s left` (or `⚡ 4 questions · ~5s/q`). */
  function updateProgressBadge() {
    if (!hunterBadgeEl) return;
    if (!hunterEnabled) {
      hunterBadgeEl.style.display = 'none';
      return;
    }
    hunterBadgeEl.style.display = 'block';
    const total = hunterQuestionsAnswered;
    const avg = hunterQuestionTimes.length
      ? Math.round(hunterQuestionTimes.reduce((a, b) => a + b, 0) / hunterQuestionTimes.length)
      : 0;
    if (total === 0) {
      hunterBadgeEl.textContent = '⚡ ready · measuring pace…';
    } else if (avg > 0) {
      hunterBadgeEl.textContent =
        '⚡ ' + total + (avg >= 1000 ? ' answered' : ' answered') +
        ' · ~' + fmtDuration(avg) + '/q';
    } else {
      hunterBadgeEl.textContent = '⚡ ' + total + ' answered';
    }
  }

  /** Start the ETA updater (1Hz) so the badge stays live without layout thrash. */
  function startEtaTicker() {
    if (hunterEtaTimer) clearInterval(hunterEtaTimer);
    hunterEtaTimer = setInterval(() => updateProgressBadge(), 1000);
  }
  function stopEtaTicker() {
    if (hunterEtaTimer) { clearInterval(hunterEtaTimer); hunterEtaTimer = null; }
    updateProgressBadge();
  }

  /** Update the panel debug line with current Hunter progress + state emoji. */
  function updateHunterDebug() {
    updateProgressBadge();
    if (!debugEl) return;
    const elapsed = hunterStartTime ? Math.floor((Date.now() - hunterStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const stateEmoji = {
      IDLE: '🕵️', DETECTED: '👀', TYPING: '⌨️',
      AWAIT_VERDICT: '⏳', ADVANCE: '⏩', LIST_DONE: '🏁',
    }[hunterState] || '🕵️';
    let msg = `${stateEmoji} ${hunterScore.correct}✓ ${hunterScore.incorrect}✗`;
    if (elapsed > 0) msg += ` · ${mins}m${secs}s`;
    msg += ` · ${hunterState}`;
    if (hunterQuestion) {
      const short = hunterQuestion.length > 15 ? hunterQuestion.slice(0, 15) + '…' : hunterQuestion;
      msg += ` · "${short}"`;
    }
    setDebug(msg);
  }

  /** Start Hunter Mode. Idempotent. */
  function startHunter() {
    // Cancel any prior instantiation cleanly (Phase 3 robustness).
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    clearHunterDelayedTimers();
    removeHumanListeners();

    hunterEnabled          = true;
    hunterState            = 'IDLE';
    hunterPrevState        = 'IDLE';
    hunterStateEntryMs     = Date.now();
    hunterLastPageUrl      = window.location.href.toLowerCase();
    hunterLastActiveMs     = Date.now();
    hunterQuestion         = '';
    hunterAdvancing        = false;
    hunterScore            = { correct: 0, incorrect: 0 };
    hunterStartTime        = Date.now();
    hunterNoAdvance        = 0;
    hunterQuestionStart    = 0;
    hunterHumanActive      = false;
    hunterHumanSuspended   = false;
    hunterQuestionsAnswered = 0;
    hunterQuestionTimes     = [];
    hunterQuestionStartMs   = 0;
    hunterVerdictHandledKey = '';
    hunterStartWaitSince    = 0;
    hunterStartRetriggered  = false;
    hunterStartTimedOut     = false;
    hunterModeTries         = 0;
    resetHunterNavigation();
    if (hunterHumanTimer) {
      clearTimeout(hunterHumanTimer);
      hunterHumanTimer = null;
    }

    // Hydrate answerMap with previously-learned pairs from localStorage.
    loadLearnedAnswers();

    // Wire all human-presence listeners (capture phase, so we beat EP).
    addHumanListeners();

    hunterTimer = setInterval(hunterTick, 500);
    startEtaTicker();
    console.log('[Hunter] Started (Phase 3 hardened; errorPolicy=' + CFG.hunter.errorPolicy + ')');
    showToast('🕵️ Hunter mode ON');
    setDebug('🕵️ Hunter ready');

    if (hunterBtn) {
      hunterBtn.classList.add('hunter-active');
      hunterBtn.textContent = '🕵️ ON';
    }
  }

  /** Helper: clear every hunterDefer() timeout so no stale callbacks fire. */
  function clearHunterDelayedTimers() {
    for (const h of hunterDelayedTimers) {
      try { clearTimeout(h); } catch (e) {}
    }
    hunterDelayedTimers = [];
  }

  /** Helper: attach all human-presence event listeners. */
  function addHumanListeners() {
    document.addEventListener('keydown', onHumanInteraction, true);
    document.addEventListener('click',   onHumanInteraction, true);
    document.addEventListener('input',   onHumanInteraction, true);
    document.addEventListener('paste',   onHumanInteraction, true);
    document.addEventListener('wheel',   onHumanInteraction, true);
    document.addEventListener('scroll',  onHumanInteraction, true);
  }

  /** Helper: detach all human-presence listeners. Symmetric with addHumanListeners. */
  function removeHumanListeners() {
    document.removeEventListener('keydown', onHumanInteraction, true);
    document.removeEventListener('click',   onHumanInteraction, true);
    document.removeEventListener('input',   onHumanInteraction, true);
    document.removeEventListener('paste',   onHumanInteraction, true);
    document.removeEventListener('wheel',   onHumanInteraction, true);
    document.removeEventListener('scroll',  onHumanInteraction, true);
  }

  /** Stop Hunter Mode. Idempotent. `quiet` skips the session-summary toast
   *  (used by the STOP kill-switch, which shows its own). */
  function stopHunter(quiet) {
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    clearHunterDelayedTimers();
    resetHunterNavigation();
    hunterEnabled          = false;
    hunterAdvancing        = false;
    hunterListStage        = 'reading';   // the next run starts with Reading again
    hunterStartWaitSince   = 0;
    stopEtaTicker();
    hunterState            = 'IDLE';
    hunterAdvancing        = false;
    hunterQuestion         = '';
    hunterHumanActive      = false;
    hunterHumanSuspended   = false;
    if (hunterHumanTimer) {
      clearTimeout(hunterHumanTimer);
      hunterHumanTimer = null;
    }
    removeHumanListeners();

    console.log('[Hunter] Stopped');

    const total = hunterScore.correct + hunterScore.incorrect;
    if (quiet) {
      // caller shows its own toast
    } else if (total > 0) {
      const pct = Math.round((hunterScore.correct / total) * 100);
      const elapsed = Math.floor((Date.now() - hunterStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      showToast(`🕵️ Session: ${hunterScore.correct}/${total} (${pct}%) · ${mins}m${secs}s`);
    } else {
      showToast('🕵️ Hunter mode OFF');
    }
    setDebug('');

    if (hunterBtn) {
      hunterBtn.classList.remove('hunter-active');
      hunterBtn.textContent = '🕵️ Hunter';
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  let panel, countEl, toggleBtn, debugEl, autoBtn, aiBtn,
      hunterBtn, skipBtn, stopBtn, scoutBtn;

  function setDebug(msg) { if (debugEl) debugEl.textContent = msg; }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #ep-panel{position:fixed;top:72px;right:16px;z-index:2147483647;width:240px;
        background:#0f1120;border:1px solid #222540;border-radius:14px;
        box-shadow:0 12px 44px rgba(0,0,0,.65);
        font:13px/1.45 'Segoe UI',system-ui,sans-serif;color:#c4ccec;user-select:none}
      #ep-handle{display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border-bottom:1px solid #1c2040;cursor:grab}
      #ep-handle:active{cursor:grabbing}
      #ep-logo{font-weight:700;color:#6aa3f8}
      #ep-x{background:none;border:none;color:#666;font-size:16px;cursor:pointer}
      #ep-body{padding:14px}
      #ep-count{font-size:12px;margin-bottom:12px}
      #ep-count.ok{color:#4ad97d}#ep-count.warn{color:#ffb347}
      #ep-btns{display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap}
      .ep-btn{flex:1;min-width:45px;padding:7px 4px;border:none;border-radius:8px;cursor:pointer;
        background:#1b213a;color:#c4ccec;font-weight:600;font-size:11px;transition:all .15s}
      .ep-btn:hover{background:#28304d}
      .ep-btn.hunter-active{background:#1b6d2a !important;
        box-shadow:0 0 10px rgba(74,217,125,.55);color:#fff}
      .ep-btn.skip-btn{background:#6d3f1b !important}
      .ep-btn.skip-btn:hover{background:#8a5225 !important}
      .ep-btn.stop-btn{background:#6d2222 !important}
      .ep-btn.stop-btn:hover{background:#8a2c2c !important}
      .paused{background:#6d2222 !important}
      .ep-btn.scout-btn{background:#1b3f6d !important}
      .ep-btn.scout-btn:hover{background:#25528a !important}
      #ep-scout-list{max-height:240px;overflow:auto;margin-bottom:8px;font-size:11px}
      #ep-scout-list summary{cursor:pointer;color:#6aa3f8;margin:3px 0}
      #ep-scout-list details details{margin-left:8px}
      .scout-list-btn{display:block;width:100%;text-align:left;margin:2px 0;padding:5px 7px;
        background:#1b213a;color:#c4ccec;border:none;border-radius:6px;cursor:pointer;font-size:11px}
      .scout-list-btn:hover{background:#28304d}
      #ep-badge{display:none;margin-bottom:8px;padding:5px 8px;border-radius:8px;
        background:#14301c;color:#4ad97d;font-size:11px;font-weight:600}
      #ep-hint{font-size:11px;color:#68708f;line-height:1.5}
      #ep-debug{margin-top:10px;font-size:10px;color:#58607a;word-break:break-word}
      #ep-toast{position:fixed;bottom:22px;right:18px;z-index:2147483647;
        background:#0f1120;border:1px solid #222540;border-radius:11px;
        padding:10px 17px;color:#c4ccec;box-shadow:0 8px 32px rgba(0,0,0,.6);
        opacity:0;transform:translateY(7px);transition:opacity .18s,transform .18s;
        pointer-events:none;max-width:270px}
      #ep-toast.show{opacity:1;transform:translateY(0)}
    `;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'ep-panel';
    panel.innerHTML = `
      <div id="ep-handle">
        <span id="ep-logo">EP Assistant</span>
        <button id="ep-x">✕</button>
      </div>
      <div id="ep-body">
        <div id="ep-count">Not loaded</div>
        <div id="ep-btns">
          <button class="ep-btn" id="ep-auto">Auto</button>
          <button class="ep-btn" id="ep-load">Load</button>
          <button class="ep-btn" id="ep-toggle">⏸ Pause</button>
          <button class="ep-btn" id="ep-ai">AI</button>
        </div>
        <div id="ep-btns2" style="display:flex;gap:5px;margin-bottom:5px">
          <button class="ep-btn" id="ep-hunter">🕵️ Hunter</button>
          <button class="ep-btn skip-btn" id="ep-skip">⏭ Skip list</button>
        </div>
        <div id="ep-btns3" style="display:flex;gap:5px;margin-bottom:8px">
          <button class="ep-btn stop-btn" id="ep-stop">🛑 STOP</button>
        </div>
        <div id="ep-btns4" style="display:flex;gap:5px;margin-bottom:8px">
          <button class="ep-btn scout-btn" id="ep-scout">🔭 Scout</button>
          <button class="ep-btn scout-btn" id="ep-scout-all">🌍 All languages</button>
        </div>
        <div id="ep-scout-list"></div>
        <div id="ep-badge"></div>
        <div id="ep-hint">Select a task to activate.</div>
        <div id="ep-debug"></div>
      </div>
    `;
    document.body.appendChild(panel);

    countEl    = panel.querySelector('#ep-count');
    toggleBtn  = panel.querySelector('#ep-toggle');
    debugEl    = panel.querySelector('#ep-debug');
    autoBtn    = panel.querySelector('#ep-auto');
    aiBtn      = panel.querySelector('#ep-ai');
    hunterBtn  = panel.querySelector('#ep-hunter');
    skipBtn    = panel.querySelector('#ep-skip');
    stopBtn    = panel.querySelector('#ep-stop');
    hunterBadgeEl = panel.querySelector('#ep-badge');
    scoutBtn   = panel.querySelector('#ep-scout');
    scoutBtn.addEventListener('click', () => scoutCrawl(false));
    panel.querySelector('#ep-scout-all').addEventListener('click', () => scoutCrawl(true));
    renderScoutList();

    autoBtn.addEventListener('click', () => {
      showToast('Auto mode');
      auto = !auto;
      autoBtn.textContent = auto ? 'Auto' : 'Manual';
      if (vocabUnlocked && auto) fullList();
    });
    panel.querySelector('#ep-load').addEventListener('click', fullList);
    panel.querySelector('#ep-x').addEventListener('click', () => { panel.style.display = 'none'; });
    toggleBtn.addEventListener('click', () => {
      enabled = !enabled;
      toggleBtn.textContent = enabled ? '⏸ Pause' : '▶ Resume';
      toggleBtn.classList.toggle('paused', !enabled);
      showToast(enabled ? '▶ Resumed' : '⏸ Paused');
    });
    aiBtn.addEventListener('click', () => showToast('🤖 AI mode'));

    // ── Hunter toggle ──
    hunterBtn.addEventListener('click', () => {
      if (hunterEnabled) {
        scoutSetCurrent(null);
        stopHunter();
      } else {
        startHunter();
      }
    });

    // ── Skip button ──
    skipBtn.addEventListener('click', () => skipToNextTask());

    // ── Kill-switch STOP button (Phase 2) ──
    stopBtn.addEventListener('click', () => {
      // STOP is a one-shot kill-switch that uses the same full teardown as
      // the Hunter toggle, so it is safe even if Hunter is already off.
      scoutCancel = true;
      scoutSetCurrent(null);
      stopHunter(true);
      showToast('🛑 Hunter killed');
    });

    makeDraggable(panel, panel.querySelector('#ep-handle'));
    updatePanelVisibility();
  }

  function updatePanel(count) {
    if (!countEl) return;
    countEl.textContent = count > 0 ? `✅ ${count} pairs loaded` : '❌ No vocab found';
    countEl.className   = count > 0 ? 'ok' : 'warn';
  }

  let toastEl, toastTimer;
  function showToast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id='ep-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), CFG.toastDuration);
  }

  function makeDraggable(el, handle) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const r=el.getBoundingClientRect(),ox=e.clientX-r.left,oy=e.clientY-r.top;
      const mv=e=>{el.style.right='auto';el.style.left=(e.clientX-ox)+'px';el.style.top=(e.clientY-oy)+'px'};
      const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up)};
      document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
    });
  }

  function updatePanelVisibility() {
    const url = window.location.href.toLowerCase();
    if (url.includes('list-starter')) vocabUnlocked = true;
    if (url.includes('activity-starter')) aiUnlocked = true;
    if (vocabUnlocked && !url.includes('list-starter') && !url.includes('game')) {
      vocabUnlocked = false;
      vocabFromGrid = false;
      answerMap     = {};
      if (panel) panel.querySelector('#ep-count').textContent = 'Not loaded';
    }
    if (aiUnlocked && !url.includes('activity-starter') && !url.includes('game')) {
      aiUnlocked = false;
    }

    const loadBtn   = document.querySelector('#ep-load');
    const pauseBtn  = document.querySelector('#ep-toggle');
    const countElDom= document.querySelector('#ep-count');
    const aiBtn     = document.querySelector('#ep-ai');
    const hunterBtn = document.querySelector('#ep-hunter');
    const skipBtn   = document.querySelector('#ep-skip');
    const stopBtn   = document.querySelector('#ep-stop');
    const btns2Row  = document.querySelector('#ep-btns2');
    const btns3Row  = document.querySelector('#ep-btns3');
    const hintTxt   = document.querySelector('#ep-hint');
    const debugTxt  = document.querySelector('#ep-debug');

    if (loadBtn)   loadBtn.style.display   = vocabUnlocked ? '' : 'none';
    if (pauseBtn)  pauseBtn.style.display  = vocabUnlocked ? '' : 'none';
    if (countElDom)countElDom.style.display = vocabUnlocked ? '' : 'none';
    if (aiBtn)     aiBtn.style.display     = aiUnlocked ? '' : 'none';

    // Show Hunter & Skip buttons on any task page.
    const isTaskPage = url.includes('list-starter') || url.includes('activity-starter') || url.includes('game');
    if (btns2Row)  btns2Row.style.display  = isTaskPage ? 'flex' : 'none';
    if (hunterBtn) hunterBtn.style.display = isTaskPage ? '' : 'none';
    if (skipBtn)   skipBtn.style.display   = isTaskPage ? '' : 'none';

    // Scout lives on the content browser (and stays reachable on task pages).
    const isContentPage = url.includes('/content') || url.includes('/learning/library');
    const btns4Row  = document.querySelector('#ep-btns4');
    const scoutBox  = document.querySelector('#ep-scout-list');
    if (btns4Row)  btns4Row.style.display  = isContentPage || isTaskPage ? 'flex' : 'none';
    if (scoutBox)  scoutBox.style.display  = isContentPage || isTaskPage ? '' : 'none';

    // Kill-switch STOP is visible whenever Hunter is enabled or any task
    // page is open, so the user can always force-quit Hunter.
    const showStop = isTaskPage || isContentPage || hunterEnabled;
    if (btns3Row)  btns3Row.style.display  = showStop ? 'flex' : 'none';
    if (stopBtn)   stopBtn.style.display   = showStop ? '' : 'none';

    if (hintTxt) hintTxt.style.display = hints ? '' : 'none';
    if (vocabUnlocked) hintTxt.innerHTML = hintsList.list;
    if (aiUnlocked)    hintTxt.innerHTML = hintsList.activity;
    if (debugTxt)      debugTxt.style.display = debug ? '' : 'none';

    if (url.includes('list-starter') && auto) {
      setTimeout(() => {
        const count = fullList();
        if (count === 0) showToast('⚠️ Open vocab list first then press Load');
      }, 500);
    }
  }

  function init() {
    buildPanel();
    const url = window.location.href.toLowerCase();
    if (url.includes('list-starter') && auto) {
      setTimeout(() => {
        const count = fullList();
        if (count === 0) showToast('⚠️ Open vocab list first then press Load');
      }, 4000);
    }
    startObserver();
    startPolling();
    updatePanelVisibility();
    scoutTrackRowClicks();
    scoutResumePending();
    scoutRestoreCurrent();

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        updatePanelVisibility();
      }
    }, 500);
    console.log('[EP Assistant v4.0.0] Ready (Hunter Phase 2)');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    setTimeout(init, 1000);

})();
