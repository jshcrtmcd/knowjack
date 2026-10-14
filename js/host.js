/* The host: Vivian Vex — a cabaret hostess of indeterminate vintage, impossibly glamorous,
   effortlessly condescending, deeply fond of herself and, against her better judgment, of you.
   Speech-bubble lines + optional voice (Web Speech API). Exposed as window.Host.
   Edit LINES freely; {round}, {name}, {score}, {streak}, {answer} are filled in at runtime. */
(function (global) {
  'use strict';

  const VOICE_KEY = 'thinkstuff.voice';

  const LINES = {
    welcome: [
      "Darling. I'm Vivian Vex. I've hosted for royalty, for astronauts, and now, apparently, for you.",
      "Welcome to THINK&STUFF. I was promised champagne and an audience. I see we're at one out of two.",
      "Pick a category, sweetheart. I'll be here looking expensive.",
      "I've been told to be encouraging. I've also been told I'm forty. Neither is strictly true."
    ],
    roundIntro: [
      "Round {round}: {name}. The clock only runs while you're dithering, so — don't.",
      "Round {round}, darling. {name}. I once answered an entire round in a single blink. Different era.",
      "{name}. Round {round}. Quick and right. I like my answers the way I like my ex-husbands: brief."
    ],
    lightningIntro: [
      "Rapid Fire, darling. Two choices, six seconds, double points. No explanations — we gossip about it afterward.",
      "Lightning round. If you hesitate, I'll know. I always know. It's unsettling, I'm told."
    ],
    correctFast: [
      "Oh, well done. I felt that in my pearls.",
      "Correct, and quick. You've clearly done this before, or you're guessing beautifully.",
      "Yes! See, this is why I keep you around.",
      "Right. Effortless. I taught you nothing and I'll take full credit.",
      "That's the one, darling. Don't get smug — that's my job.",
      "Correct. Somewhere, a tiny orchestra played."
    ],
    correctSlow: [
      "Right... eventually. I aged a little waiting, and I don't age.",
      "Correct. The pace was glacial, but the destination was lovely.",
      "You got there. I've seen slower. Not many, but I have.",
      "That's right, sweetheart. Next time, perhaps before the curtain falls."
    ],
    wrong: [
      "No, darling. It was {answer}. Read the little explanation — I had it written specially.",
      "Wrong, but confidently, which is half of showbusiness. It was {answer}.",
      "Mm. {answer}. Let's never speak of this again. Except on the results screen.",
      "Not that one. {answer}. I've made worse choices with better lighting.",
      "Incorrect. {answer}. I'm not angry, I'm just filing it away."
    ],
    timeout: [
      "Time! Nothing at all? Bold. Tragic, but bold. It was {answer}.",
      "The clock won, darling. It usually does. {answer}.",
      "You froze. It happens to the best of us, by which I mean you. It was {answer}."
    ],
    eliminated: [
      "There. I removed one for you. Consider it a gift.",
      "One fewer wrong answer. I'm generous in small, cheap ways.",
      "Gone. You're welcome. Still your move."
    ],
    streak: [
      "{streak} in a row. Keep going, I'm starting to enjoy this.",
      "That's {streak} straight. Should I be worried? I'm a little worried.",
      "{streak} in a row, darling. Someone's showing off. Good. Show off."
    ],
    roundEndGood: [
      "That's the round. {score} points. Honestly, I'm a touch impressed, and I've met Marlene Dietrich.",
      "Round over, {score} on the board. Fetch yourself a glass of something. Not for long.",
      "Lovely round. {score} so far. The next one's harder, because life is."
    ],
    roundEndRough: [
      "Round over. {score}. We'll call that a warm-up and never mention it at parties.",
      "That's the round. {score}. The explanations are there for a reason, darling. Several reasons.",
      "A rough one. {score} total. Powder your nose, straighten your spine, next round."
    ],
    finalGreat: [
      "Final score: {score}. Magnificent. Go and be insufferable about it. I would.",
      "{score}, darling. You could host this show. You won't, because it's mine, but you could."
    ],
    finalOk: [
      "Final score: {score}. Perfectly respectable. Which is the nicest thing I say about anyone.",
      "{score}. Middle of the road. The road is fine. I prefer the stage, but the road is fine."
    ],
    finalRough: [
      "Final score: {score}. The good news is you now know exactly what you don't know. That's rarer than it sounds.",
      "{score}. Oh, sweetheart. Play again. I'll pretend this one didn't happen. I'm very good at pretending."
    ]
  };

  const lastUsed = {};
  let voiceOn = false;
  let preferredVoice = null;

  try { voiceOn = localStorage.getItem(VOICE_KEY) === '1'; } catch (e) { /* ignore */ }

  function pick(key, vars) {
    const pool = LINES[key] || [''];
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === lastUsed[key]) i = (i + 1) % pool.length;
    lastUsed[key] = i;
    return pool[i].replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
  }

  // ----- Voice -----
  function voiceSupported() { return 'speechSynthesis' in global && 'SpeechSynthesisUtterance' in global; }

  function chooseVoice() {
    if (!voiceSupported()) return null;
    const voices = global.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const en = voices.filter((v) => /^en/i.test(v.lang));
    // Prefer a British/female-leaning voice for the character; fall back to anything English.
    const wanted = ['Google UK English Female', 'Kate', 'Serena', 'Microsoft Libby', 'Microsoft Sonia', 'Moira', 'Karen', 'Samantha', 'Google US English'];
    for (const w of wanted) { const v = en.find((x) => x.name.includes(w)); if (v) return v; }
    return en[0] || voices[0];
  }

  if (voiceSupported()) {
    global.speechSynthesis.onvoiceschanged = () => { preferredVoice = chooseVoice(); };
    preferredVoice = chooseVoice();
  }

  /** Speak text; returns a Promise that resolves when speech ends (or immediately if voice is off). */
  function speak(text) {
    if (!voiceOn || !voiceSupported() || !text) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        global.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (!preferredVoice) preferredVoice = chooseVoice();
        if (preferredVoice) u.voice = preferredVoice;
        u.rate = 1.02; u.pitch = 1.05; u.volume = 1;
        u.onend = resolve; u.onerror = resolve;
        global.speechSynthesis.speak(u);
        setTimeout(resolve, 9000); // safety net if the browser never fires onend
      } catch (e) { resolve(); }
    });
  }

  function setVoice(on) {
    voiceOn = !!on;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!voiceOn && voiceSupported()) global.speechSynthesis.cancel();
  }

  global.Host = {
    name: 'Vivian Vex',
    line: pick,
    speak,
    /** Pick a line and speak it. Returns { text, done } where done resolves when speech finishes. */
    say(key, vars) { const text = pick(key, vars); return { text, done: speak(text) }; },
    hush() { if (voiceSupported()) global.speechSynthesis.cancel(); },
    voiceSupported,
    isVoiceOn() { return voiceOn; },
    setVoice,
    toggleVoice() { setVoice(!voiceOn); return voiceOn; }
  };
})(window);
