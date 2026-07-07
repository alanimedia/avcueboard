const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs').promises;
const logger = require('./utils/logger');

async function generateWaveformWithRetry(audioFilePath, retryCount = 0) {
    const waveformJsonPath = audioFilePath + '.peaks.json';
    const maxRetries = 2;
    logger.info(`WAVEFORM_PEAKS: generate for ${audioFilePath}, retry: ${retryCount}`);

    try {
        await fs.access(waveformJsonPath);
        const jsonData = await fs.readFile(waveformJsonPath, 'utf8');
        const parsedData = JSON.parse(jsonData);
        if (parsedData && (parsedData.peaks || parsedData.duration)) {
            return { success: true, ...parsedData, cached: true };
        }
        try { await fs.unlink(waveformJsonPath); } catch (e) { /* ignore */ }
    } catch (error) {
        // No cache or invalid cache
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
                await fs.writeFile(waveformJsonPath, JSON.stringify(workerResult), 'utf8');
                resolve({ success: true, ...workerResult, cached: false });
            } catch (e) {
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
    resolveAudioFilePathForCue
};
