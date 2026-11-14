/** Cron 表达式解析与求值（纯函数，支持标准 5 段 + 常见别名） */

export interface CronField {
  values: Set<number>;
  raw: string;
}

export interface CronExpr {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  raw: string;
}

const MONTH_NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function resolveName(token: string, names: Record<string, number>): string {
  return names[token.toLowerCase()] !== undefined ? String(names[token.toLowerCase()]) : token;
}

export function parseField(raw: string, min: number, max: number, names: Record<string, number> = {}): CronField {
  const values = new Set<number>();

  function addValue(token: string, stepMax?: number): void {
    const v = Number(resolveName(token, names));
    if (!Number.isInteger(v) || v < min || v > (stepMax ?? max)) {
      throw new Error(`字段值 "${token}" 超出范围 ${min}-${max}`);
    }
    values.add(v);
  }

  for (const part of raw.split(',')) {
    const [rangeRaw, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`步长无效: "${part}"`);

    if (rangeRaw === '*' || rangeRaw === '') {
      for (let v = min; v <= max; v += step) values.add(v);
    } else if (rangeRaw.includes('-')) {
      const [a, b] = rangeRaw.split('-');
      const start = Number(resolveName(a, names));
      const end = Number(resolveName(b, names));
      if (start > end) { // 环绕范围（如 22-2）
        for (let v = start; v <= max; v++) if ((v - start) % step === 0) values.add(v);
        for (let v = min; v <= end; v++) if ((max - start + 1 + v - min) % step === 0) values.add(v);
      } else {
        for (let v = start; v <= end; v += step) values.add(v);
      }
      if (values.size === 0) throw new Error(`范围无效: "${part}"`);
    } else {
      addValue(rangeRaw);
    }
  }
  if (values.size === 0) throw new Error(`字段为空: "${raw}"`);
  return { values, raw };
}

export function parseCron(input: string): CronExpr {
  const raw = input.trim();
  const expanded = ALIASES[raw.toLowerCase()] ?? raw;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) throw new Error(`需要 5 段表达式（分 时 日 月 周），收到 ${parts.length} 段`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTH_NAMES),
    dow: parseField(parts[4], 0, 7, DOW_NAMES),
    raw,
  };
}

function matchDomDow(expr: CronExpr, date: Date): boolean {
  const dom = expr.dom.values.has(date.getDate());
  let dow = date.getDay();
  // 7 也视为周日
  const dowMatch = expr.dow.values.has(dow) || (dow === 0 && expr.dow.values.has(7));
  const domStar = expr.dom.raw === '*';
  const dowStar = expr.dow.raw === '*' || expr.dow.raw === '7';
  // 标准 cron：两者都受限时取并集，否则取交集
  if (!domStar && !dowStar) return dom || dowMatch;
  return dom && dowMatch;
}

export function matches(expr: CronExpr, date: Date): boolean {
  return (
    expr.minute.values.has(date.getMinutes()) &&
    expr.hour.values.has(date.getHours()) &&
    expr.month.values.has(date.getMonth() + 1) &&
    matchDomDow(expr, date)
  );
}

/** 未来 N 次触发时间（从 from 之后开始算） */
export function nextRuns(expr: CronExpr, count: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = cursor.getTime() + 366 * 24 * 3600 * 1000 * 4; // 最多向前找 4 年
  while (out.length < count && cursor.getTime() < limit) {
    if (matches(expr, cursor)) out.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}

/** 生成人话描述 */
export function describe(expr: CronExpr): string {
  const parts: string[] = [];
  const { minute, hour, dom, month, dow } = expr;

  // 月份
  if (month.raw !== '*') parts.push(`在 ${[...month.values].sort((a, b) => a - b).join('、')} 月`);
  // 星期
  const DOW_CN = ['日', '一', '二', '三', '四', '五', '六'];
  if (dow.raw !== '*') {
    const days = [...dow.values].map(d => `周${DOW_CN[d % 7]}`).join('、');
    parts.push(`每${days}`);
  }
  // 日
  if (dom.raw !== '*') parts.push(`每月 ${[...dom.values].sort((a, b) => a - b).join('、')} 号`);

  // 时分
  const mRaw = minute.raw, hRaw = hour.raw;
  if (mRaw.startsWith('*/') && hRaw === '*') {
    parts.push(`每 ${mRaw.slice(2)} 分钟`);
  } else if (mRaw === '0' && hRaw.startsWith('*/')) {
    parts.push(`每 ${hRaw.slice(2)} 小时`);
  } else if (mRaw === '*' && hRaw === '*') {
    parts.push('每分钟');
  } else if (hRaw === '*' && minute.values.size <= 6) {
    parts.push(`每小时的第 ${[...minute.values].sort((a, b) => a - b).join('、')} 分钟`);
  } else if (hour.values.size <= 4 && minute.values.size <= 4) {
    const times: string[] = [];
    for (const h of [...hour.values].sort((a, b) => a - b)) {
      for (const m of [...minute.values].sort((a, b) => a - b)) {
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    parts.push(`在 ${times.join('、')}`);
  } else {
    parts.push(`小时[${hRaw}] 分钟[${mRaw}]`);
  }
  return parts.join('，') + '执行';
}
