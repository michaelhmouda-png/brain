export type JpegMetadata = {
  width: number;
  height: number;
  byteSize: number;
};

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

export function inspectJpeg(bytes: Uint8Array): JpegMetadata | null {
  if (bytes.byteLength < 16
      || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9) {
    return null;
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || marker === undefined) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 8) return null;
      height = bytes[offset + 3] * 256 + bytes[offset + 4];
      width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width < 1 || height < 1 || width > 16_384 || height > 16_384) return null;
    }
    if (marker === 0xda) {
      sawScan = true;
      offset += length;
      let foundEnd = false;
      while (offset < bytes.byteLength - 1) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0x00 || next >= 0xd0 && next <= 0xd7) {
          offset += 2;
          continue;
        }
        if (next === 0xd9) {
          foundEnd = offset === bytes.byteLength - 2;
          offset = bytes.byteLength;
          break;
        }
        return null;
      }
      if (!foundEnd) return null;
      break;
    }
    offset += length;
  }
  return sawScan && width > 0 && height > 0
    ? { width, height, byteSize: bytes.byteLength }
    : null;
}
