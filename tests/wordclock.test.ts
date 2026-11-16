import { describe, it, expect } from 'vitest';
import { GRID, litPositions, reading, periodOf, hour12, hourChars, minuteChars } from '../src/scripts/wordclock-core';

describe('wordclock-core · 分段函数', () => {
  it('periodOf 时段划分', () => {
    expect(periodOf(0)).toBe('凌晨');
    expect(periodOf(4)).toBe('凌晨');
    expect(periodOf(5)).toBe('早上');
    expect(periodOf(9)).toBe('上午');
    expect(periodOf(11)).toBe('中午');
    expect(periodOf(13)).toBe('下午');
    expect(periodOf(17)).toBe('傍晚');
    expect(periodOf(19)).toBe('晚上');
    expect(periodOf(23)).toBe('晚上');
  });

  it('hour12：0 点作十二点', () => {
    expect(hour12(0)).toBe(12);
    expect(hour12(12)).toBe(12);
    expect(hour12(13)).toBe(1);
    expect(hour12(23)).toBe(11);
  });

  it('hourChars / minuteChars 汉字数字', () => {
    expect(hourChars(3)).toEqual(['三']);
    expect(hourChars(10)).toEqual(['十']);
    expect(hourChars(11)).toEqual(['十', '一']);
    expect(minuteChars(0)).toEqual([]);
    expect(minuteChars(7)).toEqual(['七']);
    expect(minuteChars(10)).toEqual(['十']);
    expect(minuteChars(15)).toEqual(['十', '五']);
    expect(minuteChars(20)).toEqual(['二', '十']);
    expect(minuteChars(47)).toEqual(['四', '十', '七']);
    expect(minuteChars(59)).toEqual(['五', '十', '九']);
  });
});

describe('wordclock-core · 亮灯报时', () => {
  it('连读文本即报时（下午三点四十七分）', () => {
    expect(reading(new Date(2026, 10, 16, 15, 47))).toBe('现在是下午三点四十七分');
  });

  it('整点不读「分」（十二点）', () => {
    expect(reading(new Date(2026, 10, 16, 0, 0))).toBe('现在是凌晨十二点');
    expect(reading(new Date(2026, 10, 16, 12, 0))).toBe('现在是中午十二点');
  });

  it('十一点的「十」借上排，保证顺读', () => {
    expect(reading(new Date(2026, 10, 16, 23, 11))).toBe('现在是晚上十一点十一分');
  });

  it('二十分与五十九分', () => {
    expect(reading(new Date(2026, 10, 16, 9, 20))).toBe('现在是上午九点二十分');
    expect(reading(new Date(2026, 10, 16, 23, 59))).toBe('现在是晚上十一点五十九分');
  });

  it('所有亮起位置都落在有字的格子上且不重复', () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 1, 9, 10, 11, 19, 20, 21, 30, 47, 50, 59]) {
        const pos = litPositions(new Date(2026, 0, 1, h, m));
        const keys = pos.map(({ r, c }) => `${r},${c}`);
        expect(new Set(keys).size).toBe(keys.length); // 无重复
        for (const { r, c } of pos) expect(GRID[r][c]).not.toBe('');
      }
    }
  });
});
