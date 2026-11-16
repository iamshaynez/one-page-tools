/** 24 点核心（纯函数）：分数精确求解器 + 玩家算式解析与校验 */

// ---------- 分数 ----------
export interface Frac { n: number; d: number } // 恒有 d > 0 且已约分

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function frac(n: number, d = 1): Frac {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(Math.abs(n), d) || 1;
  return { n: n / g, d: d / g };
}

export const fEq = (a: Frac, b: Frac): boolean => a.n * b.d === b.n * a.d;
const fAdd = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fSub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const fMul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const fDiv = (a: Frac, b: Frac): Frac | null => (b.n === 0 ? null : frac(a.n * b.d, a.d * b.n));

export function formatFrac(f: Frac): string {
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}（≈${(f.n / f.d).toFixed(2)}）`;
}

// ---------- 表达式树 ----------
export type Op = '+' | '-' | '*' | '/';
export interface Expr { op?: Op; l?: Expr; r?: Expr; v?: number }

const leaf = (v: number): Expr => ({ v });
export const PREC: Record<Op, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const SYM: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** 求值；除零返回 null */
export function evaluate(e: Expr): Frac | null {
  if (e.v !== undefined) return frac(e.v);
  const a = evaluate(e.l!);
  const b = evaluate(e.r!);
  if (!a || !b) return null;
  switch (e.op) {
    case '+': return fAdd(a, b);
    case '-': return fSub(a, b);
    case '*': return fMul(a, b);
    case '/': return fDiv(a, b);
    default: return null;
  }
}

/** 叶子数字（用于核对是否恰好用完牌面） */
export function leaves(e: Expr): number[] {
  if (e.v !== undefined) return [e.v];
  return [...leaves(e.l!), ...leaves(e.r!)];
}

/** 最少括号渲染：+ − × ÷。加括号当且仅当子式优先级更低，或同级且为 − ÷ 的右操作数 */
export function render(e: Expr): string {
  return R(e, 0, false, undefined);
}
function R(e: Expr, parentPrec: number, isRight: boolean, parentOp: Op | undefined): string {
  if (e.v !== undefined) return String(e.v);
  const prec = PREC[e.op!];
  const need =
    prec < parentPrec ||
    (prec === parentPrec && isRight && (parentOp === '-' || parentOp === '/'));
  const inner = R(e.l!, prec, false, e.op!) + SYM[e.op!] + R(e.r!, prec, true, e.op!);
  return need ? `(${inner})` : inner;
}

// ---------- 求解 ----------
interface Item { f: Frac; e: Expr }

function search(items: Item[], target: Frac): Expr | null {
  if (items.length === 1) return fEq(items[0].f, target) ? items[0].e : null;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const rest = items.filter((_, k) => k !== i && k !== j);
      const a = items[i], b = items[j];
      const cands: Array<{ op: Op; l: Expr; r: Expr; f: Frac | null }> = [
        { op: '+', l: a.e, r: b.e, f: fAdd(a.f, b.f) },
        { op: '-', l: a.e, r: b.e, f: fSub(a.f, b.f) },
        { op: '-', l: b.e, r: a.e, f: fSub(b.f, a.f) },
        { op: '*', l: a.e, r: b.e, f: fMul(a.f, b.f) },
        { op: '/', l: a.e, r: b.e, f: fDiv(a.f, b.f) },
        { op: '/', l: b.e, r: a.e, f: fDiv(b.f, a.f) },
      ];
      for (const c of cands) {
        if (!c.f) continue;
        const found = search([...rest, { f: c.f, e: { op: c.op, l: c.l, r: c.r } }], target);
        if (found) return found;
      }
    }
  }
  return null;
}

/** 求一个解；无解返回 null（分数精确，3 3 8 8 也能解出 8÷(3−8÷3)） */
export function solve24(nums: number[], target = 24): string | null {
  const e = search(nums.map((v) => ({ f: frac(v), e: leaf(v) })), frac(target));
  return e ? render(e) : null;
}

export const hasSolution = (nums: number[]): boolean => solve24(nums) !== null;

// ---------- 玩家算式 ----------
/** 归一：全角/花体运算符、括号、全角数字 → 半角 */
function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[×＊]/g, '*').replace(/[÷／]/g, '/')
    .replace(/[−–—－]/g, '-')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[\s，,]/g, '');
}

/** 递归下降解析（不支持一元负号与幂）；非法输入抛 Error（中文说明） */
export function parseExpr(input: string): Expr {
  const s = normalize(input);
  if (!s) throw new Error('式子是空的');
  let i = 0;
  const peek = () => s[i];

  function expr(): Expr {
    let node = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++] as Op;
      node = { op, l: node, r: term() };
    }
    return node;
  }
  function term(): Expr {
    let node = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++] as Op;
      node = { op, l: node, r: factor() };
    }
    return node;
  }
  function factor(): Expr {
    if (peek() === '(') {
      i++;
      const node = expr();
      if (peek() !== ')') throw new Error('括号没有闭合');
      i++;
      return node;
    }
    const m = /^\d+/.exec(s.slice(i));
    if (!m) throw new Error(`「${s[i] ?? '结尾'}」附近算式写不通`);
    i += m[0].length;
    return leaf(parseInt(m[0], 10));
  }

  const node = expr();
  if (i < s.length) throw new Error(`「${s[i]}」附近算式写不通`);
  return node;
}

export type AnswerCheck = { ok: true; expr: string } | { ok: false; reason: string };

/** 校验玩家算式：语法 OK、恰好用完牌面数字、值等于目标 */
export function checkAnswer(input: string, nums: number[], target = 24): AnswerCheck {
  let ast: Expr;
  try {
    ast = parseExpr(input);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const used = leaves(ast).slice().sort((a, b) => a - b);
  const want = nums.slice().sort((a, b) => a - b);
  if (used.join(',') !== want.join(',')) {
    return { ok: false, reason: `四张牌的数字得恰好各用一次（你用了 ${used.join('、')}）` };
  }
  const v = evaluate(ast);
  if (!v) return { ok: false, reason: '中间除了个零，走不通' };
  if (!fEq(v, frac(target))) return { ok: false, reason: `算得 ${formatFrac(v)}，不是 ${target}` };
  return { ok: true, expr: render(ast) };
}
