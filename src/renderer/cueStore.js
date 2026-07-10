// Companion_soundboard/src/renderer/cueStore.js
// Manages the client-side cache of cue data.

import { uiLog } from './ui/uiLogger.js';

let cues = [];
let sections = [];
let layout = [];
let ipcBindings; // To interact with main process for loading/saving
let sidebarsAPI; // To notify sidebars to refresh
let uiAPI; // To notify UI to refresh grid
let cueGridAPI; // Specifically for refreshing the cue grid
// let uiModule; // Store the ui.js module reference - Replaced by specific API refs

let isInitialized = false; // Flag to indicate if init has completed

function applyWorkspacePayload(payload) {
    if (Array.isArray(payload)) {
        cues = payload.map(cue => sanitizeCueFromMain(cue));
        // Legacy cue-only updates: keep existing sections/layout when possible.
        if (sections.length > 0 && layout.length > 0) {
            const validCueIds = new Set(cues.map(cue => cue.id));
            layout = layout.filter(entry =>
                entry.type === 'section' || (entry.type === 'cue' && validCueIds.has(entry.cueId))
            );
            const layoutCueIds = new Set(
                layout.filter(entry => entry.type === 'cue').map(entry => entry.cueId)
            );
            const defaultSectionId = sections[0]?.id;
            cues.forEach(cue => {
                if (!layoutCueIds.has(cue.id) && defaultSectionId) {
                    layout.push({ type: 'cue', cueId: cue.id, sectionId: defaultSectionId });
                }
            });
            return;
        }
        const defaultSectionId = 'default-section';
        sections = [{ id: defaultSectionId, title: 'Cues', collapsed: false }];
        layout = [
            { type: 'section', sectionId: defaultSectionId },
            ...cues.map(cue => ({ type: 'cue', cueId: cue.id, sectionId: defaultSectionId }))
        ];
        return;
    }
    if (!payload || !Array.isArray(payload.cues)) {
        uiLog.error('CueStore: Invalid workspace payload.', payload);
        return;
    }
    cues = payload.cues.map(cue => sanitizeCueFromMain(cue));
    sections = Array.isArray(payload.sections) ? payload.sections.map(section => ({ ...section })) : [];
    layout = Array.isArray(payload.layout) ? payload.layout.map(entry => ({ ...entry })) : [];
}

function sanitizeCueFromMain(cue) {
    const newMappedCue = {
        ...cue,
        enableDucking: cue.enableDucking !== undefined ? cue.enableDucking : false,
        isDuckingTrigger: cue.isDuckingTrigger !== undefined ? cue.isDuckingTrigger : false,
        duckingLevel: cue.duckingLevel !== undefined ? cue.duckingLevel : 80,
    };
    if (newMappedCue.trimStartTime === undefined || newMappedCue.trimStartTime === null) {
        newMappedCue.trimStartTime = 0;
    }
    if (newMappedCue.trimEndTime === 0) {
        delete newMappedCue.trimEndTime;
    }
    return newMappedCue;
}

// This is the actual handler function
function _handleCuesUpdated(updatedPayload) {
    uiLog.debug('**************** CueStore (_handleCuesUpdated) ENTERED ****************');
    if (Array.isArray(updatedPayload) || (updatedPayload && Array.isArray(updatedPayload.cues))) {
        applyWorkspacePayload(updatedPayload);
        uiLog.info('CueStore (_handleCuesUpdated): Internal workspace cache updated. Cues:', cues.length, 'Sections:', sections.length);

        // Refresh properties sidebar if it's open for a playlist that might have changed
        // sidebarsAPI should be uiHandles.propertiesSidebarModule from init
        // CRITICAL: Skip refresh if update is from waveform trim to prevent infinite loops
        if (sidebarsAPI && typeof sidebarsAPI.getActivePropertiesCueId === 'function' && typeof sidebarsAPI.openPropertiesSidebar === 'function') {
            if (window._waveformTrimUpdateInProgress) {
                uiLog.debug('CueStore (_handleCuesUpdated): Skipping properties sidebar refresh - waveform trim update in progress');
            } else if (sidebarsAPI.isPropertiesSidebarOpen?.()) {
                const gridIds = cueGridAPI?.getSelectedCueIds?.() || [];
                const gridPrimaryId = cueGridAPI?.getPrimarySelectedCueId?.() || null;
                if (gridIds.length > 0 && typeof sidebarsAPI.openPropertiesSidebarForSelection === 'function') {
                    sidebarsAPI.openPropertiesSidebarForSelection(gridIds, gridPrimaryId);
                } else {
                    const activeCueId = sidebarsAPI.getActivePropertiesCueId();
                    const activeCueIds = sidebarsAPI.getActivePropertiesCueIds?.() || [];
                    if (activeCueId) {
                        const activeCue = cues.find(c => c.id === activeCueId);
                        if (activeCue) {
                            uiLog.debug(`CueStore (_handleCuesUpdated): Active cue ${activeCueId} found, re-opening/refreshing properties view.`);
                            if (activeCueIds.length > 1 && typeof sidebarsAPI.openPropertiesSidebarForSelection === 'function') {
                                sidebarsAPI.openPropertiesSidebarForSelection(activeCueIds, activeCueId);
                            } else {
                                sidebarsAPI.openPropertiesSidebar(activeCue);
                            }
                        }
                    }
                }
            }
        }

        // Check if UI is fully initialized before refreshing the grid
        // uiAPI should be uiHandles.uiModule or similar from init, cueGridAPI for the grid specifically
        if (cueGridAPI && typeof cueGridAPI.renderCues === 'function') {
            if (window._waveformTrimUpdateInProgress) {
                const activeCueId = sidebarsAPI?.getActivePropertiesCueId?.();
                if (activeCueId && typeof cueGridAPI.applyCueBadgeState === 'function') {
                    cueGridAPI.applyCueBadgeState(activeCueId);
                }
                uiLog.debug('CueStore (_handleCuesUpdated): Skipping full grid render during waveform trim update');
            } else if (sidebarsAPI?.isPropertiesSidebarOpen?.()) {
                const cueIds = sidebarsAPI.getActivePropertiesCueIds?.() || [];
                const fallbackId = sidebarsAPI.getActivePropertiesCueId?.();
                const idsToRefresh = cueIds.length > 0 ? cueIds : (fallbackId ? [fallbackId] : []);
                idsToRefresh.forEach((id) => {
                    if (typeof cueGridAPI.refreshCueCardAppearance === 'function') {
                        cueGridAPI.refreshCueCardAppearance(id);
                    }
                    if (typeof cueGridAPI.applyCueBadgeState === 'function') {
                        cueGridAPI.applyCueBadgeState(id);
                    }
                });
                uiLog.debug('CueStore (_handleCuesUpdated): Refreshed active cue cards in place (properties open)');
            } else {
                uiLog.debug("CueStore (_handleCuesUpdated): Calling cueGridAPI.renderCues().");
                cueGridAPI.renderCues();
                if (typeof cueGridAPI.refreshMissingMediaState === 'function') {
                    cueGridAPI.refreshMissingMediaState({ showAlert: false });
                }
            }
        } else {
            uiLog.warn('CueStore (_handleCuesUpdated): cueGridAPI.renderCues is not a function.');
        }
    } else {
        uiLog.error('CueStore (_handleCuesUpdated): Invalid data.', updatedPayload);
    }
}

function getSections() {
    return sections.map(section => ({ ...section }));
}

function getLayout() {
    return layout.map(entry => ({ ...entry }));
}

function getCueMap() {
    return new Map(cues.map(cue => [cue.id, cue]));
}

// Call this function to initialize the module with dependencies
function init(ipcRendererBindingsInstance, uiHandles) { // Expect uiHandles from renderer.js
    ipcBindings = ipcRendererBindingsInstance;
    // Store specific UI module handles from uiHandles
    if (uiHandles) {
        sidebarsAPI = uiHandles.propertiesSidebarModule; // Assuming this is how propertiesSidebar API is passed
        cueGridAPI = uiHandles.cueGridModule;         // Assuming this is how cueGrid API is passed
        uiAPI = uiHandles.uiModule;                   // General UI module if needed for other things
        uiLog.info('CueStore init: Received uiHandles. sidebarsAPI set:', !!sidebarsAPI, 'cueGridAPI set:', !!cueGridAPI);
    } else {
        uiLog.warn('CueStore init: uiHandles not provided. UI refresh capabilities might be limited.');
    }

    // ---- START DEBUG LOG ----
    uiLog.debug('[CueStore Init Debug] typeof ipcBindings:', typeof ipcBindings);
    if (ipcBindings) {
        uiLog.debug('[CueStore Init Debug] ipcBindings object DIRECTLY (keys):', Object.keys(ipcBindings).join(', '));
        uiLog.debug('[CueStore Init Debug] typeof ipcBindings.registerCueListUpdatedCallback:', typeof ipcBindings.registerCueListUpdatedCallback);
    }
    // ---- END DEBUG LOG ----

    // Register the handler with ipcRendererBindings
    if (ipcBindings && typeof ipcBindings.registerCueListUpdatedCallback === 'function') {
        ipcBindings.registerCueListUpdatedCallback(_handleCuesUpdated);
        uiLog.info('CueStore: Successfully registered _handleCuesUpdated with ipcRendererBindings.');
    } else {
        uiLog.error('CueStore: Failed to register cue list updated callback. ipcBindings or registerCueListUpdatedCallback not available.');
    }
    isInitialized = true; // Set flag after init completes
}

async function loadCuesFromServer() {
    if (!ipcBindings) {
        uiLog.error('CueStore: IPC bindings not initialized. Cannot load cues.');
        return false;
    }
    try {
        uiLog.info('CueStore: Requesting cues from main process...');
        const loadedWorkspace = await ipcBindings.getCuesFromMain();
        if (Array.isArray(loadedWorkspace) || (loadedWorkspace && Array.isArray(loadedWorkspace.cues))) {
            applyWorkspacePayload(loadedWorkspace);
            uiLog.info('CueStore: Workspace loaded from server. Cues:', cues.length, 'Sections:', sections.length);
            return true;
        } else {
            uiLog.error('CueStore: Received invalid cue data from server:', loadedWorkspace);
            cues = []; // Fallback to empty
            return false;
        }
    } catch (error) {
        uiLog.error('CueStore: Error loading cues from server:', error);
        cues = []; // Fallback to empty on error
        return false;
    }
}

// Note: saveCuesToServer function removed as it's obsolete.
// Individual changes go through addOrUpdateCue/deleteCue and full saves
// are handled by main process workspace logic.

function getCueById(id) {
    return cues.find(cue => cue.id === id);
}

function getAllCues() {
    return [...cues]; // Return a copy to prevent direct modification
}

// Adds a new cue or updates an existing one by sending it to the main process
async function addOrUpdateCue(cueData, layoutOptions = null) {
    if (!ipcBindings || typeof ipcBindings.addOrUpdateCue !== 'function') {
        uiLog.error('CueStore: IPC bindings or addOrUpdateCue function not initialized. Cannot save cue.');
        // Consider throwing an error or returning a promise that rejects
        return { success: false, error: 'IPC bindings not available for saving cue.', cue: null };
    }
    // Basic check for cueData validity, especially if it's a new cue (no ID yet)
    if (!cueData) {
        uiLog.error('CueStore: No cue data provided for add/update.');
        return { success: false, error: 'No cue data provided.', cue: null };
    }
    
    // For new cues (no ID), ensure we have either a name, filePath, or valid playlistItems
    if (!cueData.id && !cueData.name && !cueData.filePath && (!cueData.playlistItems || cueData.playlistItems.length === 0)) {
        uiLog.error('CueStore: Invalid or insufficient cue data for add/update.', cueData);
        return { success: false, error: 'Invalid or insufficient cue data provided.', cue: null };
    }

    // Sanitize cueData before sending to main process

    const sanitizedCueData = {
        ...cueData,
        ...(layoutOptions ? { _layoutOptions: layoutOptions } : {})
    };

    uiLog.info(`CueStore: Sending cue (ID: ${sanitizedCueData.id || 'new'}) to main process for add/update.`);
    try {
        // The main process will handle adding/updating, fetch durations, save, and then broadcast 'cues-updated-from-main'.
        // This store will then be updated by setCuesFromMain when that event is received.
        const result = await ipcBindings.addOrUpdateCue(sanitizedCueData); 
        if (result && result.success) {
            uiLog.info(`CueStore: Cue (ID: ${result.cue.id}) processed successfully by main process.`);
            // No direct modification of 'this.cues' here. It will be updated via 'cues-updated-from-main' event.
        } else {
            uiLog.error('CueStore: Main process failed to add/update cue.', result ? result.error : 'Unknown error');
        }
        return result; // Return the result from main { success, cue, error }
    } catch (error) {
        uiLog.error('CueStore: Error calling addOrUpdateCue IPC binding:', error);
        return { success: false, error: error.message || 'IPC call failed', cue: null };
    }
}

async function deleteCue(id) {
    if (!ipcBindings || typeof ipcBindings.deleteCue !== 'function') { 
        uiLog.error('CueStore: IPC bindings or deleteCue function not initialized. Cannot delete cue.');
        return { success: false, error: 'IPC bindings not available for deleting cue.' };
    }
    if (!id) {
        uiLog.error('CueStore: Invalid cue ID for deletion.');
        return { success: false, error: 'Invalid cue ID for deletion.' };
    }

    uiLog.info(`CueStore: Sending delete request for cue ID: ${id} to main process.`);
    try {
        // Main process handles deletion, saving, and broadcasting 'cues-updated-from-main'.
        const result = await ipcBindings.deleteCue(id);
        if (result && result.success) {
            uiLog.info(`CueStore: Cue (ID: ${id}) delete request sent successfully to main process.`);
            // No direct modification of 'this.cues' here. It will be updated via 'cues-updated-from-main' event.
        } else {
            uiLog.error('CueStore: Main process failed to delete cue.', result ? result.error : 'Unknown error');
        }
        return result; // Return { success, error }
    } catch (error) {
        uiLog.error('CueStore: Error calling deleteCue IPC binding:', error);
        return { success: false, error: error.message || 'IPC call failed' };
    }
}

async function deleteCues(ids) {
    if (!ipcBindings || typeof ipcBindings.deleteCues !== 'function') {
        uiLog.error('CueStore: IPC bindings or deleteCues function not initialized. Cannot delete cues.');
        return { success: false, error: 'IPC bindings not available for deleting cues.' };
    }
    const cueIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (cueIds.length === 0) {
        return { success: false, error: 'No cue IDs provided for deletion.' };
    }

    uiLog.info(`CueStore: Sending delete request for ${cueIds.length} cue(s) to main process.`);
    try {
        const result = await ipcBindings.deleteCues(cueIds);
        if (result && result.success) {
            uiLog.info(`CueStore: Deleted ${result.deletedCount || cueIds.length} cue(s) via main process.`);
        } else {
            uiLog.error('CueStore: Main process failed to delete cues.', result ? result.error : 'Unknown error');
        }
        return result;
    } catch (error) {
        uiLog.error('CueStore: Error calling deleteCues IPC binding:', error);
        return { success: false, error: error.message || 'IPC call failed' };
    }
}

// New function to update the local cues cache from an authoritative main process update
// RENAMED from setCuesFromMain
// THIS FUNCTION IS NOW EFFECTIVELY INLINED/HANDLED BY ipcBindings.onCueListUpdated above.
// We keep it separate for clarity if we want to call it from elsewhere, but it duplicates logic now.
// For now, let's assume the ipcBindings.onCueListUpdated is the primary handler.

function isCueStoreReady() {
    return isInitialized;
}

async function saveWorkspaceLayout(nextSections, nextLayout, nextCues = null) {
    if (!ipcBindings || typeof ipcBindings.saveWorkspaceLayout !== 'function') {
        uiLog.error('CueStore: saveWorkspaceLayout IPC not available.');
        return { success: false, error: 'IPC bindings not available for layout save.' };
    }
    try {
        const payload = {
            sections: nextSections,
            layout: nextLayout
        };
        if (Array.isArray(nextCues)) payload.cues = nextCues;
        return await ipcBindings.saveWorkspaceLayout(payload);
    } catch (error) {
        uiLog.error('CueStore: Error saving workspace layout:', error);
        return { success: false, error: error.message || 'IPC call failed' };
    }
}

async function addSection(title, afterSectionId = null) {
    if (!ipcBindings || typeof ipcBindings.addCueSection !== 'function') {
        return { success: false, error: 'IPC bindings not available for add section.' };
    }
    return ipcBindings.addCueSection(title, afterSectionId);
}

async function updateSection(sectionId, patch) {
    if (!ipcBindings || typeof ipcBindings.updateCueSection !== 'function') {
        return { success: false, error: 'IPC bindings not available for update section.' };
    }
    return ipcBindings.updateCueSection(sectionId, patch);
}

async function deleteSection(sectionId) {
    if (!ipcBindings || typeof ipcBindings.deleteCueSection !== 'function') {
        return { success: false, error: 'IPC bindings not available for delete section.' };
    }
    return ipcBindings.deleteCueSection(sectionId);
}

async function reorderCues(newOrder) {
    // newOrder is an array of cue IDs in the desired order
    if (!ipcBindings || typeof ipcBindings.saveReorderedCues !== 'function') {
        uiLog.error('CueStore: IPC bindings or saveReorderedCues function not initialized. Cannot reorder cues.');
        return { success: false, error: 'IPC bindings not available for reordering cues.' };
    }
    
    const allCues = getAllCues();
    const reorderedCues = newOrder.map(cueId => 
        allCues.find(c => c.id === cueId)
    ).filter(c => c !== undefined);
    
    if (reorderedCues.length !== allCues.length) {
        uiLog.warn('CueStore: Reordered cues count does not match total cues. Some cues may be missing.');
    }
    
    uiLog.info(`CueStore: Reordering ${reorderedCues.length} cues to new order.`);
    try {
        const result = await ipcBindings.saveReorderedCues(reorderedCues);
        if (result && result.success) {
            uiLog.info(`CueStore: Cues reordered successfully.`);
        } else {
            uiLog.error('CueStore: Failed to reorder cues.', result ? result.error : 'Unknown error');
        }
        return result;
    } catch (error) {
        uiLog.error('CueStore: Error calling saveReorderedCues IPC binding:', error);
        return { success: false, error: error.message || 'IPC call failed' };
    }
}

async function saveReorderedCues(reorderedCues) {
    // Alias for reorderCues that takes the array directly
    const newOrder = reorderedCues.map(c => c.id);
    return reorderCues(newOrder);
}

export {
    init,
    loadCuesFromServer,
    getCueById,
    getAllCues,
    getSections,
    getLayout,
    getCueMap,
    addOrUpdateCue,
    deleteCue,
    deleteCues,
    isCueStoreReady,
    reorderCues,
    saveReorderedCues,
    saveWorkspaceLayout,
    addSection,
    updateSection,
    deleteSection
}; 