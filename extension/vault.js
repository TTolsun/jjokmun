import { readVaultFile, writeVaultFile, FolderAccessError, VAULT_FILE } from './folder.js';
import { emptyState, validateBackup } from './store.js';
import { deriveKey, newSalt, requireNewPassword, seal, unseal } from './crypto.js';

export class LockedError extends Error {
  constructor() {
    super('저장소가 잠겨 있습니다. 잠금을 해제해 주세요.');
  }
}

let database;
let session;
let generation = 0;
const MAX_WRITE_ATTEMPTS = 14;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('memo-alley', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('다른 jjokmun 탭을 모두 닫고 이 페이지를 새로고침해 주세요.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
        dropVaultKey();
      };
      if (blocked) {
        db.close();
        database = undefined;
      }
      else resolve(db);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  });
  return database;
}

function normalize(record) {
  if (record?.format === 2) return record;
  return { format: 2, revision: 0, epoch: 0, mode: 'plain', payload: { state: record ?? emptyState(), undo: null } };
}

async function profileAccess(write) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('data', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('data');
    const request = store.get('state');
    let result;
    let cause;
    request.onsuccess = () => {
      try {
        const current = normalize(request.result);
        result = write ? write(current, value => store.put(value, 'state')) : current;
      } catch (error) {
        cause = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(cause ?? transaction.error ?? new Error('저장 작업이 중단되었습니다.'));
  });
}

const locationKey = Symbol('storage location');
const storageLock = 'jjokmun-storage';

export async function folderConnection() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('data').objectStore('data').get('folder');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
    const connection = await folderConnection();
    if (!connection) return profileAccess(write);
    const current = await fileRecord(connection);
    if (!write) return current;
    let replacement;
    const result = write(current, value => { replacement = value; });
    if (replacement) await writeVaultFile(connection.directory, replacement);
    return result;
  });
}

export function useFolder(directory, { reopen = false } = {}) {
  const expected = generation;
  return navigator.locks.request(storageLock, async () => {
    const previous = await folderConnection();
    if (previous && await previous.directory.isSameEntry(directory)) return;
    let current;
    if (!previous) current = await profileAccess();
    else if (!reopen) current = await fileRecord(previous);
    assertGeneration(expected);
    const existing = await readVaultFile(directory, true);
    if (existing) {
      const state = current?.payload?.state;
      if (!previous && (current.mode === 'encrypted' || state.memos.length || state.props.length || state.shop || current.payload.undo)) {
        throw new Error('이 폴더에는 다른 쪽문 저장소가 있습니다. 현재 메모를 옮기려면 저장 파일이 없는 폴더를 선택해 주세요.');
      }
      if (existing.mode === 'plain') validateBackup(existing.payload.state);
    } else {
      if (!current) throw new Error('기존 ' + VAULT_FILE + ' 파일이 있는 폴더를 선택해 주세요.');
      await writeVaultFile(directory, current, true);
    }
    assertGeneration(expected);
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      store.put({ id: crypto.randomUUID(), directory }, 'folder');
      store.delete('state');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('폴더 연결을 저장하지 못했습니다.'));
    });
    dropVaultKey();
  });
}

export async function reconnectFolder() {
  const connection = await folderConnection();
  if (connection && await connection.directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new FolderAccessError('저장 폴더의 읽기 및 쓰기를 허용해 주세요.');
  }
}

export function dropVaultKey() {
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

export async function readPayload(change) {
  const expected = generation;
  for (let retry = 0; retry < MAX_WRITE_ATTEMPTS; retry += 1) {
    const record = await access();
    assertGeneration(expected);
    const active = session;
    if ((active && (active.location !== record[locationKey] || active.epoch !== record.epoch || record.mode !== 'encrypted'))
      || (record.mode === 'encrypted' && !active)) throw new LockedError();
    const payload = record.mode === 'plain' ? record.payload : await unseal(record, active.key, 'vault');
    assertGeneration(expected);
    let revision = record.revision;
    if (change && change(payload.state, payload, revision) !== false) {
      const contents = record.mode === 'plain' ? { payload } : await seal(payload, active.key, record.salt, 'vault');
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

export async function transact(change) {
  return (await readPayload(change)).payload.state;
}

export async function enableVault(password) {
  requireNewPassword(password);
  const expected = generation;
  const salt = newSalt();
  const key = await deriveKey(password, salt);
  for (let retry = 0; retry < MAX_WRITE_ATTEMPTS; retry += 1) {
    const record = await access();
    assertGeneration(expected);
    if (record.mode !== 'plain') throw new LockedError();
    const replacement = {
      format: 2, revision: record.revision + 1, epoch: record.epoch + 1, mode: 'encrypted',
      ...await seal(record.payload, key, salt, 'vault')
    };
    if (await saveCompared(record, replacement, expected)) {
      assertGeneration(expected);
      session = { epoch: replacement.epoch, location: record[locationKey], key };
      generation += 1;
      return;
    }
  }
  throw new Error('다른 탭에서 저장 중입니다. 다시 시도해 주세요.');
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

export async function disableVault(password) {
  const expected = generation;
  const first = await access();
  if (first.mode !== 'encrypted' || session?.epoch !== first.epoch) throw new LockedError();
  if (!password || password.length > 256) throw new Error('저장소 비밀번호를 입력해 주세요.');
  const key = await deriveKey(password, first.salt);
  for (let retry = 0; retry < MAX_WRITE_ATTEMPTS; retry += 1) {
    const record = await access();
    assertGeneration(expected);
    assertEpoch(record, first);
    const payload = await unseal(record, key, 'vault');
    const replacement = { format: 2, revision: record.revision + 1, epoch: record.epoch + 1, mode: 'plain', payload };
    if (await saveCompared(record, replacement, expected)) {
      assertGeneration(expected);
      dropVaultKey();
      return;
    }
  }
  throw new Error('다른 탭에서 저장 중입니다. 다시 시도해 주세요.');
}

export async function lockVault() {
  dropVaultKey();
  return access((current, put) => {
    if (current.mode === 'encrypted') {
      put({ ...current, revision: current.revision + 1, epoch: current.epoch + 1 });
    }
  });
}
