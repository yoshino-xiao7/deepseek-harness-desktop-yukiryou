export interface DocumentReadinessPort {
  readonly readyState: DocumentReadyState;
  addEventListener(type: 'DOMContentLoaded', listener: () => void, options?: { once: boolean }): void;
}

export function runWhenDocumentReady(
  documentPort: DocumentReadinessPort,
  start: () => void,
): void {
  if (documentPort.readyState === 'loading') {
    documentPort.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
