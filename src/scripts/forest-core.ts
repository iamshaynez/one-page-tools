/**
 * 《深林》核心 — 这片森林的地理宪法（全部纯函数，零依赖）
 *
 * ── 地理设计 ────────────────────────────────────────────────
 * 一条河自西向东横穿地图，在 x≈22 处跌下一道七米崖壁（瀑布），
 * 东端漫开成池。地形 = 区域坡降 + 丘陵 fbm，河谷按河线雕刻。
 * 所有用的高度/距离/湿度查询都从这里出——渲染、碰撞、
 * 植被落位共用同一份真相。
 *
 * ── 时段 ────────────────────────────────────────────────────
 * day ∈ [0,1]：0 晨光 · 0.55 金午后（默认，最美）· 1 暮色萤火
 */

// ---------- 伪随机（与馆内其余展品同款） ----------
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

// ---------- 值噪声 + fbm（CPU 版，地形与群系共用） ----------
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
export const WORLD_R = 108;        // 可漫游半径（软边界）
export const TERRAIN_SIZE = 264;   // 地形网格边长
export const RIVER_HALF = 4.2;     // 河面半宽（基础）
export const POND_T = 0.9;         // t ∈ [POND_T,1] 漫开成池
const CLIFF_X0 = 20, CLIFF_X1 = 27; // 崖壁带（瀑布所在）

// ---------- 河线 ----------
/** 河中心线：t∈[0,1]，西 → 东，两重正弦弯 */
export function riverPoint(t: number): { x: number; z: number } {
  const x = -100 + 200 * t;
  const z = Math.sin(t * 4.2) * 34 + Math.sin(t * 9.1 + 1.7) * 8;
  return { x, z };
}

/** 到河线的最近距离与参数 t（粗采样 + 邻域细化） */
export function riverInfo(x: number, z: number): { d: number; t: number } {
  let bestD = Infinity, bestT = 0;
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = riverPoint(t);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  for (let k = -6; k <= 6; k++) {
    const t = clamp01(bestT + k / (N * 8));
    const p = riverPoint(t);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return { d: bestD, t: bestT };
}
export const riverDistance = (x: number, z: number) => riverInfo(x, z).d;

/** 河面半宽：普通段 4.2 → 池段放大到 15 */
export function riverWidth(t: number): number {
  return RIVER_HALF + (smoothstep(POND_T - 0.06, POND_T + 0.05, t)) * 11;
}

/** 区域基准面：西高东低 + 崖壁跌落 */
export function regional(x: number): number {
  return 9 - ((x + 100) / 200) * 11 - 7 * smoothstep(CLIFF_X0, CLIFF_X1, x);
}

/** 河床与水面高程 */
export function riverBed(t: number): number {
  return regional(riverPoint(t).x) - 1.7;
}
export function waterLevelAt(x: number, z: number): number {
  const { d, t } = riverInfo(x, z);
  if (d > riverWidth(t) + 1.5) return -Infinity; // 不在水域
  return riverBed(t) + 1.15;
}

// ---------- 地形高度 ----------
const NOISE = makeNoise2(20261120);

/** 主高度函数（米）：丘陵 + 区域坡降 + 河谷雕刻 */
export function terrainHeight(x: number, z: number): number {
  const hills =
    (NOISE.fbm(x * 0.012 + 3.1, z * 0.012 - 1.4, 5) - 0.5) * 22 +
    (NOISE.fbm(x * 0.06, z * 0.06, 3) - 0.5) * 3.2;
  let h = regional(x) + hills * 0.62;
  // 河谷雕刻：越近河线越压向河床；崖壁段让谷壁更陡立
  const { d, t } = riverInfo(x, z);
  const w = riverWidth(t);
  const steep = 1 + 0.5 * smoothstep(CLIFF_X0 - 4, CLIFF_X1 + 4, x) * (1 - smoothstep(CLIFF_X1 + 8, CLIFF_X1 + 20, x));
  const mask = smoothstep(w + 16 * steep, w * 0.55, d);
  h = h * (1 - mask) + riverBed(t) * mask;
  // 水域外一点点浅滩的圆润
  return h;
}

/** 坡度（0 平 … 1 竖），有限差分 */
export function slopeAt(x: number, z: number, e = 0.9): number {
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.min(1, Math.hypot(hx, hz) / (2 * e) / 1.6);
}

/** 湿度：噪声 + 近河增益（植被落位用） */
export function moistureAt(x: number, z: number): number {
  const { d } = riverInfo(x, z);
  return clamp01(0.35 + NOISE.fbm(x * 0.02 + 9, z * 0.02 + 4, 3) * 0.6 + smoothstep(26, 6, d) * 0.35);
}

// ---------- 植被落位（带排斥的散布） ----------
export interface ScatterOpts {
  count: number;
  seed: number;
  minDist: number;          // 样本间最小间距
  riverPad?: number;        // 离水至少多远（0 = 允许贴水）
  maxSlope?: number;        // 坡度上限
  heightRange?: [number, number];
  bounds?: number;          // 距中心半径（默认 WORLD_R-4）
  maxSlopeRiver?: boolean;  // 额外要求：河谷内坡度更严（谷壁不长树）
  filter?: (x: number, z: number) => boolean;
}
export function scatter(o: ScatterOpts): { x: number; z: number }[] {
  const r = rng(o.seed);
  const out: { x: number; z: number }[] = [];
  const bounds = o.bounds ?? WORLD_R - 4;
  let guard = o.count * 40;
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
    let ok = true;
    for (const p of out) {
      if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < o.minDist * o.minDist) { ok = false; break; }
    }
    if (ok) out.push({ x, z });
  }
  return out;
}

// ---------- 发现点（叙事坐标） ----------
export interface DiscoverySpec {
  key: string; name: string; line: string;
  pos: { x: number; y: number; z: number }; // y 由场景按地形落定（占位 0）
  radius: number;
}
export const DISCOVERIES: DiscoverySpec[] = [
  {
    key: 'fall', name: '落银瀑', line: '七米的白噪声。水雾里总有一道彩虹，如果你站对角度。',
    pos: { x: 23.5, y: 0, z: 0 }, radius: 14,
  },
  {
    key: 'glow', name: '幽蓝菌圃', line: '一圈会呼吸的蓝蘑菇。它们不发光，是夜在这里浓缩。',
    pos: { x: 52, y: 0, z: 44 }, radius: 7,
  },
  {
    key: 'ancient', name: '古木', line: '三百年的枝干上长着一整座倒悬的花园。',
    pos: { x: -42, y: 0, z: -30 }, radius: 9,
  },
  {
    key: 'meadow', name: '风花草甸', line: '花朝着风来的方向弯腰，像在鞠躬送客。',
    pos: { x: -18, y: 0, z: 44 }, radius: 12,
  },
  {
    key: 'stones', name: '苔石环', line: '五块石头围成的圈，苔藓厚得像绿雪。',
    pos: { x: 58, y: 0, z: -34 }, radius: 8,
  },
];

// ---------- 时段（驱动天空/光照/音景） ----------
export const DAY_LABELS = ['晨', '晨金', '金午后', '暮金', '暮'] as const;
export function dayLabel(day: number): string {
  if (day < 0.18) return '晨';
  if (day < 0.4) return '晨金';
  if (day < 0.66) return '金午后';
  if (day < 0.86) return '暮金';
  return '暮';
}
