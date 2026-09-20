/**
 * Turns a parsed `.ds2md` into three.js objects: one mesh per material (a
 * SkinnedMesh when the material carries weights), the bone hierarchy, a
 * skeleton helper, pickable bone markers, the collision shapes riding their
 * bones, and the animation clips. Conventions follow the engine: bones and
 * keys are used verbatim in DS2's Z-up space, key times are seconds, the
 * Y-up rotation lives on the `Geometry` group above everything.
 */
import * as THREE from 'three';
import { DS2CollisionType, animationFps, computeModelNormalization, type DS2Model, type DS2ModelBone, type MatLibrary } from '../formats';
import type { ClipInfo, HierarchyNode } from '../state/types';
import { DS2_TO_YUP_ROTATION_X, invertedWindingRatio } from './levelBuilder';
import { ACCENT, BONE_MARKER, resolveTemplate, type SurfaceDesc } from './materials';

export type ModelBuildResult = {
  geometryGroup: THREE.Group;
  meshes: THREE.Mesh[];
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton | null;
  skeletonHelper: THREE.SkeletonHelper | null;
  boneMarkers: THREE.InstancedMesh | null;
  collisionGroup: THREE.Group | null;
  objects: Map<string, THREE.Object3D>;
  meshNodes: HierarchyNode[];
  skeletonNodes: HierarchyNode[];
  collisionNodes: HierarchyNode[];
  clips: THREE.AnimationClip[];
  clipInfos: ClipInfo[];
  normalization: { scale: number; offsetZ: number; fromSkeleton: boolean };
  vertexCount: number;
  triangleCount: number;
  textureNames: Set<string>;
};

export type ModelMeshUserData = {
  nodeId: string;
  kind: 'model-mesh';
  materialIndex: number;
  surface: SurfaceDesc;
  materialName: string;
  textureName: string;
  bbox: THREE.Box3;
};

function matrix3ToQuaternion(m: number[][]): THREE.Quaternion {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let qw: number;
  let qx: number;
  let qy: number;
  let qz: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m[2][1] - m[1][2]) * s;
    qy = (m[0][2] - m[2][0]) * s;
    qz = (m[1][0] - m[0][1]) * s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2.0 * Math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]);
    qw = (m[2][1] - m[1][2]) / s;
    qx = 0.25 * s;
    qy = (m[0][1] + m[1][0]) / s;
    qz = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = 2.0 * Math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]);
    qw = (m[0][2] - m[2][0]) / s;
    qx = (m[0][1] + m[1][0]) / s;
    qy = 0.25 * s;
    qz = (m[1][2] + m[2][1]) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]);
    qw = (m[1][0] - m[0][1]) / s;
    qx = (m[0][2] + m[2][0]) / s;
    qy = (m[1][2] + m[2][1]) / s;
    qz = 0.25 * s;
  }
  return new THREE.Quaternion(qx, qy, qz, qw).normalize();
}

/** DS2 bone rows (local axes in parent space, scale in their length) → local TRS. */
export function boneTransform(bone: DS2ModelBone): { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 } {
  const rx = [...bone.rotationX];
  const ry = [...bone.rotationY];
  const rz = [...bone.rotationZ];
  const sx = Math.hypot(rx[0], rx[1], rx[2]) || 1;
  const sy = Math.hypot(ry[0], ry[1], ry[2]) || 1;
  const sz = Math.hypot(rz[0], rz[1], rz[2]) || 1;
  for (let i = 0; i < 3; i += 1) {
    rx[i] /= sx;
    ry[i] /= sy;
    rz[i] /= sz;
  }
  const det = rx[0] * (ry[1] * rz[2] - ry[2] * rz[1]) - rx[1] * (ry[0] * rz[2] - ry[2] * rz[0]) + rx[2] * (ry[0] * rz[1] - ry[1] * rz[0]);
  let signZ = sz;
  if (det < 0) {
    rz[0] *= -1;
    rz[1] *= -1;
    rz[2] *= -1;
    signZ = -sz;
  }
  const quaternion = matrix3ToQuaternion([
    [rx[0], ry[0], rz[0]],
    [rx[1], ry[1], rz[1]],
    [rx[2], ry[2], rz[2]],
  ]);
  return { position: new THREE.Vector3(bone.position[0], bone.position[1], bone.position[2]), quaternion, scale: new THREE.Vector3(sx, sy, signZ) };
}

export function buildSkeletonNodes(entryId: string, bones: DS2ModelBone[]): HierarchyNode[] {
  const nodes = bones.map((bone, index) => ({ id: `${entryId}:bone:${index}`, name: bone.name || `Bone ${index + 1}`, kind: 'bone' as const, children: [] as HierarchyNode[] }));
  const roots: HierarchyNode[] = [];
  bones.forEach((bone, index) => {
    if (bone.parentId >= 0 && nodes[bone.parentId]) nodes[bone.parentId].children.push(nodes[index]);
    else roots.push(nodes[index]);
  });
  const finish = (node: HierarchyNode): void => {
    if (node.children && node.children.length > 0) {
      node.badge = String(countDescendants(node));
      node.children.forEach(finish);
    } else {
      delete node.children;
    }
  };
  roots.forEach(finish);
  return roots;
}

function countDescendants(node: HierarchyNode): number {
  let n = 0;
  for (const child of node.children ?? []) n += 1 + countDescendants(child);
  return n;
}

export function buildClips(model: DS2Model): { clips: THREE.AnimationClip[]; infos: ClipInfo[] } {
  const clips: THREE.AnimationClip[] = [];
  const infos: ClipInfo[] = [];
  model.animations.forEach((anim, index) => {
    const tracks: THREE.KeyframeTrack[] = [];
    let maxTime = 0;
    for (const boneAnim of anim.boneAnimations) {
      const bone = model.bones[boneAnim.boneId];
      if (!bone || boneAnim.frames.length === 0) continue;
      const name = boneName(bone, boneAnim.boneId);
      const times = new Float32Array(boneAnim.frames.length);
      const rot = new Float32Array(boneAnim.frames.length * 4);
      const pos = new Float32Array(boneAnim.frames.length * 3);
      const scl = new Float32Array(boneAnim.frames.length * 3);
      boneAnim.frames.forEach((frame, k) => {
        times[k] = frame.time;
        if (frame.time > maxTime) maxTime = frame.time;
        const q = frame.rotation;
        const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        rot.set([q[0] / len, q[1] / len, q[2] / len, q[3] / len], k * 4);
        pos.set(frame.position, k * 3);
        scl.set(frame.scale, k * 3);
      });
      // A key replaces the bone's whole local transform, scale included: the
      // bind rows carry a scale the keys do not have (fireman's rows are
      // 0.07 long; the mesh is authored in that compressed space and the
      // inverse bind matrices expand it), so the scale track is never dropped.
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, rot));
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, pos));
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times, scl));
    }
    const duration = Math.max(anim.totalTime || 0, maxTime);
    const clip = new THREE.AnimationClip(anim.name || `Animation ${index + 1}`, duration, tracks);
    clips.push(clip);
    const fps = animationFps(anim);
    infos.push({ index, name: clip.name, duration, fps, frames: Math.max(1, Math.round(duration * fps)), events: anim.events, tracks: anim.boneAnimations.length });
  });
  return { clips, infos };
}

/** Bone names double as track targets, so they must be unique and non-empty. */
export function boneName(bone: DS2ModelBone, index: number): string {
  const trimmed = (bone.name || '').trim();
  return trimmed ? trimmed : `Bone ${index + 1}`;
}

export interface ModelBuildContext {
  entryId: string;
  model: DS2Model;
  matLibrary: MatLibrary;
  diffuseFor(textureKey: string): THREE.Texture | null;
}

export function buildModel(ctx: ModelBuildContext): ModelBuildResult {
  const { entryId, model } = ctx;
  const geometryGroup = new THREE.Group();
  geometryGroup.name = 'Geometry';
  geometryGroup.rotation.x = DS2_TO_YUP_ROTATION_X;
  const objects = new Map<string, THREE.Object3D>();
  const meshes: THREE.Mesh[] = [];
  const meshNodes: HierarchyNode[] = [];
  const textureNames = new Set<string>();
  let vertexCount = 0;
  let triangleCount = 0;

  // Bones first: skinned meshes bind to them.
  const names = new Set<string>();
  const bones: THREE.Bone[] = model.bones.map((data, index) => {
    const bone = new THREE.Bone();
    let name = boneName(data, index);
    while (names.has(name)) name = `${name}_${index}`;
    names.add(name);
    bone.name = name;
    const t = boneTransform(data);
    bone.position.copy(t.position);
    bone.quaternion.copy(t.quaternion);
    bone.scale.copy(t.scale);
    bone.userData.nodeId = `${entryId}:bone:${index}`;
    bone.userData.boneIndex = index;
    objects.set(bone.userData.nodeId, bone);
    return bone;
  });
  model.bones.forEach((data, index) => {
    if (data.parentId >= 0 && data.parentId < bones.length) bones[data.parentId].add(bones[index]);
  });
  const rootBones = bones.filter((_, index) => model.bones[index].parentId < 0);
  const skinned = model.skinned && rootBones.length > 0;
  rootBones.forEach((root) => geometryGroup.add(root));
  geometryGroup.updateMatrixWorld(true);
  const skeleton = skinned ? new THREE.Skeleton(bones) : null;
  if (skeleton) skeleton.calculateInverses();

  const surfaceCache = new Map<string, SurfaceDesc>();
  model.materials.forEach((material, index) => {
    if (material.vertexCount === 0 || material.indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(material.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(material.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(material.uvs, 2));
    // A static model authored with the opposite winding: trust the normals.
    // A skinned one is checked in its posed state by the engine (the bind
    // rows can hold a mirror that flips the winding on the way to the pose).
    const useSkin = skinned && material.skinned;
    let indices = material.indices;
    if (!useSkin && invertedWindingRatio(material.positions, material.normals, indices) >= 0.5) {
      const flipped = new Uint16Array(indices.length);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        flipped[i] = indices[i];
        flipped[i + 1] = indices[i + 2];
        flipped[i + 2] = indices[i + 1];
      }
      indices = flipped;
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    if (useSkin) {
      const skinIndex = new Uint16Array(material.vertexCount * 4);
      const skinWeight = new Float32Array(material.vertexCount * 4);
      material.skinWeights.forEach((sw, v) => {
        for (let j = 0; j < 4; j += 1) {
          skinIndex[v * 4 + j] = sw.boneIds[j] ?? 0;
          skinWeight[v * 4 + j] = sw.weights[j] ?? 0;
        }
      });
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const template = resolveTemplate(material.shader, ctx.matLibrary);
    const diffuse = ctx.diffuseFor(material.textureKey);
    const key = `model|${material.shader.toLowerCase()}|${material.textureKey}|${template.twoSided ? '2s' : '-'}`;
    let surface = surfaceCache.get(key);
    if (!surface) {
      surface = {
        key,
        label: `${material.shader} | ${material.textureKey || 'no texture'}`,
        diffuse,
        lightmap: null,
        hasVertexColor: false,
        isModel: true,
        twoSided: template.twoSided,
        alphaTest: template.alphaTest ?? 0,
        blend: template.blend,
        depthWrite: template.depthWrite,
        sortValue: template.sortValue,
        selfIllumination: template.selfIllumination,
        hasVertexAlpha: false,
      };
      surfaceCache.set(key, surface);
    }
    const label = material.textureKey || material.shader || `Material ${index + 1}`;
    const nodeId = `${entryId}:mesh:${index}`;
    const mesh = useSkin ? new THREE.SkinnedMesh(geometry) : new THREE.Mesh(geometry);
    mesh.name = label;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = surface.sortValue;
    mesh.frustumCulled = false;
    const userData: ModelMeshUserData = {
      nodeId,
      kind: 'model-mesh',
      materialIndex: index,
      surface,
      materialName: material.shader,
      textureName: material.textureKey,
      bbox: geometry.boundingBox ? geometry.boundingBox.clone() : new THREE.Box3(),
    };
    mesh.userData = userData;
    geometryGroup.add(mesh);
    if (mesh instanceof THREE.SkinnedMesh && skeleton) {
      // The bind matrix is the mesh's world matrix (the Y-up rotation): the
      // bones' inverses carry the same rotation, so the rest pose is the
      // authored mesh, rotated once.
      mesh.updateMatrixWorld(true);
      mesh.bind(skeleton);
      mesh.normalizeSkinWeights();
    }
    meshes.push(mesh);
    objects.set(nodeId, mesh);
    meshNodes.push({ id: nodeId, name: label, kind: 'mesh-item', meta: { material: material.shader, texture: material.textureKey } });
    if (material.textureKey) textureNames.add(material.textureKey);
    vertexCount += material.vertexCount;
    triangleCount += material.indices.length / 3;
  });

  // Skeleton helper and pickable markers. The markers are one instanced
  // mesh in world space, placed every frame from the bones' world positions:
  // a child of a bone would inherit the bind rows' scale (36× on the dog).
  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let boneMarkers: THREE.InstancedMesh | null = null;
  if (bones.length > 0) {
    skeletonHelper = new THREE.SkeletonHelper(rootBones[0]);
    (skeletonHelper.material as THREE.LineBasicMaterial).color.setHex(ACCENT);
    (skeletonHelper.material as THREE.LineBasicMaterial).vertexColors = false;
    (skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false;
    (skeletonHelper.material as THREE.LineBasicMaterial).transparent = true;
    (skeletonHelper.material as THREE.LineBasicMaterial).opacity = 0.9;
    skeletonHelper.renderOrder = 30;
    skeletonHelper.userData.overlay = true;
    const extent = posedExtent(model);
    const radius = Math.max(extent * 0.012, 0.4);
    const markerGeometry = new THREE.SphereGeometry(radius, 8, 6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false });
    boneMarkers = new THREE.InstancedMesh(markerGeometry, markerMaterial, bones.length);
    boneMarkers.name = 'boneMarkers';
    boneMarkers.renderOrder = 31;
    boneMarkers.frustumCulled = false;
    boneMarkers.userData.overlay = true;
    const base = new THREE.Color(BONE_MARKER);
    for (let i = 0; i < bones.length; i += 1) boneMarkers.setColorAt(i, base);
    if (boneMarkers.instanceColor) boneMarkers.instanceColor.needsUpdate = true;
  }

  // Collision shapes ride their bones.
  let collisionGroup: THREE.Group | null = null;
  const collisionNodes: HierarchyNode[] = [];
  if (model.collisionShapes.length > 0) {
    collisionGroup = new THREE.Group();
    collisionGroup.name = 'collisions';
    const material = new THREE.MeshBasicMaterial({ color: 0x22c55e, wireframe: true, transparent: true, opacity: 0.6, depthTest: true, toneMapped: false });
    model.collisionShapes.forEach((shape, index) => {
      let geometry: THREE.BufferGeometry | null = null;
      if (shape.type === DS2CollisionType.Sphere) geometry = new THREE.SphereGeometry(shape.radius ?? 1, 12, 8);
      else if (shape.type === DS2CollisionType.Box && shape.size) geometry = new THREE.BoxGeometry(shape.size[0], shape.size[1], shape.size[2]);
      else if (shape.type === DS2CollisionType.Capsule) geometry = new THREE.CapsuleGeometry(shape.radius ?? 1, (shape.halfHeight ?? 1) * 2, 4, 8);
      else geometry = new THREE.OctahedronGeometry(2, 0);
      const mesh = new THREE.Mesh(geometry, material);
      const typeName = shape.type === 0 ? 'Sphere' : shape.type === 1 ? 'Box' : shape.type === 2 ? 'Capsule' : 'Convex';
      mesh.name = `${shape.name} (${typeName})`;
      mesh.userData.overlay = true;
      const nodeId = `${entryId}:collision:${index}`;
      mesh.userData.nodeId = nodeId;
      // rows = local axes of the shape in bone space
      const r = shape.rotation;
      const basis = new THREE.Matrix4().set(r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.set(shape.position[0], shape.position[1], shape.position[2]);
      const parent = bones[shape.parentBoneId] ?? null;
      if (parent) parent.add(mesh);
      else collisionGroup!.add(mesh);
      objects.set(nodeId, mesh);
      const boneLabel = model.bones[shape.parentBoneId]?.name ?? (shape.parentBoneId >= 0 ? `bone ${shape.parentBoneId}` : 'root');
      collisionNodes.push({ id: nodeId, name: mesh.name, kind: 'collision-shape', badge: boneLabel });
    });
    geometryGroup.add(collisionGroup);
  }

  const { clips, infos } = buildClips(model);
  const normalization = computeModelNormalization(model);

  return {
    geometryGroup,
    meshes,
    bones,
    skeleton,
    skeletonHelper,
    boneMarkers,
    collisionGroup,
    objects,
    meshNodes,
    skeletonNodes: buildSkeletonNodes(entryId, model.bones),
    collisionNodes,
    clips,
    clipInfos: infos,
    normalization,
    vertexCount,
    triangleCount,
    textureNames,
  };
}

/** The model's world extent: the material bbox (posed bounds) when it animates, the mesh otherwise. */
function posedExtent(model: DS2Model): number {
  let min = Infinity;
  let max = -Infinity;
  if (model.animations.length > 0) {
    for (const material of model.materials) {
      for (let a = 0; a < 3; a += 1) {
        min = Math.min(min, material.bbox.min[a]);
        max = Math.max(max, material.bbox.max[a]);
      }
    }
  } else {
    for (const material of model.materials) {
      const p = material.positions;
      for (let i = 0; i < p.length; i += 1) {
        if (p[i] < min) min = p[i];
        if (p[i] > max) max = p[i];
      }
    }
  }
  return Number.isFinite(max - min) && max > min ? max - min : 100;
}
