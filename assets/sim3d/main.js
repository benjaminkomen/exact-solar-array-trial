// The RN Simulation scene (src/components/simulation: SimulationScene, SkyDome,
// SunLight, SolarPanelMesh) in plain three.js with the WebGL renderer, as an
// iframe guest of the Exact app. The app computes the sun and the layout
// (app.ts `simulate`) and posts them as one string; this page only draws.
// Message: "sun=x,y,z;i=<intensity>;el=<elevation>;tilt=<deg>;boxes=x,z,w,d,..."
import * as THREE from './three.module.min.js';

const NIGHT = [0x1a1a2e, 0x0a0a15], TWILIGHT = [0x4a3a5e, 0x1a1a3e], DAWN = [0xc4856b, 0x4a6a8e], DAY = [0x9ec5d6, 0x4488cc];
const WARM = new THREE.Color(0xffcc88), WHITE = new THREE.Color(0xfff4e6);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  document.getElementById('fail').style.display = 'block';
  throw new Error('no WebGL');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9ab8a8, 0.012);
// R3F's default camera; SimulationScene's applyCameraAndScene with panels.
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(0, 8, -8);
camera.lookAt(0, 4, 20);

// SkyDome: a back-faced sphere with horizon -> zenith vertex colours.
const skyGeo = new THREE.SphereGeometry(100, 32, 32);
const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
sky.renderOrder = -2;
scene.add(sky);
const h = new THREE.Color(), z = new THREE.Color(), c = new THREE.Color();
function lerpPair(a, b, t) { h.set(a[0]).lerp(new THREE.Color(b[0]), t); z.set(a[1]).lerp(new THREE.Color(b[1]), t); }
function paintSky(el) {
  if (el < -6) lerpPair(NIGHT, NIGHT, 0);
  else if (el < 0) lerpPair(NIGHT, TWILIGHT, (el + 6) / 6);
  else if (el < 8) lerpPair(TWILIGHT, DAWN, el / 8);
  else if (el < 20) lerpPair(DAWN, DAY, (el - 8) / 12);
  else lerpPair(DAY, DAY, 0);
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    c.copy(h).lerp(z, Math.max(0, pos.getY(i) / 100));
    skyColors.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.attributes.color.needsUpdate = true;
}

const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xfff4e6, 1);
scene.add(sunLight);
// The sun sphere; RN's bloom pass is stood in for by an additive glow sprite.
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, toneMapped: false, transparent: true, fog: false });
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), sunMat);
scene.add(sunMesh);
const glowCanvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
const g2 = glowCanvas.getContext('2d');
const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
grad.addColorStop(0, 'rgba(255,250,235,1)'); grad.addColorStop(0.25, 'rgba(255,240,210,0.6)'); grad.addColorStop(1, 'rgba(255,240,210,0)');
g2.fillStyle = grad; g2.fillRect(0, 0, 128, 128);
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
glow.scale.set(9, 9, 1);
scene.add(glow);

// Ground plane
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x7a9e78, metalness: 0.05, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// The panel group: position(5,2,20) > nearEdge > rotation(-tilt,-0.5,0.5) > back from nearEdge, +3 up.
const outer = new THREE.Group(); outer.position.set(5, 2, 20); scene.add(outer);
const near = new THREE.Group(); outer.add(near);
const tilt = new THREE.Group(); near.add(tilt);
const inner = new THREE.Group(); tilt.add(inner);
const roofMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0, roughness: 1, side: THREE.DoubleSide });
const panelMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1a4080, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.7, side: THREE.DoubleSide });
let layoutKey = '';
function layout(boxes, tiltDeg) {
  const key = boxes.join(',') + '|' + tiltDeg;
  if (key === layoutKey) return;
  layoutKey = key;
  inner.clear();
  const ps = [];
  for (let i = 0; i + 3 < boxes.length; i += 4) ps.push({ x: boxes[i], z: boxes[i + 1], w: boxes[i + 2], d: boxes[i + 3] });
  if (!ps.length) return;
  const nearZ = Math.min(...ps.map((p) => p.z - p.d / 2));
  near.position.set(0, 0, nearZ);
  tilt.rotation.set((-tiltDeg * Math.PI) / 180, -0.5, 0.5);
  inner.position.set(0, 3, -nearZ);
  const minX = Math.min(...ps.map((p) => p.x - p.w / 2)), maxX = Math.max(...ps.map((p) => p.x + p.w / 2));
  const maxZ = Math.max(...ps.map((p) => p.z + p.d / 2));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX + 0.6, 0.04, maxZ - nearZ + 0.6), roofMat);
  roof.position.set((minX + maxX) / 2, -0.06, (nearZ + maxZ) / 2);
  inner.add(roof);
  for (const p of ps) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.05, p.d), panelMat);
    m.position.set(p.x, 0, p.z);
    inner.add(m);
  }
}

function apply(text) {
  const f = Object.fromEntries(text.split(';').map((kv) => kv.split('=')));
  if (!f.sun) return;
  const [x, y, zz] = f.sun.split(',').map(Number);
  const el = Number(f.el), intensity = Number(f.i);
  const t = Math.min(1, Math.max(0, el / 30));
  sunLight.position.set(x, y, zz);
  sunLight.intensity = Math.max(0, intensity);
  sunLight.color.copy(WARM).lerp(WHITE, t);
  ambient.intensity = 0.1 + Math.max(0, el / 90) * 0.15;
  sunMesh.position.set(x, y, zz);
  glow.position.set(x, y, zz);
  sunMat.opacity = y > 0 ? Math.min(1, y / 3) : 0;
  const b = 1.2 + t * 0.3;
  sunMat.color.setRGB(b, b * 0.88, b * 0.55);
  paintSky(el);
  layout((f.boxes ?? '').split(',').filter(Boolean).map(Number), Number(f.tilt));
}

addEventListener('message', (e) => { if (typeof e.data === 'string') apply(e.data); });
// A standalone visit (no parent): the query string is the message.
if (parent === window) apply(decodeURIComponent(location.search.slice(1)) || 'sun=0,15,25;i=3;el=60;tilt=30;boxes=0,0,5,10');

function resize() {
  const w = innerWidth, hh = innerHeight;
  renderer.setSize(w, hh, false);
  camera.aspect = w / hh;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// R3F's frameloop="always": draw every display frame, and report the rate.
let frames = 0, since = performance.now();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - since >= 2000) {
    parent.postMessage(`fps=${Math.round((frames * 1000) / (now - since))}`, '*');
    frames = 0; since = now;
  }
});
// The first message also commits this frame's origin, so the app can post back.
parent.postMessage('ready', '*');
