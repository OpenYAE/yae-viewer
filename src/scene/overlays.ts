/**
 * Debug overlays built from the level's sidecars, all in DS2's Z-up space
 * (they go under the same rotated `Geometry` group as the meshes): the
 * collision mesh, the AI navigation grid, the visibility tree, the placed
 * model instances' boxes, and the lights.
 */
import * as THREE from 'three';
import type { DS2Collision, DS2NavMesh, LevelLight, LevelModel, VistreeNode } from '../formats';
import { AMBER, TEAL } from './materials';

const COLLISION_PALETTE = [0x22c55e, 0x38bdf8, 0xf59e0b, 0xa78bfa, 0xf472b6, 0x34d399, 0xfb7185, 0x60a5fa, 0xfacc15, 0x2dd4bf, 0xc084fc, 0xfb923c, 0x4ade80, 0x818cf8];

/** Height-tinted translucent mesh + wireframe; v2 files colour by material. */
export function buildCollisionOverlay(collision: DS2Collision, label: string): THREE.Group {
  const group = new THREE.Group();
  group.name = label;
  const vertexCount = collision.vertices.length / 3;
  if (vertexCount === 0 || collision.faces.length === 0) return group;

  const src = collision.vertices;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 2; i < src.length; i += 3) {
    if (src[i] < minZ) minZ = src[i];
    if (src[i] > maxZ) maxZ = src[i];
  }
  const zRange = maxZ - minZ || 1;

  // Faces are unrolled so that a v2 face can carry its material colour.
  const faceCount = collision.faces.length;
  const positions = new Float32Array(faceCount * 9);
  const colors = new Float32Array(faceCount * 9);
  const byMaterial = collision.version === 2 && collision.materials.length > 1;
  const base = new THREE.Color(byMaterial ? 0xffffff : 0x22c55e);
  const tint = new THREE.Color();
  for (let f = 0; f < faceCount; f += 1) {
    const face = collision.faces[f];
    const ids = [face.v0, face.v1, face.v2];
    if (byMaterial) tint.setHex(COLLISION_PALETTE[face.group % COLLISION_PALETTE.length]);
    for (let k = 0; k < 3; k += 1) {
      const v = ids[k] * 3;
      const o = f * 9 + k * 3;
      positions[o] = src[v];
      positions[o + 1] = src[v + 1];
      positions[o + 2] = src[v + 2];
      const t = 0.45 + 0.55 * ((src[v + 2] - minZ) / zRange);
      const c = byMaterial ? tint : base;
      colors[o] = c.r * t;
      colors[o + 1] = c.g * t;
      colors[o + 2] = c.b * t;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  mesh.name = `${label}-faces`;
  mesh.renderOrder = 20;
  mesh.userData.overlay = true;
  group.add(mesh);

  // Edges, deduplicated (a wireframe of the unrolled faces would draw each twice).
  const edgeKeys = new Set<string>();
  const edges: number[] = [];
  const pushEdge = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(src[a * 3], src[a * 3 + 1], src[a * 3 + 2], src[b * 3], src[b * 3 + 1], src[b * 3 + 2]);
  };
  for (const face of collision.faces) {
    pushEdge(face.v0, face.v1);
    pushEdge(face.v1, face.v2);
    pushEdge(face.v2, face.v0);
  }
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(edges), 3));
  const wire = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: byMaterial ? 0xffffff : 0x22c55e, transparent: true, opacity: byMaterial ? 0.18 : 0.35, toneMapped: false }));
  wire.name = `${label}-wire`;
  wire.renderOrder = 21;
  wire.userData.overlay = true;
  group.add(wire);
  return group;
}

/** Walkable cells as translucent quads at their height, plus the neighbour links. */
export function buildNavMeshOverlay(nav: DS2NavMesh): THREE.Group {
  const group = new THREE.Group();
  group.name = 'navmesh';
  const size = nav.spacing;
  const inset = size * 0.08;
  const lift = 2;
  const n = nav.nodes.length;
  const positions = new Float32Array(n * 12);
  const colors = new Float32Array(n * 12);
  const indices = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
  const teal = new THREE.Color(TEAL);
  const colour = new THREE.Color();
  for (let i = 0; i < n; i += 1) {
    const node = nav.nodes[i];
    const x0 = node.x + inset;
    const y0 = node.y + inset;
    const x1 = node.x + size - inset;
    const y1 = node.y + size - inset;
    const z = node.z + lift;
    const o = i * 12;
    positions.set([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], o);
    // cells are teal, shaded a little by their flag class so regions read apart
    colour.copy(teal);
    const shade = 0.55 + 0.45 * ((node.flags & 0x7) / 7);
    for (let k = 0; k < 4; k += 1) {
      colors[o + k * 3] = colour.r * shade;
      colors[o + k * 3 + 1] = colour.g * shade;
      colors[o + k * 3 + 2] = colour.b * shade;
    }
    const v = i * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const cells = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  cells.name = 'navmesh-cells';
  cells.renderOrder = 22;
  cells.userData.overlay = true;
  group.add(cells);

  const links: number[] = [];
  const half = size / 2;
  for (let i = 0; i < n; i += 1) {
    const node = nav.nodes[i];
    for (const j of node.neighborSlots) {
      if (j <= i) continue;
      const other = nav.nodes[j];
      links.push(node.x + half, node.y + half, node.z + lift + 1, other.x + half, other.y + half, other.z + lift + 1);
    }
  }
  if (links.length > 0) {
    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(links), 3));
    const lines = new THREE.LineSegments(linkGeometry, new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.35, toneMapped: false }));
    lines.name = 'navmesh-links';
    lines.renderOrder = 23;
    lines.userData.overlay = true;
    group.add(lines);
  }

  if (nav.portals.length > 0) {
    const pts = new Float32Array(nav.portals.length * 3);
    nav.portals.forEach((p, i) => pts.set([p.x + half, p.y + half, p.z + lift + 4], i * 3));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const portals = new THREE.Points(pg, new THREE.PointsMaterial({ color: AMBER, size: 6, sizeAttenuation: false, toneMapped: false }));
    portals.name = 'navmesh-portals';
    portals.renderOrder = 24;
    portals.userData.overlay = true;
    group.add(portals);
  }
  return group;
}

function boxEdges(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, out: number[]): void {
  const c = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, max.y, min.z],
    [min.x, max.y, min.z],
    [min.x, min.y, max.z],
    [max.x, min.y, max.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  for (const i of e) out.push(c[i][0], c[i][1], c[i][2]);
}

/** Leaf boxes of the visibility tree. */
export function buildVistreeOverlay(nodes: VistreeNode[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vistree';
  const leafEdges: number[] = [];
  const nodeEdges: number[] = [];
  for (const node of nodes) boxEdges(node.bboxMin, node.bboxMax, node.isLeaf ? leafEdges : nodeEdges);
  const add = (edges: number[], color: number, opacity: number, name: string) => {
    if (edges.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(edges), 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }));
    lines.name = name;
    lines.renderOrder = 25;
    lines.userData.overlay = true;
    group.add(lines);
  };
  add(leafEdges, 0xf59e0b, 0.5, 'vistree-leaves');
  add(nodeEdges, 0xf59e0b, 0.12, 'vistree-nodes');
  return group;
}

/** One wireframe box per placed instance of the level's `models` chunk, with its transform. */
export function buildModelInstanceBoxes(models: LevelModel[], entryId: string): { group: THREE.Group; objects: Map<string, THREE.Object3D> } {
  const group = new THREE.Group();
  group.name = 'modelInstances';
  const objects = new Map<string, THREE.Object3D>();
  const material = new THREE.LineBasicMaterial({ color: 0xa47bf0, transparent: true, opacity: 0.6, toneMapped: false });
  models.forEach((model, modelIndex) => {
    const modelGroup = new THREE.Group();
    modelGroup.name = model.name;
    model.descs.forEach((desc, descIndex) => {
      const edges: number[] = [];
      boxEdges(desc.bbox.min, desc.bbox.max, edges);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(edges), 3));
      const lines = new THREE.LineSegments(g, material);
      lines.name = `${model.name} #${descIndex}`;
      lines.userData.overlay = true;
      lines.userData.nodeId = `${entryId}:instance:${modelIndex}:${descIndex}`;
      modelGroup.add(lines);
      objects.set(lines.userData.nodeId, lines);
    });
    group.add(modelGroup);
    objects.set(`${entryId}:model-instance:${modelIndex}`, modelGroup);
  });
  return { group, objects };
}

export type LightEntry = { index: number; light: LevelLight; anchor: THREE.Object3D; icon: THREE.Sprite; threeLight: THREE.PointLight | THREE.SpotLight | null };

function makeLightIconTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#D8A657';
  ctx.fillStyle = 'rgba(216,166,87,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(32, 26, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(24, 42);
  ctx.lineTo(40, 42);
  ctx.moveTo(26, 48);
  ctx.lineTo(38, 48);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(32 + Math.cos(a) * 17, 26 + Math.sin(a) * 17);
    ctx.lineTo(32 + Math.cos(a) * 22, 26 + Math.sin(a) * 22);
  }
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let lightIconTexture: THREE.Texture | null = null;

/**
 * The level's lights: an amber icon at each, and a three.js light for the
 * Lit mode (point or spot, colour and range from the record; the intensity
 * is the record's divided by the 64-units-per-metre scale the falloff runs in).
 */
export function buildLightsOverlay(lights: LevelLight[], entryId: string): { group: THREE.Group; entries: LightEntry[]; objects: Map<string, THREE.Object3D> } {
  const group = new THREE.Group();
  group.name = 'lights';
  const entries: LightEntry[] = [];
  const objects = new Map<string, THREE.Object3D>();
  if (!lightIconTexture) lightIconTexture = makeLightIconTexture();
  const iconMaterial = new THREE.SpriteMaterial({ map: lightIconTexture, depthTest: true, depthWrite: false, transparent: true, sizeAttenuation: true, toneMapped: false });
  lights.forEach((light, index) => {
    const anchor = new THREE.Group();
    anchor.name = `${light.type === 3 ? 'Spot' : 'Point'} ${index + 1}`;
    anchor.position.set(light.position.x, light.position.y, light.position.z);
    const icon = new THREE.Sprite(iconMaterial);
    icon.scale.setScalar(28);
    icon.userData.overlay = true;
    icon.userData.nodeId = `${entryId}:light:${index}`;
    anchor.add(icon);

    const color = new THREE.Color(light.color.x, light.color.y, light.color.z);
    const range = Math.max(light.range, light.innerRadius, light.outerRadius, 64);
    let threeLight: THREE.PointLight | THREE.SpotLight | null = null;
    if (light.type === 3) {
      const spot = new THREE.SpotLight(color, 0, range, Math.PI / 4, 0.5, 1);
      const target = new THREE.Object3D();
      target.position.set(light.direction.x * 100, light.direction.y * 100, light.direction.z * 100);
      anchor.add(target);
      spot.target = target;
      threeLight = spot;
    } else {
      threeLight = new THREE.PointLight(color, 0, range, 1);
    }
    threeLight.visible = false;
    anchor.add(threeLight);
    anchor.userData.nodeId = `${entryId}:light:${index}`;
    anchor.userData.light = light;
    group.add(anchor);
    entries.push({ index, light, anchor, icon, threeLight });
    objects.set(anchor.userData.nodeId, anchor);
  });
  return { group, entries, objects };
}

/** A wireframe sphere for the selected light's range. */
export function buildLightRangeHelper(light: LevelLight): THREE.Object3D {
  const radius = Math.max(light.range, light.outerRadius, light.innerRadius, 8);
  const geometry = new THREE.SphereGeometry(radius, 24, 12);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.35, toneMapped: false }));
  wire.userData.overlay = true;
  if (light.type === 3) {
    const dir = new THREE.Vector3(light.direction.x, light.direction.y, light.direction.z).normalize();
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), radius, AMBER, radius * 0.15, radius * 0.08);
    wire.add(arrow);
  }
  return wire;
}
