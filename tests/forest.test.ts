import { describe, it, expect } from 'vitest';
import {
  rng, range, makeNoise2, riverPoint, riverInfo, riverDistance, riverWidth,
  regional, riverBed, waterLevelAt, terrainHeight, slopeAt, moistureAt,
  scatter, DISCOVERIES, dayLabel, WORLD_R,
} from '../src/scripts/forest-core';

describe('《深林》核心 — 地理宪法', () => {
  it('噪声：确定性、有界、fbm 均值回归', () => {
    const a = makeNoise2(7), b = makeNoise2(7);
    expect(a.fbm(3.2, -1.4)).toBeCloseTo(b.fbm(3.2, -1.4), 12);
    let min = 1, max = 0;
    for (let i = 0; i < 500; i++) {
      const v = a.fbm(i * 0.37, i * 0.11, 5);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('河线：端点在地图两侧，参数单调，河上距离为零', () => {
    const s = riverPoint(0), e = riverPoint(1);
    expect(s.x).toBeLessThan(-90);
    expect(e.x).toBeGreaterThan(90);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = riverPoint(t);
      expect(riverInfo(p.x, p.z).d).toBeLessThan(0.6);
      expect(Math.abs(riverInfo(p.x, p.z).t - t)).toBeLessThan(0.02);
    }
    expect(riverDistance(0, 90)).toBeGreaterThan(20);
  });

  it('崖壁：x≈20→27 有一次七米跌落（瀑布的崖）', () => {
    const before = regional(18);
    const after = regional(29);
    expect(before - after).toBeGreaterThan(6);
  });

  it('地形：水面高于河床、上游岸高于床、高度连续、池段有水', () => {
    for (const t of [0.15, 0.4, 0.8, 0.95]) {
      const p = riverPoint(t);
      // 不变量一：河心处水面一定高于地形（水有深度）
      expect(waterLevelAt(p.x, p.z)).toBeGreaterThan(terrainHeight(p.x, p.z));
    }
    // 不变量二：上游（西高段）法线方向 18m 外的岸高于河床
    for (const t of [0.15, 0.4]) {
      const p = riverPoint(t);
      const q = riverPoint(t + 0.02);
      let nx = -(q.z - p.z), nz = q.x - p.x;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      if (nz < 0) { nx = -nx; nz = -nz; }
      const bed = terrainHeight(p.x, p.z);
      const bank = terrainHeight(p.x + nx * (riverWidth(t) + 18), p.z + nz * (riverWidth(t) + 18));
      expect(bank).toBeGreaterThan(bed);
    }
    // 连续性：一米步长内落差有限（无撕裂）
    let prev = terrainHeight(-60, 0);
    for (let x = -59; x <= 60; x += 1) {
      const h = terrainHeight(x, 0);
      expect(Math.abs(h - prev)).toBeLessThan(2.2);
      prev = h;
    }
    // 水域内水位有限值，水域外为 -Inf
    const mid = riverPoint(0.5);
    expect(Number.isFinite(waterLevelAt(mid.x, mid.z))).toBe(true);
    expect(waterLevelAt(0, 95)).toBe(-Infinity);
  });

  it('坡度与湿度：有界，近河更湿', () => {
    for (let i = 0; i < 40; i++) {
      const x = rng(1 + i)() * 160 - 80, z = rng(2 + i)() * 160 - 80;
      expect(slopeAt(x, z)).toBeGreaterThanOrEqual(0);
      expect(slopeAt(x, z)).toBeLessThanOrEqual(1);
      expect(moistureAt(x, z)).toBeGreaterThanOrEqual(0);
      expect(moistureAt(x, z)).toBeLessThanOrEqual(1);
    }
    const p = riverPoint(0.3);
    expect(moistureAt(p.x, p.z)).toBeGreaterThan(moistureAt(p.x + 60, p.z + 60));
  });

  it('散布：数量、间距、离水距离都守约', () => {
    const pts = scatter({ count: 40, seed: 11, minDist: 4, riverPad: 2.5, maxSlope: 0.55 });
    expect(pts.length).toBe(40);
    for (const p of pts) {
      const { d, t } = riverInfo(p.x, p.z);
      expect(d).toBeGreaterThan(riverWidth(t) + 2.4);
      expect(slopeAt(p.x, p.z)).toBeLessThanOrEqual(0.56);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(WORLD_R);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        expect(dist).toBeGreaterThanOrEqual(3.99);
      }
    }
  });

  it('散布失败时优雅降额（不卡死）', () => {
    const pts = scatter({ count: 500, seed: 3, minDist: 3, maxSlope: 0.01 }); // 极端条件
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length).toBeLessThan(500);
  });

  it('发现点：五个互不重叠、键唯一', () => {
    expect(DISCOVERIES).toHaveLength(5);
    expect(new Set(DISCOVERIES.map((d) => d.key)).size).toBe(5);
    for (const d of DISCOVERIES) {
      expect(d.line.length).toBeGreaterThan(8);
      expect(d.radius).toBeGreaterThan(4);
      expect(Math.hypot(d.pos.x, d.pos.z)).toBeLessThan(WORLD_R + 1);
    }
    for (let i = 0; i < DISCOVERIES.length; i++) {
      for (let j = i + 1; j < DISCOVERIES.length; j++) {
        const a = DISCOVERIES[i].pos, b = DISCOVERIES[j].pos;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(16);
      }
    }
  });

  it('时段标签：两端与金色默认', () => {
    expect(dayLabel(0)).toBe('晨');
    expect(dayLabel(0.55)).toBe('金午后');
    expect(dayLabel(1)).toBe('暮');
    expect(dayLabel(0.95)).toBe('暮');
  });
});
