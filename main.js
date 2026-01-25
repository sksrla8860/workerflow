// main.js
const { app, BrowserWindow, screen, ipcMain } = require('electron'); // ipcMain 추가 확인!

let win; // 전역 변수로 변경

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({ // const 제거 (전역 변수 사용)
    width: width,
    height: 40, // 기본 높이
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false, // 사용자가 임의로 조절은 못하게
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

// 창 크기 조절 요청 (기존 코드)
ipcMain.on('resize-window', (event, newHeight) => {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const currentSize = win.getSize();
  if (currentSize[1] !== newHeight) {
    win.setSize(width, newHeight);
  }
});

// 🔥 [추가] 앱 종료 요청 처리
ipcMain.on('close-window', () => {
  if (win) win.close();
});

// 🔥 [추가] 핀 고정(항상 위) 토글 처리
ipcMain.on('toggle-pin', (event, isPinned) => {
  if (win) {
    win.setAlwaysOnTop(isPinned);
    // win.setAlwaysOnTop(isPinned, 'screen-saver'); // 더 강력한 고정이 필요하면 주석 해제
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});