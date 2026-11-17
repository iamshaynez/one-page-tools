import { describe, it, expect } from 'vitest';
import { QUESTIONS, DIM_INFO, WORDPAIR_PROMPT } from '../src/data/mbti-questions';
import { MBTI_TYPES, ROLES } from '../src/data/mbti-types';
import {
  tally, dimScores, typeCode, roleOf, scoreMbti,
  OPPOSITE, TIE_DEFAULT, type Pole, type Answers,
} from '../src/scripts/mbti-core';

const POLES_OF: Record<string, [Pole, Pole]> = {
  EI: ['E', 'I'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P'],
};

describe('mbti · 题库结构', () => {
  it('共六十题，每维度恰十五题（情境九 + 词对六）', () => {
    expect(QUESTIONS).toHaveLength(60);
    for (const dim of Object.keys(POLES_OF) as (keyof typeof POLES_OF)[]) {
      const of = QUESTIONS.filter((q) => q.dim === dim);
      expect(of).toHaveLength(15);
      expect(of.filter((q) => q.kind === 'situation')).toHaveLength(9);
      expect(of.filter((q) => q.kind === 'wordpair')).toHaveLength(6);
    }
  });

  it('词对题统一引导语', () => {
    const wp = QUESTIONS.filter((q) => q.kind === 'wordpair');
    expect(wp).toHaveLength(24);
    for (const q of wp) expect(q.text).toBe(WORDPAIR_PROMPT);
  });

  it('四维轮转排布：相邻四题不重维', () => {
    for (let i = 0; i < QUESTIONS.length; i += 4) {
      const group = QUESTIONS.slice(i, i + 4).map((q) => q.dim);
      expect(new Set(group).size).toBe(4);
    }
  });

  it('aPole 与维度匹配，文案非空且不重复（情境题面与词对词对各不重复）', () => {
    const texts = new Set<string>();
    const pairs = new Set<string>();
    for (const q of QUESTIONS) {
      expect(POLES_OF[q.dim]).toContain(q.aPole);
      expect(q.a.length).toBeGreaterThanOrEqual(2); // 词对题选项仅二至四字
      expect(q.b).not.toBe(q.a);
      if (q.kind === 'wordpair') {
        const key = [q.a, q.b].sort().join('/');
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      } else {
        expect(q.text.length).toBeGreaterThan(4);
        expect(texts.has(q.text)).toBe(false);
        texts.add(q.text);
      }
    }
  });

  it('A/B 极性交错：每维度 9 题中 A 极不全部倒向一端', () => {
    for (const dim of Object.keys(POLES_OF) as (keyof typeof POLES_OF)[]) {
      const aPoles = QUESTIONS.filter((q) => q.dim === dim).map((q) => q.aPole);
      const [l, r] = POLES_OF[dim];
      const lc = aPoles.filter((p) => p === l).length;
      expect(lc).toBeGreaterThan(0);
      expect(lc).toBeLessThan(aPoles.length + 1);
      expect(aPoles.filter((p) => p === r).length).toBeGreaterThan(0);
    }
  });

  it('DIM_INFO 左右极互为相反', () => {
    for (const dim of Object.keys(DIM_INFO) as (keyof typeof DIM_INFO)[]) {
      const info = DIM_INFO[dim];
      expect(info.left).not.toBe(info.right);
      expect(OPPOSITE[info.left]).toBe(info.right);
      expect(POLES_OF[dim]).toContain(info.left);
    }
  });
});

describe('mbti · 十六型图鉴', () => {
  it('十六型齐全无重复，四字母合法', () => {
    expect(MBTI_TYPES).toHaveLength(16);
    const codes = MBTI_TYPES.map((t) => t.code);
    expect(new Set(codes).size).toBe(16);
    const pattern = /^([EI])([SN])([TF])([JP])$/;
    for (const c of codes) expect(pattern.test(c)).toBe(true);
  });

  it('文案字段详实：概述/画像/切片/优势/盲区/职业/相处皆非空', () => {
    for (const t of MBTI_TYPES) {
      expect(t.name.length).toBeGreaterThan(1);
      expect(t.motto.length).toBeGreaterThan(5);
      expect(t.summary.length).toBeGreaterThan(60);
      expect(t.traits).toHaveLength(4);
      expect(t.strengths).toHaveLength(4);
      expect(t.blindSpots.length).toBeGreaterThanOrEqual(3);
      expect(t.careers.length).toBeGreaterThan(30);
      expect(t.relations.length).toBeGreaterThan(30);
    }
  });

  it('code 与四大角色匹配（NT/NF/SJ/SP），ROLES 字母一致', () => {
    for (const t of MBTI_TYPES) {
      expect(roleOf(t.code)).toBe(t.role);
      expect(ROLES[t.role].letters).toBe(
        t.code[1] === 'N' ? t.code.slice(1, 3) : t.code[1] + t.code[3],
      );
    }
  });
});

describe('mbti-core · 计分', () => {
  it('tally：全选 A 的计票与题库推导一致', () => {
    const allA = QUESTIONS.map(() => 'a' as const);
    const t = tally(allA);
    const expect0: Record<Pole, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
    QUESTIONS.forEach((q) => expect0[q.aPole]++);
    expect(t).toEqual(expect0);
  });

  it('tally：null 跳过不计', () => {
    const answers: Answers = QUESTIONS.map((_, i) => (i % 2 ? null : 'a'));
    const t = tally(answers);
    const total = Object.values(t).reduce((s, n) => s + n, 0);
    expect(total).toBe(30);
  });

  it('同分裁决沿用惯例 I/N/F/P', () => {
    expect(TIE_DEFAULT).toEqual({ EI: 'I', SN: 'N', TF: 'F', JP: 'P' });
    const t: Record<Pole, number> = { E: 5, I: 5, S: 4, N: 5, T: 3, F: 6, J: 2, P: 7 };
    const ds = dimScores(t);
    expect(ds[0].tie).toBe(true);
    expect(ds[0].winner).toBe('I');
    expect(ds[1].winner).toBe('N');
    expect(ds[2].winner).toBe('F');
    expect(ds[3].winner).toBe('P');
    expect(typeCode(ds)).toBe('INFP');
  });

  it('偏好四档（对照官方叫法）：13:2 绝对 · 11:4 明确 · 10:5 中等 · 8:7 轻微', () => {
    const mk = (l: number, r: number) => dimScores({ E: l, I: r, S: 0, N: 15, T: 0, F: 15, J: 0, P: 15 })[0];
    expect(mk(15, 0).clarity).toBe('绝对');
    expect(mk(13, 2).clarity).toBe('绝对');
    expect(mk(12, 3).clarity).toBe('明确');
    expect(mk(11, 4).clarity).toBe('明确');
    expect(mk(10, 5).clarity).toBe('中等');
    expect(mk(9, 6).clarity).toBe('中等');
    expect(mk(8, 7).clarity).toBe('轻微');
    expect(mk(15, 0).ratio).toBeCloseTo(1);
    expect(mk(9, 6).ratio).toBeCloseTo(0.6);
  });

  it('scoreMbti：未答完或长度不符返回 null', () => {
    expect(scoreMbti(Array(60).fill('a'))).not.toBeNull();
    expect(scoreMbti(Array(59).fill('a'))).toBeNull();
    expect(scoreMbti([...Array(59).fill('a'), null])).toBeNull();
  });

  it('十六型皆可由构造答案得出（typeByCode 全命中）', () => {
    for (const t of MBTI_TYPES) {
      const target: Record<string, Pole> = {
        EI: t.code[0] as Pole, SN: t.code[1] as Pole, TF: t.code[2] as Pole, JP: t.code[3] as Pole,
      };
      const built: Answers = QUESTIONS.map((q) => (q.aPole === target[q.dim] ? 'a' : 'b'));
      const r = scoreMbti(built);
      expect(r, t.code).not.toBeNull();
      expect(r!.code).toBe(t.code);
      expect(r!.type.name).toBe(t.name);
    }
  });

  it('全选 A 的结果与计票多数自洽', () => {
    const allA: Answers = QUESTIONS.map(() => 'a');
    const t = tally(allA);
    const ds = dimScores(t);
    for (const d of ds) {
      const win = d.leftCount === d.rightCount
        ? TIE_DEFAULT[d.dim]
        : d.leftCount > d.rightCount ? d.left : d.right;
      expect(d.winner).toBe(win);
      expect(d.leftCount + d.rightCount).toBe(15);
    }
    const r = scoreMbti(allA)!;
    expect(r.code).toBe(ds.map((d) => d.winner).join(''));
  });
});
