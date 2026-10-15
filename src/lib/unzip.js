// A minimal ZIP reader for WEBForms' "download as zip" — the only zip this extension opens.
//
// Why our own: no dependencies (agents should be able to read every line that touches
// their contracts), and the browser already ships the hard part, DecompressionStream
// ("deflate-raw"). Handles stored and deflated entries. Refuses encryption and zip64,
// which WEBForms doesn't produce; if it ever does, failing loudly beats guessing.
//
// Every entry is checked against the size and CRC-32 in the zip's own directory, so a
// PDF that reaches Real Signature is byte-for-byte the one WEBForms made (PLAN rule 4).

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

let CRC_TABLE;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** bytes (ArrayBuffer | Uint8Array) → [{name, data: Uint8Array}] in the zip's order.
 *  Folders are skipped. Throws a plain message on anything unexpected. */
export async function unzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 22) throw new Error("the download isn't a zip file");

  // The end-of-central-directory record sits at the end, after an optional comment.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("the download isn't a zip file");
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 downloads aren't supported");

  const names = new TextDecoder("utf-8");
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== CENTRAL) throw new Error("the zip's directory is damaged");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = names.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`"${name}" is encrypted`);
    // Bounds first: a header pointing past the end would otherwise surface as a bare
    // RangeError from DataView rather than this plain message (outside review, 2026-10-15).
    if (localAt + 30 > u8.length || dv.getUint32(localAt, true) !== LOCAL) throw new Error("the zip's entries are damaged");
    // Sizes come from the central directory: the local header may leave them zero when a
    // data descriptor follows the data.
    const start = localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    if (start + csize > u8.length) throw new Error(`"${name}" is cut short — the download may be incomplete`);
    const raw = u8.subarray(start, start + csize);

    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`"${name}" uses a compression this extension can't read (${method})`);

    if (data.length !== usize || crc32(data) !== crc) {
      throw new Error(`"${name}" didn't unpack cleanly — try again`);
    }
    out.push({ name, data });
  }
  return out;
}
