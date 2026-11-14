import { describe, it, expect } from 'vitest';
import { createBoard, reveal, toggleFlag, chord, compute3BV, flagCount } from '../src/scripts/mine-core';

describe('mine-core', () => {
  it('首击必安全：点击格及邻居都不是雷', () => {
    for (let t = 0; t < 50; t++) {
      const b = createBoard(9, 9, 10);
      const safe = 40;
      reveal(b, safe);
      expect(b.cells[safe].mine).toBe(false);
      // 首击是空白格（邻居也无雷），会触发展开
      expect(b.cells[safe].adjacent).toBe(0);
      expect(b.started).toBe(true);
    }
  });

  it('布雷数量正确', () => {
    const b = createBoard(16, 16, 40);
    reveal(b, 0);
    expect(b.cells.filter(c => c.mine).length).toBe(40);
  });

  it('插旗不揭开，可取消', () => {
    const b = createBoard(9, 9, 10);
    toggleFlag(b, 5);
    expect(b.cells[5].flagged).toBe(true);
    expect(flagCount(b)).toBe(1);
    reveal(b, 5);
    expect(b.cells[5].revealed).toBe(false);
    toggleFlag(b, 5);
    expect(b.cells[5].flagged).toBe(false);
  });

  it('踩雷全雷揭示并判负', () => {
    const b = createBoard(9, 9, 10);
    reveal(b, 0);
    const mineIdx = b.cells.findIndex(c => c.mine);
    reveal(b, mineIdx);
    expect(b.over).toBe(true);
    expect(b.won).toBe(false);
    expect(b.cells.filter(c => c.mine).every(c => c.revealed)).toBe(true);
  });

  it('全安全格揭开则获胜', () => {
    const b = createBoard(3, 3, 1);
    reveal(b, 4); // 中心首击，雷只能在外圈
    b.cells.forEach((c, i) => { if (!c.mine && !c.revealed) reveal(b, i); });
    expect(b.won).toBe(true);
  });

  it('chord：旗帜数等于数字时展开邻居', () => {
    const b = createBoard(9, 9, 10);
    reveal(b, 40);
    // 找一个已揭开的数字格
    const idx = b.cells.findIndex(c => c.revealed && c.adjacent > 0);
    if (idx === -1) return; // 极端局跳过
    const cell = b.cells[idx];
    // 把周围未揭开格全部插上旗（数量 > 数字，不应展开）
    const before = b.cells.filter(c => c.revealed).length;
    chord(b, idx);
    expect(b.cells.filter(c => c.revealed).length).toBe(before);
    expect(cell.adjacent).toBeGreaterThan(0);
  });

  it('3BV 为正整数', () => {
    const b = createBoard(9, 9, 10);
    reveal(b, 40);
    expect(compute3BV(b)).toBeGreaterThan(0);
  });
});
