/**
 * 人格四维快测核心（纯函数）：计票、同分裁决、倾向强度、定型。
 * 同分裁决沿用快测评测的通行惯例：I / N / F / P。
 */
import {
  QUESTIONS, DIM_INFO,
  type Dim, type Pole, type Pick,
} from '../data/mbti-questions';
import { typeByCode, type MbtiType, type Role } from '../data/mbti-types';

/** 36 题作答序列：'a' | 'b' | null（未答） */
export type Answers = (Pick | null)[];

export const OPPOSITE: Record<Pole, Pole> = { E: 'I', I: 'E', S: 'N', N: 'S', T: 'F', F: 'T', J: 'P', P: 'J' };

/** 各维度同分时的默认极（惯例：I/N/F/P） */
export const TIE_DEFAULT: Record<Dim, Pole> = { EI: 'I', SN: 'N', TF: 'F', JP: 'P' };

export type Clarity = '持平' | '略偏' | '分明' | '显著';

export interface DimScore {
  dim: Dim;
  left: Pole;       // 维度左极（E/S/T/J）
  right: Pole;      // 维度右极（I/N/F/P）
  leftCount: number;
  rightCount: number;
  winner: Pole;
  ratio: number;    // 胜方得票率 0–1，同分为 0.5
  tie: boolean;
  clarity: Clarity;
}

export interface MbtiResult {
  code: string;     // 四字母
  type: MbtiType;   // 图鉴条目
  dims: DimScore[]; // 依 EI/SN/TF/JP 顺序
}

/** 作答序列 → 八极计票（null 跳过） */
export function tally(answers: Answers): Record<Pole, number> {
  const t: Record<Pole, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
  answers.forEach((pick, i) => {
    const q = QUESTIONS[i];
    if (!q || !pick) return;
    const aPole = q.aPole;
    if (pick === 'a') t[aPole]++;
    else t[OPPOSITE[aPole]]++;
  });
  return t;
}

function clarityOf(ratio: number, tie: boolean): Clarity {
  if (tie) return '持平';
  if (ratio >= 7 / 9) return '显著';
  if (ratio >= 6 / 9) return '分明';
  return '略偏';
}

/** 计票 → 四维得分（含同分裁决与清晰度） */
export function dimScores(t: Record<Pole, number>): DimScore[] {
  return (Object.keys(DIM_INFO) as Dim[]).map((dim) => {
    const info = DIM_INFO[dim];
    const left = info.left, right = info.right;
    const leftCount = t[left], rightCount = t[right];
    const tie = leftCount === rightCount;
    const winner = tie ? TIE_DEFAULT[dim] : leftCount > rightCount ? left : right;
    const ratio = tie ? 0.5 : Math.max(leftCount, rightCount) / (leftCount + rightCount);
    return { dim, left, right, leftCount, rightCount, winner, ratio, tie, clarity: clarityOf(ratio, tie) };
  });
}

/** 四维得分 → 四字母代码 */
export function typeCode(dims: DimScore[]): string {
  return dims.map((d) => d.winner).join('');
}

/** 四字母 → 四大角色（NT 理性 / NF 理想 / SJ 秩序 / SP 体验） */
export function roleOf(code: string): Role {
  if (code[1] === 'N') return code[2] === 'T' ? 'nt' : 'nf';
  return code[3] === 'J' ? 'sj' : 'sp';
}

/** 全量作答 → 结果；未答完返回 null */
export function scoreMbti(answers: Answers): MbtiResult | null {
  if (answers.length !== QUESTIONS.length) return null;
  if (answers.some((a) => a !== 'a' && a !== 'b')) return null;
  const dims = dimScores(tally(answers));
  const code = typeCode(dims);
  const type = typeByCode(code);
  if (!type) return null;
  return { code, type, dims };
}
