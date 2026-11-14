/** 五子棋核心（纯函数） */

export const SIZE = 15;
export type Stone = 0 | 1 | 2;  // 0 空 1 黑 2 白
export type Board = Stone[][];

export function createBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0) as Stone[]);
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const;

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/** 检查落子后是否五连 */
export function checkWin(board: Board, r: number, c: number, stone: Stone): boolean {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (let s = 1; inBounds(r + dr * s, c + dc * s) && board[r + dr * s][c + dc * s] === stone; s++) count++;
    for (let s = 1; inBounds(r - dr * s, c - dc * s) && board[r - dr * s][c - dc * s] === stone; s++) count++;
    if (count >= 5) return true;
  }
  return false;
}

/** 某点某方的连子线型评分（进攻/防守共用） */
function lineScore(board: Board, r: number, c: number, stone: Stone): number {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let openEnds = 0;
    let s = 1;
    while (inBounds(r + dr * s, c + dc * s) && board[r + dr * s][c + dc * s] === stone) { count++; s++; }
    if (inBounds(r + dr * s, c + dc * s) && board[r + dr * s][c + dc * s] === 0) openEnds++;
    s = 1;
    while (inBounds(r - dr * s, c - dc * s) && board[r - dr * s][c - dc * s] === stone) { count++; s++; }
    if (inBounds(r - dr * s, c - dc * s) && board[r - dr * s][c - dc * s] === 0) openEnds++;

    if (count >= 5) total += 100000;
    else if (count === 4) total += openEnds === 2 ? 50000 : openEnds === 1 ? 8000 : 0;
    else if (count === 3) total += openEnds === 2 ? 3000 : openEnds === 1 ? 500 : 0;
    else if (count === 2) total += openEnds === 2 ? 300 : openEnds === 1 ? 60 : 0;
    else total += openEnds * 10;
  }
  return total;
}

/** 简单 AI：进攻 + 防守评分，取最高点；带少量随机避免机械感 */
export function bestMove(board: Board, aiStone: Stone): { r: number; c: number } | null {
  const human: Stone = aiStone === 1 ? 2 : 1;
  let best: { r: number; c: number; score: number }[] = [];
  // 只在已有棋子周围两格内搜索
  const candidates = new Set<string>();
  let hasStone = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== 0) {
        hasStone = true;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (inBounds(r + dr, c + dc) && board[r + dr][c + dc] === 0) {
              candidates.add(`${r + dr},${c + dc}`);
            }
          }
        }
      }
    }
  }
  if (!hasStone) return { r: 7, c: 7 };

  for (const key of candidates) {
    const [r, c] = key.split(',').map(Number);
    // 进攻：成五直接赢（最高优先）；活四（下步成五）次优先
    board[r][c] = aiStone;
    const winNow = checkWin(board, r, c, aiStone);
    const attack = lineScore(board, r, c, aiStone);
    board[r][c] = human;
    const blockWin = checkWin(board, r, c, human);
    const defense = lineScore(board, r, c, human);
    board[r][c] = 0;

    let score: number;
    if (winNow) score = 1e12;                    // 直接成五，必下
    else if (attack >= 100000) score = 1e11;     // 活四，下步成五
    else if (blockWin) score = 1e10;             // 对方此处成五，必堵
    else if (defense >= 100000) score = 1e9;     // 对方活四，必须封
    else score = attack * 1.1 + defense;         // 常规攻守权衡
    best.push({ r, c, score });
  }
  best.sort((a, b) => b.score - a.score);
  // 确定性战术（成五/活四/必堵）不参与随机，直接取最优
  if (best[0].score >= 1e9) return { r: best[0].r, c: best[0].c };
  // 常规局面：前 3 名随机，保持一点变化
  const pick = best[Math.floor(Math.random() * Math.min(3, best.length))];
  return pick ? { r: pick.r, c: pick.c } : null;
}
