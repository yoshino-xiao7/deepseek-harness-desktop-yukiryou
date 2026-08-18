import { validatedWorkspaceLinkTarget } from '../shared/workspace-review.js';

export type SafeMarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'workspace-link'; readonly text: string; readonly target: string };

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
  return source.split(/(`[^`]+`)/g).filter((part) => part !== '').flatMap((part) => (
    part.startsWith('`') && part.endsWith('`')
      ? [{ kind: 'code' as const, text: part.slice(1, -1) }]
      : parseWorkspaceLinks(part)
  ));
}

function parseWorkspaceLinks(source: string): SafeMarkdownInline[] {
  const result: SafeMarkdownInline[] = [];
  const pattern = /(?<!!)\[([^\]\n]+)\]\(([^):\s]+)\)/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index;
    const raw = match[0];
    const label = match[1];
    const target = validatedWorkspaceLinkTarget(match[2]);
    if (index === undefined || raw === undefined || label === undefined) continue;
    if (index > offset) result.push({ kind: 'text', text: source.slice(offset, index) });
    result.push(target === undefined
      ? { kind: 'text', text: raw }
      : { kind: 'workspace-link', text: label, target });
    offset = index + raw.length;
  }
  if (offset < source.length) result.push({ kind: 'text', text: source.slice(offset) });
  return result;
}
