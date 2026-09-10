export const DEFAULT_SETTINGS = {
    theme: "system",
    autoCopy: false,
    autoDownload: false,
    recordSystemAudio: true,
    recordMic: false,
    videoQuality: "medium", // 'low', 'medium', 'high'
    videoFps: 30 // 30, 60
};

export async function getSettings() {
    try {
        const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        if (stored.recordAudio !== undefined && stored.recordMic === undefined) {
            stored.recordMic = Boolean(stored.recordAudio);
        }
        return { ...DEFAULT_SETTINGS, ...stored };
    } catch (error) {
        console.error("Failed to load settings:", error);
        return { ...DEFAULT_SETTINGS };
    }
}

export async function saveSetting(key, value) {
    try {
        await chrome.storage.sync.set({ [key]: value });
    } catch (error) {
        console.error(`Failed to save setting "${key}":`, error);
    }
}

export function getQualityBps(qualitySetting) {
    switch (qualitySetting) {
        case 'low':
            return 1000000; // 1 Mbps
        case 'high':
            return 6000000; // 6 Mbps
        case 'medium':
        default:
            return 2500000; // 2.5 Mbps
    }
}

export function formatRecordingFilename(date = new Date(), mimeType = "video/webm") {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    
    let ext = "webm";
    if (mimeType.includes("mp4")) {
        ext = "mp4";
    }
    return `QuickShot_${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.${ext}`;
}

export function sanitizeFilename(input, fallbackMime = "video/webm") {
    if (!input || typeof input !== "string") {
        return formatRecordingFilename(new Date(), fallbackMime);
    }
    let clean = input.trim().replace(/[/\\?%*:|"<>]/g, '_');
    if (!clean.includes('.')) {
        let ext = fallbackMime.includes("mp4") ? "mp4" : "webm";
        clean += `.${ext}`;
    }
    return clean;
}
