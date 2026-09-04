/* Baseline Breaker — three.js renderer.
   Game space: x across the court (0..W), y depth (0 = far wall, H = baseline).
   World space: x = game x, z = game y, up = +y. */
window.Render3D = (() => {
'use strict';
const T = window.THREE;
let renderer, scene, camera, ground, baseline, farWall, blocksMesh, paddle, paddleCaps, ballGroup, itemGroup, projGroup, particles, ballLight;
let ctxRef = null, W = 6.5, H = 12, CELL = 0.5, ROWS = 11;
const tmpM = new T.Matrix4(), tmpP = new T.Vector3(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpC = new T.Color();
const raycaster = new T.Raycaster(), groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), ndc = new T.Vector2();
const MAX_CUBES = 13 * 11 * 4, MAX_PARTICLES = 800;
const camBase = { look: new T.Vector3(), dir: new T.Vector3(), dist: 16 };
let glowTex, ringTex;
const ballMeshes = [], itemMeshes = new Map(), projMeshes = [];

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
  g.fillStyle = '#0f2a1c'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#143722'; g.fillRect(0, ROWS * CELL * px, c.width, c.height - ROWS * CELL * px);
  // subtle clay-dust noise
  for (let i = 0; i < 4000; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.03) + ')'; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
  g.strokeStyle = 'rgba(236,232,214,0.55)'; g.lineWidth = 6; g.lineCap = 'square';
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.beginPath();
  g.moveTo(0.6 * px, 0); g.lineTo(0.6 * px, c.height); g.moveTo((W - 0.6) * px, 0); g.lineTo((W - 0.6) * px, c.height);
  g.moveTo(0.6 * px, (ROWS * CELL + 1) * px); g.lineTo((W - 0.6) * px, (ROWS * CELL + 1) * px);
  g.moveTo(W / 2 * px, (ROWS * CELL + 1) * px); g.lineTo(W / 2 * px, c.height);
  g.stroke();
  g.setLineDash([18, 12]); g.strokeStyle = 'rgba(236,232,214,0.35)';
  g.beginPath(); g.moveTo(0, ROWS * CELL * px); g.lineTo(c.width, ROWS * CELL * px); g.stroke();
  const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
}

function init(canvas, ctx) {
  ctxRef = ctx; W = ctx.W; H = ctx.H; CELL = ctx.CELL; ROWS = ctx.ROWS;
  renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

  scene = new T.Scene();
  scene.fog = new T.Fog(0x061109, 22, 40);
  camera = new T.PerspectiveCamera(48, 1, 0.1, 100);
  camBase.look.set(W / 2, 0, 5.0);
  camBase.dir.set(0, 0.46, 1).normalize();

  glowTex = makeGlowTexture();

  // lights
  scene.add(new T.HemisphereLight(0x9fd3b5, 0x06110a, 0.55));
  const sun = new T.DirectionalLight(0xfff1cc, 1.15);
  sun.position.set(W / 2 + 3, 12, 9); sun.target.position.set(W / 2, 0, 5); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 9, bottom: -9, near: 1, far: 40 });
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
  const cubeGeo = new T.BoxGeometry(CELL - 0.07, 0.3, CELL - 0.07);
  blocksMesh = new T.InstancedMesh(cubeGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.05 }), MAX_CUBES);
  blocksMesh.castShadow = true; blocksMesh.receiveShadow = true; blocksMesh.count = 0; scene.add(blocksMesh);

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

  resize();
}

function fitCamera() {
  const cw = renderer.domElement.clientWidth || 1, ch = renderer.domElement.clientHeight || 1;
  camera.aspect = cw / ch; camera.updateProjectionMatrix();
  const corners = [[0, 0, 0], [W, 0, 0], [0, 0, H], [W, 0, H], [0, 1.2, 0], [W, 1.2, 0]].map(a => new T.Vector3(...a));
  const topLimit = 0.66, sideLimit = 0.95, bottomLimit = -0.97;
  let lo = 8, hi = 40;
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

function render(G) {
  if (!renderer) return;
  const time = G.time, active = ctxRef.activeBonus;
  // camera shake
  const sh = G.shake > 0 ? G.shake * 0.25 : 0;
  camera.position.copy(camBase.look).addScaledVector(camBase.dir, camBase.dist);
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
  camera.lookAt(camBase.look);

  // blocks
  let n = 0;
  for (const b of G.blocks) {
    const cnt = b.stack.length;
    const appear = b.born != null ? Math.min(1, (time - b.born) / 350) : 1;
    const jx = b.shake ? (Math.random() - 0.5) * 0.06 * b.shake : 0;
    for (let i = 0; i < cnt; i++) {
      const k = b.stack[i];
      const s = appear < 1 ? Math.max(0.001, 1 - Math.pow(1 - appear, 3)) : 1;
      tmpP.set(b.x + CELL / 2 + jx, 0.15 + i * 0.3 * s + (1 - s) * 0.6, b.y + CELL / 2);
      tmpS.set(s, s, s); tmpQ.identity(); tmpM.compose(tmpP, tmpQ, tmpS);
      blocksMesh.setMatrixAt(n, tmpM);
      tmpC.set(k === 1 ? '#1f6b5c' : ctxRef.KIND_COLORS[k] || '#ffffff');
      if (i < cnt - 1) tmpC.multiplyScalar(0.72);
      blocksMesh.setColorAt(n, tmpC);
      n++;
    }
  }
  blocksMesh.count = n; blocksMesh.instanceMatrix.needsUpdate = true;
  if (blocksMesh.instanceColor) blocksMesh.instanceColor.needsUpdate = true;

  // paddle
  const P = G.paddle, half = ctxRef.PADDLE_HALF * P.size;
  paddle.position.set(P.x, 0.14, P.y);
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
    m.visible = true; m.position.set(b.x, b.r, b.y); m.scale.setScalar(b.r);
    m.rotation.x += 0.08; m.rotation.z += 0.05;
    m.material.color.set(power ? '#ff6a6a' : '#dcef3f'); m.material.emissive.set(power ? '#ff3a3a' : '#9fb31a'); m.material.emissiveIntensity = power ? 1.1 : 0.55;
    m.userData.glow.material.color.set(power ? '#ff6a6a' : '#dcef3f'); m.userData.glow.scale.setScalar(power ? 4.5 : 3.2);
    if (!lightSet) { ballLight.position.set(b.x, b.r + 0.6, b.y); ballLight.color.set(power ? '#ff6a6a' : '#dcef3f'); ballLight.intensity = power ? 1.6 : 0.9; lightSet = true; }
  }
  for (let i = bi; i < ballMeshes.length; i++) ballMeshes[i].visible = false;
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

return { init, resize, render, pointerToGround };
})();
