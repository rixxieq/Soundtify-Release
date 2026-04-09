const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const isDev = Boolean(process.env.ELECTRON_START_URL);
const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const appUserModelId = 'com.rixxieq.soundtify';
const appDisplayName = 'Soundtify';

if (portableExecutableDir) {
  app.setPath('userData', path.join(portableExecutableDir, 'sc-player-data'));
}

if (process.platform === 'win32') {
  // SMTC электрона отключает
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
}

app.setName(appDisplayName);
if (process.platform === 'win32') {
  app.setAppUserModelId(appUserModelId);
}

let smtcBridgeProcess = null;
let smtcBridgeStdoutBuffer = '';
let smtcLogFilePath = null;
let nativeSmtcStatus = { ready: false, failed: false };
let smtcLogInitialized = false;

const getSmtcLogPath = () => {
  if (smtcLogFilePath) return smtcLogFilePath;
  try {
    smtcLogFilePath = path.join(app.getPath('userData'), 'smtc.log');
  } catch {
    smtcLogFilePath = path.join(process.cwd(), 'smtc.log');
  }
  return smtcLogFilePath;
};

const logSmtc = (event, details = {}) => {
  const logPath = getSmtcLogPath();
  if (!smtcLogInitialized) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '', 'utf8');
    } catch {}
    smtcLogInitialized = true;
  }

  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details
  });
  const line = `${entry}\n`;
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {}
  if (isDev) {
    try {
      console.log(`[SMTC] ${event}`, details);
    } catch {}
  }
};

const sendToRenderer = (channel, payload) => {
  logSmtc('send_to_renderer', { channel, hasPayload: payload != null, windowCount: BrowserWindow.getAllWindows().length });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
};

const setNativeSmtcStatus = (status) => {
  nativeSmtcStatus = {
    ready: Boolean(status?.ready),
    failed: Boolean(status?.failed)
  };
  sendToRenderer('native-smtc-status', nativeSmtcStatus);
};

const getSmtcBridgeCandidates = () => {
  const executableNames = ['SmtcBridge.exe', 'Soundtify.SmtcBridge.exe'];
  const candidates = [];
  for (const executableName of executableNames) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'smtc-bridge', 'bin', executableName));
    candidates.push(path.join(process.resourcesPath, 'electron', 'smtc-bridge', 'bin', executableName));
    candidates.push(path.join(__dirname, 'smtc-bridge', 'bin', executableName));
  }
  return candidates;
};

const isSpawnableExecutablePath = (candidate) => {
  const normalized = candidate.replace(/\//g, '\\').toLowerCase();
  if (normalized.includes('\\app.asar\\') && !normalized.includes('\\app.asar.unpacked\\')) {
    return false;
  }
  return fs.existsSync(candidate);
};

const stopSmtcBridge = () => {
  if (!smtcBridgeProcess) return;
  logSmtc('bridge_stop_requested');
  try {
    smtcBridgeProcess.kill();
  } catch {}
  smtcBridgeProcess = null;
  smtcBridgeStdoutBuffer = '';
};

const handleSmtcBridgeLine = (line) => {
  if (!line) return;
  logSmtc('bridge_stdout_line', { line });
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    logSmtc('bridge_stdout_nonjson');
    return;
  }
  if (data?.type === 'action' && typeof data.action === 'string') {
    logSmtc('bridge_action', { action: data.action });
    sendToRenderer('native-smtc-action', data.action);
    return;
  }
  if (data?.type === 'ready') {
    logSmtc('bridge_ready');
    setNativeSmtcStatus({ ready: true, failed: false });
  }
};

const startSmtcBridge = () => {
  if (process.platform !== 'win32') return;
  if (smtcBridgeProcess) return;

  const candidates = getSmtcBridgeCandidates();
  logSmtc('bridge_start_attempt', { candidates });

  const executable = candidates.find((candidate) => isSpawnableExecutablePath(candidate)) || null;
  if (!executable) {
    console.warn('[SMTC] Native bridge executable not found. Falling back to Web Media Session.');
    logSmtc('bridge_missing_executable');
    setNativeSmtcStatus({ ready: false, failed: true });
    return;
  }
  logSmtc('bridge_executable_resolved', { executable });

  try {
    smtcBridgeProcess = spawn(executable, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    logSmtc('bridge_spawned', { pid: smtcBridgeProcess.pid });
  } catch (error) {
    console.warn('[SMTC] Failed to spawn native bridge:', error?.message || error);
    logSmtc('bridge_spawn_failed', { error: error?.message || String(error) });
    setNativeSmtcStatus({ ready: false, failed: true });
    smtcBridgeProcess = null;
    return;
  }

  smtcBridgeProcess.stdout.setEncoding('utf8');
  smtcBridgeProcess.stdout.on('data', (chunk) => {
    smtcBridgeStdoutBuffer += chunk;
    let newlineIndex = smtcBridgeStdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = smtcBridgeStdoutBuffer.slice(0, newlineIndex).trim();
      smtcBridgeStdoutBuffer = smtcBridgeStdoutBuffer.slice(newlineIndex + 1);
      handleSmtcBridgeLine(line);
      newlineIndex = smtcBridgeStdoutBuffer.indexOf('\n');
    }
  });

  if (smtcBridgeProcess.stderr) {
    smtcBridgeProcess.stderr.setEncoding('utf8');
    smtcBridgeProcess.stderr.on('data', (chunk) => {
      const lines = String(chunk)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        logSmtc('bridge_stderr_line', { line });
      }
    });
  }

  smtcBridgeProcess.on('exit', (code, signal) => {
    logSmtc('bridge_exit', { code, signal });
    setNativeSmtcStatus({ ready: false, failed: true });
    smtcBridgeProcess = null;
    smtcBridgeStdoutBuffer = '';
  });

  smtcBridgeProcess.on('error', (error) => {
    console.warn('[SMTC] Native bridge process error:', error?.message || error);
    logSmtc('bridge_error', { error: error?.message || String(error) });
    setNativeSmtcStatus({ ready: false, failed: true });
    smtcBridgeProcess = null;
    smtcBridgeStdoutBuffer = '';
  });
};

const sendSmtcBridgeMessage = (message) => {
  if (!smtcBridgeProcess?.stdin?.writable) {
    logSmtc('bridge_stdin_not_writable', { type: message?.type });
    return;
  }
  try {
    if (message?.type === 'update') {
      logSmtc('bridge_update_sent', {
        isPlaying: Boolean(message?.payload?.isPlaying),
        title: message?.payload?.title || '',
        positionSec: Number(message?.payload?.positionSec || 0),
        durationSec: Number(message?.payload?.durationSec || 0)
      });
    } else {
      logSmtc('bridge_message_sent', { type: message?.type });
    }
    smtcBridgeProcess.stdin.write(`${JSON.stringify(message)}\n`);
  } catch {
    logSmtc('bridge_message_write_failed', { type: message?.type });
  }
};

ipcMain.on('native-smtc-update', (_event, payload) => {
  sendSmtcBridgeMessage({ type: 'update', payload });
});

ipcMain.on('native-smtc-clear', () => {
  sendSmtcBridgeMessage({ type: 'clear' });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: appDisplayName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  win.removeMenu();

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Alt' && !input.control && !input.shift && !input.meta) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('/auth/callback') || url.includes('soundcloud.com') || url.includes('api.soundcloud.com')) {
      return { action: 'allow' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('native-smtc-status', nativeSmtcStatus);
    }
  });
}

app.whenReady().then(() => {
  logSmtc('app_ready', { userData: app.getPath('userData'), isDev });
  startSmtcBridge();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  logSmtc('app_will_quit');
  stopSmtcBridge();
});
