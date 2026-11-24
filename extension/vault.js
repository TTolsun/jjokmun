import { readVaultFile, writeVaultFile, FolderAccessError, VAULT_FILE } from './folder.js';
import { legacySnapshot, removeMigratedProfile } from './legacy-profile.js';
import { emptyState, validateBackup } from './store.js';
import { deriveKey, newSalt, requireNewPassword, seal, unseal } from './crypto.js';

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
    const result = write(current, value => { replacement = value; });
    if (replacement) await writeVaultFile(connection.directory, replacement);
    return result;
  });
}

export function useFolder(directory, { reopen = false } = {}) {
  const expected = generation;
  return navigator.locks.request(storageLock, async () => {
    const previous = connection;
    if (previous && await previous.directory.isSameEntry(directory)) return;
    const existing = await readVaultFile(directory, true);
    if (existing) {
      if (existing.mode === 'plain') validateBackup(existing.payload.state, { local: true });
    } else {
      if (reopen) throw new Error('기존 ' + VAULT_FILE + ' 파일이 있는 폴더를 선택해 주세요.');
      const legacy = previous ? null : await legacySnapshot();
      const current = previous ? await fileRecord(previous) : normalize(legacy?.state);
      assertGeneration(expected);
      await writeVaultFile(directory, current, true);
      if (legacy) {
        if (legacy.state && JSON.stringify(await readVaultFile(directory)) !== JSON.stringify(current)) {
          throw new Error('저장 파일을 확인하지 못했습니다. 이전 프로필의 기록을 유지합니다.');
        }
        assertGeneration(expected);
        await removeMigratedProfile(legacy);
      }
    }
    assertGeneration(expected);
    connection = { id: crypto.randomUUID(), directory };
    dropVaultKey();
  });
}

export async function reconnectFolder() {
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
