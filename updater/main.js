const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
const GITHUB_REPO = 'zigby33/inkflow';

async function fetchLatestRelease() {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Inkflow-Updater'
      }
    });

    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const data = JSON.parse(await response.text());
    const asset = data.assets?.find(a => a.name.endsWith('.exe'));

    if (!asset) throw new Error('No Windows executable (.exe) found in the latest release.');

    return {
      url: asset.browser_download_url,
      assetName: asset.name
    };
  } catch (err) {
    throw err;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 300,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0d0202',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', async () => {
    // Search the full argv array for our flags
    const args = process.argv;
    let url = args.find(a => a.startsWith('--url='))?.split('=')[1];
    let assetName = args.find(a => a.startsWith('--asset='))?.split('=')[1];

    // If not provided by the main app, fetch from GitHub directly
    if (!url) {
      try {
        mainWindow.webContents.send('status', 'Checking GitHub for latest release...');
        const release = await fetchLatestRelease();
        url = release.url;
        assetName = release.assetName;
      } catch (err) {
        return mainWindow.webContents.send('error', 'Update Failed: ' + err.message);
      }
    }

    startDownload(url, assetName);
  });
}

app.whenReady().then(createWindow);

async function startDownload(url, assetName) {
  try {
    if (!url || !assetName) return;

    const downloadPath = path.join(app.getPath('temp'), assetName);
    const response = await net.fetch(url);
    
    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const totalBytes = parseInt(response.headers.get('content-length'), 10);
    let receivedBytes = 0;

    const fileStream = fs.createWriteStream(downloadPath);
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      receivedBytes += value.length;
      fileStream.write(Buffer.from(value));
      
      if (totalBytes) {
        const progress = Math.round((receivedBytes / totalBytes) * 100);
        mainWindow.webContents.send('update-progress', progress);
      }
    }

    fileStream.end();
    mainWindow.webContents.send('status', 'Download complete. Preparing installation...');

    // Automatically launch the installer and quit
    if (assetName.endsWith('.exe')) {
      setTimeout(() => {
        spawn(downloadPath, ['/SILENT'], { 
          detached: true, 
          stdio: 'ignore' 
        }).unref();
        app.quit();
      }, 1500);
    } else {
      mainWindow.webContents.send('status', 'Update downloaded. Run it manually from the temp folder.');
      shell.showItemInFolder(downloadPath);
    }

  } catch (err) {
    console.error('Update Error:', err);
    mainWindow.webContents.send('error', err.message);
  }
}

ipcMain.on('download-update', (event, data) => startDownload(data.url, data.assetName));

ipcMain.on('close-updater', () => app.quit());