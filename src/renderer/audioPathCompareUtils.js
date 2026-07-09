/**
 * Compare audio file paths, including resolved workspace/UNC variants.
 */

function normalizePathForCompare(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    return filePath.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * @param {string} oldPath
 * @param {string} newPath
 * @param {Function|null} resolveAudioPathFn - async (path) => { success, path }
 * @returns {Promise<boolean>}
 */
async function pathsReferToSameAudioFile(oldPath, newPath, resolveAudioPathFn) {
    if (!oldPath || !newPath) return false;

    if (normalizePathForCompare(oldPath) === normalizePathForCompare(newPath)) {
        return true;
    }

    if (typeof resolveAudioPathFn !== 'function') {
        return false;
    }

    try {
        const [oldResult, newResult] = await Promise.all([
            resolveAudioPathFn(oldPath),
            resolveAudioPathFn(newPath)
        ]);
        const resolvedOld = oldResult?.success && oldResult.path ? oldResult.path : oldPath;
        const resolvedNew = newResult?.success && newResult.path ? newResult.path : newPath;
        return normalizePathForCompare(resolvedOld) === normalizePathForCompare(resolvedNew);
    } catch (error) {
        console.warn('audioPathCompareUtils: resolve comparison failed:', error);
        return false;
    }
}

export { normalizePathForCompare, pathsReferToSameAudioFile };
