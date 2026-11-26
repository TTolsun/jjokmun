export function resolveMarkdownPath(documentPath, href) {
  const target = href?.trim().split(/[?#]/, 1)[0];
  if (!documentPath || !target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/')) return null;
  const parts = documentPath.split('/').slice(0, -1);
  for (const raw of target.split('/')) {
    let component;
    try { component = decodeURIComponent(raw); }
    catch { return null; }
    if (/[\\/:\u0000-\u001f\u007f]/.test(component)) return null;
    if (!component || component === '.') continue;
    if (component === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(component);
    }
  }
  return parts.join('/') || null;
}

function matches(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isAvif(bytes) {
  if (ascii(bytes, 4, 4) !== 'ftyp') return false;
  const boxLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  for (let offset = 8; offset + 4 <= Math.min(boxLength, bytes.length); offset += offset === 8 ? 8 : 4) {
    const brand = ascii(bytes, offset, 4);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
}

const formats = {
  png: ['image/png', bytes => matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10])],
  jpg: ['image/jpeg', bytes => matches(bytes, [255, 216, 255])],
  gif: ['image/gif', bytes => ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))],
  webp: ['image/webp', bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'],
  avif: ['image/avif', isAvif],
  bmp: ['image/bmp', bytes => ascii(bytes, 0, 2) === 'BM'],
  ico: ['image/x-icon', bytes => matches(bytes, [0, 0, 1, 0])]
};

export async function readMarkdownImage(directory, documentPath, src) {
  const path = resolveMarkdownPath(documentPath, src);
  if (!directory || !path) return null;
  const parts = path.split('/');
  const name = parts.pop();
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  const format = ['jpeg', 'jpe', 'jfif'].includes(extension) ? 'jpg' : extension;
  if (!Object.hasOwn(formats, format)) return null;
  try {
    let parent = directory;
    for (const part of parts) parent = await parent.getDirectoryHandle(part);
    const handle = await parent.getFileHandle(name);
    const file = await handle.getFile();
    const [mime, verify] = formats[format];
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    return verify(bytes) ? file.slice(0, file.size, mime) : null;
  } catch {
    return null;
  }
}
