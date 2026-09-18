/**
 * Office layout: desks come in pods of two (side by side, sharing a partition
 * and a plant). Pods sit in rows with a walkable aisle between rows. The room
 * grows with the number of pods; the lounge and coffee corner stay at the edges.
 *
 * World axes: +x runs down-right on screen, +z runs down-left. Everyone faces +x.
 */
export const PODS_PER_ROW = 2;
export const POD_GAP_Z = 4.6; // between pods in a row
export const ROW_GAP_X = 4.2; // between rows (aisle)
export const SEAT_GAP_Z = 1.75; // two desks in a pod
export const ROOM_PAD = 1.5;

export interface DeskSlot {
  position: [number, number, number];
  pod: number;
  seat: 0 | 1;
}

export function podCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(total, 1) / 2));
}

export function rowCount(total: number): number {
  return Math.ceil(podCount(total) / PODS_PER_ROW);
}

/** World position of pod p's centre, before centring the whole layout. */
function podOrigin(p: number): [number, number] {
  const row = Math.floor(p / PODS_PER_ROW);
  const col = p % PODS_PER_ROW;
  return [row * ROW_GAP_X, col * POD_GAP_Z];
}

function layoutOffset(total: number): [number, number] {
  const rows = rowCount(total);
  const cols = Math.min(PODS_PER_ROW, podCount(total));
  return [((rows - 1) * ROW_GAP_X) / 2, ((cols - 1) * POD_GAP_Z) / 2 + SEAT_GAP_Z / 2];
}

export function deskSlot(desk: number, total: number): DeskSlot {
  const pod = Math.floor(desk / 2);
  const seat = (desk % 2) as 0 | 1;
  const [px, pz] = podOrigin(pod);
  const [ox, oz] = layoutOffset(total);
  return { position: [px - ox, 0, pz + seat * SEAT_GAP_Z - oz], pod, seat };
}

export function podPositions(total: number): [number, number, number][] {
  const [ox, oz] = layoutOffset(total);
  return Array.from({ length: podCount(total) }, (_, p) => {
    const [px, pz] = podOrigin(p);
    return [px - ox, 0, pz + SEAT_GAP_Z / 2 - oz];
  });
}

export function roomSize(total: number): { w: number; d: number } {
  const rows = rowCount(total);
  const cols = Math.min(PODS_PER_ROW, podCount(total));
  return {
    w: Math.max(2, rows) * ROW_GAP_X + ROOM_PAD * 2 + 1.6, // extra x leaves room for the lounge
    d: Math.max(2, cols) * POD_GAP_Z + ROOM_PAD * 2 - 0.6,
  };
}
