import { describe, it, expect } from 'vitest';
import { STATEMENTS, RATING_LABELS } from '../src/data/enneagram-questions';
import { ENNEA_TYPES, ARROWS, CENTERS, CN_NO } from '../src/data/enneagram-types';
import { tallyEnn, scoreEnn, wingsOf, type Rating } from '../src/scripts/enneagram-core';

const CENTER_OF: Record<number, string> = {
  1: 'gut', 8: 'gut', 9: 'gut',
  2: 'heart', 3: 'heart', 4: 'heart',
  5: 'head', 6: 'head', 7: 'head',
};

/** 按型号给分，构造作答序列 */
const build = (ratingOf: (no: number) => Rating) =>
  STATEMENTS.map((s) => ratingOf(s.no));

describe('enneagram · 题库结构', () => {
  it('共三十六条陈述，每型恰四条', () => {
    expect(STATEMENTS).toHaveLength(36);
    for (let no = 1; no <= 9; no++) {
      expect(STATEMENTS.filter((s) => s.no === no)).toHaveLength(4);
    }
  });

  it('轮转排布：相邻陈述不同型', () => {
    for (let i = 1; i < STATEMENTS.length; i++) {
      expect(STATEMENTS[i].no).not.toBe(STATEMENTS[i - 1].no);
    }
  });

  it('文案非空且不重复，五档标签齐全', () => {
    const seen = new Set<string>();
    for (const s of STATEMENTS) {
      expect(s.text.length).toBeGreaterThan(6);
      expect(seen.has(s.text)).toBe(false);
      seen.add(s.text);
    }
    expect(Object.values(RATING_LABELS)).toHaveLength(5);
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
    // 通行走向抽查
    expect(ARROWS[1]).toEqual({ growth: 7, stress: 4 });
    expect(ARROWS[5]).toEqual({ growth: 8, stress: 7 });
    expect(ARROWS[9]).toEqual({ growth: 3, stress: 6 });
  });
});

describe('enneagram-core · 计分', () => {
  it('翼型环绕：壹邻玖与贰，玖邻捌与壹，伍邻肆与陆', () => {
    expect(wingsOf(1)).toEqual([9, 2]);
    expect(wingsOf(9)).toEqual([8, 1]);
    expect(wingsOf(5)).toEqual([4, 6]);
  });

  it('tally：按型号归和', () => {
    const sums = tallyEnn(build((no) => (no === 3 ? 5 : 1)));
    expect(sums[3]).toBe(20);
    expect(sums[7]).toBe(4);
  });

  it('主型、翼型与箭头（型叁最高，翼型取邻型高分者）', () => {
    const res = scoreEnn(build((no) => {
      if (no === 3) return 5;
      if (no === 2) return 4; // 左翼
      if (no === 4) return 2; // 右翼
      return 1;
    }))!;
    expect(res.main.no).toBe(3);
    expect(res.tiedWith).toHaveLength(0);
    expect(res.wing!.type.no).toBe(2);
    expect(res.wing!.both).toBe(false);
    expect(res.growth.no).toBe(6);
    expect(res.stress.no).toBe(9);
  });

  it('双翼同分时 both 为真', () => {
    const res = scoreEnn(build((no) => {
      if (no === 3) return 5;
      if (no === 2 || no === 4) return 3;
      return 1;
    }))!;
    expect(res.wing!.both).toBe(true);
  });

  it('主型同分并列：展示取编号小者，另一型列入并列', () => {
    const res = scoreEnn(build((no) => {
      if (no === 8 || no === 9) return 5;
      return 1;
    }))!;
    expect(res.main.no).toBe(8);
    expect(res.tiedWith.map((t) => t.no)).toEqual([9]);
  });

  it('分数归一化：满分 100、地板 0', () => {
    const res = scoreEnn(build((no) => (no === 6 ? 5 : 1)))!;
    const s6 = res.scores.find((s) => s.no === 6)!;
    const s1 = res.scores.find((s) => s.no === 1)!;
    expect(s6.raw).toBe(20);
    expect(s6.pct).toBe(100);
    expect(s1.raw).toBe(4);
    expect(s1.pct).toBe(0);
  });

  it('未答完或长度不符返回 null', () => {
    expect(scoreEnn(build(() => 3))).not.toBeNull();
    expect(scoreEnn(build(() => 3).slice(1))).toBeNull();
    expect(scoreEnn([...build(() => 3).slice(0, 35), null])).toBeNull();
  });
});
