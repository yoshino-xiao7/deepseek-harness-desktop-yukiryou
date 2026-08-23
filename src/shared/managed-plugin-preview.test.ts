import { describe, expect, it } from 'vitest';

import {
  validatedManagedPluginPreviewRequest,
  validatedManagedPluginPreviewResult,
  validatedManagedPluginPreviewSummary,
  validatedManagedPluginExecuteRequest,
  validatedManagedPluginExecuteResult,
} from './managed-plugin-preview.js';

const requestId = 'request-11111111-1111-4111-8111-111111111111';
const previewId = 'preview-22222222-2222-4222-8222-222222222222';
const profileGeneration = `gen-${'a'.repeat(64)}`;
const inspection = {
  status: 'artifact-verified',
  executionReady: false,
  observedAt: '2026-08-21T12:41:40.475Z',
  identity: {
    packageName: '@community/example',
    version: '1.2.3',
    repository: 'https://example.test',
  },
  artifact: {
    verifiedArtifacts: 4,
    verifiedCompressedBytes: 10_000,
    verifiedUnpackedBytes: 40_000,
    verifiedFileCount: 12,
  },
  dependencySummary: {
    direct: 2,
    peers: 1,
    nodes: 4,
    edges: 3,
    maxDepth: 2,
    peerRequirements: 3,
    peerSatisfied: 3,
    peerOptionalMissing: 0,
    optionalSkipped: 0,
  },
  lifecycleScripts: ['postinstall'],
  installationPlan: { secret: true },
};

describe('managed plugin preview contract', () => {
  it('accepts only bounded catalog identities', () => {
    expect(
      validatedManagedPluginPreviewRequest({
        requestId,
        sourceRecordId: 'dshfind',
        itemId: 'example',
        versionPreference: 'latest',
      }),
    ).toEqual({ requestId, sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'latest' });
    expect(
      validatedManagedPluginPreviewRequest({
        requestId: '../bad',
        sourceRecordId: 'x',
        itemId: 'y',
      }),
    ).toBeUndefined();
    expect(
      validatedManagedPluginPreviewRequest({
        requestId,
        sourceRecordId: '',
        itemId: 'y',
        versionPreference: 'latest',
      }),
    ).toBeUndefined();
    expect(validatedManagedPluginPreviewRequest({
      requestId, sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'newest',
    })).toBeUndefined();
    expect(validatedManagedPluginPreviewRequest({
      requestId, sourceRecordId: 'dshfind', itemId: 'example',
    })).toBeUndefined();
  });

  it('projects Host inspection without timestamps, repository data, or frozen plans', () => {
    const summary = validatedManagedPluginPreviewSummary(inspection);
    expect(summary).toMatchObject({
      packageName: '@community/example',
      version: '1.2.3',
      artifact: { verifiedArtifacts: 4, verifiedCompressedBytes: 10_000 },
      dependencies: { nodes: 4, edges: 3 },
      lifecycleScripts: ['postinstall'],
    });
    expect(summary).not.toHaveProperty('observedAt');
    expect(summary).not.toHaveProperty('repository');
    expect(summary).not.toHaveProperty('installationPlan');
  });

  it('validates the response envelope and rejects incomplete summaries', () => {
    const summary = validatedManagedPluginPreviewSummary(inspection);
    expect(
      validatedManagedPluginPreviewResult({
        requestId,
        status: 'ready',
        previewId,
        profileGeneration,
        expiresInSeconds: 300,
        operation: { kind: 'update', currentVersion: '1.2.2' },
        summary,
      }),
    ).toMatchObject({ status: 'ready', previewId, profileGeneration });
    expect(
      validatedManagedPluginPreviewResult({
        requestId,
        status: 'ready',
        previewId,
        profileGeneration,
        expiresInSeconds: 301,
        operation: { kind: 'install' },
        summary,
      }),
    ).toBeUndefined();
    expect(
      validatedManagedPluginPreviewSummary({
        ...inspection,
        lifecycleScripts: new Array(65).fill('x'),
      }),
    ).toBeUndefined();
  });

  it('accepts only one-shot execute capabilities and fixed result states', () => {
    expect(validatedManagedPluginExecuteRequest({ requestId, previewId })).toEqual({
      requestId,
      previewId,
    });
    expect(
      validatedManagedPluginExecuteRequest({
        requestId,
        previewId: '../invalid',
      }),
    ).toBeUndefined();
    expect(
      validatedManagedPluginExecuteResult({
        requestId,
        status: 'prepared',
        restartScheduled: true,
      }),
    ).toEqual({ requestId, status: 'prepared', restartScheduled: true });
    expect(
      validatedManagedPluginExecuteResult({
        requestId,
        status: 'prepared',
        restartScheduled: false,
      }),
    ).toBeUndefined();
  });
});
