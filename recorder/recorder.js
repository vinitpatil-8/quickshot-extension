const DB_NAME = 'QuickShotDB';
const DB_VERSION = 1;

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
    timerText.textContent = `${m}:${s}`;
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

async function getSettings() {
    try {
        return await chrome.storage.sync.get({ recordAudio: false });
    } catch (e) {
        return { recordAudio: false };
    }
}

async function handleStartCapture() {
    warningBox.style.display = 'none';
    warningBox.textContent = '';
    statusBox.textContent = 'Requesting screen capture permission...';

    const settings = await getSettings();

    // 1. Trigger getDisplayMedia (must be in user activation stack)
    let displayStream = null;
    try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });
    } catch (err) {
        const errFormatted = formatMediaError(err, "getDisplayMedia");
        if (err.name === 'NotAllowedError' || err.message.includes('Permission denied') || err.message.includes('user canceled')) {
            statusBox.textContent = 'Capture cancelled by user.';
        } else {
            statusBox.textContent = `Capture failed: ${errFormatted.formatted}`;
            console.error("getDisplayMedia error:", errFormatted);
        }
        return;
    }

    activeDisplayStream = displayStream;

    const videoTracks = displayStream.getVideoTracks();
    if (videoTracks.length === 0) {
        statusBox.textContent = 'Error: No video track returned by screen capture.';
        cleanupStreams();
        return;
    }
    const videoTrack = videoTracks[0];

    // 2. Microphone stream (optional)
    let micTrack = null;
    if (settings.recordAudio) {
        try {
            activeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micTracks = activeMicStream.getAudioTracks();
            if (micTracks.length > 0) {
                micTrack = micTracks[0];
            }
        } catch (micErr) {
            const formattedMicErr = formatMediaError(micErr, "Microphone Access");
            console.warn("Microphone access permission denied or unavailable:", formattedMicErr.formatted);
            warningBox.textContent = `Microphone notice (${formattedMicErr.name}): ${formattedMicErr.message}. Continuing recording without microphone audio.`;
            warningBox.style.display = 'block';
        }
    }

    // 3. System audio track from display capture
    const systemAudioTracks = displayStream.getAudioTracks();
    const systemAudioTrack = systemAudioTracks.length > 0 ? systemAudioTracks[0] : null;

    const finalTracks = [videoTrack];

    // 4. Mix or attach audio
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
    console.log("Selected MediaRecorder MIME type:", selectedMimeType || "Default");

    try {
        const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : {};
        recorder = new MediaRecorder(activeStream, recorderOptions);
    } catch (recInitErr) {
        const formattedRecErr = formatMediaError(recInitErr, "MediaRecorder Construction");
        statusBox.textContent = `Error creating recorder: ${formattedRecErr.formatted}`;
        cleanupStreams();
        return;
    }

    recordedChunks = [];

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    recorder.onerror = (e) => {
        const errFmt = formatMediaError(e.error || new Error("Recorder error"), "MediaRecorder Runtime");
        statusBox.textContent = `Recording error: ${errFmt.formatted}`;
    };

    recorder.onstop = async () => {
        statusBox.textContent = 'Finalizing and saving recording...';
        stopTimer();

        const mimeTypeHeader = recorder.mimeType || selectedMimeType || "video/webm";
        const blobType = mimeTypeHeader.split(";")[0] || "video/webm";
        const blob = new Blob(recordedChunks, { type: blobType });

        cleanupStreams();
        recordedChunks = [];

        try {
            await saveRecording(blob);
            statusBox.textContent = 'Recording saved! Opening preview...';
            window.location.href = chrome.runtime.getURL('preview/preview.html');
        } catch (saveErr) {
            const errFmt = formatMediaError(saveErr, "IndexedDB Save");
            statusBox.textContent = `Failed to save recording: ${errFmt.formatted}`;
        }
    };

    recorder.start();
    startTimer();

    statusBox.textContent = 'Recording in progress...';
    startBtn.classList.add('hidden');
    recordingControls.classList.remove('hidden');
}

function handlePauseResume() {
    if (!recorder) return;
    if (recorder.state === 'recording') {
        recorder.pause();
        isPaused = true;
        pauseBtn.textContent = 'Resume';
        recordingDot.style.animation = 'none';
        recordingDot.style.opacity = '0.5';
        statusBox.textContent = 'Recording paused';
    } else if (recorder.state === 'paused') {
        recorder.resume();
        isPaused = false;
        pauseBtn.textContent = 'Pause';
        recordingDot.style.animation = 'pulse 1.5s infinite';
        recordingDot.style.opacity = '1';
        statusBox.textContent = 'Recording in progress...';
    }
}

function handleStopCapture() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') {
        try {
            recorder.stop();
        } catch (e) {
            cleanupStreams();
        }
    } else {
        cleanupStreams();
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

    statusBox.textContent = 'Recording cancelled.';
    recordingControls.classList.add('hidden');
    startBtn.classList.remove('hidden');
}

startBtn.addEventListener('click', handleStartCapture);
pauseBtn.addEventListener('click', handlePauseResume);
stopBtn.addEventListener('click', handleStopCapture);
cancelBtn.addEventListener('click', handleCancelCapture);

// Check if auto-start parameter is passed in URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auto') === 'true') {
    handleStartCapture();
}
