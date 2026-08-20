const MAX_FRAME_PIXELS = 4096 * 4096;
const DEFAULT_ALPHA_THRESHOLD = 16;

export interface PetPixelBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PetChromaKeyFrameResult {
  readonly rgba: Uint8ClampedArray;
  readonly foregroundBounds: PetPixelBounds;
  readonly perimeterOpaquePixels: number;
}

export interface PetStablePlacement {
  readonly source: PetPixelBounds;
  readonly scale: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly destinationWidth: number;
  readonly destinationHeight: number;
}

export function removePetGreenScreen(input: Readonly<{
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}>): PetChromaKeyFrameResult {
  validateFrame(input);
  const output = new Uint8ClampedArray(input.rgba);
  let left = input.width;
  let top = input.height;
  let right = -1;
  let bottom = -1;
  let perimeterOpaquePixels = 0;

  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const offset = (y * input.width + x) * 4;
      const red = output[offset]!;
      const green = output[offset + 1]!;
      const blue = output[offset + 2]!;
      const sourceAlpha = output[offset + 3]!;
      const distance = Math.hypot(red, 255 - green, blue);
      const greenDominance = green - Math.max(red, blue);
      const distanceOpacity = smoothstep(30, 120, distance);
      const dominanceOpacity = 1 - smoothstep(20, 80, greenDominance);
      const opacity = Math.max(distanceOpacity, dominanceOpacity);
      const alpha = Math.round(sourceAlpha * opacity);
      output[offset + 3] = alpha;

      if (opacity < 1 && green > Math.max(red, blue)) {
        const neutralGreen = Math.max(red, blue);
        output[offset + 1] = Math.round(neutralGreen + (green - neutralGreen) * opacity);
      }
      if (alpha > DEFAULT_ALPHA_THRESHOLD) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        if (x === 0 || y === 0 || x === input.width - 1 || y === input.height - 1) perimeterOpaquePixels += 1;
      }
    }
  }
  if (right < left || bottom < top) throw new Error('chroma-key frame contains no foreground');
  return {
    rgba: output,
    foregroundBounds: { left, top, right, bottom },
    perimeterOpaquePixels,
  };
}

export function planStablePetPlacement(input: Readonly<{
  frameWidth: number;
  frameHeight: number;
  frameBounds: readonly PetPixelBounds[];
  cellWidth: number;
  cellHeight: number;
  padding: number;
}>): PetStablePlacement {
  if (
    !positiveInteger(input.frameWidth)
    || !positiveInteger(input.frameHeight)
    || !positiveInteger(input.cellWidth)
    || !positiveInteger(input.cellHeight)
    || !Number.isInteger(input.padding)
    || input.padding < 0
    || input.padding * 2 >= input.cellWidth
    || input.padding * 2 >= input.cellHeight
    || input.frameBounds.length < 1
  ) throw new Error('invalid stable placement input');
  const source = unionBounds(input.frameBounds, input.frameWidth, input.frameHeight);
  const sourceWidth = source.right - source.left + 1;
  const sourceHeight = source.bottom - source.top + 1;
  const scale = Math.min(
    (input.cellWidth - input.padding * 2) / sourceWidth,
    (input.cellHeight - input.padding * 2) / sourceHeight,
  );
  const destinationWidth = sourceWidth * scale;
  const destinationHeight = sourceHeight * scale;
  return {
    source,
    scale,
    destinationX: (input.cellWidth - destinationWidth) / 2,
    destinationY: input.cellHeight - input.padding - destinationHeight,
    destinationWidth,
    destinationHeight,
  };
}

function unionBounds(bounds: readonly PetPixelBounds[], frameWidth: number, frameHeight: number): PetPixelBounds {
  let left = frameWidth;
  let top = frameHeight;
  let right = -1;
  let bottom = -1;
  for (const value of bounds) {
    if (
      !Number.isInteger(value.left)
      || !Number.isInteger(value.top)
      || !Number.isInteger(value.right)
      || !Number.isInteger(value.bottom)
      || value.left < 0
      || value.top < 0
      || value.right < value.left
      || value.bottom < value.top
      || value.right >= frameWidth
      || value.bottom >= frameHeight
    ) throw new Error('invalid foreground bounds');
    left = Math.min(left, value.left);
    top = Math.min(top, value.top);
    right = Math.max(right, value.right);
    bottom = Math.max(bottom, value.bottom);
  }
  return { left, top, right, bottom };
}

function validateFrame(input: Readonly<{ rgba: Uint8ClampedArray; width: number; height: number }>): void {
  if (
    !(input.rgba instanceof Uint8ClampedArray)
    || !positiveInteger(input.width)
    || !positiveInteger(input.height)
    || input.width * input.height > MAX_FRAME_PIXELS
    || input.rgba.byteLength !== input.width * input.height * 4
  ) throw new Error('invalid chroma-key frame');
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
