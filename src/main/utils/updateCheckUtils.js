const https = require('https');
const { dialog, shell } = require('electron');
const logger = require('./logger');

function compareVersions(v1, v2) {
    const parts1 = String(v1).split('.').map(Number);
    const parts2 = String(v2).split('.').map(Number);
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;
        if (part1 > part2) return 1;
        if (part1 < part2) return -1;
    }
    return 0;
}

function getGitHubRepoSlug() {
    const packageJson = require('../../../package.json');
    const source = packageJson.repository?.url || packageJson.homepage || '';
    const match = String(source).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (match) {
        return `${match[1]}/${match[2]}`;
    }
    return 'alanimedia/acCompanimentAlt';
}

function pickReleaseDownloadAsset(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    if (assets.length === 0) return null;

    const platform = process.platform;
    const preferredPatterns = platform === 'win32'
        ? [/\.exe$/i, /\.msi$/i, /setup.*win/i]
        : platform === 'darwin'
            ? [/\.dmg$/i, /\.pkg$/i, /mac/i]
            : [/\.AppImage$/i, /\.deb$/i, /linux/i];

    for (const pattern of preferredPatterns) {
        const match = assets.find((asset) => pattern.test(asset.name || ''));
        if (match?.browser_download_url) return match;
    }

    return assets.find((asset) => asset.browser_download_url) || null;
}

function fetchLatestGitHubRelease(repoSlug) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${repoSlug}/releases/latest`,
            method: 'GET',
            headers: {
                'User-Agent': 'acCompaniment',
                Accept: 'application/vnd.github+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`GitHub API returned ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(8000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.end();
    });
}

async function checkForUpdates() {
    const packageJson = require('../../../package.json');
    const currentVersion = packageJson.version;
    const repoSlug = getGitHubRepoSlug();

    try {
        const release = await fetchLatestGitHubRelease(repoSlug);
        const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
        const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
        const downloadAsset = pickReleaseDownloadAsset(release);

        return {
            currentVersion,
            latestVersion,
            updateAvailable,
            releaseUrl: release.html_url || `https://github.com/${repoSlug}/releases/latest`,
            downloadUrl: downloadAsset?.browser_download_url || null,
            downloadName: downloadAsset?.name || null,
            repoSlug
        };
    } catch (error) {
        logger.error('updateCheckUtils: Error checking for updates:', error);
        return {
            currentVersion,
            latestVersion: null,
            updateAvailable: false,
            releaseUrl: `https://github.com/${repoSlug}/releases/latest`,
            downloadUrl: null,
            downloadName: null,
            repoSlug,
            error: error.message || 'Failed to check for updates'
        };
    }
}

async function showUpdateCheckDialog(mainWindow) {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const updateInfo = await checkForUpdates();

    if (updateInfo.updateAvailable) {
        const buttons = updateInfo.downloadUrl
            ? ['Download Update', 'View Release Page', 'Later']
            : ['View Release Page', 'Later'];
        const defaultId = 0;
        const cancelId = buttons.length - 1;

        const result = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${updateInfo.latestVersion} is available.`,
            detail: [
                `You are on ${updateInfo.currentVersion}.`,
                updateInfo.downloadName ? `Installer: ${updateInfo.downloadName}` : '',
                'Download the installer from GitHub Releases, then run it to update.'
            ].filter(Boolean).join('\n'),
            buttons,
            defaultId,
            cancelId,
            noLink: true
        });

        if (result.response === 0 && updateInfo.downloadUrl) {
            await shell.openExternal(updateInfo.downloadUrl);
        } else if (
            (result.response === 0 && !updateInfo.downloadUrl)
            || (result.response === 1 && updateInfo.downloadUrl)
        ) {
            await shell.openExternal(updateInfo.releaseUrl);
        }
        return updateInfo;
    }

    if (updateInfo.error) {
        await dialog.showMessageBox(win, {
            type: 'warning',
            title: 'Update Check Failed',
            message: `Could not check for updates: ${updateInfo.error}`,
            detail: `Current version: ${updateInfo.currentVersion}`,
            buttons: ['OK']
        });
        return updateInfo;
    }

    await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Up to Date',
        message: 'You are running the latest release.',
        detail: `Version: ${updateInfo.currentVersion}`,
        buttons: ['OK']
    });
    return updateInfo;
}

module.exports = {
    compareVersions,
    getGitHubRepoSlug,
    checkForUpdates,
    showUpdateCheckDialog
};
