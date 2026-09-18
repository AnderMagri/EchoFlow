/**
 * Minimal ZIP writer — stored (uncompressed) entries only.
 *
 * Why not a library: the bundle is text, the extension has no build step, and a
 * dependency here would force one. The stored-entry subset of the spec is ~90
 * lines and produces valid ZIP that every OS unarchiver opens.
 *
 * @module extension/lib/zip
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * @param {Record<string, string|Uint8Array>} files path -> contents. Text is
 *   encoded as UTF-8; a Uint8Array is stored verbatim, so icons and fonts
 *   survive. Encoding bytes as text silently corrupts them, and a packaged
 *   extension that lost its icon still loads — which is how it goes unnoticed.
 * @returns {Blob}
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const entries = Object.entries(files);

  for (const [path, text] of entries) {
    const nameBytes = encoder.encode(path);
    const data = text instanceof Uint8Array ? text : encoder.encode(text);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed to extract
    local.setUint16(6, 0x0800, true);       // UTF-8 filenames
    local.setUint16(8, 0, true);            // method: stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // central directory signature
    cd.setUint16(4, 20, true);              // version made by
    cd.setUint16(6, 20, true);              // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);              // method: stored
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);         // relative offset of local header
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
