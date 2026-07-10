const { app, dialog } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');
const { showUpdateCheckDialog, compareVersions } = require('./utils/updateCheckUtils');

let autoUpdater = null;
let mainWindowRef = null;
let manualCheckPending = false;
let checkInProgress = false;
let initialized = false;
let pendingUpdateInfo = null;

function isWindowsAutoUpdateEnabled() {
    return app.isPackaged && process.platform === 'win32';
}

function getUpdaterPrefsPath() {
    return path.join(app.getPath('userData'), 'updater-preferences.json');
}

async function loadDeclinedVersion() {
    try {
        const prefs = await fs.readJson(getUpdaterPrefsPath());
        return prefs?.declinedVersion || null;
    } catch {
        return null;
    }
}

async function setDeclinedVersion(version) {
    if (!version) return;
    await fs.writeJson(getUpdaterPrefsPath(), { declinedVersion: version }, { spaces: 2 });
    logger.info(`AutoUpdater: user declined version ${version} until a newer release`);
}

function getMainWindow() {
    return mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
}

function initialize(mainWindow) {
    mainWindowRef = mainWindow;
    if (!isWindowsAutoUpdateEnabled() || initialized) {
        return;
    }

    try {
        ({ autoUpdater } = require('electron-updater'));
    } catch (error) {
        logger.error('AutoUpdater: failed to load electron-updater:', error);
        return;
    }

    initialized = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
        info: (message) => logger.info(`AutoUpdater: ${message}`),
        warn: (message) => logger.warn(`AutoUpdater: ${message}`),
        error: (message) => logger.error(`AutoUpdater: ${message}`),
        debug: (message) => logger.debug(`AutoUpdater: ${message}`)
    };

    autoUpdater.on('checking-for-update', () => {
        logger.info('AutoUpdater: checking for updates');
    });

    autoUpdater.on('update-available', async (info) => {
        const version = info?.version || null;
        logger.info(`AutoUpdater: update available (${version || 'unknown'})`);
        pendingUpdateInfo = info;

        if (!manualCheckPending) {
            logger.info('AutoUpdater: update detected but not prompting (use Help → Check for Updates)');
            return;
        }

        const win = getMainWindow();
        const declinedVersion = await loadDeclinedVersion();

        if (declinedVersion && version && declinedVersion === version) {
            const retry = await dialog.showMessageBox(win, {
                type: 'info',
                title: 'Update Previously Skipped',
                message: `Version ${version} is still available.`,
                detail: 'You chose to skip this release earlier. Download it now, or keep waiting for a newer release.',
                buttons: ['Download Update', 'Keep Skipping'],
                defaultId: 1,
                cancelId: 1,
                noLink: true
            });
            if (retry.response !== 0) {
                manualCheckPending = false;
                return;
            }
        } else if (declinedVersion && version && compareVersions(version, declinedVersion) <= 0) {
            manualCheckPending = false;
            return;
        }

        const result = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${version || 'new'} is available.`,
            detail: `You are on ${app.getVersion()}. Download the update now? You will be asked again before installing.`,
            buttons: ['Download Update', 'Not Now'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
        });

        if (result.response === 0) {
            try {
                await autoUpdater.downloadUpdate();
            } catch (error) {
                logger.error('AutoUpdater: download failed:', error);
                await dialog.showMessageBox(win, {
                    type: 'warning',
                    title: 'Update Download Failed',
                    message: 'Could not download the update.',
                    detail: error.message || String(error),
                    buttons: ['OK']
                });
            }
        } else if (version) {
            await setDeclinedVersion(version);
        }

        manualCheckPending = false;
    });

    autoUpdater.on('update-not-available', async (info) => {
        logger.info(`AutoUpdater: no update (current ${info?.version || app.getVersion()})`);
        pendingUpdateInfo = null;
        if (!manualCheckPending) return;
        const win = getMainWindow();
        await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Up to Date',
            message: 'You are running the latest release.',
            detail: `Version: ${app.getVersion()}`,
            buttons: ['OK']
        });
        manualCheckPending = false;
    });

    autoUpdater.on('download-progress', (progress) => {
        const percent = progress?.percent != null ? Math.round(progress.percent) : 0;
        logger.info(`AutoUpdater: download ${percent}%`);
    });

    autoUpdater.on('update-downloaded', async (info) => {
        const version = info?.version || pendingUpdateInfo?.version || null;
        logger.info(`AutoUpdater: update downloaded (${version || 'unknown'})`);
        const win = getMainWindow();

        const result = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Ready',
            message: 'The update has been downloaded.',
            detail: 'Restart acCompaniment to install it now? Nothing will be installed unless you confirm.',
            buttons: ['Restart and Install', 'Not Now'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
        });

        if (result.response === 0) {
            setImmediate(() => autoUpdater.quitAndInstall(false, true));
        }
    });

    autoUpdater.on('error', async (error) => {
        logger.error('AutoUpdater: error:', error);
        if (!manualCheckPending) return;
        const win = getMainWindow();
        await dialog.showMessageBox(win, {
            type: 'warning',
            title: 'Update Check Failed',
            message: 'Could not check for updates automatically.',
            detail: error?.message || String(error),
            buttons: ['OK']
        });
        manualCheckPending = false;
    });

    logger.info('AutoUpdater: initialized for Windows packaged builds (manual download/install only)');
}

async function checkForUpdates({ manual = false } = {}) {
    if (!isWindowsAutoUpdateEnabled()) {
        if (manual) {
            await showUpdateCheckDialog(getMainWindow());
        }
        return;
    }

    if (!initialized || !autoUpdater) {
        initialize(mainWindowRef);
    }
    if (!autoUpdater) {
        if (manual) {
            await showUpdateCheckDialog(getMainWindow());
        }
        return;
    }

    if (!manual) {
        return;
    }

    if (checkInProgress) {
        logger.info('AutoUpdater: check already in progress');
        return;
    }

    manualCheckPending = true;
    checkInProgress = true;
    try {
        await autoUpdater.checkForUpdates();
    } catch (error) {
        logger.error('AutoUpdater: checkForUpdates failed:', error);
        await showUpdateCheckDialog(getMainWindow());
        manualCheckPending = false;
    } finally {
        checkInProgress = false;
    }
}

module.exports = {
    initialize,
    checkForUpdates,
    isWindowsAutoUpdateEnabled
};
