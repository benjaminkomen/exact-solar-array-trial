// The data module. Everything here is ported from solar-array-simulator:
//   configStore.ts      DEFAULT_CONFIG, updateDefaultWattage, inverter add/edit/delete
//   collision.ts        rectsOverlap, collidesWithAny, PANEL_GAP
//   gridSnap.ts         GRID_SIZE, SNAP_THRESHOLD, snapToGrid
//   neighborSnap.ts     snapToNeighbors (the drop logic)
//   panelUtils.ts       PANEL_WIDTH/HEIGHT, getPanelDimensions, findFreePosition
//   canvasLayout.ts     buildMockPanelGrid (the 2 x 5 starting grid)
//   solarCalculations   getEffectiveOutput, no-location branch
// State is in memory; the RN app persists it with kv-store.
import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

// ---- configStore.ts -------------------------------------------------------
type Inverter = { id: string; serialNumber: string; efficiency: number };
type RoofType = 'flat' | 'gable' | 'hip' | 'shed';
// DEFAULT_CONFIG's efficiencies. Its serials are Math.random() 8-digit numbers;
// sources may not use randomness, so these are fixed 8-digit stand-ins.
const EFFICIENCIES = [95, 95, 95, 95, 95, 95, 95, 75, 68, 62, 20, 15, 0, 0];
const SERIALS = ['22978810', '92278941', '83754532', '92141481', '32659018', '57508576', '13336302',
  '47120953', '66014387', '25873190', '71409826', '38265541', '90137264', '54692018'];
let inverters: Inverter[] = EFFICIENCIES.map((efficiency, i) => ({ id: String(i + 1), serialNumber: SERIALS[i], efficiency }));
let nextInverterId = inverters.length + 1;
let defaultMaxWattage = 430;
let panelTiltAngle = 30;
let roofType: RoofType = 'gable';

// ---- collision.ts / gridSnap.ts --------------------------------------------
type Rect = { x: number; y: number; width: number; height: number };
const PANEL_GAP = 8;
const GRID_SIZE = 30;
const SNAP_THRESHOLD = 90;
const rectsOverlap = (a: Rect, b: Rect, gap = 0) =>
  !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y);
function collidesWithAny(rect: Rect, others: (Rect & { id: string })[], excludeId?: string, gap = PANEL_GAP) {
  for (const o of others) {
    if (excludeId && o.id === excludeId) continue;
    if (rectsOverlap(rect, o, gap)) return true;
  }
  return false;
}
const snapToGrid = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

// ---- panelUtils.ts ----------------------------------------------------------
const PANEL_WIDTH = 60;
const PANEL_HEIGHT = 120;
type Panel = { id: string; x: number; y: number; rotation: number; inverterId: string };
const dimsOf = (rotation: number) => (rotation === 90 ? { width: PANEL_HEIGHT, height: PANEL_WIDTH } : { width: PANEL_WIDTH, height: PANEL_HEIGHT });
const rectOf = (p: Panel) => ({ id: p.id, x: p.x, y: p.y, ...dimsOf(p.rotation) });

function findFreePosition(canvasWidth: number, canvasHeight: number, rotation: number, vx: number, vy: number) {
  const dims = dimsOf(rotation);
  const rects = panels.map(rectOf);
  const around = (r: Rect) => [
    { x: r.x + r.width + PANEL_GAP, y: r.y },
    { x: r.x, y: r.y + r.height + PANEL_GAP },
    { x: r.x - dims.width - PANEL_GAP, y: r.y },
    { x: r.x, y: r.y - dims.height - PANEL_GAP },
  ];
  for (let i = panels.length - 1; i >= 0; i--) {
    for (const pos of around(rectOf(panels[i]))) if (!collidesWithAny({ ...pos, ...dims }, rects)) return pos;
  }
  const centerX = snapToGrid(vx + (canvasWidth - dims.width) / 2);
  const centerY = snapToGrid(vy + (canvasHeight - dims.height) / 2);
  if (!collidesWithAny({ x: centerX, y: centerY, ...dims }, rects)) return { x: centerX, y: centerY };
  for (let radius = GRID_SIZE; radius < 10000; radius += GRID_SIZE) {
    for (let dx = -radius; dx <= radius; dx += GRID_SIZE) {
      for (let dy = -radius; dy <= radius; dy += GRID_SIZE) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = snapToGrid(centerX + dx), y = snapToGrid(centerY + dy);
        if (!collidesWithAny({ x, y, ...dims }, rects)) return { x, y };
      }
    }
  }
  return null;
}

// ---- neighborSnap.ts ----------------------------------------------------------
function snapToNeighbors(cx: number, cy: number, w: number, h: number, id: string, all: (Rect & { id: string })[], ox: number, oy: number) {
  const xs: number[] = [], ys: number[] = [];
  for (const p of all) {
    if (p.id === id) continue;
    xs.push(p.x, p.x + p.width + PANEL_GAP, p.x - w - PANEL_GAP);
    ys.push(p.y, p.y + p.height + PANEL_GAP, p.y - h - PANEL_GAP);
  }
  let bestX = snapToGrid(cx), bestXDist = SNAP_THRESHOLD + 1;
  for (const x of xs) { const d = Math.abs(cx - x); if (d < bestXDist && d <= SNAP_THRESHOLD) { bestX = x; bestXDist = d; } }
  let bestY = snapToGrid(cy), bestYDist = SNAP_THRESHOLD + 1;
  for (const y of ys) { const d = Math.abs(cy - y); if (d < bestYDist && d <= SNAP_THRESHOLD) { bestY = y; bestYDist = d; } }
  if (!collidesWithAny({ x: bestX, y: bestY, width: w, height: h }, all, id)) return { x: bestX, y: bestY };
  const gx = snapToGrid(cx), gy = snapToGrid(cy);
  if (!collidesWithAny({ x: gx, y: gy, width: w, height: h }, all, id)) return { x: gx, y: gy };
  return { x: ox, y: oy };
}

// ---- canvasLayout.ts buildMockPanelGrid ------------------------------------------
// World coordinates are the canvas's own (viewport 0,0), as in the RN app.
const MOCK_GAP = 6, COLS = 5;
function buildMockPanelGrid(canvasWidth: number, canvasHeight: number): Panel[] {
  const gridW = (COLS - 1) * (PANEL_WIDTH + MOCK_GAP) + PANEL_WIDTH;
  const gridH = PANEL_HEIGHT + MOCK_GAP + PANEL_HEIGHT;
  const offX = Math.round((canvasWidth - gridW) / 2), offY = Math.round((canvasHeight - gridH) / 2);
  return Array.from({ length: 10 }, (_, i) => ({
    id: `panel-${nextPanel++}`,
    x: offX + (i % COLS) * (PANEL_WIDTH + MOCK_GAP),
    y: offY + Math.floor(i / COLS) * (PANEL_HEIGHT + MOCK_GAP),
    rotation: 0,
    inverterId: '',
  }));
}
// The wizard starts with no panels (PanelsContext is empty until the Layout step
// adds them, or Analyze hands over a grid); every new panel is unlinked.
let nextPanel = 1;
let panels: Panel[] = [];

// ---- Compass.tsx ------------------------------------------------------------------
// config.compassDirection: 0-360, 0 = North. While the arrow is dragged the angle
// follows the pointer (atan2(dx, -dy)); on release it snaps to the nearest 45°.
let compassDirection = 0;
let compassAngle = 0;

// ---- solarCalculations.ts getEffectiveOutput, no-location branch -----------------
// maxWattage * efficiency * fluctuation, fluctuation = 0.95 + Math.random() * 0.1.
// Sources may not use randomness, so the fluctuation is a hash of the tick and panel:
// the same ±5% spread, refreshed every second as useProductionMonitor does.
function fluctuation(tick: number, i: number) {
  let t = (tick * 7919 + i * 104729 + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return 0.95 + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 0.1;
}

const ok = { ok: true };
const sources: Sources = {
  config: (): Result<'config'> => ({ defaultMaxWattage, panelTiltAngle, roofType, compassDirection, inverters }),
  compass: (): Result<'compass'> => ({ angle: compassAngle, direction: compassDirection }),
  compassMove: ([dx, dy]) => {
    const raw = Math.atan2(dx, -dy);
    compassAngle = ((raw * 180) / Math.PI + 360) % 360;
    return ok;
  },
  compassRelease: () => {
    compassDirection = (Math.round(compassAngle / 45) * 45) % 360;
    compassAngle = compassDirection;
    return ok;
  },
  // Analyze without a photo: useCanvasEditor handleLayout -> buildMockPanelGrid
  mockGrid: ([canvasWidth, canvasHeight]) => {
    panels = buildMockPanelGrid(canvasWidth, canvasHeight);
    return ok;
  },
  // useProductionMonitor handleDeleteConfiguration: resetAllData + clearPanels
  resetAll: () => {
    panels = [];
    inverters = EFFICIENCIES.map((efficiency, i) => ({ id: String(i + 1), serialNumber: SERIALS[i], efficiency }));
    nextInverterId = inverters.length + 1;
    defaultMaxWattage = 430; panelTiltAngle = 30; roofType = 'gable'; compassDirection = 0; compassAngle = 0;
    return ok;
  },
  panels: (): Result<'panels'> => {
    // useViewport: the centre of the panels' bounding box, which Production centres on
    if (panels.length === 0) return { panels, centerX: 0, centerY: 0 };
    const r = panels.map(rectOf);
    const minX = Math.min(...r.map((q) => q.x)), maxX = Math.max(...r.map((q) => q.x + q.width));
    const minY = Math.min(...r.map((q) => q.y)), maxY = Math.max(...r.map((q) => q.y + q.height));
    return { panels, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  },
  production: ([tick]): Result<'production'> => {
    const out = panels.map((p, i) => {
      const inv = inverters.find((v) => v.id === p.inverterId);
      // tick 0 is the steady value (no noise), so the first frame and tests are exact
      const noise = tick === 0 ? 1 : fluctuation(tick, i);
      return { id: p.id, wattage: inv ? Math.round(defaultMaxWattage * (inv.efficiency / 100) * noise) : 0 };
    });
    return { total: out.reduce((a, p) => a + p.wattage, 0), panels: out };
  },
  // useCanvasEditor handleAddPanel -> findFreePosition at the viewport
  addPanel: ([canvasWidth, canvasHeight, vx, vy]) => {
    const pos = findFreePosition(canvasWidth, canvasHeight, 0, -vx, -vy);
    if (!pos) return { ok: false };
    panels = [...panels, { id: `panel-${nextPanel++}`, x: pos.x, y: pos.y, rotation: 0, inverterId: '' }];
    return ok;
  },
  // SolarPanelCanvas pan onEnd: snapToNeighbors, then bring to front
  dropPanel: ([id, x, y]) => {
    const p = panels.find((q) => q.id === id);
    if (!p) return { ok: false };
    const d = dimsOf(p.rotation);
    const s = snapToNeighbors(x, y, d.width, d.height, id, panels.map(rectOf), p.x, p.y);
    panels = [...panels.filter((q) => q.id !== id), { ...p, x: s.x, y: s.y }];
    return ok;
  },
  // usePanelsManager rotatePanel -> panelUtils findValidPositionAfterRotation
  rotatePanel: ([id]) => {
    const p = panels.find((q) => q.id === id);
    if (!p) return { ok: false };
    const rotation = p.rotation === 90 ? 0 : 90;
    const dims = dimsOf(rotation);
    const others = panels.filter((q) => q.id !== id).map(rectOf);
    let pos: { x: number; y: number } | null = collidesWithAny({ x: p.x, y: p.y, ...dims }, others) ? null : { x: p.x, y: p.y };
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (let r = GRID_SIZE; !pos && r <= 300; r += GRID_SIZE) {
      for (const [dx, dy] of dirs) {
        const t = { x: snapToGrid(p.x + dx * r), y: snapToGrid(p.y + dy * r) };
        if (!collidesWithAny({ ...t, ...dims }, others)) { pos = t; break; }
      }
    }
    if (!pos) return { ok: false };
    panels = panels.map((q) => (q.id === id ? { ...q, rotation, x: pos!.x, y: pos!.y } : q));
    return ok;
  },
  removePanel: ([id]) => { panels = panels.filter((q) => q.id !== id); return ok; },
  linkPanel: ([id, inverterId]) => { panels = panels.map((q) => (q.id === id ? { ...q, inverterId } : q)); return ok; },
  setWattage: ([text]) => {
    const w = parseInt(text, 10);
    if (!isNaN(w)) defaultMaxWattage = Math.max(1, w);
    return ok;
  },
  setTilt: ([deg]) => { panelTiltAngle = Math.min(90, Math.max(0, deg)); return ok; },
  setRoof: ([r]) => { roofType = r as RoofType; return ok; },
  saveInverter: ([id, serialNumber, efficiency]) => {
    const e = Math.min(100, Math.max(0, efficiency));
    if (id === '') inverters = [...inverters, { id: String(nextInverterId++), serialNumber, efficiency: e }];
    else inverters = inverters.map((v) => (v.id === id ? { ...v, serialNumber, efficiency: e } : v));
    return ok;
  },
  deleteInverter: ([id]) => {
    inverters = inverters.filter((v) => v.id !== id);
    panels = panels.map((p) => (p.inverterId === id ? { ...p, inverterId: '' } : p));
    return ok;
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
