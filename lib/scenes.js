// Animated, procedurally drawn wallpapers of places around Vancouver and Burnaby.
// Each scene draws static "back" and "front" layers once, then animates water,
// trains, steam, fog, and weather on top every frame.

export const SCENES = [
  {
    id: 'seawall',
    name: 'Stanley Park Seawall',
    area: 'Vancouver',
    blurb: 'The North Shore mountains across the water and Lions Gate Bridge in the mist.',
  },
  {
    id: 'sfu',
    name: 'Burnaby Mountain',
    area: 'Burnaby · SFU',
    blurb: 'Fog rolling through the cedars, the city glowing far below.',
  },
  {
    id: 'metrotown',
    name: 'Metrotown SkyTrain',
    area: 'Burnaby',
    blurb: 'Expo Line trains gliding past the towers on a wet evening.',
  },
  {
    id: 'deerlake',
    name: 'Deer Lake',
    area: 'Burnaby',
    blurb: 'Still water, reeds, ducks, and the Metrotown towers on the horizon.',
  },
  {
    id: 'englishbay',
    name: 'English Bay',
    area: 'Vancouver · West End',
    blurb: 'Freighters at anchor, driftwood logs, and the inukshuk at sundown.',
  },
  {
    id: 'gastown',
    name: 'Gastown',
    area: 'Vancouver',
    blurb: 'Cobblestones, warm windows, and the steam clock letting off steam.',
  },
  {
    id: 'grouse',
    name: 'Grouse Mountain',
    area: 'North Vancouver',
    blurb: 'The gondola gliding over snowy firs, the whole city spread out below.',
  },
];

// ---------------------------------------------------------------------------
// Time of day and palettes
// ---------------------------------------------------------------------------

export function vancouverHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export function todFromHour(h) {
  if (h >= 7.5 && h < 16.5) return 'day';
  if ((h >= 16.5 && h < 18.5) || (h >= 6 && h < 7.5)) return 'dusk';
  return 'night';
}

const PALETTES = {
  day: {
    skyTop: '#8ea5b7', skyBot: '#dbe2e5', far: '#8a9dab', mid: '#61798a', near: '#2e3f4a',
    water: '#6e8796', waterDeep: '#4b6371', waterHi: 'rgba(255,255,255,0.22)', light: 0,
  },
  dusk: {
    skyTop: '#2f3b5e', skyBot: '#e39878', far: '#5d6080', mid: '#3e425c', near: '#1d2030',
    water: '#4c5373', waterDeep: '#2a2f47', waterHi: 'rgba(255,190,150,0.28)', light: 0.75,
  },
  night: {
    skyTop: '#070d1b', skyBot: '#1d2c47', far: '#18253c', mid: '#111b2e', near: '#080e1a',
    water: '#0f1a2d', waterDeep: '#070d18', waterHi: 'rgba(170,200,255,0.14)', light: 1,
  },
};

// Pixel art reads best a bit brighter and bluer, like a moonlit game scene.
const PIXEL_NIGHT = {
  skyTop: '#16244a', skyBot: '#3f5c8e', far: '#30497a', mid: '#233a63', near: '#13223f',
  water: '#2c4675', waterDeep: '#172a4c', waterHi: 'rgba(190,215,255,0.35)', light: 1,
};

function paletteFor(tod, weather, pixel = false) {
  const p = { ...(pixel && tod === 'night' ? PIXEL_NIGHT : PALETTES[tod]) };
  if (weather !== 'clear' && tod === 'day') {
    p.skyTop = '#7b8a96';
    p.skyBot = '#b8c1c6';
    p.far = '#8d9aa4';
  }
  return p;
}

// ---------------------------------------------------------------------------
// Small drawing toolkit
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function mixHex(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function noise1D(seed) {
  const r = rng(seed);
  const pts = Array.from({ length: 512 }, () => r());
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    const a = pts[((i % 512) + 512) % 512];
    const b = pts[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * t;
  };
}

function fbm(n, x, oct) {
  let v = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += n(x * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return v / norm;
}

function ridgeFn(seed, { base, amp, scale, oct = 5, bumps = [] }) {
  const n = noise1D(seed);
  return (x) => {
    let y = base - fbm(n, x / scale, oct) * amp;
    for (const b of bumps) y -= b.h * Math.exp(-((x - b.x) ** 2) / (2 * b.s * b.s));
    return y;
  };
}

function fillRidge(g, W, H, fn, fill, bottom = H) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(-2, bottom);
  for (let x = -2; x <= W + 4; x += 2) g.lineTo(x, fn(x));
  g.lineTo(W + 4, bottom);
  g.closePath();
  g.fill();
}

function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

function sky(g, W, y1, P) {
  g.fillStyle = vgrad(g, 0, y1, [[0, P.skyTop], [1, P.skyBot]]);
  g.fillRect(0, 0, W, y1 + 2);
}

function stars(g, W, y1, R, count, minS = 1) {
  for (let i = 0; i < count; i++) {
    const x = R() * W;
    const y = R() ** 1.6 * y1;
    g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.6})`;
    const s = Math.max(minS, R() < 0.1 ? 1.6 : 1);
    g.fillRect(x, y, s, s);
  }
}

function conifer(g, x, y, h, color, snow = null, R = Math.random) {
  const w = h * 0.3;
  const tiers = 6 + Math.floor(h / 40);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - h);
  for (let i = 1; i <= tiers; i++) {
    const ty = y - h + h * 0.9 * (i / tiers);
    const tw = w * (i / tiers) * (0.85 + R() * 0.3);
    g.lineTo(x + tw, ty);
    if (i < tiers) g.lineTo(x + tw * 0.45, ty - h * 0.02);
  }
  g.lineTo(x + w * 0.08, y - h * 0.1);
  g.lineTo(x + w * 0.08, y);
  g.lineTo(x - w * 0.08, y);
  g.lineTo(x - w * 0.08, y - h * 0.1);
  for (let i = tiers; i >= 1; i--) {
    const ty = y - h + h * 0.9 * (i / tiers);
    const tw = w * (i / tiers) * (0.85 + R() * 0.3);
    if (i < tiers) g.lineTo(x - tw * 0.45, ty - h * 0.02);
    g.lineTo(x - tw, ty);
  }
  g.closePath();
  g.fill();
  if (snow) {
    g.fillStyle = snow;
    for (let i = 1; i <= tiers; i++) {
      const ty = y - h + h * 0.9 * (i / tiers);
      const tw = w * (i / tiers) * 0.8;
      g.beginPath();
      g.ellipse(x, ty - h * 0.03, tw, h * 0.018, 0, Math.PI, 0);
      g.fill();
    }
  }
}

function roundTree(g, x, y, r, color, R) {
  g.fillStyle = color;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(x + (R() - 0.5) * r * 1.2, y - r - R() * r * 0.8, r * (0.55 + R() * 0.4), 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(x - r * 0.08, y - r * 0.6, r * 0.16, r * 0.6);
}

function windowColor(P, R) {
  const warm = R() < 0.8;
  return warm ? `rgba(255,${190 + Math.floor(R() * 40)},${110 + Math.floor(R() * 50)},` : 'rgba(200,225,255,';
}

function glow(ctx, x, y, r, color, alpha) {
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace('ALPHA', String(alpha)));
  gr.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = gr;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function makeShimmer(R, W, y0, y1, count) {
  return Array.from({ length: count }, () => {
    const y = y0 + (R() ** 1.4) * (y1 - y0);
    const depth = (y - y0) / (y1 - y0);
    return {
      x: R() * W,
      y,
      len: 6 + depth * 40 * (0.5 + R()),
      phase: R() * Math.PI * 2,
      speed: 0.6 + R() * 1.4,
    };
  });
}

function drawShimmer(ctx, lines, t, color, W, lw = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  for (const l of lines) {
    const a = Math.sin(t * l.speed + l.phase) * 0.5 + 0.5;
    if (a < 0.25) continue;
    ctx.globalAlpha = a;
    const x = ((l.x + Math.sin(t * 0.25 + l.phase) * 12) % W + W) % W;
    ctx.beginPath();
    ctx.moveTo(x, l.y);
    ctx.lineTo(x + l.len, l.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function makeFog(R, W, y0, y1, count) {
  return Array.from({ length: count }, () => ({
    x: R() * W * 1.4 - W * 0.2,
    y: y0 + R() * (y1 - y0),
    rx: W * (0.18 + R() * 0.25),
    ry: (y1 - y0) * (0.25 + R() * 0.35),
    speed: 4 + R() * 10,
    a: 0.06 + R() * 0.1,
  }));
}

function drawFog(ctx, fog, t, W, color = '220,228,235') {
  for (const f of fog) {
    const span = W + f.rx * 2;
    const x = ((f.x + t * f.speed) % span + span) % span - f.rx;
    const gr = ctx.createRadialGradient(x, f.y, 0, x, f.y, f.rx);
    gr.addColorStop(0, `rgba(${color},${f.a})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    ctx.save();
    ctx.translate(x, f.y);
    ctx.scale(1, f.ry / f.rx);
    ctx.translate(-x, -f.y);
    ctx.fillStyle = gr;
    ctx.fillRect(x - f.rx, f.y - f.rx, f.rx * 2, f.rx * 2);
    ctx.restore();
  }
}

function makeCityLights(R, W, y0, y1, count) {
  return Array.from({ length: count }, () => {
    const y = y0 + (R() ** 0.8) * (y1 - y0);
    return {
      x: R() * W,
      y,
      s: 0.8 + ((y - y0) / (y1 - y0)) * 1.4 * R(),
      c: R() < 0.75 ? '255,214,150' : R() < 0.5 ? '255,255,255' : '160,200,255',
      tw: R() < 0.3 ? 1 + R() * 3 : 0,
      ph: R() * 6.28,
      a: 0.4 + R() * 0.6,
    };
  });
}

function drawCityLights(ctx, lights, t, level, minS = 0) {
  if (level <= 0) return;
  for (const l of lights) {
    const a = l.tw ? l.a * (0.55 + 0.45 * Math.sin(t * l.tw + l.ph)) : l.a;
    ctx.fillStyle = `rgba(${l.c},${a * level})`;
    const sz = Math.max(minS, l.s);
    ctx.fillRect(l.x, l.y, sz, sz);
  }
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const DEFS = {};

DEFS.seawall = ({ back: g, front: f, W, H, P, R, env }) => {
  const y0 = H * 0.6;
  const wallTop = H * 0.86;
  sky(g, W, y0, P);
  if (env.weather === 'clear' && P.light > 0.5) stars(g, W, y0 * 0.7, R, 160, env.lw);

  const far = ridgeFn(11, {
    base: H * 0.5, amp: H * 0.2, scale: W / 3.2,
    bumps: [
      { x: W * 0.71, h: H * 0.07, s: W * 0.012 },
      { x: W * 0.745, h: H * 0.065, s: W * 0.011 },
    ],
  });
  fillRidge(g, W, H, far, vgrad(g, H * 0.28, y0, [[0, mixHex(P.far, '#ffffff', 0.12)], [1, P.far]]));
  const mid = ridgeFn(23, { base: y0 + 2, amp: H * 0.08, scale: W / 6 });
  fillRidge(g, W, H, mid, P.mid);

  // North Shore house lights
  if (P.light > 0) {
    for (let i = 0; i < 260; i++) {
      const x = W * 0.35 + R() * W * 0.65;
      const top = mid(x);
      const y = top + R() * (y0 - top);
      g.fillStyle = `rgba(255,210,150,${(0.3 + R() * 0.6) * P.light})`;
      g.fillRect(x, y, 1.3, 1.3);
    }
  }

  // Water
  g.fillStyle = vgrad(g, y0, wallTop, [[0, P.water], [1, P.waterDeep]]);
  g.fillRect(0, y0, W, H - y0);

  // Lions Gate Bridge
  const deckY = H * 0.565;
  const x0 = W * 0.1, x1 = W * 0.62, tA = W * 0.25, tB = W * 0.47;
  const top = deckY - H * 0.12;
  const bridge = P.light > 0.5 ? '#1c2b2a' : mixHex(P.mid, '#2d4a40', 0.5);
  g.strokeStyle = bridge;
  g.fillStyle = bridge;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0, deckY);
  g.quadraticCurveTo(W * 0.4, deckY - H * 0.012, x1, deckY + 2);
  g.stroke();
  for (const tx of [tA, tB]) {
    g.fillRect(tx - 3, top, 2.5, deckY - top + H * 0.03);
    g.fillRect(tx + 1, top, 2.5, deckY - top + H * 0.03);
    g.fillRect(tx - 3, top + H * 0.02, 6.5, 2);
    g.fillRect(tx - 3, top + H * 0.06, 6.5, 2);
  }
  const low = deckY - H * 0.012;
  const ctrlY = 2 * low - top;
  const bez = (p0, c, p2, t) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t * t * p2;
  const cable = [];
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x0, deckY - 2);
  g.quadraticCurveTo(x0 + (tA - x0) * 0.6, deckY - H * 0.02, tA, top);
  g.quadraticCurveTo((tA + tB) / 2, ctrlY, tB, top);
  g.quadraticCurveTo(tB + (x1 - tB) * 0.4, deckY - H * 0.02, x1, deckY);
  g.stroke();
  g.lineWidth = 0.6;
  g.globalAlpha = 0.5;
  for (let i = 1; i < 30; i++) {
    const t = i / 30;
    const cx = bez(tA, (tA + tB) / 2, tB, t);
    const cy = bez(top, ctrlY, top, t);
    cable.push([cx, cy]);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx, deckY - 1);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Stanley Park, Prospect Point
  const park = (x) => deckY + 6 - Math.pow(Math.max(0, 1 - x / (W * 0.16)), 0.7) * H * 0.13;
  g.fillStyle = P.near;
  g.beginPath();
  g.moveTo(0, y0 + 6);
  for (let x = 0; x <= W * 0.17; x += 3) g.lineTo(x, park(x));
  g.lineTo(W * 0.17, y0 + 6);
  g.closePath();
  g.fill();
  for (let x = 0; x < W * 0.15; x += 6 + R() * 8) {
    conifer(g, x, park(x) + 4, 20 + R() * 45 + (W * 0.15 - x) * 0.1, P.near, null, R);
  }

  // Bridge light reflections
  if (P.light > 0) {
    for (const [cx] of cable) {
      g.fillStyle = `rgba(190,230,200,${0.08 * P.light})`;
      g.fillRect(cx - 0.5, y0 + 2, 1.5, H * 0.08 * R());
    }
  }

  // Seawall in front
  const stone = mixHex(P.near, '#7c7f7b', P.light > 0.5 ? 0.18 : 0.45);
  f.fillStyle = mixHex(stone, '#ffffff', 0.15);
  f.fillRect(0, wallTop, W, H * 0.025);
  f.fillStyle = vgrad(f, wallTop + H * 0.025, H, [[0, stone], [1, mixHex(stone, '#000000', 0.4)]]);
  f.fillRect(0, wallTop + H * 0.025, W, H);
  f.strokeStyle = 'rgba(0,0,0,0.25)';
  f.lineWidth = 1;
  const rowH = (H - wallTop) / 4;
  for (let r = 0; r < 4; r++) {
    const y = wallTop + H * 0.025 + r * rowH;
    f.beginPath();
    f.moveTo(0, y);
    f.lineTo(W, y);
    f.stroke();
    for (let x = (r % 2) * 30; x < W; x += 60 + R() * 20) {
      f.beginPath();
      f.moveTo(x, y);
      f.lineTo(x, y + rowH);
      f.stroke();
    }
  }
  // Bench and a lamp post
  const bx = W * 0.68, by = wallTop + 1;
  f.fillStyle = P.light > 0.5 ? '#05080f' : '#2a2a28';
  f.fillRect(bx, by - 14, 60, 4);
  f.fillRect(bx, by - 24, 60, 3);
  f.fillRect(bx + 4, by - 14, 3, 14);
  f.fillRect(bx + 53, by - 14, 3, 14);
  const lx = W * 0.86;
  f.fillRect(lx, wallTop - H * 0.2, 4, H * 0.2);
  f.fillRect(lx - 8, wallTop - H * 0.2, 20, 6);

  const shimmer = makeShimmer(R, W, y0 + 2, wallTop, 160);
  return {
    mid(ctx, t) {
      drawShimmer(ctx, shimmer, t, P.waterHi, W, env.lw);
      // A sailboat crossing slowly
      const period = 140;
      const p = (t % period) / period;
      const sx = -80 + p * (W + 160);
      const sy = y0 + H * 0.06;
      ctx.fillStyle = P.light > 0.5 ? '#0b1220' : mixHex(P.near, '#000000', 0.2);
      ctx.beginPath();
      ctx.moveTo(sx - 18, sy);
      ctx.lineTo(sx + 18, sy);
      ctx.lineTo(sx + 13, sy + 5);
      ctx.lineTo(sx - 14, sy + 5);
      ctx.fill();
      ctx.fillStyle = P.light > 0.5 ? 'rgba(200,210,230,0.35)' : 'rgba(245,245,240,0.85)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 34);
      ctx.lineTo(sx, sy - 2);
      ctx.lineTo(sx + 15, sy - 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 1, sy - 28);
      ctx.lineTo(sx - 1, sy - 2);
      ctx.lineTo(sx - 12, sy - 2);
      ctx.fill();
      if (P.light > 0) glow(ctx, sx, sy - 35, 6, 'rgba(255,240,200,ALPHA)', 0.9 * P.light);
    },
    top(ctx, t) {
      if (P.light > 0) {
        cable.forEach(([cx, cy], i) => {
          const a = (0.6 + 0.4 * Math.sin(t * 1.3 + i * 0.7)) * P.light;
          ctx.fillStyle = `rgba(200,255,215,${a})`;
          ctx.fillRect(cx - 0.8, cy - 0.8, 1.8, 1.8);
        });
        glow(ctx, lx + 2, wallTop - H * 0.2 + 8, 40, 'rgba(255,215,160,ALPHA)', 0.5 * P.light);
      }
    },
  };
};

DEFS.sfu = ({ back: g, front: f, W, H, P, R, env }) => {
  const water0 = H * 0.5;
  sky(g, W, water0, P);
  if (env.weather === 'clear' && P.light > 0.5) stars(g, W, water0 * 0.8, R, 160, env.lw);
  const far = ridgeFn(31, { base: H * 0.49, amp: H * 0.17, scale: W / 3 });
  fillRidge(g, W, H, far, vgrad(g, H * 0.3, water0, [[0, mixHex(P.far, '#ffffff', 0.1)], [1, P.far]]));
  g.fillStyle = P.water;
  g.fillRect(0, water0, W, H * 0.06);
  const city0 = H * 0.555;
  const cityFn = ridgeFn(37, { base: city0 + 4, amp: H * 0.012, scale: W / 8 });
  fillRidge(g, W, H, cityFn, vgrad(g, city0, H * 0.7, [[0, P.mid], [1, P.near]]));
  if (P.light < 0.5) {
    // Daytime city blocks
    for (let i = 0; i < 220; i++) {
      const x = R() * W;
      const y = city0 + R() * H * 0.12;
      g.fillStyle = `rgba(255,255,255,${0.05 + R() * 0.1})`;
      g.fillRect(x, y - 4 - R() * 10, 2 + R() * 5, 4 + R() * 10);
    }
  }

  // Foreground slope and trees
  const slope = ridgeFn(41, { base: H * 0.9, amp: H * 0.12, scale: W / 2.5 });
  fillRidge(f, W, H, slope, P.near);
  const treeCol = mixHex(P.near, '#0f2a1f', P.light > 0.5 ? 0.3 : 0.55);
  for (let x = -20; x < W + 20; x += 10 + R() * 18) {
    const edge = Math.min(x, W - x) / W; // 0 at edges, 0.5 at centre
    const h = H * (0.75 - edge * 1.3) * (0.7 + R() * 0.5);
    if (h > H * 0.06) conifer(f, x, slope(x) + 10, h, treeCol, null, R);
  }
  // SFU's concrete academic quadrangle, half hidden by cedars
  const qx = W * 0.56, qy = slope(W * 0.6) - H * 0.02, qw = W * 0.24, qh = H * 0.07;
  const concrete = mixHex(P.mid, '#9aa0a0', P.light > 0.5 ? 0.15 : 0.45);
  f.fillStyle = concrete;
  f.fillRect(qx, qy - qh, qw, qh * 0.35);
  f.fillStyle = mixHex(concrete, '#000000', 0.35);
  f.fillRect(qx, qy - qh * 0.65, qw, qh * 0.65 + 10);
  f.fillStyle = concrete;
  for (let x = qx; x < qx + qw; x += qw / 14) f.fillRect(x, qy - qh * 0.65, 3, qh * 0.65 + 10);
  if (P.light > 0) {
    for (let x = qx + 6; x < qx + qw - 6; x += qw / 14) {
      f.fillStyle = `rgba(255,220,170,${0.5 * P.light})`;
      f.fillRect(x, qy - qh * 0.5, qw / 14 - 8, qh * 0.3);
    }
  }
  for (let x = qx - 20; x < qx + qw + 30; x += 14 + R() * 20) {
    conifer(f, x, slope(x) + 14, H * (0.12 + R() * 0.14), treeCol, null, R);
  }

  const lights = makeCityLights(R, W, city0, H * 0.72, 700);
  const fog = makeFog(R, W, H * 0.45, H * 0.8, env.weather === 'clear' ? 4 : 8);
  return {
    mid(ctx, t) {
      drawCityLights(ctx, lights, t, P.light, env.lw);
      drawFog(ctx, fog, t, W);
    },
    top() {},
  };
};

DEFS.metrotown = ({ back: g, front: f, W, H, P, R, env }) => {
  const ground = H * 0.72;
  sky(g, W, ground, P);
  if (env.weather === 'clear' && P.light > 0.5) stars(g, W, ground * 0.5, R, 90, env.lw);
  const far = ridgeFn(51, { base: H * 0.5, amp: H * 0.13, scale: W / 3 });
  fillRidge(g, W, H, far, mixHex(P.far, P.skyBot, 0.3));

  const towers = [];
  for (let layer = 0; layer < 2; layer++) {
    const n = layer === 0 ? 12 : 10;
    for (let i = 0; i < n; i++) {
      const cx = W * (0.15 + R() * 0.75);
      const w = W * (0.025 + R() * 0.045);
      const h = H * (layer === 0 ? 0.25 + R() * 0.3 : 0.12 + R() * 0.25);
      towers.push({ x: cx - w / 2, w, h, layer });
    }
  }
  const beacons = [];
  for (const tw of towers) {
    const col = tw.layer === 0 ? mixHex(P.mid, P.far, 0.3) : P.near;
    g.fillStyle = col;
    g.fillRect(tw.x, ground - tw.h, tw.w, tw.h);
    // Slight edge highlight
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(tw.x, ground - tw.h, Math.max(1, tw.w * 0.12), tw.h);
    for (let y = ground - tw.h + 5; y < ground - 4; y += 6) {
      for (let x = tw.x + 3; x < tw.x + tw.w - 3; x += 5) {
        if (P.light > 0) {
          if (R() < 0.38) {
            g.fillStyle = windowColor(P, R) + (0.45 + R() * 0.5) * P.light + ')';
            g.fillRect(x, y, 2.5, 3);
          }
        } else if (R() < 0.5) {
          g.fillStyle = 'rgba(220,235,245,0.12)';
          g.fillRect(x, y, 2.5, 3);
        }
      }
    }
    if (tw.h > H * 0.38) beacons.push([tw.x + tw.w / 2, ground - tw.h - 3]);
  }

  // Street
  f.fillStyle = vgrad(f, ground, H, [[0, mixHex(P.near, '#000000', 0.2)], [1, mixHex(P.near, '#000000', 0.5)]]);
  f.fillRect(0, ground + H * 0.06, W, H);
  // Guideway
  const beamTop = H * 0.6, beamH = H * 0.03;
  const concrete = mixHex(P.mid, '#a9afb1', P.light > 0.5 ? 0.12 : 0.5);
  f.fillStyle = mixHex(concrete, '#000000', 0.15);
  for (let x = W * 0.07; x < W; x += W / 5.5) f.fillRect(x, beamTop + beamH, W * 0.018, ground + H * 0.08 - beamTop - beamH);
  f.fillStyle = concrete;
  f.fillRect(0, beamTop, W, beamH);
  f.fillStyle = 'rgba(0,0,0,0.25)';
  f.fillRect(0, beamTop + beamH * 0.7, W, beamH * 0.3);
  // Street lamps
  const lamps = [];
  for (let x = W * 0.04; x < W; x += W / 4.2) {
    const by = H * 0.86;
    f.fillStyle = P.light > 0.5 ? '#04070d' : '#2b3137';
    f.fillRect(x, by - H * 0.16, 3, H * 0.16);
    f.fillRect(x, by - H * 0.16, 22, 3);
    lamps.push([x + 20, by - H * 0.16 + 4]);
    if (P.light > 0) {
      f.fillStyle = vgrad(f, by, H, [[0, `rgba(255,200,130,${0.18 * P.light})`], [1, 'rgba(255,200,130,0)']]);
      f.fillRect(x + 14, by, 12, H - by);
    }
  }

  const carLen = W * 0.1, carH = H * 0.045, cars = 4;
  const trainLen = cars * carLen + (cars - 1) * 4;
  const bodyCol = P.light > 0.5 ? '#9ca6ae' : '#e7ebee';
  const traffic = Array.from({ length: 5 }, () => ({ off: R() * 40, speed: 40 + R() * 60, dir: R() < 0.5 ? 1 : -1, lane: R() }));
  return {
    mid(ctx, t) {
      const period = 26;
      const k = Math.floor(t / period);
      const p = (t % period) / 11; // 11s across the screen, then a quiet gap
      if (p <= 1) {
        const dir = k % 2 === 0 ? 1 : -1;
        const start = dir === 1 ? -trainLen : W;
        const x = start + dir * p * (W + trainLen);
        for (let c = 0; c < cars; c++) {
          const cx = x + c * (carLen + 4);
          const cy = beamTop - carH;
          ctx.fillStyle = bodyCol;
          ctx.beginPath();
          ctx.roundRect(cx, cy, carLen, carH, [6, 6, 2, 2]);
          ctx.fill();
          ctx.fillStyle = '#1f5ea8';
          ctx.fillRect(cx, cy + carH * 0.72, carLen, carH * 0.14);
          ctx.fillStyle = P.light > 0 ? `rgba(255,236,190,${0.4 + 0.55 * P.light})` : 'rgba(30,40,55,0.75)';
          for (let wx = cx + 6; wx < cx + carLen - 10; wx += carLen / 7) {
            ctx.fillRect(wx, cy + carH * 0.2, carLen / 7 - 5, carH * 0.38);
          }
          // Reflection on the wet street
          ctx.fillStyle = P.light > 0 ? `rgba(255,230,180,${0.07 * P.light + 0.03})` : 'rgba(255,255,255,0.05)';
          ctx.fillRect(cx, H * 0.9, carLen, H * 0.05);
        }
        if (P.light > 0) {
          const nose = dir === 1 ? x + trainLen : x;
          glow(ctx, nose, beamTop - carH * 0.4, 30, 'rgba(255,250,230,ALPHA)', 0.6 * P.light);
        }
      }
      // Cars on the street
      for (const c of traffic) {
        const span = W + 80;
        const x = c.dir === 1 ? ((c.off * 20 + t * c.speed) % span) - 40 : W + 40 - ((c.off * 20 + t * c.speed) % span);
        const y = H * (0.82 + c.lane * 0.03);
        const col = c.dir === 1 ? '255,60,50' : '255,245,220';
        ctx.fillStyle = `rgba(${col},${0.5 + 0.4 * P.light})`;
        ctx.fillRect(x, y, 3, 2);
        ctx.fillRect(x + 12, y, 3, 2);
      }
    },
    top(ctx, t) {
      const blink = Math.sin(t * 2.4) > 0.6;
      if (blink) for (const [bx, by] of beacons) glow(ctx, bx, by, 6, 'rgba(255,60,60,ALPHA)', 0.9);
      if (P.light > 0) for (const [lx, ly] of lamps) glow(ctx, lx, ly, 46, 'rgba(255,205,140,ALPHA)', 0.55 * P.light);
    },
  };
};

DEFS.deerlake = ({ back: g, front: f, W, H, P, R, env, makeLayer }) => {
  const y0 = H * 0.56;
  sky(g, W, y0, P);
  if (env.weather === 'clear' && P.light > 0.5) stars(g, W, y0 * 0.8, R, 150, env.lw);
  const far = ridgeFn(61, { base: y0 - H * 0.05, amp: H * 0.09, scale: W / 2.5 });
  fillRidge(g, W, H, far, mixHex(P.far, P.skyBot, 0.25), y0);
  // Metrotown towers on the horizon
  for (let i = 0; i < 9; i++) {
    const x = W * (0.6 + R() * 0.14);
    const w = 5 + R() * 9;
    const h = H * (0.07 + R() * 0.09);
    g.fillStyle = mixHex(P.far, P.mid, 0.4);
    g.fillRect(x, y0 - H * 0.04 - h, w, h);
    if (P.light > 0) {
      for (let y = y0 - H * 0.04 - h + 3; y < y0 - H * 0.04; y += 4) {
        if (R() < 0.4) {
          g.fillStyle = `rgba(255,215,160,${0.6 * P.light})`;
          g.fillRect(x + 1 + R() * (w - 3), y, 1.2, 1.2);
        }
      }
    }
  }
  // Far shore tree line
  const shore = ridgeFn(67, { base: y0, amp: H * 0.015, scale: W / 10 });
  const treeCol = mixHex(P.mid, '#1d3a2c', P.light > 0.5 ? 0.25 : 0.45);
  for (let x = -10; x < W + 10; x += 5 + R() * 8) {
    if (R() < 0.55) conifer(g, x, shore(x), H * (0.04 + R() * 0.07), treeCol, null, R);
    else roundTree(g, x, shore(x), H * (0.015 + R() * 0.02), mixHex(treeCol, '#3a4a30', 0.3), R);
  }
  g.fillStyle = treeCol;
  g.fillRect(0, y0 - 3, W, 4);

  // Reflection: mirror everything above the waterline
  const tmp = makeLayer();
  tmp.g.drawImage(g.canvas, 0, 0, W, H);
  g.save();
  g.beginPath();
  g.rect(0, y0, W, H - y0);
  g.clip();
  g.translate(0, y0 * 2);
  g.scale(1, -1);
  g.globalAlpha = 0.55;
  g.drawImage(tmp.c, 0, 0, W, H);
  g.restore();
  g.fillStyle = vgrad(g, y0, H, [[0, hexA(P.water, 0.45)], [1, hexA(P.waterDeep, 0.95)]]);
  g.fillRect(0, y0, W, H - y0);

  // Lily pads
  for (let i = 0; i < 26; i++) {
    const x = R() * W * 0.45;
    const y = H * (0.82 + R() * 0.16);
    const r = 6 + R() * 12 * ((y - H * 0.8) / (H * 0.2) + 0.4);
    f.fillStyle = mixHex(P.near, '#2f5a36', P.light > 0.5 ? 0.25 : 0.5);
    f.beginPath();
    f.ellipse(x, y, r, r * 0.35, 0, 0.2, Math.PI * 2 - 0.1);
    f.lineTo(x, y);
    f.fill();
    if (R() < 0.15) {
      f.fillStyle = P.light > 0.5 ? 'rgba(230,200,220,0.5)' : '#f3d7e6';
      f.beginPath();
      f.arc(x + r * 0.2, y - 3, 3, 0, Math.PI * 2);
      f.fill();
    }
  }

  const reeds = Array.from({ length: 70 }, () => ({
    x: W * 0.72 + R() * W * 0.3,
    h: H * (0.12 + R() * 0.2),
    ph: R() * 6.28,
    cat: R() < 0.3,
  }));
  const shimmer = makeShimmer(R, W, y0 + 3, H, 140);
  const fog = makeFog(R, W, y0 - H * 0.03, y0 + H * 0.05, 6);
  const ducks = [
    { off: 0, speed: 9, y: H * 0.68, s: 1 },
    { off: 22, speed: 9, y: H * 0.695, s: 0.85 },
  ];
  const duckCol = P.light > 0.5 ? '#060a12' : '#3a3a33';
  return {
    mid(ctx, t) {
      drawShimmer(ctx, shimmer, t, P.waterHi, W, env.lw);
      drawFog(ctx, fog, t, W);
      for (const d of ducks) {
        const span = W + 200;
        const x = ((t * d.speed + d.off * 10) % span) - 100;
        const s = d.s * H * 0.012;
        ctx.strokeStyle = P.waterHi;
        ctx.beginPath();
        ctx.moveTo(x - s * 2, d.y + s * 0.6);
        ctx.lineTo(x - s * 9, d.y - s * 0.3);
        ctx.moveTo(x - s * 2, d.y + s * 0.6);
        ctx.lineTo(x - s * 9, d.y + s * 1.6);
        ctx.stroke();
        ctx.fillStyle = duckCol;
        ctx.beginPath();
        ctx.ellipse(x, d.y, s * 2.2, s * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + s * 1.7, d.y - s * 1.2, s * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x + s * 1.3, d.y - s * 1.0, s * 0.6, s * 0.9);
      }
    },
    top(ctx, t) {
      ctx.strokeStyle = P.light > 0.5 ? '#03060c' : mixHex(P.near, '#3d4a2a', 0.3);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2;
      for (const r of reeds) {
        const sway = Math.sin(t * 0.8 + r.ph) * 6;
        ctx.beginPath();
        ctx.moveTo(r.x, H + 2);
        ctx.quadraticCurveTo(r.x, H - r.h * 0.5, r.x + sway, H - r.h);
        ctx.stroke();
        if (r.cat) {
          ctx.beginPath();
          ctx.ellipse(r.x + sway * 0.95, H - r.h + 10, 3, 9, sway * 0.02, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
};

function hexA(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

DEFS.englishbay = ({ back: g, front: f, W, H, P: base, R, env }) => {
  const P = { ...base };
  if (env.tod === 'day') {
    Object.assign(P, { skyTop: '#7f97b3', skyBot: '#f1c590', water: '#6f839a', waterHi: 'rgba(255,230,180,0.3)' });
    if (env.weather !== 'clear') Object.assign(P, { skyTop: '#7d8996', skyBot: '#d9c3a6' });
  } else if (env.tod === 'dusk') {
    Object.assign(P, { skyTop: '#28305a', skyBot: '#f28a5a', water: '#5a5372', waterHi: 'rgba(255,170,120,0.35)' });
  } else {
    Object.assign(P, { skyBot: '#2d2b4a' });
  }
  const y0 = H * 0.56;
  const beach = H * 0.8;
  g.fillStyle = vgrad(g, 0, y0, [[0, P.skyTop], [0.65, mixHex(P.skyTop, P.skyBot, 0.6)], [1, P.skyBot]]);
  g.fillRect(0, 0, W, y0 + 1);
  if (env.weather === 'clear' && env.tod === 'night') stars(g, W, y0 * 0.8, R, 170, env.lw);

  const sunX = W * 0.36;
  const sunY = env.tod === 'dusk' ? y0 - H * 0.025 : y0 - H * 0.12;
  if (env.tod !== 'night') {
    const haze = env.weather === 'clear' ? 1 : 0.4;
    glow(g, sunX, sunY, H * 0.3, 'rgba(255,200,140,ALPHA)', 0.45 * haze);
    g.fillStyle = `rgba(255,236,200,${0.9 * haze})`;
    g.beginPath();
    g.arc(sunX, sunY, H * 0.03, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = 'rgba(240,240,225,0.9)';
    g.beginPath();
    g.arc(W * 0.7, H * 0.18, H * 0.025, 0, Math.PI * 2);
    g.fill();
    glow(g, W * 0.7, H * 0.18, H * 0.12, 'rgba(220,225,255,ALPHA)', 0.15);
  }
  // Distant islands on the left
  const isl = ridgeFn(71, { base: y0 + 1, amp: H * 0.05, scale: W / 5 });
  g.save();
  g.beginPath();
  g.rect(0, 0, W * 0.32, H);
  g.clip();
  fillRidge(g, W, H, (x) => isl(x) + (x / (W * 0.32)) * H * 0.04, hexA(mixHex(P.far, P.skyBot, 0.35), 0.9), y0 + 1);
  g.restore();
  // Water
  g.fillStyle = vgrad(g, y0, beach, [[0, P.water], [1, P.waterDeep]]);
  g.fillRect(0, y0, W, beach - y0);
  // Freighters at anchor
  const ships = [];
  for (let i = 0; i < 7; i++) {
    const x = W * (0.05 + R() * 0.9);
    const w = W * (0.025 + R() * 0.03);
    const y = y0 + H * (0.004 + R() * 0.014);
    const shipCol = env.tod === 'night' ? '#05080f' : mixHex(P.far, '#1b1d28', 0.6);
    g.fillStyle = shipCol;
    g.fillRect(x, y - w * 0.12, w, w * 0.12);
    g.fillRect(x + w * 0.78, y - w * 0.3, w * 0.14, w * 0.2);
    if (R() < 0.6) for (let c = 0; c < 4; c++) g.fillRect(x + w * (0.1 + c * 0.16), y - w * 0.2, w * 0.13, w * 0.09);
    ships.push([x + w * 0.85, y - w * 0.32], [x + 2, y - w * 0.14]);
  }
  // Sand
  const sandCol = env.tod === 'night' ? '#141826' : env.tod === 'dusk' ? '#6e5a5a' : '#b5a68e';
  g.fillStyle = vgrad(g, beach, H, [[0, mixHex(sandCol, '#000000', 0.15)], [1, mixHex(sandCol, '#000000', 0.45)]]);
  g.fillRect(0, beach, W, H - beach);

  // Driftwood logs
  const logCol = env.tod === 'night' ? '#0a0c14' : env.tod === 'dusk' ? '#3a2c2a' : '#6b5845';
  for (let i = 0; i < 6; i++) {
    const x = R() * W * 0.7;
    const y = H * (0.87 + R() * 0.1);
    const len = W * (0.08 + R() * 0.1);
    const th = H * (0.012 + R() * 0.01);
    f.save();
    f.translate(x, y);
    f.rotate((R() - 0.5) * 0.25);
    f.fillStyle = logCol;
    f.beginPath();
    f.roundRect(0, 0, len, th, th / 2);
    f.fill();
    f.fillStyle = 'rgba(255,255,255,0.08)';
    f.fillRect(th, 1, len - th * 2, th * 0.25);
    f.restore();
  }
  // The inukshuk
  const ix = W * 0.8, ib = H * 0.84, u = H * 0.022;
  const rock = env.tod === 'night' ? '#07090f' : mixHex(P.near, '#3b3a3a', 0.4);
  f.fillStyle = mixHex(rock, '#000000', 0.2);
  f.beginPath();
  f.ellipse(ix, ib + u * 0.8, u * 6, u * 1.6, 0, Math.PI, 0);
  f.fill();
  f.fillStyle = rock;
  f.fillRect(ix - u * 2.2, ib - u * 3.2, u * 1.4, u * 3.2);
  f.fillRect(ix + u * 0.8, ib - u * 3.2, u * 1.4, u * 3.2);
  f.fillRect(ix - u * 2.6, ib - u * 4.3, u * 5.2, u * 1.1);
  f.fillRect(ix - u * 1.4, ib - u * 6.3, u * 2.8, u * 2.0);
  f.fillRect(ix - u * 4.6, ib - u * 7.2, u * 9.2, u * 0.9);
  f.fillRect(ix - u * 0.9, ib - u * 8.7, u * 1.8, u * 1.5);

  const shimmer = makeShimmer(R, W, y0 + 2, beach, 140);
  const glitter = Array.from({ length: 120 }, () => {
    const y = y0 + 3 + R() ** 1.3 * (beach - y0 - 6);
    const spread = 6 + ((y - y0) / (beach - y0)) * W * 0.07;
    return { x: (R() - 0.5) * 2 * spread, y, len: 3 + R() * 14, ph: R() * 6.28, sp: 1 + R() * 3 };
  });
  const glitterX = env.tod === 'night' ? W * 0.7 : sunX;
  const glitterCol = env.tod === 'night' ? 'rgba(230,235,255,0.5)' : 'rgba(255,225,170,0.8)';
  return {
    mid(ctx, t) {
      drawShimmer(ctx, shimmer, t, P.waterHi, W, env.lw);
      ctx.strokeStyle = glitterCol;
      for (const s of glitter) {
        const a = Math.sin(t * s.sp + s.ph);
        if (a < 0.2) continue;
        ctx.globalAlpha = a * (env.weather === 'clear' ? 1 : 0.4);
        ctx.beginPath();
        ctx.moveTo(glitterX + s.x, s.y);
        ctx.lineTo(glitterX + s.x + s.len, s.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Waves rolling onto the sand
      for (let i = 0; i < 3; i++) {
        const p = ((t + i * 3) % 9) / 9;
        const y = H * 0.72 + p * (beach - H * 0.72 + 4);
        const a = Math.sin(p * Math.PI) * 0.55;
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 12) {
          const yy = y + Math.sin(x * 0.012 + i * 2 + t * 0.4) * 3;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    },
    top(ctx, t) {
      if (env.tod !== 'day') {
        ships.forEach(([x, y], i) => {
          const a = 0.6 + 0.4 * Math.sin(t * 1.1 + i);
          glow(ctx, x, y, 5, 'rgba(255,235,190,ALPHA)', a);
        });
      }
    },
  };
};

DEFS.gastown = ({ back: g, front: f, W, H, P, R, env }) => {
  const street = H * 0.74;
  sky(g, W, street, P);
  const brick = mixHex('#86523f', '#2a1b1b', P.light);
  const facades = [];
  let x = -10;
  while (x < W + 10) {
    const w = W * (0.09 + R() * 0.1);
    const h = H * (0.3 + R() * 0.22);
    facades.push({ x, w, h });
    x += w;
  }
  for (const fa of facades) {
    const col = mixHex(brick, R() < 0.5 ? '#5b3a2c' : '#6d4a3a', 0.3);
    const top = street - fa.h;
    g.fillStyle = col;
    g.fillRect(fa.x, top, fa.w, fa.h);
    g.fillStyle = mixHex(col, '#d8c8b0', 0.25);
    g.fillRect(fa.x - 2, top, fa.w + 4, 5);
    g.fillRect(fa.x - 1, top + 9, fa.w + 2, 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(fa.x, top, 2, fa.h);
    const cols = Math.max(2, Math.floor(fa.w / 44));
    const ww = Math.max(3, Math.min(22, fa.w / cols - 18));
    const pad = (fa.w / cols - ww) / 2;
    for (let y = top + 24; y < street - H * 0.13; y += H * 0.085) {
      for (let c = 0; c < cols; c++) {
        const wx = fa.x + pad + c * (fa.w / cols);
        const wh = Math.max(ww * 1.6, H * 0.04);
        const lit = P.light > 0 ? R() < 0.35 : false;
        g.fillStyle = lit
          ? `rgba(255,${170 + Math.floor(R() * 40)},105,${0.3 + 0.3 * R()})`
          : P.light > 0 ? 'rgba(8,8,16,0.7)' : 'rgba(40,45,55,0.6)';
        g.beginPath();
        g.moveTo(wx, y + wh);
        g.lineTo(wx, y + ww / 2);
        g.arc(wx + ww / 2, y + ww / 2, ww / 2, Math.PI, 0);
        g.lineTo(wx + ww, y + wh);
        g.closePath();
        g.fill();
      }
    }
    // Shopfront and awning
    const shopTop = street - H * 0.09;
    g.fillStyle = P.light > 0 ? `rgba(255,190,120,${0.12 + 0.18 * P.light * R()})` : 'rgba(40,45,50,0.6)';
    g.fillRect(fa.x + 6, shopTop + 6, fa.w - 12, H * 0.09 - 6);
    g.fillStyle = R() < 0.5 ? mixHex('#1f3b2e', '#000000', P.light * 0.5) : mixHex('#4a1f22', '#000000', P.light * 0.5);
    g.fillRect(fa.x + 2, shopTop - 4, fa.w - 4, 9);
  }

  // Steam clock
  // Off-centre so the timer doesn't cover it
  const cx = W * 0.74, base = H * 0.78, ch = H * 0.4, cw = H * 0.06;
  const bronze = mixHex('#5a4630', '#17120c', P.light * 0.8);
  f.fillStyle = bronze;
  f.fillRect(cx - cw * 0.8, base - ch * 0.12, cw * 1.6, ch * 0.12);
  f.fillRect(cx - cw * 0.5, base - ch * 0.66, cw, ch * 0.56);
  f.fillStyle = mixHex(bronze, '#000000', 0.3);
  for (let i = 0; i < 3; i++) f.fillRect(cx - cw * 0.38 + i * cw * 0.3, base - ch * 0.6, cw * 0.16, ch * 0.42);
  f.fillStyle = bronze;
  f.fillRect(cx - cw * 0.62, base - ch * 0.86, cw * 1.24, ch * 0.2);
  f.beginPath();
  f.moveTo(cx - cw * 0.72, base - ch * 0.86);
  f.lineTo(cx, base - ch * 0.97);
  f.lineTo(cx + cw * 0.72, base - ch * 0.86);
  f.fill();
  f.fillRect(cx - 1.5, base - ch * 1.04, 3, ch * 0.08);
  for (const s of [-1, 1]) f.fillRect(cx + s * cw * 0.55 - 2, base - ch * 0.93, 4, ch * 0.05);
  const face = { x: cx, y: base - ch * 0.76, r: cw * 0.4 };

  // Cobblestones
  f.fillStyle = mixHex('#2b2724', '#0b0a0c', P.light * 0.6);
  f.fillRect(0, street, W, H - street);
  let y = street;
  while (y < H) {
    const rh = 3 + ((y - street) / (H - street)) * 16;
    let sx = -R() * rh * 2;
    while (sx < W) {
      const sw = rh * (1.4 + R() * 0.8);
      const shade = R() * 0.2;
      f.fillStyle = mixHex('#7d756c', '#1c1a1d', 0.25 + P.light * 0.45 + shade);
      f.beginPath();
      f.roundRect(sx + 1, y + 1, sw - 2, rh - 2, rh * 0.3);
      f.fill();
      sx += sw;
    }
    y += rh;
  }
  // Lamps
  const lamps = [];
  for (const lx of [0.1, 0.32, 0.6, 0.9]) {
    const px = W * lx, pb = H * 0.84, ph = H * 0.26;
    f.fillStyle = P.light > 0.5 ? '#050608' : '#1d1f1f';
    f.fillRect(px - 2.5, pb - ph, 5, ph);
    f.fillRect(px - 6, pb - 8, 12, 8);
    f.fillRect(px - 16, pb - ph + 14, 32, 3);
    for (const dx of [-14, 0, 14]) lamps.push([px + dx, pb - ph + 6 + (dx === 0 ? -6 : 0)]);
    if (P.light > 0) {
      f.fillStyle = vgrad(f, pb, H, [[0, `rgba(255,190,110,${0.25 * P.light})`], [1, 'rgba(255,190,110,0)']]);
      f.fillRect(px - 10, pb, 20, H - pb);
    }
  }
  const steam = [];
  let lastPuff = -10;
  return {
    mid() {},
    top(ctx, t, dt) {
      // Lamp globes
      for (const [lx, ly] of lamps) {
        ctx.fillStyle = P.light > 0 ? '#ffe9c2' : 'rgba(230,230,220,0.85)';
        ctx.beginPath();
        ctx.arc(lx, ly, 5, 0, Math.PI * 2);
        ctx.fill();
        if (P.light > 0) glow(ctx, lx, ly, 34, 'rgba(255,200,120,ALPHA)', (0.5 + 0.05 * Math.sin(t * 7 + lx)) * P.light);
      }
      // Clock face showing the real Vancouver time
      ctx.fillStyle = P.light > 0 ? '#f6e7bf' : '#e8e0c8';
      ctx.beginPath();
      ctx.arc(face.x, face.y, face.r, 0, Math.PI * 2);
      ctx.fill();
      if (P.light > 0) glow(ctx, face.x, face.y, face.r * 3, 'rgba(255,230,170,ALPHA)', 0.35 * P.light);
      const hr = vancouverHour();
      const hA = ((hr % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      const mA = ((hr % 1) * Math.PI * 2) - Math.PI / 2;
      ctx.strokeStyle = '#2a2016';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(face.x, face.y);
      ctx.lineTo(face.x + Math.cos(hA) * face.r * 0.5, face.y + Math.sin(hA) * face.r * 0.5);
      ctx.moveTo(face.x, face.y);
      ctx.lineTo(face.x + Math.cos(mA) * face.r * 0.8, face.y + Math.sin(mA) * face.r * 0.8);
      ctx.stroke();
      ctx.lineWidth = 1;
      // Steam: a big puff every so often, plus a constant wisp
      const puffing = t % 15 < 3;
      if (t - lastPuff > (puffing ? 0.06 : 0.35) || steam.length === 0) {
        lastPuff = t;
        for (const sx of [cx, cx - cw * 0.55, cx + cw * 0.55]) {
          if (sx !== cx && !puffing) continue;
          steam.push({ x: sx, y: base - ch * (sx === cx ? 1.0 : 0.93), r: 4, a: puffing ? 0.32 : 0.16, vx: (Math.random() - 0.5) * 8, vy: -(18 + Math.random() * 20) });
        }
      }
      for (let i = steam.length - 1; i >= 0; i--) {
        const s = steam[i];
        s.x += (s.vx + 6) * dt;
        s.y += s.vy * dt;
        s.r += 9 * dt;
        s.a -= 0.05 * dt;
        if (s.a <= 0) {
          steam.splice(i, 1);
          continue;
        }
        const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        gr.addColorStop(0, `rgba(235,235,240,${s.a})`);
        gr.addColorStop(1, 'rgba(235,235,240,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      }
    },
  };
};

DEFS.grouse = ({ back: g, front: f, W, H, P, R, env }) => {
  const sea = H * 0.44;
  sky(g, W, sea, P);
  if (env.weather === 'clear' && P.light > 0.5) stars(g, W, sea * 0.85, R, 200, env.lw);
  const far = ridgeFn(81, { base: sea, amp: H * 0.08, scale: W / 4 });
  fillRidge(g, W, H, far, mixHex(P.far, P.skyBot, 0.35), sea + 1);
  g.fillStyle = P.water;
  g.fillRect(0, sea, W, H * 0.06);
  const city0 = H * 0.5;
  g.fillStyle = vgrad(g, city0, H * 0.75, [[0, P.mid], [1, P.near]]);
  g.fillRect(0, city0, W, H);
  // Stanley Park and the harbour, a dark patch with water around it
  g.fillStyle = P.water;
  g.beginPath();
  g.ellipse(W * 0.42, city0 + H * 0.03, W * 0.12, H * 0.018, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = mixHex(P.near, '#0f2a1f', 0.4);
  g.beginPath();
  g.ellipse(W * 0.36, city0 + H * 0.03, W * 0.035, H * 0.012, 0, 0, Math.PI * 2);
  g.fill();
  if (P.light < 0.5) {
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${0.04 + R() * 0.1})`;
      g.fillRect(R() * W, city0 + R() * H * 0.2, 2 + R() * 4, 2 + R() * 6);
    }
  }

  // Snowy foreground slope
  const slope = (x) => H * 0.58 + (x / W) * H * 0.3 + Math.sin(x * 0.01) * H * 0.015;
  const snow = P.light > 0.5 ? '#3a4660' : P.light > 0 ? '#b9b7cc' : '#eef2f5';
  const snowShade = mixHex(snow, '#5a6a8a', 0.35);
  f.fillStyle = vgrad(f, H * 0.55, H, [[0, snow], [1, snowShade]]);
  f.beginPath();
  f.moveTo(-2, H);
  for (let x = -2; x <= W + 4; x += 4) f.lineTo(x, slope(x));
  f.lineTo(W + 4, H);
  f.fill();
  const fir = mixHex(P.near, '#163126', P.light > 0.5 ? 0.25 : 0.6);
  const snowOnFir = P.light > 0.5 ? 'rgba(120,140,170,0.6)' : 'rgba(245,248,252,0.9)';
  for (let x = -10; x < W + 10; x += 14 + R() * 30) {
    const far = x / W;
    const h = H * (0.32 - far * 0.18) * (0.6 + R() * 0.6);
    if (x > W * 0.3 && x < W * 0.6 && R() < 0.7) continue;
    conifer(f, x, slope(x) + 6, h, fir, snowOnFir, R);
  }

  const lights = makeCityLights(R, W, city0, H * 0.8, 900);
  const cable1 = [[-W * 0.02, H * 0.2], [W * 1.02, H * 0.62]];
  const cable2 = [[-W * 0.02, H * 0.23], [W * 1.02, H * 0.65]];
  const lerp = (c, p) => [c[0][0] + (c[1][0] - c[0][0]) * p, c[0][1] + (c[1][1] - c[0][1]) * p];
  const red = P.light > 0.5 ? '#7a1f22' : '#c8323a';
  const drawCar = (ctx, [x, y], scale) => {
    const w = 26 * scale, h = 20 * scale;
    ctx.strokeStyle = P.light > 0.5 ? '#0a0d14' : '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 12 * scale);
    ctx.stroke();
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y + 12 * scale, w, h, 4 * scale);
    ctx.fill();
    ctx.fillStyle = P.light > 0 ? `rgba(255,236,190,${0.5 + 0.4 * P.light})` : 'rgba(30,40,60,0.7)';
    ctx.fillRect(x - w / 2 + 3 * scale, y + 15 * scale, w - 6 * scale, h * 0.38);
  };
  return {
    mid(ctx, t) {
      drawCityLights(ctx, lights, t, P.light, env.lw);
    },
    top(ctx, t) {
      ctx.strokeStyle = P.light > 0.5 ? 'rgba(120,130,150,0.55)' : 'rgba(40,40,45,0.7)';
      ctx.lineWidth = 1;
      for (const c of [cable1, cable2]) {
        ctx.beginPath();
        ctx.moveTo(...c[0]);
        ctx.lineTo(...c[1]);
        ctx.stroke();
      }
      const p1 = (t % 60) / 60;
      const p2 = 1 - ((t + 30) % 60) / 60;
      drawCar(ctx, lerp(cable1, p1), 1.8 - p1 * 0.9);
      drawCar(ctx, lerp(cable2, p2), 1.8 - p2 * 0.9);
    },
  };
};

// ---------------------------------------------------------------------------
// Your own photo, colour-graded for the time of day and weather
// ---------------------------------------------------------------------------

function drawCover(g, img, W, H) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(W / iw, H / ih);
  const w = iw * scale;
  const h = ih * scale;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

DEFS.photo = ({ back: g, W, H, env, image }) => {
  const wet = env.weather === 'rain' || env.weather === 'fog' || env.weather === 'snow';
  g.save();
  g.filter = env.pixel
    ? `saturate(${wet ? 0.95 : 1.2}) contrast(1.08)`
    : `saturate(${wet ? 0.8 : 1}) contrast(1.02)`;
  drawCover(g, image, W, H);
  g.restore();

  g.save();
  g.globalCompositeOperation = 'multiply';
  if (env.tod === 'night') {
    // Moonlit blue, dark but still readable
    g.fillStyle = vgrad(g, 0, H, [[0, '#5a6aa8'], [1, '#46568f']]);
    g.fillRect(0, 0, W, H);
  } else if (env.tod === 'dusk') {
    g.fillStyle = vgrad(g, 0, H, [[0, '#6f72ad'], [0.55, '#eaa58f'], [1, '#8b6e80']]);
    g.fillRect(0, 0, W, H);
  } else if (wet) {
    g.fillStyle = '#b3bfcb';
    g.fillRect(0, 0, W, H);
  }
  g.restore();
  if (env.tod === 'night') {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.fillStyle = 'rgba(30,45,90,0.3)';
    g.fillRect(0, 0, W, H);
    g.restore();
  }
  if (env.weather === 'fog') {
    g.fillStyle = vgrad(g, 0, H, [[0, 'rgba(210,218,225,0.1)'], [0.6, 'rgba(210,218,225,0.3)'], [1, 'rgba(210,218,225,0.15)']]);
    g.fillRect(0, 0, W, H);
  }
  return { mid() {}, top() {} };
};

// ---------------------------------------------------------------------------
// Pixel-art treatment: reduce colours with ordered dithering
// ---------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function posterize(canvas, levels, crispAlpha, ditherAmount = 1) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const step = 255 / (levels - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (crispAlpha) {
        if (d[i + 3] < 110) {
          d[i + 3] = 0;
          continue;
        }
        d[i + 3] = 255;
      } else if (d[i + 3] === 0) continue;
      const thr = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * step * ditherAmount;
      for (let c = 0; c < 3; c++) {
        const v = Math.round((d[i + c] + thr) / step) * step;
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Weather overlay
// ---------------------------------------------------------------------------

function makeWeather(kind, W, H, R, P, lw) {
  const pixel = lw > 1;
  if (kind === 'rain') {
    const density = pixel ? 5200 : 7000;
    const drops = Array.from({ length: Math.round((W * H) / density) }, () => ({
      x: R() * W,
      y: R() * H,
      len: pixel ? 12 + R() * 30 : 10 + R() * 16,
      sp: 650 + R() * 400,
      a: pixel ? 0.12 + R() * 0.3 : 0.15 + R() * 0.3,
    }));
    const col = P.light > 0.5 ? '170,200,235' : '235,240,245';
    const slant = pixel ? 0.02 : 0.08;
    return (ctx, t, dt) => {
      ctx.lineWidth = lw;
      for (const d of drops) {
        d.y += d.sp * dt;
        d.x += d.sp * dt * slant;
        if (d.y > H) {
          d.y = -d.len;
          d.x = R() * W;
        }
        if (d.x > W) d.x -= W;
        ctx.strokeStyle = `rgba(${col},${d.a})`;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * slant, d.y + d.len);
        ctx.stroke();
      }
    };
  }
  if (kind === 'snow') {
    const flakes = Array.from({ length: Math.round((W * H) / 6000) }, () => ({
      x: R() * W, y: R() * H, r: Math.max(lw / 2, 0.8 + R() * 2.2), sp: 25 + R() * 50, ph: R() * 6.28,
    }));
    return (ctx, t, dt) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const fl of flakes) {
        fl.y += fl.sp * dt;
        fl.x += Math.sin(t + fl.ph) * 12 * dt;
        if (fl.y > H) {
          fl.y = -4;
          fl.x = R() * W;
        }
        if (pixel) {
          ctx.fillRect(fl.x, fl.y, lw, lw);
        } else {
          ctx.beginPath();
          ctx.arc(fl.x, fl.y, fl.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
  }
  if (kind === 'fog') {
    const fog = makeFog(R, W, H * 0.3, H * 0.9, 9);
    return (ctx, t) => drawFog(ctx, fog, t, W);
  }
  return () => {};
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export const isCustomScene = (id) => typeof id === 'string' && id.startsWith('custom:');

export class SceneRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{scene?: string, tod?: 'day'|'dusk'|'night', weather?: 'clear'|'rain'|'snow'|'fog',
   *   style?: 'smooth'|'pixel', image?: CanvasImageSource|null, reduced?: boolean, still?: boolean}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = {
      scene: 'seawall', tod: 'night', weather: 'clear', style: 'smooth', image: null,
      reduced: false, still: false, ...opts,
    };
    this.t = 4;
    this.last = 0;
    this.raf = 0;
    this.resize();
    if (!this.opts.still) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  setOptions(opts) {
    const changed = Object.entries(opts).some(([k, v]) => this.opts[k] !== v);
    if (!changed) return;
    const styleChanged = 'style' in opts && opts.style !== this.opts.style;
    Object.assign(this.opts, opts);
    if (styleChanged) {
      this.layers = null;
      this.resize();
    } else {
      this.build();
    }
    if (this.opts.still) this.draw(0);
  }

  resize() {
    const W = this.canvas.clientWidth || this.cssW || this.canvas.width;
    const H = this.canvas.clientHeight || this.cssH || this.canvas.height;
    if (!W || !H) return;
    this.cssW = W;
    this.cssH = H;
    const pixel = this.opts.style === 'pixel';
    // In pixel mode, draw at roughly 230 rows tall and let CSS scale it up with hard edges.
    this.px = pixel ? Math.max(2, Math.min(6, Math.round(H / 230))) : 1;
    const dpr = pixel ? 1 / this.px : Math.min(window.devicePixelRatio || 1, this.opts.still ? 1 : 1.5);
    if (this.W === W && this.H === H && this.dpr === dpr && this.layers) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(W * dpr));
    this.canvas.height = Math.max(1, Math.round(H * dpr));
    this.canvas.style.imageRendering = pixel ? 'pixelated' : '';
    this.ctx.imageSmoothingEnabled = !pixel;
    this.build();
    if (this.opts.still) this.draw(0);
  }

  makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.W * this.dpr));
    c.height = Math.max(1, Math.round(this.H * this.dpr));
    const g = c.getContext('2d', { willReadFrequently: this.opts.style === 'pixel' });
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { c, g };
  }

  build() {
    if (!this.W) return;
    const { scene, tod, weather, style, image } = this.opts;
    const pixel = style === 'pixel';
    const custom = isCustomScene(scene) && image;
    const def = custom ? DEFS.photo : DEFS[scene] ?? DEFS.seawall;
    const P = paletteFor(tod, weather, pixel);
    const back = this.makeLayer();
    const front = this.makeLayer();
    const R = rng(1234 + String(scene).length * 97);
    const lw = pixel ? this.px : 1;
    this.layers = { back, front };
    this.anim = def({
      back: back.g,
      front: front.g,
      W: this.W,
      H: this.H,
      P,
      R,
      env: { tod, weather, pixel, lw },
      image,
      makeLayer: () => this.makeLayer(),
    });
    if (pixel) {
      posterize(back.c, custom ? 14 : 16, false, custom ? 0.35 : 0.45);
      posterize(front.c, 16, true, 0.45);
    }
    // Rain becomes snow up on Grouse
    const fx = scene === 'grouse' && weather === 'rain' ? 'snow' : weather;
    this.fx = makeWeather(fx, this.W, this.H, rng(99), P, lw);
    this.dim = weather === 'rain' && tod === 'day' && !custom ? 0.08 : 0;
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const fps = this.opts.reduced ? 8 : this.opts.style === 'pixel' ? 15 : 30;
    if (now - this.last < 1000 / fps) return;
    const dt = Math.min(0.15, (now - (this.last || now)) / 1000) * (this.opts.reduced ? 0.4 : 1);
    this.last = now;
    this.t += dt;
    this.draw(dt);
  }

  draw(dt) {
    if (!this.layers) return;
    const { ctx, W, H, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.layers.back.c, 0, 0, W, H);
    this.anim.mid(ctx, this.t, dt);
    ctx.drawImage(this.layers.front.c, 0, 0, W, H);
    this.anim.top(ctx, this.t, dt);
    this.fx(ctx, this.t, dt);
    if (this.dim) {
      ctx.fillStyle = `rgba(40,50,60,${this.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }
}
