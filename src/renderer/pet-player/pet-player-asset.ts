import { PET_PLAYER_MAX_ASSET_BYTES } from '../../shared/pet-player-protocol.js';

export async function verifyPetPlayerAsset(input: {
  readonly bytes: ArrayBuffer;
  readonly byteLength: number;
  readonly sha256: string;
}): Promise<boolean> {
  if (
    !Number.isSafeInteger(input.byteLength)
    || input.byteLength <= 0
    || input.byteLength > PET_PLAYER_MAX_ASSET_BYTES
    || input.bytes.byteLength !== input.byteLength
    || !/^[a-f0-9]{64}$/.test(input.sha256)
  ) return false;
  try {
    const digest = await crypto.subtle.digest('SHA-256', input.bytes);
    return toHex(new Uint8Array(digest)) === input.sha256;
  } catch {
    return false;
  }
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
