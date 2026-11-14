/** 2048 核心逻辑（纯函数，可单测） */

export type Grid2048 = number[][];  // 4x4，0 为空

export function createGrid(rng: () => number = Math.random): Grid2048 {
  const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
  spawnTile(grid, rng);
  spawnTile(grid, rng);
  return grid;
}

export function spawnTile(grid: Grid2048, rng: () => number = Math.random): void {
  const empty: [number, number][] = [];
  grid.forEach((row, r) => row.forEach((v, c) => { if (v === 0) empty.push([r, c]); }));
  if (!empty.length) return;
  const [r, c] = empty[Math.floor(rng() * empty.length)];
  grid[r][c] = rng() < 0.9 ? 2 : 4;
}

/** 单行向左压缩合并。返回新行与得分增量。 */
export function slideRow(row: number[]): { row: number[]; gained: number; moved: boolean } {
  const nums = row.filter(v => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const merged = nums[i] * 2;
      out.push(merged);
      gained += merged;
      i++;
    } else out.push(nums[i]);
  }
  while (out.length < 4) out.push(0);
  const moved = out.some((v, i) => v !== row[i]);
  return { row: out, gained, moved };
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** 执行一次移动（原地修改 grid 的副本）。返回 null 表示无变化。 */
export function move(grid: Grid2048, dir: Direction): { grid: Grid2048; gained: number } | null {
  const result: Grid2048 = Array.from({ length: 4 }, () => Array(4).fill(0));
  let gained = 0;
  let anyMoved = false;

  for (let i = 0; i < 4; i++) {
    // 取出对应方向的行/列，统一映射为「向左」
    let line: number[];
    if (dir === 'left') line = grid[i].slice();
    else if (dir === 'right') line = grid[i].slice().reverse();
    else if (dir === 'up') line = [grid[0][i], grid[1][i], grid[2][i], grid[3][i]];
    else line = [grid[3][i], grid[2][i], grid[1][i], grid[0][i]];

    const { row, gained: g, moved } = slideRow(line);
    gained += g;
    anyMoved = anyMoved || moved;

    for (let j = 0; j < 4; j++) {
      if (dir === 'left') result[i][j] = row[j];
      else if (dir === 'right') result[i][3 - j] = row[j];
      else if (dir === 'up') result[j][i] = row[j];
      else result[3 - j][i] = row[j];
    }
  }
  return anyMoved ? { grid: result, gained } : null;
}

export function canMove(grid: Grid2048): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) return true;
      if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

export function hasWon(grid: Grid2048): boolean {
  return grid.some(row => row.some(v => v >= 2048));
}
