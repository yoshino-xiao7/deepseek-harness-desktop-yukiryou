import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PET_MOTION_GENERATION_SPECS } from './pet/frame-sequence-generation-orchestrator.js';
import { ChromiumPetMotionRasterizer } from './pet/chromium-pet-motion-rasterizer.js';

export const petMediaWorkerSmokeArgument = '--pet-media-worker-smoke-test';
export const petMediaWorkerSmokeMarker = 'DEEPSEEK_YUKIRYOU_PET_MEDIA_SMOKE_OK';

export function isPetMediaWorkerSmokeTest(arguments_: readonly string[]): boolean {
  return arguments_.includes(petMediaWorkerSmokeArgument);
}

export async function runPetMediaWorkerSmoke(moduleDirectory: string): Promise<void> {
  const fixture = await generateFixtureMp4();
  process.stderr.write(`Pet media smoke fixture ready: ${String(fixture.bytes.byteLength)} bytes\n`);
  try {
    const rasterizer = new ChromiumPetMotionRasterizer({
      entryUrl: pathToFileURL(join(moduleDirectory, `../renderer/${PET_MEDIA_WORKER_VITE_NAME}/index.html`)).toString(),
      preloadPath: join(moduleDirectory, 'pet-media-worker-preload-entry.cjs'),
      timeoutMs: 120_000,
    });
    const result = await rasterizer.rasterize({
      clip: { mediaType: 'video/mp4', bytes: fixture.bytes, sourceDurationMs: 2_000 },
      spec: PET_MOTION_GENERATION_SPECS['work-enter'],
      chromaKey: { red: 0, green: 255, blue: 0 },
      signal: new AbortController().signal,
    });
    const evidence = result.evidence;
    const decoded = await rasterizer.decode(result.atlas, new AbortController().signal);
    const minimumUniqueFrames = Math.ceil(result.atlas.frameCount * 0.9);
    if (
      evidence.uniqueFrameCount < minimumUniqueFrames
      || evidence.transparentEdges !== 'pass'
      || evidence.stableRegistration !== 'pass'
      || evidence.stageBounds !== 'pass'
      || decoded.cellWidth !== 192
      || decoded.cellHeight !== 208
      || decoded.frames.length !== result.atlas.frameCount
      || decoded.frames.some((frame) => frame.byteLength !== 192 * 208 * 4)
      || !pngSignature(result.atlas.bytes)
    ) throw new Error(`pet media smoke failed QA: ${JSON.stringify(evidence)}`);
    process.stdout.write(`${petMediaWorkerSmokeMarker} ${JSON.stringify({
      chromium: process.versions.chrome,
      clipBytes: fixture.bytes.byteLength,
      atlasBytes: result.atlas.bytes.byteLength,
      frameCount: result.atlas.frameCount,
      decodedFrames: decoded.frames.length,
      uniqueFrameCount: evidence.uniqueFrameCount,
    })}\n`);
  } finally {
    await fixture.dispose();
  }
}

async function generateFixtureMp4(): Promise<Readonly<{ bytes: Uint8Array; dispose: () => Promise<void> }>> {
  const fixtureWindow = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const fixtureSession = fixtureWindow.webContents.session;
  fixtureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  fixtureSession.setPermissionCheckHandler(() => false);
  fixtureSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (_details, callback) => callback({ cancel: true }));
  await fixtureWindow.loadURL('about:blank');
  try {
    const base64 = await fixtureWindow.webContents.executeJavaScript(`(async () => {
      const mimeTypes = [
        'video/mp4;codecs=avc1.42001E',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
      ];
      const mimeType = mimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (mimeType === undefined) throw new Error('Chromium MP4 MediaRecorder unavailable');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d', { alpha: false });
      if (context === null) throw new Error('fixture canvas unavailable');
      const stream = canvas.captureStream(60);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_000_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = () => reject(new Error('fixture recording failed'));
      });
      recorder.start();
      for (let frame = 0; frame < 120; frame += 1) {
        context.fillStyle = 'rgb(0,255,0)';
        context.fillRect(0, 0, 64, 64);
        context.fillStyle = 'rgb(30,60,220)';
        context.fillRect(8 + frame % 40, 18 + Math.round(Math.sin(frame / 8) * 3), 12, 28);
        await new Promise((resolve) => setTimeout(resolve, 1000 / 60));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: 'video/mp4' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    })()`, true) as string;
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024) throw new Error('invalid generated MP4 fixture');
    return {
      bytes: Uint8Array.from(bytes),
      async dispose(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 500));
        fixtureSession.setPermissionRequestHandler(null);
        fixtureSession.setPermissionCheckHandler(null);
        fixtureSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
        if (!fixtureWindow.isDestroyed()) fixtureWindow.destroy();
      },
    };
  } catch (error) {
    fixtureSession.setPermissionRequestHandler(null);
    fixtureSession.setPermissionCheckHandler(null);
    fixtureSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
    if (!fixtureWindow.isDestroyed()) fixtureWindow.destroy();
    throw error;
  }
}

function pngSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
}
