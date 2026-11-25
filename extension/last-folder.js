const DATABASE = 'jjokmun-folders';
const STORE = 'folders';

export async function readLastFolder() {
  if ((await indexedDB.databases()).some(db => db.name === DATABASE)) return accessLastFolder();
}

export function rememberFolder(directory) {
  return accessLastFolder(directory);
}

function accessLastFolder(directory) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, directory ? 'readwrite' : 'readonly');
        const store = tx.objectStore(STORE);
        const request = directory ? store.put(directory, 'last') : store.get('last');
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}
