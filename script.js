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
 
  const CFG = {
    fuzzyThreshold : 10,
    typeDelay      : 0,
    toastDuration  : 5000,
    pollInterval   : 0,
    cooldown       : 0.5,
    typeCooldown   : 0.1,
    // ── Hunter Mode ──
    hunter: {
      enabled        : false,   // master toggle
      advanceDelay   : 600,     // ms after verdict before clicking Next
      errorPolicy    : 'dismiss', // 'dismiss' | 'learn' (learn not yet implemented)
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

  // ── Hunter Mode state ──
  let hunterEnabled = false;       // runtime toggle (defaults to CFG.hunter.enabled)
  let hunterTimer   = null;        // interval for Hunter loop
  let hunterState   = 'IDLE';      // IDLE | DETECTED | TYPING | AWAIT_VERDICT | ADVANCE
  let hunterQuestion = '';         // last question word tracked by Hunter
  let hunterAdvancing = false;     // guard to prevent double-advance
 
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
    if (answerMap[q]) return answerMap[q];
    for (const [k, v] of Object.entries(answerMap))
      if (k.includes(q) || q.includes(k)) return v;
    let best = 0, bestVal = null;
    for (const [k, v] of Object.entries(answerMap)) {
      const sc = similarity(q, k);
      if (sc > best) { best = sc; bestVal = v; }
    }
    return best >= CFG.fuzzyThreshold ? bestVal : null;
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
      // Strip semicolon alts from BOTH sides when building the map
      const target = stripAlts((targets[i].textContent || '').trim());
      const base   = stripAlts((bases[i].textContent   || '').trim());
      if (target && base) {
        map[norm(target)] = base;
        map[norm(base)]   = target;
        count++;
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
 
  // ── Hunter Mode ════════════════════════════════════════════════════════════
  //
  //  Hunter Mode is an autonomous driver that sits on top of the existing
  //  answer-fill pipeline. Once the current question is answered (correct or
  //  wrong), it advances to the next one. If the answer was wrong, it dismisses
  //  the error overlay first.
  //
  //  State machine: IDLE → DETECTED → TYPING → AWAIT_VERDICT → ADVANCE → IDLE
  //
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Detect whether the current question has been answered (correct or wrong).
   * Returns one of:
   *   'correct'   – correct answer feedback is visible
   *   'incorrect' – incorrect / wrong-answer feedback is visible
   *   'unknown'  – question is still pending or no verdict yet
   *   null       – no question visible at all
   *
   * Selectors derived from real EP DOM snapshots in Implement/*.html
   */
  function detectVerdict() {
    // 1. Check for incorrect / wrong-answer signals (highest priority)
    //    EP adds class 'incorrect' to history-bar items and shows feedback
    const incorrectHistory = document.querySelector('.history-item.incorrect');
    if (incorrectHistory) return 'incorrect';

    // 2. In-game action bar with try-again button means wrong answer
    const tryAgainBtn = document.querySelector('.action-bar-button.try-again button, .action-bar-button.try-again');
    if (tryAgainBtn && tryAgainBtn.offsetParent !== null) return 'incorrect';

    // 3. Check for correct signals
    //    EP shows a 'correct-popup' or a 'correct-button' on correct answer
    const correctPopup = document.querySelector('.correct-popup');
    if (correctPopup && correctPopup.offsetParent !== null) return 'correct';

    const correctBtn = document.querySelector('#correct-button, .correct-button');
    if (correctBtn && correctBtn.offsetParent !== null) return 'correct';

    // 4. Cheer button often appears after a correct answer
    const cheerBtn = document.querySelector('.cheer-button:not(.ng-hide):not(.sf-hidden)');
    if (cheerBtn) return 'correct';

    // 5. Next-question button appearing means the current question is done
    const nextQBtn = document.querySelector('.next-question-button:not([disabled]), #next-question:not([disabled])');
    if (nextQBtn) return 'correct';

    // 6. If the question text has disappeared or changed, the question is done
    const questionSpan = document.getElementById('question-text');
    if (questionSpan) {
      const text = (questionSpan.textContent || '').trim();
      if (text.length === 0) return 'unknown';
    }

    return null; // no verdict yet
  }

  /**
   * Click the "Next" / "Continue" / "Try again" / "OK" button to advance
   * past the current question. Tries multiple selectors from the EP DOM.
   */
  function clickAdvanceButton() {
    // Priority list of selectors for the "move to next question" button
    const advanceSelectors = [
      // Next-question button (primary)
      '.next-question-button:not([disabled])',
      '#next-question:not([disabled])',
      // Correct feedback: Continue / Next button
      '#correct-button:not([disabled])',
      '.correct-button:not([disabled])',
      // Any button inside the sa-navigation-controls (EP's nav bar)
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      // Information controls (the "i" button that also acts as continue)
      '.information-controls button:not([disabled])',
      // Generic fallback: any enabled button in the action bar
      '.game-action-bar button:not([disabled])',
      // Cheer-button (post-correct animation)
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

    // Last resort: try to find any visible button with matching text
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(next|continue|ok|got it|try again|correct|done)$/i.test(text)) {
        console.log('[Hunter] Clicking advance by text:', text);
        btn.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Dismiss a wrong-answer / incorrect-feedback overlay and continue.
   * This is the Dismiss & Continue policy (CFG.hunter.errorPolicy: 'dismiss').
   * It looks for the try-again / continue / next button on the error overlay.
   */
  function dismissWrongAnswer() {
    // Priority selectors for the dismiss button on a wrong-answer overlay
    const dismissSelectors = [
      // Try-again button (EP's classic action bar)
      '.action-bar-button.try-again button:not([disabled])',
      '.action-bar-button.try-again:not(.ng-hide):not(.sf-hidden) button',
      // The game action bar's try-again
      '.game-action-bar .action-bar-button.try-again button:not([disabled])',
      // Generic continue / next in the feedback area
      '.feedback-button:not([disabled])',
      // SA navigation controls (next after wrong answer)
      '#sa-navigation-controls button:not([disabled])',
      '.sa-navigation-controls button:not([disabled])',
      // The action bar's first enabled button (usually continue/next)
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

    // Fallback: find any visible button with matching text
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(try again|continue|next|ok|got it|retry)$/i.test(text)) {
        console.log('[Hunter] Dismissing wrong answer by text:', text);
        btn.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Main Hunter tick — called every ~500ms when Hunter is active.
   * Implements the IDLE → DETECTED → TYPING → AWAIT_VERDICT → ADVANCE → IDLE
   * state machine.
   */
  function hunterTick() {
    if (!hunterEnabled || pageChanging) return;

    const url = window.location.href.toLowerCase();

    // ── State machine ──
    switch (hunterState) {

      case 'IDLE':
        // Wait for a question to appear
        const word = getQuestionWord();
        if (word) {
          hunterQuestion = word;
          hunterState = 'DETECTED';
          console.log('[Hunter] Question detected:', word);
          setDebug(`🕵️ Hunter: "${word.length > 20 ? word.slice(0,20)+'…' : word}"`);
        }
        break;

      case 'DETECTED':
        // The existing tryFill() pipeline handles typing. We just wait for
        // filling to complete, then transition to AWAIT_VERDICT.
        if (!filling) {
          hunterState = 'AWAIT_VERDICT';
          console.log('[Hunter] Waiting for verdict...');
        }
        break;

      case 'AWAIT_VERDICT':
        const verdict = detectVerdict();
        if (verdict === 'incorrect') {
          console.log('[Hunter] Verdict: INCORRECT — dismissing');
          showToast('❌ Wrong — dismissing...');
          setDebug('❌ Wrong — dismissing...');

          // Dismiss the wrong-answer overlay
          const dismissed = dismissWrongAnswer();
          if (dismissed) {
            // Wait for animations then advance
            setTimeout(() => {
              hunterState = 'ADVANCE';
            }, CFG.hunter.advanceDelay);
          } else {
            // If we couldn't find a dismiss button, try advancing anyway
            hunterState = 'ADVANCE';
          }
        } else if (verdict === 'correct') {
          console.log('[Hunter] Verdict: CORRECT — advancing');
          showToast('✅ Correct — advancing');
          setDebug('✅ Correct — advancing');
          hunterState = 'ADVANCE';
        } else if (verdict === 'unknown') {
          // Question text disappeared — question is done, just advance
          hunterState = 'ADVANCE';
        }
        // null = no verdict yet, stay in AWAIT_VERDICT
        break;

      case 'ADVANCE':
        if (hunterAdvancing) break;
        hunterAdvancing = true;

        console.log('[Hunter] Advancing to next question');
        setDebug('⏩ Advancing...');

        // First try to advance via the normal Next button
        const advanced = clickAdvanceButton();

        if (advanced) {
          // Reset state for next question after a short delay
          setTimeout(() => {
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            hunterAdvancing = false;
            setDebug('🕵️ Hunter ready');
          }, CFG.hunter.advanceDelay);
        } else {
          // No advance button found — might be at the end of a list
          // or the page transitioned. Reset and wait.
          setTimeout(() => {
            hunterState = 'IDLE';
            hunterQuestion = '';
            lastFilled = '';
            hunterAdvancing = false;
            setDebug('🕵️ Hunter (no advance btn — waiting)');
          }, 1000);
        }
        break;
    }

    // ── List-starter auto-start (when Hunter is on) ──
    if (url.includes('list-starter') && vocabUnlocked && auto) {
      // If we're on the list page and there's a start button, click it
      const startMain = document.getElementById('start-button-main');
      if (startMain && startMain.offsetParent !== null) {
        console.log('[Hunter] Clicking start-button-main');
        startMain.click();
      }
    }

    // ── Activity-starter auto-start ──
    if (url.includes('activity-starter')) {
      const startSchool = document.getElementById('start-button-school');
      if (startSchool && startSchool.offsetParent !== null) {
        console.log('[Hunter] Clicking start-button-school');
        startSchool.click();
      }
    }
  }

  /**
   * Start the Hunter loop. Called when the user toggles Hunter on.
   */
  function startHunter() {
    if (hunterTimer) clearInterval(hunterTimer);
    hunterEnabled = true;
    hunterState = 'IDLE';
    hunterQuestion = '';
    hunterAdvancing = false;
    hunterTimer = setInterval(hunterTick, 500);
    console.log('[Hunter] Started');
    showToast('🕵️ Hunter mode ON');
    setDebug('🕵️ Hunter ready');
  }

  /**
   * Stop the Hunter loop.
   */
  function stopHunter() {
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    hunterEnabled = false;
    hunterState = 'IDLE';
    hunterAdvancing = false;
    console.log('[Hunter] Stopped');
    showToast('🕵️ Hunter mode OFF');
    setDebug('');
  }

  /**
   * Skip the current list / task and navigate to the next available task
   * in the sidebar/content browser. This works by:
   * 1. Finding the current task item in the list-starter's grouped-options
   * 2. Clicking the next uncompleted item
   * 3. If no next item, navigate back to the content browser
   */
  function skipToNextTask() {
    const url = window.location.href.toLowerCase();

    // If we're on a list-starter page, find the next task in the sidebar
    if (url.includes('list-starter')) {
      // The grouped-options contains all tasks in the current section
      const items = document.querySelectorAll('#stats-parent .starter-panel .grouped-options > li.item');

      if (items.length > 0) {
        // Find the currently active/selected item
        let foundCurrent = false;
        for (const item of items) {
          if (foundCurrent) {
            // Click the next item
            item.click();
            showToast('⏭ Skipped to next task');
            console.log('[Hunter] Skipped to next task');
            return;
          }
          if (item.classList.contains('selected') || item.classList.contains('active')) {
            foundCurrent = true;
          }
        }
        // If no next item was found, try to go back to the browse view
        showToast('⏭ No more tasks — going back');
        console.log('[Hunter] No more tasks');
      }

      // Fallback: click the breadcrumb to go back
      const backCrumb = document.querySelector('.breadcrumbs .crumb');
      if (backCrumb) {
        backCrumb.click();
        showToast('⏭ Back to course view');
      }
      return;
    }

    // If we're in a game/activity, navigate back to the list starter
    if (url.includes('game') || url.includes('activity-starter')) {
      // Look for a back/close button or the sidebar navigation
      const backBtn = document.querySelector('#sa-navigation-controls .back-button, .back-button, [data-action="back"]');
      if (backBtn) {
        backBtn.click();
        showToast('⏭ Going back to list');
        return;
      }

      // Fallback: try to find the list starter route
      const listLink = document.querySelector('a[href*="list-starter"], [ng-click*="list-starter"]');
      if (listLink) {
        listLink.click();
        showToast('⏭ Navigating to list');
        return;
      }

      showToast('⚠️ No back button found');
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
          <button class="ep-btn skip-btn" id="ep-skip">⏭ Skip</button>
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
 
    // Show Hunter & Skip buttons on any task page (list-starter, activity-starter, or game)
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