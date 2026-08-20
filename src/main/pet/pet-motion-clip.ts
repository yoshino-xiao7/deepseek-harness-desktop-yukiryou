import type { GeneratedMotionAtlas } from './frame-sequence-authoring-adapter.js';
import type {
  PetMotionGenerationSpec,
  PetVisualReference,
} from './frame-sequence-generation-orchestrator.js';

export interface PetGeneratedMotionClip {
  readonly mediaType: 'video/mp4';
  readonly bytes: Uint8Array;
  readonly sourceDurationMs: number;
}

export interface PetMotionClipRequest {
  readonly inputRequest: string;
  readonly canonicalLook: PetVisualReference;
  readonly spec: PetMotionGenerationSpec;
  readonly signal: AbortSignal;
}

export interface PetMotionClipAdapter {
  readonly id: string;
  readonly version: string;
  readonly extraProviderCredentialRequired: boolean;
  generate(request: PetMotionClipRequest): Promise<PetGeneratedMotionClip>;
}

export interface PetMotionRasterizationEvidence {
  readonly decodedFrameCount: number;
  readonly targetFrameCount: number;
  readonly uniqueFrameCount: number;
  readonly transparentEdges: 'pass' | 'fail';
  readonly stableRegistration: 'pass' | 'fail';
  readonly stageBounds: 'pass' | 'fail';
}

export interface PetMotionClipRasterization {
  readonly atlas: GeneratedMotionAtlas;
  readonly evidence: PetMotionRasterizationEvidence;
}

export interface PetMotionClipRasterizerRequest {
  readonly clip: PetGeneratedMotionClip;
  readonly spec: PetMotionGenerationSpec;
  readonly chromaKey: Readonly<{
    readonly red: 0;
    readonly green: 255;
    readonly blue: 0;
  }>;
  readonly signal: AbortSignal;
}

export interface PetMotionClipRasterizer {
  readonly id: string;
  readonly version: string;
  rasterize(request: PetMotionClipRasterizerRequest): Promise<PetMotionClipRasterization>;
}
