// Companion_soundboard/src/renderer/ui/waveformRegions.js

/**
 * Waveform Region Management Module
 * Handles region creation, styling, and management for waveforms
 */

import {
    resolveTrimBounds,
    hasActiveTrim,
    trimTimesForPersist,
} from './waveformTrimTimeUtils.js';

let wsRegions = null; // Regions plugin instance
let currentLiveTrimRegion = null; // To store the live trimRegion object
let isDestroyingWaveform = false; // Flag to prevent callback loops during destruction

// Dependencies
let onTrimChangeCallback = null; // Callback for trim changes

// Constants
const MIN_REGION_DURATION = 0.01; // seconds, to avoid issues with zero-width regions

function getWaveformWrapper(wavesurferInstance) {
    return wavesurferInstance?.getWrapper?.() || wavesurferInstance?.container || null;
}

function getTrimMarkerLayer(wavesurferInstance) {
    const host = getWaveformWrapper(wavesurferInstance);
    if (!host) return null;

    const container = host.closest('#waveformDisplay, #expandedWaveformDisplay')
        || (host.id === 'waveformDisplay' || host.id === 'expandedWaveformDisplay' ? host : host.parentElement)
        || host;

    let layer = container.querySelector(':scope > .trim-marker-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'trim-marker-layer';
        container.appendChild(layer);
    }
    return layer;
}

function findTrimRegion(regions) {
    if (Array.isArray(regions)) {
        return regions.find((region) => region?.id === 'trimRegion' || region?.id === 'trimRegion-playback');
    }
    return regions?.trimRegion || regions?.['trimRegion-playback'] || null;
}

function positionMarkerAtLayerX(layer, marker, xPx) {
    marker.style.left = `${xPx}px`;
}

function syncMarkerPositionsFromRegion(layer, trimRegion, inMarker, outMarker, inGrab, outGrab, duration) {
    const regionEl = trimRegion?.element;
    if (regionEl && layer) {
        const layerRect = layer.getBoundingClientRect();
        const regionRect = regionEl.getBoundingClientRect();
        const inX = regionRect.left - layerRect.left;
        const outX = regionRect.right - layerRect.left;
        if (inMarker) positionMarkerAtLayerX(layer, inMarker, inX);
        if (outMarker) positionMarkerAtLayerX(layer, outMarker, outX);
        if (inGrab) positionMarkerAtLayerX(layer, inGrab, inX);
        if (outGrab) positionMarkerAtLayerX(layer, outGrab, outX);
        return;
    }

    const inPct = Math.max(0, Math.min(100, (trimRegion.start / duration) * 100));
    const outPct = Math.max(0, Math.min(100, (trimRegion.end / duration) * 100));
    if (inMarker) inMarker.style.left = `${inPct}%`;
    if (outMarker) outMarker.style.left = `${outPct}%`;
    if (inGrab) inGrab.style.left = `${inPct}%`;
    if (outGrab) outGrab.style.left = `${outPct}%`;
}

function syncTrimGrabAffordances(layer, trimRegion, duration, inGrab, outGrab) {
    if (!layer) return;
    if (!inGrab) {
        inGrab = document.createElement('div');
        inGrab.className = 'trim-grab-affordance trim-grab-affordance-in';
        inGrab.setAttribute('aria-hidden', 'true');
        layer.appendChild(inGrab);
    }
    if (!outGrab) {
        outGrab = document.createElement('div');
        outGrab.className = 'trim-grab-affordance trim-grab-affordance-out';
        outGrab.setAttribute('aria-hidden', 'true');
        layer.appendChild(outGrab);
    }
    syncMarkerPositionsFromRegion(layer, trimRegion, null, null, inGrab, outGrab, duration);
    return { inGrab, outGrab };
}

function syncTrimBracketMarkers(wavesurferInstance, regionsInstance = wsRegions) {
    const layer = getTrimMarkerLayer(wavesurferInstance);
    if (!layer || !regionsInstance) return;

    const duration = wavesurferInstance.getDuration();
    if (!duration || duration <= 0) return;

    const trimRegion = findTrimRegion(regionsInstance.getRegions());
    if (!trimRegion) {
        layer.querySelectorAll('.trim-bracket-marker, .trim-grab-affordance').forEach((el) => el.remove());
        return;
    }

    let inGrab = layer.querySelector('.trim-grab-affordance-in');
    let outGrab = layer.querySelector('.trim-grab-affordance-out');
    ({ inGrab, outGrab } = syncTrimGrabAffordances(layer, trimRegion, duration, inGrab, outGrab) || { inGrab, outGrab });

    const { trimStartTime, trimEndTime } = trimTimesForPersist(trimRegion.start, trimRegion.end, duration);
    if (!hasActiveTrim(trimStartTime, trimEndTime, duration)) {
        layer.querySelectorAll('.trim-bracket-marker').forEach((el) => el.remove());
        return;
    }

    const hasInTrim = trimStartTime > 0;
    const hasOutTrim = trimEndTime != null && trimEndTime < duration - 0.01;

    let inMarker = layer.querySelector('.trim-bracket-marker-in');
    let outMarker = layer.querySelector('.trim-bracket-marker-out');
    if (!inMarker) {
        inMarker = document.createElement('div');
        inMarker.className = 'trim-bracket-marker trim-bracket-marker-in';
        inMarker.setAttribute('aria-hidden', 'true');
        layer.appendChild(inMarker);
    }
    if (!outMarker) {
        outMarker = document.createElement('div');
        outMarker.className = 'trim-bracket-marker trim-bracket-marker-out';
        outMarker.setAttribute('aria-hidden', 'true');
        layer.appendChild(outMarker);
    }

    inMarker.textContent = '{';
    outMarker.textContent = '}';
    inMarker.classList.toggle('trim-bracket-bold', hasInTrim);
    outMarker.classList.toggle('trim-bracket-bold', hasOutTrim);
    syncMarkerPositionsFromRegion(layer, trimRegion, inMarker, outMarker, inGrab, outGrab, duration);
}

/**
 * Initialize the region management module
 * @param {object} dependencies - Object containing required modules and callbacks
 */
function initRegionModule(dependencies) {
    onTrimChangeCallback = dependencies.onTrimChange;
    console.log('WaveformRegions: Initialized with onTrimChange callback:', !!onTrimChangeCallback);
}

/**
 * Set the regions plugin instance
 * @param {object} regionsInstance - The WaveSurfer regions plugin instance
 */
function setRegionsInstance(regionsInstance) {
    wsRegions = regionsInstance;
    console.log('WaveformRegions: Regions instance set:', !!wsRegions);
}

/**
 * Get the regions plugin instance
 * @returns {object|null} The WaveSurfer regions plugin instance
 */
function getRegionsInstance() {
    return wsRegions;
}

/**
 * Set the destruction flag
 * @param {boolean} isDestroying - Whether waveform is being destroyed
 */
function setDestroyingFlag(isDestroying) {
    isDestroyingWaveform = isDestroying;
}

function notifyTrimChange(regionStart, regionEnd, fileDuration) {
    if (typeof onTrimChangeCallback !== 'function') return;
    const { trimStartTime, trimEndTime } = trimTimesForPersist(regionStart, regionEnd, fileDuration);
    onTrimChangeCallback(trimStartTime, trimEndTime);
}

/**
 * Load regions from cue data
 * @param {object} cue - The cue object containing trim data
 * @param {object} wavesurferInstance - The WaveSurfer instance
 */
function loadRegionsFromCue(cue, wavesurferInstance) {
    if (!wsRegions || !wavesurferInstance || !cue) {
        console.warn('WaveformRegions: Cannot load regions - missing dependencies');
        return;
    }

    console.log('WaveformRegions: Loading regions from cue:', cue.id);

    clearAllRegionsHard();

    const duration = wavesurferInstance.getDuration();
    if (!duration || duration <= 0) {
        console.log('WaveformRegions: Duration not ready for regions');
        return;
    }

    const { trimStart, trimEnd } = resolveTrimBounds(
        cue.trimStartTime,
        cue.trimEndTime,
        duration
    );

    try {
        const trimRegion = wsRegions.addRegion({
            id: 'trimRegion',
            start: trimStart,
            end: trimEnd,
            color: hasActiveTrim(cue.trimStartTime, cue.trimEndTime, duration)
                ? 'rgba(34, 197, 94, 0.28)'
                : 'rgba(34, 197, 94, 0.12)',
            drag: false,
            resize: true,
            resizeStart: true,
            resizeEnd: true,
        });

        currentLiveTrimRegion = trimRegion;

        if (hasActiveTrim(cue.trimStartTime, cue.trimEndTime, duration)) {
            setTimeout(() => {
                styleRegions(wavesurferInstance);
                syncTrimBracketMarkers(wavesurferInstance);
            }, 100);
        } else {
            setTimeout(() => syncTrimBracketMarkers(wavesurferInstance), 100);
        }
    } catch (error) {
        console.error('WaveformRegions: Error creating trim region:', error);
    }
}

/**
 * Apply read-only trim visualization for playback waveforms (no drag/resize).
 */
function loadReadOnlyTrimRegions(cue, wavesurferInstance, regionsInstance = wsRegions) {
    if (!regionsInstance || !wavesurferInstance || !cue) return;

    const duration = wavesurferInstance.getDuration();
    if (!duration || duration <= 0) return;

    if (!hasActiveTrim(cue.trimStartTime, cue.trimEndTime, duration)) return;

    const { trimStart, trimEnd } = resolveTrimBounds(
        cue.trimStartTime,
        cue.trimEndTime,
        duration
    );

    try {
        regionsInstance.clearRegions?.();
    } catch (e) { /* ignore */ }

    regionsInstance.addRegion({
        id: 'trimRegion-playback',
        start: trimStart,
        end: trimEnd,
        color: 'rgba(34, 197, 94, 0.22)',
        drag: false,
        resize: false,
    });

    if (trimStart > MIN_REGION_DURATION) {
        regionsInstance.addRegion({
            id: 'cutOverlay-before',
            start: 0,
            end: Math.max(0, trimStart - MIN_REGION_DURATION),
            color: 'rgba(0, 0, 0, 0.45)',
            drag: false,
            resize: false,
        });
    }

    if (trimEnd < duration - MIN_REGION_DURATION) {
        regionsInstance.addRegion({
            id: 'cutOverlay-after',
            start: Math.min(duration, trimEnd + MIN_REGION_DURATION),
            end: duration,
            color: 'rgba(0, 0, 0, 0.45)',
            drag: false,
            resize: false,
        });
    }

    setTimeout(() => syncTrimBracketMarkers(wavesurferInstance, regionsInstance), 100);
}

/**
 * Clear all regions from the waveform
 */
function clearAllRegionsHard() {
    if (!wsRegions) {
        console.warn('WaveformRegions: Cannot clear regions - wsRegions not available');
        return;
    }
    
    console.log('WaveformRegions: Clearing all regions');
    
    try {
        // Get all regions and remove them - iterate multiple times to catch all
        let totalCleared = 0;
        let maxIterations = 10;
        let iteration = 0;
        
        while (iteration < maxIterations) {
            const regions = wsRegions.getRegions();
            if (!regions || (Array.isArray(regions) && regions.length === 0)) {
                break; // No more regions to clear
            }
            
            let clearedThisIteration = 0;
            if (Array.isArray(regions)) {
                // Create a copy to avoid issues with array modification during iteration
                const regionsCopy = [...regions];
                regionsCopy.forEach(region => {
                    if (region && typeof region.remove === 'function') {
                        try {
                            region.remove();
                            clearedThisIteration++;
                        } catch (e) {
                            console.warn('WaveformRegions: Error removing region:', e);
                        }
                    }
                });
            }
            
            totalCleared += clearedThisIteration;
            
            if (clearedThisIteration === 0) {
                break; // No regions cleared this iteration, we're done
            }
            
            iteration++;
        }
        
        console.log(`WaveformRegions: Cleared ${totalCleared} regions in ${iteration} iterations`);
        
        // Clear cut overlays
        clearAllCutOverlaysImmediate();
        
        currentLiveTrimRegion = null;
        console.log('WaveformRegions: All regions cleared');
        
    } catch (error) {
        console.error('WaveformRegions: Error clearing regions:', error);
    }
}

function clearCutOverlaysForInstance(regionsInstance = wsRegions) {
    if (!regionsInstance) return;

    try {
        const regions = regionsInstance.getRegions();
        if (Array.isArray(regions)) {
            regions.forEach(region => {
                if (region && region.id && region.id.startsWith('cutOverlay')) {
                    if (typeof region.remove === 'function') {
                        region.remove();
                    }
                }
            });
        }
    } catch (error) {
        console.error('WaveformRegions: Error clearing cut overlays:', error);
    }
}

/**
 * Clear all cut overlays immediately
 */
function clearAllCutOverlaysImmediate() {
    clearCutOverlaysForInstance(wsRegions);
}

/**
 * Style regions with cut overlays
 * @param {object} wavesurferInstance - The WaveSurfer instance
 */
function styleRegions(wavesurferInstance, regionsInstance = wsRegions) {
    if (!regionsInstance || !wavesurferInstance) {
        console.warn('WaveformRegions: Cannot style regions - missing dependencies');
        return;
    }
    
    console.log('WaveformRegions: Styling regions with cut overlays');
    
    try {
        const regions = regionsInstance.getRegions();
        const trimRegion = Array.isArray(regions) ? 
            regions.find(r => r && r.id === 'trimRegion') : 
            (regions ? regions['trimRegion'] : null);
        
        if (!trimRegion) {
            console.log('WaveformRegions: No trim region found for styling');
            return;
        }
        
        const duration = wavesurferInstance.getDuration();
        if (!duration || duration <= 0) {
            console.warn('WaveformRegions: Invalid duration for styling:', duration);
            return;
        }
        
        clearCutOverlaysForInstance(regionsInstance);

        if (trimRegion.start > 0.01) {
            regionsInstance.addRegion({
                id: 'cutOverlay-before',
                start: 0,
                end: Math.max(0, trimRegion.start - MIN_REGION_DURATION),
                color: 'rgba(0, 0, 0, 0.42)',
                drag: false,
                resize: false
            });
        }

        if (trimRegion.end < duration - 0.01) {
            regionsInstance.addRegion({
                id: 'cutOverlay-after',
                start: Math.min(duration, trimRegion.end + MIN_REGION_DURATION),
                end: duration,
                color: 'rgba(0, 0, 0, 0.42)',
                drag: false,
                resize: false
            });
        }

    } catch (error) {
        console.error('WaveformRegions: Error styling regions:', error);
    }
}

/**
 * Update trim inputs from region data
 * @param {object} region - The region object
 */
function updateTrimInputsFromRegion(region, wavesurferInstance) {
    if (!region || region.id !== 'trimRegion') {
        if (typeof onTrimChangeCallback === 'function') {
            onTrimChangeCallback(0, undefined);
        }
        return;
    }

    const duration = wavesurferInstance?.getDuration?.() || 0;
    notifyTrimChange(region.start, region.end, duration);
}

/**
 * Get current trim times from regions
 * @returns {{trimStartTime: number, trimEndTime: number} | null}
 */
function getCurrentTrimTimes() {
    if (!wsRegions) {
        console.log('WaveformRegions: wsRegions not available');
        return null;
    }
    
    const regions = wsRegions.getRegions();
    let trimRegion = null;
    
    // Handle both array and object formats
    if (Array.isArray(regions)) {
        trimRegion = regions.find(r => r && r.id === 'trimRegion');
    } else if (regions && typeof regions === 'object') {
        trimRegion = regions['trimRegion'];
    }
    
    if (trimRegion) {
        return {
            trimStartTime: trimRegion.start,
            trimEndTime: trimRegion.end,
        };
    }

    return null;
}

/**
 * Set up region event handlers
 * @param {object} wavesurferInstance - The WaveSurfer instance
 */
function setupRegionEventHandlers(wavesurferInstance) {
    if (!wsRegions || !wavesurferInstance) {
        console.warn('WaveformRegions: Cannot setup region events - missing dependencies');
        return;
    }
    
    console.log('WaveformRegions: Setting up region event handlers...');

    wavesurferInstance.on('zoom', () => {
        if (!isDestroyingWaveform) {
            syncTrimBracketMarkers(wavesurferInstance);
        }
    });
    
    // Handle when regions are created
    wsRegions.on('region-created', (region) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        if (region.id === 'trimRegion' || region.id === 'trimRegion-playback') {
            setTimeout(() => {
                styleRegions(wavesurferInstance);
                syncTrimBracketMarkers(wavesurferInstance);
            }, 100);
        }
    });
    
    wsRegions.on('region-update', (region) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        if (region?.id === 'trimRegion' || region?.id === 'trimRegion-playback') {
            syncTrimBracketMarkers(wavesurferInstance);
        }
    });

    // Handle when regions are updated (drag/resize finished — WaveSurfer v7 emits this, not region-update-end)
    wsRegions.on('region-updated', (region) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        if (region.id === 'trimRegion') {
            updateTrimInputsFromRegion(region, wavesurferInstance);
            styleRegions(wavesurferInstance);
            syncTrimBracketMarkers(wavesurferInstance);
        }
    });

    // Legacy event name — keep as fallback for older builds
    wsRegions.on('region-update-end', (region) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        if (region.id === 'trimRegion') {
            updateTrimInputsFromRegion(region, wavesurferInstance);
            styleRegions(wavesurferInstance);
            syncTrimBracketMarkers(wavesurferInstance);
        }
    });
    
    // Handle when regions are removed
    wsRegions.on('region-removed', (region) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        console.log('WaveformRegions: Region removed event fired:', region.id);
        // Only treat as full-duration reset if the actual trim region was removed by the user.
        if (region && region.id === 'trimRegion') {
            updateTrimInputsFromRegion(null, wavesurferInstance);
        } else {
            // Ignore removal of non-trim overlay regions to avoid clobbering trims
            console.log('WaveformRegions: Non-trim region removed; ignoring for trim inputs.');
        }
    });
    
    // Handle region click events
    wsRegions.on('region-clicked', (region, event) => {
        if (!wavesurferInstance || !wsRegions || isDestroyingWaveform) return;
        console.log('WaveformRegions: Region clicked event fired:', region.id);
        // Optionally seek to region start on click
        const duration = wavesurferInstance.getDuration();
        if (duration > 0) {
            wavesurferInstance.seekTo(region.start / duration);
        }
    });
    
    console.log('WaveformRegions: Region event handlers setup completed');
}

/**
 * Force waveform refresh by restyling regions
 * @param {object} wavesurferInstance - The WaveSurfer instance
 */
function forceWaveformRefresh(wavesurferInstance) {
    if (!wsRegions || !wavesurferInstance) {
        console.warn('WaveformRegions: Cannot refresh - missing dependencies');
        return;
    }
    
    console.log('WaveformRegions: Forcing waveform refresh');
    
    try {
        // Re-apply region styling
        setTimeout(() => {
            styleRegions(wavesurferInstance);
        }, 100);
        
    } catch (error) {
        console.error('WaveformRegions: Error during waveform refresh:', error);
    }
}

export {
    initRegionModule,
    setRegionsInstance,
    getRegionsInstance,
    setDestroyingFlag,
    loadRegionsFromCue,
    loadReadOnlyTrimRegions,
    clearAllRegionsHard,
    clearAllCutOverlaysImmediate,
    styleRegions,
    syncTrimBracketMarkers,
    updateTrimInputsFromRegion,
    getCurrentTrimTimes,
    setupRegionEventHandlers,
    forceWaveformRefresh
};
