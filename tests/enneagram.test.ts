import { describe, it, expect } from 'vitest';
import { PAIRS, PAIR_PROMPT } from '../src/data/enneagram-questions';
import { ENNEA_TYPES, ARROWS, CENTERS, CN_NO } from '../src/data/enneagram-types';
import { tallyEnn, scoreEnn, wingsOf, type EnnAnswers, type Pick } from '../src/scripts/enneagram-core';

const CENTER_OF: Record<number, string> = {
  1: 'gut', 8: 'gut', 9: 'gut',
  2: 'heart', 3: 'heart', 4: 'heart',
  5: 'head', 6: 'head', 7: 'head',
};

/** 全卷选 a / b，再按索引定向翻转 */
const build = (base: Pick, flips: Record<number, Pick> = {}): EnnAnswers =>
  PAIRS.map((_, i) => flips[i] ?? base);

describe('enneagram · 配对题库结构', () => {
  it('共三十六对，恰为 C(9,2) 全配对', () => {
    expect(PAIRS).toHaveLength(36);
    const keys = PAIRS.map((p) => [p.aNo, p.bNo].sort((x, y) => x - y).join('-'));
    expect(new Set(keys).size).toBe(36);
    for (const p of PAIRS) expect(p.aNo).not.toBe(p.bNo);
  });

  it('每型恰出现八次，八条陈述互不重复', () => {
    for (let no = 1; no <= 9; no++) {
      const texts = PAIRS.flatMap((p) =>
        p.aNo === no ? [p.aText] : p.bNo === no ? [p.bText] : [],
      );
      expect(texts).toHaveLength(8);
      expect(new Set(texts).size).toBe(8);
    }
  });

  it('全卷七十二条陈述无重复、非空，引导语为终生框架', () => {
    const all = PAIRS.flatMap((p) => [p.aText, p.bText]);
    expect(new Set(all).size).toBe(72);
    for (const t of all) expect(t.length).toBeGreaterThan(6);
    expect(PAIR_PROMPT).toContain('一生');
  });
});

describe('enneagram · 九型图鉴', () => {
  it('九型齐全无重复', () => {
    expect(ENNEA_TYPES).toHaveLength(9);
    const nos = ENNEA_TYPES.map((t) => t.no).sort();
    expect(nos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Object.keys(CN_NO)).toHaveLength(9);
  });

  it('三中心分组正确（腹 8-9-1 / 心 2-3-4 / 脑 5-6-7）', () => {
    for (const t of ENNEA_TYPES) expect(t.center).toBe(CENTER_OF[t.no]);
    expect(CENTERS.gut.members).toBe('捌 玖 壹');
    expect(CENTERS.heart.members).toBe('贰 叁 肆');
    expect(CENTERS.head.members).toBe('伍 陆 柒');
  });

  it('文案字段详实：恐惧/欲望/画像/概述/切片/优势/盲区/职业/相处/箭头皆非空', () => {
    for (const t of ENNEA_TYPES) {
      expect(t.name.length).toBeGreaterThan(1);
      expect(t.alias.length).toBeGreaterThan(1);
      expect(t.fear.length).toBeGreaterThan(5);
      expect(t.desire.length).toBeGreaterThan(5);
      expect(t.motto.length).toBeGreaterThan(5);
      expect(t.summary.length).toBeGreaterThan(60);
      expect(t.traits).toHaveLength(4);
      expect(t.strengths).toHaveLength(4);
      expect(t.blindSpots.length).toBeGreaterThanOrEqual(3);
      expect(t.careers.length).toBeGreaterThan(30);
      expect(t.relations.length).toBeGreaterThan(30);
      expect(t.growth.length).toBeGreaterThan(15);
      expect(t.stress.length).toBeGreaterThan(15);
    }
  });

  it('箭头表为 1–9 的双射', () => {
    const growths = Object.values(ARROWS).map((a) => a.growth).sort();
    const stresses = Object.values(ARROWS).map((a) => a.stress).sort();
    expect(growths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stresses).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ARROWS[1]).toEqual({ growth: 7, stress: 4 });
    expect(ARROWS[5]).toEqual({ growth: 8, stress: 7 });
    expect(ARROWS[9]).toEqual({ growth: 3, stress: 6 });
  });
});

describe('enneagram-core · 计票', () => {
  it('翼型环绕：壹邻玖与贰，玖邻捌与壹，伍邻肆与陆', () => {
    expect(wingsOf(1)).toEqual([9, 2]);
    expect(wingsOf(9)).toEqual([8, 1]);
    expect(wingsOf(5)).toEqual([4, 6]);
  });

  it('tally：全 a 给 aNo 计票，null 跳过', () => {
    const all = tallyEnn(build('a'));
    // 配对表 aNo 恒为小号：全 a 时壹得 8 票、捌得 1 票、玖得 0 票
    expect(all[1]).toBe(8);
    expect(all[8]).toBe(1);
    expect(all[9]).toBe(0);
    expect(all.reduce((s, v, i) => (i ? s + v : s), 0)).toBe(36);
    const half = tallyEnn(PAIRS.map((_, i) => (i % 2 ? null : 'a')));
    expect(half.reduce((s, v, i) => (i ? s + v : s), 0)).toBe(18);
  });

  it('全 a：主型壹（8 票），翼取邻型高票者贰', () => {
    const res = scoreEnn(build('a'))!;
    expect(res.main.no).toBe(1);
    expect(res.tiedWith).toHaveLength(0);
    expect(res.wing!.type.no).toBe(2); // 贰 7 票 > 玖 0 票
    expect(res.wing!.both).toBe(false);
    expect(res.growth.no).toBe(7);
    expect(res.stress.no).toBe(4);
    expect(res.scores.find((s) => s.no === 1)!.pct).toBe(100);
    expect(res.scores.find((s) => s.no === 9)!.pct).toBe(0);
  });

  it('全 b：主型玖，翼捌', () => {
    const res = scoreEnn(build('b'))!;
    expect(res.main.no).toBe(9);
    expect(res.wing!.type.no).toBe(8);
    expect(res.growth.no).toBe(3);
    expect(res.stress.no).toBe(6);
  });

  it('并列裁决：壹贰叁同为最高票时，展示编号小者并列其余', () => {
    // 全 a 基础上：(1,2) 给贰、(2,3) 给叁 → 壹贰叁各 7 票
    const res = scoreEnn(build('a', { 0: 'b', 8: 'b' }))!;
    expect(res.main.no).toBe(1);
    expect(res.tiedWith.map((t) => t.no)).toEqual([2, 3]);
  });

  it('双翼同票时 both 为真', () => {
    // 全 a：翻 (2,3)(2,4)(2,5) → 贰 4 票；翻 (3,9)(4,9)(5,9)(6,9) → 玖 4 票；壹仍 8 票居首
    const res = scoreEnn(build('a', { 8: 'b', 9: 'b', 10: 'b', 20: 'b', 25: 'b', 29: 'b', 32: 'b' }))!;
    expect(res.main.no).toBe(1);
    expect(res.wing!.both).toBe(true);
  });

  it('未答完或长度不符返回 null', () => {
    expect(scoreEnn(build('a'))).not.toBeNull();
    expect(scoreEnn(build('a').slice(1))).toBeNull();
    expect(scoreEnn([...build('a').slice(0, 35), null])).toBeNull();
  });
});
