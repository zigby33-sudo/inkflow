const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 300,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

ipcMain.on('download-update', async (event, { url, assetName }) => {
  try {
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

    // Automatically launch the installer and cleanup
    if (assetName.endsWith('.exe')) {
      mainWindow.webContents.send('status', 'Installing... The setup file will be deleted automatically.');

      // Chain the installer and the deletion using a shell command
      const cmd = `start /wait "" "${downloadPath}" /SILENT && del /f /q "${downloadPath}"`;

      spawn('cmd.exe', ['/c', cmd], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true
      }).unref();

      // Close the updater window after launching the chained command
      setTimeout(() => app.quit(), 2000);
    } else {
      mainWindow.webContents.send('status', 'Update downloaded to Downloads folder.');
      shell.showItemInFolder(downloadPath);
    }

  } catch (err) {
    console.error('Update Error:', err);
    mainWindow.webContents.send('error', err.message);
  }
});

ipcMain.on('close-updater', () => app.quit());