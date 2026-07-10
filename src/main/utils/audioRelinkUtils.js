const fs = require('fs');
const path = require('path');
const { resolveAudioFilePath } = require('./audioPathUtils');

function getItemAudioPath(item) {
    if (!item) return null;
    return item.path || item.filePath || null;
}

function setItemAudioPath(item, newPath) {
    if (!item) return;
    if (Object.prototype.hasOwnProperty.call(item, 'path')) {
        item.path = newPath;
    }
    if (Object.prototype.hasOwnProperty.call(item, 'filePath')) {
        item.filePath = newPath;
    }
    if (!item.path && !item.filePath) {
        item.path = newPath;
    }
}

function pathExists(filePath) {
    if (!filePath) return false;
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

function isMediaMissing(storedPath, workspaceDir) {
    if (!storedPath) return false;
    const resolved = resolveAudioFilePath(storedPath, workspaceDir);
    return !pathExists(resolved);
}

/**
 * Collect cue and playlist entries whose audio files cannot be resolved on disk.
 */
function collectMissingMedia(cues, workspaceDir) {
    const missing = [];
    if (!Array.isArray(cues)) return missing;

    for (const cue of cues) {
        if (cue.type === 'single_file' && cue.filePath && isMediaMissing(cue.filePath, workspaceDir)) {
            missing.push({
                cueId: cue.id,
                cueName: cue.name || 'Unnamed Cue',
                kind: 'single_file',
                playlistItemId: null,
                itemLabel: null,
                oldPath: cue.filePath,
                fileName: path.basename(cue.filePath)
            });
        }

        if (cue.type === 'playlist' && Array.isArray(cue.playlistItems)) {
            for (const item of cue.playlistItems) {
                const itemPath = getItemAudioPath(item);
                if (!itemPath || !isMediaMissing(itemPath, workspaceDir)) continue;
                missing.push({
                    cueId: cue.id,
                    cueName: cue.name || 'Unnamed Cue',
                    kind: 'playlist_item',
                    playlistItemId: item.id || null,
                    itemLabel: item.name || path.basename(itemPath),
                    oldPath: itemPath,
                    fileName: path.basename(itemPath)
                });
            }
        }
    }

    return missing;
}

/**
 * Build a filename -> full paths index by recursively scanning searchRoot.
 */
function buildFilenameIndex(searchRoot, maxDepth = 25) {
    const index = new Map();

    function addToIndex(fileName, fullPath) {
        const normalized = path.normalize(fullPath);
        const list = index.get(fileName) || [];
        if (!list.includes(normalized)) {
            list.push(normalized);
            index.set(fileName, list);
        }
    }

    function walk(dir, depth) {
        if (!dir || depth > maxDepth) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.')) {
                    walk(fullPath, depth + 1);
                }
            } else if (entry.isFile()) {
                addToIndex(entry.name, fullPath);
            }
        }
    }

    if (searchRoot && pathExists(searchRoot)) {
        walk(searchRoot, 0);
    }

    return index;
}

/**
 * Match missing entries to files in the index by basename.
 */
function planRelinks(missingEntries, filenameIndex) {
    return missingEntries.map((entry) => {
        const candidates = filenameIndex.get(entry.fileName) || [];
        if (candidates.length === 0) {
            return { ...entry, status: 'not_found', newPath: null, candidates: [] };
        }
        if (candidates.length === 1) {
            return { ...entry, status: 'matched', newPath: candidates[0], candidates };
        }
        return { ...entry, status: 'ambiguous', newPath: null, candidates };
    });
}

function summarizeMissingMedia(missingEntries) {
    const missingCueIds = new Set();
    for (const entry of missingEntries || []) {
        if (entry?.cueId) missingCueIds.add(entry.cueId);
    }
    return {
        fileCount: missingEntries?.length || 0,
        cueCount: missingCueIds.size,
        missingCueIds: Array.from(missingCueIds)
    };
}

function summarizeRelinkPlan(plan) {
    const stats = {
        total: plan.length,
        matched: 0,
        ambiguous: 0,
        notFound: 0
    };
    for (const entry of plan) {
        if (entry.status === 'matched') stats.matched += 1;
        else if (entry.status === 'ambiguous') stats.ambiguous += 1;
        else stats.notFound += 1;
    }
    return stats;
}

/**
 * Apply relink matches to cues and persist via cueManager.setCues.
 */
async function applyRelinkMatches(cueManager, matches) {
    if (!cueManager || typeof cueManager.getCues !== 'function' || typeof cueManager.setCues !== 'function') {
        throw new Error('CueManager not available for relink apply');
    }
    if (!Array.isArray(matches) || matches.length === 0) {
        return 0;
    }

    const cues = cueManager.getCues().map((cue) => ({
        ...cue,
        playlistItems: Array.isArray(cue.playlistItems)
            ? cue.playlistItems.map((item) => ({ ...item }))
            : cue.playlistItems
    }));

    let applied = 0;
    for (const match of matches) {
        if (!match?.newPath || !match.cueId) continue;
        const cue = cues.find((c) => c.id === match.cueId);
        if (!cue) continue;

        if (match.kind === 'single_file') {
            cue.filePath = match.newPath;
            applied += 1;
            continue;
        }

        if (match.kind === 'playlist_item' && match.playlistItemId && Array.isArray(cue.playlistItems)) {
            const item = cue.playlistItems.find((i) => i.id === match.playlistItemId);
            if (item) {
                setItemAudioPath(item, match.newPath);
                applied += 1;
            }
        }
    }

    if (applied > 0) {
        await cueManager.setCues(cues);
    }
    return applied;
}

module.exports = {
    collectMissingMedia,
    buildFilenameIndex,
    planRelinks,
    summarizeMissingMedia,
    summarizeRelinkPlan,
    applyRelinkMatches,
    getItemAudioPath
};
