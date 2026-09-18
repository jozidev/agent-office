/**
 * Classroom layout: individual desks in rows, everyone facing +x (down-right,
 * towards the viewer). New hires fill the front row first; a new row appears
 * behind when a row is full, and the room grows backwards (in -x).
 *
 * World axes: +x runs down-right on screen, +z runs down-left.
 */
export const DESKS_PER_ROW = 3;
export const DESK_GAP_Z = 2.5; // between desks in a row
export const ROW_GAP_X = 3.1; // between rows
export const KITCHEN_DEPTH = 2.6; // strip along -z (back wall)
export const SIDE_DEPTH = 1.2; // breathing room in front of the first row
export const PAD = 1.3;

export function rowCount(total: number): number {
  return Math.max(2, Math.ceil(Math.max(total, 1) / DESKS_PER_ROW));
}

export function roomSize(total: number): { w: number; d: number } {
  return {
    w: rowCount(total) * ROW_GAP_X + SIDE_DEPTH + PAD * 2,
    d: DESKS_PER_ROW * DESK_GAP_Z + KITCHEN_DEPTH + PAD * 2 + 0.8,
  };
}

/** x of the front row (closest to the +x side), and z of the first column. */
function origin(total: number): [number, number] {
  const { w, d } = roomSize(total);
  const xFront = w / 2 - SIDE_DEPTH - PAD - 0.4;
  const z0 = -d / 2 + KITCHEN_DEPTH + PAD + 0.9;
  return [xFront, z0];
}

export function seatFor(desk: number, total: number): { position: [number, number, number]; yaw: number; row: number; col: number } {
  const row = Math.floor(desk / DESKS_PER_ROW);
  const col = desk % DESKS_PER_ROW;
  const [xFront, z0] = origin(total);
  return { position: [xFront - row * ROW_GAP_X, 0, z0 + col * DESK_GAP_Z], yaw: Math.PI / 2, row, col };
}

/** Positions for row-end dressing (a plant at the aisle end of each row). */
export function rowEnds(total: number): [number, number, number][] {
  const [xFront, z0] = origin(total);
  return Array.from({ length: rowCount(total) }, (_, r) => [xFront - r * ROW_GAP_X, 0, z0 + DESKS_PER_ROW * DESK_GAP_Z - 0.9]);
}
