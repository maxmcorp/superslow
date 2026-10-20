// Spoken countdown and callouts, played with Web Audio so they land on time.
//
// Sounds are `sounds/<n>.wav`, listed in `sounds/index.json`. A number without a
// file plays a beep instead, so the timer works before the recordings exist.

// Callouts are queued this far ahead of when they should sound.
const LOOKAHEAD = 0.3;
const TICK_MS = 100;
// A callout this late (the app was in the background, say) is skipped, not played late.
const TOO_LATE = 0.25;
// Speech starts at the first sample this loud, so silence at the start of a file doesn't delay it.
const SPEECH_THRESHOLD = 0.02;

function speechStart(buffer) {
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > SPEECH_THRESHOLD) return Math.max(0, i / buffer.sampleRate - 0.01);
  }
  return 0;
}

// A short sine tone, as an AudioBuffer: one or more `beeps` separated by gaps.
function tone(ctx, { hz, seconds, beeps = 1 }) {
  const gap = 0.08;
  const total = beeps * seconds + (beeps - 1) * gap;
  const buffer = ctx.createBuffer(1, Math.ceil(total * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = 0.01 * ctx.sampleRate;
  for (let b = 0; b < beeps; b++) {
    const start = Math.round(b * (seconds + gap) * ctx.sampleRate);
    const length = Math.round(seconds * ctx.sampleRate);
    for (let i = 0; i < length; i++) {
      const envelope = Math.min(1, i / fade, (length - i) / fade);
      data[start + i] = 0.5 * envelope * Math.sin((2 * Math.PI * hz * i) / ctx.sampleRate);
    }
  }
  return buffer;
}

export function createVoice(base = 'sounds/') {
  // Web Audio mixes with other apps' audio (your music) in the "ambient" session.
  if ('audioSession' in navigator) navigator.audioSession.type = 'ambient';

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextClass();
  const sounds = new Map();
  const beeps = {
    countdown: tone(ctx, { hz: 880, seconds: 0.12 }),
    zero: tone(ctx, { hz: 1320, seconds: 0.45 }),
    callout: tone(ctx, { hz: 660, seconds: 0.12, beeps: 2 }),
  };

  let playing = new Set();
  let timer = null;

  async function loadOne(n) {
    const response = await fetch(`${base}${n}.wav`);
    if (!response.ok) throw new Error(`${n}.wav: ${response.status}`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    sounds.set(n, { buffer, offset: speechStart(buffer) });
  }

  function soundFor(n, inCountdown) {
    const recorded = sounds.get(n);
    if (recorded) return recorded;
    if (inCountdown) return { buffer: n === 0 ? beeps.zero : beeps.countdown, offset: 0 };
    return { buffer: beeps.callout, offset: 0 };
  }

  function play({ buffer, offset }, when) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playing.delete(source);
    playing.add(source);
    source.start(when, offset);
  }

  return {
    // Loads every recorded number. Resolves to the numbers that loaded.
    async load() {
      let listed = [];
      try {
        const response = await fetch(`${base}index.json`);
        if (response.ok) listed = await response.json();
      } catch {
        // No list means no recordings: every number beeps.
      }
      const results = await Promise.allSettled(listed.map(loadOne));
      results.forEach((r) => r.status === 'rejected' && console.warn('Sound not loaded:', r.reason));
      return [...sounds.keys()].sort((a, b) => a - b);
    },

    // iOS only lets audio start from a tap, so call this inside the Start tap handler.
    unlock() {
      if (ctx.state !== 'running') ctx.resume();
      const silence = ctx.createBufferSource();
      silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silence.connect(ctx.destination);
      silence.start(0);
    },

    // After an interruption (a call, Siri) the audio may need restarting.
    resume() {
      if (ctx.state !== 'running') ctx.resume();
    },

    // Plays `events` ({ at, n }, `at` in seconds relative to `zeroAt`) against the
    // performance.now() clock, queueing each one shortly before it is due.
    start(events, zeroAt) {
      this.stop();
      let next = 0;
      const tick = () => {
        const elapsed = (performance.now() - zeroAt) / 1000;
        while (next < events.length && events[next].at <= elapsed + LOOKAHEAD) {
          const { at, n } = events[next++];
          if (at < elapsed - TOO_LATE) continue;
          play(soundFor(n, at <= 0), ctx.currentTime + Math.max(0, at - elapsed));
        }
        if (next >= events.length) this.stopTicking();
      };
      tick();
      timer = setInterval(tick, TICK_MS);
    },

    stopTicking() {
      clearInterval(timer);
      timer = null;
    },

    // Stops the schedule and silences anything queued or playing.
    stop() {
      this.stopTicking();
      for (const source of playing) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      playing = new Set();
    },
  };
}
