// Main UI waveform panel — stacked lanes for simultaneous playback, drag-to-resize.

let panelEl = null;
let displayEl = null;
let resizeHandleEl = null;
let titleEl = null;
let timeEl = null;
let panelCloseBtnEl = null;
let toolbarBtnEl = null;

/** @type {Map<string, { cue: object, wavesurfer: object|null, laneEl: HTMLElement, headerEl: HTMLElement, bodyEl: HTMLElement, timeEl: HTMLElement|null, lastRawTime: number, lastSyncAt: number }>} */
const lanes = new Map();

let idlePreviewCueId = null;
let isEnabled = true;
let panelHeight = 140;

let getAppConfigFn = null;
let savePartialConfigFn = null;
let getCueByIdFn = null;
let seekCueFn = null;
let setCueVolumeFn = null;
let prepareScrubFn = null;
let finishScrubFn = null;

const MIN_PANEL_HEIGHT = 72;
const MAX_PANEL_HEIGHT_RATIO = 0.55;
const MIN_LANE_BODY_HEIGHT = 44;
const PANEL_HEADER_HEIGHT = 52;
const LANE_HEADER_HEIGHT = 18;

function init(dependencies) {
    panelEl = document.getElementById('mainWaveformPanel');
    displayEl = document.getElementById('mainWaveformDisplay');
    resizeHandleEl = document.getElementById('mainWaveformResizeHandle');
    titleEl = document.getElementById('mainWaveformCueName');
    timeEl = document.getElementById('mainWaveformTime');
    panelCloseBtnEl = document.getElementById('mainWaveformToggleBtn');
    toolbarBtnEl = document.getElementById('mainWaveformToolbarBtn');

    getAppConfigFn = dependencies.getAppConfig;
    savePartialConfigFn = dependencies.savePartialConfig;
    getCueByIdFn = dependencies.getCueById;
    seekCueFn = dependencies.seekCue || null;
    setCueVolumeFn = dependencies.setCueVolume || null;
    prepareScrubFn = dependencies.prepareScrub || null;
    finishScrubFn = dependencies.finishScrubSeek || null;

    bindResizeHandle();
    bindHeaderControls();
    bindToolbarButton();

    const config = getAppConfigFn?.() || {};
    applyConfig(config);
}

function syncConfigCheckbox(enabled) {
    const checkbox = document.getElementById('configMainWaveformEnabled');
    if (checkbox) checkbox.checked = enabled;
}

function updateToolbarButtonState() {
    if (!toolbarBtnEl) return;
    toolbarBtnEl.classList.toggle('main-waveform-visible', isEnabled);
    toolbarBtnEl.classList.toggle('main-waveform-hidden', !isEnabled);
    toolbarBtnEl.title = isEnabled
        ? 'Hide waveform panel below cue grid'
        : 'Show waveform panel below cue grid';
}

function setPanelVisible(enabled, persistConfig = true) {
    isEnabled = enabled;
    if (panelEl) {
        panelEl.classList.toggle('hidden', !enabled);
        if (enabled) setPanelHeight(panelHeight);
    }
    updateToolbarButtonState();
    syncConfigCheckbox(enabled);
    if (persistConfig && savePartialConfigFn) {
        savePartialConfigFn({ mainWaveformEnabled: enabled });
    }
    if (enabled && idlePreviewCueId && lanes.size === 0 && getCueByIdFn) {
        const cue = getCueByIdFn(idlePreviewCueId);
        if (cue) showForCue(cue);
    }
}

function togglePanel() {
    setPanelVisible(!isEnabled);
}

function applyConfig(config = {}) {
    isEnabled = config.mainWaveformEnabled !== false;
    panelHeight = clampPanelHeight(config.mainWaveformHeight || 140);
    if (!panelEl) return;
    panelEl.classList.toggle('hidden', !isEnabled);
    if (isEnabled) setPanelHeight(panelHeight);
    updateToolbarButtonState();
    syncConfigCheckbox(isEnabled);
}

function clampPanelHeight(height) {
    const mainContent = document.getElementById('mainContent');
    const maxHeight = mainContent
        ? Math.max(MIN_PANEL_HEIGHT, Math.floor(mainContent.clientHeight * MAX_PANEL_HEIGHT_RATIO))
        : 400;
    return Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, height));
}

function ensureLanesRoot() {
    if (!displayEl) return null;
    let root = displayEl.querySelector('.main-waveform-lanes');
    if (!root) {
        displayEl.innerHTML = '';
        root = document.createElement('div');
        root.className = 'main-waveform-lanes';
        displayEl.appendChild(root);
    }
    return root;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function updatePanelHeader() {
    if (!titleEl || !timeEl) return;
    const count = lanes.size;

    if (count === 0) {
        if (idlePreviewCueId && getCueByIdFn) {
            const cue = getCueByIdFn(idlePreviewCueId);
            titleEl.textContent = cue?.name || 'Waveform';
        } else {
            titleEl.textContent = 'Waveform';
        }
        timeEl.style.display = idlePreviewCueId ? '' : 'none';
        return;
    }

    if (count === 1) {
        const lane = lanes.values().next().value;
        titleEl.textContent = lane.cue?.name || 'Cue';
        timeEl.style.display = '';
        return;
    }

    titleEl.textContent = `${count} cues playing`;
    timeEl.style.display = 'none';
}

function updateMainTimeLabels(currentTimeSec, totalDurationSec) {
    if (!timeEl || lanes.size !== 1) return;
    timeEl.textContent = `${formatTime(currentTimeSec)} / ${formatTime(totalDurationSec)}`;
}

function syncLanesLayout() {
    if (!displayEl) return;
    const count = Math.max(lanes.size, 1);
    const available = Math.max(MIN_LANE_BODY_HEIGHT, panelHeight - PANEL_HEADER_HEIGHT);
    const showLaneHeaders = lanes.size > 0;
    const laneHeaderTotal = showLaneHeaders ? LANE_HEADER_HEIGHT : 0;
    const perLaneBody = Math.max(MIN_LANE_BODY_HEIGHT, Math.floor(available / count) - laneHeaderTotal);

    lanes.forEach((lane) => {
        if (lane.headerEl) {
            lane.headerEl.style.display = showLaneHeaders ? 'flex' : 'none';
            const laneTimeEl = lane.headerEl.querySelector('.main-waveform-lane-time');
            if (laneTimeEl) {
                laneTimeEl.style.display = lanes.size > 1 ? '' : 'none';
            }
        }
        if (lane.bodyEl) {
            lane.bodyEl.style.height = `${perLaneBody}px`;
        }
        if (lane.wavesurfer && typeof lane.wavesurfer.setOptions === 'function') {
            try {
                lane.wavesurfer.setOptions({ height: perLaneBody });
            } catch (error) {
                console.warn('MainWaveformPanel: Could not resize lane:', error);
            }
        }
    });

    displayEl.classList.toggle('multi-lane', lanes.size > 1);
    displayEl.classList.toggle('has-lanes', lanes.size > 0);
}

function setPanelHeight(height) {
    if (!panelEl) return;
    panelHeight = clampPanelHeight(height);
    panelEl.style.height = `${panelHeight}px`;
    panelEl.style.flexBasis = `${panelHeight}px`;
    if (displayEl) {
        displayEl.style.height = `${Math.max(48, panelHeight - PANEL_HEADER_HEIGHT)}px`;
    }
    syncLanesLayout();
}

function destroyLaneWavesurfer(lane) {
    if (lane?.wavesurfer) {
        try {
            lane.wavesurfer.destroy();
        } catch (error) {
            console.warn('MainWaveformPanel: Error destroying lane waveform:', error);
        }
        lane.wavesurfer = null;
    }
}

function removeLane(cueId) {
    const lane = lanes.get(cueId);
    if (!lane) return;

    destroyLaneWavesurfer(lane);
    lane.laneEl?.remove();
    lanes.delete(cueId);

    if (lanes.size === 0 && displayEl) {
        displayEl.innerHTML = '';
        displayEl.classList.remove('multi-lane');
    }

    syncLanesLayout();
    updatePanelHeader();
}

function clearAllLanes() {
    [...lanes.keys()].forEach(removeLane);
}

function createLane(cue) {
    if (!cue?.filePath || cue.type === 'playlist') return null;

    const root = ensureLanesRoot();
    if (!root) return null;

    const laneEl = document.createElement('div');
    laneEl.className = 'main-waveform-lane';
    laneEl.dataset.cueId = cue.id;

    const headerEl = document.createElement('div');
    headerEl.className = 'main-waveform-lane-header';
    headerEl.innerHTML = `
        <span class="main-waveform-lane-name"></span>
        <span class="main-waveform-lane-controls">
            <input type="range" class="main-waveform-lane-volume" min="0" max="100" step="1" title="Volume">
            <span class="main-waveform-lane-time"></span>
        </span>
    `;
    headerEl.querySelector('.main-waveform-lane-name').textContent = cue.name || 'Cue';
    const laneTimeEl = headerEl.querySelector('.main-waveform-lane-time');
    const laneVolumeEl = headerEl.querySelector('.main-waveform-lane-volume');
    if (laneVolumeEl) {
        const volPct = Math.round((cue.volume !== undefined ? cue.volume : 1) * 100);
        laneVolumeEl.value = String(volPct);
        laneVolumeEl.addEventListener('input', (event) => {
            event.stopPropagation();
            if (!setCueVolumeFn) return;
            setCueVolumeFn(cue.id, parseInt(laneVolumeEl.value, 10) / 100, { persist: true });
        });
        laneVolumeEl.addEventListener('mousedown', (event) => event.stopPropagation());
        laneVolumeEl.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'main-waveform-lane-body';

    laneEl.appendChild(headerEl);
    laneEl.appendChild(bodyEl);
    root.appendChild(laneEl);

    const lane = {
        cue,
        wavesurfer: null,
        laneEl,
        headerEl,
        bodyEl,
        timeEl: laneTimeEl,
        volumeEl: laneVolumeEl,
        lastRawTime: -1,
        lastSyncAt: 0,
        isUserSeeking: false,
        userSeekingTimeout: null
    };
    lanes.set(cue.id, lane);

    const bodyHeight = Math.max(MIN_LANE_BODY_HEIGHT, panelHeight - PANEL_HEADER_HEIGHT);
    bodyEl.style.height = `${bodyHeight}px`;

    try {
        lane.wavesurfer = WaveSurfer.create({
            container: bodyEl,
            waveColor: '#4F46E5',
            progressColor: '#7C3AED',
            cursorColor: '#EF4444',
            barWidth: 2,
            barRadius: 3,
            responsive: true,
            height: bodyHeight,
            normalize: true,
            backend: 'WebAudio',
            mediaControls: false,
            interact: true
        });

        const markLaneUserSeeking = () => {
            lane.isUserSeeking = true;
            clearTimeout(lane.userSeekingTimeout);
            lane.userSeekingTimeout = setTimeout(() => {
                lane.isUserSeeking = false;
            }, 600);
        };

        const clearLaneUserSeeking = () => {
            clearTimeout(lane.userSeekingTimeout);
            lane.userSeekingTimeout = null;
            lane.isUserSeeking = false;
        };

        const releaseLaneUserSeeking = () => {
            clearTimeout(lane.userSeekingTimeout);
            lane.userSeekingTimeout = setTimeout(() => {
                lane.isUserSeeking = false;
            }, 80);
        };

        const resetLanePlayheadSync = () => {
            lane.lastRawTime = -1;
            lane.lastSyncAt = 0;
        };

        const seekAtClientX = (clientX, options = {}) => {
            if (!seekCueFn) return;
            const duration = lane.wavesurfer.getDuration();
            if (!duration) return;
            const rect = bodyEl.getBoundingClientRect();
            if (!rect.width) return;
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            if (!options.finalizeScrub) {
                markLaneUserSeeking();
            }
            lane.wavesurfer.seekTo(ratio);
            seekCueFn(cue.id, ratio * duration, {
                ...options,
                skipScrubMute: true
            });
            if (options.finalizeScrub) {
                resetLanePlayheadSync();
                clearLaneUserSeeking();
            }
        };

        let activePointerId = null;
        bodyEl.style.touchAction = 'none';
        bodyEl.style.cursor = 'pointer';

        bodyEl.addEventListener('pointerdown', (event) => {
            if (activePointerId != null) return;
            event.preventDefault();
            activePointerId = event.pointerId;
            markLaneUserSeeking();
            if (prepareScrubFn) {
                prepareScrubFn(cue.id);
            }
            try {
                bodyEl.setPointerCapture(event.pointerId);
            } catch (e) { /* ignore */ }
        });

        bodyEl.addEventListener('pointermove', (event) => {
            if (event.pointerId !== activePointerId) return;
            event.preventDefault();
            seekAtClientX(event.clientX, { finalizeScrub: false, coalesceMs: 60 });
        });

        const finishLanePointer = (event) => {
            if (event.pointerId !== activePointerId) return;
            seekAtClientX(event.clientX, { finalizeScrub: true });
            releaseLaneUserSeeking();
            activePointerId = null;
            try {
                bodyEl.releasePointerCapture(event.pointerId);
            } catch (e) { /* ignore */ }
        };

        bodyEl.addEventListener('pointerup', finishLanePointer);
        bodyEl.addEventListener('pointercancel', finishLanePointer);
        bodyEl.addEventListener('lostpointercapture', (event) => {
            if (event.pointerId !== activePointerId) return;
            finishLanePointer(event);
        });

        lane.wavesurfer.on('ready', () => {
            const duration = lane.wavesurfer.getDuration();
            const trimStart = cue.trimStartTime || 0;
            if (duration > 0 && trimStart > 0) {
                lane.wavesurfer.seekTo(Math.min(1, trimStart / duration));
            }
            if (lanes.size === 1) {
                updateMainTimeLabels(0, duration);
            } else if (lane.timeEl) {
                lane.timeEl.textContent = `0:00 / ${formatTime(duration)}`;
            }
        });

        lane.wavesurfer.load(cue.filePath);
    } catch (error) {
        console.error('MainWaveformPanel: Failed to create lane waveform:', error);
    }

    syncLanesLayout();
    updatePanelHeader();
    return lane;
}

function syncLanePlayhead(cueId, payload) {
    const lane = lanes.get(cueId);
    if (!lane?.wavesurfer || lane.isUserSeeking) return;

    const cue = lane.cue;
    const {
        currentTimeSec = 0,
        totalDurationSec = 0,
        status = 'stopped',
        trimStartTime = cue?.trimStartTime || 0,
        filePath = null
    } = payload;

    if (filePath && cue?.filePath && filePath !== cue.filePath) return;

    const fullDuration = lane.wavesurfer.getDuration();
    if (!fullDuration || fullDuration <= 0 || isNaN(fullDuration)) return;

    if (status === 'stopped') {
        lane.lastRawTime = -1;
        const startRatio = Math.min(1, Math.max(0, (trimStartTime || 0) / fullDuration));
        lane.wavesurfer.seekTo(startRatio);
        if (lanes.size === 1) {
            updateMainTimeLabels(0, totalDurationSec);
        } else if (lane.timeEl) {
            lane.timeEl.textContent = `0:00 / ${formatTime(totalDurationSec)}`;
        }
        return;
    }

    if (status !== 'playing' && status !== 'paused' && status !== 'paused_seek' && status !== 'fading') return;

    const rawTime = (trimStartTime || 0) + Math.max(0, currentTimeSec);
    const now = performance.now();

    if (lane.volumeEl && document.activeElement !== lane.volumeEl) {
        const vol = typeof payload?.volume === 'number' ? payload.volume : (cue?.volume ?? 1);
        lane.volumeEl.value = String(Math.round(Math.max(0, Math.min(1, vol)) * 100));
    }

    if (Math.abs(rawTime - lane.lastRawTime) < 0.03 && now - lane.lastSyncAt < 50) {
        return;
    }
    lane.lastRawTime = rawTime;
    lane.lastSyncAt = now;

    lane.wavesurfer.seekTo(Math.min(1, Math.max(0, rawTime / fullDuration)));

    if (lanes.size === 1) {
        updateMainTimeLabels(currentTimeSec, totalDurationSec);
    } else if (lane.timeEl) {
        lane.timeEl.textContent = `${formatTime(currentTimeSec)} / ${formatTime(totalDurationSec)}`;
    }
}

function handlePlaybackUpdate(cueId, payload, cue) {
    if (!isEnabled || !panelEl || !displayEl) return;
    if (!cue || cue.type === 'playlist' || !cue.filePath) return;

    const status = payload?.status || 'stopped';
    const isActive = status === 'playing' || status === 'paused' || status === 'paused_seek' || status === 'fading';

    panelEl.classList.remove('hidden');

    if (isActive) {
        idlePreviewCueId = null;
        if (!lanes.has(cueId)) {
            createLane(cue);
        } else {
            lanes.get(cueId).cue = cue;
        }
        syncLanePlayhead(cueId, {
            ...payload,
            trimStartTime: cue.trimStartTime || 0,
            filePath: cue.filePath
        });
        updatePanelHeader();
        return;
    }

    if (status === 'stopped' && lanes.has(cueId)) {
        removeLane(cueId);
        if (lanes.size === 0) {
            idlePreviewCueId = null;
        }
    }
}

function showForCue(cue) {
    if (!isEnabled || !panelEl || !displayEl) return;
    if (!cue || cue.type === 'playlist' || !cue.filePath) return;

    if (lanes.size > 0) return;

    panelEl.classList.remove('hidden');
    clearAllLanes();
    idlePreviewCueId = cue.id;
    createLane(cue);
    updateMainTimeLabels(0, cue.knownDuration || 0);
}

function bindResizeHandle() {
    if (!resizeHandleEl || !panelEl) return;

    resizeHandleEl.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = panelEl.offsetHeight;

        const onMouseMove = (moveEvent) => {
            setPanelHeight(startHeight + (startY - moveEvent.clientY));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.classList.remove('main-waveform-resizing');
            if (savePartialConfigFn) {
                savePartialConfigFn({ mainWaveformHeight: panelHeight });
            }
        };

        document.body.classList.add('main-waveform-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function bindHeaderControls() {
    panelCloseBtnEl?.addEventListener('click', () => setPanelVisible(false));
}

function bindToolbarButton() {
    toolbarBtnEl?.addEventListener('click', togglePanel);
}

function getDisplayedCueId() {
    if (lanes.size === 1) return lanes.keys().next().value;
    return idlePreviewCueId;
}

function isPanelEnabled() {
    return isEnabled;
}

/** @deprecated use handlePlaybackUpdate */
function syncPlayheadFromPlayback(payload) {
    if (!payload?.cueId || !getCueByIdFn) return;
    const cue = getCueByIdFn(payload.cueId);
    if (cue) handlePlaybackUpdate(payload.cueId, payload, cue);
}

export {
    init,
    applyConfig,
    showForCue,
    handlePlaybackUpdate,
    syncPlayheadFromPlayback,
    togglePanel,
    setPanelVisible,
    getDisplayedCueId,
    isPanelEnabled
};
