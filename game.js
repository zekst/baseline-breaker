/* Baseline Breaker — a top-down tennis brick-breaker.
   Court is 6.5 units wide × 12 deep. Bricks fill the far 5.5 units (11 rows of 0.5),
   the paddle plays near the baseline, and a ball that crosses the baseline is lost. */
(() => {
'use strict';

/* ------------------------------------------------------------------ constants */
const W = 6.5, H = 12;
const COLS = 13, ROWS = 11, CELL = 0.5;
const BALL_R = 0.2;
const PADDLE_Y = 10.9, PADDLE_MIN_Y = 8.6;       // ArrowUp / K pulls the paddle forward
const PADDLE_HALF = 1.025;                       // 2.05 units wide at size 1
const LOSE_Y = H;                                // baseline
const BASE_SPEED = 0.0115;                       // units per ms
const MAX_ANGLE = 70 * Math.PI / 180;            // from vertical
const ITEM_SPEED = 0.006875, PROJ_SPEED = 0.04;
const BONUS_TIME = 10000;
const LIVES = 3;

const KIND_COLORS = { 2: '#2ca58b', 3: '#3fb7a0', 4: '#6ccf89', 5: '#a9dd5f' };
const KIND_POINTS = { 2: 1, 3: 2, 4: 3, 5: 4, 1: 5 };
const BONUSES = {
  racket:        { label: 'Racket XL',      color: '#c7a5ff' },
  defensivewall: { label: 'Defensive wall', color: '#5cc8ff' },
  multiball:     { label: 'Multiball',      color: '#ff9a63' },
  smash:         { label: 'Smash',          color: '#8eff9b' },
  powershot:     { label: 'Power shot',     color: '#ff6a6a' },
  heavyball:     { label: 'Heavy ball',     color: '#ffa7f0' },
};
const TUTORIAL_ORDER = ['racket', 'defensivewall', 'multiball', 'smash', 'powershot', 'heavyball'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------ audio */
const Sound = (() => {
  let ctx = null, enabled = true;
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } } if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx; };
  const tone = (freq, dur, type = 'sine', vol = 0.08, slide = 0) => {
    if (!enabled) return; const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  };
  return {
    unlock: ensure,
    setEnabled(v) { enabled = v; },
    paddle() { tone(220, 0.08, 'triangle', 0.12, 60); },
    wall()   { tone(160, 0.05, 'sine', 0.05); },
    brick(k) { tone(420 + k * 90, 0.09, 'square', 0.05, 120); },
    hard()   { tone(120, 0.08, 'sawtooth', 0.05); },
    pick()   { tone(660, 0.12, 'triangle', 0.09, 300); tone(990, 0.18, 'sine', 0.05, 200); },
    count(final) { tone(final ? 880 : 440, final ? 0.35 : 0.12, 'sine', 0.1); },
    lose()   { tone(200, 0.5, 'sawtooth', 0.09, -150); },
    clear()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.08), i * 90)); },
    shot()   { tone(1200, 0.05, 'square', 0.03, -600); },
  };
})();

/* ------------------------------------------------------------------ levels */
const LEVELS = window.LEVELS || [];
const OPENER = LEVELS.find(l => l.name === 'serve') || LEVELS[0];
const POOLS = { 1: [], 2: [], 3: [], 4: [] };
for (const l of LEVELS) if (l.diff >= 1 && l !== OPENER) POOLS[Math.min(4, l.diff)].push(l);
const used = new Set();
function pickLevel(finished) {
  const d = finished < 3 ? 1 : finished < 5 ? 2 : finished < 7 ? 3 : 4;
  let pool = POOLS[d].filter(l => !used.has(l.name));
  if (!pool.length) { POOLS[d].forEach(l => used.delete(l.name)); pool = POOLS[d].slice(); }
  const l = pool[Math.floor(Math.random() * pool.length)];
  used.add(l.name);
  return l;
}
function parseLevel(level) {
  const grid = [];
  level.rows.forEach((row, r) => row.split(' ').forEach((tok, c) => {
    if (tok === '0') return;
    const stack = tok.split('').map(Number);
    grid.push({ r, c, x: c * CELL, y: r * CELL, stack, hp: stack.length, id: 'b' + r + '_' + c, shake: 0, born: G.time });
  }));
  return grid;
}

/* ------------------------------------------------------------------ state */
const canvas = document.getElementById('court');
const $ = id => document.getElementById(id);
const el = {
  hud: $('hud'), lives: $('hud-lives'), level: $('hud-level'), score: $('hud-score'), tray: $('bonus-tray'),
  home: $('screen-home'), intro: $('screen-intro'), countdown: $('screen-countdown'), countNum: $('count-num'),
  pause: $('screen-pause'), results: $('screen-results'), best: $('best-score'),
  btnPause: $('btn-pause'), btnSound: $('btn-sound'),
};

const G = {
  state: 'HOME',            // HOME | INTRO | COUNTDOWN | RUNNING | LOSE_LIFE | LEVEL_DONE | PAUSED | GAME_OVER
  autoplay: true,
  time: 0, lastT: 0,
  score: 0, lives: LIVES, finished: 0, bricksBroken: 0, levelName: '',
  blocks: [], balls: [], items: [], projectiles: [], particles: [],
  paddle: { x: W / 2, y: PADDLE_Y, tx: W / 2, ty: PADDLE_Y, vx: 0, size: 1, sizeT: 1, held: false },
  bonuses: {},              // name -> expiry time
  drop: { tutorial: 0, deck: [], last: null, tSinceDrop: 0, tSincePick: 0, blocksSince: 0 },
  smash: { next: 0, side: 1 },
  shake: 0, flash: 0, flashColor: '#e00020', grey: 0,
  ai: { offset: 0, reactAt: 0, targetX: W / 2 },
  best: Number(localStorage.getItem('bb-best') || 0),
  timers: [],
};

function after(ms, fn) { G.timers.push({ at: G.time + ms, fn }); }
function clearTimers() { G.timers.length = 0; }
function runTimers() { for (let i = G.timers.length - 1; i >= 0; i--) if (G.time >= G.timers[i].at) { const t = G.timers.splice(i, 1)[0]; t.fn(); } }

/* ------------------------------------------------------------------ entities */
function makeBall(x, y, frozen = true) {
  return { x, y, dx: 0, dy: -1, r: BALL_R, frozen, visible: true, addVel: 0, history: [], bounceScore: 0, lockMult: G.balls.length % 2 ? -1 : 1, lastBottom: false, trail: [] };
}
function respawnBall() {
  G.balls = [makeBall(G.paddle.x, G.paddle.y - BALL_R - 0.1)];
}
function launchBall(b) { if (!b || !b.frozen) return; b.frozen = false; const t = rand(-0.5, 0.5); b.dx = Math.sin(t * 0.6); b.dy = -Math.cos(t * 0.6); }

function loadLevel(level) {
  G.blocks = parseLevel(level);
  G.levelName = level.name;
  G.items.length = 0; G.projectiles.length = 0;
  el.level.textContent = String(G.finished + 1);
}

/* ------------------------------------------------------------------ bonuses */
function activeBonus(name) { return (G.bonuses[name] || 0) > G.time; }
function anyActive() { return Object.keys(G.bonuses).some(activeBonus); }
function ballRadius() { return activeBonus('heavyball') ? BALL_R * 2 : BALL_R; }
function paddleTargetSize() { return activeBonus('racket') ? 1.7 : 1; }

function grantBonus(name) {
  Sound.pick();
  G.drop.tSincePick = 0;
  if (name === 'multiball') {
    if (G.balls.filter(b => b.visible).length >= 4) return;
    const nb = makeBall(G.paddle.x, G.paddle.y - ballRadius() - 0.1, true);
    nb.r = ballRadius(); G.balls.push(nb);
    after(500, () => launchBall(nb));
    G.bonuses[name] = G.time + 900; // brief pill only
    return;
  }
  G.bonuses[name] = G.time + BONUS_TIME;
  if (name === 'smash') { G.smash.next = G.time + 500; }
}

function nextDropName() {
  const d = G.drop;
  const activeBalls = G.balls.filter(b => b.visible).length;
  if (d.tutorial < TUTORIAL_ORDER.length) {
    let name = TUTORIAL_ORDER[d.tutorial];
    if (name === 'multiball' && activeBalls >= 2) { d.tutorial++; return nextDropName(); }
    d.tutorial++; return name;
  }
  if (!d.deck.length) {
    d.deck = Object.keys(BONUSES).sort(() => Math.random() - 0.5);
    if (d.deck[0] === d.last && d.deck.length > 1) d.deck.push(d.deck.shift());
  }
  let name = d.deck.shift();
  if (name === 'multiball' && activeBalls >= 2) { d.deck.push(name); if (d.deck.length > 1) name = d.deck.shift(); else return null; }
  return name;
}

function maybeDrop(block) {
  const d = G.drop;
  d.blocksSince++;
  if (G.items.length || G.state === 'HOME') return;
  if (d.tutorial < TUTORIAL_ORDER.length && anyActive()) return;
  const relax = ease01((d.tSincePick - 4000) / 4000);
  const pBlocks = lerp(ease01((d.blocksSince - 1) / 4), 1, relax);
  const p = ease01((d.tSinceDrop - 3000) / 3000) * ease01((d.tSincePick - 4000) / 4000) * pBlocks * lerp(0.95, 1, ease01((d.tSincePick - 8000) / 7000));
  if (Math.random() > p) return;
  const name = nextDropName(); if (!name) return;
  d.last = name; d.tSinceDrop = 0; d.blocksSince = 0;
  G.items.push({ name, x: block.x + CELL / 2, y: block.y + CELL / 2, spin: 0 });
}

/* ------------------------------------------------------------------ scoring / blocks */
function addScore(n) {
  G.score += n; el.score.textContent = G.score;
  el.score.classList.add('bump'); setTimeout(() => el.score.classList.remove('bump'), 120);
}
function burst(x, y, color, n = 10, speed = 0.006) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(300, 650), t: 0, color, size: rand(0.03, 0.08) });
  }
}
function hitBlock(block, { force = false, byBall = null } = {}) {
  const top = block.stack[block.stack.length - 1];
  if (top === 1 && !force) { block.shake = 1; Sound.hard(); return false; }
  block.stack.pop();
  const kind = top === 1 ? 1 : top;
  const mult = byBall && activeBonus('heavyball') ? 2 : 1;
  if (G.state !== 'HOME') addScore(KIND_POINTS[kind] * mult);
  burst(block.x + CELL / 2, block.y + CELL / 2, top === 1 ? '#8aa79c' : KIND_COLORS[top] || '#fff', 8);
  Sound.brick(kind);
  G.bricksBroken++;
  if (!block.stack.length) {
    G.blocks.splice(G.blocks.indexOf(block), 1);
    burst(block.x + CELL / 2, block.y + CELL / 2, '#ece8d6', 6, 0.004);
  }
  if (top !== 1) maybeDrop(block);
  if (G.state === 'RUNNING' && !G.blocks.some(b => b.stack.some(k => k !== 1))) levelFinished();
  return true;
}

/* ------------------------------------------------------------------ physics */
function levelSpeed() {
  const n = G.finished;
  return BASE_SPEED + 4.025e-4 * Math.min(n, 3) + 5.175e-4 * clamp(n - 3, 0, 2) + 6.325e-4 * clamp(n - 5, 0, 2) + 7.475e-4 * Math.max(0, n - 7);
}
function clampAngle(b) {
  const len = Math.hypot(b.dx, b.dy) || 1; b.dx /= len; b.dy /= len;
  const maxX = Math.sin(MAX_ANGLE);
  if (Math.abs(b.dx) > maxX) { const s = Math.sign(b.dy) || -1; b.dx = Math.sign(b.dx) * maxX; b.dy = s * Math.cos(MAX_ANGLE); }
}
function rotate(b, deg) { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = b.dx, y = b.dy; b.dx = x * c - y * s; b.dy = x * s + y * c; }
function noteHit(b, id) {
  const h = b.history;
  if (id !== h[0] && (id === h[1] || id === h[2] || id === h[3])) {
    b.bounceScore += (id === 'paddle' || h[0] === 'paddle') ? 0.5 : 2;
    rotate(b, Math.min(10, b.bounceScore + 1) * b.lockMult);
  } else if (id !== h[0]) b.bounceScore = 0;
  if (id !== h[0]) b.addVel *= 0.6;
  h.unshift(id); if (h.length > 4) h.pop();
}

function stepBall(b, dt) {
  if (b.frozen) { b.x = G.paddle.x; b.y = G.paddle.y - b.r - 0.1; return; }
  const bigSlow = b.r / CELL > 0.75 ? 0.825 : b.r / CELL > 0.6 ? 0.9 : 1;
  const speed = (levelSpeed() + b.addVel) * bigSlow;
  let remaining = speed * dt;
  const stepLen = b.r * 0.5;
  const P = G.paddle, halfW = PADDLE_HALF * P.size + Math.min(0.3, Math.abs(P.vx) * 8);
  const pTop = P.y - 0.1, pBot = P.y + 0.1;
  let guard = 12;
  while (remaining > 0 && guard-- > 0) {
    const s = Math.min(stepLen, remaining); remaining -= s;
    b.x += b.dx * s; b.y += b.dy * s;
    // side / far walls
    if (b.x < b.r) { b.x = b.r; b.dx = Math.abs(b.dx); noteHit(b, 'wl'); Sound.wall(); }
    if (b.x > W - b.r) { b.x = W - b.r; b.dx = -Math.abs(b.dx); noteHit(b, 'wr'); Sound.wall(); }
    if (b.y < b.r) { b.y = b.r; b.dy = Math.abs(b.dy); noteHit(b, 'wt'); Sound.wall(); }
    // baseline
    if (b.y > LOSE_Y - b.r) {
      if (activeBonus('defensivewall') || G.autoplay) { b.y = LOSE_Y - b.r; b.dy = -Math.abs(b.dy); noteHit(b, 'wb'); Sound.wall(); burst(b.x, LOSE_Y, BONUSES.defensivewall.color, 5, 0.003); }
      else { b.visible = false; return; }
    }
    // paddle
    if (b.dy > 0 && b.y + b.r > pTop && b.y - b.r < pBot && b.x > P.x - halfW - b.r && b.x < P.x + halfW + b.r && b.history[0] !== 'paddle') {
      b.y = pTop - b.r;
      const d = clamp((P.x - b.x) / halfW, -1, 1);
      const a = 45 * Math.PI / 180 * d;
      b.dx = -Math.sin(a); b.dy = -Math.cos(a);
      b.dx += clamp(P.vx * 30, -0.6, 0.6);
      b.dy = -Math.abs(b.dy);
      b.addVel = Math.min(0.02, Math.abs(P.vx) * 0.8);
      clampAngle(b); noteHit(b, 'paddle'); Sound.paddle();
      burst(b.x, pTop, '#ece8d6', 4, 0.003);
      continue;
    }
    // blocks
    if (b.y - b.r < ROWS * CELL) {
      const c0 = clamp(Math.floor((b.x - b.r) / CELL), 0, COLS - 1), c1 = clamp(Math.floor((b.x + b.r) / CELL), 0, COLS - 1);
      const r0 = clamp(Math.floor((b.y - b.r) / CELL), 0, ROWS - 1), r1 = clamp(Math.floor((b.y + b.r) / CELL), 0, ROWS - 1);
      let best = null, bestPen = 0;
      for (const bl of G.blocks) {
        if (bl.c < c0 || bl.c > c1 || bl.r < r0 || bl.r > r1) continue;
        const cx = clamp(b.x, bl.x, bl.x + CELL), cy = clamp(b.y, bl.y, bl.y + CELL);
        const ddx = b.x - cx, ddy = b.y - cy, d2 = ddx * ddx + ddy * ddy;
        if (d2 < b.r * b.r) { const pen = b.r - Math.sqrt(d2); if (pen > bestPen) { bestPen = pen; best = bl; } }
      }
      if (best) {
        const power = activeBonus('powershot');
        if (power) {
          if (b.history[0] !== best.id) { hitBlock(best, { force: true, byBall: b }); noteHit(b, best.id); }
        } else {
          // resolve on the axis of least overlap
          const cx = best.x + CELL / 2, cy = best.y + CELL / 2;
          const ox = (CELL / 2 + b.r) - Math.abs(b.x - cx), oy = (CELL / 2 + b.r) - Math.abs(b.y - cy);
          if (ox < oy) { b.dx = Math.sign(b.x - cx || b.dx) * Math.abs(b.dx); b.x += Math.sign(b.x - cx || 1) * ox; }
          else { b.dy = Math.sign(b.y - cy || -b.dy) * Math.abs(b.dy); b.y += Math.sign(b.y - cy || -1) * oy; }
          clampAngle(b); noteHit(b, best.id);
          hitBlock(best, { byBall: b });
          if (G.state !== 'RUNNING' && !G.autoplay) return;
        }
      }
    }
  }
}

function stepPaddle(dt) {
  const P = G.paddle;
  const px = P.x;
  const ease = 1 - Math.pow(1 - (P.held ? 0.45 : 0.3), dt / 16.67);
  if (G.autoplay) aiThink();
  P.x = lerp(P.x, P.tx, ease);
  P.y = lerp(P.y, P.ty, ease);
  P.sizeT = paddleTargetSize();
  P.size = lerp(P.size, P.sizeT, 1 - Math.pow(0.9, dt / 16.67));
  const half = PADDLE_HALF * P.size;
  P.x = clamp(P.x, half, W - half);
  P.vx = lerp(P.vx, (P.x - px) / Math.max(1, dt), 0.5);
}

function aiThink() {
  const P = G.paddle, b = G.balls.find(x => x.visible && !x.frozen);
  if (!b) { P.tx = W / 2; return; }
  if (G.time >= G.ai.reactAt) {
    G.ai.reactAt = G.time + 300;
    G.ai.offset = rand(-0.2, 0.2) * PADDLE_HALF * 2 * P.size;
    G.ai.targetX = b.dy > 0 ? b.x + G.ai.offset : lerp(b.x, W / 2, 0.4);
  }
  P.tx = G.ai.targetX;
}

function stepItems(dt) {
  const P = G.paddle, half = PADDLE_HALF * P.size;
  for (let i = G.items.length - 1; i >= 0; i--) {
    const it = G.items[i];
    it.y += ITEM_SPEED * dt; it.spin += dt * 0.002;
    if (Math.abs(it.x - P.x) < half + 0.25 && Math.abs(it.y - P.y) < 0.15 + 0.1) {
      G.items.splice(i, 1); burst(it.x, it.y, BONUSES[it.name].color, 14, 0.005); grantBonus(it.name); continue;
    }
    if (it.y > LOSE_Y + 1) G.items.splice(i, 1);
  }
}

function stepSmash(dt) {
  if (!activeBonus('smash')) return;
  const P = G.paddle;
  if (G.time >= G.smash.next) {
    G.smash.next = G.time + 500;
    G.smash.side *= -1;
    G.projectiles.push({ x: P.x + G.smash.side * 0.8 * P.size, y: P.y - 0.15, fireAt: G.time + 600, armed: true });
  }
}
function stepProjectiles(dt) {
  const P = G.paddle;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    if (p.armed) {
      p.x = P.x + Math.sign(p.x - P.x || 1) * 0.8 * P.size; p.y = P.y - 0.15;
      if (G.time >= p.fireAt) { p.armed = false; Sound.shot(); }
      continue;
    }
    p.y -= PROJ_SPEED * dt;
    if (p.y < 0) { G.projectiles.splice(i, 1); continue; }
    const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
    const hit = G.blocks.find(b => b.c === c && b.r === r);
    if (hit) { hitBlock(hit, { force: true }); burst(p.x, p.y, BONUSES.smash.color, 8, 0.005); G.projectiles.splice(i, 1); }
  }
}

function stepParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i]; p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= 0.98;
    if (p.t > p.life) G.particles.splice(i, 1);
  }
  for (const b of G.blocks) b.shake = Math.max(0, b.shake - dt / 250);
}

/* ------------------------------------------------------------------ game flow */
function showScreen(name) {
  for (const k of ['home', 'intro', 'countdown', 'pause', 'results']) el[k].hidden = k !== name;
}
function updateLivesHud() {
  el.lives.innerHTML = '';
  for (let i = 0; i < LIVES; i++) { const dot = document.createElement('i'); if (i >= G.lives) dot.classList.add('lost'); el.lives.appendChild(dot); }
}

function startDemo() {
  G.autoplay = true; G.state = 'HOME'; G.finished = 0; G.bonuses = {};
  clearTimers();
  const pool = [OPENER, ...POOLS[1], ...POOLS[2]].filter(Boolean);
  loadLevel(pool[Math.floor(Math.random() * pool.length)]);
  G.paddle.tx = W / 2; G.paddle.ty = PADDLE_Y; G.paddle.size = 1;
  respawnBall(); after(600, () => launchBall(G.balls[0]));
  el.hud.hidden = true; el.tray.hidden = true; el.btnPause.hidden = true;
  if (G.best) { el.best.hidden = false; el.best.textContent = 'Best ' + G.best; }
  showScreen('home');
}

function startGame() {
  G.autoplay = false; G.score = 0; G.lives = LIVES; G.finished = 0; G.bricksBroken = 0;
  G.bonuses = {}; G.drop = { tutorial: 0, deck: [], last: null, tSinceDrop: 0, tSincePick: 0, blocksSince: 0 };
  G.items.length = 0; G.projectiles.length = 0; G.particles.length = 0; G.grey = 0; used.clear();
  clearTimers();
  el.score.textContent = '0'; updateLivesHud();
  el.hud.hidden = false; el.tray.hidden = false; el.btnPause.hidden = false;
  G.paddle.tx = W / 2; G.paddle.x = W / 2; G.paddle.ty = PADDLE_Y; G.paddle.size = 1;
  loadLevel(OPENER);
  respawnBall();
  countdown(1000);
}

function countdown(perNum) {
  G.state = 'COUNTDOWN'; showScreen('countdown');
  let n = 3;
  const tick = () => {
    if (G.state !== 'COUNTDOWN') return;
    el.countNum.textContent = String(n);
    el.countNum.style.animation = 'none'; void el.countNum.offsetWidth; el.countNum.style.animation = '';
    Sound.count(n === 1);
    n--;
    if (n >= 0) after(perNum, tick);
  };
  after(400, tick);
  after(400 + perNum * 3, () => {
    if (G.state !== 'COUNTDOWN') return;
    showScreen(null); G.state = 'RUNNING';
    after(100, () => launchBall(G.balls[0]));
  });
}

function loseLife() {
  G.state = 'LOSE_LIFE';
  G.lives--; updateLivesHud();
  G.shake = 1; G.flash = 1; G.flashColor = '#e00020';
  G.bonuses = {}; G.items.length = 0; G.projectiles.length = 0;
  Sound.lose();
  after(900, () => {
    if (G.lives > 0) { respawnBall(); countdown(700); }
    else gameOver();
  });
}

function levelFinished() {
  G.state = 'LEVEL_DONE';
  const level = LEVELS.find(l => l.name === G.levelName);
  addScore(Math.floor(10 + 7 * ((level ? level.diff : 1) - 1) + 4 * G.finished));
  G.finished++;
  G.flash = 0.6; G.flashColor = '#dcef3f';
  Sound.clear();
  for (const b of G.balls) b.frozen = true;
  after(400, () => {
    loadLevel(pickLevel(G.finished));
    respawnBall();
    after(1100, () => { if (G.state === 'LEVEL_DONE') { G.state = 'RUNNING'; launchBall(G.balls[0]); } });
  });
}

function gameOver() {
  G.state = 'GAME_OVER'; G.grey = 1;
  if (G.score > G.best) { G.best = G.score; localStorage.setItem('bb-best', String(G.best)); }
  after(1000, () => {
    $('res-score').textContent = G.score; $('res-levels').textContent = G.finished;
    $('res-bricks').textContent = G.bricksBroken; $('res-best').textContent = G.best;
    $('results-headline').textContent = G.finished >= 8 ? 'Champion form.' : G.finished >= 4 ? 'Strong rally.' : 'Game, set, match.';
    el.btnPause.hidden = true;
    showScreen('results');
  });
}

function pauseGame() {
  if (G.state !== 'RUNNING' && G.state !== 'COUNTDOWN') return;
  G.prevState = G.state; G.state = 'PAUSED'; showScreen('pause');
}
function resumeGame() {
  if (G.state !== 'PAUSED') return;
  showScreen(null);
  G.state = 'RUNNING';
  respawnBall(); countdown(700);
}

/* ------------------------------------------------------------------ bonus tray */
function renderTray() {
  const active = Object.entries(G.bonuses).filter(([, t]) => t > G.time);
  const keep = new Set();
  for (const [name, exp] of active) {
    keep.add(name);
    let pill = el.tray.querySelector('[data-b="' + name + '"]');
    if (!pill) {
      pill = document.createElement('div'); pill.className = 'bonus-pill'; pill.dataset.b = name;
      pill.style.setProperty('--c', BONUSES[name].color);
      pill.innerHTML = '<span class="dot"></span><span>' + BONUSES[name].label + '</span><span class="bar"><i></i></span>';
      el.tray.appendChild(pill);
    }
    const total = name === 'multiball' ? 900 : BONUS_TIME;
    pill.querySelector('.bar i').style.transform = 'scaleX(' + clamp((exp - G.time) / total, 0, 1) + ')';
  }
  for (const pill of [...el.tray.children]) if (!keep.has(pill.dataset.b)) pill.remove();
}

/* ------------------------------------------------------------------ render (three.js) */
const R3 = window.Render3D;
R3.init(canvas, { W, H, CELL, ROWS, PADDLE_HALF, BONUSES, KIND_COLORS, activeBonus });
window.addEventListener('resize', () => R3.resize());
const flashEl = document.getElementById('flash');
function render() {
  R3.render(G);
  if (flashEl) { flashEl.style.opacity = G.flash > 0 ? String(G.flash * 0.45) : '0'; flashEl.style.background = G.flashColor; }
}

/* ------------------------------------------------------------------ main loop */
function update(dt) {
  G.time += dt;
  runTimers();
  const sim = G.state === 'RUNNING' || G.state === 'HOME';
  stepPaddle(dt);
  if (sim) {
    G.drop.tSinceDrop += dt; G.drop.tSincePick += dt;
    for (const b of G.balls) {
      if (!b.visible) continue;
      b.r = activeBonus('heavyball') ? BALL_R * 2 : BALL_R;
      if (!b.frozen) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 6) b.trail.shift(); }
      stepBall(b, dt);
    }
    const alive = G.balls.filter(b => b.visible);
    if (G.state === 'RUNNING' && !alive.length) loseLife();
    else if (alive.length < G.balls.length) G.balls = alive;
    if (G.state === 'HOME' && !alive.length) { respawnBall(); after(500, () => launchBall(G.balls[0])); }
    stepItems(dt); stepSmash(dt); stepProjectiles(dt);
  } else if (G.state === 'COUNTDOWN' || G.state === 'LEVEL_DONE' || G.state === 'LOSE_LIFE') {
    for (const b of G.balls) if (b.frozen) stepBall(b, dt);
  }
  stepParticles(dt);
  G.shake = Math.max(0, G.shake - dt / 450); G.flash = Math.max(0, G.flash - dt / 500);
  if (G.state !== 'GAME_OVER') G.grey = Math.max(0, G.grey - dt / 400);
  if (!el.tray.hidden) renderTray();
}
function frame(t) {
  const dt = Math.min(34, G.lastT ? t - G.lastT : 16); G.lastT = t;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ input */
function pointerToWorld(e) { return R3.pointerToGround(e.clientX, e.clientY) || { x: G.paddle.tx, y: G.paddle.ty }; }
canvas.addEventListener('pointerdown', e => {
  Sound.unlock();
  if (G.autoplay) return;
  G.paddle.held = true; canvas.classList.add('held'); canvas.setPointerCapture(e.pointerId);
  const p = pointerToWorld(e); G.paddle.tx = p.x;
});
canvas.addEventListener('pointermove', e => {
  if (!G.paddle.held || G.autoplay) return;
  const p = pointerToWorld(e); G.paddle.tx = p.x;
});
const release = () => { G.paddle.held = false; canvas.classList.remove('held'); };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
window.addEventListener('blur', release);

const keys = {};
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyK', 'Space', 'Escape', 'KeyP'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.state === 'PAUSED') resumeGame(); else pauseGame(); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
setInterval(() => {
  if (G.autoplay || G.state !== 'RUNNING') return;
  const P = G.paddle;
  const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  if (dir) P.tx = clamp((P.held ? P.tx : P.x) + dir * 0.012 * 16, 0, W);
  P.ty = (keys.ArrowUp || keys.KeyK) ? PADDLE_MIN_Y : PADDLE_Y;
}, 16);

$('btn-play').addEventListener('click', () => { Sound.unlock(); G.state = 'INTRO'; showScreen('intro'); });
$('btn-start').addEventListener('click', () => { Sound.unlock(); startGame(); });
$('btn-again').addEventListener('click', () => { startGame(); });
$('btn-home').addEventListener('click', () => { startDemo(); });
$('btn-resume').addEventListener('click', resumeGame);
$('btn-quit').addEventListener('click', () => { startDemo(); });
el.btnPause.addEventListener('click', () => { if (G.state === 'PAUSED') resumeGame(); else pauseGame(); });
el.btnSound.addEventListener('click', () => {
  const on = el.btnSound.getAttribute('aria-pressed') !== 'true';
  el.btnSound.setAttribute('aria-pressed', String(on)); el.btnSound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  Sound.setEnabled(on); localStorage.setItem('bb-sound', on ? '1' : '0');
});
if (localStorage.getItem('bb-sound') === '0') { el.btnSound.setAttribute('aria-pressed', 'false'); Sound.setEnabled(false); }
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

window.__bb = G; // debug handle (autoplay toggle, state inspection)
G.simulate = ms => { for (let t = 0; t < ms; t += 16) update(16); render(); };
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { const h = document.querySelector('.count-hint'); if (h) h.innerHTML = 'Touch &amp; hold<br>to move'; }
startDemo();
requestAnimationFrame(frame);
})();
