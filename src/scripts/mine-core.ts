/** 扫雷核心逻辑（纯函数，可单测） */

export interface Cell {
  mine: boolean;
  adjacent: number;
  revealed: boolean;
  flagged: boolean;
}

export interface Board {
  rows: number;
  cols: number;
  mines: number;
  cells: Cell[];
  started: boolean;   // 首击后才布雷（首击必安全）
  over: boolean;
  won: boolean;
}

export const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10, label: '初级 9×9' },
  medium: { rows: 16, cols: 16, mines: 40, label: '中级 16×16' },
  hard: { rows: 16, cols: 30, mines: 99, label: '高级 16×30' },
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;

export function createBoard(rows: number, cols: number, mines: number): Board {
  return {
    rows, cols, mines,
    cells: Array.from({ length: rows * cols }, () => ({
      mine: false, adjacent: 0, revealed: false, flagged: false,
    })),
    started: false, over: false, won: false,
  };
}

export function neighborsOf(board: Board, index: number): number[] {
  const r = Math.floor(index / board.cols), c = index % board.cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < board.rows && nc >= 0 && nc < board.cols) out.push(nr * board.cols + nc);
    }
  }
  return out;
}

/** 首击时布雷：安全区 = 点击格及其邻居 */
function plantMines(board: Board, safeIndex: number, rng: () => number): void {
  const safe = new Set([safeIndex, ...neighborsOf(board, safeIndex)]);
  const candidates: number[] = [];
  for (let i = 0; i < board.cells.length; i++) if (!safe.has(i)) candidates.push(i);
  // Fisher–Yates 部分洗牌取前 mines 个
  for (let i = 0; i < board.mines && i < candidates.length; i++) {
    const j = i + Math.floor(rng() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    board.cells[candidates[i]].mine = true;
  }
  board.cells.forEach((cell, i) => {
    cell.adjacent = neighborsOf(board, i).filter(n => board.cells[n].mine).length;
  });
}

function floodReveal(board: Board, index: number): void {
  const stack = [index];
  while (stack.length) {
    const i = stack.pop()!;
    const cell = board.cells[i];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.adjacent === 0 && !cell.mine) {
      for (const n of neighborsOf(board, i)) {
        if (!board.cells[n].revealed) stack.push(n);
      }
    }
  }
}

function checkWin(board: Board): void {
  const hiddenSafe = board.cells.filter(c => !c.mine && !c.revealed).length;
  if (hiddenSafe === 0) { board.over = true; board.won = true; }
}

/** 左键揭开。返回是否踩雷。 */
export function reveal(board: Board, index: number, rng: () => number = Math.random): boolean {
  if (board.over) return false;
  const cell = board.cells[index];
  if (cell.flagged || cell.revealed) return false;
  if (!board.started) { plantMines(board, index, rng); board.started = true; }
  if (cell.mine) {
    cell.revealed = true;
    board.over = true; board.won = false;
    board.cells.forEach(c => { if (c.mine) c.revealed = true; });
    return true;
  }
  floodReveal(board, index);
  checkWin(board);
  return false;
}

export function toggleFlag(board: Board, index: number): void {
  if (board.over) return;
  const cell = board.cells[index];
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
}

/** 双击数字格：旗帜数==数字时快速展开周围 */
export function chord(board: Board, index: number, rng: () => number = Math.random): void {
  if (board.over) return;
  const cell = board.cells[index];
  if (!cell.revealed || cell.adjacent === 0) return;
  const neighbors = neighborsOf(board, index);
  const flags = neighbors.filter(n => board.cells[n].flagged).length;
  if (flags !== cell.adjacent) return;
  for (const n of neighbors) {
    if (!board.cells[n].flagged && !board.cells[n].revealed) reveal(board, n, rng);
    if (board.over) return;
  }
}

export function flagCount(board: Board): number {
  return board.cells.filter(c => c.flagged).length;
}

/** 3BV：最少点击数（开局难度指标） */
export function compute3BV(board: Board): number {
  if (!board.started) return 0;
  let bv = 0;
  const visited = new Set<number>();
  for (let i = 0; i < board.cells.length; i++) {
    const c = board.cells[i];
    if (c.mine || visited.has(i)) continue;
    if (c.adjacent === 0) {
      bv++;
      const stack = [i];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const n of neighborsOf(board, cur)) {
          if (!board.cells[n].mine && !visited.has(n)) {
            if (board.cells[n].adjacent === 0) stack.push(n);
            visited.add(n);
          }
        }
      }
    } else bv++;
  }
  return bv;
}
