/** Desk grid: rows of COLS, spaced apart, centred on the origin. */
export const COLS = 3;
export const SPACING_X = 3.2;
export const SPACING_Z = 3.4;

export function deskPosition(desk: number, total: number): [number, number, number] {
  const rows = Math.max(1, Math.ceil(Math.max(total, 1) / COLS));
  const col = desk % COLS;
  const row = Math.floor(desk / COLS);
  const x = (col - (COLS - 1) / 2) * SPACING_X;
  const z = (row - (rows - 1) / 2) * SPACING_Z;
  return [x, 0, z];
}

export function roomSize(total: number): { w: number; d: number } {
  const rows = Math.max(2, Math.ceil(Math.max(total, 1) / COLS));
  return { w: COLS * SPACING_X + 2.5, d: rows * SPACING_Z + 3 };
}
