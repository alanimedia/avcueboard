const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * True when the path looks like a bare filename (no directory component).
 */
function isLikelyIncompletePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return true;
    const trimmed = filePath.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('\\\\')) return false;
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
    return !trimmed.includes('/') && !trimmed.includes('\\');
}

function findFileByName(dir, fileName, maxDepth, currentDepth = 0) {
    if (!dir || currentDepth > maxDepth) return null;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        return null;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            return path.normalize(fullPath);
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const found = findFileByName(fullPath, fileName, maxDepth, currentDepth + 1);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Resolve an audio file path against the workspace and filesystem.
 * @param {string} filePath
 * @param {string|null} workspaceDir
 * @returns {string|null}
 */
function resolveAudioFilePath(filePath, workspaceDir) {
    if (!filePath || typeof filePath !== 'string') return null;
    const trimmed = filePath.trim();
    if (!trimmed) return null;

    if (fs.existsSync(trimmed)) {
        return path.normalize(trimmed);
    }

    if (workspaceDir) {
        const relativeCandidate = path.join(workspaceDir, trimmed);
        if (fs.existsSync(relativeCandidate)) {
            return path.normalize(relativeCandidate);
        }

        if (isLikelyIncompletePath(trimmed)) {
            const commonDirs = ['audio', 'media', 'sounds', 'music', 'assets'];
            for (const subdir of commonDirs) {
                const commonCandidate = path.join(workspaceDir, subdir, trimmed);
                if (fs.existsSync(commonCandidate)) {
                    return path.normalize(commonCandidate);
                }
            }

            const found = findFileByName(workspaceDir, trimmed, 4);
            if (found) {
                logger.info(`audioPathUtils: Resolved basename "${trimmed}" to ${found}`);
                return found;
            }
        }
    }

    return path.normalize(trimmed);
}

function normalizeCueAudioPaths(cue, workspaceDir) {
    if (!cue || !workspaceDir) return cue;
    const normalized = { ...cue };

    if (normalized.type === 'single_file' && normalized.filePath) {
        normalized.filePath = resolveAudioFilePath(normalized.filePath, workspaceDir);
    }

    if (normalized.type === 'playlist' && Array.isArray(normalized.playlistItems)) {
        normalized.playlistItems = normalized.playlistItems.map((item) => {
            if (!item?.path) return item;
            return {
                ...item,
                path: resolveAudioFilePath(item.path, workspaceDir)
            };
        });
    }

    return normalized;
}

module.exports = {
    isLikelyIncompletePath,
    resolveAudioFilePath,
    normalizeCueAudioPaths
};
