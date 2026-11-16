import { describe, it, expect } from 'vitest';
import {
  solve24, hasSolution, parseExpr, checkAnswer, evaluate, frac, render, leaves, formatFrac, type Expr,
} from '../src/scripts/twentyfour-core';

/** 求解器给出的式子必须能被解析器吃回去并算出目标值（分数精确），且恰好用完牌面 */
function roundtrip(nums: number[], target = 24): string {
  const s = solve24(nums, target)!;
  const ast = parseExpr(s);
  const v = evaluate(ast)!;
  expect(v.n / v.d).toBe(target);
  expect(v.d).toBe(1);
  expect(leaves(ast).sort((a, b) => a - b)).toEqual([...nums].sort((a, b) => a - b));
  return s;
}

describe('twentyfour-core · 求解器', () => {
  it('基础题', () => {
    expect(roundtrip([2, 3, 4, 1])).toBeTruthy();
    expect(roundtrip([1, 2, 3, 4])).toBeTruthy();
    expect(roundtrip([13, 11, 12, 10])).toBeTruthy();
  });

  it('经典难题 3 3 8 8：只能靠分数 8÷(3−8÷3)', () => {
    expect(roundtrip([3, 3, 8, 8])).toBe('8÷(3−8÷3)');
  });

  it('另一道分数题 1 5 5 5：5×(5−1÷5)', () => {
    const s = roundtrip([1, 5, 5, 5]);
    expect(['5×(5−1÷5)', '(5−1÷5)×5']).toContain(s);
  });

  it('无解返回 null', () => {
    expect(solve24([1, 1, 1, 1])).toBeNull();
    expect(solve24([1, 1, 1, 2])).toBeNull();
    expect(hasSolution([1, 1, 1, 1])).toBe(false);
  });

  it('目标值可换', () => {
    expect(roundtrip([1, 1, 1, 1], 1)).toBeTruthy();
  });
});

describe('twentyfour-core · 渲染最少括号', () => {
  it('同级可省括号', () => {
    expect(render(parseExpr('1+2+3'))).toBe('1+2+3');
    const e2: Expr = { op: '*', l: { v: 2 }, r: { op: '*', l: { v: 3 }, r: { v: 4 } } };
    expect(render(e2)).toBe('2×3×4');
  });

  it('低优先级要括号、− ÷ 右侧同级要括号', () => {
    expect(render(parseExpr('(1+2)*3'))).toBe('(1+2)×3');
    expect(render(parseExpr('5-(3-2)'))).toBe('5−(3−2)');
    expect(render(parseExpr('6/(2*3)'))).toBe('6÷(2×3)');
    expect(render(parseExpr('5+(3-2)'))).toBe('5+3−2');
    expect(render(parseExpr('1-(2+3)'))).toBe('1−(2+3)');
  });
});

describe('twentyfour-core · 分数', () => {
  it('约分与负分母', () => {
    expect(frac(6, 4)).toEqual({ n: 3, d: 2 });
    expect(frac(-3, -6)).toEqual({ n: 1, d: 2 });
    expect(frac(0, 5)).toEqual({ n: 0, d: 1 });
  });

  it('分数格式化', () => {
    expect(formatFrac(frac(24, 1))).toBe('24');
    expect(formatFrac(frac(8, 3))).toBe('8/3（≈2.67）');
  });
});

describe('twentyfour-core · 玩家算式校验', () => {
  const hand = [1, 2, 3, 4];

  it('正确答案', () => {
    expect(checkAnswer('(1+2+3)*4', hand)).toEqual({ ok: true, expr: '(1+2+3)×4' });
    expect(checkAnswer('(4+2)*(3+1)', hand).ok).toBe(true);
    expect(checkAnswer('1*2*3*4', hand).ok).toBe(true);
  });

  it('全角数字与 × ÷ − （） 归一', () => {
    expect(checkAnswer('１×２×３×４', hand).ok).toBe(true);
    expect(checkAnswer('8÷(3−8÷3)', [3, 3, 8, 8]).ok).toBe(true);
  });

  it('数字必须恰好用完', () => {
    expect(checkAnswer('2*3*4', hand).ok).toBe(false);
    expect(checkAnswer('(1+2)*9', hand).ok).toBe(false);
    expect(checkAnswer('1+2+3+4+4', hand).ok).toBe(false);
  });

  it('值不对', () => {
    const r = checkAnswer('1+2+3+4', hand);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不是 24');
  });

  it('语法错误', () => {
    expect(checkAnswer('1+', hand).ok).toBe(false);
    expect(checkAnswer('(1+2', hand).ok).toBe(false);
    expect(checkAnswer('2**3', hand).ok).toBe(false);
    expect(checkAnswer('', hand).ok).toBe(false);
    expect(checkAnswer('1..2+3+4', hand).ok).toBe(false);
  });

  it('除零拦截', () => {
    expect(checkAnswer('1/(2-2)*3*4', hand).ok).toBe(false);
  });
});
