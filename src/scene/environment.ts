/**
 * HDR environments (.exr, .hdr): decoded to an equirectangular float texture
 * that the scene shows as its background and, in the Lit mode, uses as its
 * image-based light through a PMREM. The DS2 render mode keeps the game's
 * own lighting and takes only the backdrop.
 */
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export const HDR_EXTENSIONS = new Set(['exr', 'hdr']);

export type LoadedEnvironment = {
  name: string;
  width: number;
  height: number;
  texture: THREE.DataTexture;
  /** prefiltered radiance for scene.environment, built lazily */
  pmrem: THREE.WebGLRenderTarget | null;
};

type TexData = {
  width: number;
  height: number;
  data: THREE.TypedArray;
  format?: THREE.PixelFormat;
  type?: THREE.TextureDataType;
  colorSpace?: string;
  flipY?: boolean;
};

export function isHdrFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && HDR_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Decodes the file on the main thread (a 4k EXR takes a second or two). */
export async function loadEnvironment(file: File): Promise<LoadedEnvironment> {
  const bytes = await file.arrayBuffer();
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  let texData: TexData;
  if (ext === 'exr') {
    const loader = new EXRLoader();
    loader.setDataType(THREE.HalfFloatType);
    texData = loader.parse(bytes) as unknown as TexData;
  } else if (ext === 'hdr') {
    const loader = new HDRLoader();
    loader.setDataType(THREE.HalfFloatType);
    const parsed = loader.parse(bytes) as unknown as TexData | null;
    if (!parsed) throw new Error('not a Radiance .hdr file');
    texData = parsed;
  } else {
    throw new Error(`"${ext}" is not an HDR image (.exr or .hdr)`);
  }
  const texture = new THREE.DataTexture(texData.data, texData.width, texData.height, texData.format ?? THREE.RGBAFormat, texData.type ?? THREE.HalfFloatType);
  texture.name = file.name;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = texData.flipY ?? true;
  texture.needsUpdate = true;
  return { name: file.name, width: texData.width, height: texData.height, texture, pmrem: null };
}

export function ensurePmrem(env: LoadedEnvironment, renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!env.pmrem) {
    const generator = new THREE.PMREMGenerator(renderer);
    generator.compileEquirectangularShader();
    env.pmrem = generator.fromEquirectangular(env.texture);
    generator.dispose();
  }
  return env.pmrem.texture;
}

export function disposeEnvironment(env: LoadedEnvironment): void {
  env.texture.dispose();
  env.pmrem?.dispose();
}
