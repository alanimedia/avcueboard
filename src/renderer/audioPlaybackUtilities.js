// Companion_soundboard/src/renderer/audioPlaybackUtilities.js
// Utility functions for audio playback management

import { log } from './audioPlaybackLogger.js';
import { cleanupAllResources } from './audioPlaybackUtils.js';
import { _cuePlaylistAtPosition } from './audioPlaybackPlaylist.js';
import { scheduleTrimEndEnforcement, createTimeUpdateInterval } from './playbackTimeManager.js';

const pendingSeekTimers = new Map();

function clampSeekPosition(positionSec, cue) {
    const trimStart = cue?.trimStartTime || 0;
    let clamped = Math.max(trimStart, Number(positionSec) || 0);
    const trimEnd = cue?.trimEndTime;
    if (trimEnd != null && trimEnd > trimStart) {
        clamped = Math.min(trimEnd, clamped);
    }
    return clamped;
}

function sendSeekPlaybackUpdate(cueId, playingState, sound, status, context) {
    const { sendPlaybackTimeUpdateRef, getGlobalCueByIdRef } = context;
    if (!sendPlaybackTimeUpdateRef || !getGlobalCueByIdRef) return;

    const mainCue = playingState.cue || getGlobalCueByIdRef(cueId);
    let currentItemName = mainCue?.name || 'Cue';
    if (playingState.isPlaylist && playingState.originalPlaylistItems?.[playingState.currentPlaylistItemIndex]) {
        currentItemName = playingState.originalPlaylistItems[playingState.currentPlaylistItemIndex].name || currentItemName;
    }
    sendPlaybackTimeUpdateRef(cueId, sound, playingState, currentItemName, status);
}

function getCurrentItemNameForState(cueId, playingState, context) {
    const mainCue = playingState.cue || context.getGlobalCueByIdRef?.(cueId);
    let currentItemName = mainCue?.name || 'Cue';
    if (playingState.isPlaylist && playingState.originalPlaylistItems?.[playingState.currentPlaylistItemIndex]) {
        currentItemName = playingState.originalPlaylistItems[playingState.currentPlaylistItemIndex].name || currentItemName;
    }
    return currentItemName;
}

function ensureTimeUpdateIntervalAfterSeek(cueId, playingState, sound, context) {
    if (!sound?.playing() || playingState.isPaused) return;
    if (context.playbackIntervals?.[cueId] || playingState.timeUpdateInterval) return;

    const intervalContext = {
        ...context,
        sendPlaybackTimeUpdate: context.sendPlaybackTimeUpdateRef,
        cueGridAPI: context.cueGridAPIRef,
        getAppConfigFunc: context.getAppConfigFuncRef,
    };
    createTimeUpdateInterval(
        cueId,
        sound,
        playingState,
        getCurrentItemNameForState(cueId, playingState, context),
        intervalContext
    );
}

export function setCueVolumeInCue(cueId, volume, context, options = {}) {
    const { currentlyPlaying, sendPlaybackTimeUpdateRef, getGlobalCueByIdRef, cueStoreRef } = context;
    const { persist = true } = options;
    const clamped = Math.max(0, Math.min(1, Number(volume)));
    if (!Number.isFinite(clamped)) return false;

    const cue = getGlobalCueByIdRef?.(cueId);
    if (persist && cueStoreRef && cue) {
        cueStoreRef.addOrUpdateCue({ ...cue, volume: clamped });
    }

    const playingState = currentlyPlaying[cueId];
    if (!playingState?.sound) return persist;

    playingState.originalVolume = clamped;

    let targetVolume = clamped;
    if (playingState.isDucked) {
        const triggerCue = getGlobalCueByIdRef?.(playingState.activeDuckingTriggerId);
        const duckingLevel = triggerCue?.duckingLevel !== undefined ? triggerCue.duckingLevel : 80;
        targetVolume = clamped * (1 - duckingLevel / 100);
    }

    playingState.sound.volume(targetVolume);

    const sound = playingState.sound;
    let status = 'playing';
    if (playingState.isPaused) {
        status = 'paused';
    } else if (!playingState.isScrubbing && !sound.playing()) {
        status = 'stopped';
    }
    sendSeekPlaybackUpdate(cueId, playingState, sound, status, context);
    return true;
}

function getActiveSound(playingState) {
    return playingState?.sound || null;
}

function getTargetVolumeForState(playingState, context) {
    const { getGlobalCueByIdRef } = context;
    let target = playingState.originalVolume ?? 1;
    if (playingState.isDucked) {
        const triggerCue = getGlobalCueByIdRef?.(playingState.activeDuckingTriggerId);
        const duckPct = triggerCue?.duckingLevel ?? 80;
        target = target * (1 - duckPct / 100);
    }
    return Math.max(0, Math.min(1, target));
}

export function prepareScrubInCue(cueId, context) {
    const { currentlyPlaying } = context;
    const playingState = currentlyPlaying[cueId];
    const sound = getActiveSound(playingState);
    if (!sound) return;

    if (!playingState.isScrubbing) {
        playingState.isScrubbing = true;
        playingState.wasPlayingBeforeScrub = sound.playing() && !playingState.isPaused;
        const currentVol = typeof sound.volume === 'function' ? sound.volume() : 1;
        playingState.scrubRestoreVolume = currentVol > 0
            ? currentVol
            : getTargetVolumeForState(playingState, context);
    }
    sound.volume(0);
}

function finishScrubInCue(playingState, sound, context) {
    if (!playingState?.isScrubbing) return;
    let restoreVolume = playingState.scrubRestoreVolume ?? getTargetVolumeForState(playingState, context);
    if (restoreVolume <= 0) {
        restoreVolume = getTargetVolumeForState(playingState, context);
    }
    playingState.isScrubbing = false;
    playingState.scrubRestoreVolume = null;
    if (sound && typeof sound.volume === 'function') {
        sound.volume(restoreVolume);
    }
    const shouldResume = playingState.wasPlayingBeforeScrub;
    playingState.wasPlayingBeforeScrub = false;
    if (shouldResume && sound && !sound.playing()) {
        playingState.isPaused = false;
        sound.play();
    }
}

export function finishScrubInCueById(cueId, context) {
    const playingState = context.currentlyPlaying?.[cueId];
    const sound = getActiveSound(playingState);
    finishScrubInCue(playingState, sound, context);
}

function rescheduleTrimAfterSeek(cueId, sound, playingState, cue, context) {
    if (!cue || !sound) return;
    if (playingState.trimEndTimer) {
        clearTimeout(playingState.trimEndTimer);
        playingState.trimEndTimer = null;
    }
    const filePath = cue.filePath || playingState.currentFilePath;
    if (!filePath) return;
    scheduleTrimEndEnforcement(cueId, sound, playingState, cue, filePath, {
        currentlyPlaying: context.currentlyPlaying,
        getGlobalCueById: context.getGlobalCueByIdRef
    });
}

function applySeekToSound(cueId, playingState, sound, clampedPosition, context, options = {}) {
    const { finalizeScrub = true, skipScrubMute = false } = options;
    const { getGlobalCueByIdRef } = context;
    const cue = playingState.cue || getGlobalCueByIdRef?.(cueId);
    const wasPlayingBefore = (sound.playing() && !playingState.isPaused) || playingState.wasPlayingBeforeScrub;

    if (skipScrubMute && playingState.isScrubbing) {
        finishScrubInCue(playingState, sound, context);
    }

    if (!skipScrubMute && wasPlayingBefore && !playingState.isScrubbing) {
        prepareScrubInCue(cueId, context);
    }

    playingState.lastSeekPosition = clampedPosition;
    sound.seek(clampedPosition);

    if (wasPlayingBefore && cue) {
        rescheduleTrimAfterSeek(cueId, sound, playingState, cue, context);
    }

    if (!skipScrubMute && finalizeScrub) {
        finishScrubInCue(playingState, sound, context);
    }

    if (skipScrubMute && typeof sound.volume === 'function' && sound.volume() <= 0) {
        sound.volume(getTargetVolumeForState(playingState, context));
    }

    if (wasPlayingBefore && !playingState.isPaused && !sound.playing()) {
        playingState.isPaused = false;
        sound.play();
    }

    playingState.isPaused = false;

    const status = sound.playing()
        ? 'playing'
        : (playingState.isPaused ? 'paused' : 'paused_seek');
    sendSeekPlaybackUpdate(cueId, playingState, sound, status, context);
    ensureTimeUpdateIntervalAfterSeek(cueId, playingState, sound, context);
}

export function seekInCue(cueId, positionSec, context, options = {}) {
    const {
        currentlyPlaying,
        getGlobalCueByIdRef
    } = context;
    const { finalizeScrub = true, coalesceMs = 0, skipScrubMute = false } = options;

    const playingState = currentlyPlaying[cueId];
    const sound = getActiveSound(playingState);
    if (!playingState || !sound) {
        if (playingState?.isScrubbing) {
            finishScrubInCue(playingState, getActiveSound(playingState), context);
        }
        console.warn(`AudioPlaybackManager: seekInCue called for ${cueId}, but no playing sound found.`);
        return;
    }

    const cue = playingState.cue || getGlobalCueByIdRef?.(cueId);
    const clampedPosition = clampSeekPosition(positionSec, cue);

    if (coalesceMs > 0 && !finalizeScrub) {
        const existing = pendingSeekTimers.get(cueId);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            pendingSeekTimers.delete(cueId);
            applySeekToSound(cueId, playingState, sound, clampedPosition, context, { finalizeScrub: false, skipScrubMute });
        }, coalesceMs);
        pendingSeekTimers.set(cueId, { timer, positionSec: clampedPosition });
        return;
    }

    if (finalizeScrub) {
        const pending = pendingSeekTimers.get(cueId);
        if (pending) {
            clearTimeout(pending.timer);
            pendingSeekTimers.delete(cueId);
        }
    }

    applySeekToSound(cueId, playingState, sound, clampedPosition, context, { finalizeScrub, skipScrubMute });
    if (finalizeScrub && !skipScrubMute && playingState.isScrubbing) {
        finishScrubInCue(playingState, sound, context);
    }
}

export function stopAllCues(options = { exceptCueId: null, useFade: true }, context) {
    const {
        currentlyPlaying,
        allSoundInstances,
        getAppConfigFuncRef,
        cueGridAPIRef,
        getGlobalCueByIdRef
    } = context;

    console.log('🛑 AudioPlaybackManager: stopAllCues called. Options:', options);
    console.log('🛑 Current currentlyPlaying:', Object.keys(currentlyPlaying));
    console.log('🛑 Current allSoundInstances:', Object.keys(allSoundInstances));

    // Remember which playlists had cued states for restoration after stop
    const playlistsToRestoreCued = [];
    Object.keys(currentlyPlaying).forEach(cueId => {
        const state = currentlyPlaying[cueId];
        const cue = getGlobalCueByIdRef && getGlobalCueByIdRef(cueId);
        
        // Check if this is a playlist in stop_and_cue_next mode that should be cued after stop
        if (state && state.isPlaylist && cue && cue.type === 'playlist' && 
            cue.playlistPlayMode === 'stop_and_cue_next') {
            playlistsToRestoreCued.push({
                cueId: cueId,
                cue: cue,
                currentIndex: state.currentPlaylistItemIndex || 0
            });
            console.log(`🛑 Will restore cued state for playlist ${cueId} at index ${state.currentPlaylistItemIndex}`);
        }
    });

    let useFadeForStop = options.useFade;

    if (options && options.behavior) {
        useFadeForStop = options.behavior === 'fade_out_and_stop';
        console.log(`AudioPlaybackManager: stopAllCues - behavior specified: '${options.behavior}', setting useFadeForStop to: ${useFadeForStop}`);
    } else if (options && options.useFade !== undefined) {
        useFadeForStop = options.useFade;
        console.log(`AudioPlaybackManager: stopAllCues - behavior NOT specified, using options.useFade: ${useFadeForStop}`);
    } else {
        useFadeForStop = true; 
        console.log(`AudioPlaybackManager: stopAllCues - behavior and options.useFade NOT specified, defaulting useFadeForStop to: ${useFadeForStop}`);
    }

    // Get all sound instances (both managed and independent) to stop
    const soundInstancesToStop = Object.keys(allSoundInstances).filter(soundId => {
        const instance = allSoundInstances[soundId];
        return !options.exceptCueId || instance.cueId !== options.exceptCueId;
    });

    console.log(`AudioPlaybackManager: stopAllCues - Stopping ${soundInstancesToStop.length} sound instances (managed + independent)`);
    
    // Stop all sound instances directly
    soundInstancesToStop.forEach(soundId => {
        const instance = allSoundInstances[soundId];
        if (instance && instance.sound) {
            const { sound, cueId, playingState } = instance;
            
            console.log(`[STOP_ALL_DEBUG] Stopping sound instance ${soundId} for cue ${cueId}. IsIndependent: ${playingState.isIndependentInstance}`);
            
            // Mark as stop_all for proper cleanup
            playingState.explicitStopReason = 'stop_all';
            if (sound) {
                sound.acExplicitStopReason = 'stop_all';
            }
            
            // Apply fade if requested
            if (useFadeForStop) {
                const appConfig = getAppConfigFuncRef ? getAppConfigFuncRef() : {};
                const fadeOutTime = appConfig.defaultStopAllFadeOutTime !== undefined ? appConfig.defaultStopAllFadeOutTime : 1500;
                
                if (fadeOutTime > 0) {
                    console.log(`[STOP_ALL_DEBUG] Applying ${fadeOutTime}ms fade to sound ${soundId}`);
                    // Only visualize fade if this is the active state and the sound is actually playing (audible)
                    const isActiveState = currentlyPlaying[cueId] && currentlyPlaying[cueId] === playingState;
                    const isAudible = typeof sound.playing === 'function' && sound.playing() && sound.volume() > 0.0001;
                    if (isActiveState && isAudible) {
                        // Mark fading state for UI
                        playingState.isFadingOut = true;
                        playingState.isFadingIn = false;
                        playingState.fadeTotalDurationMs = fadeOutTime;
                        playingState.fadeStartTime = Date.now();
                        // Prime UI update to reflect fade immediately
                        if (cueGridAPIRef && cueGridAPIRef.updateCueButtonTime) {
                            cueGridAPIRef.updateCueButtonTime(cueId, null, false, true, fadeOutTime);
                        }
                    }
                    sound.fade(sound.volume(), 0, fadeOutTime);
                    setTimeout(() => {
                        if (sound.playing()) {
                            sound.stop();
                        }
                    }, fadeOutTime + 50); // Small buffer
                } else {
                    sound.stop();
                }
            } else {
                sound.stop();
            }
        }
    });
    
    // Restore cued states for playlists in stop_and_cue_next mode after all sounds have stopped
    if (playlistsToRestoreCued.length > 0) {
        const appConfig = getAppConfigFuncRef ? getAppConfigFuncRef() : {};
        const fadeOutTime = useFadeForStop ? (appConfig.defaultStopAllFadeOutTime !== undefined ? appConfig.defaultStopAllFadeOutTime : 1500) : 0;
        const restoreDelay = fadeOutTime + 100; // Wait for fade to complete plus a small buffer
        
        setTimeout(() => {
            playlistsToRestoreCued.forEach(playlistInfo => {
                const { cueId, cue, currentIndex } = playlistInfo;
                console.log(`🛑 Restoring cued state for playlist ${cueId} at index ${currentIndex}`);
                
                // Use the helper function to restore cued state
                _cuePlaylistAtPosition(
                    cueId, 
                    currentIndex, 
                    context.currentlyPlaying, 
                    context.getGlobalCueByIdRef,
                    context._generateShuffleOrder,
                    context.sidebarsAPIRef,
                    context.cuePlayOrder || [],
                    context.sendPlaybackTimeUpdateRef
                );
                
                // CRITICAL FIX: Explicitly update UI here as well, since _cuePlaylistAtPosition might not trigger a button update if no sound exists yet
                // Or if the previous updateButtonPlayingState call from stop() cleared it to stopped.
                if (context.cueGridAPIRef) {
                    let nextItemName = 'Next Item';
                    // Try to get actual item name
                    if (cue.playlistItems && cue.playlistItems.length > currentIndex) {
                        const nextItem = cue.playlistItems[currentIndex];
                        nextItemName = nextItem.name || nextItem.path.split(/[\\\/]/).pop();
                    }
                    console.log(`🛑 Force updating UI for restored cued playlist ${cueId}. Next: ${nextItemName}`);
                    context.cueGridAPIRef.updateButtonPlayingState(cueId, false, `Next: ${nextItemName}`, true);
                }
            });
        }, restoreDelay);
    }
}
