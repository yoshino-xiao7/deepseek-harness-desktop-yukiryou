export type SafeMarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string };

export type SafeMarkdownBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly content: readonly SafeMarkdownInline[] }
  | { readonly kind: 'paragraph' | 'blockquote'; readonly content: readonly SafeMarkdownInline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly SafeMarkdownInline[])[] }
  | { readonly kind: 'code'; readonly text: string };

export function parseSafeMarkdown(source: string): SafeMarkdownBlock[] {
  const blocks: SafeMarkdownBlock[] = [];
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  let codeLines: string[] | undefined;
  let listItems: SafeMarkdownInline[][] | undefined;
  const flushList = (): void => {
    if (listItems === undefined) return;
    blocks.push({ kind: 'list', items: listItems });
    listItems = undefined;
  };
  const flushCode = (): void => {
    if (codeLines === undefined) return;
    blocks.push({ kind: 'code', text: codeLines.join('\n') });
    codeLines = undefined;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushList();
      if (codeLines === undefined) codeLines = [];
      else flushCode();
      continue;
    }
    if (codeLines !== undefined) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushList();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2] ?? ''),
      });
      continue;
    }
    const item = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (item !== null) {
      listItems ??= [];
      listItems.push(parseInline(item[1] ?? ''));
      continue;
    }
    flushList();
    if (line.trim() === '') continue;
    blocks.push({
      kind: line.startsWith('> ') ? 'blockquote' : 'paragraph',
      content: parseInline(line.startsWith('> ') ? line.slice(2) : line),
    });
  }
  flushList();
  flushCode();
  return blocks;
}

function parseInline(source: string): SafeMarkdownInline[] {
  return source.split(/(`[^`]+`)/g).filter((part) => part !== '').map((part) => (
    part.startsWith('`') && part.endsWith('`')
      ? { kind: 'code' as const, text: part.slice(1, -1) }
      : { kind: 'text' as const, text: part }
  ));
}
