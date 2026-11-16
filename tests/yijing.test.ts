import { describe, it, expect } from 'vitest';
import {
  lineFromCoins, isYang, isMoving, hexagramOf, changedOf, movingPositions, lineName, tossLabel,
} from '../src/scripts/yijing-core';
import { COMPOSITION, HEXAGRAMS, TRIGRAM_NAMES } from '../src/data/hexagrams';

const L = (b: boolean, moving: 0 | 6 | 9 = 0): 6 | 7 | 8 | 9 =>
  b ? (moving === 9 ? 9 : 7) : (moving === 6 ? 6 : 8);

describe('yijing-core · 铜钱成爻', () => {
  it('背面数 → 爻值（背记 3、字记 2，和为 6/7/8/9）', () => {
    expect(lineFromCoins(0)).toBe(6); // 三字 = 6 老阴
    expect(lineFromCoins(1)).toBe(7); // 一背 = 7 少阳
    expect(lineFromCoins(2)).toBe(8); // 二背 = 8 少阴
    expect(lineFromCoins(3)).toBe(9); // 三背 = 9 老阳
  });

  it('阴阳与动爻判定', () => {
    expect(isYang(7)).toBe(true);
    expect(isYang(9)).toBe(true);
    expect(isYang(6)).toBe(false);
    expect(isYang(8)).toBe(false);
    expect([6, 7, 8, 9].filter(isMoving)).toEqual([6, 9]);
  });

  it('掷注口语', () => {
    expect(tossLabel(3)).toBe('三背 · 老阳');
    expect(tossLabel(0)).toBe('三字 · 老阴');
  });
});

describe('yijing-core · 成卦', () => {
  it('乾坤及重卦', () => {
    expect(hexagramOf([L(1), L(1), L(1), L(1), L(1), L(1)]).name).toBe('乾');
    expect(hexagramOf([L(0), L(0), L(0), L(0), L(0), L(0)]).name).toBe('坤');
    expect(hexagramOf([L(0), L(1), L(0), L(0), L(1), L(0)]).name).toBe('坎');
    expect(hexagramOf([L(1), L(0), L(1), L(1), L(0), L(1)]).name).toBe('离');
  });

  it('地天泰 / 天地否 / 水火既济 / 火水未济', () => {
    const tai = hexagramOf([L(1), L(1), L(1), L(0), L(0), L(0)]); // 下乾上坤
    expect(tai.no).toBe(11);
    expect(tai.name).toBe('泰');
    expect(tai.nature).toBe('地天');
    const pi = hexagramOf([L(0), L(0), L(0), L(1), L(1), L(1)]);
    expect(pi.no).toBe(12);
    expect(pi.upper).toBe('乾');
    expect(pi.lower).toBe('坤');
    expect(hexagramOf([L(1), L(0), L(1), L(0), L(1), L(0)]).no).toBe(63); // 下离上坎 → 既济
    expect(hexagramOf([L(0), L(1), L(0), L(1), L(0), L(1)]).no).toBe(64); // 下坎上离 → 未济
  });

  it('卦序表 1–64 各出现一次', () => {
    const seen = COMPOSITION.flat();
    expect(seen).toHaveLength(64);
    expect(new Set(seen).size).toBe(64);
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(64);
    expect(HEXAGRAMS).toHaveLength(64);
    expect(HEXAGRAMS.every((h, i) => h.no === i + 1 && h.judgement.length > 0)).toBe(true);
    expect(new Set(TRIGRAM_NAMES).size).toBe(8);
  });

  it('全部 64 卦都能通过六爻取到', () => {
    for (const h of HEXAGRAMS) {
      // 反查卦序表找上/下卦，再由六爻还原
      const upper = COMPOSITION.findIndex((row) => row.includes(h.no));
      const lower = COMPOSITION[upper].indexOf(h.no);
      const lines = [0, 1, 2].map((k) => (lower & (1 << k)) !== 0)
        .concat([0, 1, 2].map((k) => (upper & (1 << k)) !== 0))
        .map((b) => (b ? 7 : 8)) as (6 | 7 | 8 | 9)[];
      expect(hexagramOf(lines).no).toBe(h.no);
    }
  });
});

describe('yijing-core · 变卦与爻题', () => {
  it('无动爻则无之卦', () => {
    const lines = [L(1), L(0), L(1), L(0), L(1), L(0)];
    expect(changedOf(lines)).toBeNull();
    expect(movingPositions(lines)).toEqual([]);
  });

  it('老阳变阴、老阴变阳', () => {
    // 乾卦九三动（下卦变兑）→ 之卦天泽履
    const lines = [L(1), L(1), L(1, 9), L(1), L(1), L(1)];
    expect(movingPositions(lines)).toEqual([2]);
    const zhi = changedOf(lines)!;
    expect(zhi.name).toBe('履');
    expect(zhi.no).toBe(10);
    // 坤卦初六动 → 之卦复
    const lines2 = [L(0, 6), L(0), L(0), L(0), L(0), L(0)];
    const zhi2 = changedOf(lines2)!;
    expect(zhi2.name).toBe('复');
    expect(zhi2.no).toBe(24);
  });

  it('爻题：初九、九五、上六、六三', () => {
    expect(lineName(0, true)).toBe('初九');
    expect(lineName(0, false)).toBe('初六');
    expect(lineName(4, true)).toBe('九五');
    expect(lineName(5, true)).toBe('上九');
    expect(lineName(5, false)).toBe('上六');
    expect(lineName(2, false)).toBe('六三');
    expect(lineName(1, true)).toBe('九二');
  });
});
