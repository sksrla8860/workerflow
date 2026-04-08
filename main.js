const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs').promises;

app.setAppUserModelId('com.shinetic.workerflow'); 

// 하드웨어 가속 끄기 (화면 깨짐 및 좌표 오류 방지 - 필요 시 주석 해제)
//app.disableHardwareAcceleration();

// ========================================================
// 1. 전역 변수 및 상수 설정
// ========================================================

// 윈도우 및 시스템 트레이 변수
let dayBarWin = null;   // 하루 바 (메인 위젯)
let calendarWin = null; // 달력 뷰 (팝업 창)
let tray = null;
let isQuitting = false; // 트레이에서 완전 종료 시 true

// 위젯 위치/크기 상태 저장 (기본값)
let lastBounds = { position: 'bottom', size: 120 };

// 구글 캘린더 API 설정
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(__dirname, 'token.json');           // 발급된 토큰 저장 경로
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json'); // 구글 클라우드에서 받은 키 파일 경로


// ========================================================
// 2. 윈도우 및 트레이 생성 함수
// ========================================================

// (1) 하루 바 (Day Bar) 생성
function createDayBarWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  dayBarWin = new BrowserWindow({
    width: width, 
    height: 120,
    frame: false, 
    transparent: false,
    backgroundColor: '#00000000',
    //backgroundMaterial: 'acrylic', 
    backgroundMaterial: 'mica', 
    show: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });

  dayBarWin.loadFile('index.html');
  updateBounds(false); // 위치 초기화 (하단 배치)
  applyAcrylicFix(dayBarWin);
  
  dayBarWin.once('ready-to-show', () => {
    dayBarWin.show();
  });

  // 닫기 버튼(X)을 눌렀을 때 앱 종료 대신 숨기기
  dayBarWin.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      dayBarWin.hide();
      return false;
    }
  });

  dayBarWin.on('closed', () => dayBarWin = null);
}

// (2) 달력 뷰 (Calendar View) 생성
function createCalendarWindow() {
  if (calendarWin) return;

  calendarWin = new BrowserWindow({
    width: 900, height: 700,
    frame: false,            
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    show: false,
    hasShadow: false,        
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });

  calendarWin.loadFile('calendar.html');
  applyAcrylicFix(calendarWin);

  calendarWin.once('ready-to-show', () => {
    calendarWin.show();
  });

  calendarWin.on('closed', () => calendarWin = null);
}

// (3) 아크릴 효과 렌더링 버그 픽스 (창 크기를 미세하게 조절)
function applyAcrylicFix(win) {
  if (!win) return;
  win.once('show', () => {
    setTimeout(() => {
      const [width, height] = win.getSize();
      win.setSize(width, height + 1);
      win.setSize(width, height);
    }, 100);
  });
}

// (4) 하루 바 위치 및 크기 계산
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
    case 'left': 
      x = offX; y = offY; w = isExpanded ? expandSize : widgetSize; h = scrH; break;
    case 'right': 
      w = isExpanded ? expandSize : widgetSize; h = scrH; x = isExpanded ? (offX + scrW - expandSize) : (offX + scrW - widgetSize); y = offY; break;
    case 'bottom': 
    default: 
      w = scrW; h = isExpanded ? expandSize : widgetSize; x = offX; y = isExpanded ? (offY + scrH - expandSize) : (offY + scrH - widgetSize); break;
  }
  
  dayBarWin.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}

// (5) 시스템 트레이 (작업 표시줄 아이콘) 생성
function createSystemTray(lang = 'en') {
  if (tray) tray.destroy();

  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'icon.ico') 
    : path.join(__dirname, 'icon.ico');

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

  tray.on('click', () => {
    if (dayBarWin) {
      if (dayBarWin.isVisible()) dayBarWin.hide();
      else dayBarWin.show();
    }
  });
}


// ========================================================
// 3. 구글 캘린더 OAuth 2.0 인증 로직
// ========================================================

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

function signInWithPopup() {
  return new Promise(async (resolve, reject) => {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const redirectUri = key.redirect_uris[0]; 

    const oauth2Client = new google.auth.OAuth2(
      key.client_id, key.client_secret, redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    // 로그인용 미니 팝업창 띄우기
    const authWindow = new BrowserWindow({
      width: 500, height: 600,
      show: false, alwaysOnTop: true,
      title: 'Google 계정으로 로그인',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    authWindow.loadURL(authUrl);
    authWindow.show();

    const handleNavigation = async (url) => {
      if (url.startsWith(redirectUri)) {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        if (code) {
          try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            await saveCredentials(oauth2Client); 
            resolve(oauth2Client);
          } catch (err) {
            reject(err);
          }
        } else if (error) {
          reject(new Error(error));
        }
        authWindow.close(); 
      }
    };

    authWindow.webContents.on('will-redirect', (event, url) => handleNavigation(url));
    authWindow.webContents.on('will-navigate', (event, url) => handleNavigation(url));
    authWindow.on('closed', () => reject(new Error('로그인 창이 닫혔습니다.')));
  });
}

// 메인 인증 함수
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) return client;
  return await signInWithPopup();
}


// ========================================================
// 4. IPC 통신 핸들러 (렌더러 <-> 메인)
// ========================================================

// --- UI 및 상태 제어 ---
ipcMain.on('toggle-pin', (event, isPinned) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setAlwaysOnTop(isPinned);
});

ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close(); 
});

ipcMain.on('date-clicked', (event, dateStr) => {
  if (dayBarWin) dayBarWin.webContents.send('change-date', dateStr);
});

ipcMain.on('update-widget-bounds', (e, b) => { 
  lastBounds = b; updateBounds(false); 
});

ipcMain.on('set-expand-mode', (e, ex) => { updateBounds(ex); });
ipcMain.on('change-language', (event, lang) => { createSystemTray(lang); });
ipcMain.on('force-quit', () => { isQuitting = true; app.quit(); });

ipcMain.on('set-auto-start', (event, isEnabled) => {
  if (!app.isPackaged) return; 
  app.setLoginItemSettings({
    openAtLogin: isEnabled,
    path: app.getPath('exe')
  });
});


// --- 구글 캘린더 데이터 제어 ---

// 1. 초기 일정 불러오기 (최근 1개월 ~ 6개월)
ipcMain.on('load-initial-events', async (event) => {
  try {
    const auth = await authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    const timeMin = new Date(); timeMin.setMonth(timeMin.getMonth() - 1);
    const timeMax = new Date(); timeMax.setMonth(timeMax.getMonth() + 6);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 250, 
      singleEvents: true, 
      orderBy: 'startTime',
    });

    event.reply('load-initial-events-reply', { success: true, events: res.data.items });
  } catch (err) {
    console.error('구글 일정 불러오기 실패:', err);
    event.reply('load-initial-events-reply', { success: false, error: err.message });
  }
});

// 2. 새 일정 등록하기
ipcMain.on('add-google-event', async (event, eventData) => {
  try {
    const auth = await authorize(); 
    const calendar = google.calendar({ version: 'v3', auth });

    // 알림 설정
    const reminderSettings = { useDefault: false, overrides: [] };
    if (eventData.alarmMinutes !== 'none') {
      reminderSettings.overrides.push({ method: 'popup', minutes: parseInt(eventData.alarmMinutes, 10) });
    }

    // 시간 설정 (종일 vs 특정 시간)
    let startSettings, endSettings;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (eventData.isAllDay) {
      const endObj = new Date(eventData.endDate);
      endObj.setDate(endObj.getDate() + 1);
      const googleEndDate = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;

      startSettings = { date: eventData.startDate };
      endSettings = { date: googleEndDate };
    } else {
      startSettings = { dateTime: `${eventData.startDate}T${eventData.startTime}:00`, timeZone };
      endSettings = { dateTime: `${eventData.endDate}T${eventData.endTime}:00`, timeZone };
    }

    // 일정 조립
    const newEvent = {
      summary: eventData.title,
      location: eventData.location,       
      description: eventData.memo,        
      start: startSettings, 
      end: endSettings,     
      reminders: reminderSettings,
    };

    // 🔥 색상이 선택되었을 때만 colorId 추가
    if (eventData.colorId && eventData.colorId !== '') {
      newEvent.colorId = eventData.colorId;
    }

    // 반복 설정
    if (eventData.repeat !== 'none') {
      newEvent.recurrence = [`RRULE:FREQ=${eventData.repeat}`]; 
    }

    // 전송
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: newEvent,
    });

    event.reply('add-google-event-reply', { success: true, link: response.data.htmlLink });

  } catch (err) {
    console.error('구글 캘린더 일정 등록 실패:', err);
    event.reply('add-google-event-reply', { success: false, error: err.message });
  }
});

ipcMain.on('update-google-event', async (event, { eventId, eventData }) => {
  try {
    const auth = await authorize();
    const calendar = google.calendar({ version: 'v3', auth });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 1. 알림 설정 (구글 규격에 맞게 조립)
    const reminderSettings = { useDefault: false, overrides: [] };
    if (eventData.alarmMinutes !== 'none') {
      reminderSettings.overrides.push({ 
        method: 'popup', 
        minutes: parseInt(eventData.alarmMinutes, 10) 
      });
    }

    // 2. 시간 및 날짜 설정
    let startSettings, endSettings;
    if (eventData.isAllDay) {
      const endObj = new Date(eventData.endDate);
      endObj.setDate(endObj.getDate() + 1);
      const googleEndDate = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;
      startSettings = { date: eventData.startDate };
      endSettings = { date: googleEndDate };
    } else {
      startSettings = { dateTime: `${eventData.startDate}T${eventData.startTime}:00`, timeZone };
      endSettings = { dateTime: `${eventData.endDate}T${eventData.endTime}:00`, timeZone };
    }

    // 3. 리소스 조립
    const resource = {
      summary: eventData.title,
      location: eventData.location,
      description: eventData.memo,
      start: startSettings,
      end: endSettings,
      reminders: reminderSettings, // 🔥 알림 정보 추가
    };

    // 4. 반복 설정 (RRULE 형식)
    if (eventData.repeat !== 'none') {
      resource.recurrence = [`RRULE:FREQ=${eventData.repeat}`];
    } else {
      resource.recurrence = null; // 반복 안 함일 경우 명시적으로 제거
    }

    // 5. 색상 설정
    if (eventData.colorId && eventData.colorId !== '') {
      resource.colorId = eventData.colorId;
    } else {
      resource.colorId = null;
    }

    await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      resource: resource
    });

    event.reply('update-google-event-reply', { success: true });
  } catch (err) {
    console.error('수정 실패:', err);
    event.reply('update-google-event-reply', { success: false, error: err.message });
  }
});

// 일정 삭제
ipcMain.on('delete-google-event', async (event, eventId) => {
  try {
    const auth = await authorize();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    event.reply('delete-google-event-reply', { success: true });
  } catch (err) {
    event.reply('delete-google-event-reply', { success: false, error: err.message });
  }
});

ipcMain.on('open-calendar', () => {
  if (calendarWin) calendarWin.show();
  else createCalendarWindow();
});

// ========================================================
// 5. 앱 생명주기 (Lifecycle)
// ========================================================

app.whenReady().then(() => {
  createDayBarWindow();   
  createCalendarWindow(); 
  createSystemTray('en'); 
});

// 트레이 기반 앱이므로 창이 모두 닫혀도 종료하지 않음
app.on('window-all-closed', () => { 
  if (process.platform !== 'darwin') {} 
});

app.on('activate', () => { 
  if (BrowserWindow.getAllWindows().length === 0) createDayBarWindow(); 
});