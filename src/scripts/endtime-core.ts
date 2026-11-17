/**
 * 《时间的尽头》核心纯函数 — 场景数学与文案数据
 * 渲染相关的确定性逻辑都抽在这里，便于单元测试。
 */

// ---------- 伪随机（场景可复现） ----------

/** mulberry32：32 位种子 → [0,1) 确定性随机 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

/** [min, max) 均匀分布 */
export function range(r: () => number, min: number, max: number): number {
  return min + r() * (max - min);
}

// ---------- 时间符号 ----------

/** 1..12 → 罗马数字（钟盘十二时） */
export function romanNumeral(n: number): string {
  const table = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new RangeError(`romanNumeral 需要 1..12，收到 ${n}`);
  return table[n];
}

export const ROMAN_CLOCK: readonly string[] = Array.from({ length: 12 }, (_, i) => romanNumeral(i + 1));

/**
 * 时针速度：越靠近奇点，转速越疯狂（引力时间膨胀的戏仿）。
 * r 越小转速越快，幂律 r^-1.5（开普勒第三定律）。
 */
export function keplerSpeed(r: number, k = 60): number {
  if (r <= 0) throw new RangeError('半径必须为正');
  return k * Math.pow(r, -1.5);
}

/** 秒针角速度随「熵」衰减：0（满速）→ 1（静止），指数慢化 */
export function entropyDecay(t: number, halfLife = 18): number {
  if (halfLife <= 0) throw new RangeError('半衰期必须为正');
  return Math.exp((-Math.LN2 * t) / halfLife);
}

// ---------- 余烬尘埃的螺旋 ----------

export interface SpiralParticle {
  r0: number;        // 出生半径
  angle0: number;    // 初始方位角
  radialSpeed: number; // 每秒坠落的半径
  yOffset: number;   // 离盘面的高度偏移
  size: number;      // 基础尺寸
}

/**
 * t 时刻粒子在螺旋上的位置：半径从 r0 线性坠向 rMin，坠穿后在 rMax 重生（锯齿）。
 * GPU 上的余烬着色器按同一公式运动，保证 CPU/GPU 行为一致。
 */
export function spiralState(p: SpiralParticle, t: number, rMin: number, rMax: number): { r: number; angle: number; reborn: boolean } {
  if (rMin >= rMax) throw new RangeError('rMin 必须小于 rMax');
  const cycle = (rMax - rMin) / p.radialSpeed;
  const phase = ((t % cycle) + cycle) % cycle; // 距上次重生经过的秒数
  const fallen = p.r0 - p.radialSpeed * phase; // r0 本身也归一进 [rMin, rMax]
  const reborn = fallen <= rMin;
  const r = reborn ? rMax : fallen;
  return { r, angle: p.angle0 + keplerSpeed(r, 60) * t, reborn };
}

// ---------- 表针残骸 ----------

/** 第 i 组表针的基础转速（rad/s），错落且互不相同 */
export function handSpeed(i: number): number {
  const speeds = [0.35, -0.28, 0.22, -0.18, 0.5, -0.42, 0.16, -0.55, 0.3, -0.24, 0.44, -0.36];
  return speeds[((i % speeds.length) + speeds.length) % speeds.length];
}

/** 表针三针的长度：时针短、分针中、秒针长 */
export function handLengths(clockRadius: number): { hour: number; minute: number; second: number } {
  return { hour: clockRadius * 0.5, minute: clockRadius * 0.75, second: clockRadius * 0.95 };
}

/** 倾斜轨道四元数：给定倾角与升交点经度，绕盘面倾斜的圆轨道 */
export function orbitTilt(inclinationDeg: number, ascNodeDeg: number): [number, number, number] {
  const inc = (inclinationDeg * Math.PI) / 180;
  const node = (ascNodeDeg * Math.PI) / 180;
  // 先绕 X 倾斜，再绕 Y 转开升交点
  const sx = Math.sin(inc), cx = Math.cos(inc);
  const sy = Math.sin(node), cy = Math.cos(node);
  // 组合旋转的欧拉近似（本场景只需视觉正确，小角合成足够）
  return [inc * cy, inc * sy, sx * sy * 0.5];
}

// ---------- HUD 时钟 ----------

/** 秒数 → HH:MM:SS（可超过 24h，倒流允许负数显示为倒计数） */
export function formatClock(seconds: number): string {
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const sign = seconds < 0 ? '-' : '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${sign}${two(h)}:${two(m)}:${two(sec)}`;
}

/** 「停留时长」的文案：秒 → 人话 */
export function dwellText(seconds: number): string {
  if (seconds < 60) return '你在尽头停留了片刻';
  if (seconds < 3600) return `你在尽头停留了 ${Math.floor(seconds / 60)} 分钟`;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `你在尽头停留了 ${h} 小时 ${m} 分钟` : `你在尽头停留了 ${h} 小时`;
}

// ---------- 缓动 ----------

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

// ---------- 广义相对论玩具箱 ----------

/**
 * 引力时间膨胀（艺术放大版史瓦西度规）：dτ/dt = √(1 − rs/d)。
 * rs 取 13.5（比视界 6.3 大，让相机推近时效应肉眼可感），下限 0.05。
 */
export function dilationFactor(camDist: number, rs = 13.5): number {
  if (camDist <= 0) throw new RangeError('相机距离必须为正');
  return Math.sqrt(Math.max(1 - rs / camDist, 0.05));
}

/** 红移视觉强度：固有时流速越慢，画面越沉入暗红 */
export function redshiftFromDilation(dilation: number): number {
  return clamp01((0.92 - dilation) / 0.55);
}

/**
 * 潮汐拉伸倍率：r ≥ rTidal 为 1；越靠近视界沿径向拉得越长（spaghettification）。
 * k·x³ 在 r = rTidal·(1−0.33) 处 ≈ 1.27，在坠入界 ≈ 1.9。
 */
export function tidalStretch(r: number, rTidal = 13, k = 22): number {
  if (r <= 0 || rTidal <= 0) throw new RangeError('半径必须为正');
  const x = Math.max(0, (rTidal - r) / rTidal);
  return 1 + k * x * x * x;
}

/** 残骸是否处于彭罗斯能层（可抽取转动能量的环带） */
export function inErgosphere(r: number, inner = 11.5, outer = 16.5): boolean {
  return r >= inner && r <= outer;
}

/**
 * 表盘熵死时刻表：N 个元素在 (0, duration] 内无重复地依次剥落。
 * 返回 detachAt[i]（秒）；给定 rng 保证可复现。
 */
export function entropySchedule(n: number, duration: number, r: () => number): number[] {
  if (n <= 0) throw new RangeError('元素数必须为正');
  if (duration <= 0) throw new RangeError('时长必须为正');
  const slots = Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n);
  // Fisher–Yates 洗牌：谁先死去由命运（种子）决定
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** 元素熵态：0 附着于表盘 … 1 完全坠亡。倒流时 entropyTime 回退，状态自然复原。 */
export function entropyState(detachAt: number, fallDur: number, entropyTime: number): number {
  if (fallDur <= 0) throw new RangeError('坠落时长必须为正');
  return clamp01((entropyTime - detachAt) / fallDur);
}
