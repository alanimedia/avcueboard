const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const fs = require('fs').promises;
const fsSync = require('fs');
const { app } = require('electron');
const logger = require('./utils/logger');

const CACHE_DIR_NAME = 'waveform-cache';
/** Bump when peak JSON shape changes so old entries are ignored. */
const CACHE_VERSION = 1;

function getWaveformCacheDir() {
    return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

async function ensureWaveformCacheDir() {
    const dir = getWaveformCacheDir();
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

function legacySidecarPath(audioFilePath) {
    return `${audioFilePath}.peaks.json`;
}

function buildCacheKey(audioFilePath, stats) {
    const resolved = path.resolve(audioFilePath);
    const payload = `${CACHE_VERSION}|${resolved}|${stats.size}|${Math.trunc(stats.mtimeMs)}`;
    return crypto.createHash('sha1').update(payload).digest('hex');
}

function cacheFilePathForKey(cacheKey) {
    return path.join(getWaveformCacheDir(), `${cacheKey}.json`);
}

function isValidPeaksPayload(parsed) {
    return !!(parsed && (parsed.peaks || parsed.duration));
}

async function readJsonIfValid(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (isValidPeaksPayload(parsed)) {
            return parsed;
        }
    } catch {
        // miss or corrupt
    }
    return null;
}

/**
 * Move one legacy sidecar (`audio.ext.peaks.json`) into userData cache and delete it.
 * @returns {Promise<{ status: 'migrated'|'missing'|'invalid'|'error', removed: boolean, error?: string }>}
 */
async function migrateSidecarPeaksForAudioFile(audioFilePath) {
    if (!audioFilePath || typeof audioFilePath !== 'string') {
        return { status: 'missing', removed: false };
    }

    const sidecar = legacySidecarPath(audioFilePath);
    if (!fsSync.existsSync(sidecar)) {
        return { status: 'missing', removed: false };
    }

    const peaks = await readJsonIfValid(sidecar);
    if (!peaks) {
        try {
            await fs.unlink(sidecar);
            logger.warn(`WAVEFORM_PEAKS: removed invalid sidecar ${sidecar}`);
            return { status: 'invalid', removed: true };
        } catch (e) {
            return { status: 'invalid', removed: false, error: e.message };
        }
    }

    let stats;
    try {
        stats = await fs.stat(audioFilePath);
    } catch {
        // Audio missing — still try to drop orphan sidecar after optional stash
        try {
            await ensureWaveformCacheDir();
            const orphanKey = crypto
                .createHash('sha1')
                .update(`${CACHE_VERSION}|orphan|${path.resolve(audioFilePath)}`)
                .digest('hex');
            await fs.writeFile(cacheFilePathForKey(orphanKey), JSON.stringify(peaks), 'utf8');
            await fs.unlink(sidecar);
            return { status: 'migrated', removed: true };
        } catch (e) {
            return { status: 'error', removed: false, error: e.message };
        }
    }

    try {
        const cacheKey = buildCacheKey(audioFilePath, stats);
        const userDataPath = cacheFilePathForKey(cacheKey);
        await ensureWaveformCacheDir();

        const existing = await readJsonIfValid(userDataPath);
        if (!existing) {
            await fs.writeFile(userDataPath, JSON.stringify(peaks), 'utf8');
        }

        await fs.unlink(sidecar);
        logger.info(`WAVEFORM_PEAKS: migrated sidecar → userData and removed ${sidecar}`);
        return { status: 'migrated', removed: true };
    } catch (e) {
        logger.warn(`WAVEFORM_PEAKS: failed migrating ${sidecar}: ${e.message}`);
        return { status: 'error', removed: false, error: e.message };
    }
}

function collectAudioPathsFromCues(cues) {
    const paths = new Set();
    if (!Array.isArray(cues)) return paths;

    for (const cue of cues) {
        if (!cue) continue;
        if (cue.filePath) paths.add(cue.filePath);
        if (Array.isArray(cue.playlistItems)) {
            for (const item of cue.playlistItems) {
                if (item?.filePath) paths.add(item.filePath);
            }
        }
    }
    return paths;
}

/**
 * Find `*.peaks.json` sidecars next to known cue media (and siblings in those folders)
 * and move them into the userData waveform cache.
 */
async function migrateSidecarPeaksForCues(cues) {
    const audioPaths = collectAudioPathsFromCues(cues);
    const sidecarCandidates = new Set();

    for (const audioPath of audioPaths) {
        sidecarCandidates.add(legacySidecarPath(audioPath));
    }

    const dirs = new Set();
    for (const audioPath of audioPaths) {
        try {
            dirs.add(path.dirname(path.resolve(audioPath)));
        } catch {
            // ignore bad paths
        }
    }

    for (const dir of dirs) {
        try {
            const entries = await fs.readdir(dir);
            for (const name of entries) {
                if (name.endsWith('.peaks.json')) {
                    sidecarCandidates.add(path.join(dir, name));
                }
            }
        } catch {
            // unreadable / network offline — skip
        }
    }

    let migrated = 0;
    let removed = 0;
    let failed = 0;
    let skipped = 0;

    for (const sidecarPath of sidecarCandidates) {
        if (!sidecarPath.endsWith('.peaks.json')) continue;
        const audioFilePath = sidecarPath.slice(0, -'.peaks.json'.length);
        const result = await migrateSidecarPeaksForAudioFile(audioFilePath);
        if (result.status === 'migrated') migrated += 1;
        else if (result.status === 'missing') skipped += 1;
        else if (result.status === 'error') failed += 1;
        if (result.removed) removed += 1;
    }

    if (migrated > 0 || removed > 0 || failed > 0) {
        logger.info(
            `WAVEFORM_PEAKS: sidecar cure — migrated=${migrated}, removed=${removed}, failed=${failed}, checked=${sidecarCandidates.size}`
        );
    }

    return { migrated, removed, failed, skipped, checked: sidecarCandidates.size };
}

/**
 * Prefer userData cache. If a legacy sidecar next to the audio file exists,
 * migrate it into userData and remove the sidecar when possible.
 */
async function loadCachedPeaks(audioFilePath, cacheKey) {
    await ensureWaveformCacheDir();
    const userDataPath = cacheFilePathForKey(cacheKey);

    const fromUserData = await readJsonIfValid(userDataPath);
    if (fromUserData) {
        return { data: fromUserData, source: 'userData' };
    }

    const migrated = await migrateSidecarPeaksForAudioFile(audioFilePath);
    if (migrated.status === 'migrated' || migrated.status === 'invalid') {
        const after = await readJsonIfValid(userDataPath);
        if (after) {
            return { data: after, source: 'sidecar' };
        }
    }

    // Sidecar may have been migrated under a different key if audio was missing;
    // fall through to regenerate when needed.
    const leftover = await readJsonIfValid(legacySidecarPath(audioFilePath));
    if (leftover) {
        return { data: leftover, source: 'sidecar' };
    }

    return null;
}

async function savePeaksToUserData(cacheKey, workerResult) {
    await ensureWaveformCacheDir();
    const outPath = cacheFilePathForKey(cacheKey);
    await fs.writeFile(outPath, JSON.stringify(workerResult), 'utf8');
    return outPath;
}

async function generateWaveformWithRetry(audioFilePath, retryCount = 0) {
    const maxRetries = 2;
    logger.info(`WAVEFORM_PEAKS: generate for ${audioFilePath}, retry: ${retryCount}`);

    let stats;
    try {
        stats = await fs.stat(audioFilePath);
    } catch (statErr) {
        return {
            success: false,
            error: 'file_missing',
            errorMessage: statErr.message || 'Audio file not found'
        };
    }

    const cacheKey = buildCacheKey(audioFilePath, stats);

    if (retryCount === 0) {
        const cached = await loadCachedPeaks(audioFilePath, cacheKey);
        if (cached?.data) {
            return { success: true, ...cached.data, cached: true, cacheSource: cached.source };
        }
    }

    return new Promise((resolve) => {
        const worker = new Worker(path.join(__dirname, 'waveform-generator.js'), {
            workerData: { audioFilePath }
        });

        const workerTimeout = setTimeout(() => {
            worker.terminate();
            if (retryCount < maxRetries) {
                setTimeout(async () => {
                    resolve(await generateWaveformWithRetry(audioFilePath, retryCount + 1));
                }, Math.pow(2, retryCount) * 1000);
            } else {
                resolve({ success: false, error: 'timeout', errorMessage: 'Timed out' });
            }
        }, 30000);

        worker.on('message', async (workerResult) => {
            clearTimeout(workerTimeout);
            if (workerResult.error) {
                if (retryCount < maxRetries) {
                    setTimeout(async () => {
                        resolve(await generateWaveformWithRetry(audioFilePath, retryCount + 1));
                    }, Math.pow(2, retryCount) * 1000);
                } else {
                    resolve({
                        success: false,
                        error: 'generation_failed',
                        errorMessage: workerResult.error.message || 'Generation failed'
                    });
                }
                return;
            }
            try {
                await savePeaksToUserData(cacheKey, workerResult);
                resolve({ success: true, ...workerResult, cached: false });
            } catch (e) {
                logger.warn(`WAVEFORM_PEAKS: could not write userData cache: ${e.message}`);
                resolve({ success: true, ...workerResult, cached: false, saveWarning: e.message });
            }
        });

        worker.on('error', (err) => {
            clearTimeout(workerTimeout);
            if (retryCount < maxRetries) {
                setTimeout(async () => {
                    resolve(await generateWaveformWithRetry(audioFilePath, retryCount + 1));
                }, Math.pow(2, retryCount) * 1000);
            } else {
                resolve({ success: false, error: 'worker_error', errorMessage: err.message });
            }
        });

        worker.on('exit', (code) => {
            clearTimeout(workerTimeout);
            if (code !== 0) {
                if (retryCount < maxRetries) {
                    setTimeout(async () => {
                        resolve(await generateWaveformWithRetry(audioFilePath, retryCount + 1));
                    }, Math.pow(2, retryCount) * 1000);
                } else {
                    resolve({ success: false, error: 'worker_exit_error', errorMessage: `Exited with code ${code}` });
                }
            }
        });
    });
}

async function getWaveformPeaksForFile(audioFilePath) {
    if (!audioFilePath) {
        return { success: false, error: 'no_file_path', errorMessage: 'No file path provided' };
    }
    if (!fsSync.existsSync(audioFilePath)) {
        return { success: false, error: 'file_missing', errorMessage: 'Audio file not found' };
    }
    return generateWaveformWithRetry(audioFilePath);
}

function resolveAudioFilePathForCue(cue, playlistItemName) {
    if (!cue) return null;
    if (cue.type === 'single_file') {
        return cue.filePath || null;
    }
    if (cue.type === 'playlist' && Array.isArray(cue.playlistItems) && cue.playlistItems.length > 0) {
        if (playlistItemName) {
            const matchedItem = cue.playlistItems.find(item => item.name === playlistItemName);
            if (matchedItem && matchedItem.filePath) {
                return matchedItem.filePath;
            }
        }
        return cue.playlistItems[0].filePath || null;
    }
    return cue.filePath || null;
}

module.exports = {
    getWaveformPeaksForFile,
    resolveAudioFilePathForCue,
    getWaveformCacheDir,
    migrateSidecarPeaksForAudioFile,
    migrateSidecarPeaksForCues
};
