import { describe, it, expect } from 'vitest';
import { createGrid, slideRow, move, canMove, hasWon } from '../src/scripts/g2048-core';
import { generateSecret, isValidGuess, judge } from '../src/scripts/bulls-core';
import { createBoard, checkWin, bestMove, SIZE } from '../src/scripts/gomoku-core';

describe('g2048-core', () => {
  it('slideRow 基础合并', () => {
    expect(slideRow([2, 2, 0, 0])).toEqual({ row: [4, 0, 0, 0], gained: 4, moved: true });
    expect(slideRow([2, 2, 2, 0])).toEqual({ row: [4, 2, 0, 0], gained: 4, moved: true });
    expect(slideRow([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8, moved: true });
    expect(slideRow([4, 2, 2, 4])).toEqual({ row: [4, 4, 4, 0], gained: 4, moved: true });
  });

  it('slideRow 无变化', () => {
    const r = slideRow([2, 4, 8, 16]);
    expect(r.moved).toBe(false);
    expect(r.gained).toBe(0);
  });

  it('新合成块本回合不再合并', () => {
    // [4,4,8,0] → [8,8,0,0]，不能连锁成 16
    expect(slideRow([4, 4, 8, 0]).row).toEqual([8, 8, 0, 0]);
  });

  it('move 左移', () => {
    const grid = [
      [0, 2, 0, 2],
      [0, 0, 0, 0],
      [4, 0, 4, 4],
      [0, 0, 0, 0],
    ];
    const r = move(grid, 'left')!;
    expect(r.grid[0]).toEqual([4, 0, 0, 0]);
    expect(r.grid[2]).toEqual([8, 4, 0, 0]);
    expect(r.gained).toBe(12);
  });

  it('move 右移与上下', () => {
    const grid = [
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(move(grid, 'up')!.grid[0][0]).toBe(4);
    expect(move(grid, 'down')!.grid[3][0]).toBe(4);
    expect(move(grid, 'left')).toBeNull(); // 块已贴左，无变化
    expect(move(grid, 'right')).not.toBeNull();
  });

  it('无效移动返回 null', () => {
    const grid = [
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(move(grid, 'left')).toBeNull();
  });

  it('满盘有相邻同值仍可移动', () => {
    const grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ];
    expect(canMove(grid)).toBe(true);
    const dead = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    expect(canMove(dead)).toBe(false);
  });

  it('hasWon', () => {
    const grid = createGrid();
    expect(hasWon(grid)).toBe(false);
    grid[2][3] = 2048;
    expect(hasWon(grid)).toBe(true);
  });
});

describe('bulls-core', () => {
  it('secret 规则：4 位不重复，首位非 0', () => {
    for (let i = 0; i < 100; i++) {
      const s = generateSecret();
      expect(isValidGuess(s)).toBe(true);
      expect(s[0]).not.toBe('0');
    }
  });

  it('judge 全对', () => {
    expect(judge('1234', '1234')).toEqual({ a: 4, b: 0 });
  });

  it('judge 全错位', () => {
    expect(judge('1234', '4321')).toEqual({ a: 0, b: 4 });
  });

  it('judge 混合', () => {
    expect(judge('1234', '1536')).toEqual({ a: 2, b: 0 }); // 1、3 位置都对
    expect(judge('1234', '1432')).toEqual({ a: 2, b: 2 }); // 1、4 对位，2、3 错位
    expect(judge('1234', '5678')).toEqual({ a: 0, b: 0 });
  });

  it('isValidGuess 校验', () => {
    expect(isValidGuess('1123')).toBe(false); // 重复
    expect(isValidGuess('123')).toBe(false);   // 位数
    expect(isValidGuess('0123')).toBe(true);   // 0 可出现在非首位（guess 不限制首位）
  });
});

describe('gomoku-core', () => {
  it('空盘无胜', () => {
    const b = createBoard();
    expect(checkWin(b, 7, 7, 1)).toBe(false);
  });

  it('横竖斜五连', () => {
    const b = createBoard();
    for (let i = 0; i < 5; i++) b[7][3 + i] = 1;
    expect(checkWin(b, 7, 5, 1)).toBe(true);

    const b2 = createBoard();
    for (let i = 0; i < 5; i++) b2[2 + i][4] = 2;
    expect(checkWin(b2, 5, 4, 2)).toBe(true);

    const b3 = createBoard();
    for (let i = 0; i < 5; i++) b3[3 + i][3 + i] = 1;
    expect(checkWin(b3, 5, 5, 1)).toBe(true);

    const b4 = createBoard();
    for (let i = 0; i < 5; i++) b4[3 + i][9 - i] = 2;
    expect(checkWin(b4, 5, 7, 2)).toBe(true);
  });

  it('四连不胜', () => {
    const b = createBoard();
    for (let i = 0; i < 4; i++) b[7][3 + i] = 1;
    expect(checkWin(b, 7, 5, 1)).toBe(false);
  });

  it('AI 空盘落中心', () => {
    const b = createBoard();
    expect(bestMove(b, 2)).toEqual({ r: 7, c: 7 });
  });

  it('AI 必赢时直接赢', () => {
    const b = createBoard();
    // 白棋（AI）四连，应直接补第五子
    b[7][3] = 2; b[7][4] = 2; b[7][5] = 2; b[7][6] = 2;
    b[6][6] = 1;
    const mv = bestMove(b, 2)!;
    expect(mv.r).toBe(7);
    expect(mv.c === 2 || mv.c === 7).toBe(true);
  });

  it('AI 必堵对方四连', () => {
    const b = createBoard();
    // 黑棋（人）四连，白棋（AI）必须堵
    b[7][3] = 1; b[7][4] = 1; b[7][5] = 1; b[7][6] = 1;
    b[0][0] = 2; // AI 有子激活搜索
    const mv = bestMove(b, 2)!;
    expect(mv.r).toBe(7);
    expect(mv.c === 2 || mv.c === 7).toBe(true);
  });

  it('棋盘尺寸正确', () => {
    const b = createBoard();
    expect(b.length).toBe(SIZE);
    expect(b[0].length).toBe(SIZE);
  });
});
