import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PET_MOTIONS, type PetMotion } from '../src/shared/pet-package.js';
import {
  buildFrameSequencePetPackage,
  type GeneratedMotionAtlas,
} from '../src/main/pet/frame-sequence-authoring-adapter.js';
import { prepareFrameSequenceRuntimeCandidate } from '../src/main/pet/pet-package-preflight.js';

const [generatedArgument, atlasArgument, thumbnailArgument, outputArgument] = process.argv.slice(2);
if ([generatedArgument, atlasArgument, thumbnailArgument, outputArgument].some((value) => value === undefined)) {
  throw new Error('usage: build-yukiryou-frame-sequence.ts <generated> <encoded-atlases> <thumbnail.png> <output.yukipet>');
}

const generatedRoot = resolve(generatedArgument!);
const atlasRoot = resolve(atlasArgument!);
const thumbnailPath = resolve(thumbnailArgument!);
const outputPath = resolve(outputArgument!);
const encoding = JSON.parse(await readFile(join(atlasRoot, 'encoding-report.json'), 'utf8')) as EncodingReport;
const atlases: GeneratedMotionAtlas[] = [];
for (const motion of PET_MOTIONS) {
  const evidence = JSON.parse(await readFile(join(generatedRoot, `${motion}.json`), 'utf8')) as Evidence;
  assertEvidence(motion, evidence);
  const encoded = encoding.motions[motion];
  if (
    encoded === undefined
    || !positiveInteger(encoded.width)
    || !positiveInteger(encoded.height)
    || !positiveInteger(encoded.columns)
    || !positiveInteger(encoded.rows)
    || !positiveInteger(encoded.frameCount)
    || (encoded.mediaType !== 'image/png' && encoded.mediaType !== 'image/webp')
    || typeof encoded.path !== 'string'
  ) {
    throw new Error(`invalid encoding evidence: ${motion}`);
  }
  atlases.push({
    motion,
    mediaType: encoded.mediaType,
    bytes: await readFile(join(atlasRoot, encoded.path)),
    width: encoded.width,
    height: encoded.height,
    columns: encoded.columns,
    rows: encoded.rows,
    frameCount: encoded.frameCount,
    durationMs: evidence.durationMs,
  });
}

const archive = buildFrameSequencePetPackage({
  displayName: 'YukiRyou 鲸鱼女仆（开发预览）',
  thumbnail: { mediaType: 'image/png', bytes: await readFile(thumbnailPath) },
  atlases,
  metadata: {
    id: 'builtin.yukiryou-whale-maid-preview',
    author: 'YukiRyou',
    license: 'Bundled project asset',
    source: 'bundled-development-preview',
    englishName: 'YukiRyou Whale Maid (Development Preview)',
  },
});
const prepared = await prepareFrameSequenceRuntimeCandidate(archive);
if (prepared.status !== 'accepted') throw new Error(`built-in pet preflight rejected: ${prepared.reason}`);
await writeFile(outputPath, archive);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  archiveBytes: archive.byteLength,
  runtime: prepared.candidate.runtime,
  runtimeAssetBytes: prepared.candidate.assetBytes.byteLength,
  totalFrames: atlases.reduce((total, atlas) => total + atlas.frameCount, 0),
})}\n`);

interface Evidence {
  readonly schemaVersion: number;
  readonly motion: string;
  readonly durationMs: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly mediaType: string;
  readonly synthesis: Readonly<{ width: number; height: number; outputFrames: number; status: string }>;
}

interface EncodingReport {
  readonly schemaVersion: number;
  readonly motions: Readonly<Record<PetMotion, Readonly<{
    width: number;
    height: number;
    columns: number;
    rows: number;
    frameCount: number;
    path: string;
    mediaType: 'image/png' | 'image/webp';
  }>>>;
}

function assertEvidence(motion: PetMotion, value: Evidence): void {
  if (
    value.schemaVersion !== 1
    || value.motion !== motion
    || value.mediaType !== 'image/png'
    || value.synthesis.status !== 'complete'
    || value.synthesis.outputFrames !== value.frameCount
    || !positiveInteger(value.durationMs)
    || !positiveInteger(value.columns)
    || !positiveInteger(value.rows)
    || !positiveInteger(value.frameCount)
    || !positiveInteger(value.synthesis.width)
    || !positiveInteger(value.synthesis.height)
  ) throw new Error(`invalid synthesis evidence: ${motion}`);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
