const DATABASE = 'jjokmun-folders';
const STORE = 'folders';
const DOCUMENTS = 'documents';

export async function readLastFolder() {
  if ((await indexedDB.databases()).some(db => db.name === DATABASE)) return accessLastFolder();
}

export function rememberFolder(directory) {
  return accessLastFolder(directory);
}

function accessLastFolder(directory) {
  return access(STORE, Boolean(directory), store => directory ? store.put(directory, 'last') : store.get('last'));
}

export function readDocumentHandle(id) {
  return access(DOCUMENTS, false, store => store.get(id));
}

export function rememberDocumentHandles(entries) {
  if (!entries.length) return Promise.resolve();
  return access(DOCUMENTS, true, store => {
    for (const [id, handle] of entries) {
      if (handle) store.put(handle, id);
      else store.delete(id);
    }
  });
}

function access(name, write, operation) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 2);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      open.result.createObjectStore(DOCUMENTS);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(name, write ? 'readwrite' : 'readonly');
        const request = operation(tx.objectStore(name));
        tx.oncomplete = () => { db.close(); resolve(request?.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}
