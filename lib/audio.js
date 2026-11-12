// Procedural ambient soundscapes built with the Web Audio API.
// No audio files: everything is synthesized live.
//
// Tuned for studying: warm and low, no bright hiss, no sudden sounds.
// Everything moves slowly, and the rare "events" (a bird, a chime,
// a train far away) fade in and out instead of starting sharply.

export const CHANNELS = [
  { id: 'rain', label: 'Rain', hint: 'Steady, soft rain' },
  { id: 'waves', label: 'Ocean', hint: 'Slow waves on the shore' },
  { id: 'forest', label: 'Forest', hint: 'Wind in the trees, a bird now and then' },
  { id: 'city', label: 'Distant city', hint: 'Low hum, a train every few minutes' },
  { id: 'chimes', label: 'Soft chimes', hint: 'A gentle note now and then' },
  { id: 'pad', label: 'Calm pad', hint: 'Slow, warm chords' },
];

function makeNoiseBuffer(ctx, kind, seconds = 8) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'pink') {
        // Paul Kellet's pink noise filter
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    // Crossfade the loop point so there's no click when the buffer repeats
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[length - fade + i] * (1 - t);
    }
  }
  return buffer;
}

const rand = (a, b) => a + Math.random() * (b - a);

// D major pentatonic, so chimes always sit nicely over the pad
const CHIME_NOTES = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];

// Gentle, unresolved chords in D: Dadd9, Bm7, Gmaj7, A6sus
const PAD_CHORDS = [
  [146.83, 220.0, 329.63, 369.99],
  [123.47, 185.0, 220.0, 293.66],
  [98.0, 146.83, 185.0, 246.94],
  [110.0, 164.81, 220.0, 277.18],
];

export class AmbientEngine {
  constructor() {
    this.ctx = null;
    this.channels = {};
    this.timers = [];
    this.volumes = {};
  }

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    // Master chain: soften the top end, then bring the level up to a
    // comfortable volume with a gentle limiter so nothing ever jumps out.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 5000;
    warm.Q.value = 0.5;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 2500;
    shelf.gain.value = -5;
    const makeup = ctx.createGain();
    makeup.gain.value = 2.4;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.05;
    limiter.release.value = 0.6;
    this.master.connect(warm).connect(shelf).connect(makeup).connect(limiter).connect(ctx.destination);

    this.noise = { pink: makeNoiseBuffer(ctx, 'pink'), brown: makeNoiseBuffer(ctx, 'brown') };

    // Long, dark reverb that makes the chimes and birds feel far away
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(4.5);
    const reverbTone = ctx.createBiquadFilter();
    reverbTone.type = 'lowpass';
    reverbTone.frequency.value = 2600;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.7;
    this.reverb.connect(reverbTone).connect(reverbOut).connect(this.master);

    for (const { id } of CHANNELS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.channels[id] = g;
    }

    this.buildRain();
    this.buildWaves();
    this.buildForest();
    this.buildCity();
    this.buildChimes();
    this.buildPad();
  }

  makeImpulse(seconds) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        // Low-passed noise with a slow decay: a soft, dark tail
        lp += 0.25 * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - i / len, 3);
      }
    }
    return buf;
  }

  loop(bufferName) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise[bufferName];
    src.loop = true;
    src.start(0, Math.random() * 6);
    return src;
  }

  filter(type, frequency, Q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  }

  gain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  /** A very slow sine wobble on an AudioParam. */
  lfo(param, rate, depth) {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.gain(depth);
    o.connect(g).connect(param);
    o.start();
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (this.ctx) fn();
    }, ms);
    this.timers.push(id);
  }

  active(id) {
    return (this.volumes[id] ?? 0) > 0.001;
  }

  // --- Rain: a soft, steady shower. Mostly low-mid "body", a little texture, no hiss.
  buildRain() {
    const out = this.channels.rain;
    const body = this.gain(0.95);
    this.loop('pink').connect(this.filter('highpass', 120, 0.5)).connect(this.filter('lowpass', 1100, 0.4)).connect(body).connect(out);
    this.lfo(body.gain, 0.03, 0.08);

    const texture = this.gain(0.12);
    this.loop('pink').connect(this.filter('bandpass', 2000, 0.5)).connect(texture).connect(out);
    this.lfo(texture.gain, 0.045, 0.03);
  }

  // --- Ocean: slow, smooth swells about every 10-15 seconds.
  buildWaves() {
    const { ctx } = this;
    const lp = this.filter('lowpass', 380, 0.4);
    const g = this.gain(0.3);
    this.loop('brown').connect(lp).connect(g).connect(this.channels.waves);

    const washF = this.filter('bandpass', 850, 0.5);
    const wash = this.gain(0);
    this.loop('pink').connect(washF).connect(wash).connect(this.channels.waves);

    const wave = () => {
      const t = ctx.currentTime;
      const rise = rand(4, 6);
      const fall = rand(6, 9);
      const peak = rand(0.6, 0.85);
      // setTargetAtTime gives smooth, curved swells instead of straight ramps
      g.gain.setTargetAtTime(peak, t, rise / 3);
      g.gain.setTargetAtTime(0.28, t + rise, fall / 3);
      lp.frequency.setTargetAtTime(rand(650, 850), t, rise / 3);
      lp.frequency.setTargetAtTime(360, t + rise, fall / 3);
      wash.gain.setTargetAtTime(0.06 * peak, t + rise * 0.6, rise / 3);
      wash.gain.setTargetAtTime(0, t + rise + 0.5, fall / 4);
      this.later(wave, (rise + fall + rand(0, 2)) * 1000);
    };
    wave();
  }

  // --- Forest: wind rising and falling through the trees, with a rare, far-off bird.
  buildForest() {
    const { ctx } = this;
    const windF = this.filter('bandpass', 420, 0.6);
    const wind = this.gain(0.45);
    this.loop('pink').connect(windF).connect(wind).connect(this.channels.forest);

    const leavesF = this.filter('bandpass', 1300, 0.5);
    const leaves = this.gain(0.03);
    this.loop('pink').connect(leavesF).connect(leaves).connect(this.channels.forest);

    const gust = () => {
      const t = ctx.currentTime;
      const d = rand(8, 16);
      const strength = rand(0.3, 0.65);
      windF.frequency.setTargetAtTime(rand(300, 600), t, d / 2.5);
      wind.gain.setTargetAtTime(strength, t, d / 2.5);
      leaves.gain.setTargetAtTime(strength * 0.08, t, d / 2.5);
      this.later(gust, d * 1000);
    };
    gust();

    const bird = () => {
      if (this.active('forest')) this.bird();
      this.later(bird, rand(18_000, 45_000));
    };
    this.later(bird, rand(6000, 15_000));
  }

  bird() {
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.7, 0.7);
    const dry = this.gain(0.012);
    const wet = this.gain(0.03);
    dry.connect(pan).connect(this.channels.forest);
    wet.connect(this.reverb);
    const base = rand(1700, 2400);
    const notes = Math.random() < 0.5 ? 2 : 3;
    let t = ctx.currentTime + 0.1;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const dur = rand(0.18, 0.3);
      const f = base * rand(0.95, 1.08);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * rand(1.05, 1.15), t + dur);
      const env = this.gain(0);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.05); // soft start, no "tick"
      env.gain.setTargetAtTime(0, t + dur * 0.6, dur / 3);
      osc.connect(env);
      env.connect(dry);
      env.connect(wet);
      osc.start(t);
      osc.stop(t + dur + 1);
      t += dur + rand(0.15, 0.35);
    }
  }

  // --- Distant city: a low, steady hum and a train passing far away every few minutes.
  buildCity() {
    const hum = this.gain(0.5);
    this.loop('brown').connect(this.filter('lowpass', 200, 0.4)).connect(hum).connect(this.channels.city);
    this.lfo(hum.gain, 0.02, 0.06);

    const train = () => {
      if (this.active('city')) this.train();
      this.later(train, rand(120_000, 240_000));
    };
    this.later(train, rand(20_000, 40_000));
  }

  train() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const dur = 18;
    const src = this.loop('pink');
    const lp = this.filter('lowpass', 300, 0.5);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(620, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(280, t + dur);
    const env = this.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + dur * 0.5);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner();
    const dir = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.6 * dir, t);
    pan.pan.linearRampToValueAtTime(0.6 * dir, t + dur);
    src.connect(lp).connect(env).connect(pan).connect(this.channels.city);
    src.stop(t + dur + 0.1);
  }

  // --- Chimes: a single soft note (sometimes two) every 25-60 seconds.
  buildChimes() {
    const tick = () => {
      if (this.active('chimes')) {
        this.chime();
        if (Math.random() < 0.35) this.later(() => this.chime(), rand(1500, 3000));
      }
      this.later(tick, rand(25_000, 60_000));
    };
    this.later(tick, rand(3000, 8000));
  }

  chime() {
    const { ctx } = this;
    const t = ctx.currentTime + 0.05;
    const f = CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)];
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.5, 0.5);
    const out = this.gain(1);
    const dry = this.gain(0.035);
    const wet = this.gain(0.07);
    out.connect(dry).connect(pan).connect(this.channels.chimes);
    out.connect(wet).connect(this.reverb);
    // A pure tone with a quiet octave above: round and soft, not metallic
    for (const [ratio, amp, decay] of [[1, 1, 5], [2, 0.12, 2.5]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      const env = this.gain(0);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.04);
      env.gain.setTargetAtTime(0, t + 0.06, decay / 4);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + decay + 0.5);
    }
  }

  // --- Pad: warm sine chords that crossfade slowly, about every 15 seconds.
  buildPad() {
    const lp = this.filter('lowpass', 850, 0.3);
    const padOut = this.gain(0.32);
    lp.connect(padOut).connect(this.channels.pad);
    padOut.connect(this.reverb);
    this.padBus = lp;
    this.chordIndex = 0;
    this.nextChord();
  }

  nextChord() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const hold = 15;
    const fadeIn = 5;
    const fadeOut = 7;
    const chord = PAD_CHORDS[this.chordIndex % PAD_CHORDS.length];
    this.chordIndex += 1;
    chord.forEach((f, i) => {
      const level = i === 0 ? 0.32 : 0.2;
      for (const [mult, detune, amp] of [[1, -4, 1], [1, 4, 1], [2, 0, 0.18]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * mult;
        osc.detune.value = detune;
        const env = this.gain(0);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(level * amp * 0.5, t + fadeIn);
        env.gain.setValueAtTime(level * amp * 0.5, t + hold);
        env.gain.linearRampToValueAtTime(0, t + hold + fadeOut);
        osc.connect(env).connect(this.padBus);
        osc.start(t);
        osc.stop(t + hold + fadeOut + 0.1);
      }
    });
    // Start the next chord while this one is still fading out
    this.later(() => this.nextChord(), hold * 1000);
  }

  apply({ master = 0.7, volumes = {} } = {}) {
    if (!this.ctx) this.start();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.volumes = { ...volumes };
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, master)), t, 0.6);
    for (const { id } of CHANNELS) {
      const v = Math.max(0, Math.min(1, volumes[id] ?? 0));
      // Gentle curve: still fine control at the low end, but 50% is clearly audible
      this.channels[id].gain.setTargetAtTime(Math.pow(v, 1.4), t, 0.6);
    }
  }

  /** 'running' means the browser is actually letting us make sound. */
  status() {
    return { state: this.ctx?.state ?? 'none', time: this.ctx?.currentTime ?? 0 };
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}

/** Mix used for your own photos. */
export const PHOTO_MIX = { rain: 0.55, waves: 0, forest: 0.25, city: 0, chimes: 0, pad: 0.3 };

export const mixFor = (sceneId) => ({ ...(SCENE_MIXES[sceneId] ?? PHOTO_MIX) });

/** Default mixes for each place. */
export const SCENE_MIXES = {
  seawall: { rain: 0.45, waves: 0.55, forest: 0.15, city: 0, chimes: 0, pad: 0.25 },
  sfu: { rain: 0.55, waves: 0, forest: 0.5, city: 0, chimes: 0, pad: 0.3 },
  metrotown: { rain: 0.5, waves: 0, forest: 0, city: 0.5, chimes: 0, pad: 0.25 },
  deerlake: { rain: 0.25, waves: 0, forest: 0.55, city: 0, chimes: 0.3, pad: 0.3 },
  englishbay: { rain: 0, waves: 0.65, forest: 0, city: 0.1, chimes: 0, pad: 0.35 },
  gastown: { rain: 0.55, waves: 0, forest: 0, city: 0.3, chimes: 0.35, pad: 0.2 },
  grouse: { rain: 0, waves: 0, forest: 0.5, city: 0, chimes: 0.25, pad: 0.35 },
};
