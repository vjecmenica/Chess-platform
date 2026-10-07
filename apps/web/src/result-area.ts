export const minimumResultHeight = 52;

export function resizedResultHeight(startHeight: number, maximumHeight: number,
  distanceY: number): number {
  return Math.round(Math.max(Math.min(minimumResultHeight, maximumHeight),
    Math.min(maximumHeight, startHeight + distanceY)));
}

export function isCompactResultHeight(height: number | null, maximumHeight: number | null): boolean {
  return height !== null && maximumHeight !== null && height < maximumHeight - 4;
}
