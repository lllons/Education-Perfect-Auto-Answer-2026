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

  // ── Hunter Mode Config (Phase 2 + Phase 3) ─────────────────────────────────
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
      // ── Phase 3 additions ──
      maxAdvanceAttempts : 5,
      stuckStateMs       : 30000,
      safeMinDelayMs     : 80,
      safeMaxDelayMs     : 5000,
      watchdogMs         : 120000,
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
  let hunterEnabled          = false;
  let hunterTimer            = null;
  let hunterDelayedTimers    = [];   // setTimeout handles inside Hunter — all cleared on stop
  let hunterState            = 'IDLE';
  let hunterPrevState        = 'IDLE';
  let hunterStateEntryMs     = 0;    // wall-clock at last state change (for watchdog)
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

  // ─── Phase 3: lifecycle / watcher plumbing ───────────────────────────────
  let hunterLastPageUrl      = '';   // detect SPA route changes
  let hunterLastActiveMs     = 0;    // last tick observed activity on the page

  // ─── Phase 4: progress + ETA ─────────────────────────────────
  // Rolling avg of ms spent per question (excluding the last one so a long
  // current question doesn't poison the ETA). 80-sample sliding window.
  let hunterQuestionTimes    = [];   // most recent first
  let hunterQuestionStartMs  = 0;
  let hunterEtaTimer         = null;

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
    // 1. Canonical EP field — verified in Implement/* (multiple files).
    const canonical = document.getElementById('correct-answer-field');
    if (canonical && (canonical.textContent || '').trim()) {
      const t = cleanScrapedAnswer(canonical.textContent);
      if (t) return t;
    }

    // 2. Green-span reconstruction from #users-answer-field breakdown.
    //    Inside there:
    //      style="color:#0a0"           = part of the correct answer
    //      style="color:#c00"           = user got this part wrong
    //      style="color:rgba(0,0,0,.25)" = gray, partial correctness / hint
    //    We concatenate ONLY the green spans in DOM order — they're the
    //    parts the system knew were correct, regardless of what the user
    //    typed.
    const usersField = document.getElementById('users-answer-field');
    if (usersField) {
      const greenPieces = usersField.querySelectorAll('span[style*="color:#0a0"], span[style*="color: rgb(0, 170, 0)"], span[style*="rgb(0,170,0)"], span[style*="color:green"], span[class*="green"]');
      if (greenPieces.length > 0) {
        const merged = Array.from(greenPieces)
          .map(s => (s.textContent || '').trim())
          .filter(Boolean)
          .join(' ')
          .trim();
        if (merged) {
          const t = cleanScrapedAnswer(merged);
          if (t) return t;
        }
      }
      // Fallback to the whole breakdown text — it'll often contain the
      // correct word(s) separated by EP's highlight formatting.
      const full = cleanScrapedAnswer(usersField.textContent);
      if (full) return full;
    }

    // 3. tr.correct inside the open dialog with the longest .native-font.
    const dialog = queryVisible('.modeless-answer-dialog');
    if (dialog) {
      const correct = dialog.querySelector('tr.correct');
      if (correct) {
        const fields = correct.querySelectorAll('.native-font, td');
        const text = lastFieldText(fields);
        if (text) {
          const t = cleanScrapedAnswer(text);
          if (t) return t;
        }
      }
    }

    // 4. .correct-popup / any last-resort visible field.
    const anyField = queryVisible('#correct-answer-field, .correct-popup .native-font, .correct-answer');
    if (anyField && (anyField.textContent || '').trim()) {
      const t = cleanScrapedAnswer(anyField.textContent);
      if (t) return t;
    }
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

    // Don't accidentally erase a previously-good answerMap entry.
    // (We learned from this mistake; we shouldn't lose the original fuzzy
    //  matches that worked before.)
    if (!answerMap[q]) answerMap[q] = a;
    const aKey = norm(a);
    if (aKey && aKey !== q && !answerMap[aKey]) answerMap[aKey] = qSrc;

    // Let the re-typing of this question happen cleanly.
    lastFilled = '';

    try {
      let learned = {};
      const stored = localStorage.getItem(LEARNED_KEY);
      if (stored) {
        try { learned = JSON.parse(stored) || {}; } catch (e) { learned = {}; }
      }
      learned[q] = a;
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
    hunterQuestionsAnswered++;
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
  function autoNextList() {
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
        if (foundCurrent) {
          if (safeClick(item)) {
            console.log('[Hunter] autoNext: clicked sidebar item');
            return true;
          }
          continue;
        }
        if (item.classList.contains('selected') ||
            item.classList.contains('active')   ||
            item.classList.contains('current')  ||
            item.getAttribute('aria-selected') === 'true') {
          foundCurrent = true;
        }
      }
      // No "next" after the current — open the first not-completed item.
      for (const item of items) {
        const cls = item.className || '';
        if (cls.includes('not-started') || !cls.includes('completed')) {
          if (safeClick(item)) {
            console.log('[Hunter] autoNext: opened first non-completed task');
            return true;
          }
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
    if (!hunterEnabled) return;
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
      setDebug('👤 Human typing — Hunter idle');
    }
    if (hunterHumanTimer) clearTimeout(hunterHumanTimer);
    hunterHumanTimer = setTimeout(() => {
      if (!hunterEnabled) return;
      hunterHumanActive    = false;
      hunterHumanSuspended = false;
      console.log('[Hunter] Human idle — resuming');
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
  function clickContinueButton() {
    // 1. The exact EP `#continue-button` (priority 1A: outside modal, 1B: inside).
    const selectors = [
      '#continue-button:not([disabled])',
      '.modal-footer #continue-button:not([disabled])',
      '.modeless-answer-dialog #continue-button:not([disabled])',
      '.modal-footer button.nice-button:not([disabled])',
      '#continue-button',
      '.modal-footer #continue-button',
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
      '.nav-bar-exit',
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
  function skipToNextTask() {
    const url = window.location.href.toLowerCase();

    if (url.includes('list-starter')) {
      // Two kinds of lists: sidebar (li[title]) and mode picker (li.item).
      const itemSelectors = [
        '#stats-parent li[title]',
        '#left-controls-panel li[title]',
        '#stats-parent .starter-panel li.item',
        '#stats-parent .starter-panel .grouped-options > li.item',
        '.grouped-options > li.item',
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
        if (foundCurrent) {
          if (safeClick(item)) {
            showToast('⏭ Skipped to next task');
            console.log('[Hunter] Skipped sidebar item');
          } else {
            showToast('⚠️ Could not click next item');
          }
          return;
        }
        if (item.classList.contains('selected') ||
            item.classList.contains('active')   ||
            item.classList.contains('current')  ||
            item.getAttribute('aria-selected') === 'true') {
          foundCurrent = true;
        }
      }

      if (!foundCurrent) {
        if (safeClick(items[0])) {
          showToast('⏭ Skipped to first task');
          console.log('[Hunter] Skipped to first sidebar item');
        }
        return;
      }

      // foundCurrent but no next-after: the list is exhausted.
      showToast('🏁 No more tasks here — back to course view');
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
      showToast('🛟 Hunter reset (global watchdog)');
      hunterSetState('IDLE');
    }
  }

  function hunterTick() {
    if (!hunterEnabled || pageChanging) return;

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

    // LIST_DONE short-circuit: detected at top, even mid-state.
    if (detectListDone() &&
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
          hunterSetState('DETECTED');
          hunterNoAdvance      = 0;
          console.log('[Hunter] DETECTED:', word);
          updateHunterDebug();
        }
        break;
      }

      case 'DETECTED': {
        // Question visible, wait for tryFill() pipeline to start typing.
        if (filling) {
          hunterSetState('TYPING');
          console.log('[Hunter] TYPING');
          setDebug('⌨️ Typing answer…');
        }
        break;
      }

      case 'TYPING': {
        // Pipeline finished; transition to verdict polling after EP has
        // had a moment to submit + grade. Phase 3: deferred callback is
        // tracked in hunterDelayedTimers (clamped duration) so we can
        // cleanly cancel it on STOP / page-change.
        if (!filling) {
          hunterDefer(() => {
            if (hunterState === 'TYPING') hunterSetState('AWAIT_VERDICT');
          }, Math.max(120, CFG.typeCooldown * 1000));
        }
        break;
      }

      case 'AWAIT_VERDICT': {
        const verdict = detectVerdict();
        if (!verdict) break; // still waiting

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

          // Phase 4 priority order:
          //   1. Click `#continue-button` ("Next question") — the most
          //      reliable path on every error modal layout we tested.
          //   2. Fall back to broader dismissal only if that fails.
          const continued = clickContinueButton();
          if (!continued) dismissWrongAnswer();
          hunterDefer(() => {
            if (hunterState === 'AWAIT_VERDICT') hunterSetState('ADVANCE');
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
                if (url.includes('list-starter') && vocabUnlocked) {
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
        showToast('🏁 List complete');

        if (CFG.hunter.autoContinueLists) {
          hunterDefer(() => {
            if (!hunterEnabled) return;
            const moved = autoNextList();
            if (moved) {
              hunterDefer(() => {
                hunterSetState('IDLE');
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
        const startMain = queryVisible('#start-button-main');
        if (startMain) safeClick(startMain);
      } else if (url.includes('activity-starter')) {
        const startSchool = queryVisible('#start-button-school');
        if (startSchool) safeClick(startSchool);
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
    hunterBadgeEl.style.display = '';
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
    if (hunterHumanTimer) {
      clearTimeout(hunterHumanTimer);
      hunterHumanTimer = null;
    }

    // Hydrate answerMap with previously-learned pairs from localStorage.
    loadLearnedAnswers();

    // Wire all human-presence listeners (capture phase, so we beat EP).
    addHumanListeners();

    hunterTimer = setInterval(hunterTick, 500);
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

  /** Stop Hunter Mode. Idempotent. */
  function stopHunter() {
    if (hunterTimer) {
      clearInterval(hunterTimer);
      hunterTimer = null;
    }
    clearHunterDelayedTimers();
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
    removeHumanListeners();

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
