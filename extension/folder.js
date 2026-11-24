export const VAULT_FILE = 'jjokmun-vault.json';

export class FolderAccessError extends Error {}

export async function readVaultFile(directory, optional = false) {
  try {
    const handle = await directory.getFileHandle(VAULT_FILE);
    const file = await handle.getFile();
    const record = JSON.parse(await file.text());
    if (record?.format !== 2 || !Number.isSafeInteger(record.revision) || !Number.isSafeInteger(record.epoch)
      || !(record.mode === 'plain' && Array.isArray(record.payload?.state?.memos) && Array.isArray(record.payload?.state?.daily)
        && Array.isArray(record.payload?.state?.props) || record.mode === 'encrypted' && typeof record.salt === 'string'
        && typeof record.iv === 'string' && typeof record.ciphertext === 'string')) {
      throw new Error('쪽문 저장 파일의 형식을 확인해 주세요.');
    }
    return record;
  } catch (error) {
    if (optional && error.name === 'NotFoundError') return null;
    if (error.name === 'NotAllowedError') throw new FolderAccessError('메모를 열려면 저장 폴더 접근을 다시 허용해 주세요.');
    if (error.name === 'NotFoundError') throw new FolderAccessError('선택한 폴더에서 ' + VAULT_FILE + ' 파일을 찾을 수 없습니다.');
    throw error;
  }
}

export async function writeVaultFile(directory, record, create = false) {
  const file = await directory.getFileHandle(VAULT_FILE, { create });
  let writer;
  try {
    writer = await file.createWritable();
    await writer.write(JSON.stringify(record));
    await writer.close();
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
