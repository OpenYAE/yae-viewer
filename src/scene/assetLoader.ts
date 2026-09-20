/**
 * The load pipeline for one openable file: read and parse it, find and parse
 * the files that belong with it (collision, navmesh, lightmap pages, the
 * `.mat` library, every texture it names), build the three.js objects and
 * the Objects/Skeleton trees. Runs on the main thread in stages that yield
 * between them so the loading overlay can report progress.
 */
import * as THREE from 'three';
import { findSibling } from '../fs/catalog';
import type { Catalog, FileRef } from '../fs/types';
import { DS2Level, DS2Model, parseDS2AIM, parseDS2CM, parseDS2CM2, parseMatSource, type DS2Collision, type DS2NavMesh, type MatLibrary } from '../formats';
import type { AssetInfo, ClipInfo, HierarchyNode } from '../state/types';
import { buildLevelMeshes, groupMeshNodes, UNITS_PER_METER } from './levelBuilder';
import { buildModel } from './modelBuilder';
import { buildCollisionOverlay, buildLightsOverlay, buildModelInstanceBoxes, buildNavMeshOverlay, buildVistreeOverlay, type LightEntry } from './overlays';
import { prepareLightmap, TextureCache } from './textures';
import { formatBytes } from '../fs/catalog';

export type Progress = (title: string, detail: string, progress: number) => void;

export interface LoadedAsset {
  kind: 'level' | 'model';
  entryId: string;
  file: FileRef;
  info: AssetInfo;
  root: THREE.Group;
  geometryGroup: THREE.Group;
  meshes: THREE.Mesh[];
  objects: Map<string, THREE.Object3D>;
  hierarchy: HierarchyNode[];
  skeleton: HierarchyNode[];
  textures: TextureCache;
  level?: {
    data: DS2Level;
    collision: THREE.Group | null;
    navmesh: THREE.Group | null;
    vistree: THREE.Group | null;
    instances: THREE.Group | null;
    lights: THREE.Group | null;
    lightEntries: LightEntry[];
    lightmapPages: Map<number, THREE.Texture>;
  };
  model?: {
    data: DS2Model;
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton | null;
    skeletonHelper: THREE.SkeletonHelper | null;
    boneMarkers: THREE.InstancedMesh | null;
    collisionGroup: THREE.Group | null;
    clips: THREE.AnimationClip[];
    clipInfos: ClipInfo[];
    normalization: { scale: number; offsetZ: number; fromSkeleton: boolean };
  };
  bounds: THREE.Box3;
  dispose(): void;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let matLibraryCache: { catalog: Catalog; library: MatLibrary } | null = null;

/** The `.mat` templates of the catalog, parsed once per catalog. */
export async function loadMatLibrary(catalog: Catalog): Promise<MatLibrary> {
  if (matLibraryCache?.catalog === catalog) return matLibraryCache.library;
  const library: MatLibrary = new Map();
  for (const ref of catalog.mats) {
    try {
      const text = await (await ref.getFile()).text();
      parseMatSource(text, library);
    } catch (error) {
      console.warn(`[mat] ${ref.path}: ${error instanceof Error ? error.message : error}`);
    }
  }
  matLibraryCache = { catalog, library };
  return library;
}

async function readBytes(ref: FileRef): Promise<Uint8Array> {
  const file = await ref.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function loadTexturesFor(names: Iterable<string>, textures: TextureCache, progress: Progress, label: string): Promise<Map<string, THREE.Texture>> {
  const list = [...names].filter(Boolean);
  const out = new Map<string, THREE.Texture>();
  let done = 0;
  const workers = Array.from({ length: 6 }, async () => {
    for (;;) {
      const name = list.shift();
      if (name === undefined) return;
      const loaded = await textures.load(name);
      if (loaded) out.set(name, loaded.texture);
      done += 1;
      if (done % 8 === 0 || done === list.length) progress('Loading textures', `${done} / ${done + list.length} · ${label}`, done / Math.max(1, done + list.length));
    }
  });
  await Promise.all(workers);
  return out;
}

function lightmapBaseName(levelName: string, index: number): string {
  const base = levelName.split(/[\\/]/).pop() ?? levelName;
  return `${base.replace(/\.(tga|dds|png|jpg|jpeg|bmp)$/i, '').toLowerCase()}_${index}`;
}

export async function loadAsset(ref: FileRef, catalog: Catalog, renderer: THREE.WebGLRenderer, progress: Progress, warnings: string[]): Promise<LoadedAsset> {
  const textures = new TextureCache(catalog, renderer, (stem) => warnings.push(`Texture not found: ${stem}`));
  progress('Reading file', ref.name, -1);
  const bytes = await readBytes(ref);
  ref.size = bytes.byteLength;
  await yieldToUi();
  progress('Reading materials', `${catalog.mats.length} .mat files`, -1);
  const matLibrary = await loadMatLibrary(catalog);
  if (ref.ext === 'ds2md') return loadModel(ref, bytes, catalog, matLibrary, textures, progress, warnings);
  return loadLevel(ref, bytes, catalog, matLibrary, textures, progress, warnings);
}

async function loadLevel(ref: FileRef, bytes: Uint8Array, catalog: Catalog, matLibrary: MatLibrary, textures: TextureCache, progress: Progress, warnings: string[]): Promise<LoadedAsset> {
  progress('Parsing level', ref.name, -1);
  await yieldToUi();
  const level = DS2Level.parse(bytes);
  const entryId = `level:${ref.path}`;
  const stem = ref.name.replace(/\.ds2$/i, '');

  // Sidecars beside the level: collision (v2 preferred), navmesh (the rebuilt one preferred, as the engine loads it).
  progress('Reading sidecars', 'collision · navmesh', -1);
  await yieldToUi();
  let collision: DS2Collision | null = null;
  let collisionSource = '';
  for (const candidate of [`${stem}.ds2cm2`, `${stem}.ds2cm`]) {
    const sibling = findSibling(catalog, ref, candidate);
    if (!sibling) continue;
    try {
      const data = await readBytes(sibling);
      collision = candidate.endsWith('ds2cm2') ? parseDS2CM2(data) : parseDS2CM(data);
      collisionSource = sibling.name;
      break;
    } catch (error) {
      warnings.push(`${sibling.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  let navmesh: DS2NavMesh | null = null;
  let navmeshSource = '';
  for (const candidate of [`${stem}_rebuilded.ds2aim`, `${stem}.ds2aim`]) {
    const sibling = findSibling(catalog, ref, candidate);
    if (!sibling) continue;
    try {
      navmesh = parseDS2AIM(await readBytes(sibling));
      navmeshSource = sibling.name;
      break;
    } catch (error) {
      warnings.push(`${sibling.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Lightmap pages: the names the level lists, looked up beside the level and then anywhere in the catalog.
  progress('Loading lightmaps', `${level.lightmaps.length} pages`, -1);
  const lightmapPages = new Map<number, THREE.Texture>();
  for (let i = 0; i < level.lightmaps.length; i += 1) {
    const listed = lightmapBaseName(level.lightmaps[i], i).replace(/_\d+$/, '');
    const candidates = [listed, `${stem.toLowerCase()}_lm_${i}`];
    let file: FileRef | null = null;
    for (const name of candidates) {
      for (const ext of ['tga', 'dds', 'png']) {
        file = findSibling(catalog, ref, `${name}.${ext}`);
        if (file) break;
      }
      if (file) break;
      const anywhere = catalog.textures.get(name);
      if (anywhere && anywhere.length > 0) {
        file = anywhere[0];
        break;
      }
    }
    if (!file) {
      warnings.push(`Lightmap page not found: ${candidates[0]}`);
      continue;
    }
    try {
      const loaded = await textures.loadFile(file);
      lightmapPages.set(i, prepareLightmap(loaded.texture));
    } catch (error) {
      warnings.push(`${file.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const textureNames = new Set<string>();
  for (const mesh of level.meshes) if (mesh.texture) textureNames.add(mesh.texture);
  const diffuse = await loadTexturesFor(textureNames, textures, progress, ref.name);

  progress('Building geometry', `${level.meshes.length} meshes`, -1);
  await yieldToUi();
  const built = buildLevelMeshes({
    entryId,
    level,
    matLibrary,
    diffuseFor: (key) => diffuse.get(key) ?? null,
    lightmapFor: (id) => (id === null ? null : lightmapPages.get(id) ?? null),
  });

  const root = new THREE.Group();
  root.name = ref.name;
  root.add(built.geometryGroup);
  const objects = new Map(built.objects);
  const meshGroupId = `${entryId}:mesh`;
  objects.set(meshGroupId, built.geometryGroup);

  const hierarchy: HierarchyNode[] = [];
  hierarchy.push({ id: meshGroupId, name: 'Mesh', kind: 'mesh', badge: String(built.meshes.length), children: groupMeshNodes(entryId, built.meshNodes) });

  if (lightmapPages.size > 0) {
    const children: HierarchyNode[] = [];
    lightmapPages.forEach((texture, index) => {
      const image = texture.image as { width?: number; height?: number };
      children.push({ id: `${entryId}:lightmap:${index}`, name: level.lightmaps[index]?.split(/[\\/]/).pop() ?? `page ${index}`, kind: 'lightmap', badge: image?.width ? `${image.width}²` : '' });
    });
    hierarchy.push({ id: `${entryId}:lightmaps`, name: 'Lightmaps', kind: 'lightmaps', badge: String(lightmapPages.size), children });
  }

  let lightsGroup: THREE.Group | null = null;
  let lightEntries: LightEntry[] = [];
  if (level.lights.length > 0) {
    progress('Building overlays', 'lights', -1);
    const lights = buildLightsOverlay(level.lights, entryId);
    lightsGroup = lights.group;
    lightEntries = lights.entries;
    built.geometryGroup.add(lightsGroup);
    lights.objects.forEach((object, id) => objects.set(id, object));
    const lightsId = `${entryId}:lights`;
    objects.set(lightsId, lightsGroup);
    hierarchy.push({
      id: lightsId,
      name: 'Lights',
      kind: 'lights',
      badge: String(level.lights.length),
      children: lights.entries.map((entry) => ({ id: entry.anchor.userData.nodeId as string, name: entry.anchor.name, kind: 'level-light' as const, badge: entry.light.castShadows ? 'shadow' : '' })),
    });
  }

  let collisionGroup: THREE.Group | null = null;
  if (collision) {
    progress('Building overlays', `collision · ${collision.faces.length} faces`, -1);
    await yieldToUi();
    collisionGroup = buildCollisionOverlay(collision, collisionSource);
    collisionGroup.visible = false;
    built.geometryGroup.add(collisionGroup);
    const id = `${entryId}:collision`;
    objects.set(id, collisionGroup);
    const children = collision.version === 2 ? collision.materials.map((name, i) => ({ id: `${id}:material:${i}`, name, kind: 'empty' as const, badge: String(collision!.faces.reduce((n, f) => (f.group === i ? n + 1 : n), 0)) })) : undefined;
    hierarchy.push({ id, name: `Collision (${collisionSource})`, kind: 'overlay-collision', badge: `${collision.faces.length} faces`, children });
  }

  let navmeshGroup: THREE.Group | null = null;
  if (navmesh) {
    progress('Building overlays', `navmesh · ${navmesh.nodes.length} cells`, -1);
    await yieldToUi();
    navmeshGroup = buildNavMeshOverlay(navmesh);
    navmeshGroup.visible = false;
    built.geometryGroup.add(navmeshGroup);
    const id = `${entryId}:navmesh`;
    objects.set(id, navmeshGroup);
    hierarchy.push({ id, name: `Navmesh (${navmeshSource})`, kind: 'overlay-navmesh', badge: `${navmesh.nodes.length} cells` });
  }

  let vistreeGroup: THREE.Group | null = null;
  if (level.vistree.length > 0) {
    vistreeGroup = buildVistreeOverlay(level.vistree);
    vistreeGroup.visible = false;
    built.geometryGroup.add(vistreeGroup);
    const id = `${entryId}:vistree`;
    objects.set(id, vistreeGroup);
    hierarchy.push({ id, name: 'Vistree (BSP)', kind: 'overlay-vistree', badge: String(level.vistree.length) });
  }

  let instancesGroup: THREE.Group | null = null;
  if (level.models.length > 0) {
    const instances = buildModelInstanceBoxes(level.models, entryId);
    instancesGroup = instances.group;
    instancesGroup.visible = false;
    built.geometryGroup.add(instancesGroup);
    instances.objects.forEach((object, id) => objects.set(id, object));
    const id = `${entryId}:instances`;
    objects.set(id, instancesGroup);
    const placed = level.models.reduce((n, m) => n + m.descs.length, 0);
    hierarchy.push({
      id,
      name: 'Model instances',
      kind: 'model-instances',
      badge: String(placed),
      children: level.models.map((model, i) => ({ id: `${entryId}:model-instance:${i}`, name: model.name, kind: 'model-instance' as const, badge: String(model.descs.length) })),
    });
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const mesh of built.meshes) {
    const box = (mesh.userData as { bbox: THREE.Box3 }).bbox.clone().applyMatrix4(mesh.matrixWorld);
    bounds.union(box);
  }
  const size = bounds.getSize(new THREE.Vector3());

  const info: AssetInfo = {
    kind: 'level',
    name: stem,
    fileName: ref.name,
    dir: ref.dir,
    size: ref.size,
    format: `DS2 ${level.header.version}`,
    rows: [
      ['Format', `DS2 ${level.header.version || '1'}`],
      ['Size', formatBytes(ref.size)],
      ['Meshes', String(built.meshes.length)],
      ['Triangles', built.triangleCount.toLocaleString('en-US')],
      ['Materials', String(built.materialNames.size)],
      ['Textures', `${diffuse.size} / ${textureNames.size}`],
      ['Lightmaps', `${lightmapPages.size} / ${level.lightmaps.length}`],
      ['Lights', String(level.lights.length)],
      ['Collision', collision ? (collision.version === 2 ? 'v2' : 'v1') : '—'],
      ['Navmesh', navmesh ? `${navmesh.nodes.length} cells` : '—'],
      ['Extent', `${(size.x / UNITS_PER_METER).toFixed(0)} × ${(size.z / UNITS_PER_METER).toFixed(0)} × ${(size.y / UNITS_PER_METER).toFixed(0)} m`],
    ],
    bones: 0,
    clips: 0,
    warnings,
  };

  return {
    kind: 'level',
    entryId,
    file: ref,
    info,
    root,
    geometryGroup: built.geometryGroup,
    meshes: built.meshes,
    objects,
    hierarchy,
    skeleton: [],
    textures,
    level: { data: level, collision: collisionGroup, navmesh: navmeshGroup, vistree: vistreeGroup, instances: instancesGroup, lights: lightsGroup, lightEntries, lightmapPages },
    bounds,
    dispose: () => disposeTree(root, textures),
  };
}

async function loadModel(ref: FileRef, bytes: Uint8Array, catalog: Catalog, matLibrary: MatLibrary, textures: TextureCache, progress: Progress, warnings: string[]): Promise<LoadedAsset> {
  void catalog;
  progress('Parsing model', ref.name, -1);
  await yieldToUi();
  const model = DS2Model.parse(bytes);
  if (model.animationWarning) warnings.push(`Animations stopped short: ${model.animationWarning}`);
  const entryId = `model:${ref.path}`;
  const textureNames = new Set<string>();
  for (const material of model.materials) if (material.textureKey) textureNames.add(material.textureKey);
  const diffuse = await loadTexturesFor(textureNames, textures, progress, ref.name);

  progress('Building model', `${model.materials.length} materials · ${model.bones.length} bones`, -1);
  await yieldToUi();
  const built = buildModel({ entryId, model, matLibrary, diffuseFor: (key) => diffuse.get(key) ?? null });
  const root = new THREE.Group();
  root.name = ref.name;
  root.add(built.geometryGroup);
  // A skinned model posed by a clip is already at world size: the keys carry
  // unit scale and the inverse bind matrices expand the mesh (the engine emits
  // an actor without normalization). Only a skeletal model that never animates
  // — a static placement — takes the mesh → skeleton normalization.
  const normalized = built.normalization.fromSkeleton && built.clips.length === 0;
  if (normalized) {
    const inner = built.geometryGroup;
    inner.scale.setScalar(built.normalization.scale);
    inner.position.y = built.normalization.offsetZ;
  }
  const objects = new Map(built.objects);
  const meshGroupId = `${entryId}:mesh`;
  objects.set(meshGroupId, built.geometryGroup);
  const hierarchy: HierarchyNode[] = [{ id: meshGroupId, name: 'Mesh', kind: 'mesh', badge: String(built.meshes.length), children: groupMeshNodes(entryId, built.meshNodes) }];
  if (built.collisionNodes.length > 0) {
    const id = `${entryId}:collisions`;
    if (built.collisionGroup) objects.set(id, built.collisionGroup);
    hierarchy.push({ id, name: 'Collisions', kind: 'collision-group', badge: String(built.collisionNodes.length), children: built.collisionNodes });
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  if (built.clips.length > 0 && built.skeleton) {
    // The material bbox is the posed world extent (what a clip puts the mesh at).
    for (const material of model.materials) {
      const box = new THREE.Box3(new THREE.Vector3(...material.bbox.min), new THREE.Vector3(...material.bbox.max));
      bounds.union(box.applyMatrix4(built.geometryGroup.matrixWorld));
    }
  } else {
    for (const mesh of built.meshes) bounds.union((mesh.userData as { bbox: THREE.Box3 }).bbox.clone().applyMatrix4(mesh.matrixWorld));
  }
  const size = bounds.getSize(new THREE.Vector3());

  const info: AssetInfo = {
    kind: 'model',
    name: model.name || ref.name.replace(/\.ds2md$/i, ''),
    fileName: ref.name,
    dir: ref.dir,
    size: ref.size,
    format: `DS2MD ${model.version}`,
    rows: [
      ['Format', `DS2MD ${model.version}`],
      ['Size', formatBytes(ref.size)],
      ['Meshes', String(built.meshes.length)],
      ['Triangles', built.triangleCount.toLocaleString('en-US')],
      ['Textures', `${diffuse.size} / ${textureNames.size}`],
      ['Bones', String(model.bones.length)],
      ['Clips', String(model.animations.length)],
      ['Collisions', String(model.collisionShapes.length)],
      ['Height', `${(size.y / UNITS_PER_METER).toFixed(2)} m`],
      ['Scale', normalized ? `×${built.normalization.scale.toFixed(3)} (skeleton)` : built.clips.length > 0 ? 'from clip' : 'as authored'],
    ],
    bones: model.bones.length,
    clips: model.animations.length,
    warnings,
  };

  return {
    kind: 'model',
    entryId,
    file: ref,
    info,
    root,
    geometryGroup: built.geometryGroup,
    meshes: built.meshes,
    objects,
    hierarchy,
    skeleton: built.skeletonNodes,
    textures,
    model: {
      data: model,
      bones: built.bones,
      skeleton: built.skeleton,
      skeletonHelper: built.skeletonHelper,
      boneMarkers: built.boneMarkers,
      collisionGroup: built.collisionGroup,
      clips: built.clips,
      clipInfos: built.clipInfos,
      normalization: built.normalization,
    },
    bounds,
    dispose: () => {
      built.skeletonHelper?.dispose();
      if (built.boneMarkers) {
        built.boneMarkers.geometry.dispose();
        (built.boneMarkers.material as THREE.Material).dispose();
        built.boneMarkers.removeFromParent();
      }
      disposeTree(root, textures);
    },
  };
}

function disposeTree(root: THREE.Object3D, textures: TextureCache): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    // Surface materials belong to the material factory (shared across assets
    // and modes); only the overlays own theirs.
    if (object.userData.overlay) {
      const material = (object as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    }
  });
  root.removeFromParent();
  textures.dispose();
}
