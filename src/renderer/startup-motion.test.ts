import { readFile } from 'node:fs/promises';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('startup wake-screen motion', () => {
  it('keeps a continuous low-motion progress signal when reduced motion is requested', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
    const root = postcss.parse(css);
    const reducedMotion = root.nodes.find(
      (node) => node.type === 'atrule' && node.name === 'media' &&
        node.params === '(prefers-reduced-motion: reduce)',
    );
    expect(reducedMotion?.type).toBe('atrule');

    const progressRule = reducedMotion?.type === 'atrule'
      ? reducedMotion.nodes?.find(
          (node) => node.type === 'rule' && node.selector === '.progress-track span',
        )
      : undefined;
    expect(progressRule?.type).toBe('rule');
    if (progressRule?.type !== 'rule') return;

    const animation = progressRule.nodes.find(
      (node) => node.type === 'decl' && node.prop === 'animation',
    );
    expect(animation?.type === 'decl' ? animation.value : '').toMatch(
      /^reduced-progress-wave .+ infinite$/u,
    );
    expect(animation?.type === 'decl' ? animation.important : false).toBe(true);

    const keyframes = root.nodes.find(
      (node) => node.type === 'atrule' && node.name === 'keyframes' &&
        node.params === 'reduced-progress-wave',
    );
    expect(keyframes).toBeDefined();
  });
});
