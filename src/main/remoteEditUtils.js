const {
    normalizeShowButtonWaveformOverride,
    resolveEffectiveShowButtonWaveform,
    normalizeShowCueMeterOverride,
    resolveEffectiveShowCueMeter
} = require('./showButtonWaveformUtils');
const {
    normalizeRetriggerBehaviorOverride,
    hasRetriggerBehaviorOverride,
    resolveEffectiveRetriggerBehavior
} = require('./retriggerBehaviorUtils');

const REMOTE_EDITABLE_CUE_FIELDS = new Set([
    'name',
    'volume',
    'fadeInTime',
    'fadeOutTime',
    'loop',
    'retriggerBehavior',
    'buttonColor',
    'showButtonWaveform',
    'showCueMeter'
]);

const REMOTE_EDITABLE_CONFIG_FIELDS = new Set([
    'defaultCueType',
    'defaultFadeInTime',
    'defaultFadeOutTime',
    'defaultLoopSingleCue',
    'defaultRetriggerBehavior',
    'defaultStopAllBehavior',
    'defaultStopAllFadeOutTime',
    'crossfadeTime',
    'defaultShowButtonWaveform',
    'defaultShowCueMeter',
    'mainWaveformEnabled'
]);

function validateCueName(cueName, fallbackId) {
    const trimmedName = cueName ? String(cueName).trim() : '';
    if (!trimmedName) {
        return `Cue ${fallbackId}`;
    }
    return trimmedName;
}

function validateVolume(volume) {
    const parsed = Number(volume);
    if (Number.isNaN(parsed)) return 1;
    return Math.max(0, Math.min(1, parsed));
}

function sanitizeCuePatch(patch = {}) {
    const sanitized = {};
    if (patch.name !== undefined) {
        sanitized.name = patch.name;
    }
    if (patch.volume !== undefined) {
        sanitized.volume = validateVolume(patch.volume);
    }
    if (patch.fadeInTime !== undefined) {
        sanitized.fadeInTime = Math.max(0, parseInt(patch.fadeInTime, 10) || 0);
    }
    if (patch.fadeOutTime !== undefined) {
        sanitized.fadeOutTime = Math.max(0, parseInt(patch.fadeOutTime, 10) || 0);
    }
    if (patch.loop !== undefined) {
        sanitized.loop = !!patch.loop;
    }
    if (patch.retriggerBehavior !== undefined) {
        sanitized.retriggerBehavior = normalizeRetriggerBehaviorOverride(patch.retriggerBehavior);
    }
    if (patch.buttonColor !== undefined) {
        sanitized.buttonColor = patch.buttonColor || null;
    }
    if (patch.showButtonWaveform !== undefined) {
        if (patch.showButtonWaveform === true) sanitized.showButtonWaveform = true;
        else if (patch.showButtonWaveform === false) sanitized.showButtonWaveform = false;
        else sanitized.showButtonWaveform = null;
    }
    if (patch.showCueMeter !== undefined) {
        if (patch.showCueMeter === true) sanitized.showCueMeter = true;
        else if (patch.showCueMeter === false) sanitized.showCueMeter = false;
        else sanitized.showCueMeter = null;
    }
    if (patch.shuffle !== undefined) sanitized.shuffle = !!patch.shuffle;
    if (patch.repeatOne !== undefined) sanitized.repeatOne = !!patch.repeatOne;
    if (patch.playlistPlayMode !== undefined) {
        const mode = String(patch.playlistPlayMode);
        if (mode === 'continue' || mode === 'stop_and_cue_next') {
            sanitized.playlistPlayMode = mode;
        }
    }
    if (patch.trimStartTime !== undefined) {
        sanitized.trimStartTime = Math.max(0, parseFloat(patch.trimStartTime) || 0);
    }
    if (patch.trimEndTime !== undefined) {
        const val = parseFloat(patch.trimEndTime);
        sanitized.trimEndTime = (val > 0) ? val : undefined;
    }
    if (patch.enableDucking !== undefined) sanitized.enableDucking = !!patch.enableDucking;
    if (patch.isDuckingTrigger !== undefined) sanitized.isDuckingTrigger = !!patch.isDuckingTrigger;
    if (patch.duckingLevel !== undefined) {
        const level = parseInt(patch.duckingLevel, 10);
        sanitized.duckingLevel = Math.max(0, Math.min(100, Number.isNaN(level) ? 80 : level));
    }
    return sanitized;
}

function mergeCuePatch(existingCue, patch) {
    const sanitized = sanitizeCuePatch(patch);
    const merged = { ...existingCue, ...sanitized };
    if (sanitized.name !== undefined) {
        merged.name = validateCueName(sanitized.name, existingCue.id);
    }
    return merged;
}

function sanitizeConfigPatch(patch = {}) {
    const sanitized = {};
    if (patch.defaultCueType !== undefined) {
        const type = String(patch.defaultCueType);
        if (type === 'single_file' || type === 'playlist') {
            sanitized.defaultCueType = type;
        }
    }
    if (patch.defaultFadeInTime !== undefined) {
        sanitized.defaultFadeInTime = Math.max(0, parseInt(patch.defaultFadeInTime, 10) || 0);
    }
    if (patch.defaultFadeOutTime !== undefined) {
        sanitized.defaultFadeOutTime = Math.max(0, parseInt(patch.defaultFadeOutTime, 10) || 0);
    }
    if (patch.defaultLoopSingleCue !== undefined) {
        sanitized.defaultLoopSingleCue = !!patch.defaultLoopSingleCue;
    }
    if (patch.defaultRetriggerBehavior !== undefined) {
        sanitized.defaultRetriggerBehavior = String(patch.defaultRetriggerBehavior);
    }
    if (patch.defaultStopAllBehavior !== undefined) {
        const behavior = String(patch.defaultStopAllBehavior);
        if (behavior === 'stop' || behavior === 'fade_out_and_stop') {
            sanitized.defaultStopAllBehavior = behavior;
        }
    }
    if (patch.defaultStopAllFadeOutTime !== undefined) {
        sanitized.defaultStopAllFadeOutTime = Math.max(0, parseInt(patch.defaultStopAllFadeOutTime, 10) || 0);
    }
    if (patch.crossfadeTime !== undefined) {
        sanitized.crossfadeTime = Math.max(100, parseInt(patch.crossfadeTime, 10) || 2000);
    }
    if (patch.defaultShowButtonWaveform !== undefined) {
        sanitized.defaultShowButtonWaveform = !!patch.defaultShowButtonWaveform;
    }
    if (patch.defaultShowCueMeter !== undefined) {
        sanitized.defaultShowCueMeter = !!patch.defaultShowCueMeter;
    }
    if (patch.mainWaveformEnabled !== undefined) {
        sanitized.mainWaveformEnabled = !!patch.mainWaveformEnabled;
    }
    if (patch.audioOutputDeviceId !== undefined) {
        sanitized.audioOutputDeviceId = String(patch.audioOutputDeviceId || 'default');
    }
    if (patch.audioMonitorOutputDeviceId !== undefined) {
        sanitized.audioMonitorOutputDeviceId = String(patch.audioMonitorOutputDeviceId || 'default');
    }
    if (patch.mainOutputVolume !== undefined) {
        const volume = Number(patch.mainOutputVolume);
        if (Number.isFinite(volume)) {
            sanitized.mainOutputVolume = Math.max(0, Math.min(1, volume));
        }
    }
    if (patch.monitorOutputVolume !== undefined) {
        const volume = Number(patch.monitorOutputVolume);
        if (Number.isFinite(volume)) {
            sanitized.monitorOutputVolume = Math.max(0, Math.min(1, volume));
        }
    }
    if (patch.routeShowPlaybackToMonitor !== undefined) {
        sanitized.routeShowPlaybackToMonitor = !!patch.routeShowPlaybackToMonitor;
    }
    return sanitized;
}

function getRemoteConfigSnapshot(appConfig = {}) {
    return {
        defaultCueType: appConfig.defaultCueType || 'single_file',
        defaultFadeInTime: appConfig.defaultFadeInTime ?? 0,
        defaultFadeOutTime: appConfig.defaultFadeOutTime ?? 0,
        defaultLoopSingleCue: !!appConfig.defaultLoopSingleCue,
        defaultRetriggerBehavior: appConfig.defaultRetriggerBehavior || 'restart',
        defaultStopAllBehavior: appConfig.defaultStopAllBehavior || 'stop',
        defaultStopAllFadeOutTime: appConfig.defaultStopAllFadeOutTime ?? 1500,
        crossfadeTime: appConfig.crossfadeTime ?? 2000,
        defaultShowButtonWaveform: appConfig.defaultShowButtonWaveform === true,
        defaultShowCueMeter: appConfig.defaultShowCueMeter !== false,
        mainWaveformEnabled: appConfig.mainWaveformEnabled !== false,
        audioOutputDeviceId: appConfig.audioOutputDeviceId || 'default',
        audioMonitorOutputDeviceId: appConfig.audioMonitorOutputDeviceId || 'default',
        mainOutputVolume: typeof appConfig.mainOutputVolume === 'number' ? appConfig.mainOutputVolume : 1,
        monitorOutputVolume: typeof appConfig.monitorOutputVolume === 'number' ? appConfig.monitorOutputVolume : 1,
        routeShowPlaybackToMonitor: !!appConfig.routeShowPlaybackToMonitor
    };
}

function reorderCuesByIds(cues, cueIds) {
    if (!Array.isArray(cueIds) || cueIds.length === 0) {
        throw new Error('cueIds must be a non-empty array');
    }
    const cueMap = new Map(cues.map(cue => [cue.id, cue]));
    const reordered = [];
    cueIds.forEach(id => {
        if (cueMap.has(id)) {
            reordered.push(cueMap.get(id));
            cueMap.delete(id);
        }
    });
    cueMap.forEach(cue => reordered.push(cue));
    if (reordered.length !== cues.length) {
        throw new Error('Reorder list must include all cue IDs');
    }
    return reordered;
}

function processCueDetailForRemote(cue, appConfig = {}, workspaceDir = null) {
    if (!cue) return null;
    const { collectMissingMedia } = require('./utils/audioRelinkUtils');
    const showButtonWaveform = normalizeShowButtonWaveformOverride(cue.showButtonWaveform);
    const showCueMeter = normalizeShowCueMeterOverride(cue.showCueMeter);
    let effectiveShow = showButtonWaveform;
    if (showButtonWaveform === null) {
        effectiveShow = appConfig.defaultShowButtonWaveform === true;
    } else {
        effectiveShow = showButtonWaveform === true;
    }

    const retriggerOverride = normalizeRetriggerBehaviorOverride(cue.retriggerBehavior);

    return {
        id: cue.id,
        name: cue.name,
        type: cue.type || 'single_file',
        filePath: cue.filePath || null,
        volume: cue.volume !== undefined ? cue.volume : 1,
        fadeInTime: cue.fadeInTime || 0,
        fadeOutTime: cue.fadeOutTime || 0,
        loop: !!cue.loop,
        retriggerBehavior: retriggerOverride,
        effectiveRetriggerBehavior: resolveEffectiveRetriggerBehavior(cue, appConfig),
        hasRetriggerOverride: hasRetriggerBehaviorOverride(cue),
        buttonColor: cue.buttonColor || null,
        showButtonWaveform: showButtonWaveform,
        effectiveShowButtonWaveform: effectiveShow,
        showCueMeter: showCueMeter,
        effectiveShowCueMeter: resolveEffectiveShowCueMeter(cue, appConfig),
        shuffle: !!cue.shuffle,
        repeatOne: !!cue.repeatOne,
        playlistPlayMode: cue.playlistPlayMode || 'continue',
        trimStartTime: cue.trimStartTime || 0,
        trimEndTime: cue.trimEndTime || 0,
        enableDucking: !!cue.enableDucking,
        isDuckingTrigger: !!cue.isDuckingTrigger,
        duckingLevel: cue.duckingLevel !== undefined ? cue.duckingLevel : 80,
        playlistItems: Array.isArray(cue.playlistItems)
            ? cue.playlistItems.map(item => ({
                id: item.id,
                name: item.name,
                filePath: item.filePath || item.path || null
            }))
            : [],
        mediaMissing: collectMissingMedia([cue], workspaceDir).length > 0
    };
}

module.exports = {
    REMOTE_EDITABLE_CUE_FIELDS,
    REMOTE_EDITABLE_CONFIG_FIELDS,
    sanitizeCuePatch,
    sanitizeConfigPatch,
    mergeCuePatch,
    getRemoteConfigSnapshot,
    reorderCuesByIds,
    validateCueName,
    validateVolume,
    processCueDetailForRemote
};
