/**
 * Turns a parsed `.ds2` into three.js meshes: one `Mesh` per level mesh
 * record, geometry in DS2's Z-up space under the `Geometry` group that
 * carries the one Y-up rotation, with a `SurfaceDesc` in `userData` that the
 * material factory turns into a material per render mode.
 */
import * as THREE from 'three';
import { resolveMeshGeometry, type DS2Level, type LevelMesh, type MatLibrary } from '../formats';
import type { HierarchyNode } from '../state/types';
import { resolveTemplate, type SurfaceDesc } from './materials';

export const DS2_TO_YUP_ROTATION_X = -Math.PI / 2;
export const UNITS_PER_METER = 64;

export type LevelMeshBuildResult = {
  geometryGroup: THREE.Group;
  meshes: THREE.Mesh[];
  /** hierarchy id → object */
  objects: Map<string, THREE.Object3D>;
  meshNodes: HierarchyNode[];
  vertexCount: number;
  triangleCount: number;
  materialNames: Set<string>;
  textureNames: Set<string>;
};

export type LevelMeshUserData = {
  nodeId: string;
  kind: 'level-mesh';
  meshIndex: number;
  surface: SurfaceDesc;
  materialName: string;
  textureName: string;
  lightmapId: number | null;
  dynamic: boolean;
  xform: number[] | null;
  objectName: string;
  bbox: THREE.Box3;
};

function transformPoint(m: number[], x: number, y: number, z: number, out: Float32Array, at: number): void {
  out[at] = x * m[0] + y * m[1] + z * m[2] + m[3];
  out[at + 1] = x * m[4] + y * m[5] + z * m[6] + m[7];
  out[at + 2] = x * m[8] + y * m[9] + z * m[10] + m[11];
}

function transformNormal(m: number[], x: number, y: number, z: number, out: Float32Array, at: number): void {
  const nx = x * m[0] + y * m[1] + z * m[2];
  const ny = x * m[4] + y * m[5] + z * m[6];
  const nz = x * m[8] + y * m[9] + z * m[10];
  const len = Math.hypot(nx, ny, nz) || 1;
  out[at] = nx / len;
  out[at + 1] = ny / len;
  out[at + 2] = nz / len;
}

/** Share of triangles whose winding disagrees with the stored normals. */
export function invertedWindingRatio(positions: Float32Array, normals: Float32Array, indices: Uint32Array | Uint16Array): number {
  let inverted = 0;
  let total = 0;
  const step = Math.max(1, Math.floor(indices.length / 3 / 64));
  for (let i = 0; i + 2 < indices.length; i += 3 * step) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const fx = aby * acz - abz * acy;
    const fy = abz * acx - abx * acz;
    const fz = abx * acy - aby * acx;
    const nx = normals[a] + normals[b] + normals[c];
    const ny = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nz = normals[a + 2] + normals[b + 2] + normals[c + 2];
    const dot = fx * nx + fy * ny + fz * nz;
    if (dot !== 0) {
      total += 1;
      if (dot < 0) inverted += 1;
    }
  }
  return total > 0 ? inverted / total : 0;
}

export interface LevelBuildContext {
  entryId: string;
  level: DS2Level;
  matLibrary: MatLibrary;
  diffuseFor(textureKey: string): THREE.Texture | null;
  lightmapFor(lightmapId: number | null): THREE.Texture | null;
}

export function buildLevelMeshes(ctx: LevelBuildContext): LevelMeshBuildResult {
  const { entryId, level } = ctx;
  const geometryGroup = new THREE.Group();
  geometryGroup.name = 'Geometry';
  geometryGroup.rotation.x = DS2_TO_YUP_ROTATION_X;
  const meshes: THREE.Mesh[] = [];
  const objects = new Map<string, THREE.Object3D>();
  const meshNodes: HierarchyNode[] = [];
  const materialNames = new Set<string>();
  const textureNames = new Set<string>();
  let vertexCount = 0;
  let triangleCount = 0;
  const surfaceCache = new Map<string, SurfaceDesc>();

  level.meshes.forEach((mesh: LevelMesh, index: number) => {
    const vbuf = level.buffers[mesh.vbId];
    const ibuf = level.buffers[mesh.ibId];
    const resolved = resolveMeshGeometry(mesh, vbuf, ibuf);
    if (!resolved || !vbuf.points) return;

    const count = resolved.sourceVertexCount;
    const start = resolved.sourceVertexStart;
    const positions = new Float32Array(count * 3);
    const normals = vbuf.normals ? new Float32Array(count * 3) : null;
    const uvs = vbuf.texcoords ? new Float32Array(count * 2) : null;
    const lightmapUvs = vbuf.lightmaps ? new Float32Array(count * 2) : null;
    const xform = mesh.dynamic ? mesh.xform : null;
    const src = vbuf.points;
    for (let i = 0; i < count; i += 1) {
      const v = (start + i) * 3;
      if (xform) transformPoint(xform, src[v], src[v + 1], src[v + 2], positions, i * 3);
      else {
        positions[i * 3] = src[v];
        positions[i * 3 + 1] = src[v + 1];
        positions[i * 3 + 2] = src[v + 2];
      }
      if (normals && vbuf.normals) {
        const n = vbuf.normals;
        if (xform) transformNormal(xform, n[v], n[v + 1], n[v + 2], normals, i * 3);
        else {
          normals[i * 3] = n[v];
          normals[i * 3 + 1] = n[v + 1];
          normals[i * 3 + 2] = n[v + 2];
        }
      }
      if (uvs && vbuf.texcoords) {
        uvs[i * 2] = vbuf.texcoords[(start + i) * 2];
        uvs[i * 2 + 1] = vbuf.texcoords[(start + i) * 2 + 1];
      }
      if (lightmapUvs && vbuf.lightmaps) {
        lightmapUvs[i * 2] = vbuf.lightmaps[(start + i) * 2];
        lightmapUvs[i * 2 + 1] = vbuf.lightmaps[(start + i) * 2 + 1];
      }
    }

    // Baked vertex light: the vertex buffer's own colours for a static mesh,
    // the shared colour buffer at `cbOffset` for a placed instance.
    let colors: Float32Array | null = null;
    let colorSource: Uint32Array | null = null;
    let colorBase = 0;
    if (mesh.dynamic) {
      const cbuf = level.buffers[mesh.cbId];
      if (cbuf?.colors && (mesh.cbOffset + count) * 4 <= cbuf.colors.length) {
        colorSource = cbuf.colors;
        colorBase = mesh.cbOffset;
      }
    } else if (vbuf.colors) {
      colorSource = vbuf.colors;
      colorBase = start;
    }
    let hasVertexAlpha = false;
    if (colorSource) {
      colors = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const c = (colorBase + i) * 4;
        colors[i * 4] = Math.min(1, (colorSource[c] / 255) * 2);
        colors[i * 4 + 1] = Math.min(1, (colorSource[c + 1] / 255) * 2);
        colors[i * 4 + 2] = Math.min(1, (colorSource[c + 2] / 255) * 2);
        const a = colorSource[c + 3] / 255;
        colors[i * 4 + 3] = a;
        if (a < 0.996) hasVertexAlpha = true;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (lightmapUvs) geometry.setAttribute('uv1', new THREE.BufferAttribute(lightmapUvs, 2));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    let indices = resolved.indices;
    if (normals && invertedWindingRatio(positions, normals, indices) >= 0.5) {
      const flipped = new Uint32Array(indices.length);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        flipped[i] = indices[i];
        flipped[i + 1] = indices[i + 2];
        flipped[i + 2] = indices[i + 1];
      }
      indices = flipped;
    }
    geometry.setIndex(new THREE.BufferAttribute(count > 65535 ? indices : Uint16Array.from(indices), 1));
    if (!normals) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const template = resolveTemplate(mesh.material, ctx.matLibrary);
    const lightmap = template.staticLight === 'vertex' ? null : ctx.lightmapFor(lightmapUvs ? mesh.lightmapId : null);
    const diffuse = ctx.diffuseFor(mesh.texture);
    const useVertexColor = Boolean(colors) && !lightmap;
    const alphaTest = template.alphaTest ?? 0;
    const surfaceKey = [
      mesh.material.toLowerCase(),
      mesh.texture,
      lightmap ? lightmap.uuid : '-',
      useVertexColor ? 'vc' : '-',
      hasVertexAlpha ? 'va' : '-',
      mesh.twoSided ? '2s' : '-',
    ].join('|');
    let surface = surfaceCache.get(surfaceKey);
    if (!surface) {
      surface = {
        key: surfaceKey,
        label: `${mesh.material} | ${mesh.texture || 'no texture'}`,
        diffuse,
        lightmap,
        hasVertexColor: useVertexColor,
        isModel: false,
        twoSided: mesh.twoSided || template.twoSided,
        alphaTest,
        blend: template.blend,
        depthWrite: template.depthWrite,
        sortValue: template.sortValue,
        selfIllumination: template.selfIllumination,
        hasVertexAlpha,
      };
      surfaceCache.set(surfaceKey, surface);
    }

    const objectName = mesh.dynamic && level.models[mesh.objectId] ? level.models[mesh.objectId].name : '';
    const label = objectName ? `${objectName} #${mesh.instanceId}` : `${mesh.material} | ${mesh.textureRaw ? mesh.texture : 'texture'} #${index}`;
    const nodeId = `${entryId}:mesh:${index}`;
    const threeMesh = new THREE.Mesh(geometry);
    threeMesh.name = label;
    threeMesh.renderOrder = surface.sortValue;
    threeMesh.castShadow = surface.blend === 'none';
    threeMesh.receiveShadow = true;
    threeMesh.frustumCulled = true;
    const bbox = geometry.boundingBox ? geometry.boundingBox.clone() : new THREE.Box3();
    const userData: LevelMeshUserData = {
      nodeId,
      kind: 'level-mesh',
      meshIndex: index,
      surface,
      materialName: mesh.material,
      textureName: mesh.texture,
      lightmapId: mesh.lightmapId,
      dynamic: mesh.dynamic,
      xform: mesh.xform,
      objectName,
      bbox,
    };
    threeMesh.userData = userData;
    geometryGroup.add(threeMesh);
    meshes.push(threeMesh);
    objects.set(nodeId, threeMesh);
    meshNodes.push({
      id: nodeId,
      name: label,
      kind: 'mesh-item',
      meta: { material: mesh.material, texture: mesh.texture, lightmap: mesh.lightmapId ?? -1, dynamic: mesh.dynamic },
    });
    materialNames.add(mesh.material);
    if (mesh.texture) textureNames.add(mesh.texture);
    vertexCount += count;
    triangleCount += indices.length / 3;
  });

  return { geometryGroup, meshes, objects, meshNodes, vertexCount, triangleCount, materialNames, textureNames };
}

/** Groups mesh nodes material › texture › mesh, as the SDK's outliner does. */
export function groupMeshNodes(entryId: string, meshNodes: HierarchyNode[]): HierarchyNode[] {
  type TextureGroup = { id: string; name: string; meshes: HierarchyNode[] };
  type MaterialGroup = { id: string; name: string; textures: Map<string, TextureGroup> };
  const materials = new Map<string, MaterialGroup>();
  let materialIndex = 0;
  let textureIndex = 0;
  for (const node of meshNodes) {
    const materialKey = String(node.meta?.material ?? '') || 'default';
    const textureKey = String(node.meta?.texture ?? '') || 'no texture';
    let material = materials.get(materialKey.toLowerCase());
    if (!material) {
      material = { id: `${entryId}:material:${materialIndex++}`, name: materialKey, textures: new Map() };
      materials.set(materialKey.toLowerCase(), material);
    }
    let texture = material.textures.get(textureKey);
    if (!texture) {
      texture = { id: `${entryId}:texture:${textureIndex++}`, name: textureKey, meshes: [] };
      material.textures.set(textureKey, texture);
    }
    texture.meshes.push(node);
  }
  return [...materials.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((material) => {
      const textures = [...material.textures.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((texture) => ({ id: texture.id, name: texture.name, kind: 'texture' as const, badge: String(texture.meshes.length), children: texture.meshes }));
      const total = textures.reduce((sum, t) => sum + (t.children?.length ?? 0), 0);
      return { id: material.id, name: material.name, kind: 'material' as const, badge: String(total), children: textures };
    });
}
