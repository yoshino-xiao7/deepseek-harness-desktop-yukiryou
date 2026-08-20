import { PetVisualGenerationError } from './frame-sequence-generation-orchestrator.js';
import type { PetMainLookAdapter } from './clip-based-pet-visual-backend.js';

const MAX_MAIN_LOOK_BYTES = 20 * 1024 * 1024;

export class PrimaryReferenceMainLookAdapter implements PetMainLookAdapter {
  readonly id = 'primary-reference-main-look';
  readonly version = '1.0.0';
  readonly extraProviderCredentialRequired = false;

  async generate(request: Parameters<PetMainLookAdapter['generate']>[0]): ReturnType<PetMainLookAdapter['generate']> {
    if (request.signal.aborted) throw new Error('aborted');
    const primary = request.references.filter(({ role }) => role === 'primary');
    if (primary.length !== 1) throw new PetVisualGenerationError('invalid-request', 'one primary character reference is required');
    const reference = primary[0]!;
    if ((reference.mediaType !== 'image/png' && reference.mediaType !== 'image/webp')
      || reference.bytes.byteLength < 1 || reference.bytes.byteLength > MAX_MAIN_LOOK_BYTES) {
      throw new PetVisualGenerationError('invalid-request', 'primary character reference must be PNG or WebP');
    }
    return { mediaType: reference.mediaType, bytes: Uint8Array.from(reference.bytes) };
  }
}
