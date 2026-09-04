/* Baseline Breaker — three.js renderer.
   Game space: x across the court (0..W), y depth (0 = far wall, H = baseline).
   World space: x = game x, z = game y, up = +y. */
window.Render3D = (() => {
'use strict';
const T = window.THREE;
let renderer, scene, camera, ground, baseline, farWall, blocksMesh, paddle, paddleCaps, ballGroup, itemGroup, projGroup, particles, ballLight;
let ctxRef = null, W = 6.5, H = 12, CELL = 0.5, ROWS = 11;
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const Q = { tier: coarse ? 1 : 2, frames: 0, slow: 0, t0: 0 };  // 2 = full, 1 = mobile, 0 = lite
let sun, debris = [], debrisGeo, kick = 0, clearAnim = 0;
const tmpM = new T.Matrix4(), tmpP = new T.Vector3(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpC = new T.Color();
const raycaster = new T.Raycaster(), groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), ndc = new T.Vector2();
const MAX_CUBES = 13 * 11 * 4, MAX_PARTICLES = 800;
const camBase = { look: new T.Vector3(), dir: new T.Vector3(), dist: 16 };
let glowTex, ringTex;
const ballMeshes = [], itemMeshes = new Map(), projMeshes = [], trailMeshes = [];

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new T.CanvasTexture(c); return t;
}
function makeCourtTexture() {
  const px = 160, c = document.createElement('canvas'); c.width = W * px; c.height = H * px;
  const g = c.getContext('2d');
  g.fillStyle = '#b0461f'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#a33f1b'; g.fillRect(0, ROWS * CELL * px, c.width, c.height - ROWS * CELL * px);
  // subtle clay-dust noise
  for (let i = 0; i < 14000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,220,180,' + (Math.random() * 0.09) + ')' : 'rgba(80,20,0,' + (Math.random() * 0.12) + ')'; const r = 1 + Math.random() * 3; g.fillRect(Math.random() * c.width, Math.random() * c.height, r, r); }
  g.strokeStyle = 'rgba(245,242,230,0.92)'; g.lineWidth = 7; g.lineCap = 'square';
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.beginPath();
  g.moveTo(0.6 * px, 0); g.lineTo(0.6 * px, c.height); g.moveTo((W - 0.6) * px, 0); g.lineTo((W - 0.6) * px, c.height);
  g.moveTo(0.6 * px, (ROWS * CELL + 1) * px); g.lineTo((W - 0.6) * px, (ROWS * CELL + 1) * px);
  g.moveTo(W / 2 * px, (ROWS * CELL + 1) * px); g.lineTo(W / 2 * px, c.height);
  g.stroke();
  g.setLineDash([18, 12]); g.strokeStyle = 'rgba(245,242,230,0.5)';
  g.beginPath(); g.moveTo(0, ROWS * CELL * px); g.lineTo(c.width, ROWS * CELL * px); g.stroke();
  const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
}

function init(canvas, ctx) {
  ctxRef = ctx; W = ctx.W; H = ctx.H; CELL = ctx.CELL; ROWS = ctx.ROWS;
  renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(Q.tier === 2 ? 2 : 1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = Q.tier === 2 ? T.PCFSoftShadowMap : T.PCFShadowMap;
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;

  scene = new T.Scene();
  scene.fog = new T.Fog(0x08130d, 30, 70);
  camera = new T.PerspectiveCamera(52, 1, 0.1, 200);
  camBase.look.set(W / 2, 0.15, 4.4);
  camBase.dir.set(0, 0.40, 1).normalize();

  glowTex = makeGlowTexture();

  // lights
  scene.add(new T.HemisphereLight(0xb9d3c2, 0x2a1208, 0.42));
  sun = new T.DirectionalLight(0xfff1cc, 1.15);
  sun.position.set(W / 2 + 3, 12, 9); sun.target.position.set(W / 2, 0, 5); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(Q.tier === 2 ? 2048 : 1024, Q.tier === 2 ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 12, bottom: -12, near: 1, far: 50 });
  sun.shadow.bias = -0.0008; scene.add(sun);
  const rim = new T.PointLight(0x5cc8ff, 0.5, 20); rim.position.set(W / 2, 4, -2); scene.add(rim);

  // ground + surroundings
  ground = new T.Mesh(new T.PlaneGeometry(W, H), new T.MeshStandardMaterial({ map: makeCourtTexture(), roughness: 0.92, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true; scene.add(ground);
  const apron = new T.Mesh(new T.PlaneGeometry(60, 80), new T.MeshStandardMaterial({ color: 0x08170f, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(W / 2, -0.01, H / 2); apron.receiveShadow = true; scene.add(apron);
  const wallMat = new T.MeshStandardMaterial({ color: 0x1b3a2a, roughness: 0.6, emissive: 0x0e2418, emissiveIntensity: 0.6 });
  const mkWall = (w, h, d, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  mkWall(0.16, 0.5, H + 0.16, -0.08, 0.25, H / 2); mkWall(0.16, 0.5, H + 0.16, W + 0.08, 0.25, H / 2);
  farWall = mkWall(W + 0.32, 0.7, 0.16, W / 2, 0.35, -0.08);
  baseline = new T.Mesh(new T.BoxGeometry(W, 0.06, 0.08), new T.MeshBasicMaterial({ color: 0xece8d6, transparent: true, opacity: 0.55 }));
  baseline.position.set(W / 2, 0.03, H - 0.02); scene.add(baseline);

  // blocks (instanced cubes)
  const cubeGeo = new T.BoxGeometry(CELL - 0.07, 0.34, CELL - 0.07);
  blocksMesh = new T.InstancedMesh(cubeGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.05 }), MAX_CUBES);
  blocksMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAX_CUBES * 3).fill(1), 3); // r128 allocates this lazily from `count`, which is 0 at first draw
  blocksMesh.castShadow = true; blocksMesh.receiveShadow = true; blocksMesh.count = 0; blocksMesh.frustumCulled = false; scene.add(blocksMesh);

  // paddle
  paddle = new T.Group();
  const padMat = new T.MeshStandardMaterial({ color: 0xece8d6, roughness: 0.35, metalness: 0.1, emissive: 0x222016, emissiveIntensity: 0.4 });
  const bar = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 1, 20), padMat); bar.rotation.z = Math.PI / 2; bar.castShadow = true;
  paddleCaps = [new T.Mesh(new T.SphereGeometry(0.13, 16, 12), padMat), new T.Mesh(new T.SphereGeometry(0.13, 16, 12), padMat)];
  paddleCaps.forEach(c => { c.castShadow = true; paddle.add(c); });
  paddle.add(bar); paddle.userData = { bar, mat: padMat }; scene.add(paddle);
  const ring = new T.Mesh(new T.RingGeometry(0.34, 0.38, 40), new T.MeshBasicMaterial({ color: 0xece8d6, transparent: true, opacity: 0.4, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; ring.visible = false; paddle.add(ring); paddle.userData.ring = ring;

  ballGroup = new T.Group(); scene.add(ballGroup);
  ballLight = new T.PointLight(0xdcef3f, 0.9, 6); scene.add(ballLight);
  itemGroup = new T.Group(); scene.add(itemGroup);
  projGroup = new T.Group(); scene.add(projGroup);

  // particles
  const pg = new T.BufferGeometry();
  pg.setAttribute('position', new T.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  pg.setAttribute('color', new T.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  particles = new T.Points(pg, new T.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, map: glowTex }));
  particles.frustumCulled = false; scene.add(particles);

  debrisGeo = new T.BoxGeometry(0.12, 0.09, 0.12);
  buildStadium();
  resize();
}
function setTier(t) {
  if (t === Q.tier) return; Q.tier = t;
  renderer.shadowMap.enabled = t > 0; sun.castShadow = t > 0;
  renderer.setPixelRatio(Math.min(t === 2 ? 2 : t === 1 ? 1.5 : 1, window.devicePixelRatio || 1));
  scene.traverse(o => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  resize();
}
function autoQuality(dt) {
  // drop a tier if frames stay slow; never climbs back on its own (avoids flicker)
  Q.frames++; if (dt > 24) Q.slow++;
  if (Q.frames >= 120) { if (Q.slow > 45 && Q.tier > 0) setTier(Q.tier - 1); Q.frames = 0; Q.slow = 0; }
}

function buildStadium() {
  // apron of darker clay around the court, then stands rising on three sides
  const apronMat = new T.MeshStandardMaterial({ color: 0x6f2e16, roughness: 1 });
  const apron = new T.Mesh(new T.PlaneGeometry(W + 6, H + 8), apronMat);
  apron.rotation.x = -Math.PI / 2; apron.position.set(W / 2, -0.005, H / 2 + 1); apron.receiveShadow = true; scene.add(apron);

  const boardMat = new T.MeshStandardMaterial({ color: 0x0f3b2a, roughness: 0.55, emissive: 0x0a2a1d, emissiveIntensity: 0.5 });
  const stripeMat = new T.MeshStandardMaterial({ color: 0xece8d6, roughness: 0.6, emissive: 0x6b6858, emissiveIntensity: 0.25 });
  const accentMat = new T.MeshStandardMaterial({ color: 0xdcef3f, roughness: 0.5, emissive: 0xdcef3f, emissiveIntensity: 0.35 });
  const box = (geo, mat, x, y, z, rx = 0, ry = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };

  // sponsor-style boards along the sides and the far end
  const sideLen = H + 4, farLen = W + 8;
  box(new T.BoxGeometry(0.12, 0.9, sideLen), boardMat, -2.2, 0.45, H / 2 + 1);
  box(new T.BoxGeometry(0.12, 0.9, sideLen), boardMat, W + 2.2, 0.45, H / 2 + 1);
  box(new T.BoxGeometry(farLen, 0.9, 0.12), boardMat, W / 2, 0.45, -3);
  box(new T.BoxGeometry(0.14, 0.12, sideLen), stripeMat, -2.2, 0.62, H / 2 + 1);
  box(new T.BoxGeometry(0.14, 0.12, sideLen), stripeMat, W + 2.2, 0.62, H / 2 + 1);
  box(new T.BoxGeometry(farLen, 0.12, 0.14), stripeMat, W / 2, 0.62, -3);
  box(new T.BoxGeometry(farLen, 0.12, 0.14), accentMat, W / 2, 0.3, -3);
  for (let i = 0; i < 5; i++) { box(new T.BoxGeometry(0.14, 0.12, 1.2), accentMat, -2.2, 0.3, 1.5 + i * 3.2); box(new T.BoxGeometry(0.14, 0.12, 1.2), accentMat, W + 2.2, 0.3, 1.5 + i * 3.2); }

  // tiered stands, textured with a speckled crowd pattern
  const crowd = document.createElement('canvas'); crowd.width = 256; crowd.height = 64;
  const cg = crowd.getContext('2d'); cg.fillStyle = '#12261c'; cg.fillRect(0, 0, 256, 64);
  const tints = ['#2a4a3a', '#d8d2b8', '#dcef3f', '#c4572a', '#3d7a63', '#8aa79c', '#1b3a2a'];
  for (let i = 0; i < 900; i++) { cg.fillStyle = tints[(Math.random() * tints.length) | 0]; cg.globalAlpha = 0.35 + Math.random() * 0.5; cg.beginPath(); cg.arc(Math.random() * 256, Math.random() * 64, 1.2 + Math.random() * 1.6, 0, 7); cg.fill(); }
  const crowdTex = new T.CanvasTexture(crowd); crowdTex.wrapS = crowdTex.wrapT = T.RepeatWrapping;
  const tierMat = (rep) => { const t = crowdTex.clone(); t.needsUpdate = true; t.repeat.set(rep, 1); return new T.MeshStandardMaterial({ map: t, roughness: 1, color: 0x8a9a8c }); };
  const riserMat = new T.MeshStandardMaterial({ color: 0x0b1a12, roughness: 1 });
  const tiers = 6, step = 0.9, rise = 0.55;
  for (let i = 0; i < tiers; i++) {
    const d = 2.6 + i * step, y = i * rise;
    const zc = H / 2 + 1, sideLenT = H + 8 + i * 2 * step;
    // side tiers
    const l = box(new T.BoxGeometry(step, rise, sideLenT), riserMat, -d - step / 2, y + rise / 2, zc);
    const r = box(new T.BoxGeometry(step, rise, sideLenT), riserMat, W + d + step / 2, y + rise / 2, zc);
    const lt = new T.Mesh(new T.PlaneGeometry(sideLenT, step), tierMat(sideLenT / 2)); lt.rotation.set(-Math.PI / 2, 0, Math.PI / 2); lt.position.set(-d - step / 2, y + rise + 0.005, zc); scene.add(lt);
    const rt = new T.Mesh(new T.PlaneGeometry(sideLenT, step), tierMat(sideLenT / 2)); rt.rotation.set(-Math.PI / 2, 0, Math.PI / 2); rt.position.set(W + d + step / 2, y + rise + 0.005, zc); scene.add(rt);
    // far tier
    const fz = -3.4 - i * step, farLenT = W + 2 * d;
    box(new T.BoxGeometry(farLenT, rise, step), riserMat, W / 2, y + rise / 2, fz - step / 2);
    const ft = new T.Mesh(new T.PlaneGeometry(farLenT, step), tierMat(farLenT / 2)); ft.rotation.x = -Math.PI / 2; ft.position.set(W / 2, y + rise + 0.005, fz - step / 2); scene.add(ft);
    l.castShadow = r.castShadow = false;
  }
  // back wall behind the top tier
  const wallH = 2.2, topY = tiers * rise;
  const backMat = new T.MeshStandardMaterial({ color: 0x0a1810, roughness: 1 });
  box(new T.BoxGeometry(W + 2 * (2.6 + tiers * step) + 2, wallH, 0.3), backMat, W / 2, topY + wallH / 2, -3.4 - tiers * step - 0.15);
  box(new T.BoxGeometry(0.3, wallH, H + 8 + tiers * 2 * step), backMat, -(2.6 + tiers * step) - 0.15, topY + wallH / 2, H / 2 + 1);
  box(new T.BoxGeometry(0.3, wallH, H + 8 + tiers * 2 * step), backMat, W + 2.6 + tiers * step + 0.15, topY + wallH / 2, H / 2 + 1);

  // floodlight masts with glow
  const mastMat = new T.MeshStandardMaterial({ color: 0x1c2a22, roughness: 0.7, metalness: 0.3 });
  const lampMat = new T.MeshBasicMaterial({ color: 0xfff6d5 });
  const masts = [[-4.5, -5], [W + 4.5, -5], [-4.5, H + 4], [W + 4.5, H + 4]];
  for (const [x, z] of masts) {
    box(new T.CylinderGeometry(0.08, 0.12, 9, 10), mastMat, x, 4.5, z).castShadow = false;
    const head = box(new T.BoxGeometry(1.4, 0.5, 0.25), lampMat, x, 9.2, z, 0.35, x < 0 ? 0.5 : -0.5); head.castShadow = false;
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff1c0, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }));
    glow.scale.set(4, 4, 1); glow.position.set(x, 9.2, z); scene.add(glow);
  }

  // sky haze dome
  const skyGeo = new T.SphereGeometry(90, 24, 12);
  const cols = new Float32Array(skyGeo.attributes.position.count * 3);
  const top = new T.Color(0x030806), bot = new T.Color(0x0d2418);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) { const y = skyGeo.attributes.position.getY(i) / 90; const c = bot.clone().lerp(top, Math.max(0, y)); cols.set([c.r, c.g, c.b], i * 3); }
  skyGeo.setAttribute('color', new T.BufferAttribute(cols, 3));
  const sky = new T.Mesh(skyGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false }));
  sky.position.set(W / 2, 0, H / 2); scene.add(sky);
}

function fitCamera() {
  const cw = renderer.domElement.clientWidth || 1, ch = renderer.domElement.clientHeight || 1;
  camera.aspect = cw / ch; camera.updateProjectionMatrix();
  const corners = [[0, 0, 0], [W, 0, 0], [0, 0, H - 0.4], [W, 0, H - 0.4], [0, 1.2, 0], [W, 1.2, 0]].map(a => new T.Vector3(...a));
  const topLimit = 0.6, sideLimit = 0.98, bottomLimit = -1.0;
  let lo = 6, hi = 60;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    camera.position.copy(camBase.look).addScaledVector(camBase.dir, mid); camera.lookAt(camBase.look); camera.updateMatrixWorld();
    let ok = true;
    for (const c of corners) { const p = c.clone().project(camera); if (Math.abs(p.x) > sideLimit || p.y > topLimit || p.y < bottomLimit) { ok = false; break; } }
    if (ok) hi = mid; else lo = mid;
  }
  camBase.dist = hi;
  camera.position.copy(camBase.look).addScaledVector(camBase.dir, hi); camera.lookAt(camBase.look);
}
function resize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera();
}

function project(x, y, z) {
  if (!camera) return null;
  const v = new T.Vector3(x, y, z).project(camera);
  if (v.z > 1) return null;
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}
function pointerToGround(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = new T.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) return { x: hit.x, y: hit.z };
  return null;
}

function ensureBall(i) {
  if (ballMeshes[i]) return ballMeshes[i];
  const m = new T.Mesh(new T.SphereGeometry(1, 28, 20), new T.MeshStandardMaterial({ color: 0xdcef3f, emissive: 0x9fb31a, emissiveIntensity: 0.55, roughness: 0.5 }));
  m.castShadow = true;
  const seam = new T.Mesh(new T.TorusGeometry(0.98, 0.05, 8, 40), new T.MeshBasicMaterial({ color: 0x1c2a0a }));
  seam.rotation.set(0.9, 0.5, 0); m.add(seam);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xdcef3f, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
  glow.scale.set(3.2, 3.2, 1); m.add(glow);
  m.userData = { seam, glow }; ballGroup.add(m); ballMeshes.push(m); return m;
}
function ensureItem(it) {
  let m = itemMeshes.get(it);
  if (m) return m;
  const col = new T.Color(ctxRef.BONUSES[it.name].color);
  m = new T.Group();
  const core = new T.Mesh(new T.SphereGeometry(0.16, 20, 14), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.3 }));
  core.castShadow = true; m.add(core);
  const ring = new T.Mesh(new T.TorusGeometry(0.27, 0.025, 8, 40), new T.MeshBasicMaterial({ color: col }));
  ring.rotation.x = Math.PI / 2; m.add(ring);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }));
  glow.scale.set(1.4, 1.4, 1); m.add(glow);
  m.userData = { ring }; itemGroup.add(m); itemMeshes.set(it, m); return m;
}
function ensureProj(i) {
  if (projMeshes[i]) return projMeshes[i];
  const m = new T.Mesh(new T.CapsuleGeometry ? new T.CapsuleGeometry(0.045, 0.3, 4, 8) : new T.CylinderGeometry(0.045, 0.045, 0.36, 8),
    new T.MeshStandardMaterial({ color: 0x8eff9b, emissive: 0x8eff9b, emissiveIntensity: 1.2 }));
  m.rotation.x = Math.PI / 2; projGroup.add(m); projMeshes.push(m); return m;
}

let lastT = 0;
function spawnDebris(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    let m = debris.find(d => !d.visible);
    if (!m) { if (debris.length > 60) return; m = new T.Mesh(debrisGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })); m.castShadow = Q.tier === 2; scene.add(m); debris.push(m); }
    m.visible = true; m.material.color.set(color); m.position.set(x, 0.25, y);
    m.userData = { vx: (Math.random() - 0.5) * 0.006, vy: 0.004 + Math.random() * 0.006, vz: (Math.random() - 0.5) * 0.006, rx: (Math.random() - 0.5) * 0.02, rz: (Math.random() - 0.5) * 0.02, life: 900 + Math.random() * 400, t: 0 };
    m.scale.setScalar(0.7 + Math.random() * 0.6);
  }
}
function render(G) {
  if (!renderer) return;
  const time = G.time, active = ctxRef.activeBonus;
  const now = performance.now(), dt = lastT ? Math.min(50, now - lastT) : 16; lastT = now;
  if (G.state === 'RUNNING') autoQuality(dt);
  // one-shot effects from the engine
  for (const e of G.fx) {
    if (e.type === 'break') { spawnDebris(e.x, e.y, e.color, Q.tier === 0 ? 3 : 6); kick = Math.max(kick, 0.35); }
    else if (e.type === 'paddle') kick = Math.max(kick, 0.25);
    else if (e.type === 'out') { spawnDebris(e.x, e.y - 0.1, '#e00020', 10); }
    else if (e.type === 'pick') { spawnDebris(e.x, e.y, e.color, 8); }
    else if (e.type === 'clear') { clearAnim = 1; }
  }
  kick = Math.max(0, kick - dt / 160); clearAnim = Math.max(0, clearAnim - dt / 900);
  // debris physics
  for (const m of debris) {
    if (!m.visible) continue; const u = m.userData; u.t += dt;
    m.position.x += u.vx * dt; m.position.z += u.vz * dt; m.position.y += u.vy * dt; u.vy -= 0.000022 * dt;
    if (m.position.y < 0.05) { m.position.y = 0.05; u.vy = -u.vy * 0.4; u.vx *= 0.8; u.vz *= 0.8; }
    m.rotation.x += u.rx * dt * 0.06; m.rotation.z += u.rz * dt * 0.06;
    if (u.t > u.life) m.visible = false; else if (u.t > u.life - 250) m.scale.multiplyScalar(0.94);
  }
  // camera: shake on life loss, a small kick on hits, a push-in on level clear
  const sh = G.shake > 0 ? G.shake * 0.25 : 0;
  const dist = camBase.dist - kick * 0.15 - clearAnim * 0.6;
  camera.position.copy(camBase.look).addScaledVector(camBase.dir, dist);
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh - kick * 0.03;
  camera.lookAt(camBase.look);

  // blocks
  let n = 0;
  for (const b of G.blocks) {
    const cnt = b.stack.length;
    const appear = b.born != null ? Math.min(1, (time - b.born) / 350) : 1;
    const jx = b.shake ? (Math.random() - 0.5) * 0.06 * b.shake : 0;
    for (let i = 0; i < cnt; i++) {
      const k = b.stack[i];
      const pulse = (i === cnt - 1 && b.hit) ? 1 + b.hit * 0.22 : 1;
      const s = appear < 1 ? Math.max(0.001, 1 - Math.pow(1 - appear, 3)) : 1;
      tmpP.set(b.x + CELL / 2 + jx, 0.17 + i * 0.34 * s + (1 - s) * 0.6, b.y + CELL / 2);
      tmpS.set(s * pulse, s * (2 - pulse), s * pulse); tmpQ.identity(); tmpM.compose(tmpP, tmpQ, tmpS);
      blocksMesh.setMatrixAt(n, tmpM);
      tmpC.set(k === 1 ? '#1f6b5c' : ctxRef.KIND_COLORS[k] || '#ffffff');
      if (i < cnt - 1) tmpC.multiplyScalar(0.72); else if (b.hit) tmpC.lerp(new T.Color(0xffffff), b.hit * 0.6);
      blocksMesh.setColorAt(n, tmpC);
      n++;
    }
  }
  blocksMesh.count = n; blocksMesh.instanceMatrix.needsUpdate = true;
  if (blocksMesh.instanceColor) blocksMesh.instanceColor.needsUpdate = true;

  // paddle
  const P = G.paddle, half = ctxRef.PADDLE_HALF * P.size;
  paddle.position.set(P.x, 0.14, P.y);
  const sq = P.squash || 0; paddle.scale.set(1 + sq * 0.12, 1 - sq * 0.35, 1 - sq * 0.25);
  paddle.userData.bar.scale.set(1, half * 2, 1);
  paddleCaps[0].position.x = -half; paddleCaps[1].position.x = half;
  const padColor = active('racket') ? ctxRef.BONUSES.racket.color : '#ece8d6';
  paddle.userData.mat.color.set(padColor); paddle.userData.mat.emissive.set(padColor); paddle.userData.mat.emissiveIntensity = active('racket') ? 0.6 : 0.18;
  paddle.userData.ring.visible = P.held && !G.autoplay;

  // baseline / defensive wall
  const wall = active('defensivewall');
  baseline.material.color.set(wall ? ctxRef.BONUSES.defensivewall.color : '#ece8d6');
  baseline.material.opacity = wall ? 0.95 : 0.55;
  baseline.scale.y = wall ? 8 : 1; baseline.position.y = wall ? 0.24 : 0.03;

  // balls
  const power = active('powershot');
  let bi = 0, lightSet = false;
  for (const b of G.balls) {
    if (!b.visible) continue;
    const m = ensureBall(bi++);
    m.visible = true; m.position.set(b.x, b.r, b.y); const bs = b.squash || 0; m.scale.set(b.r * (1 + bs * 0.3), b.r * (1 - bs * 0.3), b.r * (1 + bs * 0.3));
    m.rotation.x += 0.08; m.rotation.z += 0.05;
    m.material.color.set(power ? '#ff6a6a' : '#dcef3f'); m.material.emissive.set(power ? '#ff3a3a' : '#9fb31a'); m.material.emissiveIntensity = power ? 1.1 : 0.55;
    m.userData.glow.material.color.set(power ? '#ff6a6a' : '#dcef3f'); m.userData.glow.scale.setScalar(power ? 4.5 : 3.2);
    for (let ti = 0; ti < b.trail.length; ti++) {
      const t = b.trail[ti]; let tm = trailMeshes[(bi - 1) * 8 + ti];
      if (!tm) { tm = new T.Mesh(new T.SphereGeometry(1, 10, 8), new T.MeshBasicMaterial({ color: 0xdcef3f, transparent: true, opacity: 0.25, blending: T.AdditiveBlending, depthWrite: false })); trailMeshes[(bi - 1) * 8 + ti] = tm; scene.add(tm); }
      const f = (ti + 1) / (b.trail.length + 1);
      tm.visible = true; tm.position.set(t.x, b.r, t.y); tm.scale.setScalar(b.r * (0.3 + 0.6 * f)); tm.material.opacity = 0.05 + 0.3 * f; tm.material.color.set(power ? '#ff6a6a' : '#dcef3f');
    }
    for (let ti = b.trail.length; ti < 8; ti++) if (trailMeshes[(bi - 1) * 8 + ti]) trailMeshes[(bi - 1) * 8 + ti].visible = false;
    if (!lightSet) { ballLight.position.set(b.x, b.r + 0.6, b.y); ballLight.color.set(power ? '#ff6a6a' : '#dcef3f'); ballLight.intensity = power ? 1.6 : 0.9; lightSet = true; }
  }
  for (let i = bi; i < ballMeshes.length; i++) ballMeshes[i].visible = false;
  for (let i = bi * 8; i < trailMeshes.length; i++) if (trailMeshes[i]) trailMeshes[i].visible = false;
  if (!lightSet) ballLight.intensity = 0;

  // items
  for (const [it, m] of itemMeshes) if (!G.items.includes(it)) { itemGroup.remove(m); itemMeshes.delete(it); }
  for (const it of G.items) { const m = ensureItem(it); m.position.set(it.x, 0.3 + Math.sin(time * 0.006) * 0.05, it.y); m.userData.ring.rotation.z = it.spin; m.rotation.y = it.spin * 0.7; }

  // projectiles
  let pi = 0;
  for (const p of G.projectiles) { const m = ensureProj(pi++); m.visible = true; m.position.set(p.x, 0.2, p.y); m.scale.y = p.armed ? 0.5 : 1.3; }
  for (let i = pi; i < projMeshes.length; i++) projMeshes[i].visible = false;

  // particles
  const pos = particles.geometry.attributes.position, col = particles.geometry.attributes.color;
  let k = 0;
  for (const p of G.particles) {
    if (k >= MAX_PARTICLES) break;
    const a = 1 - p.t / p.life;
    pos.setXYZ(k, p.x, 0.25 + (p.vz || 0) * p.t, p.y);
    tmpC.set(p.color).multiplyScalar(a * 1.2); col.setXYZ(k, tmpC.r, tmpC.g, tmpC.b); k++;
  }
  particles.geometry.setDrawRange(0, k); pos.needsUpdate = true; col.needsUpdate = true;

  renderer.domElement.style.filter = G.grey > 0 ? 'saturate(' + Math.round((1 - G.grey * 0.85) * 100) + '%)' : '';
  renderer.render(scene, camera);
}

window.__r3 = () => ({ scene, camera, blocksMesh, renderer }); // debug
return { init, resize, render, pointerToGround, project, setTier };
})();
