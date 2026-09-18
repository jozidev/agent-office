/**
 * Office layout, Game-Dev-Tycoon style: agents sit around shared desk islands
 * (up to 4 per island, two facing +x and two facing +z so every face is
 * visible from the isometric camera). Islands sit on a grid in the middle of
 * the room; the kitchen runs along the back wall, meeting and lounge zones
 * along the right side.
 *
 * World axes: +x runs down-right on screen, +z runs down-left.
 */
export const SEATS_PER_ISLAND = 4;
export const ISLANDS_PER_ROW = 2;
export const ISLAND_GAP = 5.6;
export const KITCHEN_DEPTH = 2.6; // strip along -z
export const SIDE_DEPTH = 3.4; // strip along +x for meeting + lounge
export const PAD = 1.4;

export interface Seat {
  island: number;
  /** offset from island centre */
  offset: [number, number];
  /** yaw so the character faces +x (π/2) or +z (0) */
  yaw: number;
}

/** Seat offsets around the island block; block is 2.4 x 2.4 centred on origin. */
const SEAT_OFFSETS: Seat["offset"][] = [
  [-1.15, -0.6],
  [-1.15, 0.6],
  [-0.6, -1.15],
  [0.6, -1.15],
];
const SEAT_YAWS = [Math.PI / 2, Math.PI / 2, 0, 0];

export function islandCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(total, 1) / SEATS_PER_ISLAND));
}

export function islandGrid(total: number): { rows: number; cols: number } {
  const n = islandCount(total);
  return { rows: Math.ceil(n / ISLANDS_PER_ROW), cols: Math.min(ISLANDS_PER_ROW, n) };
}

export function roomSize(total: number): { w: number; d: number } {
  const { rows, cols } = islandGrid(total);
  return {
    w: rows * ISLAND_GAP + SIDE_DEPTH + PAD * 2,
    d: cols * ISLAND_GAP + KITCHEN_DEPTH + PAD * 2,
  };
}

/** World position of island i's centre. Rows run along +x, columns along +z. */
export function islandPosition(i: number, total: number): [number, number, number] {
  const { rows, cols } = islandGrid(total);
  const { w, d } = roomSize(total);
  const row = Math.floor(i / ISLANDS_PER_ROW);
  const col = i % ISLANDS_PER_ROW;
  // island area starts after the left pad (x) and after the kitchen strip (z)
  const x0 = -w / 2 + PAD + ISLAND_GAP / 2;
  const z0 = -d / 2 + KITCHEN_DEPTH + PAD + ISLAND_GAP / 2;
  void rows;
  void cols;
  return [x0 + row * ISLAND_GAP, 0, z0 + col * ISLAND_GAP];
}

export function seatFor(desk: number, total: number): { position: [number, number, number]; yaw: number; island: number } {
  const island = Math.floor(desk / SEATS_PER_ISLAND);
  const s = desk % SEATS_PER_ISLAND;
  const [ix, , iz] = islandPosition(island, total);
  const [ox, oz] = SEAT_OFFSETS[s]!;
  return { position: [ix + ox, 0, iz + oz], yaw: SEAT_YAWS[s]!, island };
}
