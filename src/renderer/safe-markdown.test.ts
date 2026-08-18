import { describe, expect, it } from 'vitest';

import { parseSafeMarkdown } from './safe-markdown.js';

describe('SafeMarkdown', () => {
  it('keeps HTML, remote images, and scriptable links as inert text', () => {
    const blocks = parseSafeMarkdown([
      '# <img src="https://tracker.example/pixel">',
      '[click](javascript:alert(1))',
      '<iframe srcdoc="<script>window.pwned=1</script>"></iframe>',
      '![remote](https://tracker.example/image.png)',
      '```html',
      '<script>window.pwned=2</script>',
      '```',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: '<img src="https://tracker.example/pixel">' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: '[click](javascript:alert(1))' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: '<iframe srcdoc="<script>window.pwned=1</script>"></iframe>' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: '![remote](https://tracker.example/image.png)' }] },
      { kind: 'code', text: '<script>window.pwned=2</script>' },
    ]);
  });

  it('keeps the extended hostile corpus inside text and code fields only', () => {
    const payloads = [
      '<svg><a xlink:href="file:///etc/passwd"><animate onbegin="alert(1)" /></a></svg>',
      '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
      '[local file](file:///Users/example/.ssh/id_ed25519)',
      '![inline](data:image/svg+xml,<svg onload=alert(1)>)',
      '<object data="https://tracker.example/object"></object>',
      '| <img src=x onerror=alert(1)> | [x](javascript:alert(1)) |',
    ];
    const source = [
      ...payloads,
      ...Array.from({ length: 32 }, (_, depth) => `${'  '.repeat(depth)}- nested ${String(depth)}`),
    ].join('\n');
    const blocks = parseSafeMarkdown(source);
    const serialized = JSON.stringify(blocks);
    const inertText = collectText(blocks).join('\n');

    for (const payload of payloads) expect(inertText).toContain(payload);
    expect(serialized).not.toMatch(/"(?:html|href|src|url|onerror|onload)":/i);
    expect(new Set(blocks.map((block) => block.kind))).toEqual(
      new Set(['paragraph', 'list']),
    );
  });
});

function collectText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.text === 'string' ? [record.text] : []),
    ...Object.entries(record)
      .filter(([key]) => key !== 'text')
      .flatMap(([, child]) => collectText(child)),
  ];
}
