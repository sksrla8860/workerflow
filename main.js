const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron');
const path = require('path');

// 하드웨어 가속 끄기 (화면 깨짐 및 좌표 오류 방지)
//app.disableHardwareAcceleration();

// --- 전역 변수 관리 ---
let dayBarWin = null;   // 하루 바 (메인 위젯)
let calendarWin = null; // 달력 뷰 (팝업 창)
let tray = null;
let isQuitting = false; // 종료 플래그 (트레이 종료 시 true)

// 위젯 위치/크기 상태 저장 (기본값)
let lastBounds = { position: 'bottom', size: 120 };

// ========================================================
// 1. 하루 바 (Day Bar) 생성 함수 - (구 win 변수 대체)
// ========================================================
function createDayBarWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  dayBarWin = new BrowserWindow({
    width: width, 
    height: 120,
    frame: false, 
    transparent: true,
    backgroundMaterial: 'acrylic', 
    show: false,
    alwaysOnTop: false, // 설정값에 따라 추후 변경됨
    skipTaskbar: false,
    hasShadow: false,
    icon: path.join(__dirname, 'logo.png'), // 아이콘 설정
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });

  dayBarWin.loadFile('index.html');

  // 위치 초기화 (하단 배치)
  updateBounds(false);

  applyAcrylicFix(dayBarWin);
  
  dayBarWin.once('ready-to-show', () => {
    dayBarWin.show();
  });

  // 닫기 버튼(X)을 눌렀을 때 -> 앱 종료 대신 트레이로 숨기기
  dayBarWin.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      dayBarWin.hide();
      return false;
    }
  });

  dayBarWin.on('closed', () => dayBarWin = null);
}

// ========================================================
// 2. 달력 뷰 (Calendar View) 생성 함수
// ========================================================
function createCalendarWindow() {
  if (calendarWin) return;

  calendarWin = new BrowserWindow({
    width: 900, height: 700,
    frame: false,            // 프레임 없음 (커스텀 타이틀바)
    transparent: true,       // 🔥 핵심: 투명 배경 허용
    backgroundMaterial: 'acrylic',
    show: false,
    hasShadow: false,        // 윈도우 그림자 제거 (CSS로 제어)
    show: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  calendarWin.loadFile('calendar.html');

  applyAcrylicFix(calendarWin);

  calendarWin.once('ready-to-show', () => {
    calendarWin.show();
  });

  calendarWin.on('closed', () => calendarWin = null);
  
  calendarWin.once('ready-to-show', () => {
    calendarWin.show();
  });
}

function applyAcrylicFix(win) {
  if (!win) return;
  
  // 창이 보일 때까지 기다렸다가 '툭' 건드리기
  win.once('show', () => {
    setTimeout(() => {
      const [width, height] = win.getSize();
      // 1픽셀 늘렸다가
      win.setSize(width, height + 1);
      // 다시 원상복구 (사용자 눈에는 거의 안 보임)
      win.setSize(width, height);
    }, 100); // 0.1초 뒤 실행
  });
}
// ========================================================
// 3. 트레이 아이콘 생성 함수
// ========================================================
function createSystemTray(lang = 'en') {
  if (tray) tray.destroy();

  // 개발 모드 vs 배포 모드 아이콘 경로 분기
  let iconPath;
  if (app.isPackaged) {
    iconPath = path.join(process.resourcesPath, 'icon.ico');
  } else {
    iconPath = path.join(__dirname, 'icon.ico');
  }

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    console.error("Tray icon error:", e);
    return;
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('WorkerFlow');

  const labels = {
    en: { open: 'Open', quit: 'Quit' },
    ko: { open: '열기', quit: '종료' },
    ja: { open: '開く', quit: '終了' },
    zh: { open: '打开', quit: '退出' },
    es: { open: 'Abrir', quit: 'Salir' }
  };
  const t = labels[lang] || labels.en;

  const contextMenu = Menu.buildFromTemplate([
    { label: t.open, click: () => dayBarWin && dayBarWin.show() },
    { type: 'separator' },
    { label: t.quit, click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);

  // 트레이 클릭 시 토글
  tray.on('click', () => {
    if (dayBarWin) {
      if (dayBarWin.isVisible()) dayBarWin.hide();
      else dayBarWin.show();
    }
  });
}

// ========================================================
// 4. 앱 생명주기 (Lifecycle)
// ========================================================
app.whenReady().then(() => {
  createDayBarWindow();   // 하루 바 생성
  createCalendarWindow(); // 달력 생성
  createSystemTray('en'); // 트레이 생성
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') {} }); // 트레이 앱이라 종료 안 함
app.on('activate', () => { 
  if (BrowserWindow.getAllWindows().length === 0) createDayBarWindow(); 
});


// ========================================================
// 5. 위치/크기 계산 로직 (Day Bar 전용)
// ========================================================
function updateBounds(isExpanded) {
  if (!dayBarWin) return;

  const display = screen.getPrimaryDisplay();
  const { width: scrW, height: scrH } = display.workAreaSize;
  const { x: offX, y: offY } = display.workArea;

  const { position, size } = lastBounds;
  const widgetSize = Math.max(85, size || 120);
  const expandSize = 500; 

  let x, y, w, h;

  switch (position) {
    case 'top': 
      x = offX; y = offY; w = scrW; h = isExpanded ? expandSize : widgetSize; break;
    case 'bottom': 
      w = scrW; h = isExpanded ? expandSize : widgetSize; x = offX; y = isExpanded ? (offY + scrH - expandSize) : (offY + scrH - widgetSize); break;
    case 'left': 
      x = offX; y = offY; w = isExpanded ? expandSize : widgetSize; h = scrH; break;
    case 'right': 
      w = isExpanded ? expandSize : widgetSize; h = scrH; x = isExpanded ? (offX + scrW - expandSize) : (offX + scrW - widgetSize); y = offY; break;
    default: // bottom default
      w = scrW; h = isExpanded ? expandSize : widgetSize; x = offX; y = isExpanded ? (offY + scrH - expandSize) : (offY + scrH - widgetSize); break;
  }
  
  dayBarWin.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}


// ========================================================
// 6. IPC 통신 핸들러 (렌더러 <-> 메인)
// ========================================================

// (1) 핀 고정 (하루 바, 달력 뷰 각각 독립적으로 동작)
ipcMain.on('toggle-pin', (event, isPinned) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setAlwaysOnTop(isPinned);
});

// (2) 창 최소화 (공통)
ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

// (3) 창 닫기 (공통 - 하루 바는 숨기고, 달력은 닫음)
ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close(); // 각 윈도우의 'close' 이벤트 설정에 따라 동작함
});

// (4) 달력 날짜 클릭 -> 하루 바에게 전달
ipcMain.on('date-clicked', (event, dateStr) => {
  if (dayBarWin) {
    dayBarWin.webContents.send('change-date', dateStr);
  }
});

// (5) 하루 바 위치/크기 업데이트
ipcMain.on('update-widget-bounds', (e, b) => { 
  lastBounds = b; 
  updateBounds(false); 
});

ipcMain.on('set-expand-mode', (e, ex) => { 
  updateBounds(ex); 
});

// (6) 언어 변경
ipcMain.on('change-language', (event, lang) => { 
  createSystemTray(lang); 
});

// (7) 자동 실행 설정
ipcMain.on('set-auto-start', (event, isEnabled) => {
  if (!app.isPackaged) return; // 개발 모드 무시
  app.setLoginItemSettings({
    openAtLogin: isEnabled,
    path: app.getPath('exe')
  });
});

// (8) 앱 완전 종료
ipcMain.on('force-quit', () => {
  isQuitting = true;
  app.quit();
});