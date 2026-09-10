import { saveRecordingEntry } from "../scripts/db.js";
import { getQualityBps, formatRecordingFilename } from "../scripts/settings.js";

let state = "IDLE"; // IDLE, PREPARING, RECORDING, PAUSED, STOPPING, FINALIZING, ERROR
let recorder = null;
let recordedChunks = [];
let activeStream = null;
let activeMicStream = null;
let activeDesktopStream = null;
let activeAudioContext = null;
let activeAudioSources = [];
let startTime = 0;
let currentOptions = {};

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

    if (name === "NotAllowedError" || message.includes("Permission denied") || message.includes("user canceled")) {
        message = "Capture permission was denied or cancelled by user.";
    } else if (message.includes("QuotaExceededError") || name === "QuotaExceededError") {
        message = "Storage limit reached. Recording could not be saved. Please clear some history items.";
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
            try { source.disconnect(); } catch (e) { }
        });
        activeAudioSources = [];
    }

    if (activeAudioContext) {
        try {
            if (activeAudioContext.state !== "closed") {
                activeAudioContext.close();
            }
        } catch (e) { }
        activeAudioContext = null;
    }

    if (activeMicStream) {
        try {
            activeMicStream.getTracks().forEach(track => track.stop());
        } catch (e) { }
        activeMicStream = null;
    }

    if (activeDesktopStream) {
        try {
            activeDesktopStream.getTracks().forEach(track => track.stop());
        } catch (e) { }
        activeDesktopStream = null;
    }

    if (activeStream) {
        try {
            activeStream.getTracks().forEach(track => track.stop());
        } catch (e) { }
        activeStream = null;
    }
}

async function startRecording(streamId, options = {}) {
    if (state !== "IDLE") {
        const err = formatMediaError(new Error("Recording is already in progress"), "State Check");
        chrome.runtime.sendMessage({ type: "recording-error", error: err }).catch(() => { });
        return;
    }

    state = "PREPARING";
    currentOptions = options;
    cleanupStreams();

    let micTrack = null;

    // 1. Acquire Microphone if enabled in options
    if (options.recordMic) {
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
                warning: { message: "Microphone unavailable. Recording will continue with video and system audio." }
            }).catch(() => { });
        }
    }

    // 2. Acquire Desktop or Tab Stream
    let desktopStream = null;
    const mediaSourceType = options.captureType === 'tab' ? "tab" : "desktop";

    const videoConstraint = {
        mandatory: {
            chromeMediaSource: mediaSourceType,
            chromeMediaSourceId: streamId
        }
    };

    if (options.videoFps) {
        videoConstraint.mandatory.maxFrameRate = options.videoFps;
    }

    const fullConstraints = { video: videoConstraint };

    if (options.recordSystemAudio !== false) {
        fullConstraints.audio = {
            mandatory: {
                chromeMediaSource: mediaSourceType,
                chromeMediaSourceId: streamId
            }
        };
    }

    try {
        desktopStream = await navigator.mediaDevices.getUserMedia(fullConstraints);
    } catch (e) {
        if (fullConstraints.audio) {
            console.warn("Capture with audio failed. Retrying video-only capture...");
            const videoOnlyConstraints = { video: videoConstraint };
            try {
                desktopStream = await navigator.mediaDevices.getUserMedia(videoOnlyConstraints);
                chrome.runtime.sendMessage({
                    type: "recording-warning",
                    warning: { message: "System audio capture unavailable. Recording video-only." }
                }).catch(() => { });
            } catch (err2) {
                const finalErr = formatMediaError(err2, "Screen Video-Only Capture");
                cleanupStreams();
                state = "ERROR";
                chrome.runtime.sendMessage({ type: "recording-error", error: finalErr }).catch(() => { });
                state = "IDLE";
                return;
            }
        } else {
            const finalErr = formatMediaError(e, "Screen Capture");
            cleanupStreams();
            state = "ERROR";
            chrome.runtime.sendMessage({ type: "recording-error", error: finalErr }).catch(() => { });
            state = "IDLE";
            return;
        }
    }

    activeDesktopStream = desktopStream;

    const videoTracks = desktopStream.getVideoTracks();
    if (videoTracks.length === 0) {
        const noVideoErr = formatMediaError(new Error("No video track found in captured stream"), "Stream Inspection");
        cleanupStreams();
        state = "IDLE";
        chrome.runtime.sendMessage({ type: "recording-error", error: noVideoErr }).catch(() => { });
        return;
    }
    const videoTrack = videoTracks[0];

    const systemAudioTracks = desktopStream.getAudioTracks();
    const systemAudioTrack = systemAudioTracks.length > 0 ? systemAudioTracks[0] : null;

    const finalTracks = [videoTrack];

    // 3. Audio composition & mixing (only use AudioContext when BOTH system audio and mic are present)
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
            console.warn("Audio mixing failed, falling back to system audio or mic:", formatMediaError(mixErr).formatted);
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
        console.log("Desktop capture video track ended natively.");
        stopRecording();
    });

    const selectedMimeType = getSupportedMimeType();
    const videoBps = getQualityBps(options.videoQuality);

    try {
        const recorderOptions = {};
        if (selectedMimeType) recorderOptions.mimeType = selectedMimeType;
        if (videoBps) recorderOptions.videoBitsPerSecond = videoBps;

        recorder = new MediaRecorder(activeStream, recorderOptions);
    } catch (recorderInitErr) {
        const recErr = formatMediaError(recorderInitErr, "MediaRecorder Construction");
        cleanupStreams();
        state = "IDLE";
        chrome.runtime.sendMessage({ type: "recording-error", error: recErr }).catch(() => { });
        return;
    }

    recordedChunks = [];
    startTime = Date.now();

    recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    recorder.onerror = (event) => {
        const recRuntimeErr = formatMediaError(event.error || new Error("MediaRecorder runtime error"), "MediaRecorder Runtime");
        console.error("MediaRecorder error event:", recRuntimeErr.formatted);
        chrome.runtime.sendMessage({ type: "recording-error", error: recRuntimeErr }).catch(() => { });
    };

    recorder.onstop = async () => {
        if (state === "FINALIZING" || state === "IDLE") return;
        state = "FINALIZING";
        console.log("MediaRecorder stopped. Processing recording chunks...");

        const duration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const mimeTypeHeader = recorder.mimeType || selectedMimeType || "video/webm";
        const blobType = mimeTypeHeader.split(";")[0] || "video/webm";
        const blob = new Blob(recordedChunks, { type: blobType });

        cleanupStreams();
        recordedChunks = [];

        if (blob.size === 0) {
            const err = formatMediaError(new Error("Recording contains no video data."), "Validation");
            state = "IDLE";
            chrome.runtime.sendMessage({ type: "recording-error", error: err }).catch(() => { });
            return;
        }

        const videoSettings = videoTrack.getSettings ? videoTrack.getSettings() : {};
        const width = videoSettings.width || 1920;
        const height = videoSettings.height || 1080;
        const filename = formatRecordingFilename(new Date(), blobType);

        const recordingEntry = {
            id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            blob: blob,
            createdAt: Date.now(),
            duration: duration,
            recordingType: options.captureType || 'desktop',
            resolution: `${width}x${height}`,
            fps: options.videoFps || 30,
            audioEnabled: Boolean(systemAudioTrack),
            micEnabled: Boolean(micTrack),
            fileSize: blob.size,
            mimeType: mimeTypeHeader,
            filename: filename
        };

        try {
            await saveRecordingEntry(recordingEntry);
            state = "IDLE";
            chrome.runtime.sendMessage({ type: "recording-finished", id: recordingEntry.id }).catch(() => { });
        } catch (err) {
            const saveErr = formatMediaError(err, "IndexedDB Save");
            console.error("Failed to save recording blob:", saveErr.formatted);
            state = "IDLE";
            chrome.runtime.sendMessage({ type: "recording-error", error: saveErr }).catch(() => { });
        }
    };

    // 1-second timeslice for optimal RAM usage and chunk collection
    recorder.start(1000);
    state = "RECORDING";

    chrome.runtime.sendMessage({
        type: "recording-started",
        mimeType: selectedMimeType
    }).catch(() => { });
}

function stopRecording() {
    if (state !== "RECORDING" && state !== "PAUSED") {
        cleanupStreams();
        state = "IDLE";
        return;
    }

    state = "STOPPING";
    if (recorder && recorder.state !== "inactive") {
        try {
            recorder.stop();
        } catch (e) {
            console.error("Error stopping MediaRecorder:", e);
            cleanupStreams();
            state = "IDLE";
        }
    } else {
        cleanupStreams();
        state = "IDLE";
    }
}

function cancelRecording() {
    state = "STOPPING";
    if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null; // Prevent saving
        try {
            recorder.stop();
        } catch (e) { }
    }
    cleanupStreams();
    recordedChunks = [];
    state = "IDLE";
    chrome.runtime.sendMessage({ type: "recording-cancelled" }).catch(() => { });
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
                state = "PAUSED";
                chrome.runtime.sendMessage({ type: "recording-paused" }).catch(() => { });
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
                state = "RECORDING";
                chrome.runtime.sendMessage({ type: "recording-resumed" }).catch(() => { });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ error: formatMediaError(e, "Resume").formatted });
            }
        } else {
            sendResponse({ error: "Recorder is not currently paused" });
        }
        return true;
    }

    if (message.type === "toggle-pause-recording") {
        if (recorder) {
            if (recorder.state === "recording") {
                recorder.pause();
                state = "PAUSED";
                chrome.runtime.sendMessage({ type: "recording-paused" }).catch(() => { });
            } else if (recorder.state === "paused") {
                recorder.resume();
                state = "RECORDING";
                chrome.runtime.sendMessage({ type: "recording-resumed" }).catch(() => { });
            }
        }
        sendResponse({ success: true });
        return true;
    }
});
