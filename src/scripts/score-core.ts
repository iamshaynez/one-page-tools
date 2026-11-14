/** 牌局计分核心逻辑（纯函数 + 历史栈，可单测） */

export interface ScoreGame {
  players: string[];
  rounds: number[][];   // rounds[r][p]
}

export interface Session {
  games: Record<string, ScoreGame>;
  activeId: string;
}

export function newGame(players: string[]): ScoreGame {
  return { players, rounds: [Array(players.length).fill(0)] };
}

export function createSession(): Session {
  const id = `g${Date.now()}`;
  return { games: { [id]: newGame(['玩家一', '玩家二']) }, activeId: id };
}

export function totals(game: ScoreGame): number[] {
  return game.players.map((_, p) => game.rounds.reduce((sum, row) => sum + (row[p] || 0), 0));
}

export function addPlayer(game: ScoreGame, name: string): ScoreGame {
  return { players: [...game.players, name], rounds: game.rounds.map(r => [...r, 0]) };
}

export function removePlayer(game: ScoreGame, index: number): ScoreGame {
  if (game.players.length <= 1) return game;
  return {
    players: game.players.filter((_, i) => i !== index),
    rounds: game.rounds.map(r => r.filter((_, i) => i !== index)),
  };
}

export function renamePlayer(game: ScoreGame, index: number, name: string): ScoreGame {
  return { ...game, players: game.players.map((p, i) => (i === index ? name : p)) };
}

export function addRound(game: ScoreGame): ScoreGame {
  return { ...game, rounds: [...game.rounds, Array(game.players.length).fill(0)] };
}

export function removeRound(game: ScoreGame, index: number): ScoreGame {
  if (game.rounds.length <= 1) return game;
  return { ...game, rounds: game.rounds.filter((_, i) => i !== index) };
}

export function setScore(game: ScoreGame, round: number, player: number, value: number): ScoreGame {
  return {
    ...game,
    rounds: game.rounds.map((r, ri) =>
      ri === round ? r.map((v, pi) => (pi === player ? value : v)) : r
    ),
  };
}

export function toCSV(game: ScoreGame): string {
  const head = ['局数', ...game.players].join(',');
  const rows = game.rounds.map((r, i) => [`第${i + 1}局`, ...r].join(','));
  const total = ['总分', ...totals(game)].join(',');
  return '﻿' + [head, ...rows, total].join('\n');
}

/** 撤销/重做历史栈 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public present: T) {}

  push(state: T): void {
    this.past.push(this.present);
    if (this.past.length > 100) this.past.shift();
    this.present = state;
    this.future = [];
  }
  undo(): boolean {
    if (!this.past.length) return false;
    this.future.push(this.present);
    this.present = this.past.pop()!;
    return true;
  }
  redo(): boolean {
    if (!this.future.length) return false;
    this.past.push(this.present);
    this.present = this.future.pop()!;
    return true;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
