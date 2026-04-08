const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    // 화면 -> 메인 프로세스로 신호 보내기
    ipcRenderer.send(channel, data);
  },
  on: (channel, func) => {
    // 메인 프로세스 -> 화면으로 오는 신호 받기
    ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
  }
});