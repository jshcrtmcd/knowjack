/* THINK&STUFF game controller.
   Screens: menu → info (mode) → round intro → question → … → results.
   Depends on CategoryValidator, GameAudio, Host. */
(function () {
  'use strict';

  // ---------- Tunables ----------
  const KEYS = ['A', 'B', 'C', 'D'];
  const READ_MS = 2200;            // time to read the question before the options appear (clock frozen)
  const MIN_POINTS = 50;           // correct at the buzzer
  const TIME_POINTS = 100;         // extra for an instant answer (scales down to 0)
  const FEEDBACK_AUTO_MS = 3500;   // auto-advance after a correct answer in game mode
  const LIGHTNING_FLASH_MS = 650;  // pause between lightning questions

  // Round plan for game mode. `tier` picks concepts from the ordered ladder (0 = first third …).
  const ROUNDS = [
    { key: 'r1', name: 'Foundations', desc: 'The physiology everything else leans on.', seconds: 90, perQuestion: 12, tier: 0, mult: 1 },
    { key: 'r2', name: 'Recognition', desc: 'Reading monitors, gases, and rhythms.', seconds: 90, perQuestion: 12, tier: 1, mult: 1 },
    { key: 'r3', name: 'Applied', desc: 'Scenarios — what do you do about it?', seconds: 90, perQuestion: 12, tier: 2, mult: 1 },
    { key: 'lightning', name: 'Rapid Fire', desc: 'Two choices. Six seconds. Double points. No mercy.', seconds: 45, perQuestion: 6, tier: null, mult: 2, lightning: true }
  ];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const screens = { menu: $('screen-menu'), info: $('screen-info'), round: $('screen-round'), question: $('screen-question'), results: $('screen-results') };
  const el = {};
  ['categoryList', 'customFile', 'menuError', 'infoTitle', 'infoDesc', 'infoConcepts', 'infoQuestions', 'infoBest', 'infoPath',
    'startGameBtn', 'readHint', 'readCount', 'roundKicker', 'roundName', 'roundDesc', 'roundClockInfo', 'roundPerQ', 'roundMult', 'roundStartBtn',
    'roundClock', 'roundClockBar', 'roundClockName', 'roundClockTime', 'qProgress', 'qConcept', 'score', 'timerBar', 'timerText',
    'questionCard', 'questionVisual', 'questionText', 'choices', 'feedback', 'feedbackVerdict', 'feedbackPoints', 'feedbackExplain', 'nextBtn',
    'finalScore', 'finalBest', 'finalCorrect', 'finalAccuracy', 'finalAvgTime', 'roundScores', 'breakdown', 'weakSpots', 'review',
    'replayBtn', 'menuBtn', 'homeBtn', 'muteBtn', 'voiceBtn', 'host', 'hostText', 'hostMouth'].forEach((id) => { el[id] = $(id); });

  // ---------- State ----------
  const state = {
    category: null, orderedConcepts: [], sourceName: '',
    mode: 'game',             // 'game' | 'study'
    rounds: [], roundIndex: 0, round: null,
    pool: [], poolIndex: 0,   // questions for the current round
    item: null, qNumber: 0,
    score: 0, roundScore: 0, streak: 0,
    answers: [],              // {conceptId, conceptTitle, correct, points, seconds, timedOut, round, question, answerText}
    q: { start: 0, raf: 0, lastTick: -1, running: false, pausedAt: 0, elimPlan: [], elimDone: 0 },
    rc: { remaining: 0, lastTs: 0, running: false, raf: 0 },
    locked: false, roundOver: false, autoTimer: 0, readTimer: 0
  };

  // ---------- Helpers ----------
  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    el.host.hidden = (name === 'results');
    window.scrollTo({ top: 0 });
  }
  function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

  function hostSay(key, vars) {
    const { text, done } = Host.say(key, vars);
    el.hostText.textContent = text;
    el.host.classList.remove('pop'); void el.host.offsetWidth; el.host.classList.add('pop');
    el.host.classList.add('talking');
    clearTimeout(hostSay.t);
    hostSay.t = setTimeout(() => el.host.classList.remove('talking'), Math.min(4000, 400 + text.length * 35));
    el.hostMouth.setAttribute('d', key.startsWith('correct') || key === 'streak' ? 'M24 43 q8 7 16 0' : key === 'wrong' || key === 'timeout' ? 'M25 46 q7 -4 14 0' : 'M25 44 q7 5 14 0');
    return done;
  }

  function showError(title, lines) {
    el.menuError.hidden = false; el.menuError.innerHTML = '';
    const strong = document.createElement('strong'); strong.textContent = title; el.menuError.appendChild(strong);
    if (lines && lines.length) {
      const ul = document.createElement('ul'); ul.style.margin = '8px 0 0'; ul.style.paddingLeft = '18px';
      lines.slice(0, 12).forEach((l) => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
      if (lines.length > 12) { const li = document.createElement('li'); li.textContent = `…and ${lines.length - 12} more.`; ul.appendChild(li); }
      el.menuError.appendChild(ul);
    }
  }
  function clearError() { el.menuError.hidden = true; el.menuError.innerHTML = ''; }

  // ---------- High scores ----------
  function bestKey() { return `thinkstuff.best.${(state.category && state.category.category) || ''}`; }
  function getBest() { try { return parseInt(localStorage.getItem(bestKey()) || '0', 10) || 0; } catch (e) { return 0; } }
  function setBest(v) { try { localStorage.setItem(bestKey(), String(v)); } catch (e) { /* ignore */ } }

  // ---------- Menu / loading ----------
  async function loadManifest() {
    try {
      const res = await fetch('categories/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      if (!Array.isArray(manifest.categories)) throw new Error('manifest.json needs a "categories" array.');
      renderMenu(manifest.categories);
    } catch (err) {
      el.categoryList.innerHTML = '';
      const note = document.createElement('div'); note.className = 'muted';
      note.textContent = location.protocol === 'file:'
        ? 'Built-in categories can\'t be fetched when the page is opened directly from a file. Use "Load custom category" below, or serve the folder (see README).'
        : `Couldn't load the category list (${err.message}). You can still load a custom category below.`;
      el.categoryList.appendChild(note);
    }
  }

  function renderMenu(categories) {
    el.categoryList.innerHTML = '';
    if (!categories.length) { el.categoryList.innerHTML = '<div class="muted">No categories listed yet.</div>'; return; }
    categories.forEach((c) => {
      const btn = document.createElement('button'); btn.className = 'cat-card'; btn.type = 'button';
      const h = document.createElement('h3'); h.textContent = c.name || c.file;
      const p = document.createElement('p'); p.textContent = c.description || '';
      btn.append(h, p);
      btn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.play('click'); loadCategoryFile(c.file); });
      el.categoryList.appendChild(btn);
    });
  }

  async function loadCategoryFile(file) {
    clearError();
    try {
      const res = await fetch(`categories/${file}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      acceptCategory(await res.text(), file);
    } catch (err) { showError(`Couldn't load "${file}"`, [err.message]); }
  }

  function acceptCategory(text, sourceName) {
    let data;
    try { data = JSON.parse(text); } catch (err) { showError(`"${sourceName}" is not valid JSON`, [err.message]); return false; }
    const errors = CategoryValidator.validate(data);
    if (errors.length) { showError(`"${sourceName}" has ${errors.length} problem${errors.length === 1 ? '' : 's'}:`, errors); return false; }
    state.category = data; state.sourceName = sourceName;
    state.orderedConcepts = CategoryValidator.orderConcepts(data.concepts);
    renderInfo(); show('info');
    hostSay('welcome');
    return true;
  }

  el.customFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    GameAudio.unlock();
    const reader = new FileReader();
    reader.onload = () => acceptCategory(String(reader.result), file.name);
    reader.onerror = () => showError(`Couldn't read "${file.name}"`, []);
    reader.readAsText(file); e.target.value = '';
  });

  // ---------- Category info ----------
  function renderInfo() {
    const cat = state.category;
    el.infoTitle.textContent = cat.category; el.infoDesc.textContent = cat.description;
    el.infoConcepts.textContent = cat.concepts.length;
    el.infoQuestions.textContent = cat.concepts.reduce((n, c) => n + c.questions.length, 0);
    const b = getBest(); el.infoBest.textContent = b ? String(b) : '—';
    el.infoPath.innerHTML = '';
    state.orderedConcepts.forEach((c) => { const li = document.createElement('li'); li.textContent = `${c.title} (${c.questions.length})`; el.infoPath.appendChild(li); });
  }

  // ---------- Building question pools ----------
  function makeItem(concept, q, lightning) {
    let choices = q.choices.map((text, i) => ({ text, isCorrect: i === q.answerIndex }));
    if (lightning) {
      const correct = choices.find((c) => c.isCorrect);
      const wrong = shuffle(choices.filter((c) => !c.isCorrect))[0];
      choices = [correct, wrong];
    }
    return { concept, question: q, choices: shuffle(choices) };
  }

  function tierConcepts(tier) {
    const n = state.orderedConcepts.length;
    const size = Math.ceil(n / 3);
    const slice = state.orderedConcepts.slice(tier * size, (tier + 1) * size);
    return slice.length ? slice : state.orderedConcepts; // tiny categories: use everything
  }

  function buildRoundPool(round) {
    const concepts = round.tier === null ? state.orderedConcepts : tierConcepts(round.tier);
    // Interleave concepts so one topic doesn't hog the round: round-robin over shuffled per-concept queues.
    const queues = shuffle(concepts).map((c) => ({ c, qs: shuffle(c.questions) }));
    const out = [];
    let added = true;
    while (added) {
      added = false;
      for (const qu of queues) { const q = qu.qs.shift(); if (q) { out.push(makeItem(qu.c, q, !!round.lightning)); added = true; } }
    }
    return out;
  }

  // ---------- Starting a game ----------
  function startGame() {
    state.score = 0; state.streak = 0; state.answers = []; state.qNumber = 0; state.roundOver = false;
    el.score.textContent = '0';
    state.rounds = ROUNDS.map((r) => Object.assign({}, r));
    state.roundIndex = -1;
    nextRound();
  }

  function nextRound() {
    state.roundOver = false;
    state.roundIndex += 1;
    if (state.roundIndex >= state.rounds.length) { finishGame(); return; }
    state.round = state.rounds[state.roundIndex];
    state.roundScore = 0;
    state.pool = buildRoundPool(state.round);
    state.poolIndex = 0;
    const r = state.round;
    const timed = state.rounds.filter((x) => !x.lightning).length;
    el.roundKicker.textContent = r.lightning ? 'Lightning round' : `Round ${state.roundIndex + 1} of ${timed}`;
    el.roundName.textContent = r.name; el.roundDesc.textContent = r.desc;
    el.roundClockInfo.textContent = fmtClock(r.seconds); el.roundPerQ.textContent = `${r.perQuestion}s`; el.roundMult.textContent = `${r.mult}×`;
    el.roundStartBtn.textContent = r.lightning ? 'Go!' : 'Start round';
    show('round');
    hostSay(r.lightning ? 'lightningIntro' : 'roundIntro', { round: state.roundIndex + 1, name: r.name });
  }

  el.roundStartBtn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.play('click'); Host.hush(); beginRound(); });

  function beginRound() {
    const r = state.round;
    show('question');
    document.body.classList.toggle('lightning', !!r.lightning);
    el.roundClock.classList.toggle('lightning', !!r.lightning);
    el.roundClockName.textContent = r.lightning ? 'Rapid Fire' : r.name;
    startRoundClock(r.seconds);
    pauseRoundClock();          // nothing ticks until the options are on screen
    nextQuestion();
  }

  // ---------- Round clock ----------
  function startRoundClock(seconds) {
    state.rc.remaining = seconds; state.rc.running = true; state.rc.lastTs = performance.now();
    el.roundClockTime.textContent = fmtClock(seconds);
    el.roundClock.classList.remove('paused', 'ending');
    el.roundClockBar.style.transform = 'scaleX(1)';
    cancelAnimationFrame(state.rc.raf);
    const loop = (ts) => {
      if (!state.rc.running) return;
      state.rc.remaining -= (ts - state.rc.lastTs) / 1000; state.rc.lastTs = ts;
      const frac = Math.max(0, state.rc.remaining / state.round.seconds);
      el.roundClockBar.style.transform = `scaleX(${frac})`;
      el.roundClockTime.textContent = fmtClock(state.rc.remaining);
      el.roundClock.classList.toggle('ending', state.rc.remaining <= 10);
      if (state.rc.remaining <= 0) { state.rc.running = false; onRoundOver(); return; }
      state.rc.raf = requestAnimationFrame(loop);
    };
    state.rc.raf = requestAnimationFrame(loop);
  }
  function pauseRoundClock() { if (!state.rc.running) return; state.rc.running = false; cancelAnimationFrame(state.rc.raf); el.roundClock.classList.add('paused'); }
  function resumeRoundClock() {
    if (state.rc.remaining <= 0 || state.rc.running) return;
    state.rc.running = true; state.rc.lastTs = performance.now(); el.roundClock.classList.remove('paused');
    cancelAnimationFrame(state.rc.raf);
    const loop = (ts) => {
      if (!state.rc.running) return;
      state.rc.remaining -= (ts - state.rc.lastTs) / 1000; state.rc.lastTs = ts;
      const frac = Math.max(0, state.rc.remaining / state.round.seconds);
      el.roundClockBar.style.transform = `scaleX(${frac})`;
      el.roundClockTime.textContent = fmtClock(state.rc.remaining);
      el.roundClock.classList.toggle('ending', state.rc.remaining <= 10);
      if (state.rc.remaining <= 0) { state.rc.running = false; onRoundOver(); return; }
      state.rc.raf = requestAnimationFrame(loop);
    };
    state.rc.raf = requestAnimationFrame(loop);
  }

  function onRoundOver() {
    if (state.roundOver) return;           // guard: Next-button mashing or a late timer must not re-enter
    state.roundOver = true;
    // Round clock expired mid-question: that question is abandoned (not scored).
    stopQuestionTimer(); state.locked = true; clearTimeout(state.autoTimer);
    el.feedback.hidden = true;
    el.choices.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
    GameAudio.play('timeout');
    const r = state.round;
    const roundAnswers = state.answers.filter((a) => a.round === r.key);
    const acc = roundAnswers.length ? roundAnswers.filter((a) => a.correct).length / roundAnswers.length : 0;
    el.readHint.hidden = true; el.choices.classList.remove('pending'); clearTimeout(state.readTimer); clearTimeout(state.readMain);
    const spoken = hostSay(acc >= 0.6 ? 'roundEndGood' : 'roundEndRough', { score: state.score });
    r.score = state.roundScore;
    const wait = new Promise((res) => setTimeout(res, 1800));
    Promise.all([wait, spoken]).then(() => { if (screens.question.classList.contains('active')) nextRound(); });
  }

  // ---------- Question timer + elimination ----------
  function startQuestionTimer(seconds) {
    stopQuestionTimer();
    state.q.start = performance.now(); state.q.lastTick = -1; state.q.running = true; state.q.elimDone = 0;
    el.timerBar.className = 'timer-bar';
    const loop = () => {
      if (!state.q.running) return;
      const elapsed = (performance.now() - state.q.start) / 1000;
      const remaining = Math.max(0, seconds - elapsed);
      const frac = remaining / seconds;
      el.timerBar.style.transform = `scaleX(${frac})`;
      const whole = Math.ceil(remaining);
      el.timerText.textContent = whole;
      if (whole !== state.q.lastTick) { state.q.lastTick = whole; if (whole <= 3 && whole > 0) GameAudio.play('tick'); }
      el.timerBar.classList.toggle('warn', frac <= 0.5 && frac > 0.25);
      el.timerBar.classList.toggle('danger', frac <= 0.25);
      // Elimination: strike wrong options at the planned thresholds.
      const plan = state.q.elimPlan;
      while (state.q.elimDone < plan.length && frac <= plan[state.q.elimDone].at) {
        eliminateChoice(plan[state.q.elimDone].index); state.q.elimDone += 1;
      }
      if (remaining <= 0) { onTimeout(); return; }
      state.q.raf = requestAnimationFrame(loop);
    };
    state.q.raf = requestAnimationFrame(loop);
  }
  function stopQuestionTimer() { state.q.running = false; cancelAnimationFrame(state.q.raf); state.q.raf = 0; }
  function questionSeconds() { return (performance.now() - state.q.start) / 1000; }

  function planElimination(item) {
    const wrongIdx = shuffle(item.choices.map((c, i) => (c.isCorrect ? -1 : i)).filter((i) => i >= 0));
    const n = item.choices.length;
    if (state.round.lightning || n <= 2) return [];
    if (n === 3) return [{ at: 0.4, index: wrongIdx[0] }];
    return [{ at: 0.5, index: wrongIdx[0] }, { at: 0.25, index: wrongIdx[1] }];
  }

  function eliminateChoice(index) {
    const btn = el.choices.children[index]; if (!btn || btn.classList.contains('eliminated')) return;
    btn.classList.add('eliminated'); btn.disabled = true;
    GameAudio.play('click');
    if (state.q.elimDone === 0 && Math.random() < 0.5) hostSay('eliminated');
  }

  // ---------- Questions ----------
  function nextQuestion() {
    clearTimeout(state.autoTimer);
    clearTimeout(state.readTimer); clearTimeout(state.readMain);
    if (state.roundOver) return;
    if (state.poolIndex >= state.pool.length) {
      // Ran out of questions before the clock: end the round.
      state.rc.running = false; cancelAnimationFrame(state.rc.raf); onRoundOver();
      return;
    }
    const item = state.pool[state.poolIndex]; state.item = item; state.qNumber += 1; state.locked = false;
    el.qProgress.textContent = `Q${state.qNumber}`;
    el.qConcept.textContent = item.concept.title;
    el.questionText.textContent = item.question.question;
    el.questionCard.classList.remove('shake', 'flash-good', 'flash-bad');
    el.feedback.hidden = true; el.feedback.className = 'feedback';
    renderVisual(item.question);

    el.choices.innerHTML = '';
    item.choices.forEach((choice, i) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'choice'; btn.dataset.index = String(i);
      const key = document.createElement('span'); key.className = 'key'; key.textContent = KEYS[i];
      const text = document.createElement('span'); text.textContent = choice.text;
      btn.append(key, text);
      btn.addEventListener('click', () => answer(i));
      el.choices.appendChild(btn);
    });
    state.q.elimPlan = planElimination(item);

    // Reading phase: options hidden, both clocks frozen, timer bar full.
    el.timerBar.className = 'timer-bar'; el.timerBar.style.transform = 'scaleX(1)'; el.timerText.textContent = state.round.perQuestion;
    el.choices.classList.add('pending');
    const readMs = state.round.lightning ? Math.round(READ_MS * 0.55) : READ_MS;
    el.readHint.hidden = false;
    const readStart = performance.now();
    const countdown = () => {
      const left = Math.max(0, readMs - (performance.now() - readStart));
      el.readCount.textContent = Math.ceil(left / 1000);
      if (left > 0 && screens.question.classList.contains('active')) state.readTimer = setTimeout(countdown, 100);
    };
    countdown();
    state.readMain = setTimeout(() => {
      if (!screens.question.classList.contains('active') || state.roundOver) return;
      el.readHint.hidden = true;
      el.choices.classList.remove('pending');
      GameAudio.play('buzzIn');
      resumeRoundClock();
      startQuestionTimer(state.round.perQuestion);
    }, readMs);
  }

  function renderVisual(q) {
    const box = el.questionVisual; box.innerHTML = ''; box.hidden = true;
    if (!q.image) return;
    box.hidden = false;
    const token = (renderVisual.token = (renderVisual.token || 0) + 1);
    const fallback = () => { const img = document.createElement('img'); img.src = q.image; img.alt = q.imageAlt || ''; box.innerHTML = ''; box.appendChild(img); };
    if (!/\.svg(\?|#|$)/i.test(q.image)) { fallback(); return; }
    fetch(q.image, { cache: 'force-cache' }).then((r) => { if (!r.ok) throw new Error(); return r.text(); }).then((svgText) => {
      if (token !== renderVisual.token) return;
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const svg = doc.querySelector('svg'); if (!svg) throw new Error();
      svg.querySelectorAll('script').forEach((s) => s.remove());
      svg.removeAttribute('width'); svg.removeAttribute('height');
      box.appendChild(document.importNode(svg, true));
      if (q.highlight) {
        const target = box.querySelector(`#${CSS.escape(q.highlight)}`);
        if (target) {
          target.classList.add('hl');
          try {
            const bb = target.getBBox();
            const m = document.createElementNS('http://www.w3.org/2000/svg', 'g'); m.setAttribute('class', 'hl-marker');
            const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
            m.innerHTML = `<circle cx="${cx}" cy="${cy}" r="13" fill="#ff5f9e" stroke="#fff" stroke-width="3"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="900" fill="#fff" font-family="system-ui, sans-serif">?</text>`;
            box.querySelector('svg').appendChild(m);
          } catch (e) { /* getBBox can fail if not rendered yet; outline still shows */ }
        }
      }
    }).catch(fallback);
  }

  function lockChoices() { el.choices.querySelectorAll('.choice').forEach((b) => { b.disabled = true; }); }
  function revealCorrect() {
    el.choices.querySelectorAll('.choice').forEach((b, i) => {
      if (state.item.choices[i].isCorrect) { b.classList.remove('eliminated'); b.classList.add('correct'); }
      else if (!b.classList.contains('wrong')) b.classList.add('dim');
    });
  }

  function answer(choiceIndex) {
    if (state.locked) return;
    state.locked = true; stopQuestionTimer(); lockChoices(); pauseRoundClock();
    const item = state.item, r = state.round;
    const seconds = Math.min(r.perQuestion, questionSeconds());
    const frac = Math.max(0, 1 - seconds / r.perQuestion);
    const correct = item.choices[choiceIndex].isCorrect;
    const correctText = item.choices.find((c) => c.isCorrect).text;
    let points = 0;

    if (correct) {
      points = (MIN_POINTS + Math.round(TIME_POINTS * frac)) * r.mult;
      state.score += points; state.roundScore += points; state.streak += 1;
      el.score.textContent = state.score;
      el.score.classList.remove('bump'); void el.score.offsetWidth; el.score.classList.add('bump');
      GameAudio.play('correct');
    } else {
      state.streak = 0;
      el.choices.children[choiceIndex].classList.add('wrong');
      el.questionCard.classList.add('shake');
      GameAudio.play('wrong'); vibrate([60, 40, 60]);
    }
    revealCorrect();
    record(item, correct, points, seconds, false, correctText);

    if (r.lightning) {
      el.questionCard.classList.add(correct ? 'flash-good' : 'flash-bad');
      state.poolIndex += 1;
      state.autoTimer = setTimeout(nextQuestion, LIGHTNING_FLASH_MS);
      return;
    }

    if (correct) {
      const spoken = (state.streak > 0 && state.streak % 3 === 0) ? hostSay('streak', { streak: state.streak }) : hostSay(frac > 0.5 ? 'correctFast' : 'correctSlow');
      showFeedback(true, `+${points} points`, item.question.explanation);
      // Auto-advance after the explanation has had a moment AND the host has finished talking.
      const minWait = new Promise((res) => { state.autoTimer = setTimeout(res, FEEDBACK_AUTO_MS); });
      const myItem = item;
      Promise.all([minWait, spoken]).then(() => { if (state.item === myItem && state.locked && screens.question.classList.contains('active')) el.nextBtn.click(); });
    } else {
      hostSay('wrong', { answer: correctText });
      showFeedback(false, `Correct answer: ${correctText}`, item.question.explanation);
    }
  }

  function onTimeout() {
    if (state.locked) return;
    state.locked = true; stopQuestionTimer(); lockChoices(); pauseRoundClock();
    const item = state.item, r = state.round;
    const correctText = item.choices.find((c) => c.isCorrect).text;
    el.timerText.textContent = '0'; el.timerBar.style.transform = 'scaleX(0)';
    el.questionCard.classList.add('shake'); GameAudio.play('timeout'); vibrate(120);
    state.streak = 0;
    revealCorrect();
    record(item, false, 0, r.perQuestion, true, correctText);
    if (r.lightning) {
      el.questionCard.classList.add('flash-bad'); state.poolIndex += 1;
      state.autoTimer = setTimeout(nextQuestion, LIGHTNING_FLASH_MS); return;
    }
    hostSay('timeout', { answer: correctText });
    showFeedback(false, `Time's up! Correct answer: ${correctText}`, item.question.explanation, 'Out of time');
  }

  function showFeedback(good, pointsLine, explanation, verdictOverride) {
    el.feedback.hidden = false; el.feedback.classList.add(good ? 'good' : 'bad');
    el.feedbackVerdict.textContent = verdictOverride || (good ? 'Correct!' : 'Nope.');
    el.feedbackPoints.textContent = pointsLine; el.feedbackExplain.textContent = explanation;
    el.nextBtn.textContent = 'Next →';
    el.nextBtn.focus({ preventScroll: true });
    el.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function record(item, correct, points, seconds, timedOut, answerText) {
    state.answers.push({ conceptId: item.concept.id, conceptTitle: item.concept.title, correct, points, seconds, timedOut, round: state.round.key, roundName: state.round.name, question: item.question.question, answerText, explanation: item.question.explanation });
  }

  el.nextBtn.addEventListener('click', () => {
    clearTimeout(state.autoTimer);
    if (!state.locked || state.roundOver) return;
    GameAudio.play('click'); Host.hush();
    state.poolIndex += 1;
    if (state.rc.remaining <= 0) { onRoundOver(); return; }
    nextQuestion();
  });

  // ---------- Results ----------
  function finishGame() {
    stopQuestionTimer(); state.rc.running = false; cancelAnimationFrame(state.rc.raf); clearTimeout(state.autoTimer);
    document.body.classList.remove('lightning');
    if (state.round) state.round.score = state.roundScore;
    const total = state.answers.length, correct = state.answers.filter((a) => a.correct).length;
    const avg = total ? state.answers.reduce((s, a) => s + a.seconds, 0) / total : 0;
    el.finalScore.textContent = state.score;
    el.finalCorrect.textContent = `${correct}/${total}`;
    el.finalAccuracy.textContent = total ? `${Math.round((correct / total) * 100)}%` : '0%';
    el.finalAvgTime.textContent = `${avg.toFixed(1)}s`;

    const best = getBest(); const isBest = state.score > best && total > 0;
    if (isBest) setBest(state.score);
    el.finalBest.hidden = !isBest;

    el.roundScores.innerHTML = '';
    {
      state.rounds.forEach((r) => {
        const d = document.createElement('div'); d.className = 'stat';
        const n = document.createElement('div'); n.className = 'stat-num'; n.textContent = r.score || 0;
        const l = document.createElement('div'); l.className = 'stat-label'; l.textContent = r.lightning ? '⚡ rapid' : r.name;
        d.append(n, l); el.roundScores.appendChild(d);
      });
    }

    // Breakdown by concept, learning-path order.
    const byConcept = new Map();
    state.orderedConcepts.forEach((c) => byConcept.set(c.id, { title: c.title, total: 0, correct: 0, points: 0 }));
    state.answers.forEach((a) => { const row = byConcept.get(a.conceptId); if (!row) return; row.total += 1; row.correct += a.correct ? 1 : 0; row.points += a.points; });
    el.breakdown.innerHTML = ''; const weak = [];
    byConcept.forEach((row) => {
      if (!row.total) return;
      const pct = Math.round((row.correct / row.total) * 100); if (pct < 60) weak.push(row.title);
      const div = document.createElement('div'); div.className = 'bd-row';
      const head = document.createElement('div'); head.className = 'bd-head';
      const name = document.createElement('span'); name.textContent = `${row.title} — ${row.correct}/${row.total}`;
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = `${row.points} pts`;
      head.append(name, pts);
      const bar = document.createElement('div'); bar.className = 'bd-bar';
      const fill = document.createElement('div'); fill.className = 'bd-fill' + (pct < 60 ? ' low' : pct < 85 ? ' mid' : '');
      bar.appendChild(fill); div.append(head, bar); el.breakdown.appendChild(div);
      requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
    });
    el.weakSpots.innerHTML = '';
    if (weak.length) { const s = document.createElement('strong'); s.textContent = 'Review next: '; el.weakSpots.appendChild(s); el.weakSpots.appendChild(document.createTextNode(weak.join(' · '))); }

    // Missed-question review (lightning ones never showed an explanation, so they're first).
    el.review.innerHTML = '';
    const missed = state.answers.filter((a) => !a.correct).sort((a, b) => (b.round === 'lightning') - (a.round === 'lightning'));
    missed.forEach((a) => {
      const d = document.createElement('div'); d.className = 'rv';
      const tag = document.createElement('span'); tag.className = 'rv-tag'; tag.textContent = (a.round === 'lightning' ? '⚡ Rapid Fire · ' : '') + a.conceptTitle;
      const q = document.createElement('div'); q.className = 'rv-q'; q.textContent = a.question;
      const ans = document.createElement('div'); ans.className = 'rv-a'; ans.textContent = (a.timedOut ? 'Out of time — ' : '') + a.answerText;
      const ex = document.createElement('div'); ex.className = 'rv-e'; ex.textContent = a.explanation;
      d.append(tag, q, ans, ex); el.review.appendChild(d);
    });

    show('results');
    const acc = total ? correct / total : 0;
    const key = acc >= 0.8 ? 'finalGreat' : acc >= 0.5 ? 'finalOk' : 'finalRough';
    Host.say(key, { score: state.score }); // results screen hides the bubble; voice still plays
    GameAudio.play('fanfare');
  }

  // ---------- Global controls ----------
  function goMenu() {
    stopQuestionTimer(); state.rc.running = false; cancelAnimationFrame(state.rc.raf); clearTimeout(state.autoTimer); clearTimeout(state.readTimer); clearTimeout(state.readMain);
    document.body.classList.remove('lightning'); Host.hush(); state.roundOver = false;
    state.locked = true; clearError(); show('menu');
    el.hostText.textContent = Host.line('welcome');
  }

  el.startGameBtn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.play('click'); startGame(); });
  el.replayBtn.addEventListener('click', () => { GameAudio.play('click'); startGame(); });
  el.menuBtn.addEventListener('click', () => { GameAudio.play('click'); goMenu(); });
  el.homeBtn.addEventListener('click', () => {
    if (screens.question.classList.contains('active') && !confirm('Leave this game? Your score will be lost.')) return;
    goMenu();
  });

  function renderToggles() {
    const m = GameAudio.isMuted();
    el.muteBtn.textContent = m ? '🔇' : '🔊'; el.muteBtn.title = m ? 'Unmute sound effects' : 'Mute sound effects';
    el.muteBtn.setAttribute('aria-label', el.muteBtn.title); el.muteBtn.setAttribute('aria-pressed', String(m));
    const v = Host.isVoiceOn();
    el.voiceBtn.style.opacity = v ? '1' : '.45'; el.voiceBtn.title = v ? 'Host voice: on' : 'Host voice: off';
    el.voiceBtn.setAttribute('aria-label', el.voiceBtn.title); el.voiceBtn.setAttribute('aria-pressed', String(v));
    el.voiceBtn.hidden = !Host.voiceSupported();
  }
  el.muteBtn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.toggle(); renderToggles(); if (!GameAudio.isMuted()) GameAudio.play('click'); });
  el.voiceBtn.addEventListener('click', () => { Host.toggleVoice(); renderToggles(); if (Host.isVoiceOn()) Host.speak(`Voice on. I'm ${Host.name}. Try to keep up.`); });
  renderToggles();

  // Keyboard: A–D / 1–4 to answer, Enter/Space to continue.
  document.addEventListener('keydown', (e) => {
    if (screens.round.classList.contains('active') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.roundStartBtn.click(); return; }
    if (!screens.question.classList.contains('active')) return;
    if (!el.feedback.hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.nextBtn.click(); return; }
    const k = e.key.toUpperCase();
    let idx = KEYS.indexOf(k); if (idx < 0 && /^[1-4]$/.test(k)) idx = parseInt(k, 10) - 1;
    const btn = el.choices.children[idx];
    if (idx >= 0 && btn && !btn.disabled && !el.choices.classList.contains('pending')) btn.click();
  });

  // Pause both clocks if the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.q.running) { state.q.pausedAt = performance.now(); cancelAnimationFrame(state.q.raf); }
      pauseRoundClock();
    } else {
      if (state.q.running && state.q.pausedAt) {
        state.q.start += performance.now() - state.q.pausedAt; state.q.pausedAt = 0;
        const saved = state.q.start, elimDone = state.q.elimDone;
        startQuestionTimer(state.round.perQuestion); state.q.start = saved; state.q.elimDone = elimDone;
      }
      if (!state.locked && state.q.running && screens.question.classList.contains('active')) resumeRoundClock();
    }
  });

  el.hostText.textContent = Host.line('welcome');
  window.__thinkstuff = state; // debug/testing hook (read-only use)
  loadManifest();
})();
