const DB_NAME = 'QuickShotDB';
const DB_VERSION = 1;

let videoBlob = null;
let objectUrl = null;

function formatFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const min = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `QuickShot_${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.webm`;
}

function loadRecording() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings');
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.close();
                resolve(null);
                return;
            }
            const tx = db.transaction('recordings', 'readonly');
            const store = tx.objectStore('recordings');
            const getReq = store.get('latest');
            getReq.onsuccess = () => {
                db.close();
                resolve(getReq.result);
            };
            getReq.onerror = () => {
                db.close();
                reject(getReq.error);
            };
        };
        req.onerror = () => reject(req.error);
    });
}

function clearRecording() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.close();
                resolve();
                return;
            }
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            store.delete('latest');
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        };
        req.onerror = () => reject(req.error);
    });
}

async function init() {
    try {
        videoBlob = await loadRecording();
        if (!videoBlob) {
            alert('No recording found!');
            return;
        }

        const videoEl = document.getElementById('preview-video');
        objectUrl = URL.createObjectURL(videoBlob);
        videoEl.src = objectUrl;

        document.getElementById('download-btn').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = formatFilename();
            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        document.getElementById('discard-btn').addEventListener('click', async () => {
            if (confirm('Are you sure you want to discard this recording?')) {
                await clearRecording();
                window.close();
            }
        });
    } catch (err) {
        console.error('Failed to load recording:', err);
        alert('Failed to load recording: ' + (err.message || String(err)));
    }
}

window.addEventListener('beforeunload', () => {
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }
});

init();
