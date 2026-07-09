/**
 * Form Data Management for Properties Sidebar
 * Handles form data collection, validation, and save/delete operations
 */

import { formatWaveformTime } from './waveformControls.js';
import { syncAudioFilePathDisplay } from './propertiesSidebarDOM.js';
import {
    normalizeTrimValues,
    validateCueName,
    validateVolume,
    validateDuckingLevel,
    validateFadeTime
} from './propertiesSidebarUtils.js';
import {
    retriggerOverrideToSelectValue,
    retriggerSelectValueToOverride
} from '../retriggerBehaviorUtils.js';
import { updateRetriggerHelpText } from '../retriggerBehaviorCatalog.js';
import { applyCueBadgeState, updateCueButtonTime } from './cueGrid.js';
import {
    setButtonColorFromCue,
    getButtonColorFormState,
    setButtonColorUseDefault,
    DEFAULT_CUE_BUTTON_COLOR
} from './buttonColorPicker.js';

let cueStore;
let audioController;
let uiCore;
let currentWaveformTrimStart = 0;
let currentWaveformTrimEnd = 0;

/**
 * Initialize form manager
 * @param {Object} csModule - Cue store module
 * @param {Object} acModule - Audio controller module
 * @param {Object} uiCoreInterfaceRef - UI core interface
 */
function initFormManager(csModule, acModule, uiCoreInterfaceRef) {
    cueStore = csModule;
    audioController = acModule;
    uiCore = uiCoreInterfaceRef;
}

/**
 * Set current waveform trim values
 * @param {number} trimStart - Start time
 * @param {number} trimEnd - End time
 */
function setCurrentWaveformTrim(trimStart, trimEnd) {
    currentWaveformTrimStart = trimStart;
    currentWaveformTrimEnd = trimEnd;
}

/**
 * Get current waveform trim values
 * @returns {Object} Current trim values
 */
function getCurrentWaveformTrim() {
    return { currentWaveformTrimStart, currentWaveformTrimEnd };
}

/**
 * Collect form data from the properties sidebar
 * @param {string} activePropertiesCueId - Currently active cue ID
 * @param {Object} domElements - DOM elements object
 * @param {Array} stagedPlaylistItems - Current staged playlist items
 * @returns {Object} Collected form data
 */
function collectFormData(activePropertiesCueId, domElements, stagedPlaylistItems) {
    const existingCue = cueStore.getCueById(activePropertiesCueId);
    if (!existingCue) {
        console.error('[PropertiesSidebar] collectFormData: Could not find cue with ID:', activePropertiesCueId);
        return null;
    }

    const appConfig = uiCore.getCurrentAppConfig();

    // Normalize trim values before saving
    const { normalizedTrimStart, normalizedTrimEnd } = normalizeTrimValues(
        currentWaveformTrimStart, 
        currentWaveformTrimEnd
    );

    // Validate and sanitize cue name
    const cueName = validateCueName(
        domElements.propCueNameInput ? domElements.propCueNameInput.value : existingCue.name,
        activePropertiesCueId
    );

    const formData = {
        id: activePropertiesCueId,
        name: cueName,
        type: domElements.propCueTypeSelect ? domElements.propCueTypeSelect.value : existingCue.type,
        filePath: (domElements.propCueTypeSelect && domElements.propCueTypeSelect.value !== 'playlist' && domElements.propFilePathInput) 
            ? domElements.propFilePathInput.value 
            : existingCue.filePath,
        playlistItems: (domElements.propCueTypeSelect && domElements.propCueTypeSelect.value === 'playlist') 
            ? stagedPlaylistItems 
            : existingCue.playlistItems,
        fadeInTime: validateFadeTime(
            domElements.propFadeInTimeInput ? parseFloat(domElements.propFadeInTimeInput.value) : existingCue.fadeInTime
        ),
        fadeOutTime: validateFadeTime(
            domElements.propFadeOutTimeInput ? parseFloat(domElements.propFadeOutTimeInput.value) : existingCue.fadeOutTime
        ),
        loop: domElements.propLoopCheckbox ? domElements.propLoopCheckbox.checked : existingCue.loop,
        volume: validateVolume(
            domElements.propVolumeSlider ? parseFloat(domElements.propVolumeSlider.value) : existingCue.volume
        ),
        retriggerBehavior: domElements.propRetriggerBehaviorSelect
            ? retriggerSelectValueToOverride(domElements.propRetriggerBehaviorSelect.value)
            : existingCue.retriggerBehavior,
        shuffle: (domElements.propCueTypeSelect && domElements.propCueTypeSelect.value === 'playlist' && domElements.propShufflePlaylistCheckbox) 
            ? domElements.propShufflePlaylistCheckbox.checked 
            : existingCue.shuffle,
        repeatOne: (domElements.propCueTypeSelect && domElements.propCueTypeSelect.value === 'playlist' && domElements.propRepeatOnePlaylistItemCheckbox) 
            ? domElements.propRepeatOnePlaylistItemCheckbox.checked 
            : existingCue.repeatOne,
        playlistPlayMode: (domElements.propCueTypeSelect && domElements.propCueTypeSelect.value === 'playlist' && domElements.propPlaylistPlayModeSelect) 
            ? domElements.propPlaylistPlayModeSelect.value 
            : existingCue.playlistPlayMode,
        trimStartTime: normalizedTrimStart,
        trimEndTime: normalizedTrimEnd,
        enableDucking: domElements.propEnableDuckingCheckbox 
            ? domElements.propEnableDuckingCheckbox.checked 
            : existingCue.enableDucking,
        duckingLevel: validateDuckingLevel(
            domElements.propDuckingLevelInput ? parseInt(domElements.propDuckingLevelInput.value, 10) : existingCue.duckingLevel
        ),
        isDuckingTrigger: domElements.propIsDuckingTriggerCheckbox 
            ? domElements.propIsDuckingTriggerCheckbox.checked 
            : existingCue.isDuckingTrigger,
        buttonColor: (() => {
            const { useDefault, color } = getButtonColorFormState();
            return useDefault ? null : color;
        })(),
        showButtonWaveform: (() => {
            const mode = domElements.propShowButtonWaveformSelect
                ? domElements.propShowButtonWaveformSelect.value
                : 'default';
            if (mode === 'show') return true;
            if (mode === 'hide') return false;
            return null;
        })(),
    };

    return formData;
}

/**
 * Save cue properties for one or more cues.
 * @param {string|string[]} activePropertiesCueIds - Cue ID or list of cue IDs
 * @param {Object} domElements - DOM elements object
 * @param {Array} stagedPlaylistItems - Current staged playlist items
 * @returns {Promise<boolean>} Success status
 */
async function saveCueProperties(activePropertiesCueIds, domElements, stagedPlaylistItems) {
    const cueIds = Array.isArray(activePropertiesCueIds)
        ? activePropertiesCueIds
        : [activePropertiesCueIds];
    console.log('[PropertiesSidebar] saveCueProperties CALLED. Cue IDs:', cueIds);
    if (!cueIds.length) {
        console.warn('[PropertiesSidebar] saveCueProperties: No active cue IDs');
        return false;
    }

    const isMultiSelect = cueIds.length > 1;
    const templateData = collectFormData(cueIds[0], domElements, stagedPlaylistItems);
    if (!templateData) {
        return false;
    }

    try {
        let allSucceeded = true;
        for (const cueId of cueIds) {
            const existingCue = cueStore.getCueById(cueId);
            if (!existingCue) {
                allSucceeded = false;
                continue;
            }

            const formData = { ...templateData, id: cueId };
            if (isMultiSelect) {
                formData.name = existingCue.name;
                formData.type = existingCue.type;
                formData.filePath = existingCue.filePath;
                formData.playlistItems = existingCue.playlistItems;
                formData.trimStartTime = existingCue.trimStartTime;
                formData.trimEndTime = existingCue.trimEndTime;
                formData.shuffle = existingCue.shuffle;
                formData.repeatOne = existingCue.repeatOne;
                formData.playlistPlayMode = existingCue.playlistPlayMode;
                formData.volume = existingCue.volume;
                formData.enableDucking = existingCue.enableDucking;
                formData.duckingLevel = existingCue.duckingLevel;
                formData.isDuckingTrigger = existingCue.isDuckingTrigger;
                formData.showButtonWaveform = existingCue.showButtonWaveform;
            }

            const result = await cueStore.addOrUpdateCue(formData);
            if (!result || !result.success) {
                console.error('PropertiesSidebar: Failed to save cue:', cueId, result ? result.error : 'Unknown error');
                allSucceeded = false;
                continue;
            }

            if (typeof applyCueBadgeState === 'function') {
                applyCueBadgeState(cueId);
            }
            if (typeof updateCueButtonTime === 'function') {
                updateCueButtonTime(cueId);
            }
            if (audioController?.default?.refreshPlayingCueFromStore) {
                audioController.default.refreshPlayingCueFromStore(cueId);
            } else if (audioController?.refreshPlayingCueFromStore) {
                audioController.refreshPlayingCueFromStore(cueId);
            }
        }

        if (allSucceeded && typeof window.__refreshActiveCueCardAppearance === 'function') {
            window.__refreshActiveCueCardAppearance();
        }
        if (allSucceeded && typeof window.__refreshEditCardIndicators === 'function') {
            cueIds.forEach((cueId) => window.__refreshEditCardIndicators(cueId));
        }

        return allSucceeded;
    } catch (error) {
        console.error('PropertiesSidebar: Error saving cue(s):', error);
        return false;
    }
}

/**
 * Delete cue properties
 * @param {string} activePropertiesCueId - Currently active cue ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteCueProperties(activePropertiesCueId) {
    if (!activePropertiesCueId || !cueStore || !audioController) return false;
    
    if (confirm('Are you sure you want to delete this cue?')) {
        if (audioController.default && audioController.default.isPlaying && audioController.default.isPlaying(activePropertiesCueId)) {
            // Stop the cue if it's playing
            if (audioController.default.toggle) {
                audioController.default.toggle(activePropertiesCueId, false, 'stop');
            }
        }
        await cueStore.deleteCue(activePropertiesCueId);
        return true;
    }
    return false;
}

/**
 * Populate form fields with cue data
 * @param {Object} cue - Cue object
 * @param {Object} domElements - DOM elements object
 * @param {Function} setStagedPlaylistItems - Function to set staged playlist items
 * @param {Function} renderPlaylistInProperties - Function to render playlist
 * @param {Function} showWaveformForCue - Function to show waveform
 * @param {Function} hideAndDestroyWaveform - Function to hide waveform
 * @param {Function} updateDuckingControlsVisibility - Function to update ducking controls
 */
function populateFormWithCueData(cue, domElements, setStagedPlaylistItems, renderPlaylistInProperties, showWaveformForCue, hideAndDestroyWaveform, updateDuckingControlsVisibility) {
    const appConfig = uiCore.getCurrentAppConfig();

    hideAndDestroyWaveform();

    if(domElements.propCueIdInput) domElements.propCueIdInput.value = cue.id;
    if(domElements.propCueNameInput) domElements.propCueNameInput.value = cue.name || '';
    if(domElements.propCueTypeSelect) domElements.propCueTypeSelect.value = cue.type || 'single_file';

    setButtonColorFromCue(cue);
    if (domElements.propShowButtonWaveformSelect) {
        if (cue.showButtonWaveform === true) {
            domElements.propShowButtonWaveformSelect.value = 'show';
        } else if (cue.showButtonWaveform === false) {
            domElements.propShowButtonWaveformSelect.value = 'hide';
        } else {
            domElements.propShowButtonWaveformSelect.value = 'default';
        }
    }
    
    const isPlaylist = cue.type === 'playlist';
    if(domElements.propPlaylistConfigDiv) domElements.propPlaylistConfigDiv.style.display = isPlaylist ? 'block' : 'none';
    if(domElements.propSingleFileConfigDiv) domElements.propSingleFileConfigDiv.style.display = isPlaylist ? 'none' : 'block';
    const playlistSpecificControls = document.getElementById('playlistSpecificControls');
    if (playlistSpecificControls) playlistSpecificControls.style.display = isPlaylist ? 'block' : 'none';
    const waveformDisplayContainer = document.getElementById('waveformDisplay');
    if (waveformDisplayContainer) waveformDisplayContainer.style.display = isPlaylist ? 'none' : 'block';

    if (isPlaylist) {
        if(domElements.propFilePathInput) domElements.propFilePathInput.value = '';
        setStagedPlaylistItems(cue.playlistItems);
        renderPlaylistInProperties(domElements.propPlaylistItemsUl, domElements.propPlaylistFilePathDisplay);
        if(domElements.propPlaylistFilePathDisplay) domElements.propPlaylistFilePathDisplay.textContent = '';
        if(domElements.propShufflePlaylistCheckbox) domElements.propShufflePlaylistCheckbox.checked = cue.shuffle || false;
        if(domElements.propRepeatOnePlaylistItemCheckbox) domElements.propRepeatOnePlaylistItemCheckbox.checked = cue.repeatOne || false;
        if(domElements.propPlaylistPlayModeSelect) domElements.propPlaylistPlayModeSelect.value = cue.playlistPlayMode || 'continue';
    } else {
        syncAudioFilePathDisplay(cue.filePath);
        if(domElements.propPlaylistItemsUl) domElements.propPlaylistItemsUl.innerHTML = '';
        setStagedPlaylistItems([]);
        currentWaveformTrimStart = cue.trimStartTime || 0;
        // Keep undefined/null if not explicitly set so waveform shows full length
        currentWaveformTrimEnd = (cue.trimEndTime !== undefined && cue.trimEndTime !== null) ? cue.trimEndTime : undefined;
        if (cue.filePath) {
            showWaveformForCue(cue);
        }
    }

    // Set fade times with validation
    const fadeInTime = cue.fadeInTime !== undefined ? Math.max(0, cue.fadeInTime) : (appConfig.defaultFadeInTime || 0);
    const fadeOutTime = cue.fadeOutTime !== undefined ? Math.max(0, cue.fadeOutTime) : (appConfig.defaultFadeOutTime || 0);
    if(domElements.propFadeInTimeInput) domElements.propFadeInTimeInput.value = fadeInTime;
    if(domElements.propFadeOutTimeInput) domElements.propFadeOutTimeInput.value = fadeOutTime;
    
    // Set loop with fallback
    if (domElements.propLoopCheckbox) {
        domElements.propLoopCheckbox.indeterminate = false;
        domElements.propLoopCheckbox.checked = cue.loop !== undefined ? cue.loop : (appConfig.defaultLoopSingleCue || false);
    }
    
    // Set volume with validation (0-1 range)
    const volume = validateVolume(cue.volume !== undefined ? cue.volume : appConfig.defaultVolume);
    if(domElements.propVolumeRangeInput) domElements.propVolumeRangeInput.value = volume;
    if(domElements.propVolumeValueSpan) domElements.propVolumeValueSpan.textContent = parseFloat(volume).toFixed(2);
    if(domElements.propVolumeSlider) domElements.propVolumeSlider.value = volume;
    if(domElements.propVolumeValueDisplay) domElements.propVolumeValueDisplay.textContent = parseFloat(volume).toFixed(2);
    
    if (domElements.propRetriggerBehaviorSelect) {
        domElements.propRetriggerBehaviorSelect.value = retriggerOverrideToSelectValue(cue);
        updateRetriggerHelpText(
            domElements.propRetriggerBehaviorSelect,
            document.getElementById('propRetriggerBehaviorHelp'),
            { includeDefault: true }
        );
    }

    // Set ducking controls with validation
    if (domElements.propEnableDuckingCheckbox) domElements.propEnableDuckingCheckbox.checked = !!cue.enableDucking;
    const duckingLevel = validateDuckingLevel(cue.duckingLevel);
    if (domElements.propDuckingLevelInput) domElements.propDuckingLevelInput.value = duckingLevel;
    if (domElements.propDuckingLevelValueSpan) domElements.propDuckingLevelValueSpan.textContent = duckingLevel;
    if (domElements.propIsDuckingTriggerCheckbox) {
        domElements.propIsDuckingTriggerCheckbox.checked = !!cue.isDuckingTrigger;
        updateDuckingControlsVisibility(domElements.propIsDuckingTriggerCheckbox.checked);
    }

    if (domElements.propTrimConfig && !isPlaylist) {
        domElements.propTrimConfig.style.display = 'block';
        if (domElements.propTrimStartTimeInput) domElements.propTrimStartTimeInput.value = formatWaveformTime(cue.trimStartTime || 0);
        if (domElements.propTrimEndTimeInput) domElements.propTrimEndTimeInput.value = (cue.trimEndTime !== undefined && cue.trimEndTime !== null) ? formatWaveformTime(cue.trimEndTime) : 'End';
    } else if (domElements.propTrimConfig) {
        domElements.propTrimConfig.style.display = 'none';
    }
}

function setButtonColorUseDefaultFlag(useDefault) {
    setButtonColorUseDefault(useDefault);
}

export {
    initFormManager,
    setCurrentWaveformTrim,
    getCurrentWaveformTrim,
    collectFormData,
    saveCueProperties,
    deleteCueProperties,
    populateFormWithCueData,
    setButtonColorUseDefaultFlag,
    DEFAULT_CUE_BUTTON_COLOR
};
