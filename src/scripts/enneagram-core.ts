/**
 * 九型快测核心（纯函数）：每型四条陈述计和 → 主型 / 并列 / 翼型 / 箭头。
 * 主型同分视为并列：并列型一并列出，展示取其首（编号小者）；
 * 翼型取主型相邻两型（环绕：壹邻玖与贰）中得分高者，同分为双翼。
 */
import { STATEMENTS, type EnnNo, type Rating } from '../data/enneagram-questions';
import { ennByNo, ARROWS, type EnnType } from '../data/enneagram-types';

/** 36 条作答：1–5 认同度 | null（未答） */
export type EnnAnswers = (Rating | null)[];

export interface EnnScore {
  no: EnnNo;
  raw: number;   // 4–20
  pct: number;   // 归一化 0–100
}

export interface EnnResult {
  scores: EnnScore[];              // 按型号 1–9 排序
  main: EnnType;                   // 展示主型（并列中编号小者）
  tiedWith: EnnType[];             // 与主型同分的并列型（不含 main，可为空）
  wing: { type: EnnType; both: boolean } | null; // 邻型分高者为翼；both=双翼同分
  growth: EnnType;                 // 成长箭头指向
  stress: EnnType;                 // 压力箭头指向
}

/** 主型相邻两翼（环绕：壹邻玖与贰，玖邻捌与壹） */
export const wingsOf = (no: EnnNo): [EnnNo, EnnNo] => [
  (((no + 7) % 9) + 1) as EnnNo, // no - 1，环绕
  ((no % 9) + 1) as EnnNo,       // no + 1，环绕
];

/** 作答 → 九型原始分（null 跳过；某型四条全空则记 0 票） */
export function tallyEnn(answers: EnnAnswers): number[] {
  const sums = Array(10).fill(0) as number[]; // 下标 1–9
  answers.forEach((r, i) => {
    if (r === null || r === undefined) return;
    const s = STATEMENTS[i];
    if (s) sums[s.no] += r;
  });
  return sums;
}

function pctOf(raw: number): number {
  return Math.round(((raw - 4) / 16) * 100);
}

/** 全量作答 → 结果；未答完或长度不符返回 null */
export function scoreEnn(answers: EnnAnswers): EnnResult | null {
  if (answers.length !== STATEMENTS.length) return null;
  if (answers.some((a) => typeof a !== 'number')) return null;

  const sums = tallyEnn(answers);
  const scores: EnnScore[] = Array.from({ length: 9 }, (_, i) => {
    const no = (i + 1) as EnnNo;
    return { no, raw: sums[no], pct: pctOf(sums[no]) };
  });

  const max = Math.max(...scores.map((s) => s.raw));
  const top = scores.filter((s) => s.raw === max).map((s) => ennByNo(s.no));
  const main = top[0];
  const tiedWith = top.slice(1);

  const [lw, rw] = wingsOf(main.no);
  const lRaw = sums[lw], rRaw = sums[rw];
  const wing = { type: ennByNo(lRaw >= rRaw ? lw : rw), both: lRaw === rRaw };

  return {
    scores,
    main,
    tiedWith,
    wing,
    growth: ennByNo(ARROWS[main.no].growth),
    stress: ennByNo(ARROWS[main.no].stress),
  };
}
