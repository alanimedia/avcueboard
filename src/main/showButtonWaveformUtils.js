function normalizeShowButtonWaveformOverride(value) {
    if (value === true) return true;
    if (value === false) return false;
    return null;
}

function resolveEffectiveShowButtonWaveform(cue, appConfig = {}) {
    if (!cue) return false;
    if (cue.showButtonWaveform === true) return true;
    if (cue.showButtonWaveform === false) return false;
    return appConfig.defaultShowButtonWaveform === true;
}

module.exports = {
    normalizeShowButtonWaveformOverride,
    resolveEffectiveShowButtonWaveform
};
