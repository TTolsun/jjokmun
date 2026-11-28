// Construct the on-disk format written by older releases, then reopen it with the app.
async function seedEncryptedVault(page, password) {
  await page.evaluate(async password => {
    const { folderConnection, readPayload, unlockVault } = await import('./vault.js');
    const { readVaultFile, writeVaultFile } = await import('./folder.js');
    const { deriveKey, newSalt, seal } = await import('./crypto.js');
    const { digest, clearDocumentFields } = await import('./documents.js');
    const directory = folderConnection().directory;
    const { payload } = await readPayload();
    for (const memo of payload.state.memos) {
      if (memo.documentPath) payload.documents[memo.id].encryptedTextHash = await digest(new TextEncoder().encode(memo.text));
      clearDocumentFields(memo);
    }
    const record = await readVaultFile(directory);
    const salt = newSalt();
    const key = await deriveKey(password, salt);
    await writeVaultFile(directory, { format: 2, mode: 'encrypted', epoch: record.epoch + 1,
      revision: record.revision + 1, ...await seal(payload, key, salt, 'vault') });
    await unlockVault(password);
    window.dispatchEvent(new Event('focus'));
  }, password);
}

module.exports = { seedEncryptedVault };
