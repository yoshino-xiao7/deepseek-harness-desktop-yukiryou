export type StructuredDiffRow =
  | { readonly kind: 'fold'; readonly label: string }
  | { readonly kind: 'hunk'; readonly label: string }
  | { readonly kind: 'context' | 'added' | 'deleted'; readonly oldLine?: number; readonly newLine?: number; readonly text: string };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function structuredDiffRows(source: string): StructuredDiffRow[] {
  const rows: StructuredDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let insideHunk = false;
  for (const raw of source.replaceAll('\r\n', '\n').split('\n')) {
    const match = HUNK.exec(raw);
    if (match !== null) {
      const nextOld = Number(match[1]);
      const nextNew = Number(match[3]);
      const gap = insideHunk ? Math.max(0, nextOld - oldLine) : Math.max(0, Math.min(nextOld, nextNew) - 1);
      if (gap > 0) rows.push({ kind: 'fold', label: `${String(gap)} 行未修改` });
      rows.push({ kind: 'hunk', label: raw });
      oldLine = nextOld;
      newLine = nextNew;
      insideHunk = true;
      continue;
    }
    if (!insideHunk || raw.startsWith('diff --git ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw === '\\ No newline at end of file') continue;
    if (raw.startsWith('+')) {
      rows.push({ kind: 'added', newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'deleted', oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else {
      rows.push({ kind: 'context', oldLine, newLine, text: raw.startsWith(' ') ? raw.slice(1) : raw });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}
