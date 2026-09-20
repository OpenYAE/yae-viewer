/**
 * Level collision meshes: `.ds2cm` (`DS2CollisionMap_1`, May 2006, groups per
 * face) and `.ds2cm2` (`DS2CollisionMap`, September 2006, named materials per
 * face). Ported from the YAE SDK `ds2Collision.ts`; the vertices are kept in
 * DS2's Z-up space like the level geometry (the SDK negated Y and swapped
 * axes for its own overlay — the same change of basis the scene applies once
 * above everything), and a v2 face's material is its fifth word: the fourth
 * is the plane index (the engine's reading, `Invariants.md`).
 */
import { BinaryReader } from './binaryReader';

export type DS2CollisionFace = { v0: number; v1: number; v2: number; planeIndex: number; group: number };

export type DS2Collision = {
  version: 1 | 2;
  /** v2 only: material names indexed by a face's `group` */
  materials: string[];
  /** xyz per vertex, Z-up */
  vertices: Float32Array;
  faces: DS2CollisionFace[];
  /** distinct `group` values */
  groups: number[];
};

export function parseDS2CM(bytes: Uint8Array): DS2Collision {
  const r = new BinaryReader(bytes);
  const signature = r.readPrefixedString();
  if (signature !== 'DS2CollisionMap_1') throw new Error(`Not a .ds2cm file (signature "${signature}")`);
  r.readPrefixedString(); // version, "0.5"
  const vertexCount = r.readUInt32LE();
  const vertices = r.readFloat32Array(vertexCount * 3);
  const planeCount = r.readUInt32LE();
  r.skip(planeCount * 16);
  const faceCount = r.readUInt32LE();
  const faces: DS2CollisionFace[] = new Array(faceCount);
  const groups = new Set<number>();
  for (let i = 0; i < faceCount; i += 1) {
    const face = { v0: r.readUInt32LE(), v1: r.readUInt32LE(), v2: r.readUInt32LE(), planeIndex: r.readUInt32LE(), group: r.readUInt32LE() };
    faces[i] = face;
    groups.add(face.group);
  }
  return { version: 1, materials: [], vertices, faces, groups: [...groups].sort((a, b) => a - b) };
}

export function parseDS2CM2(bytes: Uint8Array): DS2Collision {
  const r = new BinaryReader(bytes);
  const signature = r.readPrefixedString();
  if (signature !== 'DS2CollisionMap') throw new Error(`Not a .ds2cm2 file (signature "${signature}")`);
  r.readUInt32LE(); // unknown
  const materialCount = r.readUInt32LE();
  const materials: string[] = [];
  for (let i = 0; i < materialCount; i += 1) materials.push(r.readPrefixedString());
  const vertexCount = r.readUInt32LE();
  const vertices = r.readFloat32Array(vertexCount * 3);
  const faceCount = r.readUInt32LE();
  const faces: DS2CollisionFace[] = new Array(faceCount);
  const groups = new Set<number>();
  for (let i = 0; i < faceCount; i += 1) {
    const face = { v0: r.readUInt32LE(), v1: r.readUInt32LE(), v2: r.readUInt32LE(), planeIndex: r.readUInt32LE(), group: r.readUInt32LE() };
    faces[i] = face;
    groups.add(face.group);
  }
  return { version: 2, materials, vertices, faces, groups: [...groups].sort((a, b) => a - b) };
}
