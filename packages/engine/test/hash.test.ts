import { describe, expect, it } from 'vitest';
import { canonicalJson, hashChart } from '../src/index.ts';

describe('chart hashing', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
  });
  it('hashes equal charts equally and different charts differently', async () => {
    const a = await hashChart({ source: 'html_table', sizes: [{ label: 'M' }] });
    const b = await hashChart({ sizes: [{ label: 'M' }], source: 'html_table' });
    const c = await hashChart({ sizes: [{ label: 'L' }], source: 'html_table' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
