import { getRecordingById, getAllRecordings, deleteRecordingEntry } from "../scripts/db.js";
import { sanitizeFilename } from "../scripts/settings.js";

let videoBlob = null;
let objectUrl = null;
let currentRecording = null;

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(ts) {
    const d = new Date(ts || Date.now());
    return d.toLocaleString();
}

async function loadRecording(id) {
    if (id && id !== 'latest') {
        return getRecordingById(id);
    }
    // Fallback: load most recent
    return getRecordingById(null);
}

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const recordingId = urlParams.get('id');

    const container = document.getElementById('info-container');

    try {
        currentRecording = await loadRecording(recordingId);

        if (!currentRecording || !currentRecording.blob) {
            showError('No recording found. Please record something first.');
            return;
        }

        videoBlob = currentRecording.blob;
        const videoEl = document.getElementById('preview-video');
        objectUrl = URL.createObjectURL(videoBlob);
        videoEl.src = objectUrl;

        // Fill metadata panel
        const filenameEl = document.getElementById('meta-filename');
        const dateEl = document.getElementById('meta-date');
        const durationEl = document.getElementById('meta-duration');
        const sizeEl = document.getElementById('meta-size');
        const typeEl = document.getElementById('meta-type');
        const audioEl = document.getElementById('meta-audio');

        if (filenameEl) filenameEl.textContent = currentRecording.filename || 'Unknown';
        if (dateEl) dateEl.textContent = formatDate(currentRecording.createdAt);
        if (durationEl) durationEl.textContent = formatDuration(currentRecording.duration || 0);
        if (sizeEl) sizeEl.textContent = formatFileSize(currentRecording.fileSize);
        if (typeEl) typeEl.textContent = currentRecording.recordingType || 'Desktop';
        if (audioEl) audioEl.textContent = [
            currentRecording.audioEnabled ? '🔊 Audio' : '',
            currentRecording.micEnabled ? '🎙 Mic' : ''
        ].filter(Boolean).join(', ') || 'None';

        const filenameInput = document.getElementById('filename-input');
        if (filenameInput) {
            // Strip extension for editing
            const fn = currentRecording.filename || 'QuickShot_Recording.webm';
            const dotIdx = fn.lastIndexOf('.');
            filenameInput.value = dotIdx > 0 ? fn.substring(0, dotIdx) : fn;
        }

        document.getElementById('download-btn').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = currentRecording.filename || 'QuickShot_Recording.webm';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        document.getElementById('history-btn').addEventListener('click', () => {
            window.location.href = chrome.runtime.getURL('history/history.html');
        });

        document.getElementById('discard-btn').addEventListener('click', async () => {
            if (confirm('Are you sure you want to discard this recording? This cannot be undone.')) {
                try {
                    await deleteRecordingEntry(currentRecording.id);
                    if (objectUrl) {
                        URL.revokeObjectURL(objectUrl);
                        objectUrl = null;
                    }
                    const histUrl = chrome.runtime.getURL('history/history.html');
                    window.location.href = histUrl;
                } catch (err) {
                    alert('Failed to delete recording: ' + (err.message || String(err)));
                }
            }
        });

    } catch (err) {
        console.error('Failed to load recording:', err);
        showError('Failed to load recording: ' + (err.message || String(err)));
    }
}

function showError(msg) {
    const errorEl = document.getElementById('error-msg');
    if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }
}

window.addEventListener('beforeunload', () => {
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }
});

init();
