/** 周易铜钱卦核心（纯函数）：三枚铜钱六掷成卦，老阴老阳动而变卦。 */
import { TRIGRAM_NAMES, TRIGRAM_NATURE, COMPOSITION, byNo, type Hexagram } from '../data/hexagrams';

export type Line = 6 | 7 | 8 | 9;
// 6 老阴（三字，动）· 7 少阳（一背）· 8 少阴（二背）· 9 老阳（三背，动）

/** 背记 3、字记 2：三枚铜钱背面数 0–3 → 爻值 */
export function lineFromCoins(backs: number): Line {
  return ([6, 7, 8, 9] as Line[])[backs];
}

export const isYang = (l: Line) => l === 7 || l === 9;
export const isMoving = (l: Line) => l === 6 || l === 9;

/** 三爻（下中上）的二进制值 → 八卦序号 */
function trigramIndex(bits: [boolean, boolean, boolean]): number {
  return (bits[0] ? 1 : 0) | (bits[1] ? 2 : 0) | (bits[2] ? 4 : 0);
}

export interface CastHex {
  no: number;
  name: string;
  nature: string;   // 取象，如「地天」
  upper: string;    // 上卦名
  lower: string;    // 下卦名
  judgement: string;
}

/** 六爻（下标 0 = 初爻 … 5 = 上爻）→ 卦 */
export function hexagramOf(lines: Line[]): CastHex {
  const lower = trigramIndex([isYang(lines[0]), isYang(lines[1]), isYang(lines[2])]);
  const upper = trigramIndex([isYang(lines[3]), isYang(lines[4]), isYang(lines[5])]);
  const no = COMPOSITION[upper][lower];
  const h: Hexagram = byNo(no);
  return {
    no, name: h.name,
    nature: TRIGRAM_NATURE[upper] + TRIGRAM_NATURE[lower],
    upper: TRIGRAM_NAMES[upper], lower: TRIGRAM_NAMES[lower],
    judgement: h.judgement,
  };
}

/** 动爻（6/9）变阴阳后之卦；无动爻返回 null */
export function changedOf(lines: Line[]): CastHex | null {
  if (!lines.some(isMoving)) return null;
  return hexagramOf(lines.map((l) => (isMoving(l) ? (isYang(l) ? 6 : 9) : l)) as Line[]);
}

/** 动爻位序（0 = 初爻） */
export const movingPositions = (lines: Line[]): number[] =>
  lines.map((l, i) => (isMoving(l) ? i : -1)).filter((i) => i >= 0);

/** 爻题：初九 / 六二 / 上六 …… */
export function lineName(pos: number, yang: boolean): string {
  const places = ['初', '二', '三', '四', '五', '上'];
  const yinYang = yang ? '九' : '六';
  if (pos === 0) return places[0] + yinYang;
  if (pos === 5) return places[5] + yinYang;
  return yinYang + places[pos];
}

/** 一掷的口语注解：如「三背 · 老阳」 */
export function tossLabel(backs: number): string {
  const coins = ['三字', '一背二字', '二背一字', '三背'][backs];
  const line = lineFromCoins(backs);
  const name = line === 9 ? '老阳' : line === 8 ? '少阴' : line === 7 ? '少阳' : '老阴';
  return `${coins} · ${name}`;
}
