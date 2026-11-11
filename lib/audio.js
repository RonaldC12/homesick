// Procedural ambient soundscapes built with the Web Audio API.
// No audio files: rain, waves, forest, city, chimes, and a soft pad are all synthesized.

export const CHANNELS = [
  { id: 'rain', label: 'Rain', hint: 'Classic Vancouver drizzle' },
  { id: 'waves', label: 'Ocean', hint: 'Seawall and English Bay' },
  { id: 'forest', label: 'Forest', hint: 'Wind in the cedars, a few birds' },
  { id: 'city', label: 'City & SkyTrain', hint: 'Low hum, trains passing now and then' },
  { id: 'chimes', label: 'Steam clock', hint: 'A Westminster chime every few minutes' },
  { id: 'pad', label: 'Calm pad', hint: 'Slow, soft chords' },
];

function makeNoiseBuffer(ctx, kind, seconds = 6) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'white') {
        data[i] = white * 0.5;
      } else if (kind === 'pink') {
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
  }
  return buffer;
}

const rand = (a, b) => a + Math.random() * (b - a);

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
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = {
      white: makeNoiseBuffer(ctx, 'white'),
      pink: makeNoiseBuffer(ctx, 'pink'),
      brown: makeNoiseBuffer(ctx, 'brown'),
    };

    // Simple reverb for bells and birds
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.5;
    this.reverb.connect(reverbOut).connect(this.master);

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
    this.buildPad();
    this.scheduleChimes();
  }

  makeImpulse(seconds) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return buf;
  }

  loop(bufferName) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise[bufferName];
    src.loop = true;
    src.loopStart = 0;
    src.start(0, Math.random() * 4);
    return src;
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

  // --- Rain: a bed of filtered pink noise plus a brighter patter layer.
  buildRain() {
    const { ctx } = this;
    const out = this.channels.rain;

    const bed = this.loop('pink');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.9;
    bed.connect(lp).connect(bedGain).connect(out);

    const patter = this.loop('white');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.6;
    const patterGain = ctx.createGain();
    patterGain.gain.value = 0.18;
    patter.connect(bp).connect(patterGain).connect(out);

    // Slow swell so it doesn't feel static
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain).connect(bedGain.gain);
    lfo.start();
  }

  // --- Ocean: brown noise whose volume and brightness rise and fall like waves.
  buildWaves() {
    const { ctx } = this;
    const src = this.loop('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.2;
    src.connect(lp).connect(g).connect(this.channels.waves);

    const hiss = this.loop('pink');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hiss.connect(hp).connect(hissGain).connect(this.channels.waves);

    const wave = () => {
      const t = ctx.currentTime;
      const rise = rand(2.5, 4);
      const fall = rand(3.5, 6);
      const peak = rand(0.7, 1.1);
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(peak, t + rise);
      g.gain.linearRampToValueAtTime(0.18, t + rise + fall);
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setValueAtTime(lp.frequency.value, t);
      lp.frequency.linearRampToValueAtTime(rand(900, 1400), t + rise);
      lp.frequency.linearRampToValueAtTime(420, t + rise + fall);
      hissGain.gain.cancelScheduledValues(t);
      hissGain.gain.setValueAtTime(0, t);
      hissGain.gain.linearRampToValueAtTime(0.12 * peak, t + rise + 0.4);
      hissGain.gain.linearRampToValueAtTime(0, t + rise + fall * 0.8);
      this.later(wave, (rise + fall + rand(0, 1.5)) * 1000);
    };
    wave();
  }

  // --- Forest: shifting wind plus the odd bird.
  buildForest() {
    const { ctx } = this;
    const src = this.loop('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    src.connect(bp).connect(g).connect(this.channels.forest);

    const gust = () => {
      const t = ctx.currentTime;
      const d = rand(4, 9);
      bp.frequency.setTargetAtTime(rand(300, 900), t, d / 3);
      g.gain.setTargetAtTime(rand(0.35, 0.9), t, d / 3);
      this.later(gust, d * 1000);
    };
    gust();

    const bird = () => {
      if (this.active('forest')) this.chirp();
      this.later(bird, rand(2500, 9000));
    };
    this.later(bird, 2000);
  }

  chirp() {
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    const out = ctx.createGain();
    out.gain.value = 0.06;
    out.connect(pan);
    pan.connect(this.channels.forest);
    pan.connect(this.reverb);
    const notes = Math.floor(rand(2, 5));
    const base = rand(2600, 4200);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      const dur = rand(0.06, 0.14);
      osc.frequency.setValueAtTime(base * rand(0.9, 1.1), t);
      osc.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.6), t + dur);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      t += dur + rand(0.04, 0.12);
    }
  }

  // --- City: distant traffic hum, with a SkyTrain gliding past every minute or two.
  buildCity() {
    const { ctx } = this;
    const src = this.loop('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(this.channels.city);

    const train = () => {
      if (this.active('city')) this.skytrain();
      this.later(train, rand(50_000, 110_000));
    };
    this.later(train, 8000);
  }

  skytrain() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const dur = 11;
    const src = this.loop('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.linearRampToValueAtTime(900, t + dur * 0.45);
    bp.frequency.linearRampToValueAtTime(260, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + dur * 0.45);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner();
    const dir = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.9 * dir, t);
    pan.pan.linearRampToValueAtTime(0.9 * dir, t + dur);

    // Electric motor whine, the sound you hear from the platform
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(320, t);
    whine.frequency.linearRampToValueAtTime(560, t + dur * 0.45);
    whine.frequency.linearRampToValueAtTime(300, t + dur);
    const whineLp = ctx.createBiquadFilter();
    whineLp.type = 'lowpass';
    whineLp.frequency.value = 900;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.025;

    src.connect(bp).connect(env);
    whine.connect(whineLp).connect(whineGain).connect(env);
    env.connect(pan).connect(this.channels.city);
    whine.start(t);
    whine.stop(t + dur);
    src.stop(t + dur);
  }

  // --- Chimes: the Westminster quarters, like the Gastown steam clock.
  scheduleChimes() {
    const tick = () => {
      if (this.active('chimes')) this.westminster();
      this.later(tick, rand(150_000, 240_000));
    };
    this.later(tick, 4000);
  }

  bell(freq, when, gain = 0.18) {
    const { ctx } = this;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.channels.chimes);
    out.connect(this.reverb);
    const partials = [
      [1, 1, 3.2],
      [2.0, 0.5, 2.2],
      [2.76, 0.35, 1.6],
      [5.4, 0.15, 0.9],
    ];
    for (const [ratio, amp, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(amp, when + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(env).connect(out);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  westminster() {
    // E4 G#4 F#4 B3 | E4 F#4 G#4 E4 | G#4 E4 F#4 B3 | B3 F#4 G#4 E4
    const E4 = 329.63, Gs4 = 415.3, Fs4 = 369.99, B3 = 246.94;
    const phrases = [
      [Gs4, Fs4, E4, B3],
      [E4, Gs4, Fs4, B3],
      [E4, Fs4, Gs4, E4],
      [Gs4, E4, Fs4, B3],
      [B3, Fs4, Gs4, E4],
    ];
    const count = Math.random() < 0.5 ? 1 : 2;
    let t = this.ctx.currentTime + 0.1;
    for (let p = 0; p < count; p++) {
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      phrase.forEach((f, i) => this.bell(f, t + i * 0.9, i === 3 ? 0.2 : 0.16));
      t += 4.6;
    }
  }

  // --- Pad: slow chords in a warm, low register.
  buildPad() {
    const { ctx } = this;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.3;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.12;
    lp.connect(padGain).connect(this.channels.pad);
    padGain.connect(this.reverb);

    const voices = [];
    for (let i = 0; i < 4; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(lp);
      const oscs = [-6, 6].map((detune) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.detune.value = detune;
        o.connect(g);
        o.start();
        return o;
      });
      voices.push({ g, oscs });
    }

    // Dmaj7, Bm7, Gmaj7, Aadd9 (gentle, unresolved, rainy-day)
    const chords = [
      [146.83, 220.0, 277.18, 369.99],
      [123.47, 185.0, 220.0, 293.66],
      [98.0, 146.83, 246.94, 293.66],
      [110.0, 164.81, 246.94, 277.18],
    ];
    let idx = 0;
    const next = () => {
      const t = ctx.currentTime;
      const chord = chords[idx % chords.length];
      idx += 1;
      voices.forEach((v, i) => {
        v.oscs.forEach((o) => o.frequency.setTargetAtTime(chord[i], t, 1.2));
        v.g.gain.setTargetAtTime(i === 0 ? 0.5 : 0.3, t, 1.5);
      });
      this.later(next, 9000);
    };
    next();
  }

  apply({ master = 0.7, volumes = {} } = {}) {
    if (!this.ctx) this.start();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.volumes = { ...volumes };
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, master)), t, 0.4);
    for (const { id } of CHANNELS) {
      const v = Math.max(0, Math.min(1, volumes[id] ?? 0));
      // Square for a more natural-feeling slider
      this.channels[id].gain.setTargetAtTime(v * v, t, 0.4);
    }
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}

/** Default mixes for each place. */
export const SCENE_MIXES = {
  seawall: { rain: 0.45, waves: 0.6, forest: 0.2, city: 0, chimes: 0, pad: 0.2 },
  sfu: { rain: 0.55, waves: 0, forest: 0.55, city: 0, chimes: 0, pad: 0.25 },
  metrotown: { rain: 0.5, waves: 0, forest: 0, city: 0.55, chimes: 0, pad: 0.2 },
  deerlake: { rain: 0.25, waves: 0, forest: 0.6, city: 0, chimes: 0, pad: 0.3 },
  englishbay: { rain: 0, waves: 0.7, forest: 0, city: 0.1, chimes: 0, pad: 0.3 },
  gastown: { rain: 0.55, waves: 0, forest: 0, city: 0.3, chimes: 0.5, pad: 0.15 },
  grouse: { rain: 0, waves: 0, forest: 0.5, city: 0, chimes: 0, pad: 0.35 },
};
