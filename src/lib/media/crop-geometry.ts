/**
 * Crop geometry in frame-relative units.
 *
 * Offsets are fractions of the crop frame (positive = the image is moved
 * right/down), never pixels. Keeping the model resolution-independent means the
 * on-screen preview and the exported canvas are computed from the same numbers,
 * so what the user framed is exactly what gets uploaded no matter what size the
 * dialog happens to be rendered at.
 *
 * Ratios are width / height throughout.
 */

export type CropState = { zoom: number; offsetX: number; offsetY: number };

export type CropExtent = {
  /** Image width as a multiple of the frame width. */
  width: number;
  /** Image height as a multiple of the frame height. */
  height: number;
};

export type SourceRect = { sx: number; sy: number; width: number; height: number };

export const identityCrop = (): CropState => ({ zoom: 1, offsetX: 0, offsetY: 0 });

/**
 * How much of the frame the image covers on each axis at a given zoom.
 *
 * At zoom 1 the image exactly covers the frame — the shorter axis is 1 and the
 * longer one overflows — which is the "cover" fit the preview starts from.
 */
export function coverExtent(imageRatio: number, frameRatio: number, zoom: number): CropExtent {
  const wide = imageRatio >= frameRatio;
  return {
    width: (wide ? imageRatio / frameRatio : 1) * zoom,
    height: (wide ? 1 : frameRatio / imageRatio) * zoom,
  };
}

/** Hold the framing inside the image, so the frame never shows past an edge. */
export function clampCrop(state: CropState, imageRatio: number, frameRatio: number): CropState {
  const extent = coverExtent(imageRatio, frameRatio, state.zoom);
  const maxX = Math.max(0, (extent.width - 1) / 2);
  const maxY = Math.max(0, (extent.height - 1) / 2);
  return {
    zoom: state.zoom,
    offsetX: Math.min(maxX, Math.max(-maxX, state.offsetX)),
    offsetY: Math.min(maxY, Math.max(-maxY, state.offsetY)),
  };
}

/**
 * The framed region in source pixels — what `drawImage` should copy out.
 *
 * The result is clamped to the image bounds so a state that was never passed
 * through `clampCrop` still produces a rect the canvas can draw.
 */
export function sourceRect(
  imageWidth: number,
  imageHeight: number,
  state: CropState,
  frameRatio: number,
): SourceRect {
  const extent = coverExtent(imageWidth / imageHeight, frameRatio, state.zoom);
  const width = Math.min(imageWidth, imageWidth / extent.width);
  const height = Math.min(imageHeight, imageHeight / extent.height);
  const sx = imageWidth / 2 - state.offsetX * width - width / 2;
  const sy = imageHeight / 2 - state.offsetY * height - height / 2;
  return {
    sx: Math.min(Math.max(0, sx), Math.max(0, imageWidth - width)),
    sy: Math.min(Math.max(0, sy), Math.max(0, imageHeight - height)),
    width,
    height,
  };
}
