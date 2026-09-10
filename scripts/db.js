export const DB_NAME = 'QuickShotDB';
export const DB_VERSION = 2;

export function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = req.result;
            const transaction = req.transaction;

            if (!db.objectStoreNames.contains('recordings')) {
                const store = db.createObjectStore('recordings', { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            } else if (event.oldVersion < 2) {
                // If upgrading from v1 where 'recordings' did not have keyPath: 'id'
                const oldStore = transaction.objectStore('recordings');
                const getReq = oldStore.get('latest');
                
                getReq.onsuccess = () => {
                    const legacyBlob = getReq.result;
                    db.deleteObjectStore('recordings');
                    const newStore = db.createObjectStore('recordings', { keyPath: 'id' });
                    newStore.createIndex('createdAt', 'createdAt', { unique: false });

                    if (legacyBlob && (legacyBlob instanceof Blob || legacyBlob.size)) {
                        const now = Date.now();
                        const legacyEntry = {
                            id: 'migrated_latest',
                            blob: legacyBlob,
                            createdAt: now,
                            duration: 0,
                            recordingType: 'desktop',
                            resolution: 'Unknown',
                            fps: 30,
                            audioEnabled: true,
                            micEnabled: false,
                            fileSize: legacyBlob.size || 0,
                            mimeType: legacyBlob.type || 'video/webm',
                            filename: 'QuickShot_Migrated_Recording.webm'
                        };
                        newStore.put(legacyEntry);
                    }
                };
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveRecordingEntry(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.put(entry);
        tx.oncomplete = () => {
            db.close();
            resolve(entry.id);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

export async function getAllRecordings() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readonly');
        const store = tx.objectStore('recordings');
        const req = store.getAll();
        req.onsuccess = () => {
            db.close();
            const results = (req.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            resolve(results);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

export async function getRecordingById(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readonly');
        const store = tx.objectStore('recordings');

        if (!id || id === 'latest') {
            const index = store.index('createdAt');
            const req = index.openCursor(null, 'prev');
            req.onsuccess = () => {
                const cursor = req.result;
                db.close();
                resolve(cursor ? cursor.value : null);
            };
            req.onerror = () => {
                db.close();
                reject(req.error);
            };
            return;
        }

        const req = store.get(id);
        req.onsuccess = () => {
            db.close();
            resolve(req.result || null);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

export async function deleteRecordingEntry(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.delete(id);
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

export async function renameRecordingEntry(id, newFilename) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const record = getReq.result;
            if (!record) {
                db.close();
                reject(new Error('Record not found'));
                return;
            }
            record.filename = newFilename;
            store.put(record);
        };
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}
