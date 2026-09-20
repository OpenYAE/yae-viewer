import { create } from 'zustand';
import type { Catalog, ScanProgress } from '../fs/types';
import type { RecentEntry } from '../fs/recent';
import {
  DEFAULT_DISPLAY,
  type AssetInfo,
  type CameraPreset,
  type ClipInfo,
  type DisplaySettings,
  type HierarchyNode,
  type RenderMode,
  type SceneStats,
  type SelectionTransform,
  type Toast,
  type TrackInfo,
} from './types';

export interface LoadingState {
  title: string;
  detail: string;
  /** 0..1, or -1 for indeterminate */
  progress: number;
}

export interface AnimationState {
  clips: ClipInfo[];
  clipIndex: number;
  playing: boolean;
  time: number;
  speed: number;
  loop: boolean;
  timelineOpen: boolean;
  onionSkin: boolean;
  onionRange: number;
  snapToFrame: boolean;
  /** tracks of the current clip, selected bone first */
  tracks: TrackInfo[];
}

export interface CameraReadout {
  preset: CameraPreset;
  fov: number;
  near: number;
  far: number;
  zoom: number;
}

const DISPLAY_KEY = 'yae-viewer.display';
const RENDER_MODE_KEY = 'yae-viewer.renderMode';

function loadDisplay(): DisplaySettings {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY };
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    return { ...DEFAULT_DISPLAY, ...parsed };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

function loadRenderMode(): RenderMode {
  try {
    const raw = localStorage.getItem(RENDER_MODE_KEY) as RenderMode | null;
    return raw && ['ds2', 'lit', 'albedo', 'normals', 'lightmap', 'uv', 'wireframe'].includes(raw) ? raw : 'ds2';
  } catch {
    return 'ds2';
  }
}

let toastSeq = 0;

export interface ViewerState {
  catalog: Catalog | null;
  scanning: ScanProgress | null;
  recent: RecentEntry[];
  fsAccess: boolean;

  /** path of the open file inside the catalog */
  openPath: string | null;
  asset: AssetInfo | null;
  /** the Objects tree (or the model's mesh/collision tree) */
  hierarchy: HierarchyNode[];
  /** the model's bone tree */
  skeleton: HierarchyNode[];
  /** ids whose object is hidden by the eye toggle */
  hidden: Set<string>;
  loading: LoadingState | null;
  loadError: string | null;

  selection: { ids: string[]; primary: string | null };
  selectionTransform: SelectionTransform | null;
  inspectorTab: 'objects' | 'skeleton';

  display: DisplaySettings;
  renderMode: RenderMode;
  camera: CameraReadout;
  stats: SceneStats;
  anim: AnimationState;
  toasts: Toast[];

  setCatalog(catalog: Catalog | null): void;
  setScanning(progress: ScanProgress | null): void;
  setRecent(recent: RecentEntry[]): void;
  setLoading(loading: LoadingState | null): void;
  setLoadError(error: string | null): void;
  setAsset(asset: AssetInfo | null, openPath: string | null, hierarchy: HierarchyNode[], skeleton: HierarchyNode[]): void;
  setHidden(hidden: Set<string>): void;
  setSelection(ids: string[], primary: string | null): void;
  setSelectionTransform(transform: SelectionTransform | null): void;
  setInspectorTab(tab: 'objects' | 'skeleton'): void;
  setDisplay(patch: Partial<DisplaySettings>): void;
  setRenderMode(mode: RenderMode): void;
  setCamera(patch: Partial<CameraReadout>): void;
  setStats(stats: SceneStats): void;
  setAnim(patch: Partial<AnimationState>): void;
  pushToast(level: Toast['level'], text: string): void;
  dismissToast(id: number): void;
}

export const useViewer = create<ViewerState>((set) => ({
  catalog: null,
  scanning: null,
  recent: [],
  fsAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window,

  openPath: null,
  asset: null,
  hierarchy: [],
  skeleton: [],
  hidden: new Set(),
  loading: null,
  loadError: null,

  selection: { ids: [], primary: null },
  selectionTransform: null,
  inspectorTab: 'objects',

  display: loadDisplay(),
  renderMode: loadRenderMode(),
  camera: { preset: 'perspective', fov: 60, near: 1, far: 100000, zoom: 1 },
  stats: { fps: 0, frameMs: 0, drawCalls: 0, vertices: 0, triangles: 0, textureBytes: 0 },
  anim: {
    clips: [],
    clipIndex: -1,
    playing: false,
    time: 0,
    speed: 1,
    loop: true,
    timelineOpen: false,
    onionSkin: false,
    onionRange: 12,
    snapToFrame: true,
    tracks: [],
  },
  toasts: [],

  setCatalog: (catalog) => set({ catalog }),
  setScanning: (scanning) => set({ scanning }),
  setRecent: (recent) => set({ recent }),
  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError }),
  setAsset: (asset, openPath, hierarchy, skeleton) =>
    set({
      asset,
      openPath,
      hierarchy,
      skeleton,
      hidden: new Set(),
      selection: { ids: [], primary: null },
      selectionTransform: null,
      inspectorTab: asset?.kind === 'model' && skeleton.length > 0 ? 'skeleton' : 'objects',
    }),
  setHidden: (hidden) => set({ hidden }),
  setSelection: (ids, primary) => set({ selection: { ids, primary } }),
  setSelectionTransform: (selectionTransform) => set({ selectionTransform }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setDisplay: (patch) =>
    set((state) => {
      const display = { ...state.display, ...patch };
      try {
        localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
      } catch {
        // storage blocked: the setting lives for the session
      }
      return { display };
    }),
  setRenderMode: (renderMode) => {
    try {
      localStorage.setItem(RENDER_MODE_KEY, renderMode);
    } catch {
      // storage blocked
    }
    set({ renderMode });
  },
  setCamera: (patch) => set((state) => ({ camera: { ...state.camera, ...patch } })),
  setStats: (stats) => set({ stats }),
  setAnim: (patch) => set((state) => ({ anim: { ...state.anim, ...patch } })),
  pushToast: (level, text) =>
    set((state) => {
      const id = ++toastSeq;
      const toasts = [...state.toasts, { id, level, text }].slice(-4);
      setTimeout(() => {
        useViewer.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, level === 'error' ? 9000 : 5000);
      return { toasts };
    }),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
