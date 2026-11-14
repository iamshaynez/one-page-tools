import { describe, it, expect } from 'vitest';
import { createGame, steer, step, randomFood, tickInterval, GRID } from '../src/scripts/snake-core';

const rng = () => 0.42;

describe('snake-core', () => {
  it('食物不落在蛇身上（v1 bug 修复）', () => {
    for (let i = 0; i < 200; i++) {
      const state = createGame();
      const grown = { ...state, snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }] };
      const food = randomFood(grown.snake);
      expect(grown.snake.some(p => p.x === food.x && p.y === food.y)).toBe(false);
    }
  });

  it('禁止 180° 掉头', () => {
    const state = createGame();
    // 单节蛇允许掉头（无自撞风险）
    expect(steer(state, 'left').dir).toBe('left');
    // 多节蛇禁止掉头（两节起步）
    const grown = { ...state, snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }] };
    expect(steer(grown, 'left').dir).toBe('right');
    expect(steer(state, 'up').dir).toBe('up');
    const upGrown = { ...grown, dir: 'up' as const, snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }] };
    expect(steer(upGrown, 'down').dir).toBe('up');
  });

  it('吃食物得分并变长', () => {
    let state = createGame(GRID, rng);
    state = { ...state, food: { x: state.snake[0].x + 1, y: state.snake[0].y } };
    const next = step(state, GRID, rng);
    expect(next.score).toBe(1);
    expect(next.snake.length).toBe(2);
  });

  it('撞墙死亡并记录死因', () => {
    let state = createGame();
    state = { ...state, snake: [{ x: GRID - 1, y: 5 }], dir: 'right' };
    const next = step(state);
    expect(next.alive).toBe(false);
    expect(next.deathReason).toBe('wall');
  });

  it('咬到自己死亡', () => {
    let state = createGame();
    // 蛇身绕一圈，头向下会咬到身体
    state = {
      ...state,
      snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }],
      dir: 'down',
      food: { x: 0, y: 0 },
    };
    const next = step(state);
    expect(next.alive).toBe(false);
    expect(next.deathReason).toBe('self');
  });

  it('前进到即将移走的尾格不死', () => {
    let state = createGame();
    state = {
      ...state,
      snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 4 }],
      dir: 'up',
      food: { x: 0, y: 0 },
    };
    // 头 (5,5) 向上到 (5,4)，尾 (5,4) 将移走 → 不死
    const next = step(state);
    expect(next.alive).toBe(true);
  });

  it('速度渐进且有下限', () => {
    expect(tickInterval(0)).toBe(120);
    expect(tickInterval(10)).toBe(90);
    expect(tickInterval(1000)).toBe(55);
  });
});
