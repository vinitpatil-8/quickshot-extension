import { getAllRecordings, deleteRecordingEntry, renameRecordingEntry } from "../scripts/db.js";
import { sanitizeFilename } from "../scripts/settings.js";

let allRecordings = [];
let filterType = 'all';
let sortOrder = 'newest';
let searchQuery = '';
let objectUrls = new Map();

function formatDuration(seconds) {
    if (!seconds) return '0:00';
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
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getTypeLabel(type) {
    switch (type) {
        case 'tab': return 'Tab';
        case 'window': return 'Window';
        default: return 'Screen';
    }
}

function revokeAllUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

function getFilteredRecordings() {
    let list = [...allRecordings];

    if (filterType !== 'all') {
        list = list.filter(r => (r.recordingType || 'desktop') === filterType);
    }

    if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter(r => (r.filename || '').toLowerCase().includes(q));
    }

    if (sortOrder === 'newest') {
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    return list;
}

function renderEmpty() {
    const grid = document.getElementById('recordings-grid');
    const count = document.getElementById('recording-count');
    if (count) count.textContent = '0 recordings';
    grid.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🎬</div>
            <h2>No recordings yet</h2>
            <p>Start a screen recording from the QuickShot popup.</p>
            <button class="btn-start-recording" id="start-rec-btn">Start Recording</button>
        </div>
    `;
    const btn = document.getElementById('start-rec-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('recorder/recorder.html?auto=true') });
        });
    }
}

function createRecordingCard(recording) {
    const card = document.createElement('div');
    card.className = 'recording-card';
    card.dataset.id = recording.id;

    const typeLabel = getTypeLabel(recording.recordingType);
    const audioInfo = [
        recording.audioEnabled ? '🔊' : '',
        recording.micEnabled ? '🎙' : ''
    ].filter(Boolean).join(' ') || '';

    card.innerHTML = `
        <div class="card-thumb" id="thumb-${recording.id}">
            <div class="thumb-placeholder">🎥</div>
        </div>
        <div class="card-body">
            <div class="card-filename" title="${recording.filename || ''}">${recording.filename || 'Untitled'}</div>
            <div class="card-meta">
                <span class="type-badge type-${recording.recordingType || 'desktop'}">${typeLabel}</span>
                <span class="meta-item">${formatDuration(recording.duration)}</span>
                <span class="meta-item">${formatFileSize(recording.fileSize)}</span>
                ${audioInfo ? `<span class="meta-item">${audioInfo}</span>` : ''}
            </div>
            <div class="card-date">${formatDate(recording.createdAt)}</div>
            <div class="card-actions">
                <button class="card-btn btn-preview" data-id="${recording.id}" title="Preview">▶</button>
                <button class="card-btn btn-download" data-id="${recording.id}" title="Download">⬇</button>
                <button class="card-btn btn-rename" data-id="${recording.id}" title="Rename">✏</button>
                <button class="card-btn btn-delete" data-id="${recording.id}" title="Delete">🗑</button>
            </div>
        </div>
    `;

    return card;
}

async function renderRecordings() {
    const list = getFilteredRecordings();
    const grid = document.getElementById('recordings-grid');
    const count = document.getElementById('recording-count');

    if (count) count.textContent = `${allRecordings.length} recording${allRecordings.length !== 1 ? 's' : ''}`;

    if (list.length === 0) {
        renderEmpty();
        return;
    }

    grid.innerHTML = '';

    for (const recording of list) {
        const card = createRecordingCard(recording);
        grid.appendChild(card);

        // Generate thumbnail lazily
        const thumbEl = card.querySelector(`#thumb-${recording.id}`);
        if (thumbEl && recording.blob) {
            generateThumbnail(recording, thumbEl);
        }
    }
}

async function generateThumbnail(recording, thumbContainer) {
    try {
        const blobUrl = URL.createObjectURL(recording.blob);
        objectUrls.set(recording.id + '_thumb', blobUrl);

        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'metadata';
        video.src = blobUrl;

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.currentTime = Math.min(1, video.duration * 0.05);
            };
            video.onseeked = resolve;
            video.onerror = resolve;
            setTimeout(resolve, 3000); // timeout
        });

        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 135;
        const ctx = canvas.getContext('2d');
        if (ctx && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = document.createElement('img');
            img.src = canvas.toDataURL();
            img.alt = 'Preview';
            thumbContainer.innerHTML = '';
            thumbContainer.appendChild(img);
        }

        URL.revokeObjectURL(blobUrl);
        objectUrls.delete(recording.id + '_thumb');
    } catch (e) {
        console.warn('Thumbnail generation failed:', e);
    }
}

function handleCardAction(e) {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    const recording = allRecordings.find(r => r.id === id);
    if (!recording) return;

    if (btn.classList.contains('btn-preview')) {
        const url = chrome.runtime.getURL(`preview/preview.html?id=${encodeURIComponent(id)}`);
        chrome.tabs.create({ url });
    } else if (btn.classList.contains('btn-download')) {
        downloadRecording(recording);
    } else if (btn.classList.contains('btn-rename')) {
        handleRename(recording);
    } else if (btn.classList.contains('btn-delete')) {
        handleDelete(recording);
    }
}

async function downloadRecording(recording) {
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = recording.filename || 'QuickShot_Recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function handleRename(recording) {
    const currentName = recording.filename || 'QuickShot_Recording.webm';
    const dotIdx = currentName.lastIndexOf('.');
    const nameWithoutExt = dotIdx > 0 ? currentName.substring(0, dotIdx) : currentName;
    const ext = dotIdx > 0 ? currentName.substring(dotIdx) : '.webm';

    const newName = prompt('Rename recording:', nameWithoutExt);
    if (!newName || newName.trim() === nameWithoutExt) return;

    const sanitized = sanitizeFilename(newName.trim() + ext, recording.mimeType);
    try {
        await renameRecordingEntry(recording.id, sanitized);
        // Update in-memory
        const idx = allRecordings.findIndex(r => r.id === recording.id);
        if (idx !== -1) allRecordings[idx].filename = sanitized;
        renderRecordings();
    } catch (err) {
        alert('Failed to rename: ' + (err.message || String(err)));
    }
}

async function handleDelete(recording) {
    if (!confirm(`Delete "${recording.filename}"? This cannot be undone.`)) return;
    try {
        await deleteRecordingEntry(recording.id);
        allRecordings = allRecordings.filter(r => r.id !== recording.id);
        renderRecordings();
    } catch (err) {
        alert('Failed to delete: ' + (err.message || String(err)));
    }
}

async function loadAll() {
    try {
        allRecordings = await getAllRecordings();
    } catch (e) {
        console.error('Failed to load recordings:', e);
        allRecordings = [];
    }
    renderRecordings();
}

// Wire up filters
document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderRecordings();
});

document.getElementById('filter-type').addEventListener('change', (e) => {
    filterType = e.target.value;
    renderRecordings();
});

document.getElementById('sort-order').addEventListener('change', (e) => {
    sortOrder = e.target.value;
    renderRecordings();
});

// Wire up new recording button
document.getElementById('new-rec-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('recorder/recorder.html?auto=true') });
});

// Single event delegation for the recordings grid
document.getElementById('recordings-grid').addEventListener('click', handleCardAction);

window.addEventListener('beforeunload', revokeAllUrls);

loadAll();
