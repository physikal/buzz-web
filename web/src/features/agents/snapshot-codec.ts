export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

function bytesToLatin1(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return value;
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0)
    throw new Error("Snapshot PNG contains invalid base64 metadata.");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}

export function readSnapshotPng(
  bytes: Uint8Array,
  options: { keyword: string; pngLimit: number; jsonLimit: number },
): Uint8Array {
  if (bytes.length > options.pngLimit)
    throw new Error("Snapshot PNG exceeds its size limit.");
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new Error("Snapshot PNG signature is invalid.");
  let offset = PNG_SIGNATURE.length;
  let manifest: Uint8Array | null = null;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const length = view.getUint32(0);
    if (length > bytes.length - offset - 12)
      throw new Error("Snapshot PNG is truncated.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expected = view.getUint32(8 + length);
    const actual = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (expected !== actual)
      throw new Error("Snapshot PNG failed its integrity check.");
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      if (separator === options.keyword.length) {
        const keywordMatches = [...options.keyword].every(
          (character, index) => data[index] === character.charCodeAt(0),
        );
        if (keywordMatches) {
          if (manifest)
            throw new Error("Snapshot PNG contains duplicate manifests.");
          manifest = base64ToBytes(
            bytesToLatin1(data.subarray(separator + 1)).trim(),
          );
        }
      }
    }
    offset += 12 + length;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length)
    throw new Error("Snapshot PNG has an invalid structure.");
  if (!manifest) throw new Error("PNG does not contain a Buzz snapshot.");
  if (manifest.length > options.jsonLimit)
    throw new Error("Embedded snapshot metadata is too large.");
  return manifest;
}

async function transparentPng(): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not create snapshot PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function encodeSnapshotPng(
  snapshotBytes: Uint8Array,
  options: { keyword: string; pngLimit: number },
): Promise<Uint8Array> {
  const source = await transparentPng();
  const encoded = new TextEncoder().encode(bytesToBase64(snapshotBytes));
  const keyword = new TextEncoder().encode(options.keyword);
  const text = new Uint8Array(keyword.length + 1 + encoded.length);
  text.set(keyword);
  text[keyword.length] = 0;
  text.set(encoded, keyword.length + 1);
  const chunk = pngChunk("tEXt", text);
  const ihdrLength = new DataView(
    source.buffer,
    source.byteOffset + 8,
  ).getUint32(0);
  const insertAt = 8 + 12 + ihdrLength;
  const result = new Uint8Array(source.length + chunk.length);
  result.set(source.subarray(0, insertAt));
  result.set(chunk, insertAt);
  result.set(source.subarray(insertAt), insertAt + chunk.length);
  if (result.length > options.pngLimit)
    throw new Error("Snapshot PNG is too large.");
  return result;
}
