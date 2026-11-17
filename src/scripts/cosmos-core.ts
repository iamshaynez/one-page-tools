/**
 * 《宇宙漫游》核心 — 太阳系的真实骨架
 *
 * ── 坐标系（宪法） ────────────────────────────────────────────
 * 日心黄道坐标系：黄道面 = 场景 XZ 平面，+Y = 黄北极。
 * 行星位置由 J2000 历元开普勒轨道根数实时求解（牛顿迭代），
 * 各行星公转方向、偏心率、倾角、升交点均符合真实数据。
 *
 * ── 缩放律（诚实的不真实） ────────────────────────────────────
 * 真实太阳系水星到海王星半径比约 1:78，直接等比会让所有行星
 * 变成看不见的点。本馆采用：
 *   · 径向压缩：sceneR = DIST_K · r_AU^DIST_P （r_AU 为日心距）
 *     保持方向与轨道形状，仅压缩距离刻度；
 *   · 天体尺寸：按真实半径比例（地球 = 2.2u，木星 = 24.1u），
 *     太阳单独压至 14u（否则吞掉水星轨道）。
 * 信息卡中的天文数据全部为真实值。
 *
 * ── 天体清单 ─────────────────────────────────────────────────
 * 太阳 / 水金地火木土天海八行星 / 月球（地球卫星）/ 冥王星（矮行星）
 * 自转：金星、天王星为逆行；月球潮汐锁定；倾角为真值。
 */

// ---------- 伪随机 ----------
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

// ---------- 缩放律 ----------
export const DIST_K = 42;      // 地球轨道 → 42 场景单位
export const DIST_P = 0.72;    // 径向压缩幂
export const KM_PER_UNIT = 6371 / 2.2; // 天体尺寸换算（真实比例）
export const SUN_SCENE_R = 14; // 太阳艺术半径
export const MOON_SCENE_D = 17; // 月地距离（真实 60 地球半径，压缩）

/** 日心距（AU）→ 场景距离 */
export function auToScene(rAU: number): number {
  if (rAU < 0) throw new RangeError('日心距非负');
  return DIST_K * Math.pow(rAU, DIST_P);
}

/** 公里（天体半径）→ 场景单位 */
export function kmToUnits(km: number): number {
  return (km / 6371) * 2.2;
}

// ---------- 轨道根数（J2000，NASA 近似表） ----------
export type BodyKind = 'sun' | 'rocky' | 'gas' | 'ice' | 'moon' | 'dwarf';

export interface BodySpec {
  key: string;
  name: string;
  en: string;
  kind: BodyKind;
  radiusKm: number;
  rotationHours: number;    // 负值 = 逆行
  tiltDeg: number;          // 轴倾角（真值）
  aAU: number;              // 半长轴
  e: number;                // 偏心率
  iDeg: number;             // 轨道倾角
  omDeg: number;            // 升交点黄经 Ω
  poDeg: number;            // 近日点黄经 ϖ
  L0Deg: number;            // J2000 平黄经
  periodDays: number;       // 公转周期
  desc: string;
  facts: string[];
}

export const SUN: BodySpec = {
  key: 'sun', name: '太阳', en: 'Sol', kind: 'sun',
  radiusKm: 696340, rotationHours: 609.12, tiltDeg: 7.25,
  aAU: 0, e: 0, iDeg: 0, omDeg: 0, poDeg: 0, L0Deg: 0, periodDays: 1,
  desc: '占太阳系总质量 99.86% 的等离子体巨兽，一切光的源头。',
  facts: ['核心每秒聚变 6 亿吨氢', '光子逃出核心需数万年，逃出表面只 8 分钟'],
};

export const PLANETS: BodySpec[] = [
  {
    key: 'mercury', name: '水星', en: 'Mercury', kind: 'rocky',
    radiusKm: 2439.7, rotationHours: 1407.6, tiltDeg: 0.034,
    aAU: 0.38710, e: 0.20563, iDeg: 7.005, omDeg: 48.331, poDeg: 77.456, L0Deg: 252.251,
    periodDays: 87.969,
    desc: '离太阳最近的行星，昼夜温差六百度，一年只有 88 天。',
    facts: ['一昼夜 176 个地球日，比它的一年还长', '几乎没有大气，陨击坑保存四十亿年'],
  },
  {
    key: 'venus', name: '金星', en: 'Venus', kind: 'rocky',
    radiusKm: 6051.8, rotationHours: -5832.5, tiltDeg: 177.36,
    aAU: 0.72333, e: 0.00677, iDeg: 3.395, omDeg: 76.680, poDeg: 131.533, L0Deg: 181.980,
    periodDays: 224.701,
    desc: '被硫酸云包裹的炼狱，地球的邪恶孪生。它自东向西缓缓逆行。',
    facts: ['表面 464°C，足以熔化铅', '自转一圈 243 天，比公转还慢'],
  },
  {
    key: 'earth', name: '地球', en: 'Earth', kind: 'rocky',
    radiusKm: 6371, rotationHours: 23.934, tiltDeg: 23.44,
    aAU: 1.00000, e: 0.01671, iDeg: 0.00056, omDeg: -11.26064, poDeg: 102.947, L0Deg: 100.464,
    periodDays: 365.256,
    desc: '已知唯一孕育生命的世界，你此刻正随它以 29.8 km/s 绕日飞行。',
    facts: ['71% 被海洋覆盖', '23.44° 的倾角给了我们四季'],
  },
  {
    key: 'mars', name: '火星', en: 'Mars', kind: 'rocky',
    radiusKm: 3389.5, rotationHours: 24.623, tiltDeg: 25.19,
    aAU: 1.52368, e: 0.09340, iDeg: 1.850, omDeg: 49.558, poDeg: 336.041, L0Deg: 355.447,
    periodDays: 686.980,
    desc: '赤色荒漠，人类下一个落脚点。奥林帕斯山高 21 公里，珠峰的两倍半。',
    facts: ['有太阳系最大的火山与最深的峡谷', '两极有干冰与水冰'],
  },
  {
    key: 'jupiter', name: '木星', en: 'Jupiter', kind: 'gas',
    radiusKm: 69911, rotationHours: 9.925, tiltDeg: 3.13,
    aAU: 5.20260, e: 0.04849, iDeg: 1.303, omDeg: 100.464, poDeg: 14.331, L0Deg: 34.397,
    periodDays: 4332.59,
    desc: '行星之王。大红斑是一场刮了至少三百五十年的风暴，能装下整个地球。',
    facts: ['质量是其余行星总和的 2.5 倍', '自转最快：一天不足 10 小时'],
  },
  {
    key: 'saturn', name: '土星', en: 'Saturn', kind: 'gas',
    radiusKm: 58232, rotationHours: 10.656, tiltDeg: 26.73,
    aAU: 9.55491, e: 0.05551, iDeg: 2.489, omDeg: 113.666, poDeg: 92.432, L0Deg: 49.954,
    periodDays: 10759.22,
    desc: '戴冠的巨人。光环宽逾二十八万公里，厚度却常常不足一公里。',
    facts: ['平均密度小于水', '卡西尼环缝是引力刻下的沟'],
  },
  {
    key: 'uranus', name: '天王星', en: 'Uranus', kind: 'ice',
    radiusKm: 25362, rotationHours: -17.24, tiltDeg: 97.77,
    aAU: 19.21845, e: 0.04630, iDeg: 0.773, omDeg: 74.006, poDeg: 170.964, L0Deg: 313.238,
    periodDays: 30685.4,
    desc: '躺着公转的冰巨星——它的自转轴几乎躺在轨道面上，四季各长 21 年。',
    facts: ['甲烷吸走红光，留下青绿', '最冷：−224°C'],
  },
  {
    key: 'neptune', name: '海王星', en: 'Neptune', kind: 'ice',
    radiusKm: 24622, rotationHours: 16.11, tiltDeg: 28.32,
    aAU: 30.11039, e: 0.00899, iDeg: 1.770, omDeg: 131.784, poDeg: 44.971, L0Deg: 304.880,
    periodDays: 60189,
    desc: '笔尖上发现的行星——先由数学算出，再被望远镜看见。风速可达 2100 km/h。',
    facts: ['一学年才绕太阳一圈（165 年）', '卫星海卫一逆行公转'],
  },
  {
    key: 'pluto', name: '冥王星', en: 'Pluto', kind: 'dwarf',
    radiusKm: 1188.3, rotationHours: -153.3, tiltDeg: 122.53,
    aAU: 39.482, e: 0.2488, iDeg: 17.16, omDeg: 110.299, poDeg: 224.075, L0Deg: 238.929,
    periodDays: 90560,
    desc: '被除名的第九大行星，轨道倾斜而扁长，有时比海王星更靠近太阳。',
    facts: ['与卡戎互相潮汐锁定，共舞不分离', '心形冰原 斯普特尼克号'],
  },
];

export interface MoonSpec {
  key: string; name: string; en: string;
  radiusKm: number;
  periodDays: number; // 27.3217 恒星月
  iDeg: number;       // 相对黄道 5.145°
  e: number;
  phase0Deg: number;  // J2000 附近月相基准（近似）
  desc: string;
  facts: string[];
}
export const MOON: MoonSpec = {
  key: 'moon', name: '月球', en: 'Luna',
  radiusKm: 1737.4, periodDays: 27.3217, iDeg: 5.145, e: 0.0549, phase0Deg: 218.32,
  desc: '地球的守护者。它以每年 3.8 厘米的速度悄悄离开我们。',
  facts: ['潮汐锁定：永远以同一面示人', '没有它，地轴会剧烈摇摆'],
};

export const byKey = (key: string): BodySpec | undefined =>
  key === 'sun' ? SUN : PLANETS.find((p) => p.key === key);

// ---------- 开普勒求解 ----------
const RAD = Math.PI / 180;

/** 偏心点角：牛顿迭代解 E − e·sinE = M（弧度） */
export function keplerE(M: number, e: number): number {
  if (e < 0 || e >= 1) throw new RangeError('偏心率需在 [0,1)');
  let m = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 24; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

/** J2000 起第 days 天，行星在日心黄道坐标（AU） */
export function heliocentricAU(b: BodySpec, days: number): { x: number; y: number; z: number } {
  const n = 360 / b.periodDays;                       // 平均运动 °/天
  const M = (b.L0Deg - b.poDeg + n * days) * RAD;     // 平近点角
  const om = (b.poDeg - b.omDeg) * RAD;               // 近日点幅角 ω
  const E = keplerE(M, b.e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  // 真近点角与日心距
  const nu = Math.atan2(Math.sqrt(1 - b.e * b.e) * sinE, cosE - b.e);
  const r = b.aAU * (1 - b.e * cosE);
  // 轨道面 → 黄道面
  const wnu = om + nu;
  const cO = Math.cos(b.omDeg * RAD), sO = Math.sin(b.omDeg * RAD);
  const ci = Math.cos(b.iDeg * RAD), si = Math.sin(b.iDeg * RAD);
  const xp = r * (Math.cos(wnu));
  const yp = r * (Math.sin(wnu));
  return {
    x: xp * cO - yp * sO * ci,
    y: xp * sO + yp * cO * ci,
    z: yp * si,
  };
}

/** 黄道(AU, xy 平面+z 北) → 场景(xz 平面+y 北)，并作径向压缩 */
export function eclipticToScene(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const rAU = Math.max(Math.hypot(p.x, p.y, p.z), 1e-9);
  const s = auToScene(rAU) / rAU;
  return { x: p.x * s, y: p.z * s, z: -p.y * s };
}

/** 行星场景坐标（含径向压缩） */
export function bodyScenePos(b: BodySpec, days: number): { x: number; y: number; z: number } {
  return eclipticToScene(heliocentricAU(b, days));
}

/** 月球绕地球的场景坐标（简化圆/椭圆轨道 + 倾角） */
export function moonScenePos(days: number): { x: number; y: number; z: number } {
  const a = (days / MOON.periodDays) * 2 * Math.PI + MOON.phase0Deg * RAD;
  const r = MOON_SCENE_D * (1 + MOON.e * Math.cos(a)); // 近似椭圆
  const i = MOON.iDeg * RAD;
  return { x: Math.cos(a) * r, y: Math.sin(a) * Math.sin(i) * r, z: -Math.sin(a) * Math.cos(i) * r };
}

/** 自转角（弧度）。负周期 = 逆行（金星、天王星、冥王星） */
export function rotationAngle(rotationHours: number, days: number): number {
  return (days * 24 / rotationHours) * 2 * Math.PI;
}

// ---------- 彩蛋（漂浮物） ----------
export interface EggSpec {
  key: string; name: string; line: string;       // line: 发现时的一句
  pos: { x: number; y: number; z: number };      // 场景坐标（手工安放）
}
export const EGGS: EggSpec[] = [
  {
    key: 'voyager1', name: '旅行者一号',
    line: '1977 年出发，如今已飞出日球层。它携带着黄金唱片，与地球的通话早已安静。',
    pos: { x: -260, y: 55, z: 500 },
  },
  {
    key: 'record', name: '黄金唱片',
    line: '封套上刻着播放方法与地球的坐标——一张写给未知收件人的情书。',
    pos: { x: -242, y: 50, z: 486 },
  },
  {
    key: 'rose', name: 'B-612 的玫瑰',
    line: '小行星带里漂着一朵玻璃罩下的玫瑰。「正是你为玫瑰花费的时间，让她变得如此重要。」',
    pos: { x: 88, y: 14, z: -96 },
  },
  {
    key: 'clockhand', name: '钟表残骸',
    line: '三根停摆的表针在土星环外漂流——它们来自另一件展品《时间的尽头》。',
    pos: { x: -168, y: 26, z: -108 },
  },
  {
    key: 'bottle', name: '漂流瓶',
    line: '瓶中的签文写着：「山中方一日，世上已千年。」捞起来的人会停留片刻。',
    pos: { x: 30, y: -12, z: 46 },
  },
];

// ---------- HUD 工具 ----------
/** 场景距离 → 人话（相对尺度下的场景单位） */
export function fmtDist(units: number): string {
  if (units < 10) return `${units.toFixed(1)} u`;
  if (units < 1000) return `${Math.round(units)} u`;
  return `${(units / 1000).toFixed(1)}k u`;
}

/** 时间流速档位：暂停 / 1小时/秒 / 6小时/秒 / 1天/秒 / 30天/秒 */
export const TIME_SCALES = [0, 1 / 24, 0.25, 1, 30] as const;
export const TIME_LABELS = ['⏸', '1时/秒', '6时/秒', '1天/秒', '30天/秒'] as const;

/** 摇杆输入钳制到单位圆 */
export function joystickClamp(dx: number, dy: number, max = 1): { x: number; y: number; mag: number } {
  const m = Math.hypot(dx, dy);
  if (m <= max) return { x: dx, y: dy, mag: Math.min(m / max, 1) };
  return { x: (dx / m) * max, y: (dy / m) * max, mag: 1 };
}

/** 相机到目标的自动导航视距：天体半径的 4.5 倍，下限 6u */
export function approachDist(radiusUnits: number): number {
  return Math.max(radiusUnits * 4.5, 6);
}
