import {
  Alignment,
  Fit,
  Layout,
  Rive,
  RuntimeLoader,
  StateMachineInputType,
} from '@rive-app/canvas-lite';
import riveWasmDataUrl from '@rive-app/canvas-lite/rive.wasm?url';

import {
  RIVE_SPIKE_MOTION_INPUT,
  RIVE_SPIKE_STATE_MACHINE,
  type RiveCanvasLiteInstance,
  type RiveCanvasLiteRuntime,
} from './rive-canvas-lite-adapter.js';

let preparePromise: Promise<void> | undefined;

export function createRiveCanvasLiteRuntime(): RiveCanvasLiteRuntime {
  return {
    prepare(): Promise<void> {
      preparePromise ??= prepareOfflineRuntime();
      return preparePromise;
    },
    create(input): Promise<RiveCanvasLiteInstance> {
      return createInstance(input.canvas, input.assetBytes);
    },
  };
}

async function prepareOfflineRuntime(): Promise<void> {
  RuntimeLoader.setWasmFallbackUrl(null);
  RuntimeLoader.setWasmBinary(decodeInlineWasm(riveWasmDataUrl));
  await RuntimeLoader.awaitInstance();
}

function createInstance(canvas: HTMLCanvasElement, assetBytes: ArrayBuffer): Promise<RiveCanvasLiteInstance> {
  return new Promise((resolve, reject) => {
    let rive: Rive | undefined;
    let settled = false;
    const rejectLoad = (): void => {
      if (settled) return;
      settled = true;
      rive?.cleanup();
      reject(new Error('Rive asset failed to load'));
    };
    const acceptLoad = (): void => {
      queueMicrotask(() => {
        if (settled || rive === undefined) return;
        const stateMachineNames = rive.stateMachineNames;
        const stateMachineInputs = rive.stateMachineInputs(RIVE_SPIKE_STATE_MACHINE);
        const motionInput = stateMachineInputs[0];
        const hasExactRuntimeContract = stateMachineNames.length === 1
          && stateMachineNames[0] === RIVE_SPIKE_STATE_MACHINE
          && stateMachineInputs.length === 1
          && motionInput?.name === RIVE_SPIKE_MOTION_INPUT
          && motionInput.type === StateMachineInputType.Number;
        if (!hasExactRuntimeContract || motionInput === undefined) {
          rejectLoad();
          return;
        }
        settled = true;
        let cleanedUp = false;
        resolve({
          setMotion(value): void {
            if (!cleanedUp) motionInput.value = value;
          },
          resize(width, height, devicePixelRatio): void {
            if (cleanedUp) return;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            rive?.resizeDrawingSurfaceToCanvas(devicePixelRatio);
          },
          startRendering(): void {
            if (!cleanedUp) rive?.startRendering();
          },
          stopRendering(): void {
            if (!cleanedUp) rive?.stopRendering();
          },
          drawFrame(): void {
            if (!cleanedUp) rive?.drawFrame();
          },
          cleanup(): void {
            if (cleanedUp) return;
            cleanedUp = true;
            rive?.cleanup();
            rive = undefined;
          },
        });
      });
    };
    rive = new Rive({
      canvas,
      buffer: assetBytes,
      stateMachines: RIVE_SPIKE_STATE_MACHINE,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
      autoplay: true,
      autoBind: false,
      enableRiveAssetCDN: false,
      shouldDisableRiveListeners: true,
      automaticallyHandleEvents: false,
      useOffscreenRenderer: false,
      onLoad: acceptLoad,
      onLoadError: rejectLoad,
    });
  });
}

function decodeInlineWasm(dataUrl: string): ArrayBuffer {
  const separator = dataUrl.indexOf(',');
  if (separator < 0 || !dataUrl.slice(0, separator).endsWith(';base64')) {
    throw new Error('Rive WASM must be bundled as an inline base64 asset');
  }
  const binary = atob(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
