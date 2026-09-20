/**
 * Little-endian reader over a Uint8Array. Ported from the YAE SDK
 * (`sdk-desktop/packages/formats/src/binaryReader.ts`); every DS2 file is
 * little-endian with `u16 length + bytes` strings.
 */
export type Vec3 = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };
export type BBox = { min: Vec3; max: Vec3 };

const decoder = new TextDecoder('windows-1251');

export class BinaryReader {
  private view: DataView;
  private buffer: Uint8Array;
  offset = 0;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get length(): number {
    return this.buffer.byteLength;
  }

  eof(): boolean {
    return this.offset >= this.buffer.byteLength;
  }

  remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  readUInt8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt16LE(): number {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUInt16LE(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt32LE(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUInt32LE(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloatLE(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBool(): boolean {
    return this.readUInt8() !== 0;
  }

  /** `u16 length` + bytes; the game's strings are CP1251. */
  readPrefixedString(): string {
    const length = this.readUInt16LE();
    return this.readString(length);
  }

  readString(length: number): string {
    if (length <= 0) return '';
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return decoder.decode(slice);
  }

  readVector2(): Vec2 {
    return { x: this.readFloatLE(), y: this.readFloatLE() };
  }

  readVector3(): Vec3 {
    return { x: this.readFloatLE(), y: this.readFloatLE(), z: this.readFloatLE() };
  }

  readInt32Vector3(): Vec3 {
    return { x: this.readInt32LE(), y: this.readInt32LE(), z: this.readInt32LE() };
  }

  /** 16 floats, row-major as stored. */
  readMatrix(): number[] {
    const matrix: number[] = new Array(16);
    for (let i = 0; i < 16; i += 1) matrix[i] = this.readFloatLE();
    return matrix;
  }

  readBBox(): BBox {
    return { min: this.readVector3(), max: this.readVector3() };
  }

  /** Four u32 colour components (the level's colour buffers). */
  readColorExpanded(): { r: number; g: number; b: number; a: number } {
    return { r: this.readUInt32LE(), g: this.readUInt32LE(), b: this.readUInt32LE(), a: this.readUInt32LE() };
  }

  /** Reads `count` floats straight into a typed array (fast path for vertex buffers). */
  readFloat32Array(count: number): Float32Array {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getFloat32(this.offset, true);
      this.offset += 4;
    }
    return out;
  }

  readUint32Array(count: number): Uint32Array {
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getUint32(this.offset, true);
      this.offset += 4;
    }
    return out;
  }
}
