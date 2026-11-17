/**
 * 九型快测核心（纯函数）：三十六对配对迫选，被选陈述给其型 +1 票。
 * 每型八票机会 → 主型（最高票，同分并列）/ 翼型（主型相邻两型环绕取高），
 * 箭头走向查通行公域表。
 */
import { PAIRS, type EnnNo, type Pick } from '../data/enneagram-questions';
import { ennByNo, ARROWS, type EnnType } from '../data/enneagram-types';

/** 36 对作答：'a' | 'b' | null（未答） */
export type EnnAnswers = (Pick | null)[];

export interface EnnScore {
  no: EnnNo;
  raw: number;   // 0–8 票
  pct: number;   // 票率 0–100
}

export interface EnnResult {
  scores: EnnScore[];              // 按型号 1–9 排序
  main: EnnType;                   // 展示主型（并列中编号小者）
  tiedWith: EnnType[];             // 与主型同分的并列型（不含 main，可为空）
  wing: { type: EnnType; both: boolean } | null; // 邻型票高者为翼；both=双翼同分
  growth: EnnType;                 // 成长箭头指向
  stress: EnnType;                 // 压力箭头指向
}

/** 主型相邻两翼（环绕：壹邻玖与贰，玖邻捌与壹） */
export const wingsOf = (no: EnnNo): [EnnNo, EnnNo] => [
  (((no + 7) % 9) + 1) as EnnNo, // no - 1，环绕
  ((no % 9) + 1) as EnnNo,       // no + 1，环绕
];

/** 作答 → 九型计票（下标 1–9；null 跳过） */
export function tallyEnn(answers: EnnAnswers): number[] {
  const votes = Array(10).fill(0) as number[];
  answers.forEach((pick, i) => {
    const p = PAIRS[i];
    if (!p || (pick !== 'a' && pick !== 'b')) return;
    votes[pick === 'a' ? p.aNo : p.bNo]++;
  });
  return votes;
}

/** 全量作答 → 结果；未答完或长度不符返回 null */
export function scoreEnn(answers: EnnAnswers): EnnResult | null {
  if (answers.length !== PAIRS.length) return null;
  if (answers.some((a) => a !== 'a' && a !== 'b')) return null;

  const votes = tallyEnn(answers);
  const scores: EnnScore[] = Array.from({ length: 9 }, (_, i) => {
    const no = (i + 1) as EnnNo;
    return { no, raw: votes[no], pct: Math.round((votes[no] / 8) * 100) };
  });

  const max = Math.max(...scores.map((s) => s.raw));
  const top = scores.filter((s) => s.raw === max).map((s) => ennByNo(s.no));
  const main = top[0];
  const tiedWith = top.slice(1);

  const [lw, rw] = wingsOf(main.no);
  const wing = { type: ennByNo(votes[lw] >= votes[rw] ? lw : rw), both: votes[lw] === votes[rw] };

  return {
    scores,
    main,
    tiedWith,
    wing,
    growth: ennByNo(ARROWS[main.no].growth),
    stress: ennByNo(ARROWS[main.no].stress),
  };
}
