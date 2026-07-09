/**
 * Resolve the filesystem path for a dropped File object.
 * Electron 29+ no longer exposes file.path in the renderer; use webUtils.getPathForFile via preload.
 * @param {File} file
 * @returns {string|null}
 */
function getDroppedFilePath(file) {
    if (!file) return null;

    if (window.electronAPI?.getPathForFile) {
        try {
            const resolved = window.electronAPI.getPathForFile(file);
            if (resolved && typeof resolved === 'string') {
                return resolved;
            }
        } catch (error) {
            console.warn('droppedFileUtils: getPathForFile failed:', error);
        }
    }

    return file.path || null;
}

/**
 * @param {FileList|File[]} files
 * @returns {string[]}
 */
function getDroppedFilePaths(files) {
    return Array.from(files || [])
        .map(getDroppedFilePath)
        .filter(Boolean);
}

export { getDroppedFilePath, getDroppedFilePaths };
