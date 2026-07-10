import { formatTime } from './utils.js';
import { uiLog } from './uiLogger.js';
import { getContrastTextColors, DEFAULT_CUE_BUTTON_COLOR, normalizeHexColor } from './buttonColorPresets.js';
import { buildEditCardColorSwatches, syncEditCardColorSwatches } from '../editCardColorSwatches.js';
import { LOOP_BADGE_GLYPH } from '../cueIndicatorBadges.js';
import {
    shouldShowButtonWaveform,
    ensureButtonWaveform,
    updateButtonWaveformPlayhead,
    removeButtonWaveform,
    buildCueForWaveformDraw
} from './cueButtonWaveform.js';
import {
    buildLayoutFromDom,
    createSectionBlock,
    createAddSectionButton,
    persistLayoutFromDom,
    bindSectionCueDragDrop,
    updateSectionDragGap,
    bindSectionBlockDragDrop,
    getActiveDragWrappers,
    insertWrappersBefore,
    insertWrappersAfter,
    appendWrappersToSection
} from './cueGridSections.js';
import { resolveEffectiveRetriggerBehavior } from '../retriggerBehaviorUtils.js';
import { ensureCueIndicatorStrip, updateCueIndicatorStrip } from '../cueIndicatorBadges.js';
import * as ipcRendererBindingsModule from '../ipcRendererBindings.js';
import {
    createCuePreviewButton,
    syncAllCuePreviewButtons,
    handleCuePreviewClick
} from './cuePreviewButton.js';
import { shouldShowCueMeter } from '../cueMeterVisibility.js';
import {
    dbfsToMeterRatio,
    updateCueMeterPeakHold,
    clearCueMeterPeakHold,
    formatCueMeterDbfsLabel,
    buildCueMeterZonesGradient,
    CUE_METER_FLOOR_DBFS
} from '../cueMeterDisplay.js';
import {
    beginDragGap,
    endDragGap,
    getDragGapState,
    applyDragGapFromTarget,
    applyItemsAtDropIntent
} from './dragGapPlaceholder.js';
import { startDragAutoScroll, stopDragAutoScroll } from './dragAutoScroll.js';

function isCueMediaMissing(cueId) {
    return missingCueIds.has(cueId);
}

function applyMissingMediaVisual(element) {
    if (!element) return;
    const cueId = element.dataset.cueId;
    const isMissing = cueId && missingCueIds.has(cueId);
    element.classList.toggle('cue-missing-media', !!isMissing);

    let badge = element.querySelector('.cue-missing-media-badge');
    if (isMissing) {
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'cue-missing-media-badge';
            badge.title = 'Audio file not found on disk';
            badge.textContent = 'MISSING';
            badge.setAttribute('aria-label', 'Audio file missing');
            element.appendChild(badge);
        }
    } else if (badge) {
        badge.remove();
    }
}

function applyMissingMediaToAllCards() {
    document.querySelectorAll('.cue-button[data-cue-id], .cue-edit-card[data-cue-id]').forEach(applyMissingMediaVisual);
}

function setMissingCueIds(cueIds) {
    missingCueIds = cueIds instanceof Set ? cueIds : new Set(cueIds || []);
}

async function pollMissingMedia() {
    if (!ipcRendererBindingsModule?.pollMissingMedia) {
        const result = await ipcRendererBindingsModule?.scanMissingMedia?.();
        if (!result?.success) {
            return { fileCount: 0, cueCount: 0 };
        }
        setMissingCueIds(result?.missingCueIds || []);
        return {
            fileCount: result?.fileCount || result?.missing?.length || 0,
            cueCount: result?.cueCount || missingCueIds.size
        };
    }

    try {
        const result = await ipcRendererBindingsModule.pollMissingMedia();
        if (!result?.success) {
            return { fileCount: 0, cueCount: 0 };
        }
        setMissingCueIds(result?.missingCueIds || []);
        return {
            fileCount: result?.fileCount || 0,
            cueCount: result?.cueCount || missingCueIds.size
        };
    } catch (error) {
        uiLog.warn('pollMissingMedia failed:', error);
        return { fileCount: 0, cueCount: 0 };
    }
}

async function ensureMissingMediaState() {
    if (!ipcRendererBindingsModule?.scanMissingMedia) {
        return { fileCount: 0, cueCount: 0 };
    }

    try {
        const result = await ipcRendererBindingsModule.scanMissingMedia();
        setMissingCueIds(result?.missingCueIds || []);
        return {
            fileCount: result?.fileCount || result?.missing?.length || 0,
            cueCount: result?.cueCount || missingCueIds.size
        };
    } catch (error) {
        uiLog.warn('ensureMissingMediaState failed:', error);
        return { fileCount: 0, cueCount: 0 };
    }
}

async function promptMissingMediaAlert(stats) {
    if (!stats?.fileCount || !electronAPIForMissingAlert?.showConfirmationDialog) return;
    const dialogResult = await electronAPIForMissingAlert.showConfirmationDialog({
        type: 'warning',
        title: 'Missing Audio Files',
        message: `${stats.fileCount} audio file${stats.fileCount === 1 ? '' : 's'} could not be found.`,
        detail: `${stats.cueCount} cue${stats.cueCount === 1 ? '' : 's'} affected. Use File → Relink Missing Audio to search for moved files.`,
        buttons: ['Relink Now…', 'Dismiss'],
        defaultId: 0,
        cancelId: 1
    });
    if (dialogResult?.response === 0 && typeof openRelinkMissingAudioModal === 'function') {
        openRelinkMissingAudioModal();
    }
}

async function refreshMissingMediaState({ showAlert = false, rescan = true } = {}) {
    const stats = rescan ? await pollMissingMedia() : {
        fileCount: missingCueIds.size,
        cueCount: missingCueIds.size
    };
    applyMissingMediaToAllCards();

    if (showAlert && stats.fileCount > 0) {
        await promptMissingMediaAlert(stats);
    }

    return stats;
}

let electronAPIForMissingAlert = null;
let openRelinkMissingAudioModal = null;

function configureMissingMediaAlerts(electronAPI, openRelinkModal) {
    electronAPIForMissingAlert = electronAPI;
    openRelinkMissingAudioModal = openRelinkModal;
}

function getAppConfigForWaveform() {
    return (uiCore && typeof uiCore.getCurrentAppConfig === 'function')
        ? uiCore.getCurrentAppConfig()
        : {};
}

let isInitialized = false;
let cueStore, audioController, dragDrop, uiCore; // Scoped module refs
let cueButtonMap = {}; // To store references to cue button DOM elements
let missingCueIds = new Set();
let cueMeterElements = {}; // Stores meter DOM refs per cue
let cueMeterLevels = {}; // Stores smoothed meter height ratio per cue
const cueMeterPeakHoldUntil = {}; // Peak-hold expiry (ms) when level >= 0 dBFS
const cueMeterLiveSources = new Set(); // Tracks cues with live analyser-driven meters
let cueBadgeElements = {}; // Stores references to icon elements per cue

const METER_MIN_HEIGHT_PERCENT = 2;
const METER_SMOOTHING = 0.4;

const DUCK_TRIGGER_ICON_PATH = '../../assets/icons/DUCKING_TRIGGER.png';
const DUCK_ACTIVE_ICON_PATH = '../../assets/icons/DUCKED.png';
let dragOverCueId = null;
let cueGridContainer;
const selectedCueIds = new Set();
let selectionAnchorId = null;
let deleteSelectedCuesBtn = null;
let clearSectionDragOver = null;
let activeDragCueIds = [];
let debouncedSaveCuePatchFn = null;

function debounce(fn, delay) {
    let timeout;
    return function debounced(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

function saveCuePatchDebounced(cueId, patch) {
    if (!debouncedSaveCuePatchFn) {
        debouncedSaveCuePatchFn = debounce(async (id, patchData) => {
            const cue = cueStore?.getCueById?.(id);
            if (!cue) return;
            await cueStore.addOrUpdateCue({ ...cue, ...patchData });
        }, 400);
    }
    debouncedSaveCuePatchFn(cueId, patch);
}

function applyLiveCueVolume(cueId, volume) {
    const ac = audioController?.default || audioController;
    if (typeof ac?.setVolume === 'function') {
        ac.setVolume(cueId, volume, { persist: false });
    }
}

function seekCuePlayback(cueId, positionSec, options) {
    const ac = audioController?.default || audioController;
    if (typeof ac?.seek === 'function') {
        ac.seek(cueId, positionSec, options);
    }
}

function prepareCueScrub(cueId) {
    const ac = audioController?.default || audioController;
    if (typeof ac?.prepareScrubSeek === 'function') {
        ac.prepareScrubSeek(cueId);
    }
}

function finishCueScrub(cueId) {
    const ac = audioController?.default || audioController;
    if (typeof ac?.finishScrubSeek === 'function') {
        ac.finishScrubSeek(cueId);
    }
}

function applyEditCardAppearance(card, cue) {
    const hex = normalizeHexColor(cue.buttonColor) || DEFAULT_CUE_BUTTON_COLOR;
    card.style.backgroundColor = hex;
    card.style.color = getContrastTextColors(hex).primary;
    card.style.borderColor = hex === DEFAULT_CUE_BUTTON_COLOR ? '#666' : hex;
}

function updateEditCardLoopButton(button, loopEnabled) {
    if (!button) return;
    const enabled = !!loopEnabled;
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = enabled ? 'Loop enabled — click to disable' : 'Loop disabled — click to enable';
}

function refreshEditCardLoopState(cueId) {
    const card = cueGridContainer?.querySelector(`.cue-edit-card[data-cue-id="${cueId}"]`);
    const cue = cueStore?.getCueById?.(cueId);
    updateEditCardLoopButton(card?.querySelector('.cue-edit-loop-btn'), cue?.loop);
}

function bindEditCardLoopButton(button, cueId) {
    if (!button) return;
    const cue = cueStore?.getCueById?.(cueId);
    updateEditCardLoopButton(button, cue?.loop);
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const currentCue = cueStore?.getCueById?.(cueId);
        const nextLoop = !currentCue?.loop;
        updateEditCardLoopButton(button, nextLoop);
        saveCuePatchDebounced(cueId, { loop: nextLoop });
        const card = button.closest('.cue-edit-card');
        if (card) {
            updateCueIndicatorStrip(card, { ...currentCue, loop: nextLoop }, getAppConfigForWaveform());
        }
    });
}

function refreshEditCardColor(cueId, color) {
    const card = cueGridContainer?.querySelector(`.cue-edit-card[data-cue-id="${cueId}"]`);
    if (!card) return;
    const cue = cueStore?.getCueById?.(cueId);
    if (!cue) return;
    cue.buttonColor = color || null;
    applyEditCardAppearance(card, cue);
    syncEditCardColorSwatches(card.querySelector('.cue-edit-color-swatches'), color);
}

function refreshCueCardAppearance(cueId, color) {
    const cue = cueStore?.getCueById?.(cueId);
    if (!cue) return;
    const resolvedColor = color !== undefined ? color : cue.buttonColor;
    refreshEditCardColor(cueId, resolvedColor);
    const button = document.getElementById(`cue-btn-${cueId}`);
    if (button) {
        applyCueButtonColor(button, resolvedColor);
        applyMissingMediaVisual(button);
    }
    const editCard = document.querySelector(`.cue-edit-card[data-cue-id="${cueId}"]`);
    if (editCard) {
        applyMissingMediaVisual(editCard);
    }
}

function getWrapperCueId(wrapper) {
    return wrapper?.dataset?.cueId
        || wrapper?.querySelector('.cue-button')?.dataset?.cueId
        || wrapper?.querySelector('.cue-edit-card')?.dataset?.cueId
        || null;
}

function bindCueWrapperDragReorder(cueWrapper, cue) {
    const isEditModeActive = uiCore?.isPersistedEditMode?.() ?? false;
    cueWrapper.draggable = isEditModeActive;
    cueWrapper.classList.toggle('draggable-cue-wrapper', isEditModeActive);

    const dragCancelSelector = '.playlist-nav-btn, .cue-edit-name, .cue-color-swatch, .cue-color-custom-wrap, .cue-edit-settings-btn, .cue-edit-loop-btn, .cue-edit-volume-row, .cue-edit-volume, .cue-button-waveform-wrap, input[type="range"], input[type="color"], textarea, select, button';

    const restoreWrapperDraggable = () => {
        if (uiCore?.isPersistedEditMode?.()) {
            cueWrapper.draggable = true;
        }
    };

    const suspendWrapperDragForInteraction = (event) => {
        if (!uiCore?.isPersistedEditMode?.()) return;
        if (!event.target.closest(dragCancelSelector)) return;
        cueWrapper.draggable = false;
        window.addEventListener('mouseup', restoreWrapperDraggable, { once: true });
        window.addEventListener('pointerup', restoreWrapperDraggable, { once: true });
        window.addEventListener('touchend', restoreWrapperDraggable, { once: true });
    };

    cueWrapper.addEventListener('mousedown', suspendWrapperDragForInteraction);
    cueWrapper.addEventListener('pointerdown', suspendWrapperDragForInteraction);

    cueWrapper.addEventListener('dragstart', (e) => {
        if (!uiCore.isPersistedEditMode?.()) {
            e.preventDefault();
            return;
        }
        if (e.target.closest(dragCancelSelector)) {
            e.preventDefault();
            return;
        }
        activeDragCueIds = getOrderedSelectedCueIds(cue.id);
        beginDragGap(activeDragCueIds.length);
        startDragAutoScroll(document.getElementById('mainDropArea'));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cue.id);
        e.dataTransfer.setData('application/x-accompaniment-cue-ids', activeDragCueIds.join(','));
        markDragWrappers(activeDragCueIds, cue.id);
        cueGridContainer.classList.add('drag-active');
    });

    cueWrapper.addEventListener('dragend', () => {
        clearDragWrappers();
        cueGridContainer.classList.remove('drag-active');
        if (typeof clearSectionDragOver === 'function') {
            clearSectionDragOver();
        }
    });

    cueWrapper.addEventListener('dragover', (e) => {
        if (!uiCore.isPersistedEditMode?.()) return;
        if (cueWrapper.classList.contains('dragging-cue-group')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const draggedWrappers = getActiveDragWrappers(cueGridContainer);
        if (draggedWrappers.length === 0 || draggedWrappers.includes(cueWrapper)) return;

        const sectionBody = cueWrapper.closest('.cue-section-body');
        const slotCount = getDragGapState()?.slotCount || draggedWrappers.length || 1;
        if (sectionBody) {
            updateSectionDragGap(sectionBody, e.clientX, e.clientY, slotCount);
        } else {
            updateCueDragGapAtPoint(cueWrapper.parentElement, cueWrapper, e.clientX);
        }
    });

    cueWrapper.addEventListener('dragleave', (e) => {
        const rect = cueWrapper.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            return;
        }
    });

    cueWrapper.addEventListener('drop', async (e) => {
        if (!uiCore.isPersistedEditMode?.()) return;
        e.preventDefault();
        e.stopPropagation();

        const draggedWrappers = getActiveDragWrappers(cueGridContainer, e.dataTransfer);
        if (draggedWrappers.length === 0 || draggedWrappers.includes(cueWrapper)) {
            endDragGap();
            return;
        }

        const applied = applyItemsAtDropIntent(draggedWrappers, {
            insertBefore: insertWrappersBefore,
            insertAfter: insertWrappersAfter,
            append: appendWrappersToSection
        }, getDragGapState());
        endDragGap();

        if (!applied) {
            const rect = cueWrapper.getBoundingClientRect();
            const insertBefore = e.clientX < rect.left + rect.width / 2;
            const dropParent = cueWrapper.parentElement || cueGridContainer;
            if (insertBefore) {
                insertWrappersBefore(dropParent, draggedWrappers, cueWrapper);
            } else {
                insertWrappersAfter(dropParent, draggedWrappers, cueWrapper);
            }
        }

        clearDragWrappers();
        await persistLayoutFromDom(cueGridContainer, cueStore);
    });
}

function appendEditModeCueCard(cue, cueWrapper) {
    const card = document.createElement('div');
    card.className = 'cue-edit-card';
    card.dataset.cueId = cue.id;
    const volPct = Math.round((cue.volume !== undefined ? cue.volume : 1) * 100);
    card.innerHTML = `
        <div class="cue-edit-top">
            <div class="cue-edit-top-right">
                <button type="button" class="cue-preview-btn cue-edit-preview-btn" title="Preview on monitor output" aria-label="Preview on monitor output" aria-pressed="false">♪</button>
                <button type="button" class="cue-edit-settings-btn" title="Cue properties" aria-label="Cue properties">&#9881;</button>
            </div>
        </div>
        <div class="cue-edit-color-swatches"></div>
        <input type="text" class="cue-edit-name" aria-label="Cue name">
        <div class="cue-edit-volume-row">
            <span class="cue-edit-volume-label">Volume</span>
            <span class="cue-edit-volume-pct">${volPct}%</span>
            <input type="range" class="cue-edit-volume" min="0" max="100" step="1" value="${volPct}" aria-label="Cue volume">
        </div>
        <div class="cue-edit-actions-row">
            <button type="button" class="cue-edit-loop-btn" aria-pressed="${cue.loop ? 'true' : 'false'}" aria-label="Toggle loop" title="Loop disabled — click to enable">${LOOP_BADGE_GLYPH}</button>
        </div>
        <div class="cue-edit-type">${cue.type === 'playlist' ? 'Playlist' : 'Single file'}</div>
    `;

    applyEditCardAppearance(card, cue);
    updateCueIndicatorStrip(card, cue, getAppConfigForWaveform());
    buildEditCardColorSwatches(card.querySelector('.cue-edit-color-swatches'), cue.buttonColor, {
        onSelectColor: (color) => {
            saveCuePatchDebounced(cue.id, { buttonColor: color });
            refreshEditCardColor(cue.id, color);
        },
        getRecentColors: () => getAppConfigForWaveform().recentButtonColors || [],
    });

    const nameInput = card.querySelector('.cue-edit-name');
    nameInput.value = cue.name || '';
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('change', (event) => {
        event.stopPropagation();
        saveCuePatchDebounced(cue.id, { name: nameInput.value });
    });

    const volInput = card.querySelector('.cue-edit-volume');
    const volLabel = card.querySelector('.cue-edit-volume-pct');
    const suspendWrapperDragForVolume = () => {
        cueWrapper.draggable = false;
        const restore = () => {
            cueWrapper.draggable = true;
        };
        window.addEventListener('mouseup', restore, { once: true });
        window.addEventListener('pointerup', restore, { once: true });
    };
    volInput.addEventListener('click', (event) => event.stopPropagation());
    volInput.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        suspendWrapperDragForVolume();
    });
    volInput.addEventListener('input', (event) => {
        event.stopPropagation();
        volLabel.textContent = `${volInput.value}%`;
        const vol = parseInt(volInput.value, 10) / 100;
        applyLiveCueVolume(cue.id, vol);
        saveCuePatchDebounced(cue.id, { volume: vol });
    });

    const settingsBtn = card.querySelector('.cue-edit-settings-btn');
    settingsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        setSingleCueSelection(cue.id);
    });

    const previewBtn = card.querySelector('.cue-edit-preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', (event) => {
            handleCuePreviewClick(event, cue, previewBtn, ipcRendererBindingsModule?.resolveAudioPath);
        });
    }

    bindEditCardLoopButton(card.querySelector('.cue-edit-loop-btn'), cue.id);

    card.addEventListener('click', (event) => handleEditCueCardSelectionClick(event, cue));
    card.addEventListener('pointerdown', (event) => suspendWrapperDragForSelectionModifier(event, cueWrapper));

    cueWrapper.appendChild(card);
    applyMissingMediaVisual(card);
}

function handleEditCueCardSelectionClick(event, cue) {
    if (!uiCore?.isPersistedEditMode?.()) return;
    if (event.target.closest(
        '.cue-edit-name, .cue-color-swatch, .cue-color-custom-wrap, .cue-edit-settings-btn, .cue-edit-loop-btn, .cue-preview-btn, .cue-edit-volume-row, .cue-edit-volume, .cue-edit-drag, .cue-move-btn, input[type="range"], input[type="color"]'
    )) {
        return;
    }

    const isMultiSelect = event.ctrlKey || event.metaKey;
    if (isMultiSelect) {
        event.preventDefault();
        event.stopPropagation();
        toggleCueSelection(cue.id);
        return;
    }
    if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (selectionAnchorId) {
            selectCueRange(selectionAnchorId, cue.id);
        } else {
            setSingleCueSelection(cue.id);
        }
        return;
    }
    if (selectedCueIds.size === 1 && selectedCueIds.has(cue.id)) {
        clearCueSelection();
        return;
    }
    setSingleCueSelection(cue.id);
}

function getOrderedSelectedCueIds(primaryCueId) {
    if (selectedCueIds.size <= 1 || !selectedCueIds.has(primaryCueId)) {
        return [primaryCueId];
    }
    return getVisibleCueOrder().filter(id => selectedCueIds.has(id));
}

function markDragWrappers(cueIds, primaryCueId) {
    cueIds.forEach(id => {
        const el = document.querySelector(`.cue-wrapper[data-cue-id="${id}"]`)
            || document.querySelector(`.cue-edit-card[data-cue-id="${id}"]`);
        const wrapper = el?.classList?.contains('cue-wrapper') ? el : el?.closest('.cue-wrapper');
        if (!wrapper) return;
        wrapper.classList.add('dragging-cue-group');
        if (id === primaryCueId) {
            wrapper.classList.add('dragging-cue');
        }
        const button = wrapper.querySelector('.cue-button');
        button?.classList.add('dragging');
    });
}

function clearDragWrappers() {
    stopDragAutoScroll();
    endDragGap();
    document.querySelectorAll('.cue-wrapper.dragging-cue-group').forEach(wrapper => {
        wrapper.classList.remove('dragging-cue-group', 'dragging-cue');
    });
    document.querySelectorAll('.cue-button.dragging').forEach(button => {
        button.classList.remove('dragging');
    });
    activeDragCueIds = [];
}

function updateCueDragGapAtPoint(parent, targetElement, clientX) {
    const state = getDragGapState();
    if (!state || !parent || !targetElement) return;
    applyDragGapFromTarget(state, {
        parent,
        targetElement,
        clientX,
        slotCount: state.slotCount || 1
    });
}

function applyCueButtonColor(button, buttonColor) {
    if (buttonColor) {
        const { primary, secondary } = getContrastTextColors(buttonColor);
        const useDarkText = primary === '#1a1a1a';
        button.style.setProperty('--cue-custom-bg', buttonColor);
        button.style.setProperty('--cue-custom-fg', primary);
        button.style.setProperty('--cue-custom-fg-secondary', secondary);
        button.dataset.buttonColor = buttonColor;
        button.dataset.darkText = useDarkText ? 'true' : 'false';
        button.classList.add('has-custom-color');
    } else {
        button.style.removeProperty('--cue-custom-bg');
        button.style.removeProperty('--cue-custom-fg');
        button.style.removeProperty('--cue-custom-fg-secondary');
        delete button.dataset.buttonColor;
        delete button.dataset.darkText;
        button.classList.remove('has-custom-color');
    }
}

export function initCueGrid(cs, ac, dd, ui) {
    uiLog.info('CueGrid: Initializing...');
    cueStore = cs;
    audioController = ac;
    dragDrop = dd;
    uiCore = ui;
    cacheDOMElements();
    bindEventListeners();
    document.addEventListener('cue-monitor-preview-stopped', () => {
        syncAllCuePreviewButtons(null);
    });
    document.addEventListener('cue-monitor-preview-started', (event) => {
        syncAllCuePreviewButtons(event.detail?.cueId || null);
    });
    isInitialized = true; // Set initialization flag
    window.__refreshCueCardAppearance = refreshCueCardAppearance;
    window.__refreshEditCardIndicators = refreshEditCardIndicators;
    uiLog.info('CueGrid: Initialized successfully.');
    // Do not call renderCues() here; let ui.loadAndRenderCues in renderer.js handle the first render.
}

export function setDeleteSelectedButton(button) {
    deleteSelectedCuesBtn = button;
    updateDeleteSelectedButton();
}

function updateDeleteSelectedButton() {
    if (!deleteSelectedCuesBtn) return;
    const count = selectedCueIds.size;
    const inEditMode = uiCore?.isPersistedEditMode?.() ?? (uiCore?.isEditMode?.() ?? false);
    deleteSelectedCuesBtn.disabled = count === 0;
    deleteSelectedCuesBtn.classList.toggle('hidden', !inEditMode);
    deleteSelectedCuesBtn.textContent = count > 0 ? `Delete (${count})` : 'Delete Selected';
    deleteSelectedCuesBtn.title = count > 0
        ? `Delete ${count} selected cue${count === 1 ? '' : 's'} (Delete key)`
        : 'Select cues with click or Ctrl/Cmd+click, then delete';
}

export function selectAllCues() {
    if (!cueStore) return;
    selectedCueIds.clear();
    cueStore.getAllCues().forEach(cue => selectedCueIds.add(cue.id));
    selectionAnchorId = cueStore.getAllCues()[0]?.id || null;
    applySelectionToDom();
}

function applySelectionToDom() {
    if (!cueGridContainer) return;
    cueGridContainer.querySelectorAll('.cue-wrapper').forEach((wrapper) => {
        const cueId = getWrapperCueId(wrapper);
        const isSelected = !!cueId && selectedCueIds.has(cueId);
        wrapper.classList.toggle('cue-selected', isSelected);
    });
    updateDeleteSelectedButton();
    syncPropertiesSidebarToSelection();
}

function suspendWrapperDragForSelectionModifier(event, cueWrapper) {
    if (!uiCore?.isPersistedEditMode?.()) return;
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) return;
    cueWrapper.draggable = false;
    const restore = () => {
        if (uiCore?.isPersistedEditMode?.()) {
            cueWrapper.draggable = true;
        }
    };
    window.addEventListener('pointerup', restore, { once: true });
    window.addEventListener('mouseup', restore, { once: true });
}

function syncPropertiesSidebarToSelection() {
    if (!uiCore?.isPersistedEditMode?.()) return;
    uiCore?.cancelPendingPropertiesSave?.();
    const ids = [...selectedCueIds];
    if (ids.length === 0) {
        uiCore?.hidePropertiesSidebar?.();
        uiCore?.clearMainWaveformPreview?.();
        return;
    }

    const primaryId = getPrimarySelectedCueId();
    if (window._waveformTrimUpdateInProgress && typeof uiCore?.getActivePropertiesCueIds === 'function') {
        const activeIds = uiCore.getActivePropertiesCueIds();
        const activePrimary = uiCore.getActivePropertiesCueId?.();
        const samePrimary = activePrimary === primaryId;
        const sameIds = activeIds.length === ids.length
            && ids.every((id) => activeIds.includes(id));
        if (samePrimary && sameIds) return;
    }

    if (typeof uiCore?.openPropertiesSidebarForSelection === 'function') {
        uiCore.openPropertiesSidebarForSelection(ids, primaryId);
    }
}

function getSelectedCueIds() {
    return [...selectedCueIds];
}

function getPrimarySelectedCueId() {
    if (selectionAnchorId && selectedCueIds.has(selectionAnchorId)) {
        return selectionAnchorId;
    }
    return [...selectedCueIds][0] || null;
}

export function clearCueSelection() {
    selectedCueIds.clear();
    selectionAnchorId = null;
    applySelectionToDom();
    uiCore?.clearMainWaveformPreview?.();
}

function getVisibleCueOrder() {
    const ids = [];
    if (!cueGridContainer) return ids;
    cueGridContainer.querySelectorAll('.cue-wrapper').forEach((wrapper) => {
        const cueId = getWrapperCueId(wrapper);
        if (cueId) ids.push(cueId);
    });
    return ids;
}

function toggleCueSelection(cueId) {
    if (selectedCueIds.has(cueId)) {
        selectedCueIds.delete(cueId);
    } else {
        selectedCueIds.add(cueId);
    }
    selectionAnchorId = cueId;
    applySelectionToDom();
}

function setSingleCueSelection(cueId) {
    selectedCueIds.clear();
    selectedCueIds.add(cueId);
    selectionAnchorId = cueId;
    applySelectionToDom();
}

function selectCueRange(fromId, toId) {
    const order = getVisibleCueOrder();
    const startIndex = order.indexOf(fromId);
    const endIndex = order.indexOf(toId);
    if (startIndex === -1 || endIndex === -1) return;
    const [low, high] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    selectedCueIds.clear();
    for (let index = low; index <= high; index += 1) {
        selectedCueIds.add(order[index]);
    }
    selectionAnchorId = fromId;
    applySelectionToDom();
}

export async function deleteSelectedCues() {
    if (!cueStore || selectedCueIds.size === 0) return { success: false };

    const ids = [...selectedCueIds];
    const count = ids.length;
    const noun = count === 1 ? 'cue' : 'cues';
    if (!confirm(`Delete ${count} selected ${noun}?`)) {
        return { success: false, cancelled: true };
    }

    if (audioController?.default) {
        ids.forEach(cueId => {
            if (audioController.default.isPlaying?.(cueId)) {
                audioController.default.toggle(cueId, false, 'stop');
            }
        });
    }

    const activePropertiesCueId = document.getElementById('propCueId')?.value;
    const result = await cueStore.deleteCues(ids);
    if (result?.success) {
        clearCueSelection();
        if (activePropertiesCueId && ids.includes(activePropertiesCueId) && uiCore?.hidePropertiesSidebar) {
            uiCore.hidePropertiesSidebar();
        }
    }
    return result;
}

export function handleDeleteSelectedKeydown(event) {
    if (!uiCore?.isPersistedEditMode?.()) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAllCues();
        return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedCueIds.size === 0) return;
        event.preventDefault();
        deleteSelectedCues();
        return;
    }

    if (event.key === 'Escape') {
        clearCueSelection();
    }
}

function cacheDOMElements() {
    cueGridContainer = document.getElementById('cueGridContainer'); 
}

// Track navigation button clicks to prevent rapid clicking
const navigationClickBlocked = new Set();

function bindEventListeners() {
    // Add global event listener for playlist navigation buttons
    if (cueGridContainer) {
        cueGridContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('playlist-nav-btn')) {
                event.stopPropagation(); // Prevent triggering the cue button click
                event.preventDefault(); // Prevent any default behavior
                
                const cueId = event.target.getAttribute('data-cue-id');
                const buttonType = event.target.classList.contains('playlist-prev-btn') ? 'prev' : 'next';
                const navigationKey = `${cueId}-${buttonType}`;
                
                // Block rapid clicking at the UI level
                if (navigationClickBlocked.has(navigationKey)) {
                    uiLog.debug(`🚫 CueGrid: Navigation click blocked for ${cueId} (${buttonType}) - too rapid`);
                    return;
                }
                
                // Block this navigation for 200ms at UI level
                navigationClickBlocked.add(navigationKey);
                uiLog.debug(`🔒 CueGrid: UI-level block added for ${navigationKey}`);
                setTimeout(() => {
                    navigationClickBlocked.delete(navigationKey);
                    uiLog.debug(`🔓 CueGrid: UI-level block removed for ${navigationKey}`);
                }, 200);
                
                if (event.target.classList.contains('playlist-prev-btn')) {
                    uiLog.debug(`CueGrid: Previous playlist item for cue ${cueId}`);
                    audioController.default.playlistNavigatePrevious(cueId);
                } else if (event.target.classList.contains('playlist-next-btn')) {
                    uiLog.debug(`CueGrid: Next playlist item for cue ${cueId}`);
                    audioController.default.playlistNavigateNext(cueId);
                }
                return;
            }

            if (uiCore?.isPersistedEditMode?.()) {
                if (event.target.closest('.cue-wrapper')) return;
                if (event.target.closest('.cue-section-header')) return;
                if (event.target.closest('.cue-section-add-btn')) return;
                clearCueSelection();
            }
        });

        clearSectionDragOver = bindSectionCueDragDrop(cueGridContainer, {
            canAcceptDrop: () => uiCore?.isPersistedEditMode?.() ?? false,
            onCueDropped: async () => {
                clearDragWrappers();
                await persistLayoutFromDom(cueGridContainer, cueStore);
            }
        });

        bindSectionBlockDragDrop(cueGridContainer, {
            canAcceptDrag: () => uiCore?.isPersistedEditMode?.() ?? false,
            onSectionReordered: async () => {
                await persistLayoutFromDom(cueGridContainer, cueStore);
            }
        });
    }
}

function renderCues() {
    if (!isInitialized) {
        uiLog.warn('renderCues (cueGrid.js) called before initCueGrid has completed. Aborting render.');
        return;
    }
    if (!cueGridContainer || !cueStore || !audioController || !uiCore) {
        uiLog.warn("renderCues (cueGrid.js) called before essential modules are initialized.");
        return;
    }
    cueGridContainer.innerHTML = ''; 
    cueMeterElements = {};
    cueMeterLevels = {};
    cueMeterLiveSources.clear();
    cueBadgeElements = {};
    const cues = cueStore.getAllCues();
    const sections = cueStore.getSections ? cueStore.getSections() : [];
    const layout = cueStore.getLayout ? cueStore.getLayout() : [];
    const validCueIds = new Set(cues.map(cue => cue.id));
    selectedCueIds.forEach(id => {
        if (!validCueIds.has(id)) selectedCueIds.delete(id);
    });
    const isEditModeActive = uiCore?.isEditMode?.() ?? false;
    const isPersistedEditMode = uiCore?.isPersistedEditMode?.() ?? false;
    const cueMap = new Map(cues.map(cue => [cue.id, cue]));

    function appendCueCard(cue, parentContainer) {
        const cueWrapper = document.createElement('div');
        cueWrapper.className = 'cue-wrapper';
        cueWrapper.dataset.cueId = cue.id;

        if (isEditModeActive) {
            appendEditModeCueCard(cue, cueWrapper);
            parentContainer.appendChild(cueWrapper);
            bindCueWrapperDragReorder(cueWrapper, cue);
            if (selectedCueIds.has(cue.id)) {
                cueWrapper.classList.add('cue-selected');
            }
            return;
        }

        const interactiveContainer = document.createElement('div');
        interactiveContainer.className = 'cue-interactive-container';
        
        const button = document.createElement('div');
        button.className = 'cue-button';
        button.id = `cue-btn-${cue.id}`;
        button.dataset.cueId = cue.id;
        button.dataset.cueType = cue.type || 'single';
        applyCueButtonColor(button, cue.buttonColor);
        if (isCueMediaMissing(cue.id)) {
            button.classList.add('cue-missing-media');
        }

        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'cue-status-indicator';
        statusIndicator.id = `cue-status-${cue.id}`;
        button.appendChild(statusIndicator);

        const indicatorRefs = ensureCueIndicatorStrip(button);
        const { strip: indicatorStrip, retriggerIcon, loopBadge: loopIcon } = indicatorRefs;

        const duckStrip = document.createElement('div');
        duckStrip.className = 'cue-duck-strip';
        button.appendChild(duckStrip);

        const duckTriggerIcon = document.createElement('img');
        duckTriggerIcon.className = 'cue-duck-icon duck-trigger-icon';
        duckTriggerIcon.src = DUCK_TRIGGER_ICON_PATH;
        duckTriggerIcon.alt = 'Ducking trigger';
        duckStrip.appendChild(duckTriggerIcon);

        const duckActiveIcon = document.createElement('img');
        duckActiveIcon.className = 'cue-duck-icon duck-active-icon';
        duckActiveIcon.src = DUCK_ACTIVE_ICON_PATH;
        duckActiveIcon.alt = 'Ducked';
        duckStrip.appendChild(duckActiveIcon);

        const nameContainer = document.createElement('div');
        nameContainer.className = 'cue-button-name-container';
        button.appendChild(nameContainer);

        const timeContainer = document.createElement('div');
        timeContainer.className = 'cue-time-display-container';

        const timeCurrentElem = document.createElement('span');
        timeCurrentElem.className = 'cue-time-current';
        timeCurrentElem.id = `cue-time-current-${cue.id}`;

        const timeSeparator = document.createElement('span');
        timeSeparator.className = 'cue-time-separator';
        timeSeparator.id = `cue-time-separator-${cue.id}`;

        const timeTotalElem = document.createElement('span');
        timeTotalElem.className = 'cue-time-total';
        timeTotalElem.id = `cue-time-total-${cue.id}`;

        const timeRemainingElem = document.createElement('span');
        timeRemainingElem.className = 'cue-time-remaining';
        timeRemainingElem.id = `cue-time-remaining-${cue.id}`;

        timeContainer.appendChild(timeCurrentElem);
        timeContainer.appendChild(timeSeparator);
        timeContainer.appendChild(timeTotalElem);
        timeContainer.appendChild(timeRemainingElem);
        button.appendChild(timeContainer);

        const appConfig = getAppConfigForWaveform();
        if (shouldShowButtonWaveform(cue, appConfig)) {
            ensureButtonWaveform(
                button,
                cue,
                (filePath) => uiCore.getOrGenerateWaveformPeaks(filePath),
                appConfig,
                seekCuePlayback
            );
        } else {
            removeButtonWaveform(button);
        }

        interactiveContainer.appendChild(button);
        applyMissingMediaVisual(button);

        const previewWrap = document.createElement('div');
        previewWrap.className = 'cue-preview-btn-wrap';
        previewWrap.appendChild(createCuePreviewButton(cue, ipcRendererBindingsModule?.resolveAudioPath));
        interactiveContainer.appendChild(previewWrap);

        const meterContainer = document.createElement('div');
        meterContainer.className = 'cue-audio-meter-container';
        meterContainer.setAttribute('data-cue-id', cue.id);

        const meterTrack = document.createElement('div');
        meterTrack.className = 'cue-audio-meter-track';

        const meterZones = document.createElement('div');
        meterZones.className = 'cue-audio-meter-zones';
        meterZones.style.background = buildCueMeterZonesGradient();

        const meterMask = document.createElement('div');
        meterMask.className = 'cue-audio-meter-mask';

        const peakHoldLine = document.createElement('div');
        peakHoldLine.className = 'cue-audio-meter-peak-hold';
        peakHoldLine.title = 'Peak above 0 dBFS';

        const dbfsEl = document.createElement('div');
        dbfsEl.className = 'cue-audio-meter-dbfs';
        dbfsEl.title = 'dBFS';
        dbfsEl.setAttribute('aria-hidden', 'true');

        meterTrack.appendChild(meterZones);
        meterTrack.appendChild(meterMask);
        meterTrack.appendChild(peakHoldLine);
        meterContainer.appendChild(meterTrack);
        meterContainer.appendChild(dbfsEl);
        interactiveContainer.appendChild(meterContainer);

        cueMeterElements[cue.id] = {
            mask: meterMask,
            container: meterContainer,
            zones: meterZones,
            peakHoldLine,
            dbfsEl
        };
        cueMeterLevels[cue.id] = 0;
        cueBadgeElements[cue.id] = {
            indicatorStrip,
            loopIcon,
            retriggerIcon,
            duckStrip,
            duckTriggerIcon,
            duckActiveIcon
        };

        cueWrapper.appendChild(interactiveContainer);
        
        // Add playlist navigation controls OUTSIDE the button for playlist cues
        if (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 1) {
            const playlistNavContainer = document.createElement('div');
            playlistNavContainer.className = 'playlist-nav-container';
            
            const prevButton = document.createElement('button');
            prevButton.className = 'playlist-nav-btn playlist-prev-btn';
            prevButton.innerHTML = '◀';
            prevButton.title = 'Previous item';
            prevButton.setAttribute('data-cue-id', cue.id);
            
            const nextButton = document.createElement('button');
            nextButton.className = 'playlist-nav-btn playlist-next-btn';
            nextButton.innerHTML = '▶';
            nextButton.title = 'Next item';
            nextButton.setAttribute('data-cue-id', cue.id);
            
            playlistNavContainer.appendChild(prevButton);
            playlistNavContainer.appendChild(nextButton);
            
            // Add navigation controls to the wrapper, NOT the button
            cueWrapper.appendChild(playlistNavContainer);
        }
        
        // Append the wrapper to the DOM (contains both button and navigation)
        parentContainer.appendChild(cueWrapper);

        const elementsForTimeUpdate = {
            current: timeCurrentElem,
            separator: timeSeparator,
            total: timeTotalElem,
            remaining: timeRemainingElem
        };

        const isCurrentlyPlaying = audioController.default.isPlaying(cue.id);
        const isCurrentlyCued = audioController.default.isCued(cue.id);
        // Pass the created elements directly for initial setup
        updateButtonPlayingState(cue.id, isCurrentlyPlaying, null, isCurrentlyCued, elementsForTimeUpdate);
        applyCueBadgeState(cue.id);

        button.addEventListener('click', (event) => handleCueButtonClick(event, cue));
    }

    const layoutEntries = layout.length > 0
        ? layout
        : (sections.length > 0
            ? [
                { type: 'section', sectionId: sections[0].id },
                ...cues.map(cue => ({ type: 'cue', cueId: cue.id, sectionId: sections[0].id }))
            ]
            : cues.map(cue => ({ type: 'cue', cueId: cue.id })));

    if (sections.length === 0 && cues.length === 0) {
        const emptyStateMessage = document.createElement('div');
        emptyStateMessage.className = 'empty-state-message';
        emptyStateMessage.innerHTML = `
            <div class="empty-state-content">
                <h3>No cues yet</h3>
                <p>Drag and drop audio files here to create cues</p>
            </div>
        `;
        cueGridContainer.appendChild(emptyStateMessage);
        return;
    }

    const sectionBodies = new Map();
    let flatFallbackContainer = null;

    layoutEntries.forEach(entry => {
        if (entry.type === 'section') {
            const section = sections.find(item => item.id === entry.sectionId);
            if (!section) return;
            const block = createSectionBlock(section, {
                isEditMode: isEditModeActive,
                gridContainer: cueGridContainer,
                onToggleCollapse: async (sectionId, collapsed) => {
                    if (cueStore.updateSection) {
                        await cueStore.updateSection(sectionId, { collapsed });
                    }
                },
                onRename: async (sectionId, title) => {
                    if (cueStore.updateSection) {
                        await cueStore.updateSection(sectionId, { title });
                    }
                },
                onDelete: async (sectionId) => {
                    if (sections.length <= 1) return;
                    if (cueStore.deleteSection) {
                        await cueStore.deleteSection(sectionId);
                    }
                }
            });
            cueGridContainer.appendChild(block);
            const body = block.querySelector('.cue-section-body');
            if (body) sectionBodies.set(section.id, body);
            return;
        }
        if (entry.type === 'cue') {
            const cue = cueMap.get(entry.cueId);
            if (!cue) return;
            const body = sectionBodies.get(entry.sectionId) || flatFallbackContainer || cueGridContainer;
            appendCueCard(cue, body);
        }
    });

    if (isPersistedEditMode) {
        cueGridContainer.appendChild(createAddSectionButton(async () => {
            if (cueStore.addSection) {
                await cueStore.addSection('New Section');
            }
        }));
    }

    if (dragDrop && typeof dragDrop.initializeCueButtonDragDrop === 'function') {
        dragDrop.initializeCueButtonDragDrop(cueGridContainer);
    }

    applySelectionToDom();
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.cue-wrapper:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleCueButtonClick(event, cue) {
    if (!cue) {
        uiLog.error(`UI: Cue not found.`);
        return;
    }
    if (event.target.closest('.cue-preview-btn')) {
        return;
    }
    if (event.target.closest('.cue-button-waveform-wrap')) {
        return;
    }
    if (!uiCore || !audioController) {
        uiLog.error("cueGrid.handleCueButtonClick: uiCore or audioController not initialized.");
        return;
    }

    // Show/playback mode only — edit mode uses inline edit cards and the properties gear button.
    if (uiCore.isEditMode()) {
        return;
    }

    const retriggerBehavior = resolveEffectiveRetriggerBehavior(cue, uiCore.getCurrentAppConfig());
    uiLog.debug(`UI: Playback mode action for cue ${cue.id}. Using retrigger behavior: ${retriggerBehavior}`);
    audioController.default.toggle(cue.id, false, retriggerBehavior);
}

function updateButtonPlayingState(cueId, isPlaying, statusTextArg = null, isCuedOverride = false, elements = null) {
    // uiLog.debug(`[CueGrid UpdateButtonPlayingState ENTRY] cueId: ${cueId}, isPlaying(arg): ${isPlaying}, isCuedOverride: ${isCuedOverride}, elements received:`, elements ? typeof elements : 'null', elements);
    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button || !cueStore || !audioController) return;
    const cue = cueStore.getCueById(cueId);
    if (!cue) return;

    const statusIndicator = button.querySelector('.cue-status-indicator');
    const nameContainer = button.querySelector('.cue-button-name-container');
    let nameHTML = ''; // Start with empty and build up
    const mainCueNameSpan = `<span class="cue-button-main-name">${cue.name || 'Cue'}</span>`;
    nameHTML += mainCueNameSpan;

    let statusIconSrc = '../../assets/icons/stop.png';
    let statusIconAlt = 'Stopped';

    // Ensure a text indicator element exists or create it
    let cuedTextIndicator = button.querySelector('.cue-cued-text-indicator');
    if (!cuedTextIndicator) {
        cuedTextIndicator = document.createElement('div');
        cuedTextIndicator.className = 'cue-cued-text-indicator';
        button.insertBefore(cuedTextIndicator, button.firstChild); // Add to top-left
    }
    
    // Ensure instance counter element exists
    let instanceCounter = button.querySelector('.cue-instance-counter');
    if (!instanceCounter) {
        instanceCounter = document.createElement('div');
        instanceCounter.className = 'cue-instance-counter';
        // Style it to be centered just above the time container
        instanceCounter.style.position = 'absolute';
        instanceCounter.style.left = '50%';
        instanceCounter.style.transform = 'translateX(-50%)';
        instanceCounter.style.bottom = '28px'; // Just above the time container
        instanceCounter.style.fontSize = '11px';
        instanceCounter.style.color = 'rgba(255, 255, 255, 0.9)'; // Increased opacity
        instanceCounter.style.fontWeight = 'bold';
        instanceCounter.style.pointerEvents = 'none';
        instanceCounter.style.zIndex = '1000'; // Very high Z-index
        instanceCounter.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
        button.appendChild(instanceCounter);
    }
    instanceCounter.style.display = 'none'; // Default hidden

    button.classList.remove('playing', 'paused', 'cued');
    statusIndicator.style.display = 'none';
    cuedTextIndicator.style.display = 'none'; // Default to hidden

    // Handle crossfade status text (if provided)
    // Only treat as crossfade text if it contains fade-related keywords
    const isCrossfadeText = statusTextArg && (statusTextArg.includes('Fade Out') || statusTextArg.includes('Fade In') || statusTextArg.includes('Crossfade'));
    
    if (isCrossfadeText) {
        uiLog.debug(`🎵 [CueGrid] Displaying crossfade text: "${statusTextArg}" for cue ${cueId}`);
        
        // Apply crossfade styling directly to the button
        button.classList.add('crossfade-active');
        
        // Change button background for crossfade with !important to override hover
        if (statusTextArg.includes('Fade Out')) {
            button.style.setProperty('background-color', 'rgba(255, 69, 0, 0.8)', 'important'); // Red-orange for fade out
            button.classList.add('crossfade-fade-out');
        } else if (statusTextArg.includes('Fade In')) {
            button.style.setProperty('background-color', 'rgba(255, 165, 0, 0.8)', 'important'); // Orange for fade in
            button.classList.add('crossfade-fade-in');
        }
        
        // Update the name container to show crossfade text prominently
        if (nameContainer) {
            const originalName = cue.name || 'Cue';
            nameHTML = `<span class="cue-button-main-name">${originalName}</span><br><span class="crossfade-timer" style="font-size: 16px; font-weight: bold; color: white;">${statusTextArg}</span>`;
        }
        
        // Hide status indicator during crossfade to make timer more prominent
        statusIndicator.style.display = 'none';
        
        // Apply the updated HTML and continue normal processing for visual states
        if (nameContainer) nameContainer.innerHTML = nameHTML;
        
        // Set button to playing state during crossfade
        button.classList.add('playing');
        
        return; // Don't process normal state logic when showing crossfade
    } else {
        // Clear crossfade styling when no crossfade text
        button.classList.remove('crossfade-active', 'crossfade-fade-out', 'crossfade-fade-in');
        button.style.removeProperty('background-color'); // Reset to default
    }

    // Get comprehensive state from audioController
    const playbackState = audioController.default.getPlaybackTimes(cue.id);

    if (playbackState) {
        const actualIsPlaying = playbackState.isPlaying;
        const actualIsPaused = playbackState.isPaused;
        // isCued can be from playbackState.isCued (which includes isCuedNext) or the override
        const actualIsCued = isCuedOverride || playbackState.isCued;
        const currentItemName = playbackState.currentPlaylistItemName;
        const nextItemName = playbackState.nextPlaylistItemName;
        const instanceCount = playbackState.instanceCount || 1;
        
        // Update instance counter display
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) {
            // Force visibility update based on instance count
            if (instanceCount > 1) {
                instanceCounter.textContent = `x${instanceCount}`;
                instanceCounter.style.display = 'block';
                // Ensure high z-index and proper positioning are enforced
                instanceCounter.style.zIndex = '10000';
                instanceCounter.style.visibility = 'visible';
            } else {
                instanceCounter.style.display = 'none';
            }
        }
        
        let playlistInfoHTML = ''; // Initialize playlistInfoHTML here

        if (actualIsPlaying) {
            button.classList.add('playing');
            statusIconSrc = '../../assets/icons/play.png';
            statusIconAlt = 'Playing';
            if (nameContainer && cue.type === 'playlist') {
                if (currentItemName) {
                    playlistInfoHTML += `<span class="playlist-now-playing">(Now: ${currentItemName})</span>`;
                }
                if (nextItemName) {
                    if (playlistInfoHTML) playlistInfoHTML += '<br>';
                    playlistInfoHTML += `<span class="playlist-next-item-playing">(Next: ${nextItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else if (actualIsCued && !actualIsPlaying) {
            // Prioritize cued state over paused state - this handles playlist items that have ended and are cued for next
            button.classList.add('cued');
            statusIconSrc = '../../assets/icons/pause.png'; // Show pause icon for cued state
            statusIconAlt = 'Cued';
            if (nameContainer && cue.type === 'playlist') {
                if (nextItemName) {
                    playlistInfoHTML += `<span class="next-playlist-item">(Next: ${nextItemName})</span>`;
                } else if (currentItemName) {
                    playlistInfoHTML += `<span class="next-playlist-item">(Cued: ${currentItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else if (actualIsPaused) {
            // Normal paused state (not cued)
            button.classList.add('paused');
            statusIconSrc = '../../assets/icons/pause.png';
            statusIconAlt = 'Paused';
            if (nameContainer && cue.type === 'playlist') {
                if (currentItemName) {
                    playlistInfoHTML += `<span class="playlist-now-playing">(Paused: ${currentItemName})</span>`;
                }
                if (nextItemName) {
                    if (playlistInfoHTML) playlistInfoHTML += '<br>';
                    playlistInfoHTML += `<span class="playlist-next-item-playing">(Next: ${nextItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else { // Stopped / Idle (and not specifically cued by logic above, e.g. single file cue just stopped)
            statusIndicator.style.display = 'none';
            // For idle single file cues, playbackState might be null or have isPlaying/isPaused false.
            // If it's a playlist and truly idle (no specific next item from isCued logic), 
            // playbackState.nextPlaylistItemName (first item) should be populated by audioController's fallback.
            if (nameContainer && cue.type === 'playlist' && nextItemName) {
                 playlistInfoHTML += `<span class="next-playlist-item">(Next: ${nextItemName})</span>`;
                 if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        }
        
        // Update nameContainer with constructed HTML for playing states
        if (nameContainer) {
            nameContainer.innerHTML = nameHTML;
        }
    } else {
        // Fallback if playbackState is null (should be rare with new audioController logic but handle defensively)
        // uiLog.warn(`[CueGrid updateButtonPlayingState for ${cue.id}] Playback state was null. Defaulting to stopped state.`);
        
        // CRITICAL FIX: If playbackState is null (stopped), we MUST still check isCuedOverride
        // This handles the case where currentlyPlaying was deleted but we want to show "Cued Next"
        if (isCuedOverride) {
             button.classList.add('cued');
             statusIconSrc = '../../assets/icons/pause.png';
             statusIconAlt = 'Cued';
             
             // We need to apply statusTextArg if present (e.g., "Next: Item 1")
             // statusTextArg is usually passed as the 3rd arg to updateButtonPlayingState
             if (statusTextArg && nameContainer) {
                 // Rebuild nameHTML for cued state
                 let playlistInfoHTML = `<span class="next-playlist-item">(${statusTextArg})</span>`;
                 // Avoid duplicating "Next: Next: ..." if statusTextArg already has it
                 if (statusTextArg.startsWith("Next:")) {
                      playlistInfoHTML = `<span class="next-playlist-item">(${statusTextArg})</span>`;
                 }
                 nameContainer.innerHTML = `${mainCueNameSpan}<br>${playlistInfoHTML}`;
             }
        } else if (nameContainer && cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0) {
            // Basic fallback for idle playlist if everything else failed and NOT overridden
            const firstItemName = cue.playlistItems[0]?.name || 'Item 1';
            let playlistInfoHTML = `<span class="next-playlist-item">(Next: ${firstItemName})</span>`;
            if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            nameContainer.innerHTML = nameHTML;
        } else if (nameContainer) {
             nameContainer.innerHTML = nameHTML; // Restore original name
        }
        if (!button.classList.contains('playing') && !button.classList.contains('paused') && !button.classList.contains('cued')) {
            statusIndicator.style.display = 'none';
        }
    }

    // if (nameContainer) nameContainer.innerHTML = nameHTML; // Logic moved inside blocks to avoid overwrite
    

    applyCueBadgeState(cueId, playbackState);

    updateCueButtonTime(cueId, elements);
    syncCueMeterContainerVisibility(cueId, audioController.default.isPlaying(cueId));
}

function updateCueButtonTime(cueId, elements = null, isFadingIn = false, isFadingOut = false, fadeTimeRemainingMs = 0) {
    if (!audioController || !cueStore) {
        uiLog.warn(`updateCueButtonTime: audioController or cueStore not ready for cue ${cueId}`);
        return;
    }
    const cueFromStore = cueStore.getCueById(cueId);

    if (!cueFromStore) {
        return;
    }

    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button) {
        return;
    }

    let localElements = elements;
    if (!localElements) {
        localElements = {
            current: button.querySelector(`#cue-time-current-${cueId}`),
            total: button.querySelector(`#cue-time-total-${cueId}`),
            remaining: button.querySelector(`#cue-time-remaining-${cueId}`),
            separator: button.querySelector(`#cue-time-separator-${cueId}`)
        };
    }

    const playbackTimes = audioController.default.getPlaybackTimes(cueId);

    let displayCurrentTimeFormatted = "00:00";
    let displayCurrentTime = 0;
    let displayItemDuration = 0;
    let displayItemDurationFormatted = "00:00";
    let displayItemRemainingTime = 0; 
    let displayItemRemainingTimeFormatted = "";

    if (playbackTimes) {
        displayCurrentTimeFormatted = playbackTimes.currentTimeFormatted || "00:00";
        displayCurrentTime = playbackTimes.currentTime || 0;
        displayItemDuration = playbackTimes.duration || 0;
        displayItemDurationFormatted = playbackTimes.durationFormatted || "00:00";
        
        if (typeof playbackTimes.remainingTime === 'number') {
            displayItemRemainingTime = playbackTimes.remainingTime;
            displayItemRemainingTimeFormatted = playbackTimes.remainingTimeFormatted || formatTimeMMSS(playbackTimes.remainingTime) || "";
        } else if (displayItemDuration > 0 && displayCurrentTime <= displayItemDuration) {
            displayItemRemainingTime = displayItemDuration - displayCurrentTime;
            displayItemRemainingTimeFormatted = formatTimeMMSS(displayItemRemainingTime);
        }

        const instanceCount = playbackTimes.instanceCount || 1;
        
        // Update instance counter display
        // Always re-query to be safe, or use the scoped variable if we trust it (we query by class so it should be fine)
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) {
            if (instanceCount > 1) {
                instanceCounter.textContent = `x${instanceCount}`;
                instanceCounter.style.display = 'block';
            } else {
                instanceCounter.style.display = 'none';
            }
        }
    } else {
        // Explicitly hide counter if no playback state (stopped)
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) instanceCounter.style.display = 'none';
        
        uiLog.warn(`[CueGrid UpdateCueButtonTime] cueId: ${cueId}, getPlaybackTimes returned null. Using default display values.`);
    }

    const hasLiveMeter = cueMeterLiveSources.has(cueId);
    if (!hasLiveMeter) {
        const fallbackVolume = cueFromStore && cueFromStore.volume !== undefined ? cueFromStore.volume : 0;
        const meterVolume = playbackTimes && typeof playbackTimes.volume === 'number'
            ? playbackTimes.volume
            : fallbackVolume;
        const meterActive = !!(playbackTimes && (playbackTimes.isPlaying || playbackTimes.isFadingIn || playbackTimes.isFadingOut) || isFadingIn || isFadingOut);
        setCueMeterLevel(cueId, meterActive ? meterVolume : 0, { immediate: !meterActive });
    }

    _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs);
    applyCueBadgeState(cueId, playbackTimes);
}

// New function that uses time data directly from IPC instead of calling audioController.getPlaybackTimes()
function updateCueButtonTimeWithData(cueId, timeData, elements = null, isFadingIn = false, isFadingOut = false, fadeTimeRemainingMs = 0) {
    if (!cueStore) {
        uiLog.warn(`updateCueButtonTimeWithData: cueStore not ready for cue ${cueId}`);
        return;
    }

    const cueFromStore = cueStore.getCueById(cueId);
    if (!cueFromStore) {
        return;
    }

    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button) {
        return;
    }

    let localElements = elements;
    if (!localElements) {
        localElements = {
            current: button.querySelector(`#cue-time-current-${cueId}`),
            total: button.querySelector(`#cue-time-total-${cueId}`),
            remaining: button.querySelector(`#cue-time-remaining-${cueId}`),
            separator: button.querySelector(`#cue-time-separator-${cueId}`)
        };
    }

    // Use the provided time data directly
    const displayCurrentTimeFormatted = timeData.currentTimeFormatted || "00:00";
    const displayCurrentTime = timeData.currentTime || 0;
    const displayItemDuration = timeData.duration || 0;
    const displayItemDurationFormatted = timeData.durationFormatted || "00:00";
    const displayItemRemainingTime = timeData.remainingTime || 0;
    const displayItemRemainingTimeFormatted = timeData.remainingTimeFormatted || "";

    const hasLiveMeter = cueMeterLiveSources.has(cueId);
    if (!hasLiveMeter) {
        const meterVolume = typeof timeData.volume === 'number' ? timeData.volume : 0;
        const status = timeData.status || '';
        const statusActive = status === 'playing' || status === 'fading';
        const meterActive = statusActive || isFadingIn || isFadingOut;
        setCueMeterLevel(cueId, meterActive ? meterVolume : 0, { immediate: !meterActive });
    }

    _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs);
    applyCueBadgeState(cueId, timeData);

    const appConfig = getAppConfigForWaveform();
    if (shouldShowButtonWaveform(cueFromStore, appConfig)) {
        const drawCue = buildCueForWaveformDraw(cueFromStore, {
            currentTime: displayCurrentTime,
            duration: displayItemDuration
        });
        updateButtonWaveformPlayhead(button, drawCue, appConfig);
    }
}

// Helper function to update the button display (extracted from original updateCueButtonTime)
function _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs) {

    if (localElements.current) localElements.current.textContent = displayCurrentTimeFormatted;
    if (localElements.separator) localElements.separator.textContent = (displayCurrentTime > 0 || displayItemDuration > 0) ? ' / ' : '';
    if (localElements.total) {
        localElements.total.textContent = displayItemDurationFormatted;
    }
    if (localElements.remaining) {
        const showRemaining = displayItemRemainingTime > 0 && displayCurrentTime < displayItemDuration;
        localElements.remaining.textContent = showRemaining ? `-${displayItemRemainingTimeFormatted}` : '';
        localElements.remaining.style.display = showRemaining ? 'inline' : 'none';
    }

    const isActuallyFading = (isFadingIn || isFadingOut) && fadeTimeRemainingMs > 0;

    // Clear previous fade-specific classes first
    button.classList.remove('fading', 'fading-in', 'fading-out');

    if (isActuallyFading) {
        button.classList.add('fading');
        // Don't remove playing/paused if it's just starting to fade from that state
        // button.classList.remove('playing', 'paused', 'stopped', 'cued'); 

        if (isFadingOut) {
            button.classList.add('fading-out');
            button.classList.remove('fading-in'); // Ensure only one fade direction class
        } else if (isFadingIn) {
            button.classList.add('fading-in');
            button.classList.remove('fading-out');
        }

        if (localElements.current) localElements.current.textContent = `Fading: ${(fadeTimeRemainingMs / 1000).toFixed(1)}s`;
        if (localElements.separator) localElements.separator.textContent = '';
        if (localElements.total) localElements.total.textContent = '';
        if (localElements.remaining) {
            localElements.remaining.textContent = '';
            localElements.remaining.style.display = 'none';
        }
    } else {
        // Not fading, ensure normal time display
        // Class 'fading', 'fading-in', 'fading-out' are already removed above
        if (localElements.current) localElements.current.textContent = displayCurrentTimeFormatted;
        if (localElements.separator) localElements.separator.textContent = (displayCurrentTime > 0 || displayItemDuration > 0) ? ' / ' : '';
        if (localElements.total) localElements.total.textContent = displayItemDurationFormatted;
        if (localElements.remaining) {
            const showRemaining = displayItemRemainingTime > 0 && displayCurrentTime < displayItemDuration;
            localElements.remaining.textContent = showRemaining ? `-${displayItemRemainingTimeFormatted}` : '';
            localElements.remaining.style.display = showRemaining ? 'inline' : 'none';
        }
    }
}

function refreshEditCardIndicators(cueId) {
    if (!cueStore || !cueGridContainer) return;
    const cue = cueStore.getCueById(cueId);
    const card = cueGridContainer.querySelector(`.cue-edit-card[data-cue-id="${cueId}"]`);
    if (cue && card) {
        updateCueIndicatorStrip(card, cue, getAppConfigForWaveform());
        refreshEditCardLoopState(cueId);
    }
}

function refreshAllCueBadges() {
    if (!cueStore) return;
    cueStore.getAllCues().forEach((cue) => {
        applyCueBadgeState(cue.id);
        refreshEditCardIndicators(cue.id);
    });
}

function applyCueBadgeState(cueId, playbackState = null) {
    if (!cueStore) return;
    const cue = cueStore.getCueById(cueId);
    if (!cue) return;

    const badges = cueBadgeElements[cueId];
    if (!badges) return;

    const isDuckingTrigger = !!cue.isDuckingTrigger;
    const isCurrentlyDucked = !!(playbackState?.isDucked);

    const button = document.getElementById(`cue-btn-${cueId}`);
    if (button) {
        updateCueIndicatorStrip(button, cue, getAppConfigForWaveform());
    }
    refreshEditCardIndicators(cueId);

    if (badges.duckTriggerIcon) {
        badges.duckTriggerIcon.classList.toggle('visible', isDuckingTrigger);
        badges.duckTriggerIcon.classList.toggle('active', isDuckingTrigger);
    }

    const enableDucking = !!cue.enableDucking;
    if (badges.duckActiveIcon) {
        const duckIconShouldShow = enableDucking || isCurrentlyDucked;
        badges.duckActiveIcon.classList.toggle('visible', duckIconShouldShow);
        badges.duckActiveIcon.classList.toggle('active', isCurrentlyDucked);
    }

    if (badges.duckStrip) {
        const duckVisible =
            (badges.duckTriggerIcon?.classList.contains('visible') ?? false) ||
            (badges.duckActiveIcon?.classList.contains('visible') ?? false);
        badges.duckStrip.style.display = duckVisible ? 'flex' : 'none';
    }
}

function syncCueMeterContainerVisibility(cueId, isPlaying) {
    const meterRefs = cueMeterElements[cueId];
    if (!meterRefs?.container) return;
    const cue = cueStore?.getCueById?.(cueId);
    const appConfig = getAppConfigForWaveform();
    const visible = isPlaying && shouldShowCueMeter(cue, appConfig);
    meterRefs.container.classList.toggle('cue-audio-meter-visible', visible);
}

function refreshAllCueMeterVisibility() {
    if (!cueStore) return;
    const cues = cueStore.getAllCues() || [];
    const ac = audioController?.default || audioController;
    cues.forEach((cue) => {
        const playing = ac && typeof ac.isPlaying === 'function' ? ac.isPlaying(cue.id) : false;
        syncCueMeterContainerVisibility(cue.id, playing);
    });
}

function setCueMeterLevel(cueId, level, { immediate = false, meterDbfs = null, isPlaying = false } = {}) {
    const meterRefs = cueMeterElements[cueId];
    const mask = meterRefs?.mask;
    if (!mask) return;

    const targetRatio = isPlaying ? dbfsToMeterRatio(meterDbfs) : 0;
    const showMeterActivity = isPlaying && (
        targetRatio > 0.01 || (Number.isFinite(meterDbfs) && meterDbfs > CUE_METER_FLOOR_DBFS)
    );

    const previousLevel = cueMeterLevels[cueId] ?? 0;
    const smoothingFactor = immediate ? 1 : METER_SMOOTHING;
    const smoothedLevel = showMeterActivity
        ? previousLevel + (targetRatio - previousLevel) * smoothingFactor
        : previousLevel + (0 - previousLevel) * (immediate ? 1 : 0.5);
    cueMeterLevels[cueId] = smoothedLevel;

    const litPct = smoothedLevel <= 0 ? 0 : Math.max(METER_MIN_HEIGHT_PERCENT / 100, smoothedLevel);
    mask.style.height = `${Math.max(0, (1 - litPct) * 100)}%`;

    const container = meterRefs?.container;
    if (container) {
        container.classList.toggle('cue-audio-meter-active', showMeterActivity && smoothedLevel > 0.02);
    }

    if (meterRefs?.dbfsEl) {
        meterRefs.dbfsEl.textContent = showMeterActivity && meterDbfs != null
            ? formatCueMeterDbfsLabel(meterDbfs)
            : '';
    }

    const showPeakHold = showMeterActivity
        && updateCueMeterPeakHold(cueMeterPeakHoldUntil, cueId, meterDbfs);
    if (meterRefs?.peakHoldLine) {
        meterRefs.peakHoldLine.classList.toggle('visible', showPeakHold);
    }
    if (!showMeterActivity && meterRefs?.peakHoldLine) {
        meterRefs.peakHoldLine.classList.remove('visible');
    }

    syncCueMeterContainerVisibility(cueId, showMeterActivity);
}

function updateCueMeterLevel(cueId, level, { immediate = false, meterDbfs = null, isPlaying = false } = {}) {
    cueMeterLiveSources.add(cueId);
    setCueMeterLevel(cueId, level, { immediate, meterDbfs, isPlaying });
}

function clearCueMeterClipState(cueId) {
    clearCueMeterPeakHold(cueMeterPeakHoldUntil, cueId);
    const meterRefs = cueMeterElements[cueId];
    if (meterRefs?.peakHoldLine) {
        meterRefs.peakHoldLine.classList.remove('visible');
    }
}

function resetCueMeter(cueId, { immediate = true } = {}) {
    if (cueMeterLiveSources.has(cueId)) {
        cueMeterLiveSources.delete(cueId);
    }
    clearCueMeterPeakHold(cueMeterPeakHoldUntil, cueId);
    const meterRefs = cueMeterElements[cueId];
    if (meterRefs?.peakHoldLine) {
        meterRefs.peakHoldLine.classList.remove('visible');
    }
    if (meterRefs?.dbfsEl) {
        meterRefs.dbfsEl.textContent = '';
    }
    if (meterRefs?.mask) {
        meterRefs.mask.style.height = '100%';
    }
    setCueMeterLevel(cueId, 0, { immediate, meterDbfs: null, isPlaying: false });
    syncCueMeterContainerVisibility(cueId, false);
}

function formatTimeMMSS(timeInSeconds) {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) {
        return "00:00";
    }
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateAllCueButtonTimes() {
    if (!isInitialized || !cueStore || !audioController) {
        uiLog.warn('updateAllCueButtonTimes: CueGrid not initialized or dependencies missing');
        return;
    }
    
    const cues = cueStore.getAllCues();
    if (!cues || cues.length === 0) {
        return;
    }
    
    cues.forEach(cue => {
        updateCueButtonTime(cue.id);
    });
}

export {
    renderCues,
    updateButtonPlayingState,
    updateCueButtonTime,
    updateCueButtonTimeWithData,
    updateCueMeterLevel,
    resetCueMeter,
    clearCueMeterClipState,
    refreshAllCueMeterVisibility,
    applyCueBadgeState,
    refreshAllCueBadges,
    getSelectedCueIds,
    getPrimarySelectedCueId,
    refreshCueCardAppearance,
    refreshMissingMediaState,
    ensureMissingMediaState,
    promptMissingMediaAlert,
    configureMissingMediaAlerts
};