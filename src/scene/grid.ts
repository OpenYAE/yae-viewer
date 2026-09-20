import * as THREE from 'three';
import { UNITS_PER_METER } from './levelBuilder';

/**
 * The ground grid: `step` metres per cell on the XZ plane (Y-up world), a
 * stronger line every ten cells, the X axis in red and the Z axis in blue.
 * Sized to the loaded asset so a level's floor is covered and a model does
 * not stand on a horizon.
 */
export function makeGrid(stepMetres: number, extentUnits: number): THREE.LineSegments {
  const step = Math.max(0.05, stepMetres) * UNITS_PER_METER;
  const half = Math.max(step * 10, Math.ceil(extentUnits / step) * step);
  // a level's floor can be hundreds of metres: the grid stops at 160 cells a side
  const count = Math.min(160, Math.round(half / step));
  const size = count * step;
  const positions: number[] = [];
  const colors: number[] = [];
  const minor = new THREE.Color(0x232a36);
  const major = new THREE.Color(0x323b4a);
  const xAxis = new THREE.Color(0x9e5a58);
  const zAxis = new THREE.Color(0x3f6fb8);
  const push = (x1: number, z1: number, x2: number, z2: number, c: THREE.Color) => {
    positions.push(x1, 0, z1, x2, 0, z2);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };
  for (let i = -count; i <= count; i += 1) {
    const p = i * step;
    if (i === 0) continue;
    const c = i % 10 === 0 ? major : minor;
    push(p, -size, p, size, c);
    push(-size, p, size, p, c);
  }
  push(-size, 0, size, 0, xAxis);
  push(0, -size, 0, size, zAxis);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
  const grid = new THREE.LineSegments(geometry, material);
  grid.name = 'grid';
  grid.renderOrder = -1;
  grid.userData.overlay = true;
  return grid;
}
