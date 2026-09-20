/**
 * `.ds2md` model (`DS2ModelFile_1`): materials with geometry and skin weights,
 * collision shapes, bones and animations. Ported from the YAE SDK
 * (`packages/formats/src/ds2Model.ts`, parse side only) with one fix the
 * engine's conformance pass found: an animation header of type N is followed
 * by N-1 extra u16 words, not only when N == 2 (`yae-engine` DS2ModelLoader).
 *
 * Everything is in DS2's Z-up space; bone rows are the local axes in parent
 * space with the scale in their length; animation keys are bone-local and
 * their times are seconds (`timeScale` ≈ 1/fps).
 */
import { BinaryReader } from './binaryReader';

export type DS2ModelMaterial = {
  shader: string;
  texture: string;
  /** normalized texture key (no path, no extension, lower case) */
  textureKey: string;
  textureSlots: string[];
  bbox: { min: number[]; max: number[] };
  faceCount: number;
  vertexCount: number;
  /** local indices into this material's vertices */
  indices: Uint16Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** per vertex: up to 4 (boneId, weight) pairs; empty when the material is not skinned */
  skinWeights: Array<{ boneIds: number[]; weights: number[] }>;
  skinned: boolean;
  unk1: number;
};

export type DS2ModelBone = {
  name: string;
  rotationX: number[];
  rotationY: number[];
  rotationZ: number[];
  position: number[];
  scale: number;
  parentId: number;
  children: number[];
  flags: number;
};

export enum DS2CollisionType {
  Sphere = 0,
  Box = 1,
  Capsule = 2,
  Convex = 3,
}

export type DS2CollisionShape = {
  name: string;
  type: DS2CollisionType;
  parentBoneId: number;
  /** 3 row vectors */
  rotation: [number[], number[], number[]];
  position: number[];
  radius?: number;
  /** full side lengths */
  size?: number[];
  halfHeight?: number;
};

export type DS2AnimKey = {
  flag: number;
  rotation: number[];
  position: number[];
  scale: number[];
  time: number;
};

export type DS2BoneAnimation = { boneId: number; boneName: string; frames: DS2AnimKey[] };

export type DS2ModelAnimation = {
  name: string;
  totalTime: number;
  timeScale: number;
  boneAnimations: DS2BoneAnimation[];
  events: Array<{ time: number; name: string }>;
};

export class DS2Model {
  name = '';
  version = '';
  materials: DS2ModelMaterial[] = [];
  faceCount = 0;
  vertexCount = 0;
  bones: DS2ModelBone[] = [];
  collisionShapes: DS2CollisionShape[] = [];
  animations: DS2ModelAnimation[] = [];
  animationHeaderType = 0;
  /** where the animation section stopped short, if it did */
  animationWarning: string | null = null;

  private reader: BinaryReader;

  constructor(bytes: Uint8Array) {
    this.reader = new BinaryReader(bytes);
  }

  static parse(bytes: Uint8Array): DS2Model {
    return new DS2Model(bytes).parse();
  }

  parse(): this {
    const signature = this.readLPString();
    if (signature !== 'DS2ModelFile_1') {
      throw new Error(`Not a DS2 model file (signature "${signature}")`);
    }
    this.version = this.readLPString();
    if (this.version === '0.6') return this.parseLegacy06();

    this.name = this.readLPString();
    const numMaterials = this.reader.readUInt8();
    for (let i = 0; i < numMaterials; i += 1) {
      const material = this.parseMaterial();
      this.materials.push(material);
      this.faceCount += material.faceCount;
      this.vertexCount += material.vertexCount;
    }
    this.parseCollisionShapes();
    this.parseBones();
    this.parseAnimations();
    return this;
  }

  get skinned(): boolean {
    return this.bones.length > 0 && this.materials.some((m) => m.skinned);
  }

  private readLPString(): string {
    const len = this.reader.readUInt16LE();
    if (len > 500) throw new Error(`Invalid string length ${len} at offset ${this.reader.offset - 2}`);
    return this.reader.readString(len);
  }

  private readVec3(): number[] {
    return [this.reader.readFloatLE(), this.reader.readFloatLE(), this.reader.readFloatLE()];
  }

  private parseMaterial(): DS2ModelMaterial {
    const r = this.reader;
    const shader = this.readLPString();
    const texture = this.readLPString();
    const textureSlots: string[] = [];
    for (let i = 0; i < 4; i += 1) textureSlots.push(this.readLPString());
    const bbox = { min: this.readVec3(), max: this.readVec3() };
    const faceCount = r.readUInt32LE();
    const unk1 = r.readUInt8();
    r.readUInt32LE(); // unique bone count
    const indexCount = r.readUInt32LE();
    const indices = new Uint16Array(indexCount);
    for (let i = 0; i < indexCount; i += 1) indices[i] = r.readUInt16LE();
    const vertexCount = r.readUInt16LE();
    const positions = r.readFloat32Array(vertexCount * 3);
    const normals = r.readFloat32Array(vertexCount * 3);
    const uvs = r.readFloat32Array(vertexCount * 2);
    const skinType = r.readUInt8();
    const skinWeights: DS2ModelMaterial['skinWeights'] = new Array(vertexCount);
    if (skinType > 0) {
      for (let i = 0; i < vertexCount; i += 1) {
        const count = r.readUInt8();
        const boneIds: number[] = [];
        const weights: number[] = [];
        for (let j = 0; j < count; j += 1) {
          boneIds.push(r.readUInt16LE());
          weights.push(r.readFloatLE());
        }
        skinWeights[i] = { boneIds, weights };
      }
    } else {
      for (let i = 0; i < vertexCount; i += 1) skinWeights[i] = { boneIds: [], weights: [] };
    }
    return {
      shader,
      texture,
      textureKey: normalizeModelTextureName(texture),
      textureSlots,
      bbox,
      faceCount,
      vertexCount,
      indices,
      positions,
      normals,
      uvs,
      skinWeights,
      skinned: skinType > 0,
      unk1,
    };
  }

  private parseLegacy06(): this {
    const r = this.reader;
    r.readFloatLE(); // legacy global scale
    const numMaterials = r.readUInt16LE();
    for (let m = 0; m < numMaterials; m += 1) {
      const legacyName = this.readLPString();
      if (!this.name && legacyName.trim()) this.name = legacyName;
      const shader = this.readLPString();
      const texture = this.readLPString();
      const textureSlots: string[] = [];
      for (let i = 0; i < 4; i += 1) textureSlots.push(this.readLPString());
      let faceCount = r.readUInt32LE();
      const vertexCount = r.readUInt32LE();
      const indexCount = r.readUInt32LE();
      const unk1 = r.readUInt8();
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      for (let i = 0; i < vertexCount; i += 1) {
        positions[i * 3] = r.readFloatLE();
        positions[i * 3 + 1] = r.readFloatLE();
        positions[i * 3 + 2] = r.readFloatLE();
        normals[i * 3] = r.readFloatLE();
        normals[i * 3 + 1] = r.readFloatLE();
        normals[i * 3 + 2] = r.readFloatLE();
        uvs[i * 2] = r.readFloatLE();
        uvs[i * 2 + 1] = r.readFloatLE();
      }
      const indices = new Uint16Array(indexCount);
      for (let i = 0; i < indexCount; i += 1) indices[i] = r.readUInt16LE();
      if (faceCount <= 0 && indexCount > 0) faceCount = Math.floor(indexCount / 3);
      const skinWeights: DS2ModelMaterial['skinWeights'] = new Array(vertexCount);
      for (let i = 0; i < vertexCount; i += 1) skinWeights[i] = { boneIds: [], weights: [] };
      const material: DS2ModelMaterial = {
        shader,
        texture,
        textureKey: normalizeModelTextureName(texture),
        textureSlots,
        bbox: bboxOf(positions),
        faceCount,
        vertexCount,
        indices,
        positions,
        normals,
        uvs,
        skinWeights,
        skinned: false,
        unk1,
      };
      this.materials.push(material);
      this.faceCount += faceCount;
      this.vertexCount += vertexCount;
    }
    return this;
  }

  private parseCollisionShapes(): void {
    const r = this.reader;
    const shapeCount = r.readUInt8();
    for (let i = 0; i < shapeCount; i += 1) {
      const name = this.readLPString();
      const type = r.readUInt8() as DS2CollisionType;
      const parentBoneId = r.readInt16LE();
      const dataSize = type === DS2CollisionType.Sphere ? 68 : type === DS2CollisionType.Box ? 76 : type === DS2CollisionType.Capsule ? 72 : type === DS2CollisionType.Convex ? 64 : -1;
      if (dataSize < 0) throw new Error(`Unknown collision shape type ${type} at offset ${r.offset - 1}`);
      const start = r.offset;
      const rotation: [number[], number[], number[]] = [this.readVec3(), [], []];
      r.readFloatLE();
      rotation[1] = this.readVec3();
      r.readFloatLE();
      rotation[2] = this.readVec3();
      r.readFloatLE();
      const position = this.readVec3();
      r.readFloatLE();
      const shape: DS2CollisionShape = { name, type, parentBoneId, rotation, position };
      r.seek(start + 64);
      if (type === DS2CollisionType.Sphere) {
        shape.radius = r.readFloatLE();
      } else if (type === DS2CollisionType.Box) {
        shape.size = this.readVec3();
      } else if (type === DS2CollisionType.Capsule) {
        shape.radius = r.readFloatLE();
        shape.halfHeight = r.readFloatLE();
      }
      r.seek(start + dataSize);
      this.collisionShapes.push(shape);
    }
  }

  private parseBones(): void {
    const r = this.reader;
    const boneType = r.readUInt8();
    if (boneType === 0) return;
    const numBones = r.readUInt16LE();
    for (let i = 0; i < numBones; i += 1) {
      const name = this.readLPString();
      const rotationX = this.readVec3();
      r.readInt32LE();
      const rotationY = this.readVec3();
      r.readInt32LE();
      const rotationZ = this.readVec3();
      r.readInt32LE();
      const position = this.readVec3();
      const scale = r.readFloatLE();
      const parentId = r.readInt16LE();
      const children: number[] = [];
      const numChildren = r.readUInt16LE();
      for (let j = 0; j < numChildren; j += 1) children.push(r.readUInt16LE());
      const flags = r.readUInt16LE();
      this.bones.push({ name, rotationX, rotationY, rotationZ, position, scale, parentId, children, flags });
    }
  }

  private parseAnimations(): void {
    const r = this.reader;
    if (r.remaining() < 6) return;
    try {
      const headerType = r.readUInt32LE();
      this.animationHeaderType = headerType;
      // Type N carries N-1 extra u16 words (the engine's reading; the SDK
      // handled only type 2 and dropped the animations of 76 models).
      if (headerType >= 2) {
        for (let i = 0; i < headerType - 1; i += 1) r.readUInt16LE();
      }
      const numAnims = r.readUInt16LE();
      for (let i = 0; i < numAnims; i += 1) {
        const anim: DS2ModelAnimation = {
          name: this.readLPString(),
          totalTime: r.readFloatLE(),
          timeScale: r.readFloatLE(),
          boneAnimations: [],
          events: [],
        };
        const usedBones = r.readUInt16LE();
        for (let j = 0; j < usedBones; j += 1) {
          const boneId = r.readUInt16LE();
          const boneName = this.readLPString();
          const numFrames = r.readUInt32LE();
          if (numFrames * 45 > r.remaining()) throw new Error(`animation "${anim.name}" claims ${numFrames} keys`);
          const frames: DS2AnimKey[] = new Array(numFrames);
          for (let k = 0; k < numFrames; k += 1) {
            frames[k] = {
              flag: r.readUInt8(),
              rotation: [r.readFloatLE(), r.readFloatLE(), r.readFloatLE(), r.readFloatLE()],
              position: this.readVec3(),
              scale: this.readVec3(),
              time: r.readFloatLE(),
            };
          }
          anim.boneAnimations.push({ boneId, boneName, frames });
        }
        if (this.version === '1.0') {
          const eventCount = r.readUInt16LE();
          for (let k = 0; k < eventCount; k += 1) {
            const time = r.readFloatLE();
            const name = this.readLPString();
            anim.events.push({ time, name });
          }
        }
        this.animations.push(anim);
      }
    } catch (error) {
      this.animationWarning = error instanceof Error ? error.message : String(error);
    }
  }
}

export function normalizeModelTextureName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.(tga|dds|png|jpg|jpeg|bmp)$/i, '').toLowerCase().trim();
}

function bboxOf(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Frames per second the clip was authored at (`timeScale` is the key spacing in seconds). */
export function animationFps(anim: Pick<DS2ModelAnimation, 'timeScale'>): number {
  if (anim.timeScale > 0 && anim.timeScale < 1) return Math.round(1 / anim.timeScale);
  if (anim.timeScale > 1) return Math.round(anim.timeScale);
  return 30;
}

/**
 * The engine's mesh-space → skeleton-space normalization
 * (`yae-engine/src/assets/DS2Model.h`, `computeDS2ModelNormalization`): a
 * character's raw mesh can be authored at a different scale than its bones;
 * the game scales the mesh so that its largest extent matches the skeleton's,
 * anchored at the feet. Boneless props stay as authored.
 */
export function computeModelNormalization(model: DS2Model): { scale: number; offsetZ: number; fromSkeleton: boolean } {
  const identity = { scale: 1, offsetZ: 0, fromSkeleton: false };
  if (model.materials.length === 0 || model.bones.length === 0) return identity;
  const meshMin = [Infinity, Infinity, Infinity];
  const meshMax = [-Infinity, -Infinity, -Infinity];
  for (const material of model.materials) {
    const p = material.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        if (p[i + a] < meshMin[a]) meshMin[a] = p[i + a];
        if (p[i + a] > meshMax[a]) meshMax[a] = p[i + a];
      }
    }
  }
  if (!Number.isFinite(meshMin[0])) return identity;
  const meshExtent = Math.max(meshMax[0] - meshMin[0], meshMax[1] - meshMin[1], meshMax[2] - meshMin[2]);

  const world = model.bones.map(() => [0, 0, 0]);
  const done = new Array(model.bones.length).fill(false);
  let remaining = model.bones.length;
  let safety = model.bones.length + 1;
  while (remaining > 0 && safety-- > 0) {
    model.bones.forEach((bone, i) => {
      if (done[i]) return;
      if (bone.parentId < 0) {
        world[i] = [...bone.position];
      } else if (bone.parentId < model.bones.length && done[bone.parentId]) {
        const p = world[bone.parentId];
        world[i] = [p[0] + bone.position[0], p[1] + bone.position[1], p[2] + bone.position[2]];
      } else {
        return;
      }
      done[i] = true;
      remaining -= 1;
    });
  }
  const boneMin = [Infinity, Infinity, Infinity];
  const boneMax = [-Infinity, -Infinity, -Infinity];
  for (const p of world) {
    for (let a = 0; a < 3; a += 1) {
      if (p[a] < boneMin[a]) boneMin[a] = p[a];
      if (p[a] > boneMax[a]) boneMax[a] = p[a];
    }
  }
  const boneExtent = Math.max(boneMax[0] - boneMin[0], boneMax[1] - boneMin[1], boneMax[2] - boneMin[2]);
  if (!(boneExtent > 1e-6) || !(meshExtent > 1e-6)) return identity;
  const scale = boneExtent / meshExtent;
  return { scale, offsetZ: meshMin[2] * (1 - scale), fromSkeleton: true };
}
