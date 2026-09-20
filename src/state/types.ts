export type HierarchyKind =
  | 'model'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'mesh-item'
  | 'skeleton'
  | 'bone'
  | 'collision-group'
  | 'collision-shape'
  | 'lightmaps'
  | 'lightmap'
  | 'lights'
  | 'level-light'
  | 'overlay-collision'
  | 'overlay-navmesh'
  | 'overlay-vistree'
  | 'model-instances'
  | 'model-instance'
  | 'empty';

export interface HierarchyNode {
  id: string;
  name: string;
  kind: HierarchyKind;
  children?: HierarchyNode[];
  /** shown right-aligned in the tree (a count, a size) */
  badge?: string;
  /** shown in the tree when a filter matches the node's search text but not its name */
  meta?: Record<string, string | number | boolean>;
}

export type RenderMode = 'ds2' | 'lit' | 'albedo' | 'normals' | 'lightmap' | 'uv' | 'wireframe';

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  ds2: 'DS2 Render',
  lit: 'Lit',
  albedo: 'Albedo',
  normals: 'Normals',
  lightmap: 'Lightmap',
  uv: 'UV checker',
  wireframe: 'Wireframe',
};

export type CameraPreset = 'perspective' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export const CAMERA_PRESETS: Array<{ id: CameraPreset; label: string; key: string }> = [
  { id: 'perspective', label: 'Perspective', key: '0' },
  { id: 'top', label: 'Top', key: '7' },
  { id: 'bottom', label: 'Bottom', key: '' },
  { id: 'front', label: 'Front', key: '1' },
  { id: 'back', label: 'Back', key: '' },
  { id: 'left', label: 'Left', key: '3' },
  { id: 'right', label: 'Right', key: '' },
];

export interface DisplaySettings {
  lightmaps: boolean;
  lights: boolean;
  shadows: boolean;
  navmesh: boolean;
  wireframe: boolean;
  collision: boolean;
  boundingBoxes: boolean;
  grid: boolean;
  skeleton: boolean;
  /** show the loaded HDR image behind the scene */
  hdrBackground: boolean;
  /** exposure multiplier, 0..3 */
  exposure: number;
  /** grid cell in metres */
  gridStep: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  lightmaps: true,
  lights: true,
  shadows: false,
  navmesh: false,
  wireframe: false,
  collision: false,
  boundingBoxes: false,
  grid: true,
  skeleton: true,
  hdrBackground: true,
  exposure: 1,
  gridStep: 1,
};

export type DisplayToggleKey = Exclude<keyof DisplaySettings, 'exposure' | 'gridStep'>;

export interface SceneStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  vertices: number;
  triangles: number;
  textureBytes: number;
}

export interface AssetInfo {
  kind: 'level' | 'model';
  name: string;
  /** file name */
  fileName: string;
  /** directory inside the catalog */
  dir: string;
  size: number;
  format: string;
  /** label → value rows for the info card */
  rows: Array<[string, string]>;
  /** bone count (0 for a level) */
  bones: number;
  clips: number;
  warnings: string[];
}

export interface ClipInfo {
  index: number;
  name: string;
  duration: number;
  fps: number;
  frames: number;
  events: Array<{ time: number; name: string }>;
  /** bones with keys */
  tracks: number;
}

export interface TrackInfo {
  id: string;
  boneId: number;
  boneName: string;
  channel: 'Position' | 'Rotation' | 'Scale' | 'Events';
  /** key times in seconds */
  keys: number[];
  /** keys that change nothing (constant track) */
  constant: boolean;
}

export interface SelectionTransform {
  label: string;
  position: [number, number, number];
  /** euler degrees */
  rotation: [number, number, number];
  scale: [number, number, number];
  /** world-space size in DS2 units when the selection has a box */
  size?: [number, number, number];
}

export interface EnvironmentInfo {
  name: string;
  width: number;
  height: number;
}

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}
