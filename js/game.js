/* Game controller: menu → category info → questions → results.
   Depends on CategoryValidator (validator.js) and GameAudio (audio.js). */
(function () {
  'use strict';

  // ---------- Tunables ----------
  const QUESTION_SECONDS = 15;   // time per question
  const BASE_POINTS = 100;       // for any correct answer
  const MAX_TIME_BONUS = 50;     // extra points for an instant correct answer, scales down to 0
  const KEYS = ['A', 'B', 'C', 'D'];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $('screen-menu'),
    info: $('screen-info'),
    question: $('screen-question'),
    results: $('screen-results')
  };
  const el = {
    categoryList: $('categoryList'), customFile: $('customFile'), menuError: $('menuError'),
    infoTitle: $('infoTitle'), infoDesc: $('infoDesc'), infoConcepts: $('infoConcepts'),
    infoQuestions: $('infoQuestions'), infoSeconds: $('infoSeconds'), infoPath: $('infoPath'),
    optShuffle: $('optShuffle'), optPerConcept: $('optPerConcept'), startBtn: $('startBtn'),
    qProgress: $('qProgress'), qConcept: $('qConcept'), score: $('score'),
    timerBar: $('timerBar'), timerText: $('timerText'),
    questionCard: $('questionCard'), questionText: $('questionText'), choices: $('choices'),
    feedback: $('feedback'), feedbackVerdict: $('feedbackVerdict'), feedbackPoints: $('feedbackPoints'),
    feedbackExplain: $('feedbackExplain'), nextBtn: $('nextBtn'),
    finalScore: $('finalScore'), finalCorrect: $('finalCorrect'), finalAccuracy: $('finalAccuracy'),
    finalAvgTime: $('finalAvgTime'), breakdown: $('breakdown'), weakSpots: $('weakSpots'),
    replayBtn: $('replayBtn'), menuBtn: $('menuBtn'), homeBtn: $('homeBtn'), muteBtn: $('muteBtn')
  };

  // ---------- State ----------
  const state = {
    category: null,        // validated category object
    orderedConcepts: [],   // concepts in prerequisite order
    queue: [],             // [{concept, question, choices:[{text, isCorrect}], ...}]
    index: 0,
    score: 0,
    answers: [],           // {conceptId, correct, points, seconds, timedOut}
    timer: { start: 0, raf: 0, lastTick: -1, running: false },
    locked: false
  };

  // ---------- Helpers ----------
  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0 });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showError(title, lines) {
    el.menuError.hidden = false;
    el.menuError.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = title;
    el.menuError.appendChild(strong);
    if (lines && lines.length) {
      const ul = document.createElement('ul');
      ul.style.margin = '8px 0 0';
      ul.style.paddingLeft = '18px';
      lines.slice(0, 12).forEach((l) => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
      if (lines.length > 12) { const li = document.createElement('li'); li.textContent = `…and ${lines.length - 12} more.`; ul.appendChild(li); }
      el.menuError.appendChild(ul);
    }
  }

  function clearError() { el.menuError.hidden = true; el.menuError.innerHTML = ''; }

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
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = location.protocol === 'file:'
        ? 'Built-in categories can\'t be fetched when the page is opened directly from a file. Use "Load custom category" below, or serve the folder (see README).'
        : `Couldn't load the category list (${err.message}). You can still load a custom category below.`;
      el.categoryList.appendChild(note);
    }
  }

  function renderMenu(categories) {
    el.categoryList.innerHTML = '';
    if (!categories.length) {
      el.categoryList.innerHTML = '<div class="muted">No categories listed yet.</div>';
      return;
    }
    categories.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'cat-card';
      btn.type = 'button';
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
      const text = await res.text();
      acceptCategory(text, file);
    } catch (err) {
      showError(`Couldn't load "${file}"`, [err.message]);
    }
  }

  function acceptCategory(text, sourceName) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showError(`"${sourceName}" is not valid JSON`, [err.message]);
      return false;
    }
    const errors = CategoryValidator.validate(data);
    if (errors.length) {
      showError(`"${sourceName}" has ${errors.length} problem${errors.length === 1 ? '' : 's'}:`, errors);
      return false;
    }
    state.category = data;
    state.orderedConcepts = CategoryValidator.orderConcepts(data.concepts);
    renderInfo();
    show('info');
    return true;
  }

  el.customFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    GameAudio.unlock();
    const reader = new FileReader();
    reader.onload = () => acceptCategory(String(reader.result), file.name);
    reader.onerror = () => showError(`Couldn't read "${file.name}"`, []);
    reader.readAsText(file);
    e.target.value = ''; // allow re-selecting the same file
  });

  // ---------- Category info ----------
  function renderInfo() {
    const cat = state.category;
    el.infoTitle.textContent = cat.category;
    el.infoDesc.textContent = cat.description;
    el.infoConcepts.textContent = cat.concepts.length;
    el.infoQuestions.textContent = cat.concepts.reduce((n, c) => n + c.questions.length, 0);
    el.infoSeconds.textContent = QUESTION_SECONDS;
    el.infoPath.innerHTML = '';
    state.orderedConcepts.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.title} (${c.questions.length})`;
      el.infoPath.appendChild(li);
    });
  }

  function buildQueue() {
    const perConcept = parseInt(el.optPerConcept.value, 10) || 0;
    const doShuffle = el.optShuffle.checked;
    const queue = [];
    state.orderedConcepts.forEach((concept) => {
      let qs = doShuffle ? shuffle(concept.questions) : concept.questions.slice();
      if (perConcept > 0) qs = qs.slice(0, perConcept);
      qs.forEach((q) => {
        const choices = shuffle(q.choices.map((text, i) => ({ text, isCorrect: i === q.answerIndex })));
        queue.push({ concept, question: q, choices });
      });
    });
    return queue;
  }

  function startGame() {
    state.queue = buildQueue();
    state.index = 0;
    state.score = 0;
    state.answers = [];
    el.score.textContent = '0';
    show('question');
    nextQuestion();
  }

  // ---------- Timer ----------
  function startTimer() {
    stopTimer();
    state.timer.start = performance.now();
    state.timer.lastTick = -1;
    state.timer.running = true;
    el.timerBar.className = 'timer-bar';
    const loop = () => {
      if (!state.timer.running) return;
      const elapsed = (performance.now() - state.timer.start) / 1000;
      const remaining = Math.max(0, QUESTION_SECONDS - elapsed);
      const frac = remaining / QUESTION_SECONDS;
      el.timerBar.style.transform = `scaleX(${frac})`;
      const whole = Math.ceil(remaining);
      el.timerText.textContent = whole;
      if (whole !== state.timer.lastTick) {
        state.timer.lastTick = whole;
        if (whole <= 5 && whole > 0) GameAudio.play('tick');
      }
      el.timerBar.classList.toggle('warn', frac <= 0.5 && frac > 0.25);
      el.timerBar.classList.toggle('danger', frac <= 0.25);
      if (remaining <= 0) { onTimeout(); return; }
      state.timer.raf = requestAnimationFrame(loop);
    };
    state.timer.raf = requestAnimationFrame(loop);
  }

  function stopTimer() {
    state.timer.running = false;
    if (state.timer.raf) cancelAnimationFrame(state.timer.raf);
    state.timer.raf = 0;
  }

  function elapsedSeconds() { return (performance.now() - state.timer.start) / 1000; }

  // ---------- Questions ----------
  function nextQuestion() {
    if (state.index >= state.queue.length) { finishGame(); return; }
    const item = state.queue[state.index];
    state.locked = false;

    el.qProgress.textContent = `${state.index + 1} / ${state.queue.length}`;
    el.qConcept.textContent = item.concept.title;
    el.questionText.textContent = item.question.question;
    el.questionCard.classList.remove('shake');
    el.feedback.hidden = true;
    el.feedback.className = 'feedback';

    el.choices.innerHTML = '';
    item.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice';
      btn.dataset.index = String(i);
      const key = document.createElement('span'); key.className = 'key'; key.textContent = KEYS[i];
      const text = document.createElement('span'); text.textContent = choice.text;
      btn.append(key, text);
      btn.addEventListener('click', () => answer(i));
      el.choices.appendChild(btn);
    });

    GameAudio.play('buzzIn');
    startTimer();
  }

  function lockChoices() {
    el.choices.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
  }

  function revealCorrect() {
    const item = state.queue[state.index];
    el.choices.querySelectorAll('.choice').forEach((b, i) => {
      if (item.choices[i].isCorrect) b.classList.add('correct');
      else if (!b.classList.contains('wrong')) b.classList.add('dim');
    });
  }

  function answer(choiceIndex) {
    if (state.locked) return;
    state.locked = true;
    stopTimer();
    lockChoices();

    const item = state.queue[state.index];
    const seconds = Math.min(QUESTION_SECONDS, elapsedSeconds());
    const correct = item.choices[choiceIndex].isCorrect;
    let points = 0;

    if (correct) {
      const bonus = Math.round(MAX_TIME_BONUS * Math.max(0, 1 - seconds / QUESTION_SECONDS));
      points = BASE_POINTS + bonus;
      state.score += points;
      el.score.textContent = state.score;
      el.score.classList.remove('bump'); void el.score.offsetWidth; el.score.classList.add('bump');
      GameAudio.play('correct');
      showFeedback(true, `+${BASE_POINTS} points` + (bonus ? ` +${bonus} speed bonus` : ''), item.question.explanation);
    } else {
      el.choices.children[choiceIndex].classList.add('wrong');
      el.questionCard.classList.add('shake');
      GameAudio.play('wrong');
      const correctText = item.choices.find((c) => c.isCorrect).text;
      showFeedback(false, `Correct answer: ${correctText}`, item.question.explanation);
    }
    revealCorrect();
    record(item, correct, points, seconds, false);
  }

  function onTimeout() {
    if (state.locked) return;
    state.locked = true;
    stopTimer();
    lockChoices();
    const item = state.queue[state.index];
    el.timerText.textContent = '0';
    el.timerBar.style.transform = 'scaleX(0)';
    el.questionCard.classList.add('shake');
    GameAudio.play('timeout');
    const correctText = item.choices.find((c) => c.isCorrect).text;
    showFeedback(false, `Time's up! Correct answer: ${correctText}`, item.question.explanation, "Out of time");
    revealCorrect();
    record(item, false, 0, QUESTION_SECONDS, true);
  }

  function showFeedback(good, pointsLine, explanation, verdictOverride) {
    el.feedback.hidden = false;
    el.feedback.classList.add(good ? 'good' : 'bad');
    el.feedbackVerdict.textContent = verdictOverride || (good ? 'Correct!' : 'Nope.');
    el.feedbackPoints.textContent = pointsLine;
    el.feedbackExplain.textContent = explanation;
    el.nextBtn.textContent = state.index + 1 >= state.queue.length ? 'See results →' : 'Next →';
    el.nextBtn.focus({ preventScroll: true });
    el.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function record(item, correct, points, seconds, timedOut) {
    state.answers.push({ conceptId: item.concept.id, conceptTitle: item.concept.title, correct, points, seconds, timedOut });
  }

  el.nextBtn.addEventListener('click', () => {
    GameAudio.play('click');
    state.index += 1;
    nextQuestion();
  });

  // ---------- Results ----------
  function finishGame() {
    stopTimer();
    const total = state.answers.length;
    const correct = state.answers.filter((a) => a.correct).length;
    const avg = total ? state.answers.reduce((s, a) => s + a.seconds, 0) / total : 0;

    el.finalScore.textContent = state.score;
    el.finalCorrect.textContent = `${correct}/${total}`;
    el.finalAccuracy.textContent = total ? `${Math.round((correct / total) * 100)}%` : '0%';
    el.finalAvgTime.textContent = `${avg.toFixed(1)}s`;

    // Breakdown by concept (topic), in learning-path order.
    const byConcept = new Map();
    state.orderedConcepts.forEach((c) => byConcept.set(c.id, { title: c.title, total: 0, correct: 0, points: 0 }));
    state.answers.forEach((a) => {
      const row = byConcept.get(a.conceptId);
      if (!row) return;
      row.total += 1; row.correct += a.correct ? 1 : 0; row.points += a.points;
    });

    el.breakdown.innerHTML = '';
    const weak = [];
    byConcept.forEach((row) => {
      if (!row.total) return;
      const pct = Math.round((row.correct / row.total) * 100);
      if (pct < 60) weak.push(row.title);
      const div = document.createElement('div');
      div.className = 'bd-row';
      const head = document.createElement('div'); head.className = 'bd-head';
      const name = document.createElement('span'); name.textContent = `${row.title} — ${row.correct}/${row.total}`;
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = `${row.points} pts`;
      head.append(name, pts);
      const bar = document.createElement('div'); bar.className = 'bd-bar';
      const fill = document.createElement('div'); fill.className = 'bd-fill' + (pct < 60 ? ' low' : pct < 85 ? ' mid' : '');
      bar.appendChild(fill);
      div.append(head, bar);
      el.breakdown.appendChild(div);
      requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
    });

    el.weakSpots.innerHTML = '';
    if (weak.length) {
      const s = document.createElement('strong'); s.textContent = 'Review next: ';
      el.weakSpots.appendChild(s);
      el.weakSpots.appendChild(document.createTextNode(weak.join(' · ')));
    }

    show('results');
    GameAudio.play('fanfare');
  }

  // ---------- Global controls ----------
  function goMenu() {
    stopTimer();
    state.locked = true;
    clearError();
    show('menu');
  }

  el.startBtn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.play('click'); startGame(); });
  el.replayBtn.addEventListener('click', () => { GameAudio.play('click'); startGame(); });
  el.menuBtn.addEventListener('click', () => { GameAudio.play('click'); goMenu(); });
  el.homeBtn.addEventListener('click', () => {
    if (screens.question.classList.contains('active') && !confirm('Leave this game? Your score will be lost.')) return;
    goMenu();
  });

  function renderMute() {
    const m = GameAudio.isMuted();
    el.muteBtn.textContent = m ? '🔇' : '🔊';
    el.muteBtn.title = m ? 'Unmute sound' : 'Mute sound';
    el.muteBtn.setAttribute('aria-label', el.muteBtn.title);
    el.muteBtn.setAttribute('aria-pressed', String(m));
  }
  el.muteBtn.addEventListener('click', () => { GameAudio.unlock(); GameAudio.toggle(); renderMute(); if (!GameAudio.isMuted()) GameAudio.play('click'); });
  renderMute();

  // Keyboard: A–D / 1–4 to answer, Enter/Space to continue.
  document.addEventListener('keydown', (e) => {
    if (!screens.question.classList.contains('active')) return;
    if (!el.feedback.hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.nextBtn.click(); return; }
    const k = e.key.toUpperCase();
    let idx = KEYS.indexOf(k);
    if (idx < 0 && /^[1-4]$/.test(k)) idx = parseInt(k, 10) - 1;
    const btn = el.choices.children[idx];
    if (idx >= 0 && btn && !btn.disabled) btn.click();
  });

  // Pause the timer if the tab is hidden so a phone call doesn't cost the question.
  document.addEventListener('visibilitychange', () => {
    if (!state.timer.running) return;
    if (document.hidden) {
      state.timer.pausedAt = performance.now();
      cancelAnimationFrame(state.timer.raf);
    } else if (state.timer.pausedAt) {
      state.timer.start += performance.now() - state.timer.pausedAt;
      state.timer.pausedAt = 0;
      startTimerResume();
    }
  });
  function startTimerResume() {
    // Re-enter the loop without resetting the start time.
    const savedStart = state.timer.start;
    startTimer();
    state.timer.start = savedStart;
  }

  loadManifest();
})();
