import { describe, it, expect } from 'vitest';
import {
  newGame, addPlayer, removePlayer, renamePlayer, addRound, removeRound,
  setScore, totals, toCSV, History,
} from '../src/scripts/score-core';
import type { ScoreGame } from '../src/scripts/score-core';

describe('score-core', () => {
  it('新牌局一行全零', () => {
    const g = newGame(['甲', '乙']);
    expect(g.rounds).toEqual([[0, 0]]);
    expect(totals(g)).toEqual([0, 0]);
  });

  it('加玩家所有行补零', () => {
    let g = newGame(['甲']);
    g = addRound(g);
    g = addPlayer(g, '乙');
    expect(g.rounds).toEqual([[0, 0], [0, 0]]);
  });

  it('删玩家同步删除分数列', () => {
    let g = newGame(['甲', '乙', '丙']);
    g = setScore(g, 0, 1, 100);
    g = removePlayer(g, 1);
    expect(g.players).toEqual(['甲', '丙']);
    expect(g.rounds[0]).toEqual([0, 0]);
  });

  it('最后一个玩家不可删', () => {
    const g = removePlayer(newGame(['甲']), 0);
    expect(g.players).toEqual(['甲']);
  });

  it('改名', () => {
    const g = renamePlayer(newGame(['甲']), 0, '玄墨');
    expect(g.players[0]).toBe('玄墨');
  });

  it('正负分累计正确', () => {
    let g = newGame(['甲', '乙']);
    g = addRound(g);
    g = setScore(g, 0, 0, 50);
    g = setScore(g, 1, 0, -20);
    g = setScore(g, 0, 1, 10);
    expect(totals(g)).toEqual([30, 10]);
  });

  it('删局保留其他局', () => {
    let g = newGame(['甲']);
    g = addRound(g);
    g = setScore(g, 0, 0, 5);
    g = setScore(g, 1, 0, 7);
    g = removeRound(g, 0);
    expect(g.rounds).toEqual([[7]]);
  });

  it('CSV 含 BOM 与总分行', () => {
    let g = newGame(['甲']);
    g = setScore(g, 0, 0, 42);
    const csv = toCSV(g);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('总分,42');
  });

  it('不可变：原对象不被修改', () => {
    const g = newGame(['甲']);
    setScore(g, 0, 0, 99);
    expect(g.rounds[0][0]).toBe(0);
  });
});

describe('History 撤销重做', () => {
  it('undo/redo 往返', () => {
    const h = new History<ScoreGame>(newGame(['甲']));
    h.push(setScore(h.present, 0, 0, 10));
    h.push(setScore(h.present, 0, 0, 20));
    expect(h.present.rounds[0][0]).toBe(20);
    expect(h.undo()).toBe(true);
    expect(h.present.rounds[0][0]).toBe(10);
    expect(h.undo()).toBe(true);
    expect(h.present.rounds[0][0]).toBe(0);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(h.present.rounds[0][0]).toBe(10);
  });

  it('新操作清空 redo 栈', () => {
    const h = new History<ScoreGame>(newGame(['甲']));
    h.push(setScore(h.present, 0, 0, 10));
    h.undo();
    h.push(setScore(h.present, 0, 0, 99));
    expect(h.canRedo).toBe(false);
  });
});
