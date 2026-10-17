import { getAllRecordings, deleteRecordingEntry, renameRecordingEntry } from "../scripts/db.js";
import { sanitizeFilename, initTheme } from "../scripts/settings.js";

initTheme();

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
            <div class="empty-icon-wrap">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                    <line x1="7" y1="2" x2="7" y2="22"/>
                    <line x1="17" y1="2" x2="17" y2="22"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <line x1="2" y1="7" x2="7" y2="7"/>
                    <line x1="2" y1="17" x2="7" y2="17"/>
                    <line x1="17" y1="17" x2="22" y2="17"/>
                    <line x1="17" y1="7" x2="22" y2="7"/>
                </svg>
            </div>
            <h2>No recordings yet</h2>
            <p>Screen recordings captured from QuickShot will appear here automatically.</p>
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
        recording.audioEnabled ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Sys' : '',
        recording.micEnabled ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic' : '',
    ].filter(Boolean).join(' ') || '';

    card.innerHTML = `
        <div class="card-thumb" id="thumb-${recording.id}">
            <div class="thumb-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
            </div>
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
                <button class="card-btn btn-preview" data-id="${recording.id}" title="Preview / Play">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Play
                </button>
                <button class="card-btn btn-download" data-id="${recording.id}" title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
                <button class="card-btn btn-rename" data-id="${recording.id}" title="Rename">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="card-btn btn-delete" data-id="${recording.id}" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
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
