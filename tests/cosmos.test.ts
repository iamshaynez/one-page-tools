import { describe, it, expect } from 'vitest';
import {
  rng, range, auToScene, kmToUnits, SUN, PLANETS, MOON, byKey,
  keplerE, heliocentricAU, eclipticToScene, bodyScenePos, moonScenePos,
  rotationAngle, EGGS, fmtDist, TIME_SCALES, TIME_LABELS, joystickClamp, approachDist,
} from '../src/scripts/cosmos-core';

const RAD = Math.PI / 180;

describe('《宇宙漫游》核心 — 轨道与尺度', () => {
  it('开普勒方程：圆轨道 E=M，迭代残差收敛', () => {
    for (const m of [0, 0.5, 1.2, Math.PI, 5.0]) {
      const wrapped = ((m % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(keplerE(m, 0)).toBeCloseTo(wrapped, 8);
    }
    for (const e of [0.1, 0.25, 0.7, 0.95]) {
      for (const m of [0.3, 2.0, 4.5]) {
        const E = keplerE(m, e);
        const res = (E - e * Math.sin(E)) % (2 * Math.PI);
        expect(Math.abs(res - (((m % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)))).toBeLessThan(1e-8);
      }
    }
    expect(() => keplerE(1, 1)).toThrow(RangeError);
    expect(() => keplerE(1, -0.1)).toThrow(RangeError);
  });

  it('行星轨道：日心距落在 [a(1−e), a(1+e)]，运动连续', () => {
    for (const p of PLANETS) {
      let prev: number | null = null;
      for (let d = 0; d <= p.periodDays; d += p.periodDays / 50) {
        const pos = heliocentricAU(p, d);
        const r = Math.hypot(pos.x, pos.y, pos.z);
        expect(r).toBeGreaterThan(p.aAU * (1 - p.e) - 1e-6);
        expect(r).toBeLessThan(p.aAU * (1 + p.e) + 1e-6);
        expect(Math.abs(pos.z)).toBeLessThan(r); // 倾角有限
        if (prev !== null) expect(Math.abs(r - prev)).toBeLessThan(p.aAU * 0.2); // 连续
        prev = r;
      }
    }
  });

  it('公转周期：一个周期后回到同一点（土星精度内）', () => {
    const p = PLANETS[5]; // 土星
    const a = heliocentricAU(p, 100);
    const b = heliocentricAU(p, 100 + p.periodDays);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.01);
  });

  it('公转方向：从黄道北极看逆时针（与真实太阳系一致）', () => {
    const e = byKey('earth')!;
    const p1 = heliocentricAU(e, 0);
    const p2 = heliocentricAU(e, 3); // 三天后
    const a1 = Math.atan2(p1.y, p1.x);
    const a2 = Math.atan2(p2.y, p1.x) - Math.atan2(p1.y, p1.x) + Math.atan2(p2.y, p2.x); // 展开避免
    // 直接判角度增量（取主值）
    let d = (Math.atan2(p2.y, p2.x) - Math.atan2(p1.y, p1.x));
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    expect(d).toBeGreaterThan(0); // 黄经随时间增加 → 北极视角逆时针
    void a2;
  });

  it('轨道根数表：按半长轴升序排列，日心距为真', () => {
    for (let i = 1; i < PLANETS.length; i++) {
      expect(PLANETS[i].aAU).toBeGreaterThan(PLANETS[i - 1].aAU);
    }
    expect(PLANETS.map((p) => p.name)).toEqual(
      ['水星', '金星', '地球', '火星', '木星', '土星', '天王星', '海王星', '冥王星'],
    );
  });

  it('真实比例：木星 ≈ 11 倍地球，土星环、半径换算', () => {
    const j = byKey('jupiter')!;
    const e = byKey('earth')!;
    expect(j.radiusKm / e.radiusKm).toBeCloseTo(10.97, 1);
    expect(kmToUnits(6371)).toBeCloseTo(2.2, 6);
    expect(kmToUnits(j.radiusKm)).toBeCloseTo(24.15, 1);
    expect(kmToUnits(MOON.radiusKm)).toBeCloseTo(0.6, 1);
  });

  it('逆行与倾角：金星/天王星/冥王星逆行，天王星躺转，金星自转极慢', () => {
    const v = byKey('venus')!, u = byKey('uranus')!, p = byKey('pluto')!, e = byKey('earth')!;
    expect(v.rotationHours).toBeLessThan(0);
    expect(u.rotationHours).toBeLessThan(0);
    expect(p.rotationHours).toBeLessThan(0);
    expect(e.rotationHours).toBeGreaterThan(0);
    expect(u.tiltDeg).toBeGreaterThan(90);
    expect(v.tiltDeg).toBeGreaterThan(170);
    expect(Math.abs(v.rotationHours)).toBeGreaterThan(5000); // 243 天
    expect(e.rotationHours).toBeLessThan(24.5);
  });

  it('自转角：地球 24 小时一圈、方向正确，金星逆转', () => {
    expect(rotationAngle(23.934, 0)).toBe(0);
    expect(rotationAngle(23.934, 1)).toBeCloseTo(2 * Math.PI, 1); // 一天 ≈ 一圈
    expect(rotationAngle(23.934, 2)).toBeGreaterThan(rotationAngle(23.934, 1));
    expect(rotationAngle(-5832.5, 101)).toBeLessThan(rotationAngle(-5832.5, 100)); // 逆行随时间递减
  });

  it('缩放律：单调、地球轨道 42u、海/水压缩比合理', () => {
    expect(auToScene(1)).toBeCloseTo(42, 6);
    for (let a = 0.2; a < 40; a += 0.5) expect(auToScene(a)).toBeLessThan(auToScene(a + 0.1));
    const ratio = auToScene(30.11) / auToScene(0.387);
    expect(ratio).toBeGreaterThan(12);  // 真实比 78，压缩到 ~22
    expect(ratio).toBeLessThan(30);
    expect(() => auToScene(-1)).toThrow(RangeError);
  });

  it('坐标映射：黄道北(+z) → 场景 +Y，黄经 +90° → 场景 −Z', () => {
    const s = eclipticToScene({ x: 1, y: 0, z: 0.5 });
    expect(s.y).toBeCloseTo(0.5 * auToScene(Math.hypot(1, 0.5)) / Math.hypot(1, 0, 0.5), 6);
    const q = eclipticToScene({ x: 0, y: 1, z: 0 });
    expect(q.z).toBeLessThan(0); // 黄经 90° 映射到 -Z
    expect(q.x).toBeCloseTo(0, 8);
  });

  it('月球：绕地距离 ≈ 17u 带椭圆起伏，周期正确', () => {
    for (let d = 0; d < 30; d += 2) {
      const p = moonScenePos(d);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThan(15);
      expect(r).toBeLessThan(19);
    }
    const a = moonScenePos(0), b = moonScenePos(MOON.periodDays);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.01);
  });

  it('场景位置：行星都在黄道面附近（±倾角余量）', () => {
    for (const p of PLANETS) {
      const s = bodyScenePos(p, 1000);
      const r = Math.hypot(s.x, s.y, s.z);
      expect(Math.abs(s.y) / r).toBeLessThan(0.35); // 最大倾角冥王星 17° → sin ≈ 0.3
    }
  });

  it('彩蛋：五个漂浮物位置互不重叠，键唯一', () => {
    expect(EGGS).toHaveLength(5);
    expect(new Set(EGGS.map((e) => e.key)).size).toBe(5);
    for (let i = 0; i < EGGS.length; i++) {
      for (let j = i + 1; j < EGGS.length; j++) {
        const a = EGGS[i].pos, b = EGGS[j].pos;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(5);
      }
      expect(EGGS[i].line.length).toBeGreaterThan(8);
    }
  });

  it('HUD 工具：距离格式、时间档位、摇杆钳制、导航视距', () => {
    expect(fmtDist(5.25)).toBe('5.3 u');
    expect(fmtDist(123)).toBe('123 u');
    expect(fmtDist(4500)).toBe('4.5k u');
    expect(TIME_SCALES).toHaveLength(TIME_LABELS.length);
    expect(TIME_SCALES[0]).toBe(0);
    expect(TIME_SCALES[TIME_SCALES.length - 1]).toBe(30);
    const j1 = joystickClamp(0.3, 0.4);
    expect(j1.mag).toBeCloseTo(0.5, 6);
    const j2 = joystickClamp(3, 4);
    expect(j2.mag).toBe(1);
    expect(j2.x).toBeCloseTo(0.6, 6);
    expect(j2.y).toBeCloseTo(0.8, 6);
    expect(approachDist(kmToUnits(69911))).toBeCloseTo(kmToUnits(69911) * 4.5, 6);
    expect(approachDist(0.5)).toBe(6);
  });

  it('随机种子可复现', () => {
    const a = rng(7), b = rng(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
    const r = rng(1);
    for (let i = 0; i < 10; i++) {
      const v = range(r, -2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(2);
    }
  });

  it('太阳与数据完备：每个天体都有描述与两条事实', () => {
    for (const b of [SUN, ...PLANETS]) {
      expect(b.desc.length).toBeGreaterThan(6);
      expect(b.facts.length).toBeGreaterThanOrEqual(2);
      expect(byKey(b.key)).toBeDefined();
    }
    expect(byKey('nonexistent')).toBeUndefined();
    expect(SUN.kind).toBe('sun');
  });
});
