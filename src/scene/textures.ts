/**
 * Texture loading from the catalog. Convention (the engine's, verified
 * against the game): a texture's row 0 is the top of the image and the
 * authored UVs address it with v = 0 at the top, so every texture is
 * uploaded unflipped (`flipY = false`) and no UV is ever inverted.
 * Lightmaps are raw display values (`NoColorSpace`) and so are diffuse maps
 * in the DS2 render mode; the Lit mode reads diffuse maps as sRGB.
 */
import * as THREE from 'three';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { findTexture } from '../fs/catalog';
import type { Catalog, FileRef } from '../fs/types';
import { decodeDxt, type DxtFormat } from './dxt';

export type LoadedTexture = { texture: THREE.Texture; bytes: number; file: FileRef };

const ddsLoader = new DDSLoader();
const tgaLoader = new TGALoader();

function dxtFormatOf(format: number): DxtFormat | null {
  if (format === THREE.RGB_S3TC_DXT1_Format || format === THREE.RGBA_S3TC_DXT1_Format) return 'dxt1';
  if (format === THREE.RGBA_S3TC_DXT3_Format) return 'dxt3';
  if (format === THREE.RGBA_S3TC_DXT5_Format) return 'dxt5';
  return null;
}

function isPowerOfTwo(v: number): boolean {
  return (v & (v - 1)) === 0;
}

export class TextureCache {
  private readonly cache = new Map<string, Promise<LoadedTexture | null>>();
  private readonly missing = new Set<string>();
  private s3tc: boolean;
  bytes = 0;
  readonly defaultTexture: THREE.Texture;

  constructor(
    private catalog: Catalog,
    renderer: THREE.WebGLRenderer | null,
    private readonly onMissing?: (stem: string) => void,
  ) {
    const gl = renderer?.getContext() ?? null;
    this.s3tc = Boolean(gl && (gl.getExtension('WEBGL_compressed_texture_s3tc') || gl.getExtension('WEBGL_compressed_texture_s3tc_srgb')));
    this.defaultTexture = makeCheckerTexture();
  }

  get missingNames(): string[] {
    return [...this.missing];
  }

  /** The diffuse map for a mesh's texture key; `null` when the catalog has no such file. */
  load(stem: string): Promise<LoadedTexture | null> {
    const key = stem.toLowerCase();
    if (!key) return Promise.resolve(null);
    let pending = this.cache.get(key);
    if (!pending) {
      const file = findTexture(this.catalog, key);
      if (!file) {
        if (!this.missing.has(key)) {
          this.missing.add(key);
          this.onMissing?.(key);
        }
        pending = Promise.resolve(null);
      } else {
        pending = this.loadFile(file).catch((error) => {
          console.warn(`[textures] ${file.path}: ${error instanceof Error ? error.message : error}`);
          return null;
        });
      }
      this.cache.set(key, pending);
    }
    return pending;
  }

  async loadFile(file: FileRef): Promise<LoadedTexture> {
    const blob = await file.getFile();
    const bytes = await blob.arrayBuffer();
    const texture = await this.decode(file, bytes);
    texture.name = file.name;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const size = textureBytes(texture);
    this.bytes += size;
    return { texture, bytes: size, file };
  }

  private async decode(file: FileRef, bytes: ArrayBuffer): Promise<THREE.Texture> {
    if (file.ext === 'dds') return this.decodeDds(bytes);
    if (file.ext === 'tga') {
      const data = tgaLoader.parse(bytes) as { data: Uint8Array; width: number; height: number };
      const texture = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      const pot = isPowerOfTwo(data.width) && isPowerOfTwo(data.height);
      texture.generateMipmaps = pot;
      texture.minFilter = pot ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }
    const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'none', premultiplyAlpha: 'none' });
    const texture = new THREE.Texture(bitmap);
    const pot = isPowerOfTwo(bitmap.width) && isPowerOfTwo(bitmap.height);
    texture.generateMipmaps = pot;
    texture.minFilter = pot ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    return texture;
  }

  private decodeDds(bytes: ArrayBuffer): THREE.Texture {
    const dds = ddsLoader.parse(bytes, true);
    if (!dds.mipmaps || dds.mipmaps.length === 0) throw new Error('DDS without image data');
    const dxt = dxtFormatOf(dds.format);
    if (dxt && !this.s3tc) {
      const mip = dds.mipmaps[0];
      const rgba = decodeDxt(mip.data as Uint8Array, dds.width, dds.height, dxt);
      const texture = new THREE.DataTexture(rgba, dds.width, dds.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.generateMipmaps = isPowerOfTwo(dds.width) && isPowerOfTwo(dds.height);
      texture.minFilter = texture.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }
    if (!dxt && dds.format === THREE.RGBAFormat) {
      const mip = dds.mipmaps[0];
      const texture = new THREE.DataTexture(mip.data as Uint8Array, dds.width, dds.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.generateMipmaps = isPowerOfTwo(dds.width) && isPowerOfTwo(dds.height);
      texture.minFilter = texture.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      return texture;
    }
    const texture = new THREE.CompressedTexture(dds.mipmaps as unknown as ImageData[], dds.width, dds.height, dds.format as THREE.CompressedPixelFormat, THREE.UnsignedByteType);
    texture.minFilter = dds.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  dispose(): void {
    for (const pending of this.cache.values()) {
      void pending.then((loaded) => loaded?.texture.dispose());
    }
    this.cache.clear();
    this.defaultTexture.dispose();
    this.bytes = 0;
  }
}

export function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const w = image?.width ?? 0;
  const h = image?.height ?? 0;
  if (texture instanceof THREE.CompressedTexture) {
    let total = 0;
    for (const mip of texture.mipmaps ?? []) total += (mip as { data?: ArrayLike<number> }).data?.length ?? 0;
    return total;
  }
  const base = w * h * 4;
  return texture.generateMipmaps ? Math.round(base * 1.3333) : base;
}

/** A lightmap page: raw values, clamped, sampled through the second UV set. */
export function prepareLightmap(texture: THREE.Texture): THREE.Texture {
  texture.channel = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

function makeCheckerTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = ((x >> 3) + (y >> 3)) & 1;
      const o = (y * size + x) * 4;
      const v = on ? 150 : 90;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v + (on ? 20 : 0);
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The UV-checker debug texture: 8×8 coloured cells with a grid, 256². */
export function makeUvCheckerTexture(): THREE.Texture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x >> 5;
      const cy = y >> 5;
      const on = (cx + cy) & 1;
      const o = (y * size + x) * 4;
      const grid = x % 32 === 0 || y % 32 === 0;
      data[o] = grid ? 255 : on ? 60 + cx * 24 : 200;
      data[o + 1] = grid ? 255 : on ? 60 + cy * 24 : 200;
      data[o + 2] = grid ? 255 : on ? 160 : 200;
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
