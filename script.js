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
  }
 
  // ── Hunter Mode config (v1: dismiss-only) ──
  //   - enabled        : master runtime toggle
  //   - advanceDelay   : ms after verdict before clicking Next
  //   - errorPolicy    : 'dismiss' (only policy in v1 — Learn policy intentionally deferred)
  //   - autoStart      : auto-click start buttons on list-starter / activity-starter
  const CFG = {
    fuzzyThreshold : 10,
    typeDelay      : 0,
    toastDuration  : 5000,
    pollInterval   : 0,
    cooldown       : 0.5,
    typeCooldown   : 0.1,
    // ── Hunter Mode (v1 scope) ──
    hunter: {
      enabled        : false,   // master toggle
      advanceDelay   : 600,     // ms after verdict before clicking Next
      errorPolicy    : 'dismiss', // v1: dismiss wrong-answer overlay and continue
      autoStart      : true,    // auto-click start-button-main / start-button-school when on a starter page
    },
  };
 
  const SEL = {
    targetLang        : '.targetLanguage.question-label',
    baseLang          : '.baseLanguage.question-label',
    answerInput       : '#answer-text',
    prompt            : '.prompt.ng-binding',
  };
 
  let answerMap     = {};
  let enabled       = true;
  let lastFilled    = '';
  let filling       = false;
  let cooldownUntil = 0;
  let observer      = null;
  let pollTimer     = null;
  let activeEditable = null;
  let pageChanging   = false;
  let lastTypeTime   = 0;
  let auto = true;
  let panelUnlocked = false;
  let vocabUnlocked = false;
  let aiUnlocked = false;

  // ── Hunter Mode runtime state (v1) ──
  // State machine: IDLE → DETECTED → AWAIT_VERDICT → ADVANCE → IDLE
  //
  //   IDLE          : waiting for a new question to appear
  //   DETECTED      : question visible, waiting for fill pipeline to finish
  //   AWAIT_VERDICT : fill done, polling EP DOM for correct/incorrect verdict
  //   ADVANCE       : verdict seen, clicking "Next question" / dismissing overlay
  let hunterEnabled    = false;   // runtime toggle (defaults to CFG.hunter.enabled)
  let hunterTimer      = null;    // interval for hunter tick
  let hunterState      = 'IDLE';  // current state machine state
  let hunterQuestion   = '';      // question word currently tracked
  let hunterAdvancing  = false;   // guard against double-advance clicks
  let hunterScore      = { correct: 0, incorrect: 0 }; // session stats
  let hunterStartTime  = 0;       // timestamp when Hunter was started
  let hunterNoAdvance  = 0;       // consecutive ticks with no advance button found

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
 
  // ── Strip everything after the first semicolon (including the semicolon) ──
  function stripAlts(s) {
    if (!s) return s;
    const idx = s.indexOf(';');
    return idx === -1 ? s : s.slice(0, idx).trim();
  }
 
  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      // Updated regex below to allow math symbols: +, -, *, /, x, =
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

    // Exact match first
    if (answerMap[q]) return answerMap[q];

    // Substring match (handles lemmatized forms)
    for (const [k, v] of Object.entries(answerMap)) {
      if (k.includes(q) || q.includes(k)) return v;
    }

    // Fuzzy match
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
      setTimeout(() => {
        loadAnswers();
      }, 1000);
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

      // Strip anything past the first semicolon (alt hint trailers).
      const t = stripAlts(rawTarget);
      const b = stripAlts(rawBase);

      const normT = norm(t);
      const normB = norm(b);
      if (normT && normB) {
        if (!map[normT]) {
          map[normT] = b;
          count++;
        }
        if (!map[normB]) {
          map[normB] = t;
          count++;
        }
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
 
    // Strip semicolon alts from the answer at fill time too (safety net)
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
 
  // ── Hunter Mode (v1) ═══════════════════════════════════════════════════════
  //
  //  v1 scope (per user request — stop here, do NOT add v2/v3 features):
  //    1. Auto-advance  : detect when current question is finished (correct or
  //                       wrong) and click the "Next question" button so the
  //                       script moves to the next question without help.
  //    2. Dismiss wrong : when the wrong-answer overlay appears, click its
  //                       dismiss / try-again / continue button so Hunter is
  //                       never stuck. errorPolicy: 'dismiss'.
  //    3. Skip whole list: a new "Skip" button on the panel that jumps straight
  //                       to the next task in the list-starter sidebar.
  //
  //  NOT in v1 (explicitly out of scope — extend later from the roadmap):
  //    - Learn-from-error policy (errorPolicy: 'learn'|'hybrid')
  //    - List hopping / auto-navigate to next list
  //    - Human-presence detector
  //    - Adaptive fuzzy threshold / typing speed
  //    - Confidence tracking
  //    - Telemetry / Export
  //
  //  State machine: IDLE → DETECTED → AWAIT_VERDICT → ADVANCE → IDLE
  //
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Detect the current question's verdict.
   * Returns: 'correct' | 'incorrect' | 'unknown' | null
   *
   * Selectors derived from real Education Perfect DOM snapshots:
   *  - Implement/EP (8_4_2026 3：48：05 PM).html
   *  - Implement/(5) EP (8_4_2026 3：48：24 PM).html
   *  - Implement/(5) EP (8_4_2026 3：53：53 PM).html
   */
  function detectVerdict() {
    // 1. The modeless-answer-dialog appears immediately after answering.
    //    Inside it: tr.correct (green) or tr.incorrect (red).
    const dialog = document.querySelector('.modeless-answer-dialog');
    if (dialog && dialog.offsetParent !== null) {
      const incorrectRow = dialog.querySelector('tr.incorrect');
      const correctRow   = dialog.querySelector('tr.correct');
      if (incorrectRow && incorrectRow.offsetParent !== null) return 'incorrect';
      if (correctRow   && correctRow.offsetParent !== null   ) return 'correct';
    }

    // 2. In-game action bar shows try-again when wrong / next when right.
    const tryAgainBtn = document.querySelector('.action-bar-button.try-again button, .action-bar-button.try-again');
    if (tryAgainBtn && tryAgainBtn.offsetParent !== null) return 'incorrect';

    // 3. History bar / cheer-button appears after a correct answer.
    const cheerBtn = document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
    if (cheerBtn) return 'correct';

    // 4. Paper-mode-style "Next question" button.
    const nextQBtn = document.querySelector('.next-question-button:not([disabled]), #next-question:not([disabled])');
    if (nextQBtn) return 'correct';

    // 5. SA navigation "information" controls / nav-bar-exit button.
    const infoBtn = document.querySelector('.information-controls button:not([disabled]), #sa-navigation-controls button:not([disabled])');
    if (infoBtn && infoBtn.offsetParent !== null) return 'correct';

    return null; // question still in progress
  }

  /**
   * Click the "Next question" button to advance past the current question.
   * Selectors come from EP's DOM:
   *   - The primary advance button is `#continue-button` (a nice-button
   *     inside the game-page / modeless-answer-dialog / paper-mode UI).
   *   - The button text is "Next question" (verified in
   *     (5) EP (8_4_2026 3：48：24 PM).html).
   */
  function clickAdvanceButton() {
    const advanceSelectors = [
      // Primary: the EP "Next question" button (id from game-page HTML)
      '#continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      // Paper-mode buttons
      '.next-question-button:not([disabled])',
      '#next-question:not([disabled])',
      // Correct feedback container buttons
      '#correct-button:not([disabled])',
      '.correct-button:not([disabled])',
      // SA navigation / information controls (used in some layouts)
      '.information-controls button:not([disabled])',
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      // Nav-bar-exit (back-to-list from game page)
      '.nav-bar-exit:not([disabled])',
      // Generic enabled button in game action bar
      '.game-action-bar button:not([disabled])',
      // Cheer-button (post-correct animation button)
      '.cheer-button:not(.ng-hide):not(.sf-hidden)',
    ];

    for (const sel of advanceSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        console.log('[Hunter] Clicking advance:', sel);
        btn.click();
        return true;
      }
    }

    // Last-resort: any visible button whose label matches an advance verb.
    for (const btn of document.querySelectorAll('button')) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(next|continue|next question|ok|got it|done)$/i.test(text)) {
        console.log('[Hunter] Clicking advance by text:', text);
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Dismiss & Continue policy — click the dismiss / try-again / next button on
   * a wrong-answer overlay so the script is never stuck on an error screen.
   * Selectors derived from the EP game/game-action-bar DOM (#continue-button
   * is the canonical "Continue / Try again / Next" button on the modeless-answer
   * dialog and the action-bar-button.try-again class covers the older
   * AngularJS layouts).
   */
  function dismissWrongAnswer() {
    const dismissSelectors = [
      // Primary: same ep continue-button (works for wrong AND correct verdicts)
      '#continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      // Older layout: action-bar-button.try-again
      '.action-bar-button.try-again button:not([disabled])',
      '.action-bar-button.try-again:not(.ng-hide):not(.sf-hidden) button',
      '.game-action-bar .action-bar-button.try-again button:not([disabled])',
      // Feedback button / SA navigation fallback
      '.feedback-button:not([disabled])',
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      // Any enabled action-bar button
      '.game-action-bar .action-bar-button button:not([disabled])',
    ];

    for (const sel of dismissSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        console.log('[Hunter] Dismissing wrong answer via:', sel);
        btn.click();
        return true;
      }
    }

    // Last-resort: text-match
    for (const btn of document.querySelectorAll('button')) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(try again|continue|next|next question|ok|got it|retry|try it again)$/i.test(text)) {
        console.log('[Hunter] Dismissing wrong answer by text:', text);
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Main Hunter tick — runs every ~500ms while Hunter is on.
   * Implements the IDLE → DETECTED → AWAIT_VERDICT → ADVANCE → IDLE loop and
   * auto-clicks start buttons while idle on a starter screen.
   */
  function hunterTick() {
    if (!hunterEnabled || pageChanging) return;

    const url = window.location.href.toLowerCase();

    switch (hunterState) {

      case 'IDLE': {
        // Wait for a question to appear. Detect via the existing #question-text
        // which is the canonical question label used by the game page.
        const word = getQuestionWord();
        if (word) {
          hunterQuestion = word;
          hunterState = 'DETECTED';
          hunterNoAdvance = 0;
          console.log('[Hunter] Question detected:', word);
          updateHunterDebug();
        }
        break;
      }

      case 'DETECTED': {
        // The existing pipeline (tryFill) handles typing. When it's no longer
        // filling, the question has been submitted — wait for verdict.
        if (!filling) {
          hunterState = 'AWAIT_VERDICT';
          console.log('[Hunter] Waiting for verdict...');
          setDebug('⏳ Waiting for verdict...');
        }
        break;
      }

      case 'AWAIT_VERDICT': {
        const verdict = detectVerdict();
        if (verdict === 'incorrect') {
          hunterScore.incorrect++;
          console.log('[Hunter] Verdict: INCORRECT — dismissing');
          setDebug('❌ Wrong — dismissing...');

          // Dismiss & Continue policy (only policy in v1). We never block on
          // a wrong answer; we always try to click the dismiss button so the
          // script never gets stuck.
          if (dismissWrongAnswer()) {
            setTimeout(() => { hunterState = 'ADVANCE'; }, CFG.hunter.advanceDelay);
          } else {
            hunterState = 'ADVANCE';
          }
          updateHunterDebug();
        } else if (verdict === 'correct' || verdict === 'unknown') {
          // 'unknown' = question label disappeared but no verdict seen → still
          // safe to advance (the EP UI has already moved on).
          hunterScore.correct += (verdict === 'correct' ? 1 : 0);
          console.log('[Hunter] Verdict:', verdict, '— advancing');
          setDebug('✅ Advancing...');
          hunterState = 'ADVANCE';
          updateHunterDebug();
        }
        // null = still waiting, stay in AWAIT_VERDICT
        break;
      }

      case 'ADVANCE': {
        if (hunterAdvancing) break;
        hunterAdvancing = true;
        console.log('[Hunter] Advancing to next question');

        const advanced = clickAdvanceButton();
        if (advanced) {
          hunterNoAdvance = 0;
          setTimeout(() => {
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            hunterAdvancing = false;
            updateHunterDebug();
          }, CFG.hunter.advanceDelay);
        } else {
          // No advance button found. Could be a list-complete screen or a real
          // intersection — try a few times, then give up and let the human
          // decide.
          hunterNoAdvance++;
          setTimeout(() => {
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            hunterAdvancing = false;
            if (hunterNoAdvance >= 5) {
              // Last resort: try clicking start-button-main / start-button-school
              if (CFG.hunter.autoStart) {
                if (url.includes('list-starter')) {
                  const sm = document.getElementById('start-button-main');
                  if (sm && sm.offsetParent !== null) sm.click();
                } else if (url.includes('activity-starter')) {
                  const ss = document.getElementById('start-button-school');
                  if (ss && ss.offsetParent !== null) ss.click();
                }
              }
            }
            updateHunterDebug();
          }, CFG.hunter.advanceDelay);
        }
        break;
      }
    }

    // ── Idle auto-start: keep Hunter busy by clicking start buttons ──
    // Selectors from EP's list-starter page (file 1) and activity-starter
    // page (file 2). #start-button-school fires when on activity-starter,
    // #start-button-main fires when on list-starter.
    if (CFG.hunter.autoStart) {
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

  /** Update the panel debug line with current Hunter progress. */
  function updateHunterDebug() {
    if (!debugEl) return;
    const elapsed = hunterStartTime ? Math.floor((Date.now() - hunterStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    let msg = `🕵️ ${hunterScore.correct}✓ ${hunterScore.incorrect}✗`;
    if (elapsed > 0) msg += ` · ${mins}m${secs}s`;
    if (hunterQuestion) {
      const short = hunterQuestion.length > 15 ? hunterQuestion.slice(0, 15) + '…' : hunterQuestion;
      msg += ` · "${short}"`;
    }
    setDebug(msg);
  }

  /** Start Hunter Mode. Idempotent. */
  function startHunter() {
    if (hunterTimer) clearInterval(hunterTimer);

    hunterEnabled   = true;
    hunterState     = 'IDLE';
    hunterQuestion  = '';
    hunterAdvancing = false;
    hunterScore     = { correct: 0, incorrect: 0 };
    hunterStartTime = Date.now();
    hunterNoAdvance = 0;

    hunterTimer = setInterval(hunterTick, 500);
    console.log('[Hunter] Started');
    showToast('🕵️ Hunter mode ON');
    setDebug('🕵️ Hunter ready');
  }

  /** Stop Hunter Mode. Idempotent. */
  function stopHunter() {
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    hunterEnabled   = false;
    hunterState     = 'IDLE';
    hunterAdvancing = false;
    hunterQuestion  = '';
    console.log('[Hunter] Stopped');

    const total = hunterScore.correct + hunterScore.incorrect;
    if (total > 0) {
      const pct = total > 0 ? Math.round((hunterScore.correct / total) * 100) : 0;
      const elapsed = Math.floor((Date.now() - hunterStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      showToast(`🕵️ Session: ${hunterScore.correct}/${total} (${pct}%) · ${mins}m${secs}s`);
    } else {
      showToast('🕵️ Hunter mode OFF');
    }
    setDebug('');
  }

  /**
   * Skip the entire current list / task list and jump straight to the next task.
   * Implementation targets the EP list-starter page DOM:
   *   - Sidebar tasks live under `#stats-parent .starter-panel .grouped-options > li.item`
   *     (verified in EP (8_4_2026 3：48：05 PM).html).
   *   - If we're on a list-starter page, find the selected task and click the
   *     next one (or the first if none is selected).
   *   - If no next task exists in the sidebar, fall back to going back via
   *     the breadcrumb `.breadcrumbs .crumb`.
   *   - If we're in a game, navigate back to the list-starter via the
   *     `#sa-navigation-controls .back-button` or any link to list-starter.
   */
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
          if (item.classList.contains('selected') || item.classList.contains('active')) {
            foundCurrent = true;
          }
        }
        if (clicked) {
          showToast('⏭ Skipped to next task');
          console.log('[Hunter] Skipped to next task');
          return;
        }
        // No currently-active task was found → click the first item.
        if (!foundCurrent) {
          items[0].click();
          showToast('⏭ Skipped to next task');
          console.log('[Hunter] Skipped to first task in list');
          return;
        }
        showToast('⏭ No more tasks in this list');
      }

      // Fallback: breadcrumb back to the course view
      const crumb = document.querySelector('.breadcrumbs .crumb, .crumb-child');
      if (crumb) {
        crumb.click();
        showToast('⏭ Back to course view');
        console.log('[Hunter] Back to course view');
      }
      return;
    }

    if (url.includes('game') || url.includes('activity-starter')) {
      const backBtn = document.querySelector('#sa-navigation-controls .back-button, .back-button, [data-action="back"]');
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
      console.log('[Hunter] No back button found on', url);
      return;
    }

    showToast('⚠️ Not on a task page');
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  let panel, countEl, toggleBtn, debugEl, autoBtn, aiBtn, hunterBtn, skipBtn;
 
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
      .ep-btn.hunter-active{background:#1b6d2a !important;box-shadow:0 0 8px rgba(74,217,125,.4)}
      .ep-btn.skip-btn{background:#6d3f1b !important}
      .ep-btn.skip-btn:hover{background:#8a5225 !important}
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
        <div id="ep-btns2" style="display:flex;gap:5px;margin-bottom:8px">
          <button class="ep-btn" id="ep-hunter">🕵️ Hunter</button>
          <button class="ep-btn skip-btn" id="ep-skip">⏭ Skip list</button>
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
    aiBtn.addEventListener('click', () => {
      showToast('🤖 AI mode');
      // Put your AI functionality here
    });

    // ── Hunter Mode button ──
    hunterBtn.addEventListener('click', () => {
      if (hunterEnabled) {
        stopHunter();
        hunterBtn.classList.remove('hunter-active');
        hunterBtn.textContent = '🕵️ Hunter';
      } else {
        startHunter();
        hunterBtn.classList.add('hunter-active');
        hunterBtn.textContent = '🕵️ ON';
      }
    });

    // ── Skip button ──
    skipBtn.addEventListener('click', () => {
      skipToNextTask();
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
 
    if (url.includes('list-starter')) {
      vocabUnlocked = true;
    }
 
    if (url.includes('activity-starter')) {
      aiUnlocked = true;
    }
 
    if (vocabUnlocked &&
        !url.includes('list-starter') &&
        !url.includes('game')) {
      vocabUnlocked = false;
      answerMap     = {};
      panel.querySelector('#ep-count').textContent = 'Not loaded';
    }
 
    if (aiUnlocked &&
        !url.includes('activity-starter') &&
        !url.includes('game')) {
      aiUnlocked = false;
    }

    const loadBtn   = document.querySelector('#ep-load');
    const pauseBtn  = document.querySelector('#ep-toggle');
    const countEl   = document.querySelector('#ep-count');
    const aiBtn     = document.querySelector('#ep-ai');
    const hunterBtn = document.querySelector('#ep-hunter');
    const skipBtn   = document.querySelector('#ep-skip');
    const btns2Row  = document.querySelector('#ep-btns2');
    const hintTxt   = document.querySelector('#ep-hint');
    const debugTxt  = document.querySelector('#ep-debug');

    if (loadBtn)   loadBtn.style.display   = vocabUnlocked ? '' : 'none';
    if (pauseBtn)  pauseBtn.style.display  = vocabUnlocked ? '' : 'none';
    if (countEl)   countEl.style.display   = vocabUnlocked ? '' : 'none';

    if (aiBtn)     aiBtn.style.display     = aiUnlocked ? '' : 'none';

    // Show Hunter & Skip buttons on any task page (list-starter, activity-starter, or game).
    // Selectors verified against the three EP HTML snapshots in Implement/.
    const isTaskPage = url.includes('list-starter') || url.includes('activity-starter') || url.includes('game');
    if (btns2Row)  btns2Row.style.display  = isTaskPage ? 'flex' : 'none';
    if (hunterBtn) hunterBtn.style.display = isTaskPage ? '' : 'none';
    if (skipBtn)   skipBtn.style.display   = isTaskPage ? '' : 'none';

    if (hintTxt) hintTxt.style.display = hints ? '' : 'none';
    if (vocabUnlocked) hintTxt.innerHTML = hintsList.list;
    if (aiUnlocked) hintTxt.innerHTML = hintsList.activity;
    if (debugTxt) debugTxt.style.display = debug ? '' : 'none';
    
    if (url.includes('list-starter') && auto) {
      setTimeout(() => {
        const count = fullList();
        if (count === 0) showToast('⚠️ Open vocab list first then press Load');
      }, 500);
    }
 
    if (aiUnlocked && auto) {
      if (url.includes('activity-starter')) {
        setTimeout(() => {
          const startBtn = document.getElementById("start-button-school");
          if (startBtn) startBtn.click();
        }, 2000);
      }
 
      // The existing game loop is now superseded by Hunter Mode when active.
      // Keep it as a fallback for non-Hunter operation.
      if (url.includes('game') && !hunterEnabled) {
        setInterval(() => {
          const bar = document.querySelector('.game-action-bar.sa-action-bar');
          console.log('[EP] Checking for action bar:', bar);
          if (bar) {
            if (bar.classList.contains('information')) {
              setTimeout(() => {
                document.querySelector("#sa-navigation-controls > div.sa-navigation-controls-content.h-group.v-align-center.h-align-space-between.align-right > div.information-controls.ng-isolate-scope > div > button").click();
              }, 3500);
            }
            else if (bar.classList.contains('facts')) {
            }
          }
        }, 3000);
      }
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
    console.log('[EP Assistant v4.0.0] Ready');
  }
 
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    setTimeout(init, 1000);
 
})();