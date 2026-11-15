/** 极简 JSON ↔ YAML 互转（覆盖常见配置场景，无依赖） */

export function jsonToYAML(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    if (value === '' || /[:#\[\]{}&*!|>'"%@`,?\-]/.test(value[0]) || /\s$|^\s/.test(value) || /^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(item => {
      if (typeof item === 'object' && item !== null) {
        return `${pad}-\n${jsonToYAML(item, indent + 1)}`;
      }
      return `${pad}- ${jsonToYAML(item, indent + 1)}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      const key = /^[A-Za-z_][\w.-]*$/.test(k) ? k : JSON.stringify(k);
      if (typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
        return `${pad}${key}:\n${jsonToYAML(v, indent + 1)}`;
      }
      return `${pad}${key}: ${jsonToYAML(v, indent + 1)}`;
    }).join('\n');
  }
  return 'null';
}

/** YAML → JSON：支持嵌套映射、列表、标量；不支持锚点/多文档/块字符串 */
export function yamlToJSON(text: string): unknown {
  const lines = text.split('\n')
    .map(l => l.replace(/\t/g, '  '))
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.trim() !== '---');

  interface Frame { indent: number; value: unknown; }
  let pos = 0;

  function parseScalar(raw: string): unknown {
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === 'no' || s === 'off') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    if (s.startsWith('[') && s.endsWith(']')) {
      const inner = s.slice(1, -1).trim();
      return inner ? inner.split(',').map(parseScalar) : [];
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      const obj: Record<string, unknown> = {};
      const inner = s.slice(1, -1).trim();
      if (inner) inner.split(',').forEach(pair => {
        const [k, ...rest] = pair.split(':');
        obj[k.trim()] = parseScalar(rest.join(':'));
      });
      return obj;
    }
    return s;
  }

  function indentOf(line: string): number {
    return line.length - line.trimStart().length;
  }

  function parseBlock(indent: number): unknown {
    if (pos >= lines.length) return null;
    const first = lines[pos];
    const isList = first.trimStart().startsWith('- ') || first.trim() === '-';
    const result: unknown = isList ? [] : {};
    if (indentOf(first) < indent) return result;

    while (pos < lines.length) {
      const line = lines[pos];
      const cur = indentOf(line);
      if (cur < indent) break;
      if (cur > indent) { pos++; continue; } // 防御：异常缩进跳过
      const trimmed = line.trim();

      if (trimmed.startsWith('- ') || trimmed === '-') {
        const rest = trimmed === '-' ? '' : trimmed.slice(2);
        pos++;
        if (rest.includes(':') && !rest.startsWith('"') && /^[^:]+\s*:\s*/.test(rest)) {
          // 列表项是映射：把当前行当作子块第一行重新处理
          pos--;
          lines[pos] = ' '.repeat(indent + 2) + rest;
          (result as unknown[]).push(parseBlock(indent + 2));
        } else if (rest === '') {
          (result as unknown[]).push(parseBlock(indent + 2));
        } else {
          (result as unknown[]).push(parseScalar(rest));
        }
      } else {
        const idx = trimmed.indexOf(':');
        if (idx === -1) { pos++; continue; }
        const key = trimmed.slice(0, idx).trim().replace(/^["']|["']$/g, '');
        const rest = trimmed.slice(idx + 1).trim();
        pos++;
        if (rest === '') {
          const child = pos < lines.length && indentOf(lines[pos]) > indent ? parseBlock(indentOf(lines[pos])) : null;
          (result as Record<string, unknown>)[key] = child;
        } else {
          (result as Record<string, unknown>)[key] = parseScalar(rest);
        }
      }
    }
    return result;
  }

  return parseBlock(0);
}

/** JSON 美化/压缩/转义 */
export function formatJSON(text: string, space: number): string {
  return JSON.stringify(JSON.parse(text), null, space);
}
export function minifyJSON(text: string): string {
  return JSON.stringify(JSON.parse(text));
}
export function escapeJSONString(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}
export function unescapeJSONString(text: string): string {
  return JSON.parse(`"${text.replace(/^"|"$/g, '')}"`);
}
