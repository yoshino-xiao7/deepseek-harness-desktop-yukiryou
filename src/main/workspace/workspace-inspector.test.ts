import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createWorkspaceInspector } from './workspace-inspector.js';

const execFileAsync = promisify(execFile);

describe('WorkspaceInspector', () => {
  it('issues opaque nodes, lists lazily, and renders Markdown as a dedicated preview kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-'));
    await mkdir(join(root, 'docs'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'README.md'), '# Hello\n\nWorld');
    await writeFile(join(root, '.DS_Store'), 'noise');
    await writeFile(join(root, 'docs', 'note.txt'), 'note');
    const inspector = createWorkspaceInspector(root);

    const overview = await inspector.overview();
    expect(overview).toMatchObject({ kind: 'overview', rootName: expect.any(String) });
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const readme = overview.nodes.find((node) => node.name === 'README.md');
    const docs = overview.nodes.find((node) => node.name === 'docs');
    expect(overview.nodes.map((node) => node.name)).not.toContain('node_modules');
    expect(overview.nodes.map((node) => node.name)).not.toContain('.DS_Store');
    expect(readme?.id).not.toContain(root);
    expect(await inspector.preview(readme!.id)).toMatchObject({ kind: 'preview', content: { kind: 'markdown', text: '# Hello\n\nWorld' } });
    expect(await inspector.listDirectory(docs!.id)).toMatchObject({ kind: 'directory', nodes: [{ name: 'note.txt' }] });
  });

  it('searches recursively without exposing paths as capabilities or entering excluded directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-search-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-inspector-search-outside-'));
    await mkdir(join(root, 'src', 'renderer'), { recursive: true });
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'renderer', 'WorkspacePanel.ts'), 'export {};');
    await writeFile(join(root, 'src', 'renderer', 'other.ts'), 'export {};');
    await writeFile(join(root, 'node_modules', 'WorkspacePanel.ts'), 'hidden');
    await writeFile(join(outside, 'WorkspacePanel.ts'), 'hidden');
    await symlink(outside, join(root, 'linked-outside'));
    const inspector = createWorkspaceInspector(root);

    const response = await inspector.search('workspace panel');

    expect(response).toMatchObject({
      kind: 'search',
      query: 'workspace panel',
      truncated: false,
      nodes: [{ name: 'WorkspacePanel.ts', path: 'src/renderer/WorkspacePanel.ts' }],
    });
    if (response.kind !== 'search') throw new Error('search unavailable');
    expect(response.nodes[0]?.id).not.toContain(root);
    expect(await inspector.preview(response.nodes[0]!.id)).toMatchObject({
      kind: 'preview', path: 'src/renderer/WorkspacePanel.ts',
    });
  });

  it('resolves Markdown links relative to an opaque source node without escaping the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-relative-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-inspector-relative-outside-'));
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'index.md'), '[Guide](guide.md)');
    await writeFile(join(root, 'docs', 'guide.md'), '# Guide');
    await writeFile(join(outside, 'secret.md'), '# Secret');
    const inspector = createWorkspaceInspector(root);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const docs = overview.nodes.find((node) => node.name === 'docs');
    const directory = await inspector.listDirectory(docs!.id);
    if (directory.kind !== 'directory') throw new Error('directory unavailable');
    const index = directory.nodes.find((node) => node.name === 'index.md');

    expect(await inspector.previewRelative(index!.id, 'guide.md')).toMatchObject({
      kind: 'preview', path: 'docs/guide.md', content: { kind: 'markdown', text: '# Guide' },
    });
    expect(await inspector.previewRelative(index!.id, '../../secret.md')).toEqual({ kind: 'unavailable', reason: 'invalid-node' });
  });

  it('invalidates a cached preview when the underlying file revision changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-cache-'));
    await writeFile(join(root, 'note.md'), '# Before');
    const inspector = createWorkspaceInspector(root, 64 * 1024);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const note = overview.nodes.find((node) => node.name === 'note.md');
    expect(await inspector.preview(note!.id)).toMatchObject({ content: { text: '# Before' } });
    await writeFile(join(root, 'note.md'), '# After changed');
    expect(await inspector.preview(note!.id)).toMatchObject({ content: { text: '# After changed' } });
  });

  it('rejects invalid UTF-8 instead of rendering replacement characters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-encoding-'));
    await writeFile(join(root, 'broken.md'), Buffer.from([0x23, 0x20, 0xc3, 0x28]));
    const inspector = createWorkspaceInspector(root);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const broken = overview.nodes.find((node) => node.name === 'broken.md');

    expect(await inspector.preview(broken!.id)).toMatchObject({
      kind: 'preview',
      content: { kind: 'unsupported', reason: 'invalid-encoding' },
    });
  });

  it('rejects images whose declared dimensions exceed the preview pixel gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-image-'));
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(2_000, 20);
    await writeFile(join(root, 'oversized.png'), png);
    const inspector = createWorkspaceInspector(root);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const image = overview.nodes.find((node) => node.name === 'oversized.png');

    expect(await inspector.preview(image!.id)).toMatchObject({
      kind: 'preview',
      content: { kind: 'unsupported', reason: 'too-large' },
    });
  });

  it('does not register symlinks and rejects identifiers from another capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-links-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-inspector-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    const first = createWorkspaceInspector(root);
    const second = createWorkspaceInspector(root);
    const overview = await first.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    expect(overview.nodes).toEqual([]);
    await expect(second.preview('Abcdefghijklmnop_1')).resolves.toEqual({ kind: 'unavailable', reason: 'invalid-node' });
  });

  it('refuses a file replaced by a symlink after the capability was issued', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-swap-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-inspector-swap-outside-'));
    await writeFile(join(root, 'document.md'), '# safe');
    await writeFile(join(outside, 'secret.md'), '# secret');
    const inspector = createWorkspaceInspector(root);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const document = overview.nodes.find((node) => node.name === 'document.md');
    await unlink(join(root, 'document.md'));
    await symlink(join(outside, 'secret.md'), join(root, 'document.md'));

    expect(await inspector.preview(document!.id)).toMatchObject({
      kind: 'preview', content: { kind: 'unsupported', reason: 'unsupported-type' },
    });
  });

  it('returns a bounded current-worktree diff for a changed file capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-git-'));
    await execFileAsync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'README.md'), '# Before\n');
    await execFileAsync('git', ['-C', root, 'add', 'README.md']);
    await execFileAsync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial']);
    await writeFile(join(root, 'README.md'), '# After\n\nChanged\n');
    await writeFile(join(root, 'NEW.md'), '# New document\n');

    const inspector = createWorkspaceInspector(root);
    const overview = await inspector.overview();
    if (overview.kind !== 'overview') throw new Error('overview unavailable');
    const change = overview.changes.find((item) => item.path === 'README.md');
    expect(change).toMatchObject({ status: 'modified', additions: 3, deletions: 1, nodeId: expect.any(String) });
    expect(await inspector.diff(change!.nodeId!)).toMatchObject({
      kind: 'preview',
      content: { kind: 'diff', text: expect.stringContaining('+Changed'), additions: 3, deletions: 1 },
    });
    const untracked = overview.changes.find((item) => item.path === 'NEW.md');
    expect(untracked).toMatchObject({ status: 'untracked', nodeId: expect.any(String) });
    expect(await inspector.diff(untracked!.nodeId!)).toMatchObject({
      kind: 'preview',
      content: { kind: 'diff', additions: 1, deletions: 0, text: expect.stringContaining('+# New document') },
    });
    expect(await inspector.previewChangedPath('README.md')).toMatchObject({ kind: 'preview', content: { kind: 'diff' } });
    expect(await inspector.previewChangedPath('NEW.md')).toMatchObject({
      kind: 'preview', content: { kind: 'diff', additions: 1, deletions: 0, text: expect.stringContaining('+# New document') },
    });
    expect(await inspector.previewChangedPath('not-changed.md')).toEqual({ kind: 'unavailable', reason: 'invalid-node' });
  });

  it('reviews a historical Markdown edit as red/green diff after the worktree is clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-history-'));
    await execFileAsync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'README.md'), '# Historical result\n');
    await execFileAsync('git', ['-C', root, 'add', 'README.md']);
    await execFileAsync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'historical turn']);

    const inspector = createWorkspaceInspector(root);

    expect(await inspector.previewChangedPath('README.md', {
      text: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Before\n+# Historical result\n',
      additions: 1,
      deletions: 1,
    })).toMatchObject({
      kind: 'preview',
      path: 'README.md',
      content: { kind: 'diff', additions: 1, deletions: 1, text: expect.stringContaining('-# Before') },
    });
    expect(await inspector.previewChangedPath('README.md')).toEqual({ kind: 'unavailable', reason: 'invalid-node' });
    expect(await inspector.previewChangedPath('deleted.md', {
      text: 'diff --git a/deleted.md b/deleted.md\n--- a/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n',
      additions: 0,
      deletions: 1,
    })).toMatchObject({
      kind: 'preview', path: 'deleted.md', content: { kind: 'diff', additions: 0, deletions: 1 },
    });
  });

  it('rejects invalid UTF-8 in an untracked file during review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-inspector-untracked-encoding-'));
    await execFileAsync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'seed.txt'), 'seed\n');
    await execFileAsync('git', ['-C', root, 'add', 'seed.txt']);
    await execFileAsync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial']);
    await writeFile(join(root, 'broken.md'), Buffer.from([0xc3, 0x28]));
    const inspector = createWorkspaceInspector(root);

    expect(await inspector.previewChangedPath('broken.md')).toMatchObject({
      kind: 'preview', content: { kind: 'unsupported', reason: 'invalid-encoding' },
    });
  });
});
