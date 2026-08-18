import { describe, expect, it } from 'vitest';

import { structuredDiffRows } from './diff-model.js';

describe('structuredDiffRows', () => {
  it('adds line numbers, hunk rows, and omitted-line folds', () => {
    const rows = structuredDiffRows([
      'diff --git a/demo.ts b/demo.ts',
      '--- a/demo.ts',
      '+++ b/demo.ts',
      '@@ -4,3 +4,3 @@',
      ' before',
      '-old',
      '+new',
      ' after',
      '@@ -20,1 +20,2 @@',
      ' tail',
      '+extra',
    ].join('\n'));
    expect(rows[0]).toEqual({ kind: 'fold', label: '3 行未修改' });
    expect(rows).toContainEqual({ kind: 'deleted', oldLine: 5, text: 'old' });
    expect(rows).toContainEqual({ kind: 'added', newLine: 5, text: 'new' });
    expect(rows).toContainEqual({ kind: 'fold', label: '13 行未修改' });
  });
});
