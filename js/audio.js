/* Synthesized buzzer-style sound effects via the Web Audio API.
   No audio files needed, works offline. Exposed as window.GameAudio. */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'knowjack.muted';
  let ctx = null;
  let muted = false;

  try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* storage unavailable */ }

  function ensureContext() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** Play one tone. type: oscillator type; freq → endFreq glide over dur seconds. */
  function tone({ freq = 440, endFreq = null, dur = 0.15, type = 'square', gain = 0.18, delay = 0 }) {
    const c = ensureContext();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const sounds = {
    click()   { tone({ freq: 700, dur: 0.05, type: 'triangle', gain: 0.1 }); },
    tick()    { tone({ freq: 1100, dur: 0.03, type: 'sine', gain: 0.06 }); },
    buzzIn()  { tone({ freq: 220, endFreq: 880, dur: 0.12, type: 'sawtooth', gain: 0.12 }); },
    correct() {
      tone({ freq: 523, dur: 0.12, type: 'square', gain: 0.14 });
      tone({ freq: 659, dur: 0.12, type: 'square', gain: 0.14, delay: 0.1 });
      tone({ freq: 784, dur: 0.22, type: 'square', gain: 0.14, delay: 0.2 });
    },
    wrong() {
      // Classic game-show buzzer: low, harsh, slightly falling.
      tone({ freq: 160, endFreq: 110, dur: 0.45, type: 'sawtooth', gain: 0.2 });
      tone({ freq: 164, endFreq: 112, dur: 0.45, type: 'square', gain: 0.1 });
    },
    timeout() {
      tone({ freq: 400, endFreq: 120, dur: 0.6, type: 'sawtooth', gain: 0.18 });
    },
    whoosh() {
      // Curtain: filtered noise sweep approximated with a fast sawtooth slide.
      tone({ freq: 90, endFreq: 400, dur: 0.5, type: 'sawtooth', gain: 0.05 });
      tone({ freq: 500, endFreq: 120, dur: 0.5, type: 'triangle', gain: 0.05, delay: 0.3 });
    },
    poof() {
      tone({ freq: 700, endFreq: 90, dur: 0.35, type: 'sawtooth', gain: 0.12 });
      tone({ freq: 1800, endFreq: 300, dur: 0.25, type: 'square', gain: 0.05 });
    },
    loaded() {
      tone({ freq: 196, dur: 0.14, type: 'square', gain: 0.14 });
      tone({ freq: 196, dur: 0.14, type: 'square', gain: 0.14, delay: 0.16 });
      tone({ freq: 294, dur: 0.4, type: 'square', gain: 0.16, delay: 0.32 });
    },
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'square', gain: 0.14, delay: i * 0.12 }));
      tone({ freq: 1046, dur: 0.5, type: 'triangle', gain: 0.16, delay: 0.5 });
    }
  };

  function setMuted(value) {
    muted = !!value;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  global.GameAudio = {
    play(name) { if (sounds[name]) sounds[name](); },
    unlock() { ensureContext(); },     // call on first user gesture (iOS requires it)
    isMuted() { return muted; },
    setMuted,
    toggle() { setMuted(!muted); return muted; }
  };
})(window);
