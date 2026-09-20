/**
 * Software DXT1/DXT3/DXT5 decode to RGBA8, for browsers without
 * `WEBGL_compressed_texture_s3tc` (mobile GPUs): the game's textures are all
 * DXT-compressed `.dds` files.
 */
export type DxtFormat = 'dxt1' | 'dxt3' | 'dxt5';

function unpack565(c: number, out: Uint8Array, at: number): void {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
}

export function decodeDxt(data: Uint8Array, width: number, height: number, format: DxtFormat): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.max(1, (width + 3) >> 2);
  const bh = Math.max(1, (height + 3) >> 2);
  const blockSize = format === 'dxt1' ? 8 : 16;
  const palette = new Uint8Array(16);
  const alphas = new Uint8Array(8);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      if (offset + blockSize > data.byteLength) return out;
      let alphaOffset = offset;
      let colorOffset = offset;
      if (format !== 'dxt1') colorOffset = offset + 8;
      const c0 = view.getUint16(colorOffset, true);
      const c1 = view.getUint16(colorOffset + 2, true);
      unpack565(c0, palette, 0);
      unpack565(c1, palette, 4);
      palette[3] = 255;
      palette[7] = 255;
      if (format !== 'dxt1' || c0 > c1) {
        for (let i = 0; i < 3; i += 1) {
          palette[8 + i] = (2 * palette[i] + palette[4 + i] + 1) / 3;
          palette[12 + i] = (palette[i] + 2 * palette[4 + i] + 1) / 3;
        }
        palette[11] = 255;
        palette[15] = 255;
      } else {
        for (let i = 0; i < 3; i += 1) {
          palette[8 + i] = (palette[i] + palette[4 + i]) >> 1;
          palette[12 + i] = 0;
        }
        palette[11] = 255;
        palette[15] = 0;
      }
      const bits = view.getUint32(colorOffset + 4, true);
      if (format === 'dxt5') {
        const a0 = data[alphaOffset];
        const a1 = data[alphaOffset + 1];
        alphas[0] = a0;
        alphas[1] = a1;
        if (a0 > a1) {
          for (let i = 1; i < 7; i += 1) alphas[1 + i] = ((7 - i) * a0 + i * a1 + 3) / 7;
        } else {
          for (let i = 1; i < 5; i += 1) alphas[1 + i] = ((5 - i) * a0 + i * a1 + 2) / 5;
          alphas[6] = 0;
          alphas[7] = 255;
        }
      }
      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py;
        if (y >= height) break;
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const idx = (bits >> ((py * 4 + px) * 2)) & 3;
          const o = (y * width + x) * 4;
          out[o] = palette[idx * 4];
          out[o + 1] = palette[idx * 4 + 1];
          out[o + 2] = palette[idx * 4 + 2];
          let alpha = palette[idx * 4 + 3];
          if (format === 'dxt3') {
            const row = view.getUint16(alphaOffset + py * 2, true);
            const a4 = (row >> (px * 4)) & 0xf;
            alpha = (a4 << 4) | a4;
          } else if (format === 'dxt5') {
            const bitIndex = (py * 4 + px) * 3;
            // 48 bits of indices in bytes 2..7, little-endian
            const lo = data[alphaOffset + 2] | (data[alphaOffset + 3] << 8) | (data[alphaOffset + 4] << 16);
            const hi = data[alphaOffset + 5] | (data[alphaOffset + 6] << 8) | (data[alphaOffset + 7] << 16);
            const code = bitIndex < 24 ? (lo >> bitIndex) & 7 : (hi >> (bitIndex - 24)) & 7;
            alpha = alphas[code];
          }
          out[o + 3] = alpha;
        }
      }
      offset += blockSize;
    }
  }
  return out;
}
