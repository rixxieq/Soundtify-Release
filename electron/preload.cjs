const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  updateNativeSmtc: (payload) => ipcRenderer.send('native-smtc-update', payload),
  clearNativeSmtc: () => ipcRenderer.send('native-smtc-clear'),
  onNativeSmtcAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('native-smtc-action', listener);
    return () => ipcRenderer.removeListener('native-smtc-action', listener);
  },
  onNativeSmtcStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('native-smtc-status', listener);
    return () => ipcRenderer.removeListener('native-smtc-status', listener);
  }
});
