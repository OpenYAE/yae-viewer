import * as THREE from 'three';
import type { LightEntry } from './overlays';

/**
 * A fixed pool of three.js lights for the Lit mode. A level lists up to a
 * few hundred lights; the forward renderer can bind a few dozen, and every
 * change of their number recompiles every material. So the pool never
 * changes size: each frame the level lights nearest the camera fill the
 * slots and the rest sit dark.
 */
const POINT_SLOTS = 20;
const SPOT_SLOTS = 8;
const SHADOW_SLOTS = 2;
/** The record's intensity is authored for a 1/d falloff in 64-units-per-metre space. */
const INTENSITY_SCALE = 0.9;

export class LightRig {
  readonly group = new THREE.Group();
  private points: THREE.PointLight[] = [];
  private spots: THREE.SpotLight[] = [];
  private entries: LightEntry[] = [];
  private enabled = false;
  private scratch = new THREE.Vector3();
  private cameraPos = new THREE.Vector3();

  constructor() {
    this.group.name = 'lightRig';
    for (let i = 0; i < POINT_SLOTS; i += 1) {
      // Slots stay visible at zero intensity: a change in the number of
      // visible lights would recompile every material.
      const light = new THREE.PointLight(0xffffff, 0, 1, 1);
      this.points.push(light);
      this.group.add(light);
    }
    for (let i = 0; i < SPOT_SLOTS; i += 1) {
      const light = new THREE.SpotLight(0xffffff, 0, 1, Math.PI / 4, 0.6, 1);
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0005;
      this.group.add(light.target);
      this.spots.push(light);
      this.group.add(light);
    }
  }

  setEntries(entries: LightEntry[]): void {
    this.entries = entries;
    this.resetSlots();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.resetSlots();
  }

  setShadows(on: boolean): void {
    this.spots.forEach((light, i) => {
      light.castShadow = on && i < SHADOW_SLOTS;
    });
  }

  private resetSlots(): void {
    for (const light of this.points) light.intensity = 0;
    for (const light of this.spots) light.intensity = 0;
  }

  /** Called once per frame from the render loop. */
  update(camera: THREE.Camera): void {
    if (!this.enabled || this.entries.length === 0) return;
    camera.getWorldPosition(this.cameraPos);
    const scored: Array<{ entry: LightEntry; distance: number; pos: THREE.Vector3 }> = [];
    for (const entry of this.entries) {
      if (!entry.anchor.visible || !entry.anchor.parent?.visible) continue;
      const pos = entry.anchor.getWorldPosition(new THREE.Vector3());
      const range = Math.max(entry.light.range, entry.light.outerRadius, 64);
      const distance = Math.max(0, pos.distanceTo(this.cameraPos) - range);
      scored.push({ entry, distance, pos });
    }
    scored.sort((a, b) => a.distance - b.distance);
    let p = 0;
    let s = 0;
    for (const item of scored) {
      const record = item.entry.light;
      const range = Math.max(record.range, record.outerRadius, record.innerRadius, 64);
      const intensity = Math.max(0, record.intensity) * INTENSITY_SCALE;
      if (record.type === 3 && s < SPOT_SLOTS) {
        const light = this.spots[s++];
        light.position.copy(item.pos);
        light.color.setRGB(record.color.x, record.color.y, record.color.z);
        light.distance = range;
        light.intensity = intensity * range;
        light.angle = Math.PI / 4;
        light.penumbra = 0.6;
        this.scratch.set(record.direction.x, record.direction.y, record.direction.z);
        item.entry.anchor.localToWorld(this.scratch);
        light.target.position.copy(this.scratch);
        light.target.updateMatrixWorld(true);
      } else if (record.type !== 3 && p < POINT_SLOTS) {
        const light = this.points[p++];
        light.position.copy(item.pos);
        light.color.setRGB(record.color.x, record.color.y, record.color.z);
        light.distance = range;
        light.intensity = intensity * range;
      }
      if (p >= POINT_SLOTS && s >= SPOT_SLOTS) break;
    }
    for (let i = p; i < POINT_SLOTS; i += 1) this.points[i].intensity = 0;
    for (let i = s; i < SPOT_SLOTS; i += 1) this.spots[i].intensity = 0;
  }
}
