const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron');
const path = require('path');
//const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const fs = require('fs').promises;

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
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(__dirname, 'token.json'); // 로그인 정보 저장할 파일
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json'); // 아까 다운받은 키 파일

/**
 * 저장된 토큰이 있으면 불러오고, 없으면 새로 로그인창을 띄우는 함수
 */
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
    // 3-1. 키 파일 읽기
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    
    // 리다이렉트 주소는 키 파일에 있는 첫 번째 주소(보통 http://localhost) 사용
    const redirectUri = key.redirect_uris[0]; 

    // OAuth2 클라이언트 생성
    const oauth2Client = new google.auth.OAuth2(
      key.client_id,
      key.client_secret,
      redirectUri
    );

    // 구글 로그인 화면 URL 생성
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    // 3-2. 일렉트론 미니 창(BrowserWindow) 생성
    const authWindow = new BrowserWindow({
      width: 500,
      height: 600,
      show: false,
      alwaysOnTop: true, // 항상 앱 위에 뜨게
      title: 'Google 계정으로 로그인',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    authWindow.loadURL(authUrl);
    authWindow.show();

    // 3-3. URL 변경 감시 (성공해서 넘어가는 순간 낚아채기)
    const handleNavigation = async (url) => {
      if (url.startsWith(redirectUri)) {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        if (code) {
          try {
            // 코드를 토큰으로 교환
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            await saveCredentials(oauth2Client); // 토큰 저장
            resolve(oauth2Client);
          } catch (err) {
            reject(err);
          }
        } else if (error) {
          reject(new Error(error));
        }

        // 🔥 로그인 처리가 끝났으니 창을 닫아버립니다!
        authWindow.close(); 
      }
    };

    // 리다이렉트나 페이지 이동이 일어날 때마다 검사
    authWindow.webContents.on('will-redirect', (event, url) => {
      handleNavigation(url);
    });
    authWindow.webContents.on('will-navigate', (event, url) => {
      handleNavigation(url);
    });

    // 사용자가 'X' 버튼을 눌러 강제로 닫은 경우
    authWindow.on('closed', () => {
      reject(new Error('로그인 창이 닫혔습니다.'));
    });
  });
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  // 저장된 토큰이 없으면 미니 창을 띄워서 로그인!
  return await signInWithPopup();
}

// 📌 [IPC 핸들러 추가] 렌더러에서 "구글 일정 가져워!" 하면 실행됨
ipcMain.on('get-google-events', async (event) => {
  try {
    const auth = await authorize(); // 로그인 시도
    const calendar = google.calendar({ version: 'v3', auth });
    
    // 캘린더에서 '오늘부터 10개' 일정 가져오기
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = res.data.items;
    if (!events || events.length === 0) {
      console.log('No upcoming events found.');
      event.reply('google-events-reply', []);
    } else {
      console.log('Upcoming 10 events:');
      // 필요한 데이터만 추려서 보냄
      const simpleEvents = events.map((event, i) => {
        const start = event.start.dateTime || event.start.date;
        return {
            title: event.summary,
            start: start, // "2026-02-12T10:00:00+09:00" 형태
            color: '#4285F4' // 구글 색상
        };
      });
      // 렌더러로 결과 전송
      event.reply('google-events-reply', simpleEvents);
    }
  } catch (err) {
    console.error('Error loading Google Calendar:', err);
  }
});

// [main.js] 파일 하단 (기존 get-google-events 코드 아래에 추가)

// [main.js] 일정 추가 통신 부분 수정

ipcMain.on('add-google-event', async (event, eventData) => {
  try {
    const auth = await authorize(); 
    const calendar = google.calendar({ version: 'v3', auth });

    // 🔥 알림(Reminder) 세팅을 먼저 조건문으로 만듭니다.
    const reminderSettings = { useDefault: false, overrides: [] };

    // 'none'이 아닐 때만 팝업 알림 시간을 배열에 추가합니다.
    if (eventData.alarmMinutes !== 'none') {
      reminderSettings.overrides.push({ method: 'popup', minutes: parseInt(eventData.alarmMinutes, 10) });
    }

    let startSettings, endSettings;
    if (eventData.isAllDay) {
      // 종일 일정 (시간 생략)
      // 구글에 보낼 때는 다시 규칙에 맞게 종료일에 +1일을 해줍니다.
      const endObj = new Date(eventData.endDate);
      endObj.setDate(endObj.getDate() + 1);
      const googleEndDate = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;

      startSettings = { date: eventData.startDate };
      endSettings = { date: googleEndDate };
    } else {
      // 시간 포함 일정
      startSettings = { dateTime: `${eventData.startDate}T${eventData.startTime}:00`, timeZone: 'Asia/Seoul' };
      endSettings = { dateTime: `${eventData.endDate}T${eventData.endTime}:00`, timeZone: 'Asia/Seoul' };
    }

    // 2. 일정 세팅
    const newEvent = {
      summary: eventData.title,
      location: eventData.location,       
      description: eventData.memo,        
      start: startSettings, // 위에서 세팅한 값을 넣음
      end: endSettings,     // 위에서 세팅한 값을 넣음
      reminders: reminderSettings,
    };

    // 🔄 반복 설정 추가 (구글 캘린더의 반복 규칙 RFC5545 포맷)
    if (eventData.repeat !== 'none') {
      // 예: 'RRULE:FREQ=DAILY' (매일 반복)
      newEvent.recurrence = [`RRULE:FREQ=${eventData.repeat}`]; 
    }

    // 3. 구글에 전송
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