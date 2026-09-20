/**
 * The viewport: renderer, camera, controls, the loaded asset, selection,
 * display settings and render modes, animation playback. One instance for
 * the app; React talks to it through `getEngine()` and reads results from
 * the store it writes to.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Catalog, FileRef } from '../fs/types';
import { useViewer } from '../state/store';
import type { CameraPreset, DisplaySettings, RenderMode, SelectionTransform, TrackInfo } from '../state/types';
import { loadAsset, type LoadedAsset } from './assetLoader';
import { makeGrid } from './grid';
import { UNITS_PER_METER } from './levelBuilder';
import { LightRig } from './lightRig';
import { ACCENT, BONE_MARKER, MaterialFactory, type SurfaceDesc } from './materials';
import { buildLightRangeHelper } from './overlays';
import { disposeEnvironment, ensurePmrem, loadEnvironment, type LoadedEnvironment } from './environment';

const DEFAULT_VIEW_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
const tmpVec = new THREE.Vector3();
const PRESET_DIRECTIONS: Record<CameraPreset, THREE.Vector3> = {
  perspective: DEFAULT_VIEW_DIR,
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

type Ghost = { root: THREE.Object3D; mixer: THREE.AnimationMixer; action: THREE.AnimationAction | null; offset: number };

export class ViewerEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly materials = new MaterialFactory();
  private readonly lightRig = new LightRig();
  private readonly hemisphere = new THREE.HemisphereLight(0xffffff, 0x595959, Math.PI);
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 0);
  private grid: THREE.LineSegments | null = null;
  private asset: LoadedAsset | null = null;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private clock = new THREE.Clock();
  private frameTimes: number[] = [];
  private lastStats = 0;
  private lastTransform = 0;
  private framedDistance = 1000;
  private preset: CameraPreset = 'perspective';
  private renderMode: RenderMode;
  private display: DisplaySettings;
  private selectionHelpers: THREE.Object3D[] = [];
  private selectedIds: string[] = [];
  private wireframeOverlays: THREE.Object3D[] = [];
  private bboxOverlay: THREE.LineSegments | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private ghosts: Ghost[] = [];
  private keys = new Set<string>();
  private environment: LoadedEnvironment | null = null;
  private pointerDown: { x: number; y: number; moved: boolean } | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private loadSeq = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0b0d11, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 200000);
    this.camera.position.copy(DEFAULT_VIEW_DIR).multiplyScalar(1200);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 150000;
    this.controls.addEventListener('change', () => this.markCameraDirty());

    this.scene.add(this.hemisphere);
    this.keyLight.position.set(0.4, 1, 0.6);
    this.scene.add(this.keyLight);
    this.scene.add(this.lightRig.group);

    const state = useViewer.getState();
    this.renderMode = state.renderMode;
    this.display = state.display;
    this.rebuildGrid(1000);
    this.applyDisplay(this.display);
    this.applyModeLighting();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    this.loop();
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.unload();
    this.clearEnvironment();
    this.materials.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ─── HDR environment ────────────────────────────────────────────────────

  async setEnvironmentFile(file: File): Promise<void> {
    const store = useViewer.getState();
    store.setLoading({ title: 'Decoding HDR', detail: file.name, progress: -1 });
    try {
      const env = await loadEnvironment(file);
      this.clearEnvironment();
      this.environment = env;
      store.setEnvironment({ name: env.name, width: env.width, height: env.height });
      this.applyEnvironment();
      this.applyModeLighting();
    } catch (error) {
      store.pushToast('error', `${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      useViewer.getState().setLoading(null);
    }
  }

  clearEnvironment(): void {
    if (this.environment) {
      disposeEnvironment(this.environment);
      this.environment = null;
    }
    this.scene.background = null;
    this.scene.environment = null;
    useViewer.getState().setEnvironment(null);
    this.applyModeLighting();
  }

  /** Background per the toggle; image-based light only where the picture is three.js's (Lit). */
  private applyEnvironment(): void {
    const env = this.environment;
    if (!env) return;
    this.scene.background = this.display.hdrBackground ? env.texture : null;
    this.scene.backgroundIntensity = this.display.exposure;
    this.scene.environment = this.renderMode === 'lit' ? ensurePmrem(env, this.renderer) : null;
  }

  hasEnvironment(): boolean {
    return this.environment !== null;
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // ─── loading ────────────────────────────────────────────────────────────

  async open(ref: FileRef, catalog: Catalog): Promise<void> {
    const store = useViewer.getState();
    const seq = ++this.loadSeq;
    store.setLoadError(null);
    store.setLoading({ title: 'Opening', detail: ref.name, progress: -1 });
    const warnings: string[] = [];
    let loaded: LoadedAsset;
    try {
      loaded = await loadAsset(ref, catalog, this.renderer, (title, detail, progress) => {
        if (seq === this.loadSeq) useViewer.getState().setLoading({ title, detail, progress });
      }, warnings);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      const message = error instanceof Error ? error.message : String(error);
      useViewer.getState().setLoading(null);
      useViewer.getState().setLoadError(`${ref.name}: ${message}`);
      useViewer.getState().pushToast('error', `Could not open ${ref.name}: ${message}`);
      return;
    }
    if (seq !== this.loadSeq) {
      loaded.dispose();
      return;
    }
    this.unload();
    this.asset = loaded;
    this.scene.add(loaded.root);
    if (loaded.model?.skeletonHelper) {
      loaded.root.updateMatrixWorld(true);
      this.scene.add(loaded.model.skeletonHelper);
    }
    if (loaded.model?.boneMarkers) this.scene.add(loaded.model.boneMarkers);
    this.applyRenderMode(this.renderMode, true);
    this.applyModeLighting();
    this.lightRig.setEntries(loaded.level?.lightEntries ?? []);
    this.applyDisplay(this.display, true);
    this.rebuildGrid(Math.max(loaded.bounds.getSize(new THREE.Vector3()).length() * 0.6, 200));

    // Animation
    this.mixer = null;
    this.action = null;
    const clipInfos = loaded.model?.clipInfos ?? [];
    if (loaded.model && loaded.model.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(loaded.geometryGroup);
    }
    useViewer.getState().setAnim({ clips: clipInfos, clipIndex: -1, playing: false, time: 0, tracks: [] });
    useViewer.getState().setAsset(loaded.info, ref.path, loaded.hierarchy, loaded.skeleton);
    useViewer.getState().setLoading(null);
    for (const warning of warnings.slice(0, 3)) useViewer.getState().pushToast('warn', warning);
    if (warnings.length > 3) useViewer.getState().pushToast('warn', `${warnings.length - 3} more warnings in the info card`);
    if (clipInfos.length > 0) this.playClip(0, false);
    this.fixSkinnedWinding();
    this.resetView();
  }

  /**
   * Flips a skinned mesh's index buffer when its posed triangles wind against
   * its posed normals: the bind rows may carry a mirror (ded, fireman) that
   * the skin matrices apply on the way from mesh space to the pose.
   */
  private fixSkinnedWinding(): void {
    const asset = this.asset;
    if (!asset?.model) return;
    asset.root.updateMatrixWorld(true);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();
    const skin = new THREE.Matrix4();
    const boneMatrix = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    for (const mesh of asset.meshes) {
      if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.geometry.index) continue;
      mesh.skeleton.update();
      const geometry = mesh.geometry;
      const index = geometry.index;
      const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined;
      const skinIndex = geometry.attributes.skinIndex as THREE.BufferAttribute;
      const skinWeight = geometry.attributes.skinWeight as THREE.BufferAttribute;
      if (!normal || !skinIndex || !skinWeight) continue;
      const bones = mesh.skeleton.boneMatrices;
      if (!bones) continue;
      const skinnedNormal = (vertex: number, out: THREE.Vector3): THREE.Vector3 => {
        skin.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        for (let k = 0; k < 4; k += 1) {
          const w = skinWeight.getComponent(vertex, k);
          if (w === 0) continue;
          boneMatrix.fromArray(bones, skinIndex.getComponent(vertex, k) * 16);
          tmp.copy(boneMatrix).multiplyScalar(w);
          for (let e = 0; e < 16; e += 1) skin.elements[e] += tmp.elements[e];
        }
        tmp.copy(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix);
        return out.fromBufferAttribute(normal, vertex).transformDirection(tmp);
      };
      const triangles = index.count / 3;
      const step = Math.max(1, Math.floor(triangles / 96));
      let inverted = 0;
      let total = 0;
      for (let t = 0; t < triangles; t += step) {
        const i0 = index.getX(t * 3);
        const i1 = index.getX(t * 3 + 1);
        const i2 = index.getX(t * 3 + 2);
        mesh.getVertexPosition(i0, a);
        mesh.getVertexPosition(i1, b);
        mesh.getVertexPosition(i2, c);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        n.crossVectors(ab, ac);
        if (n.lengthSq() < 1e-12) continue;
        const dot = n.dot(skinnedNormal(i0, tmpVec)) + n.dot(skinnedNormal(i1, tmpVec)) + n.dot(skinnedNormal(i2, tmpVec));
        if (dot === 0) continue;
        total += 1;
        if (dot < 0) inverted += 1;
      }
      if (total > 0 && inverted / total >= 0.5) {
        const array = index.array as Uint16Array | Uint32Array;
        for (let i = 0; i + 2 < array.length; i += 3) {
          const keep = array[i + 1];
          array[i + 1] = array[i + 2];
          array[i + 2] = keep;
        }
        index.needsUpdate = true;
      }
    }
  }

  unload(): void {
    this.clearSelectionHelpers();
    this.clearGhosts();
    this.clearWireframeOverlays();
    if (this.bboxOverlay) {
      this.bboxOverlay.geometry.dispose();
      (this.bboxOverlay.material as THREE.Material).dispose();
      this.bboxOverlay.removeFromParent();
      this.bboxOverlay = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
      this.action = null;
    }
    if (this.asset) {
      this.asset.model?.skeletonHelper?.removeFromParent();
      this.asset.model?.boneMarkers?.removeFromParent();
      this.asset.dispose();
      this.asset = null;
    }
    this.lightRig.setEntries([]);
    this.materials.dispose();
    this.selectedIds = [];
    this.hiddenIds.clear();
    const store = useViewer.getState();
    if (store.asset) store.setAsset(null, null, [], []);
    store.setAnim({ clips: [], clipIndex: -1, playing: false, time: 0, tracks: [] });
  }

  get currentAsset(): LoadedAsset | null {
    return this.asset;
  }

  // ─── render modes & display ─────────────────────────────────────────────

  setRenderMode(mode: RenderMode): void {
    if (mode === this.renderMode) return;
    this.renderMode = mode;
    this.applyRenderMode(mode, false);
    this.applyModeLighting();
    this.applyDisplay(this.display);
  }

  private applyRenderMode(mode: RenderMode, initial: boolean): void {
    if (!this.asset) return;
    void initial;
    for (const mesh of this.asset.meshes) {
      const surface = (mesh.userData as { surface: SurfaceDesc }).surface;
      mesh.material = this.materials.get(surface, mode);
    }
  }

  private applyModeLighting(): void {
    const isModel = this.asset?.kind === 'model';
    const lit = this.renderMode === 'lit';
    this.lightRig.setEnabled(lit && this.display.lights);
    if (lit) {
      // With an HDR environment the image lights the scene; the fill lights step back.
      const ibl = this.environment ? 0.35 : 1;
      this.hemisphere.color.setHex(0xffffff);
      this.hemisphere.groundColor.setHex(0x404040);
      this.hemisphere.intensity = (isModel ? 1.6 : 0.55) * ibl;
      this.keyLight.intensity = (isModel ? 1.4 : 0) * ibl;
    } else {
      // DS2 mode: models take the engine's hemispheric ambient (sky 1, ground 0.35)
      this.hemisphere.color.setHex(0xffffff);
      this.hemisphere.groundColor.setHex(0x595959);
      this.hemisphere.intensity = Math.PI;
      this.keyLight.intensity = 0;
    }
  }

  applyDisplay(settings: DisplaySettings, force = false): void {
    const prev = this.display;
    this.display = settings;
    this.materials.setLightmapsVisible(settings.lightmaps);
    this.materials.setExposure(settings.exposure);
    this.applyEnvironment();
    this.lightRig.setEnabled(this.renderMode === 'lit' && settings.lights);
    this.lightRig.setShadows(settings.shadows);
    const shadows = settings.shadows && this.renderMode === 'lit';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.materials.invalidate();
    }
    if (this.grid) this.grid.visible = settings.grid;
    if (force || prev.gridStep !== settings.gridStep) this.rebuildGrid(this.gridExtent);
    const asset = this.asset;
    if (!asset) return;
    if (asset.level) {
      if (asset.level.lights) asset.level.lights.visible = settings.lights && !this.hiddenIds.has(`${asset.entryId}:lights`);
      if (asset.level.navmesh) asset.level.navmesh.visible = settings.navmesh && !this.hiddenIds.has(`${asset.entryId}:navmesh`);
      if (asset.level.collision) asset.level.collision.visible = settings.collision && !this.hiddenIds.has(`${asset.entryId}:collision`);
    }
    if (asset.model) {
      if (asset.model.skeletonHelper) asset.model.skeletonHelper.visible = settings.skeleton;
      if (asset.model.boneMarkers) asset.model.boneMarkers.visible = settings.skeleton;
      if (asset.model.collisionGroup) asset.model.collisionGroup.visible = settings.collision;
      // shapes attached to bones
      for (const bone of asset.model.bones) for (const child of bone.children) if (child.userData.nodeId?.includes(':collision:')) child.visible = settings.collision;
    }
    if (force || prev.wireframe !== settings.wireframe) this.setWireframeOverlay(settings.wireframe);
    if (force || prev.boundingBoxes !== settings.boundingBoxes) this.setBoundingBoxes(settings.boundingBoxes);
  }

  private hiddenIds = new Set<string>();

  private gridExtent = 1000;

  private rebuildGrid(extent: number): void {
    this.gridExtent = extent;
    if (this.grid) {
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid.removeFromParent();
    }
    this.grid = makeGrid(this.display.gridStep, extent);
    this.grid.visible = this.display.grid;
    this.scene.add(this.grid);
  }

  private setWireframeOverlay(on: boolean): void {
    this.clearWireframeOverlays();
    if (!on || !this.asset) return;
    const material = new THREE.MeshBasicMaterial({ color: 0xc3c9d4, wireframe: true, transparent: true, opacity: 0.28, depthTest: true, toneMapped: false });
    for (const mesh of this.asset.meshes) {
      let overlay: THREE.Mesh;
      if (mesh instanceof THREE.SkinnedMesh) {
        const skinned = new THREE.SkinnedMesh(mesh.geometry, material);
        skinned.bind(mesh.skeleton, mesh.bindMatrix);
        overlay = skinned;
      } else {
        overlay = new THREE.Mesh(mesh.geometry, material);
      }
      overlay.name = 'wireframe-overlay';
      overlay.userData.overlay = true;
      overlay.renderOrder = 40;
      overlay.frustumCulled = mesh.frustumCulled;
      mesh.add(overlay);
      this.wireframeOverlays.push(overlay);
    }
  }

  private clearWireframeOverlays(): void {
    for (const overlay of this.wireframeOverlays) {
      overlay.removeFromParent();
    }
    if (this.wireframeOverlays.length > 0) ((this.wireframeOverlays[0] as THREE.Mesh).material as THREE.Material).dispose();
    this.wireframeOverlays = [];
  }

  private setBoundingBoxes(on: boolean): void {
    if (this.bboxOverlay) {
      this.bboxOverlay.geometry.dispose();
      (this.bboxOverlay.material as THREE.Material).dispose();
      this.bboxOverlay.removeFromParent();
      this.bboxOverlay = null;
    }
    if (!on || !this.asset) return;
    const positions: number[] = [];
    const box = new THREE.Box3();
    for (const mesh of this.asset.meshes) {
      box.copy((mesh.userData as { bbox: THREE.Box3 }).bbox);
      if (box.isEmpty()) continue;
      pushBoxEdges(box, positions);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.bboxOverlay = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xa47bf0, transparent: true, opacity: 0.45, toneMapped: false }));
    this.bboxOverlay.userData.overlay = true;
    this.bboxOverlay.renderOrder = 26;
    this.asset.geometryGroup.add(this.bboxOverlay);
  }

  // ─── visibility ─────────────────────────────────────────────────────────

  setNodeVisibility(id: string, visible: boolean): void {
    if (!this.asset) return;
    const object = this.asset.objects.get(id);
    if (visible) this.hiddenIds.delete(id);
    else this.hiddenIds.add(id);
    if (object) object.visible = visible && this.displayAllows(id);
    // Group nodes without an object of their own (material/texture groups) hide their meshes.
    const node = findNode([...useViewer.getState().hierarchy, ...useViewer.getState().skeleton], id);
    if (node && !object) {
      for (const leaf of collectLeafIds(node)) {
        const leafObject = this.asset.objects.get(leaf);
        if (leafObject) leafObject.visible = visible;
        if (visible) this.hiddenIds.delete(leaf);
        else this.hiddenIds.add(leaf);
      }
    }
    useViewer.getState().setHidden(new Set(this.hiddenIds));
  }

  private displayAllows(id: string): boolean {
    if (!this.asset) return true;
    const e = this.asset.entryId;
    if (id === `${e}:lights`) return this.display.lights;
    if (id === `${e}:navmesh`) return this.display.navmesh;
    if (id === `${e}:collision`) return this.display.collision;
    return true;
  }

  isHidden(id: string): boolean {
    return this.hiddenIds.has(id);
  }

  // ─── selection ──────────────────────────────────────────────────────────

  select(ids: string[], primary: string | null): void {
    this.selectedIds = ids;
    useViewer.getState().setSelection(ids, primary);
    this.rebuildSelectionHelpers();
    this.updateSelectionTransform(true);
    this.publishTracks();
  }

  private clearSelectionHelpers(): void {
    for (const helper of this.selectionHelpers) {
      helper.removeFromParent();
      helper.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && o.userData.ownGeometry) m.geometry.dispose();
        if (o.userData.ownMaterial && m.material) (m.material as THREE.Material).dispose();
      });
    }
    this.selectionHelpers = [];
    const markers = this.asset?.model?.boneMarkers;
    if (markers) {
      const base = new THREE.Color(BONE_MARKER);
      for (let i = 0; i < markers.count; i += 1) markers.setColorAt(i, base);
      if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    }
  }

  private rebuildSelectionHelpers(): void {
    this.clearSelectionHelpers();
    const asset = this.asset;
    if (!asset) return;
    const accentLine = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    const tint = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.18, depthTest: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const boxPositions: number[] = [];
    const scratch = new THREE.Box3();
    for (const id of this.selectedIds) {
      const object = asset.objects.get(id) ?? null;
      const leafIds = object ? [id] : collectLeafIds(findNode([...useViewer.getState().hierarchy], id) ?? { id });
      for (const leafId of leafIds) {
        const target = asset.objects.get(leafId);
        if (!target) continue;
        if (target instanceof THREE.Mesh && (target.userData as { surface?: SurfaceDesc }).surface) {
          const bbox = (target.userData as { bbox: THREE.Box3 }).bbox;
          scratch.copy(bbox);
          pushBoxEdges(scratch, boxPositions);
          let overlay: THREE.Mesh;
          if (target instanceof THREE.SkinnedMesh) {
            const skinned = new THREE.SkinnedMesh(target.geometry, tint);
            skinned.bind(target.skeleton, target.bindMatrix);
            overlay = skinned;
          } else {
            overlay = new THREE.Mesh(target.geometry, tint);
          }
          overlay.name = 'selection-tint';
          overlay.userData.overlay = true;
          overlay.renderOrder = 41;
          overlay.frustumCulled = false;
          target.add(overlay);
          this.selectionHelpers.push(overlay);
        } else if (target instanceof THREE.Bone) {
          const markers = asset.model?.boneMarkers;
          if (markers) {
            markers.setColorAt(target.userData.boneIndex as number, new THREE.Color(ACCENT));
            if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
          }
          const axes = new THREE.AxesHelper(Math.max(8, this.markerRadius() * 6));
          (axes.material as THREE.LineBasicMaterial).depthTest = false;
          (axes.material as THREE.LineBasicMaterial).transparent = true;
          axes.renderOrder = 42;
          axes.userData.overlay = true;
          axes.userData.ownGeometry = true;
          axes.userData.ownMaterial = true;
          target.add(axes);
          this.selectionHelpers.push(axes);
        } else if (target.userData.light) {
          const helper = buildLightRangeHelper(target.userData.light);
          helper.userData.ownGeometry = true;
          helper.userData.ownMaterial = true;
          target.add(helper);
          this.selectionHelpers.push(helper);
        } else if (target instanceof THREE.LineSegments && target.userData.nodeId?.includes(':instance:')) {
          const clone = new THREE.LineSegments(target.geometry, accentLine);
          clone.userData.overlay = true;
          target.add(clone);
          this.selectionHelpers.push(clone);
        } else if (target instanceof THREE.Group && target.name === 'collisions') {
          // nothing to outline
        } else if (target instanceof THREE.Mesh && target.userData.nodeId?.includes(':collision:')) {
          const clone = new THREE.Mesh(target.geometry, new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, depthTest: false, toneMapped: false }));
          clone.userData.overlay = true;
          clone.userData.ownMaterial = true;
          clone.renderOrder = 43;
          target.add(clone);
          this.selectionHelpers.push(clone);
        }
      }
    }
    if (boxPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(boxPositions, 3));
      const lines = new THREE.LineSegments(geometry, accentLine);
      lines.userData.overlay = true;
      lines.userData.ownGeometry = true;
      lines.renderOrder = 44;
      asset.geometryGroup.add(lines);
      this.selectionHelpers.push(lines);
    }
  }

  private markerRadius(): number {
    const geometry = this.asset?.model?.boneMarkers?.geometry as THREE.SphereGeometry | undefined;
    return geometry?.parameters?.radius ?? 4;
  }

  private readonly markerMatrix = new THREE.Matrix4();
  private readonly markerPos = new THREE.Vector3();

  /** Places the bone markers at the bones' world positions (scale-free). */
  private updateBoneMarkers(): void {
    const model = this.asset?.model;
    if (!model?.boneMarkers || !model.boneMarkers.visible) return;
    model.bones.forEach((bone, i) => {
      bone.getWorldPosition(this.markerPos);
      this.markerMatrix.makeTranslation(this.markerPos.x, this.markerPos.y, this.markerPos.z);
      model.boneMarkers!.setMatrixAt(i, this.markerMatrix);
    });
    model.boneMarkers.instanceMatrix.needsUpdate = true;
  }

  private updateSelectionTransform(force: boolean): void {
    const store = useViewer.getState();
    const asset = this.asset;
    const primary = store.selection.primary;
    if (!asset || !primary) {
      if (store.selectionTransform) store.setSelectionTransform(null);
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastTransform < 100) return;
    this.lastTransform = now;
    const object = asset.objects.get(primary);
    if (!object) {
      if (store.selectionTransform) store.setSelectionTransform(null);
      return;
    }
    let transform: SelectionTransform;
    const euler = new THREE.Euler();
    if (object instanceof THREE.Bone) {
      euler.setFromQuaternion(object.quaternion, 'XYZ');
      transform = {
        label: object.name,
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [THREE.MathUtils.radToDeg(euler.x), THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.z)],
        scale: [object.scale.x, object.scale.y, object.scale.z],
      };
    } else if ((object.userData as { bbox?: THREE.Box3 }).bbox) {
      const bbox = (object.userData as { bbox: THREE.Box3 }).bbox;
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      const xform = (object.userData as { xform?: number[] | null }).xform ?? null;
      let rotation: [number, number, number] = [0, 0, 0];
      if (xform) {
        const m = new THREE.Matrix4().set(xform[0], xform[1], xform[2], xform[3], xform[4], xform[5], xform[6], xform[7], xform[8], xform[9], xform[10], xform[11], xform[12], xform[13], xform[14], xform[15]);
        const q = new THREE.Quaternion();
        const p = new THREE.Vector3();
        const s = new THREE.Vector3();
        m.decompose(p, q, s);
        euler.setFromQuaternion(q, 'XYZ');
        rotation = [THREE.MathUtils.radToDeg(euler.x), THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.z)];
      }
      transform = { label: object.name, position: [center.x, center.y, center.z], rotation, scale: [1, 1, 1], size: [size.x, size.y, size.z] };
    } else if (object.userData.light) {
      const light = object.userData.light as { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; range: number };
      transform = {
        label: object.name,
        position: [light.position.x, light.position.y, light.position.z],
        rotation: [light.direction.x, light.direction.y, light.direction.z],
        scale: [light.range, light.range, light.range],
      };
    } else {
      const box = new THREE.Box3().setFromObject(object);
      const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
      transform = { label: object.name, position: [center.x, center.y, center.z], rotation: [0, 0, 0], scale: [1, 1, 1], size: [size.x, size.y, size.z] };
    }
    store.setSelectionTransform(transform);
  }

  // ─── picking ────────────────────────────────────────────────────────────

  private onPointerDown = (event: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY, moved: false };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    if (Math.abs(event.clientX - this.pointerDown.x) > 4 || Math.abs(event.clientY - this.pointerDown.y) > 4) this.pointerDown.moved = true;
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.moved || event.button !== 0) return;
    const hit = this.pick(event.clientX, event.clientY);
    const additive = event.ctrlKey || event.metaKey;
    if (!hit) {
      if (!additive) this.select([], null);
      return;
    }
    if (additive) {
      const ids = this.selectedIds.includes(hit) ? this.selectedIds.filter((id) => id !== hit) : [...this.selectedIds, hit];
      this.select(ids, ids.includes(hit) ? hit : ids[ids.length - 1] ?? null);
    } else {
      this.select([hit], hit);
    }
    if (event.detail === 2) this.frameSelected();
  };

  pick(clientX: number, clientY: number): string | null {
    const asset = this.asset;
    if (!asset) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    // bones and lights first: they are small and sit inside the geometry
    const priority: THREE.Object3D[] = [];
    if (asset.model?.boneMarkers && this.display.skeleton) priority.push(asset.model.boneMarkers);
    if (asset.level?.lights?.visible) for (const entry of asset.level.lightEntries) priority.push(entry.icon);
    const priorityHits = raycaster.intersectObjects(priority, false);
    if (priorityHits.length > 0) {
      const hit = priorityHits[0];
      if (hit.object === asset.model?.boneMarkers && hit.instanceId !== undefined) {
        return asset.model.bones[hit.instanceId]?.userData.nodeId ?? null;
      }
      const id = hit.object.userData.nodeId as string | undefined;
      if (id) return id;
    }
    const meshHits = raycaster.intersectObjects(asset.meshes.filter((m) => m.visible && m.parent?.visible !== false), false);
    for (const hit of meshHits) {
      const id = (hit.object.userData as { nodeId?: string }).nodeId;
      if (id) return id;
    }
    return null;
  }

  // ─── camera ─────────────────────────────────────────────────────────────

  private markCameraDirty(): void {
    const store = useViewer.getState();
    const distance = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.framedDistance / Math.max(1e-3, distance);
    if (Math.abs(store.camera.zoom - zoom) > 0.01) store.setCamera({ zoom });
  }

  frameBox(box: THREE.Box3, direction?: THREE.Vector3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspectFactor = Math.min(1, this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(fov / 2, fov * aspectFactor * 0.5))) * 1.1;
    const dir = direction ? direction.clone().normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.copy(DEFAULT_VIEW_DIR);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.5, distance / 2000);
    this.camera.far = Math.max(20000, distance * 40);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.framedDistance = distance;
    useViewer.getState().setCamera({ near: this.camera.near, far: this.camera.far, zoom: 1 });
  }

  /** Frames a sphere around a world point (harness and light focus). */
  frameAround(x: number, y: number, z: number, radius: number, direction?: [number, number, number]): void {
    const box = new THREE.Box3(new THREE.Vector3(x - radius, y - radius, z - radius), new THREE.Vector3(x + radius, y + radius, z + radius));
    this.frameBox(box, direction ? new THREE.Vector3(...direction) : undefined);
  }

  /** World position of a hierarchy node (its box centre), for the harness. */
  nodeCenter(id: string): [number, number, number] | null {
    const object = this.asset?.objects.get(id);
    if (!object) return null;
    const box = objectBox(object);
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3());
    return [c.x, c.y, c.z];
  }

  frameSelected(): void {
    const asset = this.asset;
    if (!asset) return;
    const box = new THREE.Box3();
    for (const id of this.selectedIds) {
      const object = asset.objects.get(id);
      if (!object) {
        const node = findNode([...useViewer.getState().hierarchy], id);
        if (node) for (const leaf of collectLeafIds(node)) {
          const o = asset.objects.get(leaf);
          if (o) box.union(objectBox(o));
        }
        continue;
      }
      box.union(objectBox(object));
    }
    if (box.isEmpty()) box.copy(this.assetBounds());
    this.frameBox(box);
  }

  /** The asset's world bounds: a model's from its posed meshes, a level's from its authored boxes. */
  assetBounds(): THREE.Box3 {
    const asset = this.asset;
    if (!asset) return new THREE.Box3(new THREE.Vector3(-300, 0, -300), new THREE.Vector3(300, 200, 300));
    if (asset.kind === 'model') {
      const box = new THREE.Box3();
      asset.root.updateMatrixWorld(true);
      for (const mesh of asset.meshes) box.union(objectBox(mesh));
      if (!box.isEmpty()) return box;
    }
    return asset.bounds.clone();
  }

  resetView(): void {
    this.preset = 'perspective';
    useViewer.getState().setCamera({ preset: 'perspective' });
    this.frameBox(this.assetBounds(), DEFAULT_VIEW_DIR);
  }

  setPreset(preset: CameraPreset): void {
    this.preset = preset;
    useViewer.getState().setCamera({ preset });
    const box = new THREE.Box3();
    if (this.asset && this.selectedIds.length > 0) {
      for (const id of this.selectedIds) {
        const object = this.asset.objects.get(id);
        if (object) box.union(objectBox(object));
      }
    }
    if (box.isEmpty()) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      const center = this.controls.target.clone();
      const dir = PRESET_DIRECTIONS[preset];
      this.camera.position.copy(center).addScaledVector(dir, distance);
      if (preset === 'top' || preset === 'bottom') this.camera.up.set(0, 0, preset === 'top' ? -1 : 1);
      else this.camera.up.set(0, 1, 0);
      this.controls.update();
      this.camera.up.set(0, 1, 0);
      return;
    }
    this.frameBox(box, PRESET_DIRECTIONS[preset]);
  }

  get cameraPreset(): CameraPreset {
    return this.preset;
  }

  /** Returns the camera's orientation for the axis triad (world axes in view space). */
  axisTriad(): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } {
    const q = this.camera.quaternion.clone().invert();
    return {
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      y: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      z: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
  }

  // ─── keyboard fly ───────────────────────────────────────────────────────

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private fly(delta: number): void {
    if (this.keys.size === 0) return;
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.z -= 1;
    if (this.keys.has('KeyS')) move.z += 1;
    if (this.keys.has('KeyA')) move.x -= 1;
    if (this.keys.has('KeyD')) move.x += 1;
    if (this.keys.has('KeyE')) move.y += 1;
    if (this.keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(20, distance) * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1) * delta;
    move.normalize().multiplyScalar(speed);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const offset = new THREE.Vector3().addScaledVector(forward, -move.z).addScaledVector(right, move.x).addScaledVector(this.camera.up, move.y);
    this.camera.position.add(offset);
    this.controls.target.add(offset);
  }

  // ─── animation ──────────────────────────────────────────────────────────

  playClip(index: number, autoplay = true): void {
    const asset = this.asset;
    if (!asset?.model || !this.mixer) return;
    const clip = asset.model.clips[index];
    if (!clip) return;
    const store = useViewer.getState();
    if (this.action) this.action.stop();
    this.action = this.mixer.clipAction(clip);
    this.action.reset();
    this.action.setLoop(store.anim.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    this.action.clampWhenFinished = true;
    this.action.paused = !autoplay;
    this.action.play();
    this.mixer.setTime(0);
    store.setAnim({ clipIndex: index, playing: autoplay, time: 0 });
    this.rebuildGhosts();
    this.publishTracks();
  }

  setPlaying(playing: boolean): void {
    if (!this.action) return;
    const store = useViewer.getState();
    if (playing && this.action.time >= this.clipDuration() - 1e-4 && !store.anim.loop) this.seek(0);
    this.action.paused = !playing;
    store.setAnim({ playing });
  }

  stop(): void {
    this.seek(0);
    this.setPlaying(false);
  }

  seek(time: number): void {
    if (!this.action || !this.mixer) return;
    const duration = this.clipDuration();
    const t = THREE.MathUtils.clamp(time, 0, duration);
    this.action.time = t;
    this.mixer.update(0);
    useViewer.getState().setAnim({ time: t });
    this.updateGhosts();
    this.updateSelectionTransform(true);
  }

  step(frames: number): void {
    const store = useViewer.getState();
    const clip = store.anim.clips[store.anim.clipIndex];
    if (!clip) return;
    const frame = Math.round(store.anim.time * clip.fps) + frames;
    this.seek(THREE.MathUtils.clamp(frame, 0, clip.frames) / clip.fps);
    this.setPlaying(false);
  }

  /** Jumps to the previous/next key of the selected bone's tracks (or of every track). */
  stepKey(direction: 1 | -1): void {
    const store = useViewer.getState();
    const keys = new Set<number>();
    for (const track of store.anim.tracks) for (const k of track.keys) keys.add(Math.round(k * 1000) / 1000);
    const sorted = [...keys].sort((a, b) => a - b);
    if (sorted.length === 0) return;
    const t = store.anim.time;
    const next = direction > 0 ? sorted.find((k) => k > t + 1e-3) : [...sorted].reverse().find((k) => k < t - 1e-3);
    if (next === undefined) return;
    this.seek(next);
    this.setPlaying(false);
  }

  setSpeed(speed: number): void {
    if (this.mixer) this.mixer.timeScale = speed;
    for (const ghost of this.ghosts) ghost.mixer.timeScale = speed;
    useViewer.getState().setAnim({ speed });
  }

  setLoop(loop: boolean): void {
    useViewer.getState().setAnim({ loop });
    if (this.action) {
      this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      this.action.clampWhenFinished = true;
    }
  }

  setOnionSkin(on: boolean, range: number): void {
    useViewer.getState().setAnim({ onionSkin: on, onionRange: range });
    this.rebuildGhosts();
  }

  private clipDuration(): number {
    return this.action?.getClip().duration ?? 0;
  }

  private clearGhosts(): void {
    for (const ghost of this.ghosts) {
      ghost.mixer.stopAllAction();
      ghost.root.removeFromParent();
      ghost.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material && (mesh.material as THREE.Material).userData?.ghost) (mesh.material as THREE.Material).dispose();
      });
    }
    this.ghosts = [];
  }

  private rebuildGhosts(): void {
    this.clearGhosts();
    const store = useViewer.getState();
    const asset = this.asset;
    if (!asset?.model || !this.action || !store.anim.onionSkin || !store.anim.timelineOpen) return;
    const clipInfo = store.anim.clips[store.anim.clipIndex];
    if (!clipInfo) return;
    const offsets = [-store.anim.onionRange / clipInfo.fps, store.anim.onionRange / clipInfo.fps];
    const colors = [0x6e90cc, 0x9ebeff];
    offsets.forEach((offset, i) => {
      const clone = SkeletonUtils.clone(asset.geometryGroup);
      clone.traverse((o) => {
        if (o.userData.overlay || o.name === 'collisions' || (typeof o.userData.nodeId === 'string' && o.userData.nodeId.includes(':collision:'))) {
          o.visible = false;
          return;
        }
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mesh.userData as { surface?: SurfaceDesc }).surface) {
          const material = new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
          material.userData.ghost = true;
          mesh.material = material;
          mesh.renderOrder = 35;
        }
      });
      const mixer = new THREE.AnimationMixer(clone);
      const action = mixer.clipAction(this.action!.getClip());
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      mixer.timeScale = store.anim.speed;
      asset.root.add(clone);
      this.ghosts.push({ root: clone, mixer, action, offset });
    });
    this.updateGhosts();
  }

  private updateGhosts(): void {
    if (!this.action || this.ghosts.length === 0) return;
    const duration = this.clipDuration();
    if (duration <= 0) return;
    for (const ghost of this.ghosts) {
      let t = this.action.time + ghost.offset;
      t = ((t % duration) + duration) % duration;
      ghost.mixer.setTime(t);
      ghost.root.visible = ghost.offset > 0 ? this.action.time + ghost.offset <= duration || useViewer.getState().anim.loop : this.action.time + ghost.offset >= 0 || useViewer.getState().anim.loop;
    }
  }

  /** The dope-sheet rows: the selected bone's channels first, then every animated bone. */
  private publishTracks(): void {
    const store = useViewer.getState();
    const asset = this.asset;
    const clipIndex = store.anim.clipIndex;
    if (!asset?.model || clipIndex < 0) {
      if (store.anim.tracks.length > 0) store.setAnim({ tracks: [] });
      return;
    }
    const anim = asset.model.data.animations[clipIndex];
    if (!anim) return;
    const selectedBone = store.selection.primary && asset.objects.get(store.selection.primary);
    const selectedIndex = selectedBone instanceof THREE.Bone ? (selectedBone.userData.boneIndex as number) : -1;
    const tracks: TrackInfo[] = [];
    const rowsFor = (boneAnim: (typeof anim.boneAnimations)[number]): TrackInfo[] => {
      const name = asset.model!.data.bones[boneAnim.boneId]?.name || `Bone ${boneAnim.boneId + 1}`;
      const times = boneAnim.frames.map((f) => f.time);
      const changing = (pick: (f: (typeof boneAnim.frames)[number]) => number[]): { keys: number[]; constant: boolean } => {
        const keys: number[] = [];
        let constant = true;
        let prev: number[] | null = null;
        boneAnim.frames.forEach((f, i) => {
          const v = pick(f);
          const same = prev !== null && v.every((c, k) => Math.abs(c - prev![k]) < 1e-4);
          if (!same) {
            keys.push(times[i]);
            if (prev !== null) constant = false;
          }
          prev = v;
        });
        return { keys, constant };
      };
      const pos = changing((f) => f.position);
      const rot = changing((f) => f.rotation);
      const scl = changing((f) => f.scale);
      return [
        { id: `${boneAnim.boneId}:p`, boneId: boneAnim.boneId, boneName: name, channel: 'Position', keys: pos.keys, constant: pos.constant },
        { id: `${boneAnim.boneId}:r`, boneId: boneAnim.boneId, boneName: name, channel: 'Rotation', keys: rot.keys, constant: rot.constant },
        { id: `${boneAnim.boneId}:s`, boneId: boneAnim.boneId, boneName: name, channel: 'Scale', keys: scl.keys, constant: scl.constant },
      ];
    };
    const selectedAnim = anim.boneAnimations.find((b) => b.boneId === selectedIndex);
    if (selectedAnim) tracks.push(...rowsFor(selectedAnim));
    for (const boneAnim of anim.boneAnimations) {
      if (boneAnim === selectedAnim) continue;
      tracks.push(...rowsFor(boneAnim).filter((t) => !t.constant));
    }
    if (anim.events.length > 0) tracks.push({ id: 'events', boneId: -1, boneName: 'Events', channel: 'Events', keys: anim.events.map((e) => e.time), constant: false });
    store.setAnim({ tracks });
  }

  onTimelineToggled(): void {
    this.rebuildGhosts();
  }

  // ─── loop ───────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const delta = Math.min(0.1, this.clock.getDelta());
    this.fly(delta);
    this.controls.update();
    if (this.mixer && this.action) {
      const store = useViewer.getState();
      if (store.anim.playing) {
        this.mixer.update(delta);
        const duration = this.clipDuration();
        const t = this.action.time;
        if (!store.anim.loop && t >= duration - 1e-4) {
          this.action.paused = true;
          store.setAnim({ playing: false, time: duration });
        } else if (Math.abs(store.anim.time - t) > 1 / 120) {
          store.setAnim({ time: t });
        }
        this.updateGhosts();
        this.updateSelectionTransform(false);
      }
    }
    if (this.renderMode === 'lit') this.lightRig.update(this.camera);
    if (this.asset?.model) {
      this.asset.root.updateMatrixWorld(true);
      this.updateBoneMarkers();
    }
    this.renderer.render(this.scene, this.camera);
    this.trackStats(delta);
  };

  private trackStats(delta: number): void {
    this.frameTimes.push(delta * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastStats < 250) return;
    this.lastStats = now;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    const info = this.renderer.info;
    useViewer.getState().setStats({
      fps: avg > 0 ? Math.round(1000 / avg) : 0,
      frameMs: avg,
      drawCalls: info.render.calls,
      vertices: info.render.triangles * 3,
      triangles: info.render.triangles,
      textureBytes: this.asset ? this.asset.textures.bytes : 0,
    });
  }

  /** Captures the current frame as a PNG data URL. */
  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function pushBoxEdges(box: THREE.Box3, out: number[]): void {
  const { min, max } = box;
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

function objectBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  if (object instanceof THREE.SkinnedMesh) {
    // the posed extent, not the bind pose the authored bbox describes; the
    // bone matrices are only refreshed by a render, so refresh them here
    object.skeleton.update();
    object.computeBoundingBox();
    if (object.boundingBox && !object.boundingBox.isEmpty()) return object.boundingBox.clone().applyMatrix4(object.matrixWorld);
  }
  const local = (object.userData as { bbox?: THREE.Box3 }).bbox;
  if (local) return local.clone().applyMatrix4(object.matrixWorld);
  if (object instanceof THREE.Bone) {
    const p = object.getWorldPosition(new THREE.Vector3());
    const r = 20;
    return new THREE.Box3(p.clone().subScalar(r), p.clone().addScalar(r));
  }
  if (object.userData.light) {
    const p = object.getWorldPosition(new THREE.Vector3());
    const r = Math.max(32, (object.userData.light as { range: number }).range);
    return new THREE.Box3(p.clone().subScalar(r), p.clone().addScalar(r));
  }
  return new THREE.Box3().setFromObject(object, true);
}

type NodeLike = { id: string; children?: NodeLike[] };

function findNode(nodes: NodeLike[], id: string): NodeLike | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function collectLeafIds(node: NodeLike): string[] {
  if (!node.children || node.children.length === 0) return [node.id];
  const out: string[] = [];
  for (const child of node.children) out.push(...collectLeafIds(child));
  return out;
}

let engine: ViewerEngine | null = null;

export function mountEngine(canvas: HTMLCanvasElement): ViewerEngine {
  if (engine && engine.renderer.domElement === canvas) return engine;
  engine?.dispose();
  engine = new ViewerEngine(canvas);
  (window as unknown as { __yae?: ViewerEngine }).__yae = engine;
  return engine;
}

export function getEngine(): ViewerEngine | null {
  return engine;
}

export const METERS = UNITS_PER_METER;
