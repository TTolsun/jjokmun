// Read pre-folder installations only after the user selects a destination.
const NAME = 'memo-alley';

export async function legacySnapshot() {
  const info = (await indexedDB.databases()).find(db => db.name === NAME);
  if (!info) return null;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(NAME, info.version);
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('data');
      const record = tx.objectStore('data').get('state');
      tx.oncomplete = () => { db.close(); resolve({ version: db.version, state: record.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

export async function removeMigratedProfile(snapshot) {
  // An exclusive version change prevents an older tab from racing the final comparison.
  await new Promise((resolve, reject) => {
    const open = indexedDB.open(NAME, snapshot.version + 1);
    let blocked = false;
    open.onblocked = () => {
      blocked = true;
      reject(new Error('이전 버전의 쪽문 탭을 닫고 같은 폴더를 다시 선택해 주세요.'));
    };
    open.onupgradeneeded = () => {
      const tx = open.transaction;
      if (blocked) { tx.abort(); return; }
      const read = tx.objectStore('data').get('state');
      read.onsuccess = () => {
        if (JSON.stringify(read.result) !== JSON.stringify(snapshot.state)) tx.abort();
        else tx.objectStore('data').clear();
      };
    };
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(new Error('프로필 기록이 바뀌었습니다. 이전 탭을 닫고 빈 폴더를 선택해 주세요.'));
  });
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(NAME);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}
