import { saveRecordingEntry } from "../scripts/db.js";
import { getSettings, getQualityBps, formatRecordingFilename } from "../scripts/settings.js";

let state = "IDLE";
let recorder = null;
let recordedChunks = [];
let activeStream = null;
let activeMicStream = null;
let activeDisplayStream = null;
let activeAudioContext = null;
let activeAudioSources = [];

let timerInterval = null;
let seconds = 0;
let isPaused = false;
let startTime = 0;

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

    if (typeof err === "object") {
        name = err.name || err.constructor?.name || "Error";
        message = err.message || err.reason || String(err);
    } else {
        message = String(err);
    }

    if (name === "NotAllowedError" || message.includes("Permission denied") || message.includes("user canceled")) {
        message = "Capture permission was denied or cancelled by user.";
    }

    let fullText = `${name}: ${message}`;
    if (context) {
        fullText += ` (${context})`;
    }

    return {
        name,
        message,
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

    if (activeDisplayStream) {
        try {
            activeDisplayStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeDisplayStream = null;
    }

    if (activeStream) {
        try {
            activeStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeStream = null;
    }
}

const startBtn = document.getElementById('start-btn');
const statusBox = document.getElementById('status-box');
const warningBox = document.getElementById('warning-box');
const recordingControls = document.getElementById('recording-controls');
const timerText = document.getElementById('timer-text');
const recordingDot = document.getElementById('recording-dot');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const cancelBtn = document.getElementById('cancel-btn');

function updateTimerDisplay() {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    if (timerText) timerText.textContent = `${m}:${s}`;
}

function startTimer() {
    seconds = 0;
    isPaused = false;
    updateTimerDisplay();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!isPaused) {
            seconds++;
            updateTimerDisplay();
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

async function handleStartCapture() {
    if (state !== "IDLE") return;
    state = "PREPARING";

    if (warningBox) {
        warningBox.style.display = 'none';
        warningBox.textContent = '';
    }
    if (statusBox) statusBox.textContent = 'Requesting screen capture permission...';

    const settings = await getSettings();

    // 1. Trigger getDisplayMedia
    let displayStream = null;
    const videoConstraint = { video: true };
    if (settings.videoFps) {
        videoConstraint.video = { frameRate: settings.videoFps };
    }

    try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            ...videoConstraint,
            audio: settings.recordSystemAudio !== false
        });
    } catch (err) {
        const errFormatted = formatMediaError(err, "getDisplayMedia");
        if (statusBox) statusBox.textContent = errFormatted.message;
        state = "IDLE";
        return;
    }

    activeDisplayStream = displayStream;

    const videoTracks = displayStream.getVideoTracks();
    if (videoTracks.length === 0) {
        if (statusBox) statusBox.textContent = 'Error: No video track returned by screen capture.';
        cleanupStreams();
        state = "IDLE";
        return;
    }
    const videoTrack = videoTracks[0];

    // 2. Microphone stream
    let micTrack = null;
    if (settings.recordMic) {
        try {
            activeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micTracks = activeMicStream.getAudioTracks();
            if (micTracks.length > 0) {
                micTrack = micTracks[0];
            }
        } catch (micErr) {
            const formattedMicErr = formatMediaError(micErr, "Microphone Access");
            console.warn("Microphone access permission denied or unavailable:", formattedMicErr.formatted);
            if (warningBox) {
                warningBox.textContent = `Microphone notice: ${formattedMicErr.message}. Continuing recording without microphone audio.`;
                warningBox.style.display = 'block';
            }
        }
    }

    // 3. System audio track
    const systemAudioTracks = displayStream.getAudioTracks();
    const systemAudioTrack = systemAudioTracks.length > 0 ? systemAudioTracks[0] : null;

    const finalTracks = [videoTrack];

    // 4. Mix or attach audio (AudioContext mixing only when BOTH system audio and mic exist)
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
            console.warn("Audio mixing failed, attaching system audio or mic directly:", formatMediaError(mixErr).formatted);
            if (systemAudioTrack) finalTracks.push(systemAudioTrack);
            else if (micTrack) finalTracks.push(micTrack);
        }
    } else if (systemAudioTrack) {
        finalTracks.push(systemAudioTrack);
    } else if (micTrack) {
        finalTracks.push(micTrack);
    }

    activeStream = new MediaStream(finalTracks);

    // Auto stop if user clicks Chrome native "Stop sharing" bar
    videoTrack.addEventListener('ended', () => {
        console.log("Display capture video track ended externally.");
        handleStopCapture();
    });

    const selectedMimeType = getSupportedMimeType();
    const videoBps = getQualityBps(settings.videoQuality);

    try {
        const recorderOptions = {};
        if (selectedMimeType) recorderOptions.mimeType = selectedMimeType;
        if (videoBps) recorderOptions.videoBitsPerSecond = videoBps;

        recorder = new MediaRecorder(activeStream, recorderOptions);
    } catch (recInitErr) {
        const formattedRecErr = formatMediaError(recInitErr, "MediaRecorder Construction");
        if (statusBox) statusBox.textContent = `Error creating recorder: ${formattedRecErr.formatted}`;
        cleanupStreams();
        state = "IDLE";
        return;
    }

    recordedChunks = [];
    startTime = Date.now();

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    recorder.onerror = (e) => {
        const errFmt = formatMediaError(e.error || new Error("Recorder error"), "MediaRecorder Runtime");
        if (statusBox) statusBox.textContent = `Recording error: ${errFmt.formatted}`;
    };

    recorder.onstop = async () => {
        if (state === "FINALIZING" || state === "IDLE") return;
        state = "FINALIZING";
        if (statusBox) statusBox.textContent = 'Finalizing and saving recording...';
        stopTimer();

        const duration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const mimeTypeHeader = recorder.mimeType || selectedMimeType || "video/webm";
        const blobType = mimeTypeHeader.split(";")[0] || "video/webm";
        const blob = new Blob(recordedChunks, { type: blobType });

        cleanupStreams();
        recordedChunks = [];

        if (blob.size === 0) {
            if (statusBox) statusBox.textContent = 'Error: Recording is empty.';
            state = "IDLE";
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
            recordingType: 'desktop',
            resolution: `${width}x${height}`,
            fps: settings.videoFps || 30,
            audioEnabled: Boolean(systemAudioTrack),
            micEnabled: Boolean(micTrack),
            fileSize: blob.size,
            mimeType: mimeTypeHeader,
            filename: filename
        };

        try {
            await saveRecordingEntry(recordingEntry);
            state = "IDLE";
            if (statusBox) statusBox.textContent = 'Recording saved! Opening preview...';
            window.location.href = chrome.runtime.getURL(`preview/preview.html?id=${recordingEntry.id}`);
        } catch (saveErr) {
            const errFmt = formatMediaError(saveErr, "IndexedDB Save");
            state = "IDLE";
            if (statusBox) statusBox.textContent = `Failed to save recording: ${errFmt.formatted}`;
        }
    };

    recorder.start(1000);
    startTimer();
    state = "RECORDING";

    if (statusBox) statusBox.textContent = 'Recording in progress...';
    if (startBtn) startBtn.classList.add('hidden');
    if (recordingControls) recordingControls.classList.remove('hidden');
}

function handlePauseResume() {
    if (!recorder) return;
    if (recorder.state === 'recording') {
        recorder.pause();
        isPaused = true;
        state = "PAUSED";
        if (pauseBtn) pauseBtn.textContent = 'Resume';
        if (recordingDot) {
            recordingDot.style.animation = 'none';
            recordingDot.style.opacity = '0.5';
        }
        if (statusBox) statusBox.textContent = 'Recording paused';
    } else if (recorder.state === 'paused') {
        recorder.resume();
        isPaused = false;
        state = "RECORDING";
        if (pauseBtn) pauseBtn.textContent = 'Pause';
        if (recordingDot) {
            recordingDot.style.animation = 'pulse 1.5s infinite';
            recordingDot.style.opacity = '1';
        }
        if (statusBox) statusBox.textContent = 'Recording in progress...';
    }
}

function handleStopCapture() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') {
        try {
            recorder.stop();
        } catch (e) {
            cleanupStreams();
            state = "IDLE";
        }
    } else {
        cleanupStreams();
        state = "IDLE";
    }
}

function handleCancelCapture() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        try { recorder.stop(); } catch (e) {}
    }
    cleanupStreams();
    recordedChunks = [];
    state = "IDLE";

    if (statusBox) statusBox.textContent = 'Recording cancelled.';
    if (recordingControls) recordingControls.classList.add('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
}

if (startBtn) startBtn.addEventListener('click', handleStartCapture);
if (pauseBtn) pauseBtn.addEventListener('click', handlePauseResume);
if (stopBtn) stopBtn.addEventListener('click', handleStopCapture);
if (cancelBtn) cancelBtn.addEventListener('click', handleCancelCapture);

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auto') === 'true') {
    handleStartCapture();
}
