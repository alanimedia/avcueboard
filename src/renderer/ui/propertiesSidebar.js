import * as waveformControls from './waveformControls.js';
import { debounce } from './utils.js';
import { flashTrimBadgeForCue } from '../cueTrimBadgeUtils.js';

// Import the new modular components
import { 
    cachePropertiesSidebarDOMElements, 
    getDOMElement, 
    showPropertiesSidebar, 
    hidePropertiesSidebar as hideSidebar,
    updateDuckingControlsVisibility,
    syncAudioFilePathDisplay
} from './propertiesSidebarDOM.js';
import { 
    initPlaylistManager, 
    setStagedPlaylistItems, 
    getStagedPlaylistItems,
    renderPlaylistInProperties,
    highlightPlayingPlaylistItemInSidebar
} from './propertiesSidebarPlaylist.js';
import { 
    initFormManager, 
    setCurrentWaveformTrim, 
    getCurrentWaveformTrim,
    saveCueProperties,
    deleteCueProperties,
    populateFormWithCueData
} from './propertiesSidebarForm.js';
import { initButtonColorPicker, refreshRecentSwatches } from './buttonColorPicker.js';
import * as appConfigUI from './appConfigUI.js';
import { 
    initEventHandlers, 
    bindPropertiesSidebarEventListeners,
    updateActivePropertiesCueId
} from './propertiesSidebarEvents.js';
import {
    populateRetriggerSelect,
    updateRetriggerHelpText,
    renderRetriggerLegend
} from '../retriggerBehaviorCatalog.js';
import { pathsReferToSameAudioFile } from '../audioPathCompareUtils.js';
import { formatWaveformTime } from './waveformControls.js';

let cueStore;
let audioController;
let ipcRendererBindingsModule;
let uiCore; // For isEditMode, getCurrentAppConfig

// --- State for Properties Sidebar ---
let activePropertiesCueId = null;
let activePropertiesCueIds = [];
let debouncedSaveCueProperties;

function runWithSuppressedPropertiesAutoSave(fn) {
    window._suppressPropertiesAutoSave = true;
    try {
        return fn();
    } finally {
        queueMicrotask(() => {
            window._suppressPropertiesAutoSave = false;
        });
    }
}

function cancelPendingPropertiesSave() {
    debouncedSaveCueProperties?.cancel?.();
}

// --- Helper Functions (Specific to Properties or shared & simple enough to keep) ---

function setupRetriggerPropertyUi() {
    const select = getDOMElement('propRetriggerBehaviorSelect');
    const help = document.getElementById('propRetriggerBehaviorHelp');
    const legend = document.getElementById('propRetriggerLegend');
    populateRetriggerSelect(select, { includeDefault: true });
    renderRetriggerLegend(legend);
    if (select) {
        select.addEventListener('change', () => {
            updateRetriggerHelpText(select, help, { includeDefault: true });
        });
    }
}

// --- Initialization ---
function initPropertiesSidebar(csModule, acModule, ipcAPI, uiCoreInterfaceRef) {
    cueStore = csModule;
    audioController = acModule;
    ipcRendererBindingsModule = ipcAPI;
    uiCore = uiCoreInterfaceRef;

    window.__refreshActiveCueCardAppearance = refreshActiveCueCardAppearance;

    // Initialize DOM elements
    cachePropertiesSidebarDOMElements();
    setupRetriggerPropertyUi();
    
    // Log cached elements to verify they are found
    console.log('[PropertiesSidebarInit] Cached DOM elements after cachePropertiesSidebarDOMElements:');
    console.log('  propCueNameInput:', getDOMElement('propCueNameInput') ? 'Found' : 'NOT FOUND');
    console.log('  propLoopCheckbox:', getDOMElement('propLoopCheckbox') ? 'Found' : 'NOT FOUND');

    // Initialize debounced save function
    debouncedSaveCueProperties = debounce(handleSaveCueProperties, 500);
    console.log('[PropertiesSidebarInit] debouncedSaveCueProperties initialized:', typeof debouncedSaveCueProperties);

    // Initialize all modules
    initFormManager(cueStore, audioController, uiCore);
    initPlaylistManager(debouncedSaveCueProperties, ipcRendererBindingsModule);
    initButtonColorPicker(
        debouncedSaveCueProperties,
        () => uiCore.getCurrentAppConfig(),
        appConfigUI.savePartialAppConfiguration,
        (colorState) => {
            const cueIds = activePropertiesCueIds.length > 0
                ? activePropertiesCueIds
                : (activePropertiesCueId ? [activePropertiesCueId] : []);
            const buttonColor = colorState?.useDefault ? null : colorState?.color;
            cueIds.forEach((cueId) => {
                if (typeof window.__refreshCueCardAppearance === 'function') {
                    window.__refreshCueCardAppearance(cueId, buttonColor);
                }
            });
        }
    );
    
    // Get DOM elements for event handlers
    const domElements = {
        closePropertiesSidebarBtn: getDOMElement('closePropertiesSidebarBtn'),
        saveCuePropertiesButton: getDOMElement('saveCuePropertiesButton'),
        deleteCuePropertiesButton: getDOMElement('deleteCuePropertiesButton'),
        propCueTypeSelect: getDOMElement('propCueTypeSelect'),
        propPlaylistConfigDiv: getDOMElement('propPlaylistConfigDiv'),
        propSingleFileConfigDiv: getDOMElement('propSingleFileConfigDiv'),
        propFilePathInput: getDOMElement('propFilePathInput'),
        propVolumeRangeInput: getDOMElement('propVolumeRangeInput'),
        propVolumeValueSpan: getDOMElement('propVolumeValueSpan'),
        propDuckingLevelInput: getDOMElement('propDuckingLevelInput'),
        propDuckingLevelValueSpan: getDOMElement('propDuckingLevelValueSpan'),
        propCueNameInput: getDOMElement('propCueNameInput'),
        propFadeInTimeInput: getDOMElement('propFadeInTimeInput'),
        propFadeOutTimeInput: getDOMElement('propFadeOutTimeInput'),
        propVolumeRangeInput: getDOMElement('propVolumeRangeInput'),
        propRetriggerBehaviorSelect: getDOMElement('propRetriggerBehaviorSelect'),
        propPlaylistPlayModeSelect: getDOMElement('propPlaylistPlayModeSelect'),
        propLoopCheckbox: getDOMElement('propLoopCheckbox'),
        propShowButtonWaveformSelect: getDOMElement('propShowButtonWaveformSelect'),
        propShufflePlaylistCheckbox: getDOMElement('propShufflePlaylistCheckbox'),
        propRepeatOnePlaylistItemCheckbox: getDOMElement('propRepeatOnePlaylistItemCheckbox'),
        propIsDuckingTriggerCheckbox: getDOMElement('propIsDuckingTriggerCheckbox'),
        propEnableDuckingCheckbox: getDOMElement('propEnableDuckingCheckbox'),
        propPlaylistItemsUl: getDOMElement('propPlaylistItemsUl'),
        propPlaylistFilePathDisplay: getDOMElement('propPlaylistFilePathDisplay'),
        propBrowseAudioFileBtn: getDOMElement('propBrowseAudioFileBtn')
    };
    
    initEventHandlers(debouncedSaveCueProperties, (cueId) => { activePropertiesCueId = cueId; }, cueStore, domElements, ipcRendererBindingsModule, audioController);
    bindPropertiesSidebarEventListeners(hidePropertiesSidebar, handleDeleteCueProperties, renderPlaylistInPropertiesWrapper, setStagedPlaylistItems, handleBrowseAudioFile);
    
    console.log('Properties Sidebar Module Initialized');
}



function updatePropertiesSidebarHeader(selectedCount) {
    const title = document.querySelector('#propertiesSidebar .properties-sidebar-header h2');
    if (!title) return;
    title.textContent = selectedCount > 1
        ? `Cue Properties (${selectedCount} selected)`
        : 'Cue Properties';
}

function setBulkEditMode(isMultiSelect) {
    const sidebar = getDOMElement('propertiesSidebar');
    if (sidebar) {
        sidebar.classList.toggle('properties-bulk-mode', isMultiSelect);
    }
    const bulkNote = document.getElementById('propertiesBulkEditNote');
    if (bulkNote) {
        bulkNote.classList.toggle('hidden', !isMultiSelect);
    }

    const nameInput = getDOMElement('propCueNameInput');
    const typeSelect = getDOMElement('propCueTypeSelect');
    const fileInput = getDOMElement('propFilePathInput');
    const browseBtn = getDOMElement('propBrowseAudioFileBtn');
    if (nameInput) {
        nameInput.disabled = isMultiSelect;
        nameInput.title = isMultiSelect ? 'Name can only be edited for a single selected cue' : '';
    }
    if (typeSelect) {
        typeSelect.disabled = isMultiSelect;
        typeSelect.title = isMultiSelect ? 'Type can only be edited for a single selected cue' : '';
    }
    if (fileInput) {
        fileInput.disabled = isMultiSelect;
    }
    const pathDisplay = document.getElementById('propFilePathDisplay');
    if (pathDisplay) {
        pathDisplay.classList.toggle('audio-file-path-display--disabled', isMultiSelect);
        pathDisplay.title = isMultiSelect ? 'Audio file can only be edited for a single selected cue' : (pathDisplay.textContent || '');
    }
    if (browseBtn) {
        browseBtn.disabled = isMultiSelect;
        browseBtn.title = isMultiSelect ? 'Audio file can only be edited for a single selected cue' : 'Choose a different audio file';
    }
}

function setPerCueFieldsDisabled(isMultiSelect) {
    setBulkEditMode(isMultiSelect);
}

function getPropertiesDomElements() {
    return {
        propCueIdInput: getDOMElement('propCueIdInput'),
        propCueNameInput: getDOMElement('propCueNameInput'),
        propCueTypeSelect: getDOMElement('propCueTypeSelect'),
        propPlaylistConfigDiv: getDOMElement('propPlaylistConfigDiv'),
        propSingleFileConfigDiv: getDOMElement('propSingleFileConfigDiv'),
        propFilePathInput: getDOMElement('propFilePathInput'),
        propPlaylistItemsUl: getDOMElement('propPlaylistItemsUl'),
        propPlaylistFilePathDisplay: getDOMElement('propPlaylistFilePathDisplay'),
        propFadeInTimeInput: getDOMElement('propFadeInTimeInput'),
        propFadeOutTimeInput: getDOMElement('propFadeOutTimeInput'),
        propLoopCheckbox: getDOMElement('propLoopCheckbox'),
        propShowButtonWaveformSelect: getDOMElement('propShowButtonWaveformSelect'),
        propTrimStartTimeInput: getDOMElement('propTrimStartTimeInput'),
        propTrimEndTimeInput: getDOMElement('propTrimEndTimeInput'),
        propTrimConfig: getDOMElement('propTrimConfig'),
        propVolumeRangeInput: getDOMElement('propVolumeRangeInput'),
        propVolumeValueSpan: getDOMElement('propVolumeValueSpan'),
        propVolumeSlider: getDOMElement('propVolumeSlider'),
        propVolumeValueDisplay: getDOMElement('propVolumeValueDisplay'),
        propRetriggerBehaviorSelect: getDOMElement('propRetriggerBehaviorSelect'),
        propShufflePlaylistCheckbox: getDOMElement('propShufflePlaylistCheckbox'),
        propRepeatOnePlaylistItemCheckbox: getDOMElement('propRepeatOnePlaylistItemCheckbox'),
        propPlaylistPlayModeSelect: getDOMElement('propPlaylistPlayModeSelect'),
        propEnableDuckingCheckbox: getDOMElement('propEnableDuckingCheckbox'),
        propDuckingLevelInput: getDOMElement('propDuckingLevelInput'),
        propDuckingLevelValueSpan: getDOMElement('propDuckingLevelValueSpan'),
        propIsDuckingTriggerCheckbox: getDOMElement('propIsDuckingTriggerCheckbox')
    };
}

function selectionIdsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((id, index) => id === sortedB[index]);
}

function applyBulkLoopCheckboxState(cueIds) {
    const loopCheckbox = getDOMElement('propLoopCheckbox');
    if (!loopCheckbox || !cueStore || !Array.isArray(cueIds) || cueIds.length <= 1) {
        if (loopCheckbox) loopCheckbox.indeterminate = false;
        return;
    }

    const loopValues = cueIds.map((id) => !!cueStore.getCueById(id)?.loop);
    const allSame = loopValues.every((value) => value === loopValues[0]);
    loopCheckbox.indeterminate = !allSame;
    if (allSame) {
        loopCheckbox.checked = loopValues[0];
    }
}

function refreshPropertiesSidebarInPlace(cue, cueIds) {
    activePropertiesCueIds = [...cueIds];
    activePropertiesCueId = cue.id;
    updateActivePropertiesCueId(cue.id);
    updatePropertiesSidebarHeader(cueIds.length);
    setPerCueFieldsDisabled(cueIds.length > 1);
    setCurrentWaveformTrim(cue.trimStartTime || 0, cue.trimEndTime);

    const domElements = getPropertiesDomElements();
    syncAudioFilePathDisplay(cue.filePath);
    if (domElements.propTrimStartTimeInput) {
        domElements.propTrimStartTimeInput.value = waveformControls.formatWaveformTime(cue.trimStartTime || 0);
    }
    if (domElements.propTrimEndTimeInput) {
        domElements.propTrimEndTimeInput.value = (cue.trimEndTime != null)
            ? waveformControls.formatWaveformTime(cue.trimEndTime)
            : 'End';
    }

    waveformControls.refreshWaveformRegionsForCue?.(cue);
    applyBulkLoopCheckboxState(cueIds);
}

function openPropertiesSidebarForSelection(cueIds, primaryCueId = null) {
    if (!cueIds?.length || !cueStore) return;
    const primaryId = (primaryCueId && cueIds.includes(primaryCueId))
        ? primaryCueId
        : cueIds[cueIds.length - 1];
    const cue = cueStore.getCueById(primaryId);
    if (!cue) return;

    const propertiesSidebar = getDOMElement('propertiesSidebar');
    const sidebarVisible = propertiesSidebar && !propertiesSidebar.classList.contains('hidden');
    const previousPrimaryId = activePropertiesCueId;
    const previousCueIds = [...activePropertiesCueIds];
    const primaryChanged = previousPrimaryId !== primaryId;
    const selectionChanged = !selectionIdsEqual(previousCueIds, cueIds);
    const sameSelection = sidebarVisible && !primaryChanged && !selectionChanged;

    if (sameSelection) {
        runWithSuppressedPropertiesAutoSave(() => {
            refreshPropertiesSidebarInPlace(cue, cueIds);
        });
        return;
    }

    activePropertiesCueIds = [...cueIds];
    activePropertiesCueId = primaryId;
    updateActivePropertiesCueId(primaryId);
    updatePropertiesSidebarHeader(cueIds.length);
    setPerCueFieldsDisabled(cueIds.length > 1);

    refreshRecentSwatches();

    runWithSuppressedPropertiesAutoSave(() => {
        populateFormWithCueData(
            cue,
            getPropertiesDomElements(),
            setStagedPlaylistItems,
            renderPlaylistInPropertiesWrapper,
            waveformControls.showWaveformForCue,
            waveformControls.hideAndDestroyWaveform,
            updateDuckingControlsVisibility
        );
        applyBulkLoopCheckboxState(cueIds);
    });

    showPropertiesSidebar();

    requestAnimationFrame(() => {
        syncAudioFilePathDisplay(cue.filePath);
    });

    if (cue.type === 'single_file' && cue.filePath) {
        uiCore?.showMainWaveformForCue?.(cue);
    } else {
        uiCore?.clearMainWaveformPreview?.();
    }
}

// --- Properties Sidebar Specific Functions ---
function openPropertiesSidebar(cue) {
    openPropertiesSidebarForSelection([cue.id], cue.id);
}

function hidePropertiesSidebar() {
    hideSidebar();
    activePropertiesCueId = null;
    activePropertiesCueIds = [];
    setBulkEditMode(false);
    updatePropertiesSidebarHeader(1);
    setStagedPlaylistItems([]);
    waveformControls.hideAndDestroyWaveform();
    uiCore?.clearMainWaveformPreview?.();
}

function isPropertiesSidebarOpen() {
    const propertiesSidebar = getDOMElement('propertiesSidebar');
    return !!(propertiesSidebar && !propertiesSidebar.classList.contains('hidden'));
}

function refreshActiveCueCardAppearance() {
    const cueIds = activePropertiesCueIds.length > 0
        ? activePropertiesCueIds
        : (activePropertiesCueId ? [activePropertiesCueId] : []);
    cueIds.forEach((cueId) => {
        const cue = cueStore?.getCueById?.(cueId);
        if (cue && typeof window.__refreshCueCardAppearance === 'function') {
            window.__refreshCueCardAppearance(cueId, cue.buttonColor);
        }
    });
}

// Wrapper function for playlist rendering
function renderPlaylistInPropertiesWrapper() {
    const propPlaylistItemsUl = getDOMElement('propPlaylistItemsUl');
    const propPlaylistFilePathDisplay = getDOMElement('propPlaylistFilePathDisplay');
    renderPlaylistInProperties(propPlaylistItemsUl, propPlaylistFilePathDisplay);
}


async function handleSaveCueProperties() {
    if (window._suppressPropertiesAutoSave) {
        console.log('[PropertiesSidebar] Skipping save — selection/form sync in progress');
        return;
    }
    const cueIds = activePropertiesCueIds.length > 0
        ? activePropertiesCueIds
        : (activePropertiesCueId ? [activePropertiesCueId] : []);
    console.log('[PropertiesSidebar] handleSaveCueProperties CALLED. Cue IDs:', cueIds);
    if (!cueIds.length) {
        console.warn('[PropertiesSidebar] handleSaveCueProperties: No active cue IDs');
        return;
    }

    const domElements = {
        propCueNameInput: getDOMElement('propCueNameInput'),
        propCueTypeSelect: getDOMElement('propCueTypeSelect'),
        propFilePathInput: getDOMElement('propFilePathInput'),
        propFadeInTimeInput: getDOMElement('propFadeInTimeInput'),
        propFadeOutTimeInput: getDOMElement('propFadeOutTimeInput'),
        propLoopCheckbox: getDOMElement('propLoopCheckbox'),
        propShowButtonWaveformSelect: getDOMElement('propShowButtonWaveformSelect'),
        propVolumeSlider: getDOMElement('propVolumeSlider'),
        propRetriggerBehaviorSelect: getDOMElement('propRetriggerBehaviorSelect'),
        propShufflePlaylistCheckbox: getDOMElement('propShufflePlaylistCheckbox'),
        propRepeatOnePlaylistItemCheckbox: getDOMElement('propRepeatOnePlaylistItemCheckbox'),
        propPlaylistPlayModeSelect: getDOMElement('propPlaylistPlayModeSelect'),
        propEnableDuckingCheckbox: getDOMElement('propEnableDuckingCheckbox'),
        propDuckingLevelInput: getDOMElement('propDuckingLevelInput'),
        propIsDuckingTriggerCheckbox: getDOMElement('propIsDuckingTriggerCheckbox')
    };

    return await saveCueProperties(cueIds, domElements, getStagedPlaylistItems());
}

async function handleDeleteCueProperties() {
    const success = await deleteCueProperties(activePropertiesCueId);
    if (success) {
        hidePropertiesSidebar();
    }
}

function getActivePropertiesCueIds() {
    return activePropertiesCueIds.length > 0
        ? [...activePropertiesCueIds]
        : (activePropertiesCueId ? [activePropertiesCueId] : []);
}

function getActivePropertiesCueId() {
    return activePropertiesCueId;
}

function updateTrimInputsInSidebar(trimStart, trimEnd) {
    const trimStartInput = getDOMElement('propTrimStartTimeInput');
    const trimEndInput = getDOMElement('propTrimEndTimeInput');
    if (trimStartInput) {
        trimStartInput.value = formatWaveformTime(trimStart || 0);
    }
    if (trimEndInput) {
        trimEndInput.value = (trimEnd !== undefined && trimEnd !== null)
            ? formatWaveformTime(trimEnd)
            : 'End';
    }
}

async function assignAudioFileToActiveCue(filePath) {
    if (!activePropertiesCueId) return false;
    if (activePropertiesCueIds.length > 1) return false;

    const activeCue = cueStore.getCueById(activePropertiesCueId);
    if (!activeCue || (activeCue.type !== 'single_file' && activeCue.type !== 'single')) return false;

    if (!filePath || !String(filePath).trim()) return false;

    let resolvedPath = String(filePath).trim();
    const hasDirectory = resolvedPath.includes('/') || resolvedPath.includes('\\') || /^[a-zA-Z]:/.test(resolvedPath);
    if (!hasDirectory && ipcRendererBindingsModule?.resolveAudioPath) {
        try {
            const resolveResult = await ipcRendererBindingsModule.resolveAudioPath(resolvedPath);
            if (resolveResult?.success && resolveResult.path) {
                resolvedPath = resolveResult.path;
            } else {
                alert('Could not resolve the audio file path. Choose the file using Browse or drag it from File Explorer.');
                return false;
            }
        } catch (error) {
            console.error('[PropertiesSidebar] Failed to resolve audio path:', error);
            alert('Could not resolve the audio file path. Try Browse or drag from File Explorer.');
            return false;
        }
    }

    const oldPath = activeCue.filePath || '';
    const sameFile = await pathsReferToSameAudioFile(
        oldPath,
        resolvedPath,
        ipcRendererBindingsModule?.resolveAudioPath
    );

    let trimStart = activeCue.trimStartTime || 0;
    let trimEnd = activeCue.trimEndTime;
    if (!sameFile) {
        trimStart = 0;
        trimEnd = undefined;
    }

    setCurrentWaveformTrim(trimStart, trimEnd);
    updateTrimInputsInSidebar(trimStart, trimEnd);

    const propFilePathInput = getDOMElement('propFilePathInput');
    if (!propFilePathInput) return false;

    syncAudioFilePathDisplay(resolvedPath);

    const cueForWaveform = {
        ...activeCue,
        filePath: resolvedPath,
        trimStartTime: trimStart,
        trimEndTime: trimEnd
    };
    waveformControls.showWaveformForCue(cueForWaveform);

    cancelPendingPropertiesSave();
    await handleSaveCueProperties();

    if (!sameFile && typeof window.__refreshEditCardIndicators === 'function') {
        window.__refreshEditCardIndicators(activePropertiesCueId);
    }

    return true;
}

async function setFilePathInProperties(filePath) {
    return assignAudioFileToActiveCue(filePath);
}

async function handleBrowseAudioFile() {
    if (!activePropertiesCueId || activePropertiesCueIds.length > 1) return;
    if (!ipcRendererBindingsModule?.showOpenDialog) {
        alert('File browser is not available.');
        return;
    }

    const activeCue = cueStore.getCueById(activePropertiesCueId);
    const defaultPath = activeCue?.filePath || undefined;

    try {
        const result = await ipcRendererBindingsModule.showOpenDialog({
            title: 'Select Audio File',
            defaultPath,
            properties: ['openFile'],
            filters: [
                { name: 'Audio Files', extensions: ['wav', 'mp3', 'aac', 'm4a', 'ogg', 'flac', 'aiff', 'wma'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result || result.canceled || !result.filePaths?.length) {
            return;
        }

        await assignAudioFileToActiveCue(result.filePaths[0]);
    } catch (error) {
        console.error('[PropertiesSidebar] Browse audio file failed:', error);
        alert(`Could not open file browser: ${error.message}`);
    }
}

function showWaveformTrimStatus(state) {
    const el = document.getElementById('wfTrimStatus');
    if (!el) return;

    el.classList.remove('wf-trim-status--saving', 'wf-trim-status--saved');
    if (state === 'saving') {
        el.textContent = 'Saving trim…';
        el.classList.add('wf-trim-status--saving');
        return;
    }
    if (state === 'saved') {
        el.textContent = 'Trim saved';
        el.classList.add('wf-trim-status--saved');
        clearTimeout(showWaveformTrimStatus._resetTimer);
        showWaveformTrimStatus._resetTimer = setTimeout(() => {
            el.classList.remove('wf-trim-status--saved');
            el.textContent = 'Drag handles or use skip buttons — trim saves automatically';
        }, 2500);
        return;
    }
    el.textContent = 'Drag handles or use skip buttons — trim saves automatically';
}

function handleCuePropertyChangeFromWaveform(trimStart, trimEnd) {
    if (!activePropertiesCueId) return;
    
    // Update trim values in form manager
    setCurrentWaveformTrim(trimStart, trimEnd);
    
    // Set flag to prevent properties sidebar / grid refresh loops
    window._waveformTrimUpdateInProgress = true;
    showWaveformTrimStatus('saving');
    
    // Save immediately so playback uses fresh trim values
    handleSaveCueProperties().then((success) => {
        if (success !== false) {
            showWaveformTrimStatus('saved');
            flashTrimBadgeForCue(activePropertiesCueId);
            if (typeof window.__refreshEditCardIndicators === 'function') {
                window.__refreshEditCardIndicators(activePropertiesCueId);
            }
        } else {
            showWaveformTrimStatus();
        }
    }).catch(() => {
        showWaveformTrimStatus();
    }).finally(() => {
        setTimeout(() => {
            window._waveformTrimUpdateInProgress = false;
            console.log('PropertiesSidebar: Cleared waveform trim update flag');
        }, 300);
    });
}

function highlightPlayingPlaylistItemInSidebarWrapper(cueId, playlistItemId) {
    const propPlaylistItemsUl = getDOMElement('propPlaylistItemsUl');
    highlightPlayingPlaylistItemInSidebar(cueId, playlistItemId, activePropertiesCueId, propPlaylistItemsUl);
}

// New function to refresh the playlist view if it's the active cue
function refreshPlaylistPropertiesView(cueIdToRefresh) {
    const propertiesSidebar = getDOMElement('propertiesSidebar');
    if (!propertiesSidebar || propertiesSidebar.classList.contains('hidden')) {
        console.log('[PropertiesSidebar refreshPlaylistPropertiesView] Sidebar not visible, no refresh needed for', cueIdToRefresh);
        return;
    }
    if (activePropertiesCueId && activePropertiesCueId === cueIdToRefresh) {
        console.log('[PropertiesSidebar refreshPlaylistPropertiesView] Active cue matches cueIdToRefresh:', cueIdToRefresh, '. Re-fetching and re-rendering.');
        const latestCueData = cueStore.getCueById(activePropertiesCueId);
        if (latestCueData && latestCueData.type === 'playlist') {
            // Ensure playlistItems is an array, default to empty if not.
            // Deep copy to avoid modifying cueStore's copy directly if renderPlaylistInProperties modifies stagedPlaylistItems in the future (it shouldn't, but good practice).
            setStagedPlaylistItems(latestCueData.playlistItems ? JSON.parse(JSON.stringify(latestCueData.playlistItems)) : []);
            renderPlaylistInPropertiesWrapper();
            console.log('[PropertiesSidebar refreshPlaylistPropertiesView] Playlist items refreshed and re-rendered.');
        } else if (latestCueData) {
            console.log('[PropertiesSidebar refreshPlaylistPropertiesView] Active cue is not a playlist, no playlist items to refresh.');
        } else {
            console.warn('[PropertiesSidebar refreshPlaylistPropertiesView] Could not find active cue data in store for ID:', activePropertiesCueId);
        }
    } else {
        console.log('[PropertiesSidebar refreshPlaylistPropertiesView] Cue to refresh (', cueIdToRefresh, ') does not match active cue ( ', activePropertiesCueId, '). No action.');
    }
}

export {
    initPropertiesSidebar,
    openPropertiesSidebar,
    openPropertiesSidebarForSelection,
    hidePropertiesSidebar,
    getActivePropertiesCueId,
    getActivePropertiesCueIds,
    isPropertiesSidebarOpen,
    refreshActiveCueCardAppearance,
    refreshPlaylistPropertiesView,
    setFilePathInProperties,
    handleCuePropertyChangeFromWaveform,
    highlightPlayingPlaylistItemInSidebarWrapper as highlightPlayingPlaylistItemInSidebar,
    handleSaveCueProperties,
    cancelPendingPropertiesSave
}; 