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

  // ── Hunter Mode Config (Phase 2) ───────────────────────────────────────────
  // Per-flag notes:
  //   enabled            master toggle; default OFF (user must opt in)
  //   advanceDelay       ms after verdict before clicking Next
  //   betweenListDelay   ms pause between finishing one list and starting the next
  //   errorPolicy        'dismiss' | 'learn' | 'hybrid' (default; auto-fallback)
  //   autoStart          auto-click #start-button-main / #start-button-school on idle
  //   autoContinueLists  when a list finishes, hunt straight into the next list
  //   maxQuestionsPerRun soft cap on questions before auto-stopping Hunter (0 = ∞)
  //   humanPresenceWindow  ms of real-user activity that pauses Hunter before
  //                         resuming automatically
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
      autoContinueLists  : false,
      maxQuestionsPerRun : 0,
      humanPresenceWindow: 1500,
    },
  };

  const SEL = {
    targetLang        : '.targetLanguage.question-label',
    baseLang          : '.baseLanguage.question-label',
    answerInput       : '#answer-text',
    prompt            : '.prompt.ng-binding',
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
  let aiUnlocked    = false;

  // ── Hunter Mode runtime state ─────────────────────────────────────────────
  // 6-state machine:
  //   IDLE          : waiting for a new question to appear
  //   DETECTED      : question visible, but tryFill hasn't started yet
  //   TYPING        : tryFill() is in progress (filling === true)
  //   AWAIT_VERDICT : answer submitted, polling EP DOM for correct/incorrect verdict
  //   ADVANCE       : verdict seen, clicking "Next question" / dismissing overlay
  //   LIST_DONE     : end-of-list reached (or no more next-list items)
  let hunterEnabled          = false;
  let hunterTimer            = null;
  let hunterState            = 'IDLE';
  let hunterQuestion         = '';
  let hunterAdvancing        = false;
  let hunterScore            = { correct: 0, incorrect: 0 };
  let hunterStartTime        = 0;
  let hunterNoAdvance        = 0;
  let hunterQuestionStart    = 0;

  // Phase 2: human-presence detector
  let hunterHumanActive      = false;
  let hunterHumanSuspended   = false;
  let hunterHumanTimer       = null;

  // Phase 2: learn-from-error + cap
  let hunterQuestionsAnswered = 0;

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
      .replace(/[^a-z0-9\s+\-*/x=]/g, '')
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
      document.getElementsByClassName("main-text ng-binding infinity")[0].click();
    }, 500);
  }

  function loadAnswers() {
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
    answerMap = map;
    lastFilled = '';
    cooldownUntil = 0;
    updatePanel(count);
    showToast(count > 0 ? `✅ ${count} pairs loaded` : `⚠️ No vocab found`);
    console.log('[EP] Loaded', count, 'pairs');
    document.getElementById("start-button-main-label").click();
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
    setDebug(`Typing: "${word}" → "${answer}"`);
    console.log(`[EP] "${word}" → "${answer}"`);

    try {
      await typeAtCursor(input, answer);
      showToast(`💡 ${answer.length > 48 ? answer.slice(0,48)+'…' : answer}`);
    } catch (e) {
      console.warn('[EP] Typing error:', e);
    }
    filling = false;
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
   *  Selectors verified in `Implement/(5) EP (8_4_2026 3：48：24 PM).html`.
   */
  function scrapeCorrectAnswer() {
    const field = document.getElementById('correct-answer-field');
    if (field) {
      const text = (field.textContent || '').trim();
      if (text && text.length > 0) return text;
    }
    const dialog = document.querySelector('.modeless-answer-dialog');
    if (dialog && dialog.offsetParent !== null) {
      const field2 = dialog.querySelector('#correct-answer-field, .field.native-font');
      if (field2) {
        const text = (field2.textContent || '').trim();
        if (text && text.length > 0) return text;
      }
    }
    return null;
  }

  /** Read the question word from the wrong-answer modal so we can attribute
   *  the learned answer to the correct key.
   */
  function scrapeQuestionFromModal() {
    const field = document.getElementById('question-field');
    if (field) {
      const text = (field.textContent || '').trim();
      if (text && text.length > 0) return text;
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
    // Use the modal's question when available; otherwise fall back to the
    // already-tracked hunterQuestion.
    const modalQuestion = scrapeQuestionFromModal();
    const qSrc = modalQuestion || hunterQuestion;
    if (!correctAnswer || !qSrc) return null;

    const q = norm(qSrc);
    const a = stripAlts(correctAnswer.trim());
    if (!q || !a) return null;

    // Bidirectional: q → a and (norm of a) → original word
    answerMap[q] = a;
    answerMap[norm(a)] = qSrc;

    try {
      let learned = {};
      const stored = localStorage.getItem(LEARNED_KEY);
      if (stored) {
        try { learned = JSON.parse(stored) || {}; } catch (e) { learned = {}; }
      }
      learned[q] = a;
      // Ring-buffer: keep the most recent LEARNED_CAP pairs.
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
    // A learn counts as a question for the soft stop-cap purposes.
    hunterQuestionsAnswered++;
    setDebug(`🧠 Learned "${qSrc}" → "${a}"`);
    return a;
  }

  /** Load previously-learned pairs from localStorage into answerMap.
   *  Called when Hunter starts so the script gets smarter on every launch.
   */
  function loadLearnedAnswers() {
    try {
      const stored = localStorage.getItem(LEARNED_KEY);
      if (!stored) return 0;
      const learned = JSON.parse(stored) || {};
      let count = 0;
      for (const [q, a] of Object.entries(learned)) {
        if (q && a && !answerMap[q]) {
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
   */
  function autoNextList() {
    const url = window.location.href.toLowerCase();

    if (url.includes('list-starter')) {
      const itemSelectors = [
        '#stats-parent .starter-panel .grouped-options > li.item',
        '#left-controls-panel .grouped-options > li.item',
        '.grouped-options > li.item',
      ];
      let items = [];
      for (const sel of itemSelectors) {
        items = [...document.querySelectorAll(sel)];
        if (items.length > 0) break;
      }
      if (items.length === 0) return false;

      let foundCurrent = false;
      for (const item of items) {
        if (foundCurrent) {
          item.click();
          console.log('[Hunter] autoNext: clicked sidebar item');
          return true;
        }
        if (item.classList.contains('selected') ||
            item.classList.contains('active')   ||
            item.classList.contains('current')) {
          foundCurrent = true;
        }
      }
      // No "next" after the current — open the first not-completed item.
      for (const item of items) {
        if (item.classList.contains('not-started') ||
            !item.classList.contains('completed')) {
          item.click();
          console.log('[Hunter] autoNext: opened first non-completed task');
          return true;
        }
      }
      return false;
    }

    if (url.includes('game')) {
      const btns = document.querySelectorAll(
        '.game-action-bar .action-bar-button button:not([disabled]), ' +
        '#sa-navigation-controls button:not([disabled]), ' +
        'button[data-action="next-list"]'
      );
      for (const b of btns) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (/next list|next task|continue|finish/.test(t)) {
          b.click();
          console.log('[Hunter] autoNext: clicked next-list button in-game');
          return true;
        }
      }
      const listLink = document.querySelector(
        'a[href*="list-starter"], [ng-click*="list-starter"]'
      );
      if (listLink) {
        listLink.click();
        return true;
      }
    }
    return false;
  }

  // ── Phase 2: human-presence detector ──────────────────────────────────────

  /** Watch for real user interaction in the answer field. While a human is
   *  actively typing/clicking, Hunter is suspended. After
   *  humanPresenceWindow ms of silence, Hunter resumes automatically.
   *  Selector priority verified in `Implement/(5) EP (8_4 8_5 8_55).html`.
   */
  function onHumanInteraction(e) {
    if (!hunterEnabled) return;
    const target = e.target;
    const isAnswerField = target && (
      target.id === 'answer-text' ||
      (target.closest && (
        target.closest('#answer-text') ||
        target.closest('#answer-block') ||
        target.closest('.lp-question-content') ||
        target.closest('[contenteditable]')
      )) ||
      target.isContentEditable
    );
    if (!isAnswerField) return;

    hunterHumanActive = true;
    if (!hunterHumanSuspended) {
      hunterHumanSuspended = true;
      console.log('[Hunter] Human detected — suspending');
      setDebug('👤 Human typing — Hunter idle');
    }
    if (hunterHumanTimer) clearTimeout(hunterHumanTimer);
    hunterHumanTimer = setTimeout(() => {
      if (!hunterEnabled) return;
      hunterHumanActive    = false;
      hunterHumanSuspended = false;
      console.log('[Hunter] Human idle — resuming');
      updateHunterDebug();
    }, CFG.hunter.humanPresenceWindow);
  }

  // ── Verdict detection (Phase 2) ───────────────────────────────────────────

  function detectVerdict() {
    // 1. modeless-answer-dialog: tr.correct/incorrect.
    const dialog = document.querySelector('.modeless-answer-dialog');
    if (dialog && dialog.offsetParent !== null) {
      const incorrectRow = dialog.querySelector('tr.incorrect');
      const correctRow   = dialog.querySelector('tr.correct');
      if (incorrectRow && incorrectRow.offsetParent !== null) return 'incorrect';
      if (correctRow   && correctRow.offsetParent !== null   ) return 'correct';
    }
    // 2. action-bar-button.try-again visible
    const tryAgainBtn = document.querySelector('.action-bar-button.try-again button, .action-bar-button.try-again');
    if (tryAgainBtn && tryAgainBtn.offsetParent !== null) return 'incorrect';
    // 3. cheer-button (post-correct animation)
    const cheerBtn = document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
    if (cheerBtn) return 'correct';
    // 4. paper-mode "Next question" button
    const nextQBtn = document.querySelector('.next-question-button:not([disabled])');
    if (nextQBtn) return 'correct';
    // 5. SA navigation / information controls
    const infoBtn = document.querySelector('.information-controls button:not([disabled]), #sa-navigation-controls button:not([disabled])');
    if (infoBtn && infoBtn.offsetParent !== null) return 'correct';
    // 6. #question-text disappeared → 'unknown' so the tick falls through
    //    to ADVANCE instead of getting wedged in AWAIT_VERDICT.
    const qSpan = document.getElementById('question-text');
    if (qSpan && (qSpan.textContent || '').trim().length === 0) return 'unknown';
    return null;
  }

  // ── Clicks (Phase 2: more selectors, ng-disabled-aware) ───────────────────

  /** Click the "Next question" button to advance past the current question.
   *  Primary selector `#continue-button` (verified in game-page HTML, label
   *  "Next question"); fallbacks include paper-mode, correct feedback, SA
   *  navigation, cheer-button, nav-bar-exit.
   */
  function clickAdvanceButton() {
    const advanceSelectors = [
      '#continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      '.next-question-button:not([disabled])',
      '#next-question:not([disabled])',
      '#correct-button:not([disabled])',
      '.correct-button:not([disabled])',
      '.information-controls button:not([disabled])',
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      '.nav-bar-exit:not([disabled])',
      '.game-action-bar button:not([disabled])',
      '.cheer-button:not(.ng-hide):not(.sf-hidden)',
      'button[data-action="continue"]:not([disabled])',
      'button[data-action="next"]:not([disabled])',
    ];
    for (const sel of advanceSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null && isButtonEnabled(btn)) {
        console.log('[Hunter] Clicking advance:', sel);
        btn.click();
        return true;
      }
    }
    for (const btn of document.querySelectorAll('button')) {
      if (btn.offsetParent === null || !isButtonEnabled(btn)) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(next|continue|next question|ok|got it|done)$/i.test(text)) {
        console.log('[Hunter] Clicking advance by text:', text);
        btn.click();
        return true;
      }
    }
    return false;
  }

  /** Click the dismiss / try-again / next button on a wrong-answer overlay.
   */
  function dismissWrongAnswer() {
    const dismissSelectors = [
      '#continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      '.action-bar-button.try-again button:not([disabled])',
      '.action-bar-button.try-again:not(.ng-hide):not(.sf-hidden) button',
      '.game-action-bar .action-bar-button.try-again button:not([disabled])',
      '.feedback-button:not([disabled])',
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      '.game-action-bar .action-bar-button button:not([disabled])',
      'button[name="continue"]:not([disabled])',
      'button[data-action="continue"]:not([disabled])',
      'button[data-action="next"]:not([disabled])',
    ];
    for (const sel of dismissSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null && isButtonEnabled(btn)) {
        console.log('[Hunter] Dismissing wrong answer via:', sel);
        btn.click();
        return true;
      }
    }
    for (const btn of document.querySelectorAll('button')) {
      if (btn.offsetParent === null || !isButtonEnabled(btn)) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(try again|continue|next|next question|ok|got it|retry|try it again)$/i.test(text)) {
        console.log('[Hunter] Dismissing wrong answer by text:', text);
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ── Skip whole list (Phase 1 carry-over, improved in Phase 2) ─────────────

  function skipToNextTask() {
    const url = window.location.href.toLowerCase();

    if (url.includes('list-starter')) {
      const items = document.querySelectorAll('#stats-parent .starter-panel .grouped-options > li.item');
      if (items.length > 0) {
        let foundCurrent = false;
        let clicked = false;
        for (const item of items) {
          if (foundCurrent) {
            item.click();
            clicked = true;
            break;
          }
          if (item.classList.contains('selected') ||
              item.classList.contains('active')   ||
              item.classList.contains('current')) {
            foundCurrent = true;
          }
        }
        if (clicked) {
          showToast('⏭ Skipped to next task');
          console.log('[Hunter] Skipped sidebar item');
          return;
        }
        if (!foundCurrent) {
          items[0].click();
          showToast('⏭ Skipped to first task');
          console.log('[Hunter] Skipped to first sidebar item');
          return;
        }
        showToast('⏭ No more tasks in this list');
      }
      const crumb = document.querySelector('.breadcrumbs .crumb, .crumb-child');
      if (crumb) {
        crumb.click();
        showToast('⏭ Back to course view');
      }
      return;
    }

    if (url.includes('game') || url.includes('activity-starter')) {
      const backBtn = document.querySelector(
        '#sa-navigation-controls .back-button, .back-button, [data-action="back"]'
      );
      if (backBtn) {
        backBtn.click();
        showToast('⏭ Going back to list');
        return;
      }
      const listLink = document.querySelector('a[href*="list-starter"], [ng-click*="list-starter"]');
      if (listLink) {
        listLink.click();
        showToast('⏭ Navigating to list');
        return;
      }
      showToast('⚠️ No back button on this screen');
      return;
    }
    showToast('⚠️ Not on a task page');
  }

  // ── Main Hunter tick (Phase 2) ─────────────────────────────────────────────

  function hunterTick() {
    if (!hunterEnabled || pageChanging) return;

    const url = window.location.href.toLowerCase();

    // Human-presence suspension.
    if (hunterHumanSuspended) {
      setDebug('👤 Human typing — Hunter idle');
      return;
    }

    // LIST_DONE short-circuit: detected at top, even mid-state.
    if (detectListDone() &&
        hunterState !== 'LIST_DONE' &&
        hunterState !== 'ADVANCE') {
      console.log('[Hunter] Detected list-complete state');
      hunterState = 'LIST_DONE';
      updateHunterDebug();
    }

    switch (hunterState) {

      case 'IDLE': {
        const word = getQuestionWord();
        if (word) {
          hunterQuestion       = word;
          hunterQuestionStart  = Date.now();
          hunterState          = 'DETECTED';
          hunterNoAdvance      = 0;
          console.log('[Hunter] DETECTED:', word);
          updateHunterDebug();
        }
        break;
      }

      case 'DETECTED': {
        // Question visible, wait for tryFill() pipeline to start typing.
        if (filling) {
          hunterState = 'TYPING';
          console.log('[Hunter] TYPING');
          setDebug('⌨️ Typing answer…');
        }
        break;
      }

      case 'TYPING': {
        // Pipeline finished; transition to verdict polling after EP has
        // had a moment to submit + grade.
        if (!filling) {
          setTimeout(() => { hunterState = 'AWAIT_VERDICT'; },
                     Math.max(120, CFG.typeCooldown * 1000));
        }
        break;
      }

      case 'AWAIT_VERDICT': {
        const verdict = detectVerdict();
        if (!verdict) break; // still waiting

        if (verdict === 'incorrect') {
          hunterScore.incorrect++;
          hunterQuestionsAnswered++;
          console.log('[Hunter] Verdict: INCORRECT');

          // ── Phase 2: errorPolicy branching ──
          const policy = CFG.hunter.errorPolicy;
          if (policy === 'learn' || policy === 'hybrid') {
            try { learnFromError(); } catch (e) { console.warn('[Hunter] learnFromError threw', e); }
            if (policy === 'hybrid') {
              console.log('[Hunter] Hybrid: continuing to dismiss');
            }
          }

          // Always dismiss the overlay. With 'learn'/'hybrid' the dismiss
          // triggers a retry of the same question; the existing tryFill()
          // will answer correctly because answerMap was just updated.
          dismissWrongAnswer();
          setTimeout(() => { hunterState = 'ADVANCE'; }, CFG.hunter.advanceDelay);
          updateHunterDebug();
        } else if (verdict === 'correct') {
          hunterScore.correct++;
          hunterQuestionsAnswered++;
          console.log('[Hunter] Verdict: CORRECT');
          setDebug('✅ Correct — advancing');
          hunterState = 'ADVANCE';
          updateHunterDebug();
        } else if (verdict === 'unknown') {
          console.log('[Hunter] Verdict: UNKNOWN (question gone) — advancing');
          hunterState = 'ADVANCE';
        }
        break;
      }

      case 'ADVANCE': {
        if (hunterAdvancing) break;
        hunterAdvancing = true;
        console.log('[Hunter] ADVANCE: clicking Next…');

        const advanced = clickAdvanceButton();
        if (advanced) {
          hunterNoAdvance = 0;
          hunterAdvancing = false;
          // Soft cap on questions per run.
          if (CFG.hunter.maxQuestionsPerRun > 0 &&
              hunterQuestionsAnswered >= CFG.hunter.maxQuestionsPerRun) {
            console.log('[Hunter] Reached maxQuestionsPerRun — stopping');
            showToast('🕵️ Reached cap (' + CFG.hunter.maxQuestionsPerRun + ') — stopping');
            stopHunter();
            return;
          }
          setTimeout(() => {
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            updateHunterDebug();
          }, CFG.hunter.advanceDelay);
        } else {
          hunterNoAdvance++;
          if (detectListDone()) {
            hunterAdvancing = false;
            hunterState = 'LIST_DONE';
            updateHunterDebug();
            break;
          }
          setTimeout(() => {
            hunterAdvancing = false;
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            if (hunterNoAdvance >= 5) {
              if (CFG.hunter.autoStart) {
                if (url.includes('list-starter') && vocabUnlocked) {
                  const sm = document.getElementById('start-button-main');
                  if (sm && sm.offsetParent !== null) sm.click();
                } else if (url.includes('activity-starter')) {
                  const ss = document.getElementById('start-button-school');
                  if (ss && ss.offsetParent !== null) ss.click();
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
        showToast('🏁 List complete');

        if (CFG.hunter.autoContinueLists) {
          setTimeout(() => {
            if (!hunterEnabled) return;
            const moved = autoNextList();
            if (moved) {
              setTimeout(() => {
                hunterState     = 'IDLE';
                hunterQuestion  = '';
                hunterAdvancing = false;
                updateHunterDebug();
              }, 800);
            } else {
              showToast('🏁 No more lists — Hunter stopped');
              stopHunter();
            }
          }, CFG.hunter.betweenListDelay);
          return;
        }
        showToast('🏁 List complete — Hunter stopped');
        stopHunter();
        return;
      }
    }

    // Idle auto-start: keep Hunter busy by clicking start buttons on the
    // right page.
    if (CFG.hunter.autoStart && hunterState === 'IDLE') {
      if (url.includes('list-starter') && vocabUnlocked) {
        const startMain = document.getElementById('start-button-main');
        if (startMain && startMain.offsetParent !== null) {
          console.log('[Hunter] Clicking start-button-main');
          startMain.click();
        }
      } else if (url.includes('activity-starter')) {
        const startSchool = document.getElementById('start-button-school');
        if (startSchool && startSchool.offsetParent !== null) {
          console.log('[Hunter] Clicking start-button-school');
          startSchool.click();
        }
      }
    }
  }

  // ── Debug / start / stop (Phase 2) ─────────────────────────────────────────

  /** Update the panel debug line with current Hunter progress + state emoji. */
  function updateHunterDebug() {
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
    if (hunterTimer) clearInterval(hunterTimer);

    hunterEnabled          = true;
    hunterState            = 'IDLE';
    hunterQuestion         = '';
    hunterAdvancing        = false;
    hunterScore            = { correct: 0, incorrect: 0 };
    hunterStartTime        = Date.now();
    hunterNoAdvance        = 0;
    hunterQuestionStart    = 0;
    hunterHumanActive      = false;
    hunterHumanSuspended   = false;
    hunterQuestionsAnswered = 0;
    if (hunterHumanTimer) {
      clearTimeout(hunterHumanTimer);
      hunterHumanTimer = null;
    }

    // Hydrate answerMap with previously-learned pairs from localStorage.
    loadLearnedAnswers();

    // Wire human-presence listeners (capture phase, so we beat EP's handlers).
    document.addEventListener('keydown', onHumanInteraction, true);
    document.addEventListener('click',    onHumanInteraction, true);
    document.addEventListener('input',    onHumanInteraction, true);

    hunterTimer = setInterval(hunterTick, 500);
    console.log('[Hunter] Started (Phase 2; errorPolicy=' + CFG.hunter.errorPolicy + ')');
    showToast('🕵️ Hunter mode ON');
    setDebug('🕵️ Hunter ready');

    if (hunterBtn) {
      hunterBtn.classList.add('hunter-active');
      hunterBtn.textContent = '🕵️ ON';
    }
  }

  /** Stop Hunter Mode. Idempotent. */
  function stopHunter() {
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    hunterEnabled          = false;
    hunterState            = 'IDLE';
    hunterAdvancing        = false;
    hunterQuestion         = '';
    hunterHumanActive      = false;
    hunterHumanSuspended   = false;
    if (hunterHumanTimer) {
      clearTimeout(hunterHumanTimer);
      hunterHumanTimer = null;
    }
    document.removeEventListener('keydown', onHumanInteraction, true);
    document.removeEventListener('click',    onHumanInteraction, true);
    document.removeEventListener('input',    onHumanInteraction, true);

    console.log('[Hunter] Stopped');

    const total = hunterScore.correct + hunterScore.incorrect;
    if (total > 0) {
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
      hunterBtn, skipBtn, stopBtn;

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
        stopHunter();
      } else {
        startHunter();
      }
    });

    // ── Skip button ──
    skipBtn.addEventListener('click', () => skipToNextTask());

    // ── Kill-switch STOP button (Phase 2) ──
    stopBtn.addEventListener('click', () => {
      // STOP is a one-shot kill-switch; even if Hunter is already off it
      // resets all transient state, removes listeners, etc.
      if (hunterTimer) {
        clearInterval(hunterTimer);
        hunterTimer = null;
      }
      hunterEnabled          = false;
      hunterState            = 'IDLE';
      hunterAdvancing        = false;
      hunterQuestion         = '';
      hunterHumanActive      = false;
      hunterHumanSuspended   = false;
      if (hunterHumanTimer) { clearTimeout(hunterHumanTimer); hunterHumanTimer = null; }
      document.removeEventListener('keydown', onHumanInteraction, true);
      document.removeEventListener('click',    onHumanInteraction, true);
      document.removeEventListener('input',    onHumanInteraction, true);
      if (hunterBtn) {
        hunterBtn.classList.remove('hunter-active');
        hunterBtn.textContent = '🕵️ Hunter';
      }
      showToast('🛑 Hunter killed');
      setDebug('');
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

    // Kill-switch STOP is visible whenever Hunter is enabled or any task
    // page is open, so the user can always force-quit Hunter.
    if (btns3Row)  btns3Row.style.display  = isTaskPage || hunterEnabled ? 'flex' : 'none';
    if (stopBtn)   stopBtn.style.display   = isTaskPage || hunterEnabled ? '' : 'none';

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
