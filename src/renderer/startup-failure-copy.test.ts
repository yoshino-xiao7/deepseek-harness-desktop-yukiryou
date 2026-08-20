import { describe, expect, it } from 'vitest';

import { startupFailureCopy } from './startup-failure-copy.js';

describe('startup failure copy', () => {
  it('gives actionable recovery instructions for an occupied legacy Runtime endpoint', () => {
    const copy = startupFailureCopy('runtime-endpoint-occupied');

    expect(copy).toContain('完全退出旧版');
    expect(copy).toContain('重启电脑');
    expect(copy).toContain('不会自动连接或结束未知进程');
  });

  it('keeps generic failures concise and diagnostic', () => {
    expect(startupFailureCopy('startup-timeout')).toBe(
      '错误类型：startup-timeout。你可以重试，或导出诊断信息。',
    );
  });
});
