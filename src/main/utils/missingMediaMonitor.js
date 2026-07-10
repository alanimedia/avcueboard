const { collectMissingMedia, summarizeMissingMedia } = require('./audioRelinkUtils');

let lastMissingSignature = '';

function buildMissingSignature(missingCueIds = []) {
    return [...missingCueIds].sort().join('|');
}

function syncMissingMediaSignature(missingCueIds = []) {
    lastMissingSignature = buildMissingSignature(missingCueIds);
}

function scanMissingMediaState(cueManager, workspaceManager) {
    if (!cueManager || typeof cueManager.getCues !== 'function') {
        return { changed: false, missingCueIds: [], fileCount: 0, cueCount: 0 };
    }

    const workspaceDir = workspaceManager?.getCurrentWorkspacePath?.()
        || cueManager.getWorkspaceDirectory?.()
        || null;
    const missing = collectMissingMedia(cueManager.getCues(), workspaceDir);
    const summary = summarizeMissingMedia(missing);
    const signature = buildMissingSignature(summary.missingCueIds);
    const changed = signature !== lastMissingSignature;
    lastMissingSignature = signature;

    return {
        changed,
        missingCueIds: summary.missingCueIds,
        fileCount: summary.fileCount,
        cueCount: summary.cueCount,
        missing
    };
}

function resetMissingMediaSignature() {
    lastMissingSignature = '';
}

module.exports = {
    scanMissingMediaState,
    syncMissingMediaSignature,
    resetMissingMediaSignature
};
