import { readFile } from 'node:fs/promises';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { runtimeSlotContract } from './runtime-slot-contract.js';

const pluginSources = [
  '../../../runtime/desktop-settings-plugin/client.js',
  '../../../runtime/desktop-companion-plugin/client.js',
  '../../../runtime/desktop-market-plugin/client.js',
] as const;

describe('desktop business plugin slot policy', () => {
  it.each(pluginSources)('%s contributes only through additive rc.8 slots', async (relativeUrl) => {
    const source = await readFile(new URL(relativeUrl, import.meta.url), 'utf8');
    const slots = registeredSlotNames(source);

    expect(slots.size).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(runtimeSlotContract(slot).replaceRisk, slot).toBe('none');
    }
  });
});

function registeredSlotNames(source: string): ReadonlySet<string> {
  const file = ts.createSourceFile(
    'client.js',
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const slots = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'inject' &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'slots'
    ) {
      const name = node.arguments[0];
      if (name !== undefined && ts.isStringLiteral(name)) slots.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return slots;
}
