import { describe, it, expect } from 'vitest';
import {
  rng, pick, range, romanNumeral, ROMAN_CLOCK, keplerSpeed, entropyDecay,
  spiralState, handSpeed, handLengths, formatClock, dwellText,
  easeOutCubic, easeInCubic, easeInOutSine, clamp01,
  dilationFactor, redshiftFromDilation, tidalStretch, inErgosphere,
  entropySchedule, entropyState,
} from '../src/scripts/endtime-core';

describe('《时间的尽头》核心', () => {
  it('mulberry32 种子确定性', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    const vals = Array.from({ length: 1000 }, () => rng(7)());
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('不同种子序列不同', () => {
    const a = Array.from({ length: 8 }, () => rng(1)());
    const b = Array.from({ length: 8 }, () => rng(2)());
    expect(a).not.toEqual(b);
  });

  it('pick / range 落在界内', () => {
    const r = rng(99);
    for (let i = 0; i < 50; i++) {
      const v = range(r, -3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
    const arr = ['甲', '乙', '丙'] as const;
    for (let i = 0; i < 20; i++) expect(arr).toContain(pick(r, arr));
  });

  it('罗马数字钟盘完整', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(12)).toBe('XII');
    expect(ROMAN_CLOCK).toHaveLength(12);
    expect(ROMAN_CLOCK[0]).toBe('I');
    expect(ROMAN_CLOCK[11]).toBe('XII');
    expect(() => romanNumeral(0)).toThrow(RangeError);
    expect(() => romanNumeral(13)).toThrow(RangeError);
  });

  it('开普勒转速：内快外慢，单调递减', () => {
    expect(keplerSpeed(2)).toBeGreaterThan(keplerSpeed(10));
    for (let r = 1; r < 40; r++) expect(keplerSpeed(r)).toBeGreaterThan(keplerSpeed(r + 1));
    expect(() => keplerSpeed(0)).toThrow(RangeError);
  });

  it('熵衰减：时间越长越慢，半衰正确', () => {
    expect(entropyDecay(0)).toBeCloseTo(1, 6);
    expect(entropyDecay(18, 18)).toBeCloseTo(0.5, 6);
    expect(entropyDecay(100)).toBeLessThan(entropyDecay(10));
    expect(() => entropyDecay(5, 0)).toThrow(RangeError);
  });

  it('螺旋坠落：半径始终在界内，坠穿后于外缘重生', () => {
    const p = { r0: 20, angle0: 1, radialSpeed: 2, yOffset: 0, size: 1 };
    for (let t = 0; t < 60; t += 0.37) {
      const s = spiralState(p, t, 6, 40);
      expect(s.r).toBeGreaterThanOrEqual(6);
      expect(s.r).toBeLessThanOrEqual(40);
    }
    // 20 - 2*7 = 6 触底，t=7（及之后每 17s）在外缘重生
    expect(spiralState(p, 7, 6, 40).r).toBe(40);
    expect(spiralState(p, 7, 6, 40).reborn).toBe(true);
    expect(spiralState(p, 24, 6, 40).reborn).toBe(true);
    expect(spiralState(p, 6.9, 6, 40).reborn).toBe(false);
    // 角度随时间累积
    expect(spiralState(p, 5, 6, 40).angle).toBeGreaterThan(spiralState(p, 0, 6, 40).angle);
    expect(() => spiralState(p, 1, 40, 6)).toThrow(RangeError);
  });

  it('表针速度互不相同且带符号', () => {
    const speeds = Array.from({ length: 12 }, (_, i) => handSpeed(i));
    expect(new Set(speeds).size).toBeGreaterThan(8);
    expect(speeds.some((s) => s > 0)).toBe(true);
    expect(speeds.some((s) => s < 0)).toBe(true);
    // 索引可越界回绕
    expect(handSpeed(12)).toBe(handSpeed(0));
    expect(handSpeed(13)).toBe(handSpeed(1));
  });

  it('三针长度：时针 < 分针 < 秒针', () => {
    const l = handLengths(2);
    expect(l.hour).toBeCloseTo(1.0);
    expect(l.minute).toBeCloseTo(1.5);
    expect(l.second).toBeCloseTo(1.9);
    expect(l.hour).toBeLessThan(l.minute);
    expect(l.minute).toBeLessThan(l.second);
  });

  it('时钟格式化（含倒流负数）', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(59)).toBe('00:00:59');
    expect(formatClock(3661)).toBe('01:01:01');
    expect(formatClock(86399)).toBe('23:59:59');
    expect(formatClock(-90)).toBe('-00:01:30');
  });

  it('停留文案分段', () => {
    expect(dwellText(30)).toBe('你在尽头停留了片刻');
    expect(dwellText(120)).toBe('你在尽头停留了 2 分钟');
    expect(dwellText(3600)).toBe('你在尽头停留了 1 小时');
    expect(dwellText(7325)).toBe('你在尽头停留了 2 小时 2 分钟');
  });

  it('缓动与钳制', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 9);
    expect(easeInOutSine(0)).toBeCloseTo(0, 12);
    expect(easeInOutSine(1)).toBeCloseTo(1, 6);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 6);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });

  // ---------- 相对论玩具箱 ----------

  it('引力时间膨胀：远处趋近 1，越近越慢，单调递增', () => {
    expect(dilationFactor(14)).toBe(dilationFactor(13)); // 钳平区：视界之下时间几乎凝固
    for (let d = 16; d < 200; d += 3) {
      expect(dilationFactor(d)).toBeGreaterThan(dilationFactor(d - 1));
      expect(dilationFactor(d)).toBeLessThanOrEqual(1);
    }
    expect(dilationFactor(13.5)).toBeCloseTo(Math.sqrt(0.05), 6); // 视界下限
    expect(dilationFactor(15.5)).toBeCloseTo(Math.sqrt(1 - 13.5 / 15.5), 6);
    expect(dilationFactor(1e6)).toBeCloseTo(1, 4);
    expect(() => dilationFactor(0)).toThrow(RangeError);
  });

  it('红移：膨胀越慢越红，有界', () => {
    expect(redshiftFromDilation(1)).toBe(0);
    expect(redshiftFromDilation(0.92)).toBe(0);
    expect(redshiftFromDilation(0.3)).toBeGreaterThan(0.9);
    expect(redshiftFromDilation(0.05)).toBe(1); // 封顶
    expect(redshiftFromDilation(-1)).toBe(1);
  });

  it('潮汐拉伸：远处为 1，近处沿径向拉长', () => {
    expect(tidalStretch(20)).toBe(1);
    expect(tidalStretch(13)).toBe(1);
    expect(tidalStretch(12)).toBeGreaterThan(1);
    for (let r = 6; r < 13; r++) expect(tidalStretch(r)).toBeGreaterThan(tidalStretch(r + 1));
    expect(tidalStretch(8.6)).toBeGreaterThan(1.5); // 坠入界附近明显撕裂
    expect(() => tidalStretch(0)).toThrow(RangeError);
    expect(() => tidalStretch(5, 0)).toThrow(RangeError);
  });

  it('彭罗斯能层：环带判定', () => {
    expect(inErgosphere(14)).toBe(true);
    expect(inErgosphere(11.5)).toBe(true);
    expect(inErgosphere(16.5)).toBe(true);
    expect(inErgosphere(11.4)).toBe(false);
    expect(inErgosphere(17)).toBe(false);
    expect(inErgosphere(9)).toBe(false);
  });

  it('熵死时刻表：全覆盖、无重复、可复现、界内', () => {
    const a = entropySchedule(84, 480, rng(7));
    const b = entropySchedule(84, 480, rng(7));
    expect(a).toEqual(b); // 同种子可复现
    expect(a).toHaveLength(84);
    expect(new Set(a).size).toBe(84); // 时刻互不相同
    for (const t of a) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(480);
    }
    const c = entropySchedule(84, 480, rng(8));
    expect(c).not.toEqual(a); // 不同种子不同命运
    expect(() => entropySchedule(0, 100, rng(1))).toThrow(RangeError);
    expect(() => entropySchedule(10, 0, rng(1))).toThrow(RangeError);
  });

  it('元素熵态：剥落前进度单调，倒流复原', () => {
    expect(entropyState(100, 3.5, 50)).toBe(0);   // 未到时刻：附着
    expect(entropyState(100, 3.5, 101.75)).toBeCloseTo(0.5, 6);
    expect(entropyState(100, 3.5, 104)).toBe(1);  // 坠亡
    expect(entropyState(100, 3.5, 1e4)).toBe(1);  // 保持坠亡
    expect(entropyState(100, 3.5, 60)).toBe(0);   // 倒流回去：重新附着
    expect(() => entropyState(1, 0, 1)).toThrow(RangeError);
  });
});
