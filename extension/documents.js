import { scanFiles } from './folder.js';
import { readDocumentHandle, rememberDocumentHandles } from './last-folder.js';
import { localDate } from './store.js';

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_PREFIX_BYTES = 32 * 1024 * 1024;
const INVENTORY_TTL = 2000;
const documentFormats = new Map([
  ['md', 'markdown'], ['markdown', 'markdown'], ['txt', 'text'], ['puml', 'plantuml'], ['plantuml', 'plantuml'],
  ['mmd', 'mermaid'], ['mermaid', 'mermaid']
]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const utf16le = new TextDecoder('utf-16le', { fatal: true });
const utf16be = new TextDecoder('utf-16be', { fatal: true });
const encoder = new TextEncoder();
const inventories = new WeakMap();

export class DocumentConflictError extends Error {
  constructor(message = '파일이 다른 곳에서 바뀌었습니다. 현재 내용을 확인한 뒤 다시 저장해 주세요.') {
    super(message);
  }
}

export class DocumentWriteError extends Error {}

export function documentFormat(path) {
  return documentFormats.get(path.match(/\.([^.\/]+)$/)?.[1].toLowerCase());
}

const extensions = { markdown: 'md', text: 'txt', plantuml: 'puml', mermaid: 'mmd' };
const mermaidHeader = new RegExp('^(?:(?:graph|flowchart)\\s+(?:TB|TD|BT|RL|LR)\\s*;?|pie(?:\\s+(?:showData|title\\s.+))?|'
  + '(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|quadrantChart|requirementDiagram'
  + '|gitGraph|mindmap|timeline|kanban|C4(?:Context|Container|Component|Dynamic|Deployment)'
  + '|(?:sankey|xychart|block|packet|architecture)-beta)\\s*)$');

// Recognize a whole-diagram source by its header so a pasted diagram renders
// without a code fence. Only unambiguous headers count, so prose stays Markdown.
export function detectFormat(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  if (/^@start[a-z]+\b/i.test(lines[0] ?? '') && /^@end[a-z]+$/i.test(lines.at(-1))) return 'plantuml';
  if (lines.length > 1 && mermaidHeader.test(lines[0])) return 'mermaid';
  return 'markdown';
}

export function memoFormat(memo) {
  return memo.documentFormat ?? (memo.documentPath ? documentFormat(memo.documentPath) : 'markdown');
}

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function inspect(handle, cached) {
  const file = await handle.getFile();
  if (file.size > MAX_DOCUMENT_BYTES) return null;
  if (cached?.bytes.length === file.size && cached.time === file.lastModified) return { ...cached, handle };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
    : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  const text = (encoding === 'utf-16le' ? utf16le : encoding === 'utf-16be' ? utf16be : decoder).decode(bytes);
  if (text.includes('\0')) return null;
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  return { handle, text, bytes, bom, encoding, hash: await digest(bytes), time: Math.max(0, file.lastModified) };
}

export async function documentChanged(directory, memo) {
  if (!directory || !memo.documentPath) return false;
  const components = memo.documentPath.split('/');
  if (components.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return !memo.documentMissing;
  const name = components.pop();
  try {
    let parent = directory;
    for (const part of components) parent = await parent.getDirectoryHandle(part);
    const file = await inspect(await parent.getFileHandle(name));
    if (!file) return !memo.documentMissing;
    if (memo.documentMissing) return true;
    return memo.documentHash ? file.hash !== memo.documentHash : file.text !== memo.text;
  } catch (error) {
    if (error instanceof TypeError || ['NotFoundError', 'NotReadableError', 'TypeMismatchError'].includes(error.name)) {
      return !memo.documentMissing;
    }
    throw error;
  }
}

function descriptor(file, provisional) {
  return { path: file.path, hash: file.hash, size: file.text.length ? file.bytes.length : 0, ...(provisional && { provisional }) };
}

function referenced(payload, id) {
  return payload.state.props.some(entry => entry.memoId === id)
    || payload.state.shop?.guestMemoId === id || payload.state.shop?.displayMemoId === id
    || payload.undo?.memos?.some(entry => entry.id === id) || payload.undo?.daily?.some(entry =>
      entry.before?.memoId === id || entry.after?.memoId === id);
}

function byHash(entries, getHash) {
  const groups = new Map();
  for (const entry of entries) {
    const hash = getHash(entry);
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(entry);
  }
  return groups;
}

function annotate(memo, binding, file, payload) {
  memo.documentPath = binding.path;
  memo.documentMissing = !file;
  memo.documentRelinkable = Boolean(file && binding.provisional && !memo.replies.length && !referenced(payload, memo.id));
  memo.documentFormat = documentFormat(binding.path);
  memo.documentHash = file?.hash;
  memo.text = file?.text ?? '';
}

export function clearDocumentFields(memo) {
  delete memo.documentPath;
  delete memo.documentMissing;
  delete memo.documentRelinkable;
  delete memo.documentHash;
}

async function inventoryFor(directory, force, revision, bindings) {
  const current = inventories.get(directory);
  if (!force && current && current.revision === revision && Date.now() - current.time < INVENTORY_TTL) return current;
  const expectedHashes = new Map(Object.values(bindings).map(binding => [binding.path, binding.hash]));
  const inventory = await scanFiles(directory, new AbortController().signal);
  const eligible = inventory.files.filter(file => documentFormat(file.path));
  const files = new Map();
  // Bound concurrent native file reads, including on large folder trees.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, eligible.length) }, async () => {
    while (next < eligible.length) {
      const { handle, path } = eligible[next++];
      try {
        const cached = current?.files.get(path);
        const expected = expectedHashes.get(path);
        const file = await inspect(handle, force || (expected && cached?.hash !== expected) ? undefined : cached);
        if (file) files.set(path, { ...file, path });
      } catch (error) {
        if (!(error instanceof TypeError) && !['NotFoundError', 'NotReadableError', 'NotAllowedError'].includes(error.name)) throw error;
      }
    }
  }));
  const result = { files, eligible, time: Date.now(), revision };
  inventories.set(directory, result);
  return result;
}

export function invalidateDocumentInventory(directory, path) {
  const current = inventories.get(directory);
  if (path && current) {
    current.time = 0;
    current.files.delete(path);
  } else inventories.delete(directory);
}

export function rememberDocumentRevision(directory, revision) {
  const inventory = inventories.get(directory);
  if (inventory) inventory.revision = revision;
}

async function matchExtensions(entries, linked, free, assign) {
  const pending = entries.filter(([id, binding]) => !linked.has(id) && !binding.removed && binding.size > 0);
  const sizes = new Set(pending.map(([, binding]) => binding.size));
  const old = byHash(pending, ([, binding]) => binding.hash);
  const newPaths = new Map();
  const oldIds = new Map();
  let work = 0;
  for (const file of free.values()) {
    for (const size of sizes) {
      if (size >= file.bytes.length) continue;
      work += size;
      if (work > MAX_PREFIX_BYTES) return;
      const candidates = old.get(await digest(file.bytes.subarray(0, size))) ?? [];
      for (const [id] of candidates) {
        if (!newPaths.has(id)) newPaths.set(id, []);
        newPaths.get(id).push(file);
        oldIds.set(file.path, (oldIds.get(file.path) || 0) + 1);
      }
    }
  }
  for (const [id, files] of newPaths) {
    if (files.length === 1 && oldIds.get(files[0].path) === 1) assign(id, files[0]);
  }
}

export async function openDocuments(directory, payload, force = true, revision) {
  const original = payload.documents;
  const bindings = Object.assign(Object.create(null), original);
  const { files, eligible } = await inventoryFor(directory, force, revision, bindings);

  const linked = new Map();
  const free = new Map(files);
  const handles = [];
  function assign(id, file) {
    linked.set(id, file);
    free.delete(file.path);
    if (bindings[id]?.path !== file.path) handles.push([id, file.handle]);
  }
  const entries = Object.entries(bindings);
  for (const [id, binding] of entries) {
    const file = free.get(binding.path);
    if (file) assign(id, file);
  }
  for (const [id] of entries) {
    if (linked.has(id)) continue;
    const handle = await readDocumentHandle(id).catch(() => null);
    if (!handle) continue;
    const segments = await directory.resolve(handle).catch(() => null);
    const file = segments && free.get(segments.join('/'));
    if (file && await file.handle.isSameEntry(handle).catch(() => false)) assign(id, file);
  }
  const matches = byHash(free.values(), file => file.hash);
  const missing = byHash(entries.filter(([id, binding]) => !linked.has(id) && binding.size > 0), ([, binding]) => binding.hash);
  for (const [hash, entries] of missing) {
    const candidates = matches.get(hash);
    if (entries.length === 1 && candidates?.length === 1) assign(entries[0][0], candidates[0]);
  }
  await matchExtensions(entries, linked, free, assign);

  const memos = new Map(payload.state.memos.map(memo => [memo.id, memo]));
  for (const [id, file] of linked) {
    const memo = memos.get(id);
    const binding = bindings[id];
    if (memo && binding.hash !== file.hash) memo.updatedAt = Math.max(file.time, memo.updatedAt + 1);
    bindings[id] = { ...descriptor(file, binding.provisional), ...(binding.removed && { removed: true }) };
  }
  for (const file of eligible) {
    const available = free.get(file.path);
    if (!available) continue;
    const id = crypto.randomUUID();
    assign(id, available);
    const createdOn = localDate(new Date(available.time));
    const memo = { id, text: '', createdOn, createdAt: available.time, updatedAt: available.time, replies: [] };
    bindings[id] = descriptor(available, true);
    memos.set(id, memo);
    payload.state.memos.push(memo);
  }
  for (const [id, binding] of Object.entries(bindings)) {
    const memo = memos.get(id);
    if (memo) annotate(memo, binding, linked.get(id), payload);
  }
  if (Object.keys(bindings).length) payload.documents = bindings;
  return { bindings, linked, handles, changed: JSON.stringify(bindings) !== JSON.stringify(original ?? {}) };
}

async function prepareBody(text, before) {
  if (text.includes('\0')) throw new DocumentWriteError('널 문자는 파일에 저장할 수 없습니다.');
  if (before?.text.includes('\r\n') && !before.text.replaceAll('\r\n', '').includes('\n')) {
    text = text.replace(/\r?\n/g, '\r\n');
  }
  let bytes;
  if (before?.encoding?.startsWith('utf-16')) {
    const littleEndian = before.encoding === 'utf-16le';
    bytes = new Uint8Array(2 + 2 * text.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, littleEndian);
    for (let index = 0; index < text.length; index++) view.setUint16(2 + 2 * index, text.charCodeAt(index), littleEndian);
  } else bytes = encoder.encode((before?.bom ? '\uFEFF' : '') + text);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentWriteError('파일은 4MiB까지 저장할 수 있습니다.');
  return { hash: await digest(bytes), text, bytes };
}

async function writeDocument(handle, bytes, before) {
  let writer;
  try {
    writer = await handle.createWritable({ mode: 'exclusive' });
    const current = await inspect(handle);
    if (!current || current.hash !== before.hash || current.time !== before.time) throw new DocumentConflictError();
    await writer.write(bytes);
    const latest = await inspect(handle);
    if (!latest || latest.hash !== current.hash || latest.time !== current.time) throw new DocumentConflictError();
    await writer.close();
  } catch (error) {
    if (writer) await writer.abort().catch(() => {});
    if (['NotFoundError', 'NotReadableError', 'NoModificationAllowedError'].includes(error.name)) throw new DocumentConflictError();
    throw error;
  }
}

export function persistentDocuments(payload) {
  return {
    ...payload,
    state: {
      ...payload.state,
      memos: payload.state.memos.map(memo => {
        const stored = { ...memo };
        clearDocumentFields(stored);
        if (Object.hasOwn(payload.documents ?? {}, memo.id)) stored.text = '';
        return stored;
      })
    }
  };
}

export function relinkInPayload(payload, documents, id, path) {
  const missing = payload.state.memos.find(memo => memo.id === id && memo.documentMissing);
  const candidate = payload.state.memos.find(memo => memo.documentPath === path && memo.documentRelinkable);
  if (!missing || !candidate) throw new DocumentConflictError('다시 연결할 파일을 찾을 수 없습니다.');
  const file = documents.linked.get(candidate.id);
  delete documents.bindings[candidate.id];
  documents.linked.delete(candidate.id);
  documents.bindings[id] = descriptor(file, false);
  documents.linked.set(id, file);
  documents.handles.push([id, file.handle], [candidate.id, null]);
  payload.state.memos = payload.state.memos.filter(memo => memo.id !== candidate.id);
  for (const entry of payload.state.daily) {
    if (entry.memoId === candidate.id) entry.memoId = missing.createdOn < entry.date ? id : null;
  }
  missing.updatedAt = Math.max(file.time, missing.updatedAt + 1);
  annotate(missing, documents.bindings[id], file, payload);
}

function newDocumentPath(text, format = 'markdown') {
  // A diagram's first line is its @start or header keyword, which says nothing about the content.
  const title = format === 'plantuml' || format === 'mermaid' ? '다이어그램' : text.trimStart().split(/\r?\n/, 1)[0]
    .replace(/[<>:"/\\|?*.\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const extension = extensions[format] ?? 'md';
  return `${Array.from(title).slice(0, 48).join('').trim() || '메모'}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
}

async function assertPathAvailable(directory, path) {
  try {
    await directory.getFileHandle(path);
  } catch (error) {
    if (error.name === 'NotFoundError') return;
    if (error.name !== 'TypeMismatchError') throw error;
  }
  throw new DocumentConflictError('같은 이름의 파일이 이미 있습니다. 다시 저장해 주세요.');
}

async function createDocument(directory, file, id, documents) {
  const { path, bytes } = file;
  await assertPathAvailable(directory, path);
  const handle = await directory.getFileHandle(path, { create: true });
  const initial = await inspect(handle);
  if (!initial || initial.bytes.length) throw new DocumentConflictError();
  try {
    await writeDocument(handle, bytes, initial);
  } catch (error) {
    try {
      const entry = await directory.getFileHandle(path);
      const current = await inspect(entry);
      if (current?.bytes.length === 0 && current.time === initial.time && await entry.isSameEntry(handle)) {
        await directory.removeEntry(path);
      }
    } catch { /* Preserve the original error. */ }
    throw error;
  }
  documents.handles.push([id, handle]);
}

export async function prepareDocuments(directory, payload, documents, before, createFiles) {
  let write;
  const afterIds = new Set(payload.state.memos.map(memo => memo.id));
  for (const [id, binding] of Object.entries(documents.bindings)) {
    if (afterIds.has(id) || !before.has(id)) continue;
    // Keep the source file and suppress the removed memo on later scans.
    documents.bindings[id] = { ...binding, removed: true };
  }
  for (const memo of payload.state.memos) {
    const previous = before.get(memo.id);
    let file = documents.linked.get(memo.id);
    if (previous && Object.hasOwn(documents.bindings, memo.id)) {
      if (memo.text === previous.text) continue;
      if (!file) throw new DocumentConflictError('파일을 찾을 수 없습니다. 원문을 새 파일로 저장하지 않았습니다.');
    } else if (previous || !createFiles) continue;
    if (write) throw new Error('파일로 저장한 메모는 한 번에 하나씩 바꿀 수 있습니다.');
    const body = await prepareBody(memo.text, file);
    const path = file?.path ?? newDocumentPath(memo.text, memo.documentFormat);
    if (!file) await assertPathAvailable(directory, path);
    const updated = { ...file, ...body, path };
    documents.bindings[memo.id] = descriptor(updated, false);
    annotate(memo, documents.bindings[memo.id], updated, payload);
    write = async () => {
      invalidateDocumentInventory(directory, path);
      if (file) await writeDocument(file.handle, body.bytes, file);
      else await createDocument(directory, updated, memo.id, documents);
    };
  }
  if (Object.keys(documents.bindings).length) payload.documents = documents.bindings;
  return write;
}

export function storeDocumentHandles(documents) {
  return rememberDocumentHandles(documents.handles).catch(() => {});
}

export async function suspendDocuments(payload) {
  await Promise.all(payload.state.memos.map(async memo => {
    if (memo.documentPath) payload.documents[memo.id].encryptedTextHash = await digest(encoder.encode(memo.text));
    clearDocumentFields(memo);
  }));
}

export async function resumeDocuments(payload) {
  if (!payload.documents) return;
  const memos = new Map(payload.state.memos.map(memo => [memo.id, memo]));
  await Promise.all(Object.entries(payload.documents).map(async ([id, binding]) => {
    const memo = memos.get(id);
    if (!memo) binding.removed = true;
    else if (binding.encryptedTextHash !== await digest(encoder.encode(memo.text))) delete payload.documents[id];
    delete binding.encryptedTextHash;
  }));
}
