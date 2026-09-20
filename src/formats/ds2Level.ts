/**
 * `.ds2` level geometry (`DS2GeometryFile_1`). Ported from the YAE SDK
 * (`packages/formats/src/{ds2Level,levelMesh,yaeBuffer,ds2MeshGeometry}.ts`)
 * with the vertex buffers kept as typed arrays: a campaign level holds a few
 * million floats and arrays of `{x, y, z}` objects are what made the old
 * viewer pause for seconds on load.
 *
 * Everything in the file is in DS2's own Z-up space (X right, Y forward, Z up,
 * 64 units per metre); the scene puts one -90° X rotation above it.
 */
import { BinaryReader, type BBox, type Vec3 } from './binaryReader';

export type VistreeNode = {
  bboxMin: Vec3;
  bboxMax: Vec3;
  splitDist: number;
  center: Vec3;
  /** true = leaf with mesh indices in `data`, false = node with 8 child refs (0xffffffff = none) */
  isLeaf: boolean;
  data: number[];
};

export type LevelLight = {
  /** 1 = point light, 3 = spot light */
  type: number;
  position: Vec3;
  direction: Vec3;
  /** RGB 0..1 */
  color: Vec3;
  /** the eight raw u32 parameters */
  params: number[];
  innerRadius: number;
  outerRadius: number;
  range: number;
  intensity: number;
  falloff: number;
  castShadows: boolean;
  layer: number;
};

export type LevelModelDesc = { xform: number[]; bbox: BBox };
export type LevelModel = { name: string; bbox: BBox; descs: LevelModelDesc[] };

export const YAE_BUFFER_MASK = {
  INDICES: 0x01,
  POINTS: 0x02,
  NORMALS: 0x04,
  TEXCOORDS: 0x08,
  LIGHTMAPS: 0x10,
  COLORS: 0x20,
  TANGENTS: 0x40,
  BINORMALS: 0x80,
} as const;

/** One `buffers` chunk entry: either an index buffer or a vertex stream set. */
export class YAEBuffer {
  signature = 0;
  size = 0;
  /** xyz per vertex */
  points: Float32Array | null = null;
  normals: Float32Array | null = null;
  /** uv per vertex */
  texcoords: Float32Array | null = null;
  lightmaps: Float32Array | null = null;
  /** rgba per vertex, each component 0..255 as stored (u32 each in the file) */
  colors: Uint32Array | null = null;
  tangents: Float32Array | null = null;
  binormals: Float32Array | null = null;
  indices: Uint32Array | null = null;

  load(reader: BinaryReader): void {
    this.signature = reader.readUInt32LE();
    this.size = reader.readUInt32LE();
    const n = this.size;
    if (this.signature & YAE_BUFFER_MASK.INDICES) {
      this.indices = reader.readUint32Array(n);
      return;
    }
    if (this.signature & YAE_BUFFER_MASK.POINTS) this.points = reader.readFloat32Array(n * 3);
    if (this.signature & YAE_BUFFER_MASK.TEXCOORDS) this.texcoords = reader.readFloat32Array(n * 2);
    if (this.signature & YAE_BUFFER_MASK.LIGHTMAPS) this.lightmaps = reader.readFloat32Array(n * 2);
    if (this.signature & YAE_BUFFER_MASK.COLORS) this.colors = reader.readUint32Array(n * 4);
    if (this.signature & YAE_BUFFER_MASK.NORMALS) this.normals = reader.readFloat32Array(n * 3);
    if (this.signature & YAE_BUFFER_MASK.TANGENTS) this.tangents = reader.readFloat32Array(n * 3);
    if (this.signature & YAE_BUFFER_MASK.BINORMALS) this.binormals = reader.readFloat32Array(n * 3);
  }
}

/** Strips the path and the `.tga` extension, lower-cases: the key every texture lookup uses. */
export function normalizeTextureName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.(tga|dds|png|jpg|jpeg|bmp)$/i, '').toLowerCase().trim();
}

export class LevelMesh {
  dynamic = false;
  material = '';
  /** normalized texture key (no path, no extension, lower case) */
  texture = '';
  /** the texture name as written in the file */
  textureRaw = '';
  normalMap = '';
  specularMap = '';
  glowMap = '';
  detailMap = '';
  bbox: BBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  center: Vec3 = { x: 0, y: 0, z: 0 };
  radius = 0;
  bboxMinDup: Vec3 = { x: 0, y: 0, z: 0 };
  bboxSize: Vec3 = { x: 0, y: 0, z: 0 };
  localAxes: Vec3[] = [];
  bboxCorners: Vec3[] = [];
  twoSided = false;
  lightmapScale: Vec3 = { x: 0, y: 0, z: 0 };
  lightmapId: number | null = null;
  faceCount = 0;
  vertCount = 0;
  primitiveCount = 0;
  indCount = 0;
  strip = false;
  ibId = 0;
  ibOffset = 0;
  unkStripData: number[] = [0, 0, 0];
  vbId = 0;
  vbOffset = 0;
  cbId = 0;
  cbOffset = 0;
  xform: number[] | null = null;
  objectId = 0;
  instanceId = 0;

  load(reader: BinaryReader): void {
    this.dynamic = reader.readBool();
    this.material = reader.readPrefixedString();
    this.textureRaw = reader.readPrefixedString();
    this.texture = normalizeTextureName(this.textureRaw);
    this.normalMap = reader.readPrefixedString();
    this.specularMap = reader.readPrefixedString();
    this.glowMap = reader.readPrefixedString();
    this.detailMap = reader.readPrefixedString();

    this.bbox = reader.readBBox();
    this.center = reader.readVector3();
    this.radius = reader.readFloatLE();
    this.bboxMinDup = reader.readVector3();
    this.bboxSize = reader.readVector3();
    this.localAxes = [reader.readVector3(), reader.readVector3(), reader.readVector3()];
    this.bboxCorners = [];
    for (let i = 0; i < 8; i += 1) this.bboxCorners.push(reader.readVector3());

    this.twoSided = reader.readBool();
    this.lightmapScale = reader.readInt32Vector3();
    const lightmapId = reader.readUInt32LE();
    this.lightmapId = lightmapId === 0xffffffff ? null : lightmapId;

    this.faceCount = reader.readUInt32LE();
    this.vertCount = reader.readUInt32LE();
    this.primitiveCount = reader.readUInt32LE();
    this.indCount = reader.readUInt32LE();
    this.ibId = reader.readUInt32LE();
    this.ibOffset = reader.readUInt32LE();

    if (this.ibId === 0xffffffff) {
      this.strip = true;
      this.indCount = reader.readUInt32LE();
      this.ibId = reader.readUInt32LE();
      this.ibOffset = reader.readUInt32LE();
    } else {
      this.unkStripData = [reader.readUInt32LE(), reader.readUInt32LE(), reader.readUInt32LE()];
    }

    this.vbId = reader.readUInt32LE();
    this.vbOffset = reader.readUInt32LE();

    if (this.dynamic) {
      this.cbId = reader.readUInt32LE();
      this.cbOffset = reader.readUInt32LE();
      this.xform = reader.readMatrix();
      this.objectId = reader.readUInt32LE();
      this.instanceId = reader.readUInt32LE();
    }
  }
}

export class DS2Level {
  header = { id: '', version: '' };
  meshes: LevelMesh[] = [];
  buffers: YAEBuffer[] = [];
  /** lightmap page names as written (`med1\med1_lm_0`) */
  lightmaps: string[] = [];
  vistree: VistreeNode[] = [];
  lights: LevelLight[] = [];
  models: LevelModel[] = [];

  static parse(bytes: Uint8Array): DS2Level {
    const level = new DS2Level();
    level.read(new BinaryReader(bytes));
    return level;
  }

  read(reader: BinaryReader): void {
    this.header.id = reader.readPrefixedString();
    this.header.version = reader.readPrefixedString();
    if (this.header.id !== 'DS2GeometryFile_1') {
      throw new Error(`Not a DS2 level geometry file (signature "${this.header.id}")`);
    }

    while (!reader.eof()) {
      const chunkStart = reader.readPrefixedString(); // DS2Chunk_begin
      if (!chunkStart || reader.eof()) break;
      const chunkId = reader.readPrefixedString();
      switch (chunkId) {
        case 'meshes':
          this.readMeshes(reader);
          break;
        case 'buffers':
          this.readBuffers(reader);
          break;
        case 'lightmaps':
          this.readLightmaps(reader);
          break;
        case 'vistree':
          this.readVistree(reader);
          break;
        case 'lights':
          this.readLights(reader);
          break;
        case 'models':
          this.readModels(reader);
          break;
        default:
          throw new Error(`Unknown DS2 chunk: ${chunkId}`);
      }
      reader.readPrefixedString(); // DS2Chunk_end
    }
  }

  private readMeshes(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.meshes = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const mesh = new LevelMesh();
      mesh.load(reader);
      this.meshes[i] = mesh;
    }
  }

  private readBuffers(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.buffers = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const buffer = new YAEBuffer();
      buffer.load(reader);
      this.buffers[i] = buffer;
    }
  }

  private readLightmaps(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.lightmaps = [];
    for (let i = 0; i < count; i += 1) this.lightmaps.push(reader.readPrefixedString());
  }

  private readVistree(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.vistree = [];
    for (let i = 0; i < count; i += 1) {
      const node: VistreeNode = {
        bboxMin: reader.readVector3(),
        bboxMax: reader.readVector3(),
        splitDist: reader.readFloatLE(),
        center: reader.readVector3(),
        isLeaf: reader.readBool(),
        data: [],
      };
      const size = node.isLeaf ? reader.readUInt32LE() : 8;
      for (let j = 0; j < size; j += 1) node.data.push(reader.readUInt32LE());
      this.vistree.push(node);
    }
  }

  private readLights(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.lights = [];
    const scratch = new DataView(new ArrayBuffer(4));
    const asFloat = (value: number): number => {
      scratch.setUint32(0, value, true);
      return scratch.getFloat32(0, true);
    };
    for (let i = 0; i < count; i += 1) {
      const type = reader.readUInt32LE();
      const position = reader.readVector3();
      const direction = reader.readVector3();
      const color = reader.readVector3();
      const params: number[] = [];
      for (let j = 0; j < 8; j += 1) params.push(reader.readUInt32LE());
      this.lights.push({
        type,
        position,
        direction,
        color,
        params,
        innerRadius: asFloat(params[0]),
        outerRadius: asFloat(params[1]),
        range: asFloat(params[2]),
        intensity: asFloat(params[3]),
        falloff: asFloat(params[5]),
        castShadows: params[6] === 1,
        layer: params[7],
      });
    }
  }

  private readModels(reader: BinaryReader): void {
    const count = reader.readUInt32LE();
    this.models = [];
    for (let i = 0; i < count; i += 1) {
      const model: LevelModel = { name: reader.readPrefixedString(), bbox: reader.readBBox(), descs: [] };
      const descCount = reader.readUInt32LE();
      for (let j = 0; j < descCount; j += 1) {
        model.descs.push({ xform: reader.readMatrix(), bbox: reader.readBBox() });
      }
      this.models.push(model);
    }
  }
}

export type ResolvedMeshGeometry = {
  /** first source vertex in the vertex buffer */
  sourceVertexStart: number;
  sourceVertexCount: number;
  useVertexOffset: boolean;
  /** triangle-list indices, relative to `sourceVertexStart` */
  indices: Uint32Array;
};

function bboxOfIndexedVertices(mesh: LevelMesh, vbuf: YAEBuffer, ibuf: YAEBuffer, useVertexOffset: boolean): BBox | null {
  const points = vbuf.points;
  const indices = ibuf.indices;
  if (!points || !indices || mesh.indCount <= 0) return null;
  const end = mesh.ibOffset + mesh.indCount;
  if (mesh.ibOffset < 0 || end > indices.length) return null;
  const base = useVertexOffset ? Math.max(0, mesh.vbOffset) : 0;
  const vertexCount = points.length / 3;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const m = mesh.dynamic ? mesh.xform : null;
  for (let i = mesh.ibOffset; i < end; i += 1) {
    const v = indices[i] + base;
    if (v < 0 || v >= vertexCount) return null;
    let x = points[v * 3];
    let y = points[v * 3 + 1];
    let z = points[v * 3 + 2];
    if (m) {
      const tx = x * m[0] + y * m[1] + z * m[2] + m[3];
      const ty = x * m[4] + y * m[5] + z * m[6] + m[7];
      const tz = x * m[8] + y * m[9] + z * m[10] + m[11];
      x = tx;
      y = ty;
      z = tz;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  return min.x <= max.x ? { min, max } : null;
}

function bboxScore(a: BBox, b: BBox): number {
  return (
    Math.abs(a.min.x - b.min.x) +
    Math.abs(a.min.y - b.min.y) +
    Math.abs(a.min.z - b.min.z) +
    Math.abs(a.max.x - b.max.x) +
    Math.abs(a.max.y - b.max.y) +
    Math.abs(a.max.z - b.max.z)
  );
}

/**
 * Whether `vbOffset` is a vertex base for this mesh's indices. Some files
 * store absolute indices, others offset ones; the mesh's authored bbox says
 * which reading is right (SDK `resolveDS2MeshUsesVertexOffset`).
 */
export function resolveMeshUsesVertexOffset(mesh: LevelMesh, vbuf: YAEBuffer, ibuf: YAEBuffer): boolean {
  if (mesh.vbOffset === 0) return true;
  const withOffset = bboxOfIndexedVertices(mesh, vbuf, ibuf, true);
  const withoutOffset = bboxOfIndexedVertices(mesh, vbuf, ibuf, false);
  if (withOffset && !withoutOffset) return true;
  if (!withOffset && withoutOffset) return false;
  if (!withOffset || !withoutOffset) return true;
  const authored = mesh.bbox;
  if (!(authored.min.x <= authored.max.x)) return true;
  return bboxScore(withOffset, authored) <= bboxScore(withoutOffset, authored);
}

export function resolveMeshGeometry(mesh: LevelMesh, vbuf: YAEBuffer | undefined, ibuf: YAEBuffer | undefined): ResolvedMeshGeometry | null {
  if (!vbuf || !ibuf || !vbuf.points || !ibuf.indices) return null;
  const raw = ibuf.indices;
  if (mesh.indCount <= 0 || mesh.ibOffset < 0 || mesh.ibOffset + mesh.indCount > raw.length) return null;

  let minIndex = Infinity;
  let maxIndex = -Infinity;
  for (let i = mesh.ibOffset; i < mesh.ibOffset + mesh.indCount; i += 1) {
    const v = raw[i];
    if (v < minIndex) minIndex = v;
    if (v > maxIndex) maxIndex = v;
  }
  if (!Number.isFinite(minIndex) || maxIndex < minIndex) return null;

  const start = mesh.ibOffset;
  const count = mesh.indCount;
  const tri: number[] = [];
  if (mesh.strip) {
    for (let i = 0; i + 2 < count; i += 1) {
      let a = raw[start + i];
      let b = raw[start + i + 1];
      const c = raw[start + i + 2];
      if (i & 1) [a, b] = [b, a];
      if (a === b || a === c || b === c) continue;
      tri.push(a - minIndex, b - minIndex, c - minIndex);
    }
  } else {
    for (let i = 0; i + 2 < count; i += 3) {
      tri.push(raw[start + i] - minIndex, raw[start + i + 1] - minIndex, raw[start + i + 2] - minIndex);
    }
  }
  if (tri.length === 0) return null;

  const useVertexOffset = resolveMeshUsesVertexOffset(mesh, vbuf, ibuf);
  const sourceVertexStart = minIndex + (useVertexOffset ? Math.max(0, mesh.vbOffset) : 0);
  const sourceVertexCount = maxIndex - minIndex + 1;
  if (sourceVertexStart < 0 || sourceVertexStart + sourceVertexCount > vbuf.points.length / 3) return null;

  return { sourceVertexStart, sourceVertexCount, useVertexOffset, indices: Uint32Array.from(tri) };
}
