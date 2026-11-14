import { describe, it, expect } from 'vitest';
import { formatJSON, minifyJSON, jsonToYAML, yamlToJSON, escapeJSONString, unescapeJSONString } from '../src/scripts/json-core';

describe('json-core', () => {
  it('格式化与压缩', () => {
    expect(minifyJSON('{ "a": 1 }')).toBe('{"a":1}');
    expect(formatJSON('{"a":1}', 2)).toBe('{\n  "a": 1\n}');
  });

  it('非法 JSON 抛错', () => {
    expect(() => formatJSON('{a}', 2)).toThrow();
  });

  it('JSON → YAML 嵌套', () => {
    const yaml = jsonToYAML({ name: '玄墨', tools: ['a', 'b'], meta: { version: 2, offline: true } });
    expect(yaml).toContain('name: 玄墨');
    expect(yaml).toContain('- a');
    expect(yaml).toContain('version: 2');
    expect(yaml).toContain('offline: true');
  });

  it('YAML → JSON 基础', () => {
    const obj = yamlToJSON('name: 玄墨\nversion: 2\noffline: true\nnothing: null') as Record<string, unknown>;
    expect(obj).toEqual({ name: '玄墨', version: 2, offline: true, nothing: null });
  });

  it('YAML 嵌套映射与列表', () => {
    const yaml = 'design:\n  paper: "#f1f1ef"\n  ink: "#141210"\ntools:\n  - snake\n  - mine';
    const obj = yamlToJSON(yaml) as Record<string, unknown>;
    expect(obj.design).toEqual({ paper: '#f1f1ef', ink: '#141210' });
    expect(obj.tools).toEqual(['snake', 'mine']);
  });

  it('YAML 列表项为映射', () => {
    const yaml = 'tools:\n  - name: snake\n    stars: 3\n  - name: mine\n    stars: 5';
    const obj = yamlToJSON(yaml) as { tools: { name: string; stars: number }[] };
    expect(obj.tools[0]).toEqual({ name: 'snake', stars: 3 });
    expect(obj.tools[1].name).toBe('mine');
  });

  it('往返转换保持一致', () => {
    const original = { a: 1, b: 'text', c: [1, 2], d: { e: true } };
    const round = yamlToJSON(jsonToYAML(original));
    expect(round).toEqual(original);
  });

  it('转义与反转义', () => {
    const raw = 'hello "world"\nline2';
    const escaped = escapeJSONString(raw);
    expect(escaped).toBe('hello \\"world\\"\\nline2');
    expect(unescapeJSONString(escaped)).toBe(raw);
  });
});
