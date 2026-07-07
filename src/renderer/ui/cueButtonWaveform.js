/**
 * Mini waveform strip for cue grid / remote buttons.
 */

const peaksCache = new Map();

export function resolveShowButtonWaveform(cue, appConfig = {}) {
    if (!cue) return false;
    if (cue.showButtonWaveform === true) return true;
    if (cue.showButtonWaveform === false) return false;
    return appConfig.defaultShowButtonWaveform === true;
}

export function cueHasWaveformAudio(cue) {
    if (!cue) return false;
    if (cue.hasWaveform === false) return false;
    if (cue.type === 'single_file') return !!cue.filePath;
    if (cue.type === 'playlist') {
        return !!(cue.playlistItems && cue.playlistItems.length > 0
            && (cue.playlistItems[0].filePath || cue.playlistItems[0].path));
    }
    return !!cue.filePath;
}

export function shouldShowButtonWaveform(cue, appConfig = {}) {
    return resolveShowButtonWaveform(cue, appConfig) && cueHasWaveformAudio(cue);
}

export function getPeaksCacheKey(cue) {
    const itemName = cue.playlistItemName || (cue.playlistItems?.[0]?.name) || '';
    return `${cue.id}::${itemName}`;
}

export async function loadPeaksForCue(cue, fetchPeaks) {
    if (!cue?.id || typeof fetchPeaks !== 'function') return null;
    const cacheKey = getPeaksCacheKey(cue);
    if (peaksCache.has(cacheKey)) {
        return peaksCache.get(cacheKey);
    }
    let filePath = cue.filePath;
    if (cue.type === 'playlist' && cue.playlistItems?.length) {
        const item = cue.playlistItemName
            ? cue.playlistItems.find(i => i.name === cue.playlistItemName) || cue.playlistItems[0]
            : cue.playlistItems[0];
        filePath = item?.filePath || item?.path;
    }
    if (!filePath) return null;
    try {
        const data = await fetchPeaks(filePath);
        if (!data || !data.success || !Array.isArray(data.peaks)) return null;
        peaksCache.set(cacheKey, data);
        return data;
    } catch (error) {
        console.warn('cueButtonWaveform: failed to load peaks', error);
        return null;
    }
}

export function drawWaveformOnCanvas(canvas, peaksData, cue) {
    if (!canvas || !peaksData || !Array.isArray(peaksData.peaks) || peaksData.peaks.length === 0) {
        return;
    }

    const wrap = canvas.parentElement;
    const width = Math.max(1, wrap ? wrap.clientWidth : canvas.clientWidth || 120);
    const height = Math.max(1, wrap ? wrap.clientHeight : canvas.clientHeight || 32);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const fullDuration = peaksData.duration || cue.knownDuration || cue.knownDurationS || 0;
    const trimStart = cue.trimStartTime || 0;
    const trimEnd = cue.trimEndTime && cue.trimEndTime > trimStart ? cue.trimEndTime : fullDuration;
    const trimStartRatio = fullDuration > 0 ? trimStart / fullDuration : 0;
    const trimEndRatio = fullDuration > 0 ? Math.min(1, trimEnd / fullDuration) : 1;

    const peaks = peaksData.peaks;
    const midY = height / 2;

    for (let i = 0; i < peaks.length; i++) {
        const x = (i / peaks.length) * width;
        const ratio = i / peaks.length;
        const amplitude = peaks[i] * (height * 0.42);
        ctx.fillStyle = (ratio < trimStartRatio || ratio > trimEndRatio)
            ? 'rgba(120, 120, 120, 0.55)'
            : 'rgba(79, 70, 229, 0.85)';
        ctx.fillRect(x, midY - amplitude, Math.max(1, width / peaks.length), amplitude * 2);
    }

    const playheadRatio = typeof cue.fileProgressRatio === 'number'
        ? cue.fileProgressRatio
        : (typeof cue.progressRatio === 'number'
            ? cue.progressRatio
            : (fullDuration > 0 && typeof cue.currentTimeS === 'number'
                ? (trimStart + cue.currentTimeS) / fullDuration
                : (fullDuration > 0 && typeof cue.currentTime === 'number'
                    ? (trimStart + cue.currentTime) / fullDuration
                    : 0)));
    const playheadX = Math.min(width - 1, Math.max(0, playheadRatio * width));

    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
}

export async function ensureButtonWaveform(button, cue, fetchPeaks, appConfig = {}) {
    if (!button || !shouldShowButtonWaveform(cue, appConfig)) {
        removeButtonWaveform(button);
        return;
    }

    button.classList.add('has-button-waveform');

    let wrap = button.querySelector('.cue-button-waveform-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'cue-button-waveform-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'cue-button-waveform-canvas';
        wrap.appendChild(canvas);
        button.appendChild(wrap);
    }

    wrap.classList.remove('hidden');
    const canvas = wrap.querySelector('.cue-button-waveform-canvas');
    const peaksData = await loadPeaksForCue(cue, fetchPeaks);
    if (!peaksData) {
        wrap.classList.add('hidden');
        return;
    }
    drawWaveformOnCanvas(canvas, peaksData, cue);
}

export function updateButtonWaveformPlayhead(button, cue, appConfig = {}) {
    if (!button || !shouldShowButtonWaveform(cue, appConfig)) return;
    const canvas = button.querySelector('.cue-button-waveform-canvas');
    if (!canvas) return;
    const peaksData = peaksCache.get(getPeaksCacheKey(cue));
    if (peaksData) {
        drawWaveformOnCanvas(canvas, peaksData, cue);
    }
}

export function removeButtonWaveform(button) {
    if (!button) return;
    button.classList.remove('has-button-waveform');
    const wrap = button.querySelector('.cue-button-waveform-wrap');
    if (wrap) wrap.remove();
}

export function buildCueForWaveformDraw(cue, timeData = {}) {
    const trimStart = cue.trimStartTime || 0;
    const knownDuration = cue.knownDuration || cue.knownDurationS || timeData.duration || 0;
    const currentTime = timeData.currentTime ?? cue.currentTimeS ?? 0;
    const fileProgressRatio = knownDuration > 0
        ? Math.min(1, Math.max(0, (trimStart + currentTime) / knownDuration))
        : 0;
    return {
        ...cue,
        currentTime,
        currentTimeS: currentTime,
        fileProgressRatio,
        progressRatio: timeData.duration > 0 ? currentTime / timeData.duration : 0
    };
}
