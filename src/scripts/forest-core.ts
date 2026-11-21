/**
 * 《深林》核心 — 地理、道路与群系的单一真相（纯函数，零依赖）
 *
 * day ∈ [0,1]：0 晨光 · 0.55 金午后 · 1 暮色萤火。
 * 渲染、碰撞、道路留白与植被密度都消费这里的数据。
 */

// ---------- 伪随机与数学 ----------
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const range = (r: () => number, min: number, max: number) => min + r() * (max - min);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- 值噪声 + fbm ----------
export function makeNoise2(seed: number) {
  const r = rng(seed);
  const S = 128;
  const grid = new Float32Array(S * S);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number) => grid[((y % S + S) % S) * S + ((x % S + S) % S)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  const fbm = (x: number, y: number, oct = 4) => {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f); norm += amp; f *= 2.03; amp *= 0.5; }
    return v / norm;
  };
  return { noise, fbm, r };
}

// ---------- 世界尺度 ----------
export const WORLD_R = 108;
export const TERRAIN_SIZE = 264;
export const RIVER_HALF = 4.2;
export const POND_T = 0.9;
export const FALL_CREST_T = 0.612;
export const FALL_T = 0.648;
const CLIFF_X0 = 20, CLIFF_X1 = 27;

// ---------- 河线：预计算查找，保留原 API ----------
export function riverPoint(t: number): { x: number; z: number } {
  const x = -100 + 200 * t;
  const z = Math.sin(t * 4.2) * 34 + Math.sin(t * 9.1 + 1.7) * 8;
  return { x, z };
}
const RIVER_N = 192;
const RIVER_X = new Float64Array(RIVER_N + 1);
const RIVER_Z = new Float64Array(RIVER_N + 1);
for (let i = 0; i <= RIVER_N; i++) {
  const p = riverPoint(i / RIVER_N);
  RIVER_X[i] = p.x; RIVER_Z[i] = p.z;
}

/** 到河线的最近距离与参数 t。粗索引 + 两轮局部细化，不在热循环里反复算三角函数。 */
export function riverInfo(x: number, z: number): { d: number; t: number } {
  let best = Infinity, bestI = 0;
  for (let i = 0; i <= RIVER_N; i += 6) {
    const dx = RIVER_X[i] - x, dz = RIVER_Z[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bestI = i; }
  }
  const lo = Math.max(0, bestI - 6), hi = Math.min(RIVER_N, bestI + 6);
  for (let i = lo; i <= hi; i++) {
    const dx = RIVER_X[i] - x, dz = RIVER_Z[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bestI = i; }
  }
  let bestT = bestI / RIVER_N;
  // 最后在相邻两条连续线段上投影，避免陡崖处用离散采样估算水位。
  for (let i = Math.max(0, bestI - 1); i <= Math.min(RIVER_N - 1, bestI); i++) {
    const ax = RIVER_X[i], az = RIVER_Z[i], vx = RIVER_X[i + 1] - ax, vz = RIVER_Z[i + 1] - az;
    const length2 = vx * vx + vz * vz || 1;
    const u = clamp01(((x - ax) * vx + (z - az) * vz) / length2);
    const px = ax + vx * u, pz = az + vz * u, dx = px - x, dz = pz - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bestT = (i + u) / RIVER_N; }
  }
  return { d: Math.sqrt(best), t: bestT };
}
export const riverDistance = (x: number, z: number) => riverInfo(x, z).d;
export function riverWidth(t: number): number {
  return RIVER_HALF + smoothstep(POND_T - 0.06, POND_T + 0.05, t) * 11;
}
export function regional(x: number): number {
  return 9 - ((x + 100) / 200) * 11 - 7 * smoothstep(CLIFF_X0, CLIFF_X1, x);
}
export function riverBed(t: number): number {
  return regional(riverPoint(t).x) - 1.7;
}
/** 唯一的河面高程：网格、瀑布、涉水与音景共用。 */
export function riverWaterLevel(t: number): number {
  return riverBed(t) + 1.15;
}
export function waterLevelAt(x: number, z: number): number {
  const { d, t } = riverInfo(x, z);
  if (d > riverWidth(t) + 1.5) return -Infinity;
  return riverWaterLevel(t);
}

// ---------- 地形 ----------
const NOISE = makeNoise2(20261120);
export function terrainHeight(x: number, z: number): number {
  const hills =
    (NOISE.fbm(x * 0.012 + 3.1, z * 0.012 - 1.4, 5) - 0.5) * 22 +
    (NOISE.fbm(x * 0.06, z * 0.06, 3) - 0.5) * 3.2;
  let h = regional(x) + hills * 0.62;
  const { d, t } = riverInfo(x, z);
  const w = riverWidth(t);
  const steep = 1 + 0.5 * smoothstep(CLIFF_X0 - 4, CLIFF_X1 + 4, x) * (1 - smoothstep(CLIFF_X1 + 8, CLIFF_X1 + 20, x));
  const mask = smoothstep(w + 16 * steep, w * 0.55, d);
  h = h * (1 - mask) + riverBed(t) * mask;
  return h;
}
export function slopeAt(x: number, z: number, e = 0.9): number {
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.min(1, Math.hypot(hx, hz) / (2 * e) / 1.6);
}
export function moistureAt(x: number, z: number): number {
  const { d } = riverInfo(x, z);
  return clamp01(0.35 + NOISE.fbm(x * 0.02 + 9, z * 0.02 + 4, 3) * 0.6 + smoothstep(26, 6, d) * 0.35);
}

// ---------- 小径：Catmull-Rom 采样 + 空间索引 ----------
export interface TrailSample { x: number; z: number; width: number }
export interface TrailSpec { id: string; width: number; samples: TrailSample[] }
type Control = [number, number];
const MAIN_CONTROL: Control[] = [
  [-66, 58], [-60, 54], [-53, 49], [-47, 42], [-39, 39], [-32, 43], [-24, 48], [-18, 44],
  [-8, 46], [4, 50], [16, 52], [30, 50], [42, 47], [52, 44],
];
const BRANCHES: { id: string; width: number; points: Control[] }[] = [
  { id: 'ancient', width: 1.65, points: [[-18, 44], [-22, 32], [-30, 18], [-38, 0], [-42, -30]] },
  { id: 'fall', width: 1.55, points: [[16, 52], [20, 42], [25, 33], [29, 27]] },
  { id: 'stones', width: 1.55, points: [[52, 44], [58, 28], [60, 10], [58, -10], [58, -34]] },
];
function catmull(p0: Control, p1: Control, p2: Control, p3: Control, t: number): Control {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}
function buildTrail(id: string, points: Control[], width: number): TrailSpec {
  const samples: TrailSample[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < 12; j++) {
      const t = j / 12;
      const p = catmull(p0, p1, p2, p3, t);
      samples.push({ x: p[0], z: p[1], width: width * (0.94 + 0.09 * Math.sin((samples.length + 3) * 0.61)) });
    }
  }
  const last = points[points.length - 1];
  samples.push({ x: last[0], z: last[1], width });
  return { id, width, samples };
}
export const TRAILS: TrailSpec[] = [
  buildTrail('main', MAIN_CONTROL, 2.05),
  ...BRANCHES.map((b) => buildTrail(b.id, b.points, b.width)),
];
interface TrailSegment { ax: number; az: number; bx: number; bz: number; width: number; trail: string }
const TRAIL_SEGMENTS: TrailSegment[] = [];
const PATH_CELL = 8;
const PATH_GRID = new Map<number, number[]>();
const cellKey = (x: number, z: number) => (x + 32768) * 131072 + (z + 32768);
for (const trail of TRAILS) {
  for (let i = 0; i < trail.samples.length - 1; i++) {
    const a = trail.samples[i], b = trail.samples[i + 1];
    const index = TRAIL_SEGMENTS.length;
    TRAIL_SEGMENTS.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, width: (a.width + b.width) * 0.5, trail: trail.id });
    const x0 = Math.floor(Math.min(a.x, b.x) / PATH_CELL), x1 = Math.floor(Math.max(a.x, b.x) / PATH_CELL);
    const z0 = Math.floor(Math.min(a.z, b.z) / PATH_CELL), z1 = Math.floor(Math.max(a.z, b.z) / PATH_CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = cellKey(x, z);
      const list = PATH_GRID.get(key);
      if (list) list.push(index); else PATH_GRID.set(key, [index]);
    }
  }
}
const PATH_SEEN = new Uint32Array(TRAIL_SEGMENTS.length);
let pathStamp = 0;
export function pathInfo(x: number, z: number): { d: number; width: number; trail: string } {
  const cx = Math.floor(x / PATH_CELL), cz = Math.floor(z / PATH_CELL);
  let best = Infinity, width = 0, trail = '';
  pathStamp = (pathStamp + 1) >>> 0;
  if (pathStamp === 0) { PATH_SEEN.fill(0); pathStamp = 1; }
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    const list = PATH_GRID.get(cellKey(ix, iz));
    if (!list) continue;
    for (const i of list) {
      if (PATH_SEEN[i] === pathStamp) continue;
      PATH_SEEN[i] = pathStamp;
      const s = TRAIL_SEGMENTS[i];
      const vx = s.bx - s.ax, vz = s.bz - s.az;
      const len2 = vx * vx + vz * vz || 1;
      const t = clamp01(((x - s.ax) * vx + (z - s.az) * vz) / len2);
      const px = s.ax + vx * t, pz = s.az + vz * t;
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; width = s.width; trail = s.trail; }
    }
  }
  return { d: best === Infinity ? Infinity : Math.sqrt(best), width, trail };
}

/** 近景路缘最密，森林内部由湿度与斑块驱动；路心保持干净。 */
export function groundcoverDensityAt(x: number, z: number): number {
  if (Math.hypot(x, z) > WORLD_R + 3) return 0;
  const p = pathInfo(x, z);
  const river = riverInfo(x, z);
  if (river.d < riverWidth(river.t) + 0.9 || p.d < p.width * 0.72) return 0;
  const patch = NOISE.fbm(x * 0.09 + 17, z * 0.09 - 8, 3);
  const base = 2.8 + moistureAt(x, z) * 2.7 + patch * 3.2;
  const edge = Number.isFinite(p.d) ? (1 - smoothstep(p.width + 0.5, p.width + 4.2, p.d)) * 10.5 : 0;
  return Math.min(18, Math.max(0, base + edge - (patch < 0.34 ? 2.4 : 0)));
}

// ---------- 带空间哈希的确定性散布 ----------
export interface ScatterOpts {
  count: number;
  seed: number;
  minDist: number;
  riverPad?: number;
  maxSlope?: number;
  heightRange?: [number, number];
  bounds?: number;
  maxSlopeRiver?: boolean;
  filter?: (x: number, z: number) => boolean;
}
export function scatter(o: ScatterOpts): { x: number; z: number }[] {
  const r = rng(o.seed);
  const out: { x: number; z: number }[] = [];
  const bounds = o.bounds ?? WORLD_R - 4;
  const cell = Math.max(0.25, o.minDist);
  const grid = new Map<number, number[]>();
  let guard = o.count * 48;
  while (out.length < o.count && guard-- > 0) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * bounds;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (o.riverPad) {
      const { d, t } = riverInfo(x, z);
      if (d < riverWidth(t) + o.riverPad) continue;
    }
    const sl = slopeAt(x, z);
    if (o.maxSlope !== undefined && sl > o.maxSlope) continue;
    if (o.maxSlopeRiver) {
      const { d, t } = riverInfo(x, z);
      if (d < riverWidth(t) + 12 && sl > 0.42) continue;
    }
    if (o.heightRange) {
      const h = terrainHeight(x, z);
      if (h < o.heightRange[0] || h > o.heightRange[1]) continue;
    }
    if (o.filter && !o.filter(x, z)) continue;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let ok = true;
    for (let ix = cx - 1; ix <= cx + 1 && ok; ix++) for (let iz = cz - 1; iz <= cz + 1 && ok; iz++) {
      const list = grid.get(cellKey(ix, iz));
      if (!list) continue;
      for (const index of list) {
        const p = out[index];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < o.minDist * o.minDist) { ok = false; break; }
      }
    }
    if (!ok) continue;
    const index = out.length;
    out.push({ x, z });
    const key = cellKey(cx, cz);
    const list = grid.get(key);
    if (list) list.push(index); else grid.set(key, [index]);
  }
  return out;
}

// ---------- 分块与 LOD（纯函数，便于不变量测试） ----------
export type LodLevel = 0 | 1 | 2;
export function lodWithHysteresis(distance: number, previous: LodLevel, near = 22, mid = 55, h = 4): LodLevel {
  if (previous === 0) return distance > near + h ? (distance > mid ? 2 : 1) : 0;
  if (previous === 2) return distance < mid - h ? (distance < near ? 0 : 1) : 2;
  if (distance < near - h) return 0;
  if (distance > mid + h) return 2;
  return 1;
}
export function chunkCoord(v: number, size = 24): number { return Math.floor(v / size); }
export function chunkSeed(cx: number, cz: number, salt = 0): number {
  return ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(salt, 83492791)) >>> 0);
}

// ---------- 出生点与发现 ----------
export const SPAWN = { x: -60, z: 54, yaw: -1.32 } as const;
const fallPoint = riverPoint(FALL_T);
export interface DiscoverySpec {
  key: string; name: string; line: string;
  pos: { x: number; y: number; z: number };
  radius: number;
}
export const DISCOVERIES: DiscoverySpec[] = [
  { key: 'fall', name: '落银瀑', line: '七米的白噪声。水雾里总有一道彩虹，如果你站对角度。', pos: { x: fallPoint.x, y: 0, z: fallPoint.z }, radius: 14 },
  { key: 'glow', name: '幽蓝菌圃', line: '一圈会呼吸的蓝蘑菇。它们不发光，是夜在这里浓缩。', pos: { x: 52, y: 0, z: 44 }, radius: 8 },
  { key: 'ancient', name: '古木', line: '三百年的枝干上长着一整座倒悬的花园。', pos: { x: -42, y: 0, z: -30 }, radius: 9 },
  { key: 'meadow', name: '风花草甸', line: '花朝着风来的方向弯腰，像在鞠躬送客。', pos: { x: -18, y: 0, z: 44 }, radius: 12 },
  { key: 'stones', name: '苔石环', line: '五块石头围成的圈，苔藓厚得像绿雪。', pos: { x: 58, y: 0, z: -34 }, radius: 8 },
];
export const DAY_LABELS = ['晨', '晨金', '金午后', '暮金', '暮'] as const;
export function dayLabel(day: number): string {
  if (day < 0.18) return '晨';
  if (day < 0.4) return '晨金';
  if (day < 0.66) return '金午后';
  if (day < 0.86) return '暮金';
  return '暮';
}
