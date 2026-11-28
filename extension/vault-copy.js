import { backupSnapshot } from './store.js';
import { digest, documentFormat, extensions, openDocuments, persistentDocuments } from './documents.js';
import { COPY_FORMAT, readVaultFile, writeVaultFile } from './folder.js';

const encoder = new TextEncoder();

function originalPath(binding) {
  const path = binding?.path;
  if (typeof path !== 'string' || !documentFormat(path)) return;
  if (path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\'))) return path;
}

function copyPaths(memos, bindings) {
  // Keep text that cannot round-trip through a UTF-8 document in the JSON record.
  const files = memos.filter(memo => !memo.text.includes('\0') && memo.text.isWellFormed());
  const paths = new Map();
  const used = new Set();
  for (const memo of files) {
    const path = originalPath(bindings?.[memo.id]);
    if (path) {
      paths.set(memo.id, path);
      used.add(path.split('/')[0].toLowerCase());
    }
  }
  let index = 0;
  for (const memo of files) {
    if (paths.has(memo.id)) continue;
    let path;
    do {
      path = '메모-' + (++index) + '.' + (extensions[memo.documentFormat] ?? 'md');
    } while (used.has(path.toLowerCase()));
    paths.set(memo.id, path);
    used.add(path.toLowerCase());
  }
  return paths;
}

async function copyDocument(directory, path, bytes, hash) {
  const segments = path.split('/');
  const name = segments.pop();
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable({ mode: 'exclusive' });
  try {
    const existing = await file.getFile();
    if (existing.size === bytes.length && await digest(await existing.arrayBuffer()) === hash) {
      await stream.abort();
      return;
    }
    if (existing.size) throw new Error('대상의 ' + path + ' 내용이 달라졌습니다. 다른 빈 폴더를 선택해 주세요.');
    await stream.write(bytes);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}

async function verify(directory, record, expected) {
  await openDocuments(directory, record.payload, true);
  if (record.payload.state.memos.some(memo => memo.documentMissing)
    || JSON.stringify(backupSnapshot(record.payload.state)) !== JSON.stringify(expected)) {
    throw new Error('대상 폴더에서 다시 읽은 메모나 답장이 원본과 다릅니다. 기존 암호화 저장소에서 다시 시도해 주세요.');
  }
}

export async function copySnapshot(source, target, encrypted, payload, checkSession) {
  if (await target.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('대상 폴더의 읽기와 쓰기를 허용하고 다시 시도해 주세요.');
  }
  if (await source.resolve(target) !== null || await target.resolve(source) !== null) {
    throw new Error('원본 폴더와 겹치지 않는 별도 폴더를 선택해 주세요.');
  }
  const state = backupSnapshot(payload.state);
  const paths = copyPaths(state.memos, payload.documents);
  const documents = Object.create(null);
  for (const memo of state.memos) {
    const path = paths.get(memo.id);
    if (path) memo.documentFormat = documentFormat(path);
  }
  const fingerprint = await digest(encoder.encode(JSON.stringify([encrypted.salt, state.memos, [...paths]])));
  const existing = await readVaultFile(target, true, true);
  checkSession();
  if (existing) {
    if (existing.copyFingerprint !== fingerprint) throw new Error('다른 기록이 있는 폴더입니다. 새 빈 폴더를 선택해 주세요.');
    if (existing.mode === 'plain') {
      await verify(target, existing, state);
      return;
    }
    if (existing.format !== COPY_FORMAT) throw new Error('빈 폴더를 선택해 주세요.');
  } else {
    if (!(await target.keys().next()).done) throw new Error('복사할 빈 폴더를 선택해 주세요.');
    await writeVaultFile(target, { format: COPY_FORMAT, copyFingerprint: fingerprint }, true);
  }
  for (const memo of state.memos) {
    checkSession();
    const path = paths.get(memo.id);
    if (!path) continue;
    // A UTF-8 BOM in the body needs its own encoding marker to survive decoding.
    const bytes = encoder.encode(memo.text.startsWith('\uFEFF') ? '\uFEFF' + memo.text : memo.text);
    const hash = await digest(bytes);
    await copyDocument(target, path, bytes, hash);
    documents[memo.id] = { path, hash, size: bytes.length };
  }
  const record = { format: 2, mode: 'plain', revision: 0, epoch: 0, copyFingerprint: fingerprint,
    payload: persistentDocuments({ state, documents, undo: payload.undo ?? null }) };
  await verify(target, structuredClone(record), state);
  const checkpoint = await readVaultFile(target, false, true);
  if (checkpoint.format !== COPY_FORMAT || checkpoint.copyFingerprint !== fingerprint) {
    throw new Error('복사 중 대상 저장 파일이 바뀌었습니다. 다른 빈 폴더를 선택해 주세요.');
  }
  checkSession();
  await writeVaultFile(target, record);
  await verify(target, await readVaultFile(target), state);
}
