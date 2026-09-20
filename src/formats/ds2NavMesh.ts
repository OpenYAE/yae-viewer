/**
 * `.ds2aim` AI navigation grid. Ported from the YAE SDK `ds2NavMesh.ts`
 * (reader only). Positions are fixed point (÷256) times the empirical world
 * scale 205; a cell's stored position is its **min corner** and the cell
 * covers `[x, x + cellSize)` — the engine's reading (`Invariants.md`, "A nav
 * cell is its min corner"); the eight neighbour slots run clockwise from
 * (−X, +Y). Coordinates are kept in DS2's Z-up space.
 */
import { BinaryReader } from './binaryReader';

export const DS2_NAVMESH_WORLD_SCALE = 205.0;

export type DS2NavMeshNode = {
  x: number;
  y: number;
  z: number;
  flags: number;
  portalRef: number;
  /** eight neighbour ids in file order, -1 = none */
  neighborSlots: number[];
};

export type DS2NavMeshPortal = { x: number; y: number; z: number; flags: number; neighbors: number[]; edgeData: number[] };

export type DS2NavMesh = {
  /** the file's cell size in world units (`cellSizeRaw × 205`) */
  cellSize: number;
  gridSize: number;
  /** distance between neighbouring nodes in world units: `gridSize / 256 × 205` (25.625 on every campaign map) */
  spacing: number;
  worldScale: number;
  nodes: DS2NavMeshNode[];
  portals: DS2NavMeshPortal[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
};

export function parseDS2AIM(bytes: Uint8Array): DS2NavMesh {
  const r = new BinaryReader(bytes);
  const worldScale = DS2_NAVMESH_WORLD_SCALE;
  const cellSizeRaw = r.readFloatLE();
  const gridSize = r.readUInt32LE();
  const nodeCount = r.readUInt32LE();
  if (!(cellSizeRaw > 0) || nodeCount === 0 || nodeCount * 49 > r.remaining()) {
    throw new Error(`Not a .ds2aim file (cell ${cellSizeRaw}, ${nodeCount} nodes)`);
  }
  const toWorld = (v: number) => (v / 256) * worldScale;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const nodes: DS2NavMeshNode[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    const x = toWorld(r.readInt32LE());
    const y = toWorld(r.readInt32LE());
    const z = toWorld(r.readInt32LE());
    const flags = r.readUInt8();
    const portalRef = r.readInt32LE();
    const neighborSlots: number[] = new Array(8);
    for (let s = 0; s < 8; s += 1) {
      const id = r.readInt32LE();
      neighborSlots[s] = id >= 0 && id < nodeCount ? id : -1;
    }
    nodes[i] = { x, y, z, flags, portalRef, neighborSlots };
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  const portals: DS2NavMeshPortal[] = [];
  if (r.remaining() >= 8) {
    r.readUInt32LE(); // connection buffer size
    const portalCount = r.readUInt32LE();
    for (let i = 0; i < portalCount && r.remaining() >= 14; i += 1) {
      const x = toWorld(r.readInt32LE());
      const y = toWorld(r.readInt32LE());
      const z = toWorld(r.readInt32LE());
      const flags = r.readUInt8();
      const neighborCount = r.readUInt8();
      const neighbors: number[] = [];
      const edgeData: number[] = [];
      for (let j = 0; j < neighborCount; j += 1) {
        neighbors.push(r.readInt32LE());
        edgeData.push(r.readUInt8());
      }
      portals.push({ x, y, z, flags, neighbors, edgeData });
    }
  }
  return { cellSize: cellSizeRaw * worldScale, gridSize, spacing: (gridSize / 256) * worldScale, worldScale, nodes, portals, bounds: { min, max } };
}
