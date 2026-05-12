// ==UserScript==
// @name         EP Answer Assistant chat
// @namespace    https://educationperfect.com
// @version      3.5.0
// @description  Auto-fills answers on Education Perfect safely at the cursor location.
// @author       You
// @match        https://app.educationperfect.com/*
// @match        https://*.educationperfect.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Config
  // ─────────────────────────────────────────────────────────────
  const CFG = {
    fuzzyThreshold : 0.60,
    typeDelay      : 0.01,
    toastDuration  : 0.1,
    pollInterval   : 0,
    cooldown       : 0,
    typeCooldown   : 0.1,
  };

  // ─────────────────────────────────────────────────────────────
  // Selectors
  // ─────────────────────────────────────────────────────────────
  const SEL = {
    targetLang        : '.targetLanguage.question-label',
    baseLang          : '.baseLanguage.question-label',
    answerInput       : '#answer-text',
    questionContainer : '.v-group.h-align-center.v-align-center',
    questionSpan      : 'span[class=""], span:not([class])',
    prompt            : '.prompt.ng-binding',
  };

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────
  // Navigation Safety
  // ─────────────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    pageChanging = true;
  });

  // ─────────────────────────────────────────────────────────────
  // Track Active Cursor Element
  // ─────────────────────────────────────────────────────────────
  document.addEventListener('focusin', e => {
    const el = e.target;

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el.isContentEditable
    ) {
      activeEditable = el;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const la = a.length;
    const lb = b.length;

    if (Math.abs(la - lb) / Math.max(la, lb) > 0.55) {
      return 0;
    }

    const dp = Array.from({ length: la + 1 }, (_, i) => [i]);

    for (let j = 0; j <= lb; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(
                dp[i - 1][j],
                dp[i][j - 1],
                dp[i - 1][j - 1]
              );
      }
    }

    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  function findAnswer(raw) {
    const q = norm(raw);

    if (!q) return null;

    if (answerMap[q]) {
      return answerMap[q];
    }

    for (const [k, v] of Object.entries(answerMap)) {
      if (k.includes(q) || q.includes(k)) {
        return v;
      }
    }

    let best = 0;
    let bestVal = null;

    for (const [k, v] of Object.entries(answerMap)) {
      const sc = similarity(q, k);

      if (sc > best) {
        best = sc;
        bestVal = v;
      }
    }

    return best >= CFG.fuzzyThreshold ? bestVal : null;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─────────────────────────────────────────────────────────────
  // Load Vocabulary
  // ─────────────────────────────────────────────────────────────
  function loadAnswers() {
    const map = {};
    let count = 0;

    const targets = [...document.querySelectorAll(SEL.targetLang)];
    const bases   = [...document.querySelectorAll(SEL.baseLang)];

    const len = Math.min(targets.length, bases.length);

    for (let i = 0; i < len; i++) {
      const target = (targets[i].textContent || '').trim();
      const base   = (bases[i].textContent || '').trim();

      if (target && base) {
        map[norm(target)] = base;
        map[norm(base)] = target;
        count++;
      }
    }

    answerMap = map;

    lastFilled    = '';
    cooldownUntil = 0;

    updatePanel(count);

    showToast(
      count > 0
        ? `✅ ${count} pairs loaded`
        : `⚠️ No vocab found`
    );

    console.log('[EP] Loaded', count, 'pairs');

    return count;
  }

  // ─────────────────────────────────────────────────────────────
  // Detect Current Question
  // ─────────────────────────────────────────────────────────────
  function getQuestionWord() {
    const JUNK =
      /^(replay|hint|submit|electronic|voice|translate|from|to|french|english|writing|reading|listening|dictation|speaking|practise|pronunciation|master|advanced|unit|vocab|list|\d+%?)$/i;

    for (const container of document.querySelectorAll(SEL.questionContainer)) {
      for (const span of container.querySelectorAll(SEL.questionSpan)) {
        const text = (span.textContent || '').trim();

        if (
          text.length >= 2 &&
          text.length <= 80 &&
          !JUNK.test(text)
        ) {
          return text;
        }
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Native Value Setter
  // ─────────────────────────────────────────────────────────────
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);

    const descriptor =
      Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Safe Typing Function
  // ─────────────────────────────────────────────────────────────
  async function typeAtCursor(el, text) {
    if (!el) return;

    el.focus();

    // ── contenteditable support ──
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

        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: ch
        }));

        if (CFG.typeDelay > 0) {
          await sleep(CFG.typeDelay);
        }
      }

      return;
    }

    // ── normal input / textarea ──
    for (const ch of text) {
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd ?? start;

      const before = el.value.slice(0, start);
      const after  = el.value.slice(end);

      const newValue = before + ch + after;

      setNativeValue(el, newValue);

      const pos = start + 1;

      el.setSelectionRange(pos, pos);

      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: ch
      }));

      if (CFG.typeDelay > 0) {
        await sleep(CFG.typeDelay);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Main Fill Logic
  // ─────────────────────────────────────────────────────────────
  async function tryFill() {
    if (!enabled) return;
    if (filling) return;
    if (pageChanging) return;

    if (Date.now() < cooldownUntil) {
      return;
    }

    if (Date.now() - lastTypeTime < CFG.typeCooldown) {
      return;
    }

    const input =
      activeEditable ||
      document.activeElement ||
      document.querySelector(SEL.answerInput);

    if (!input) return;

    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement
    ) {
      if ((input.value || '').trim().length > 0) {
        return;
      }
    }

    const word = getQuestionWord();

    if (!word) return;

    const answer = findAnswer(word);

    if (!answer) {
      cooldownUntil = Date.now() + CFG.cooldown;
      setDebug(`No match: "${word}"`);
      return;
    }

    const key = `${word}→${answer}`;

    if (key === lastFilled) {
      return;
    }

    lastFilled = key;

    filling = true;
    lastTypeTime = Date.now();

    setDebug(`Typing: "${word}" → "${answer}"`);

    console.log(`[EP] "${word}" → "${answer}"`);

    try {
      await typeAtCursor(input, answer);

      showToast(
        `💡 ${
          answer.length > 48
            ? answer.slice(0, 48) + '…'
            : answer
        }`
      );
    } catch (e) {
      console.warn('[EP] Typing error:', e);
    }

    filling = false;
  }

  // ─────────────────────────────────────────────────────────────
  // Observer
  // ─────────────────────────────────────────────────────────────
  function startObserver() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(() => {
      tryFill();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────────────────────
  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
    }

    pollTimer = setInterval(() => {
      tryFill();
    }, CFG.pollInterval);
  }

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────
  let panel;
  let countEl;
  let toggleBtn;
  let debugEl;

  function setDebug(msg) {
    if (debugEl) {
      debugEl.textContent = msg;
    }
  }

  function buildPanel() {
    const style = document.createElement('style');

    style.textContent = `
      #ep-panel{
        position:fixed;
        top:72px;
        right:16px;
        z-index:2147483647;
        width:240px;
        background:#0f1120;
        border:1px solid #222540;
        border-radius:14px;
        box-shadow:0 12px 44px rgba(0,0,0,.65);
        font:13px/1.45 'Segoe UI',system-ui,sans-serif;
        color:#c4ccec;
        user-select:none;
      }

      #ep-handle{
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:10px 14px;
        border-bottom:1px solid #1c2040;
        cursor:grab;
      }

      #ep-handle:active{
        cursor:grabbing;
      }

      #ep-logo{
        font-weight:700;
        color:#6aa3f8;
      }

      #ep-x{
        background:none;
        border:none;
        color:#666;
        font-size:16px;
        cursor:pointer;
      }

      #ep-body{
        padding:14px;
      }

      #ep-count{
        font-size:12px;
        margin-bottom:12px;
      }

      #ep-count.ok{
        color:#4ad97d;
      }

      #ep-count.warn{
        color:#ffb347;
      }

      #ep-btns{
        display:flex;
        gap:8px;
        margin-bottom:12px;
      }

      .ep-btn{
        flex:1;
        padding:8px;
        border:none;
        border-radius:8px;
        cursor:pointer;
        background:#1b213a;
        color:#c4ccec;
        font-weight:600;
      }

      .ep-btn:hover{
        background:#28304d;
      }

      .paused{
        background:#6d2222 !important;
      }

      #ep-hint{
        font-size:11px;
        color:#68708f;
        line-height:1.5;
      }

      #ep-debug{
        margin-top:10px;
        font-size:10px;
        color:#58607a;
        word-break:break-word;
      }

      #ep-toast{
        position:fixed;
        bottom:22px;
        right:18px;
        z-index:2147483647;
        background:#0f1120;
        border:1px solid #222540;
        border-radius:11px;
        padding:10px 17px;
        color:#c4ccec;
        box-shadow:0 8px 32px rgba(0,0,0,.6);
        opacity:0;
        transform:translateY(7px);
        transition:opacity .18s,transform .18s;
        pointer-events:none;
        max-width:270px;
      }

      #ep-toast.show{
        opacity:1;
        transform:translateY(0);
      }
    `;

    document.head.appendChild(style);

    panel = document.createElement('div');

    panel.id = 'ep-panel';

    panel.innerHTML = `
      <div id="ep-handle">
        <span id="ep-logo">⚡ EP Assistant</span>
        <button id="ep-x">✕</button>
      </div>

      <div id="ep-body">
        <div id="ep-count">Not loaded</div>

        <div id="ep-btns">
          <button class="ep-btn" id="ep-load">
            🔄 Load
          </button>

          <button class="ep-btn" id="ep-toggle">
            ⏸ Pause
          </button>
        </div>

        <div id="ep-hint">
          Auto-types at your current cursor position.
          <br>
          Press Enter manually to submit.
        </div>

        <div id="ep-debug"></div>
      </div>
    `;

    document.body.appendChild(panel);

    countEl   = panel.querySelector('#ep-count');
    toggleBtn = panel.querySelector('#ep-toggle');
    debugEl   = panel.querySelector('#ep-debug');

    panel.querySelector('#ep-load')
      .addEventListener('click', loadAnswers);

    panel.querySelector('#ep-x')
      .addEventListener('click', () => {
        panel.style.display = 'none';
      });

    toggleBtn.addEventListener('click', () => {
      enabled = !enabled;

      toggleBtn.textContent =
        enabled ? '⏸ Pause' : '▶ Resume';

      toggleBtn.classList.toggle('paused', !enabled);

      showToast(
        enabled ? '▶ Resumed' : '⏸ Paused'
      );
    });

    makeDraggable(panel, panel.querySelector('#ep-handle'));
  }

  function updatePanel(count) {
    if (!countEl) return;

    countEl.textContent =
      count > 0
        ? `✅ ${count} pairs loaded`
        : '❌ No vocab found';

    countEl.className =
      count > 0
        ? 'ok'
        : 'warn';
  }

  // ─────────────────────────────────────────────────────────────
  // Toasts
  // ─────────────────────────────────────────────────────────────
  let toastEl;
  let toastTimer;

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'ep-toast';

      document.body.appendChild(toastEl);
    }

    toastEl.textContent = msg;

    toastEl.classList.add('show');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, CFG.toastDuration);
  }

  // ─────────────────────────────────────────────────────────────
  // Draggable Panel
  // ─────────────────────────────────────────────────────────────
  function makeDraggable(el, handle) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();

      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      function move(ev) {
        el.style.right = 'auto';
        el.style.left = `${ev.clientX - offsetX}px`;
        el.style.top = `${ev.clientY - offsetY}px`;
      }

      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────
  function init() {
    buildPanel();

    setTimeout(() => {
      const count = loadAnswers();

      if (count === 0) {
        showToast(
          '⚠️ Open vocab list first then press Load'
        );
      }
    }, 1500);

    startObserver();
    startPolling();

    console.log('[EP Assistant v3.5] Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1000);
  }

})();
