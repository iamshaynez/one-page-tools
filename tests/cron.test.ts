import { describe, it, expect } from 'vitest';
import { parseCron, describe as describeCron, nextRuns, matches } from '../src/scripts/cron-core';

describe('cron-core 解析', () => {
  it('基础五段', () => {
    const e = parseCron('*/20 * * * *');
    expect(e.minute.values.has(0)).toBe(true);
    expect(e.minute.values.has(20)).toBe(true);
    expect(e.minute.values.has(40)).toBe(true);
    expect(e.minute.values.size).toBe(3);
  });

  it('范围与列表', () => {
    const e = parseCron('0 9 * * 1-5');
    expect(e.dow.values).toEqual(new Set([1, 2, 3, 4, 5]));
    const e2 = parseCron('0 0 1,15 * *');
    expect(e2.dom.values).toEqual(new Set([1, 15]));
  });

  it('步进范围', () => {
    const e = parseCron('0 8-18/2 * * *');
    expect(e.hour.values).toEqual(new Set([8, 10, 12, 14, 16, 18]));
  });

  it('名称别名', () => {
    const e = parseCron('0 0 * jan mon');
    expect(e.month.values.has(1)).toBe(true);
    expect(e.dow.values.has(1)).toBe(true);
  });

  it('@daily 等快捷', () => {
    const e = parseCron('@daily');
    expect(e.minute.values.has(0)).toBe(true);
    expect(e.hour.values.has(0)).toBe(true);
  });

  it('环绕范围 22-2', () => {
    const e = parseCron('0 22-2 * * *');
    expect(e.hour.values).toEqual(new Set([22, 23, 0, 1, 2]));
  });

  it('非法输入抛错', () => {
    expect(() => parseCron('* * *')).toThrow();
    expect(() => parseCron('99 * * * *')).toThrow();
    expect(() => parseCron('*/0 * * * *')).toThrow();
  });
});

describe('cron-core 求值', () => {
  it('每 20 分钟的下一次触发', () => {
    const e = parseCron('*/20 * * * *');
    const from = new Date('2026-11-14T10:07:00');
    const runs = nextRuns(e, 3, from);
    expect(runs[0].getMinutes()).toBe(20);
    expect(runs[1].getMinutes()).toBe(40);
    expect(runs[2].getMinutes()).toBe(0);
    expect(runs[2].getHours()).toBe(11);
  });

  it('工作日 9 点', () => {
    const e = parseCron('0 9 * * 1-5');
    // 2026-11-14 是周六
    const from = new Date('2026-11-14T10:00:00');
    const runs = nextRuns(e, 1, from);
    expect(runs[0].getDay()).toBe(1); // 下周一
    expect(runs[0].getDate()).toBe(16);
    expect(runs[0].getHours()).toBe(9);
  });

  it('matches 精确匹配', () => {
    const e = parseCron('30 3 * * 0');
    expect(matches(e, new Date('2026-11-15T03:30:00'))).toBe(true);  // 周日
    expect(matches(e, new Date('2026-11-16T03:30:00'))).toBe(false); // 周一
  });

  it('每月 1 号', () => {
    const e = parseCron('0 0 1 * *');
    const runs = nextRuns(e, 2, new Date('2026-11-14T00:00:00'));
    expect(runs[0].getMonth()).toBe(11); // 12 月
    expect(runs[0].getDate()).toBe(1);
    expect(runs[1].getMonth()).toBe(0);  // 次年 1 月
  });
});

describe('cron-core 人话', () => {
  it('每 N 分钟', () => {
    expect(describeCron(parseCron('*/20 * * * *'))).toContain('每 20 分钟');
  });
  it('工作日定点', () => {
    const d = describeCron(parseCron('0 9 * * 1-5'));
    expect(d).toContain('周一');
    expect(d).toContain('09:00');
  });
  it('每分钟', () => {
    expect(describeCron(parseCron('* * * * *'))).toContain('每分钟');
  });
});
