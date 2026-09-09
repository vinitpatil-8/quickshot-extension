let recorder = null;
let recordedChunks = [];
let activeStream = null;
let activeMicStream = null;
let activeDesktopStream = null;
let activeAudioContext = null;
let activeAudioSources = [];

function formatMediaError(err, context = "") {
    if (!err) {
        return {
            name: "UnknownError",
            message: "Unknown error occurred",
            formatted: "UnknownError: Unknown error"
        };
    }
    
    let name = "Error";
    let message = "Unknown error";
    let stack = "";
    
    if (typeof err === "object") {
        name = err.name || err.constructor?.name || "Error";
        message = err.message || err.reason || String(err);
        stack = err.stack || "";
    } else {
        message = String(err);
    }

    let fullText = `${name}: ${message}`;
    if (context) {
        fullText += ` (${context})`;
    }
    
    return {
        name,
        message,
        stack,
        context,
        formatted: fullText
    };
}

function getSupportedMimeType() {
    const candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm;codecs=h264",
        "video/webm",
        "video/mp4"
    ];
    
    for (const type of candidates) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return "";
}

function cleanupStreams() {
    if (activeAudioSources.length > 0) {
        activeAudioSources.forEach(source => {
            try { source.disconnect(); } catch (e) {}
        });
        activeAudioSources = [];
    }

    if (activeAudioContext) {
        try {
            if (activeAudioContext.state !== "closed") {
                activeAudioContext.close();
            }
        } catch (e) {}
        activeAudioContext = null;
    }

    if (activeMicStream) {
        try {
            activeMicStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeMicStream = null;
    }

    if (activeDesktopStream) {
        try {
            activeDesktopStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeDesktopStream = null;
    }

    if (activeStream) {
        try {
            activeStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeStream = null;
    }
}

const DB_NAME = 'QuickShotDB';
const DB_VERSION = 1;

function saveRecording(blob) {
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
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            store.put(blob, 'latest');
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

async function startRecording(streamId, options = {}) {
    if (recorder && recorder.state !== "inactive") {
        const err = formatMediaError(new Error("Recording is already in progress"), "State Check");
        chrome.runtime.sendMessage({ type: "recording-error", error: err }).catch(() => {});
        return;
    }

    cleanupStreams();

    let micTrack = null;

    // 1. Acquire Microphone if requested
    if (options.audio) {
        try {
            activeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micTracks = activeMicStream.getAudioTracks();
            if (micTracks.length > 0) {
                micTrack = micTracks[0];
            }
        } catch (e) {
            const formattedErr = formatMediaError(e, "Microphone Access");
            console.warn("Microphone access failed, continuing without mic:", formattedErr.formatted);
            chrome.runtime.sendMessage({
                type: "recording-warning",
                warning: formattedErr
            }).catch(() => {});
        }
    }

    // 2. Acquire Desktop or Tab Stream
    let desktopStream = null;
    const mediaSourceType = options.captureType === 'tab' ? "tab" : "desktop";

    const fullConstraints = {
        audio: {
            mandatory: {
                chromeMediaSource: mediaSourceType,
                chromeMediaSourceId: streamId
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: mediaSourceType,
                chromeMediaSourceId: streamId
            }
        }
    };

    try {
        desktopStream = await navigator.mediaDevices.getUserMedia(fullConstraints);
    } catch (e) {
        const audioErr = formatMediaError(e, `${mediaSourceType} Audio Constraint`);
        console.warn(`${mediaSourceType} capture with audio constraint failed. Retrying video-only capture...`, audioErr.formatted);
        
        const videoOnlyConstraints = {
            video: {
                mandatory: {
                    chromeMediaSource: mediaSourceType,
                    chromeMediaSourceId: streamId
                }
            }
        };

        try {
            desktopStream = await navigator.mediaDevices.getUserMedia(videoOnlyConstraints);
        } catch (err2) {
            const finalErr = formatMediaError(err2, `${mediaSourceType} Video-Only Capture`);
            console.error(`Failed to start ${mediaSourceType} capture:`, finalErr.formatted);
            cleanupStreams();
            chrome.runtime.sendMessage({ type: "recording-error", error: finalErr }).catch(() => {});
            return;
        }
    }

    activeDesktopStream = desktopStream;

    const videoTracks = desktopStream.getVideoTracks();
    if (videoTracks.length === 0) {
        const noVideoErr = formatMediaError(new Error("No video track found in captured stream"), "Stream Inspection");
        cleanupStreams();
        chrome.runtime.sendMessage({ type: "recording-error", error: noVideoErr }).catch(() => {});
        return;
    }
    const videoTrack = videoTracks[0];

    const systemAudioTracks = desktopStream.getAudioTracks();
    const systemAudioTrack = systemAudioTracks.length > 0 ? systemAudioTracks[0] : null;

    const finalTracks = [videoTrack];

    // 3. Audio track composition & mixing
    if (micTrack && systemAudioTrack) {
        try {
            activeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (activeAudioContext.state === "suspended") {
                await activeAudioContext.resume();
            }
            const destination = activeAudioContext.createMediaStreamDestination();

            const micSource = activeAudioContext.createMediaStreamSource(new MediaStream([micTrack]));
            micSource.connect(destination);
            activeAudioSources.push(micSource);

            const sysSource = activeAudioContext.createMediaStreamSource(new MediaStream([systemAudioTrack]));
            sysSource.connect(destination);
            activeAudioSources.push(sysSource);

            const mixedAudioTrack = destination.stream.getAudioTracks()[0];
            if (mixedAudioTrack) {
                finalTracks.push(mixedAudioTrack);
            }
        } catch (mixErr) {
            const mixFormatted = formatMediaError(mixErr, "AudioContext Mixing");
            console.warn("Audio mixing failed, falling back to system audio or mic:", mixFormatted.formatted);
            if (systemAudioTrack) {
                finalTracks.push(systemAudioTrack);
            } else if (micTrack) {
                finalTracks.push(micTrack);
            }
        }
    } else if (systemAudioTrack) {
        finalTracks.push(systemAudioTrack);
    } else if (micTrack) {
        finalTracks.push(micTrack);
    }

    activeStream = new MediaStream(finalTracks);

    // Auto-stop recording if user stops sharing via Chrome native UI bar
    videoTrack.addEventListener('ended', () => {
        console.log("Desktop capture video track ended externally.");
        stopRecording();
    });

    const selectedMimeType = getSupportedMimeType();
    console.log("Selected MediaRecorder MIME type:", selectedMimeType || "Default");

    try {
        const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : {};
        recorder = new MediaRecorder(activeStream, recorderOptions);
    } catch (recorderInitErr) {
        const recErr = formatMediaError(recorderInitErr, "MediaRecorder Construction");
        console.error("Failed to create MediaRecorder:", recErr.formatted);
        cleanupStreams();
        chrome.runtime.sendMessage({ type: "recording-error", error: recErr }).catch(() => {});
        return;
    }

    recordedChunks = [];

    recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    recorder.onerror = (event) => {
        const recRuntimeErr = formatMediaError(event.error || new Error("MediaRecorder runtime error"), "MediaRecorder Runtime");
        console.error("MediaRecorder error event:", recRuntimeErr.formatted);
        chrome.runtime.sendMessage({ type: "recording-error", error: recRuntimeErr }).catch(() => {});
    };

    recorder.onstop = async () => {
        console.log("MediaRecorder stopped. Processing recording chunks...");
        const mimeTypeHeader = recorder.mimeType || selectedMimeType || "video/webm";
        const blobType = mimeTypeHeader.split(";")[0] || "video/webm";
        const blob = new Blob(recordedChunks, { type: blobType });

        cleanupStreams();
        recordedChunks = [];

        try {
            await saveRecording(blob);
            chrome.runtime.sendMessage({ type: "recording-finished" }).catch(() => {});
        } catch (err) {
            const saveErr = formatMediaError(err, "IndexedDB Save");
            console.error("Failed to save recording blob:", saveErr.formatted);
            chrome.runtime.sendMessage({ type: "recording-error", error: saveErr }).catch(() => {});
        }
    };

    recorder.start();
    chrome.runtime.sendMessage({
        type: "recording-started",
        mimeType: selectedMimeType
    }).catch(() => {});
}

function stopRecording() {
    if (recorder && recorder.state !== "inactive") {
        try {
            recorder.stop();
        } catch (e) {
            console.error("Error stopping MediaRecorder:", e);
            cleanupStreams();
        }
    } else {
        cleanupStreams();
    }
}

function cancelRecording() {
    if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null; // Do not save or emit finished
        try {
            recorder.stop();
        } catch (e) {}
    }
    cleanupStreams();
    recordedChunks = [];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== "offscreen") return;

    if (message.type === "start-recording") {
        startRecording(message.streamId, message.options)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                const formatted = formatMediaError(err, "startRecording");
                sendResponse({ error: formatted });
            });
        return true;
    }

    if (message.type === "stop-recording") {
        stopRecording();
        sendResponse({ success: true });
        return true;
    }

    if (message.type === "cancel-recording") {
        cancelRecording();
        sendResponse({ success: true });
        return true;
    }

    if (message.type === "pause-recording") {
        if (recorder && recorder.state === "recording") {
            try {
                recorder.pause();
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ error: formatMediaError(e, "Pause").formatted });
            }
        } else {
            sendResponse({ error: "Recorder is not currently recording" });
        }
        return true;
    }

    if (message.type === "resume-recording") {
        if (recorder && recorder.state === "paused") {
            try {
                recorder.resume();
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ error: formatMediaError(e, "Resume").formatted });
            }
        } else {
            sendResponse({ error: "Recorder is not currently paused" });
        }
        return true;
    }
});
