/** 汉字时钟核心（纯函数）：一版汉字方阵，时间到了谁，谁就亮起。 */

export interface Pos { r: number; c: number; }

/** 时段划分（按 24 小时制小时数） */
export function periodOf(hour: number): string {
  if (hour < 5) return '凌晨';
  if (hour < 8) return '早上';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  return '晚上';
}

const DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 12 小时制小时（0 点作十二点） */
export function hour12(hour: number): number {
  return ((hour + 11) % 12) + 1;
}

/** 1–12 的汉字：十以内单字，十一/十二两字 */
export function hourChars(h: number): string[] {
  if (h <= 9) return [DIGITS[h - 1]];
  if (h === 10) return ['十'];
  return ['十', DIGITS[h - 11]];
}

/** 分钟 0–59 的汉字：0 为空（整点只读「X点」） */
export function minuteChars(m: number): string[] {
  if (m === 0) return [];
  if (m <= 9) return [DIGITS[m - 1]];
  if (m === 10) return ['十'];
  if (m <= 19) return ['十', DIGITS[m - 11]];
  const tens = Math.floor(m / 10);
  const ones = m % 10;
  const out = [DIGITS[tens - 1], '十'];
  if (ones > 0) out.push(DIGITS[ones - 1]);
  return out;
}

/**
 * 固定字版（11 列 × 7 行，'' 为留白）：
 *  r0  现在是
 *  r1/2 时段（两行竖读：凌晨 / 早上 / 上午 / 中午 / 下午 / 傍晚 / 晚上）
 *  r3/4 时辰数字，r4 末列为「点」
 *  r5/6 分钟数字，r6 末列为「分」
 * 两行数字使 11–19 / X1–X9 都能从上到下顺读（如 47 = 四十七）。
 */
export const GRID: string[][] = [
  ['现', '在', '是', '', '', '', '', '', '', '', ''],
  ['', '凌', '早', '上', '中', '下', '傍', '晚', '', '', ''],
  ['', '晨', '上', '午', '午', '午', '晚', '上', '', '', ''],
  ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', ''],
  ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '点'],
  ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', ''],
  ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '分'],
];

const PERIOD_COL: Record<string, number> = { 凌晨: 1, 早上: 2, 上午: 3, 中午: 4, 下午: 5, 傍晚: 6, 晚上: 7 };

/** 某时刻应亮起的格子（按行列排序，连读即为报时文本） */
export function litPositions(date: Date): Pos[] {
  const h = date.getHours();
  const m = date.getMinutes();
  const h12v = hour12(h);
  const pos: Pos[] = [
    { r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, // 现在是
  ];

  // 时段（竖读两格）
  const pc = PERIOD_COL[periodOf(h)];
  pos.push({ r: 1, c: pc }, { r: 2, c: pc });

  // 时：1–9 与 10 落在下排；11/12 的「十」借上排，保证顺读（十 一 点）
  if (h12v >= 11) pos.push({ r: 3, c: 9 }, { r: 4, c: h12v - 11 });
  else pos.push({ r: 4, c: h12v === 10 ? 9 : h12v - 1 });
  pos.push({ r: 4, c: 10 }); // 点

  // 分：1–9 与 10 落在下排；11–19 的「十」借上排；20+ 十位与「十」同在上排
  if (m > 0) {
    pos.push({ r: 6, c: 10 }); // 分
    if (m <= 10) pos.push({ r: 6, c: m === 10 ? 9 : m - 1 });
    else if (m <= 19) pos.push({ r: 5, c: 9 }, { r: 6, c: m - 11 });
    else {
      pos.push({ r: 5, c: Math.floor(m / 10) - 1 }, { r: 5, c: 9 });
      if (m % 10 > 0) pos.push({ r: 6, c: (m % 10) - 1 });
    }
  }

  return pos.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** 连读文本（测试与无障碍用） */
export function reading(date: Date): string {
  return litPositions(date).map(({ r, c }) => GRID[r][c]).join('');
}
