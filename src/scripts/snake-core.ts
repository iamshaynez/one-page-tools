/** 贪食蛇核心逻辑（纯函数，无 DOM，可单测） */

export interface Point { x: number; y: number; }
export type Dir = 'up' | 'down' | 'left' | 'right';

export const GRID = 20;

const VECTORS: Record<Dir, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export interface SnakeState {
  snake: Point[];       // 头在 [0]
  food: Point;
  dir: Dir;
  score: number;
  alive: boolean;
  deathReason: 'wall' | 'self' | null;
}

export function randomFood(snake: Point[], grid = GRID, rng: () => number = Math.random): Point {
  // 修复 v1 bug：食物不得落在蛇身上
  const occupied = new Set(snake.map(p => p.y * grid + p.x));
  const free: number[] = [];
  for (let i = 0; i < grid * grid; i++) if (!occupied.has(i)) free.push(i);
  const idx = free[Math.floor(rng() * free.length)];
  return { x: idx % grid, y: Math.floor(idx / grid) };
}

export function createGame(grid = GRID, rng?: () => number): SnakeState {
  const snake = [{ x: Math.floor(grid / 2), y: Math.floor(grid / 2) }];
  return { snake, food: randomFood(snake, grid, rng), dir: 'right', score: 0, alive: true, deathReason: null };
}

/** 转向：禁止 180° 掉头 */
export function steer(state: SnakeState, dir: Dir): SnakeState {
  if (OPPOSITE[state.dir] === dir && state.snake.length > 1) return state;
  return { ...state, dir };
}

/** 推进一格。原地返回新状态（不可变）。 */
export function step(state: SnakeState, grid = GRID, rng?: () => number): SnakeState {
  if (!state.alive) return state;
  const v = VECTORS[state.dir];
  const head = { x: state.snake[0].x + v.x, y: state.snake[0].y + v.y };

  if (head.x < 0 || head.x >= grid || head.y < 0 || head.y >= grid) {
    return { ...state, alive: false, deathReason: 'wall' };
  }
  const eats = head.x === state.food.x && head.y === state.food.y;
  // 不吃食物时尾巴将移走，故撞尾不算死
  const bodyToCheck = eats ? state.snake : state.snake.slice(0, -1);
  if (bodyToCheck.some(p => p.x === head.x && p.y === head.y)) {
    return { ...state, alive: false, deathReason: 'self' };
  }

  const snake = [head, ...state.snake];
  if (!eats) snake.pop();
  return {
    ...state,
    snake,
    score: eats ? state.score + 1 : state.score,
    food: eats ? randomFood(snake, grid, rng) : state.food,
  };
}

/** 速度渐进：分数越高间隔越短，120ms 起步，最低 55ms */
export function tickInterval(score: number): number {
  return Math.max(55, 120 - score * 3);
}
