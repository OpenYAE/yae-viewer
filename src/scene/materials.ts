/**
 * Materials for every render mode, built from a surface description (what
 * the mesh has: a diffuse map, a lightmap page, baked vertex light, a `.mat`
 * template). The DS2 mode is the game's fixed-function picture — `diffuse ×
 * lightmap × 2` (or `× vertex light × 2`) in display space, written out
 * without an encode — the contract `yae-engine/docs/Invariants.md`, "Colour
 * space of authored data", states. The Lit mode decodes the same values with
 * a pure γ 2.2 and lights them with three.js lights.
 */
import * as THREE from 'three';
import type { MatBlend, MatTemplate } from '../formats';
import { templateFromName } from '../formats';
import type { RenderMode } from '../state/types';
import { makeUvCheckerTexture } from './textures';

export interface SurfaceDesc {
  /** cache key: everything below that changes the material */
  key: string;
  label: string;
  diffuse: THREE.Texture | null;
  lightmap: THREE.Texture | null;
  hasVertexColor: boolean;
  /** a model surface: no baked light, shaded by the hemisphere instead */
  isModel: boolean;
  twoSided: boolean;
  alphaTest: number;
  blend: MatBlend;
  depthWrite: boolean;
  sortValue: number;
  selfIllumination: boolean;
  /** vertex alpha varies (VxA decals) */
  hasVertexAlpha: boolean;
}

export function resolveTemplate(name: string, library: Map<string, MatTemplate>): Pick<MatTemplate, 'blend' | 'alphaTest' | 'twoSided' | 'depthWrite' | 'sortValue' | 'selfIllumination' | 'staticLight'> {
  const found = library.get(name.toLowerCase());
  if (found) return found;
  const guess = templateFromName(name);
  return {
    blend: guess.blend ?? 'none',
    alphaTest: guess.alphaTest ?? null,
    twoSided: guess.twoSided ?? false,
    depthWrite: guess.blend ? false : true,
    sortValue: guess.blend ? 8 : 5,
    selfIllumination: guess.selfIllumination ?? false,
    staticLight: guess.staticLight ?? 'lightmap',
  };
}

const GAMMA_DECODE = 'pow(max(c, vec3(0.0)), vec3(2.2))';

type Patchable = THREE.Material;

export class MaterialFactory {
  readonly exposure = { value: 1 };
  readonly uvChecker = makeUvCheckerTexture();
  private lightmapsOn = true;
  private readonly cache = new Map<string, THREE.Material>();
  private readonly lightmapMaterials = new Set<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>();

  setExposure(value: number): void {
    this.exposure.value = value;
  }

  setLightmapsVisible(on: boolean): void {
    if (this.lightmapsOn === on) return;
    this.lightmapsOn = on;
    for (const material of this.lightmapMaterials) {
      material.lightMapIntensity = on ? 2 : 0;
      material.needsUpdate = false;
    }
  }

  get(desc: SurfaceDesc, mode: RenderMode): THREE.Material {
    const key = `${mode}|${desc.key}`;
    let material = this.cache.get(key);
    if (!material) {
      material = this.build(desc, mode);
      material.name = `${mode}:${desc.label}`;
      this.cache.set(key, material);
    }
    return material;
  }

  private applyCommon(material: THREE.Material, desc: SurfaceDesc, allowBlend: boolean): void {
    material.side = desc.twoSided ? THREE.DoubleSide : THREE.FrontSide;
    if (desc.alphaTest > 0) material.alphaTest = desc.alphaTest;
    if (allowBlend && desc.blend !== 'none') {
      material.transparent = true;
      material.depthWrite = desc.depthWrite;
      if (desc.blend === 'add') material.blending = THREE.AdditiveBlending;
      else if (desc.blend === 'modulate') {
        material.blending = THREE.MultiplyBlending;
        material.premultipliedAlpha = true;
      }
      else material.blending = THREE.NormalBlending;
    } else if (desc.hasVertexAlpha || (desc.diffuse && desc.alphaTest === 0 && desc.blend === 'none' && desc.sortValue > 5)) {
      // alpha-tested decals and vertex-alpha fades without a blend keyword
      material.transparent = false;
    }
    material.toneMapped = false;
  }

  /** Multiplies the frame by the exposure; `raw` also drops the output encode (display values pass through). */
  private patchOutput(material: Patchable, raw: boolean, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
    const exposure = this.exposure;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uExposure = exposure;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        `gl_FragColor.rgb *= uExposure;\n${raw ? '' : '#include <colorspace_fragment>'}`,
      );
      shader.fragmentShader = `uniform float uExposure;\n${shader.fragmentShader}`;
      extra?.(shader);
    };
    material.customProgramCacheKey = () => `yae-${raw ? 'raw' : 'enc'}-${extra ? extra.toString().length : 0}`;
  }

  private build(desc: SurfaceDesc, mode: RenderMode): THREE.Material {
    switch (mode) {
      case 'ds2':
        return this.buildDs2(desc);
      case 'lit':
        return this.buildLit(desc);
      case 'albedo': {
        const material = new THREE.MeshBasicMaterial({ map: desc.diffuse ?? null, color: desc.diffuse ? 0xffffff : 0x8c94a3 });
        this.applyCommon(material, desc, true);
        this.patchOutput(material, true);
        return material;
      }
      case 'normals': {
        const material = new THREE.MeshNormalMaterial();
        material.side = desc.twoSided ? THREE.DoubleSide : THREE.FrontSide;
        return material;
      }
      case 'lightmap': {
        const material = new THREE.MeshBasicMaterial();
        if (desc.lightmap) {
          material.map = desc.lightmap;
          material.color.setRGB(2, 2, 2);
        } else if (desc.hasVertexColor) {
          material.vertexColors = true;
        } else {
          material.color.setRGB(desc.isModel ? 0.8 : 0.25, desc.isModel ? 0.8 : 0.25, desc.isModel ? 0.8 : 0.25);
        }
        material.side = desc.twoSided ? THREE.DoubleSide : THREE.FrontSide;
        material.toneMapped = false;
        this.patchOutput(material, true);
        return material;
      }
      case 'uv': {
        const material = new THREE.MeshBasicMaterial({ map: this.uvChecker });
        material.side = desc.twoSided ? THREE.DoubleSide : THREE.FrontSide;
        material.toneMapped = false;
        this.patchOutput(material, false);
        return material;
      }
      case 'wireframe': {
        const material = new THREE.MeshBasicMaterial({ color: 0x6f7a8c, wireframe: true });
        material.toneMapped = false;
        return material;
      }
      default:
        return this.buildDs2(desc);
    }
  }

  private buildDs2(desc: SurfaceDesc): THREE.Material {
    if (desc.isModel) {
      // A model has no baked light: the hemisphere light (sky 1.0, ground 0.35)
      // stands in for the level's ambient, in display space like the engine's.
      const material = new THREE.MeshLambertMaterial({ map: desc.diffuse ?? null, color: desc.diffuse ? 0xffffff : 0x9aa3b2 });
      this.applyCommon(material, desc, true);
      this.patchOutput(material, true);
      return material;
    }
    const material = new THREE.MeshBasicMaterial({ map: desc.diffuse ?? null, color: desc.diffuse ? 0xffffff : 0x8c94a3 });
    if (desc.lightmap) {
      material.lightMap = desc.lightmap;
      material.lightMapIntensity = this.lightmapsOn ? 2 : 0;
      this.lightmapMaterials.add(material);
    } else if (desc.hasVertexColor) {
      material.vertexColors = true;
    }
    this.applyCommon(material, desc, true);
    this.patchOutput(material, true, (shader) => {
      // MeshBasicMaterial divides its lightmap by π; the game multiplies raw values.
      shader.fragmentShader = shader.fragmentShader.replace('lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI', 'lightMapTexel.rgb * lightMapIntensity');
    });
    return material;
  }

  private buildLit(desc: SurfaceDesc): THREE.Material {
    const material = new THREE.MeshStandardMaterial({
      map: desc.diffuse ?? null,
      color: desc.diffuse ? 0xffffff : 0x8c94a3,
      roughness: 0.85,
      metalness: 0,
    });
    if (desc.lightmap) {
      material.lightMap = desc.lightmap;
      material.lightMapIntensity = this.lightmapsOn ? 2 : 0;
      this.lightmapMaterials.add(material);
    } else if (desc.hasVertexColor) {
      material.vertexColors = true;
    }
    if (desc.selfIllumination && desc.diffuse) {
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = desc.diffuse;
      material.emissiveIntensity = 1;
    }
    this.applyCommon(material, desc, true);
    this.patchOutput(material, false, (shader) => {
      // Authored values are display values: decode diffuse × vertex light with
      // a pure power, and the lightmap with the same power and 2^γ.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>\n{ vec3 c = diffuseColor.rgb; diffuseColor.rgb = ${GAMMA_DECODE}; }`)
        .replace(
          '#include <lights_fragment_maps>',
          THREE.ShaderChunk.lights_fragment_maps.replace(
            'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
            `vec3 c = lightMapTexel.rgb; vec3 lightMapIrradiance = ${GAMMA_DECODE} * (lightMapIntensity > 0.0 ? 4.594793 : 0.0);`,
          ),
        )
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{ vec3 c = totalEmissiveRadiance; totalEmissiveRadiance = ${GAMMA_DECODE}; }`);
    });
    return material;
  }

  /** Recompiles every material (a shadow-map toggle changes the shader). */
  invalidate(): void {
    for (const material of this.cache.values()) material.needsUpdate = true;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
    this.lightmapMaterials.clear();
    this.uvChecker.dispose();
  }
}

/** The material of the selection tint overlay and of the overlays' helpers. */
export const ACCENT = 0x4c8df6;
export const TEAL = 0x3fb9a8;
export const AMBER = 0xd8a657;
export const RED = 0xde6b62;
export const GREEN = 0x5fbf84;
/** Bone markers: light, so they read on a dark model and against the dark viewport alike. */
export const BONE_MARKER = 0xc3c9d4;
