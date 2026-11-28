export const VAULT_FILE = 'jjokmun-vault.json';
// Undefined outside the extension (Node tests); then files are written without a version stamp.
export const APP_VERSION = globalThis.chrome?.runtime?.getManifest?.().version;

export class FolderAccessError extends Error {}

function newerThanApp(version) {
  if (typeof version !== 'string' || !APP_VERSION) return false;
  const parts = version.split('.');
  if (parts.length > 4 || parts.some(part => !/^(0|[1-9]\d{0,4})$/.test(part) || Number(part) > 65535)) return false;
  const theirs = parts.map(Number);
  const ours = APP_VERSION.split('.').map(Number);
  for (let index = 0; index < Math.max(theirs.length, ours.length); index++) {
    const difference = (theirs[index] || 0) - (ours[index] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

// Older releases reject data that newer ones write, so name the version gap when the file records it.
export function unreadableVaultMessage(record, fallback) {
  if (newerThanApp(record?.appVersion)) {
    return '이 저장 파일은 쪽문 ' + record.appVersion + '에서 저장되었습니다. 지금 쓰는 쪽문(' + APP_VERSION
      + ')을 업데이트한 뒤 다시 열어 주세요.';
  }
  return fallback;
}

export const COPY_FORMAT = 'jjokmun-folder-copy';

export async function readVaultFile(directory, optional = false, allowPendingCopy = false) {
  try {
    const handle = await directory.getFileHandle(VAULT_FILE);
    const file = await handle.getFile();
    const record = JSON.parse(await file.text());
    if (record?.format === COPY_FORMAT) {
      if (allowPendingCopy) return record;
      throw new Error('이 폴더는 아직 복사 중입니다. 기존 암호화 저장소를 열고 같은 대상 폴더를 다시 선택해 주세요.');
    }
    if (record?.format !== 2 || !Number.isSafeInteger(record.revision) || !Number.isSafeInteger(record.epoch)
      || !(record.mode === 'plain' && Array.isArray(record.payload?.state?.memos) && Array.isArray(record.payload?.state?.daily)
        && Array.isArray(record.payload?.state?.props) || record.mode === 'encrypted' && typeof record.salt === 'string'
        && typeof record.iv === 'string' && typeof record.ciphertext === 'string')) {
      throw new Error(unreadableVaultMessage(record, '쪽문 저장 파일의 형식을 확인해 주세요.'));
    }
    return record;
  } catch (error) {
    if (optional && error.name === 'NotFoundError') return null;
    if (error.name === 'NotAllowedError') throw new FolderAccessError('메모를 열려면 저장 폴더 접근을 다시 허용해 주세요.');
    if (error.name === 'NotFoundError') throw new FolderAccessError('선택한 폴더에서 ' + VAULT_FILE + ' 파일을 찾을 수 없습니다.');
    throw error;
  }
}

// Returns the written JSON text, which includes the appVersion stamp.
export async function writeVaultFile(directory, record, create = false) {
  const file = await directory.getFileHandle(VAULT_FILE, { create });
  const text = JSON.stringify(APP_VERSION ? { ...record, appVersion: APP_VERSION } : record);
  let writer;
  try {
    writer = await file.createWritable();
    await writer.write(text);
    await writer.close();
    return text;
  } catch (error) {
    if (writer) await writer.abort().catch(() => {});
    if (create) {
      // A failed first write may leave the newly created file empty.
      try {
        const entry = await directory.getFileHandle(VAULT_FILE);
        if (await entry.isSameEntry(file) && (await entry.getFile()).size === 0) await directory.removeEntry(VAULT_FILE);
      } catch { /* The original write error is the actionable failure. */ }
    }
    throw error;
  }
}

// Enumerate metadata only. Open the selected file on demand, including binary files.
export async function scanFiles(root, signal) {
  const files = [];
  const pending = [{ directory: root, prefix: '' }];
  let skipped = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const { directory, prefix } = pending.pop();
    try {
      for await (const [name, handle] of directory.entries()) {
        signal.throwIfAborted();
        const path = prefix + name;
        if (handle.kind === 'directory') pending.push({ directory: handle, prefix: path + '/' });
        else if (path !== VAULT_FILE) files.push({ path, handle });
      }
    } catch (error) {
      if (!prefix || signal.aborted) throw error;
      skipped++;
    }
  }
  const collator = new Intl.Collator('ko', { numeric: true });
  files.sort((a, b) => collator.compare(a.path, b.path));
  return { files, skipped };
}
