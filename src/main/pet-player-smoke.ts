import { BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PET_MOTIONS } from '../shared/pet-package.js';
import type { PetPlayerOutputMessage } from '../shared/pet-player-protocol.js';
import { prepareFrameSequenceRuntimeCandidate } from './pet/pet-package-preflight.js';
import { createPetPlayerRealm } from './pet/pet-player-realm.js';

export const petPlayerSmokeArgument = '--pet-player-smoke-test';
export const petPlayerSmokePackagePrefix = '--pet-package=';
export const petPlayerSmokeMarker = 'DEEPSEEK_YUKIRYOU_PET_PLAYER_SMOKE_OK';

export function petPlayerSmokePackagePath(arguments_: readonly string[]): string | undefined {
  if (!arguments_.includes(petPlayerSmokeArgument)) return undefined;
  const value = arguments_.find((argument) => argument.startsWith(petPlayerSmokePackagePrefix))
    ?.slice(petPlayerSmokePackagePrefix.length);
  return value === undefined || value.length === 0 ? undefined : value;
}

export async function runPetPlayerSmoke(moduleDirectory: string, packagePath: string): Promise<void> {
  const archive = await readFile(packagePath);
  const prepared = await prepareFrameSequenceRuntimeCandidate(archive);
  if (prepared.status !== 'accepted') throw new Error(`package rejected: ${prepared.code}`);
  const host = new BrowserWindow({
    show: true,
    // A fully transparent host is not composited by macOS, so capturePage()
    // would compare two blank images and falsely report a static animation.
    opacity: 1,
    skipTaskbar: true,
    frame: false,
    width: 320,
    height: 360,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  let crashReason: string | undefined;
  let metrics: Extract<PetPlayerOutputMessage, { kind: 'metrics' }> | undefined;
  const startedAt = Date.now();
  const outputTimeline: string[] = [];
  const realm = createPetPlayerRealm({
    host,
    entryUrl: pathToFileURL(join(moduleDirectory, `../renderer/${PET_PLAYER_VITE_NAME}/index.html`)).toString(),
    preloadPath: join(moduleDirectory, 'pet-player-preload-entry.cjs'),
    handshakeTimeoutMs: 20_000,
    onCrash(reason) { crashReason = reason; },
    onOutput(message) {
      outputTimeline.push(`${message.kind}:${String(Date.now() - startedAt)}ms`);
      if (message.kind === 'metrics') metrics = message;
    },
  });
  try {
    await host.loadURL('about:blank');
    try {
      await realm.start({ petGeneration: 1, ...prepared.candidate });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} outputs=${outputTimeline.join(',') || 'none'}`);
    }
    const startupMs = Date.now() - startedAt;
    if (startupMs > 15_000) throw new Error(`pet player startup exceeded budget: ${String(startupMs)}ms`);
    let presentationGeneration = 0;
    presentationGeneration += 1;
    realm.present({
      bounds: { x: 0, y: 0, width: 288, height: 312 },
      petGeneration: 1,
      presentationGeneration,
      state: 'standing',
      reducedMotion: false,
      devicePixelRatio: 1,
    });
    // BrowserWindow.capturePage() does not include a child WebContentsView on
    // every macOS/Electron combination. Motion identity is checked while the
    // encoded atlas is built; this smoke verifies the real renderer loop and
    // every semantic state without relying on a blank host screenshot.
    await delay(1_320);
    for (const state of PET_MOTIONS) {
      presentationGeneration += 1;
      realm.present({
        bounds: { x: 0, y: 0, width: 288, height: 312 },
        petGeneration: 1,
        presentationGeneration,
        state,
        reducedMotion: false,
        devicePixelRatio: 1,
      });
      await delay(180);
      if (crashReason !== undefined) throw new Error(`realm crashed: ${crashReason}`);
    }
    await waitForMetrics(() => metrics, 7_000);
    if (metrics === undefined || metrics.sampleWindowMs < 1_000 || metrics.refreshPeriodMs <= 0) {
      throw new Error('player produced no usable frame metrics');
    }
    process.stdout.write(`${petPlayerSmokeMarker} ${JSON.stringify({
      packageId: prepared.package.id,
      runtime: prepared.candidate.runtime,
      assetBytes: prepared.candidate.assetBytes.byteLength,
      motionsPresented: PET_MOTIONS.length,
      sampleWindowMs: Math.round(metrics.sampleWindowMs),
      refreshPeriodMs: Number(metrics.refreshPeriodMs.toFixed(2)),
      frameP95Ms: Number(metrics.frameP95Ms.toFixed(2)),
      overDoublePeriodRatio: Number(metrics.overDoublePeriodRatio.toFixed(4)),
      longTaskCount: metrics.longTaskCount,
      startupMs,
      outputs: outputTimeline,
    })}\n`);
  } finally {
    realm.dispose();
    if (!host.isDestroyed()) host.destroy();
  }
}

async function waitForMetrics(
  read: () => Extract<PetPlayerOutputMessage, { kind: 'metrics' }> | undefined,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (read() === undefined && Date.now() < deadline) await delay(50);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
