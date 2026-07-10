let electronAPI;
let modal;
let closeBtn;
let summaryEl;
let statusEl;
let tableWrap;
let tableBody;
let chooseFolderBtn;
let applyBtn;
let cancelBtn;
let currentPlan = [];
let searchRoot = null;

function init(api) {
    electronAPI = api;
    cacheElements();
    bindEvents();

    if (electronAPI && typeof electronAPI.on === 'function') {
        electronAPI.on('open-relink-missing-audio', () => {
            openModal();
        });
    }
}

function cacheElements() {
    modal = document.getElementById('relinkMissingAudioModal');
    if (!modal) return;

    closeBtn = modal.querySelector('.close-button');
    summaryEl = document.getElementById('relinkMissingAudioSummary');
    statusEl = document.getElementById('relinkMissingAudioStatus');
    tableWrap = document.getElementById('relinkMissingAudioTableWrap');
    tableBody = document.getElementById('relinkMissingAudioTableBody');
    chooseFolderBtn = document.getElementById('relinkChooseFolderBtn');
    applyBtn = document.getElementById('relinkApplyBtn');
    cancelBtn = document.getElementById('relinkCancelBtn');
}

function bindEvents() {
    if (!modal) return;

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (chooseFolderBtn) chooseFolderBtn.addEventListener('click', chooseFolderAndPlan);
    if (applyBtn) applyBtn.addEventListener('click', applyMatches);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
}

function setStatus(message) {
    if (statusEl) statusEl.textContent = message || '';
}

function setSummary(message) {
    if (summaryEl) summaryEl.textContent = message || '';
}

function updateApplyButton() {
    if (!applyBtn) return;
    const readyCount = currentPlan.filter((entry) => entry.newPath).length;
    applyBtn.disabled = readyCount === 0;
    applyBtn.textContent = readyCount > 0
        ? `Apply ${readyCount} Relink${readyCount === 1 ? '' : 's'}`
        : 'Apply Relinks';
}

function formatPath(filePath) {
    if (!filePath) return '—';
    return filePath.length > 72 ? `…${filePath.slice(-69)}` : filePath;
}

function renderTable(plan) {
    currentPlan = Array.isArray(plan) ? plan.map((entry) => ({ ...entry })) : [];
    if (!tableBody || !tableWrap) return;

    tableBody.innerHTML = '';

    if (currentPlan.length === 0) {
        tableWrap.style.display = 'none';
        updateApplyButton();
        return;
    }

    tableWrap.style.display = 'block';

    currentPlan.forEach((entry, index) => {
        const row = document.createElement('tr');
        row.dataset.index = String(index);

        const cueCell = document.createElement('td');
        cueCell.textContent = entry.itemLabel
            ? `${entry.cueName} → ${entry.itemLabel}`
            : entry.cueName;

        const oldPathCell = document.createElement('td');
        oldPathCell.className = 'relink-path-cell';
        oldPathCell.title = entry.oldPath || '';
        oldPathCell.textContent = formatPath(entry.oldPath);

        const newPathCell = document.createElement('td');
        newPathCell.className = 'relink-path-cell';

        const statusCell = document.createElement('td');
        statusCell.className = `relink-status relink-status-${entry.status}`;

        if (entry.status === 'ambiguous' && entry.candidates?.length > 1) {
            const select = document.createElement('select');
            select.className = 'relink-candidate-select';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = `Choose (${entry.candidates.length} matches)`;
            select.appendChild(placeholder);

            entry.candidates.forEach((candidate) => {
                const option = document.createElement('option');
                option.value = candidate;
                option.textContent = formatPath(candidate);
                option.title = candidate;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                const selected = select.value;
                currentPlan[index].newPath = selected || null;
                currentPlan[index].status = selected ? 'matched' : 'ambiguous';
                newPathCell.textContent = selected ? formatPath(selected) : '—';
                newPathCell.title = selected || '';
                statusCell.textContent = selected ? 'Ready' : 'Ambiguous';
                statusCell.className = `relink-status relink-status-${selected ? 'matched' : 'ambiguous'}`;
                updateApplyButton();
            });

            newPathCell.appendChild(select);
            statusCell.textContent = 'Ambiguous';
        } else if (entry.newPath) {
            newPathCell.textContent = formatPath(entry.newPath);
            newPathCell.title = entry.newPath;
            statusCell.textContent = 'Ready';
        } else {
            newPathCell.textContent = '—';
            statusCell.textContent = entry.status === 'not_found' ? 'Not found' : 'Missing';
        }

        row.appendChild(cueCell);
        row.appendChild(oldPathCell);
        row.appendChild(newPathCell);
        row.appendChild(statusCell);
        tableBody.appendChild(row);
    });

    updateApplyButton();
}

async function scanMissing({ closeIfEmpty = false } = {}) {
    setStatus('Scanning workspace for missing audio…');
    if (!closeIfEmpty) {
        setSummary('');
        renderTable([]);
    }

    try {
        const result = await electronAPI.invoke('scan-missing-media');
        if (!result?.success) {
            setStatus(result?.error || 'Could not scan for missing media.');
            return null;
        }

        const count = result.missing?.length || 0;
        if (count === 0) {
            if (closeIfEmpty) {
                closeModal();
                return 0;
            }
            setSummary('All audio files in this workspace resolve correctly. Nothing to relink.');
            setStatus('');
            if (chooseFolderBtn) chooseFolderBtn.disabled = true;
            return 0;
        }

        setSummary(`${count} missing audio file${count === 1 ? '' : 's'} found. Choose a folder to search by filename.`);
        setStatus('');
        if (chooseFolderBtn) chooseFolderBtn.disabled = false;
        return count;
    } catch (error) {
        setStatus(`Scan failed: ${error.message}`);
        return null;
    }
}

async function chooseFolderAndPlan() {
    setStatus('Searching folder…');
    if (chooseFolderBtn) chooseFolderBtn.disabled = true;

    try {
        const result = await electronAPI.invoke('plan-relink-from-folder');
        if (result?.canceled) {
            setStatus('Folder selection canceled.');
            if (chooseFolderBtn) chooseFolderBtn.disabled = false;
            return;
        }
        if (!result?.success) {
            setStatus(result?.error || 'Could not plan relinks.');
            if (chooseFolderBtn) chooseFolderBtn.disabled = false;
            return;
        }

        searchRoot = result.searchRoot || null;
        const stats = result.stats || {};
        setSummary(
            `Searched: ${searchRoot || 'selected folder'}. `
            + `${stats.matched || 0} matched, ${stats.ambiguous || 0} ambiguous, ${stats.notFound || 0} not found.`
        );
        renderTable(result.plan || []);
        setStatus('');
    } catch (error) {
        setStatus(`Search failed: ${error.message}`);
    } finally {
        if (chooseFolderBtn) chooseFolderBtn.disabled = false;
    }
}

async function applyMatches() {
    const matches = currentPlan
        .filter((entry) => entry.newPath)
        .map((entry) => ({
            cueId: entry.cueId,
            kind: entry.kind,
            playlistItemId: entry.playlistItemId,
            newPath: entry.newPath
        }));

    if (matches.length === 0) return;

    setStatus('Applying relinks…');
    if (applyBtn) applyBtn.disabled = true;
    if (chooseFolderBtn) chooseFolderBtn.disabled = true;

    try {
        const result = await electronAPI.invoke('apply-relink-matches', matches);
        if (!result?.success) {
            setStatus(result?.error || 'Failed to apply relinks.');
            updateApplyButton();
            if (chooseFolderBtn) chooseFolderBtn.disabled = false;
            return;
        }

        const remaining = await scanMissing({ closeIfEmpty: true });
        if (remaining === 0) return;

        setSummary(`Updated ${result.appliedCount || 0} path${result.appliedCount === 1 ? '' : 's'}.`);
        setStatus('Some files are still missing. Save the workspace if prompted.');
    } catch (error) {
        setStatus(`Apply failed: ${error.message}`);
        updateApplyButton();
        if (chooseFolderBtn) chooseFolderBtn.disabled = false;
    }
}

async function openModal() {
    if (!modal) return;
    modal.style.display = 'flex';
    searchRoot = null;
    currentPlan = [];
    if (chooseFolderBtn) chooseFolderBtn.disabled = false;
    updateApplyButton();
    await scanMissing();
}

function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    setStatus('');
}

export {
    init,
    openModal
};
