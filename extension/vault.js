import { copySnapshot } from './vault-copy.js';
import { readVaultFile, writeVaultFile, unreadableVaultMessage, FolderAccessError } from './folder.js';
import { rememberFolder } from './last-folder.js';
import { legacySnapshot, removeMigratedProfile } from './legacy-profile.js';
import { backupSnapshot, emptyState, validateBackup } from './store.js';
import { deriveKey, seal, unseal } from './crypto.js';
import {
  invalidateDocumentInventory, openDocuments, persistentDocuments, prepareDocuments,
  relinkInPayload, rememberDocumentRevision, storeDocumentHandles
} from './documents.js';

export { DocumentConflictError, DocumentWriteError } from './documents.js';

export class LockedError extends Error {
  constructor() {
    super('저장소가 잠겨 있습니다. 잠금을 해제해 주세요.');
  }
}

let connection;
let session;
let generation = 0;
const MAX_WRITE_ATTEMPTS = 14;

function normalize(record) {
  if (record?.format === 2) return record;
  return { format: 2, revision: 0, epoch: 0, mode: 'plain', payload: { state: record ?? emptyState(), undo: null } };
}

const locationKey = Symbol('storage location');
const storageLock = 'jjokmun-storage';

export function folderConnection() {
  return connection;
}

async function fileRecord(connection) {
  if (await connection.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new FolderAccessError('메모를 열려면 저장 폴더의 읽기와 쓰기를 허용해 주세요.');
  }
  const record = await readVaultFile(connection.directory);
  record[locationKey] = connection.id;
  return record;
}

function access(write) {
  return navigator.locks.request(storageLock, { mode: write ? 'exclusive' : 'shared' }, async () => {
    if (!connection) throw new FolderAccessError('메모 저장 폴더를 선택해 주세요.');
    const current = await fileRecord(connection);
    if (!write) return current;
    let replacement;
    const result = await write(current, value => { replacement = value; }, connection.directory);
    if (replacement) await writeVaultFile(connection.directory, replacement);
    return result;
  });
}

export function useFolder(directory, { reopen = false, remember = true, copyCurrent = true } = {}) {
  const expected = generation;
  return navigator.locks.request(storageLock, async () => {
    if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new FolderAccessError('폴더의 읽기와 쓰기를 허용해 주세요.');
    }
    const previous = copyCurrent ? connection : undefined;
    const sameFolder = connection && await connection.directory.isSameEntry(directory);
    const existing = await readVaultFile(directory, !reopen && !sameFolder);
    if (existing) {
      if (existing.mode === 'plain') {
        try { validateBackup(existing.payload.state, { local: true }); }
        catch { throw new Error(unreadableVaultMessage(existing, '저장 파일의 메모 기록을 읽을 수 없습니다. 쪽문이 최신 버전인지 확인해 주세요.')); }
      }
    } else {
      const legacy = previous ? null : await legacySnapshot();
      let current = previous ? await fileRecord(previous) : normalize(legacy?.state);
      if (previous && current.mode === 'plain' && current.payload.documents) {
        await openDocuments(previous.directory, current.payload);
        const state = validateBackup(backupSnapshot(current.payload.state), { local: true });
        current = { ...current, payload: { state, undo: current.payload.undo } };
      } else if (previous && current.mode === 'encrypted') {
        throw new Error('일반 폴더로 복사를 선택한 뒤 대상 폴더를 지정해 주세요.');
      }
      assertGeneration(expected);
      const written = await writeVaultFile(directory, current, true);
      if (legacy) {
        if (legacy.state && JSON.stringify(await readVaultFile(directory)) !== written) {
          throw new Error('저장 파일을 확인하지 못했습니다. 이전 프로필의 기록을 유지합니다.');
        }
        assertGeneration(expected);
        await removeMigratedProfile(legacy);
      }
    }
    assertGeneration(expected);
    let saved = true;
    if (remember) {
      try { await rememberFolder(directory); }
      catch { saved = false; }
    }
    assertGeneration(expected);
    if (!sameFolder) {
      connection = { id: crypto.randomUUID(), directory };
      dropVaultKey();
    }
    return saved;
  });
}

export async function reconnectFolder() {
  if (connection && await connection.directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new FolderAccessError('저장 폴더의 읽기 및 쓰기를 허용해 주세요.');
  }
}

export function dropVaultKey() {
  if (connection) invalidateDocumentInventory(connection.directory);
  session = undefined;
  generation += 1;
}

function assertGeneration(expected) {
  if (generation !== expected) throw new LockedError();
}

function assertEpoch(current, record) {
  if (current[locationKey] !== record[locationKey] || current.epoch !== record.epoch || current.mode !== record.mode) throw new LockedError();
}

async function saveCompared(record, replacement, expected) {
  return access((current, put) => {
    assertGeneration(expected);
    assertEpoch(current, record);
    if (current.revision !== record.revision) return false;
    put(replacement);
    return true;
  });
}

export async function vaultStatus() {
  const record = await access();
  const locked = record.mode === 'encrypted' && (!session || (session.epoch !== record.epoch || session.location !== record[locationKey]));
  if (locked && session) dropVaultKey();
  return { mode: record.mode, locked };
}

export async function readPayload(change, { createFiles = true } = {}) {
  const expected = generation;
  for (let retry = 0; retry < MAX_WRITE_ATTEMPTS; retry += 1) {
    const record = await access();
    assertGeneration(expected);
    if (record.mode === 'plain') return plainPayload(change, expected, record, { createFiles });
    const active = session;
    if ((active && (active.location !== record[locationKey] || active.epoch !== record.epoch || record.mode !== 'encrypted'))
      || (record.mode === 'encrypted' && !active)) throw new LockedError();
    const payload = await unseal(record, active.key, 'vault');
    assertGeneration(expected);
    let revision = record.revision;
    if (change && change(payload.state, payload, revision) !== false) {
      const contents = await seal(payload, active.key, record.salt, 'vault');
      revision += 1;
      const replacement = { format: 2, revision, epoch: record.epoch, mode: record.mode, ...contents };
      if (!await saveCompared(record, replacement, expected)) continue;
    }
    assertEpoch(await access(), record);
    assertGeneration(expected);
    return { payload, revision };
  }
  throw new Error('다른 탭에서 저장 작업이 진행 중입니다. 다시 시도해 주세요.');
}

function plainPayload(change, expected, record, { createFiles, relink }) {
  return access(async (current, _put, directory) => {
    assertGeneration(expected);
    assertEpoch(current, record);
    const { payload } = current;
    const rollback = change && structuredClone(current);
    const documents = await openDocuments(directory, payload, !change || Boolean(relink), current.revision);
    assertGeneration(expected);
    let revision = current.revision + Number(documents.changed);
    const beforeUndo = payload.undo;
    const before = change && new Map(payload.state.memos.map(memo => [memo.id, { text: memo.text }]));
    const scanned = documents.changed ? persistentDocuments(payload) : null;
    let writeDocument;
    if (relink) {
      relinkInPayload(payload, documents, relink.id, relink.path);
      revision += 1;
    } else if (change && change(payload.state, payload, revision) !== false) {
      writeDocument = await prepareDocuments(directory, payload, documents, before, createFiles && payload.undo === beforeUndo);
      revision += 1;
    }
    if (revision > current.revision) {
      const stored = revision > current.revision + Number(documents.changed) ? persistentDocuments(payload) : scanned;
      assertGeneration(expected);
      // Commit identifiers and links before the document, so a sidecar failure cannot orphan a new file.
      await writeVaultFile(directory, { ...current, revision, payload: stored });
      if (writeDocument) {
        try {
          await writeDocument();
        } catch (error) {
          try { await writeVaultFile(directory, { ...rollback, revision: revision + 1 }); }
          catch { /* The next scan reconciles the prepared metadata with the document on disk. */ }
          throw error;
        }
      }
      await storeDocumentHandles(documents);
      rememberDocumentRevision(directory, revision);
    }
    assertGeneration(expected);
    return { payload, revision };
  });
}

export async function relinkDocument(id, path) {
  const expected = generation;
  const record = await access();
  if (record.mode !== 'plain') throw new LockedError();
  return plainPayload(undefined, expected, record, { relink: { id, path } });
}

export async function transact(change) {
  return (await readPayload(change, { createFiles: false })).payload.state;
}

export async function unlockVault(password) {
  if (!password || password.length > 256) throw new Error('저장소 비밀번호를 입력해 주세요.');
  const expected = generation;
  const record = await access();
  if (record.mode !== 'encrypted') return;
  const key = await deriveKey(password, record.salt);
  await unseal(record, key, 'vault');
  assertEpoch(await access(), record);
  assertGeneration(expected);
  session = { epoch: record.epoch, location: record[locationKey], key };
  generation += 1;
}

export function copyVaultToFolder(target) {
  const expected = generation;
  return access(async (record, _put, source) => {
    if (record.mode !== 'encrypted' || session?.epoch !== record.epoch || session.location !== record[locationKey]) throw new LockedError();
    const payload = await unseal(record, session.key, 'vault');
    await copySnapshot(source, target, record, payload, () => assertGeneration(expected));
    assertGeneration(expected);
  });
}

export async function lockVault() {
  dropVaultKey();
  return access((current, put) => {
    if (current.mode === 'encrypted') {
      put({ ...current, revision: current.revision + 1, epoch: current.epoch + 1 });
    }
  });
}
