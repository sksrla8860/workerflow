const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs').promises;

app.setAppUserModelId('com.shinetic.workerflow');

// ============================================================
// 1. 전역 변수
// ============================================================
let dayBarWin = null;
let calendarWin = null;
let tray = null;
let isQuitting = false;
let lastBounds = { position: 'bottom', size: 120 };

// 마지막으로 로드한 Google 이벤트 캐시 (날짜 클릭 시 재사용)
let cachedGoogleEvents = [];

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');


// ============================================================
// 2. 윈도우 생성
// ============================================================
function createDayBarWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  dayBarWin = new BrowserWindow({
    width,
    height: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    //backgroundMaterial: 'mica',
    show: false,
    alwaysOnTop: true,
    //skipTaskbar: true,
    hasShadow: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: { 
      nodeIntegration: false,       // 🔥 보안: 직접 접근 차단
      contextIsolation: true,       // 🔥 보안: 격리 모드 켜기
      preload: path.join(__dirname, 'preload.js') // 🔥 검문소 연결
    }
    //webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  dayBarWin.loadFile('index.html');
  updateBounds(false);
  applyMaterialFix(dayBarWin);

  dayBarWin.once('ready-to-show', () => dayBarWin.show());

  dayBarWin.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      dayBarWin.hide();
    }
  });

  dayBarWin.on('closed', () => { dayBarWin = null; });
}

function createCalendarWindow() {
  if (calendarWin) {
    if (calendarWin.isMinimized()) calendarWin.restore();
    calendarWin.focus();
    return;
  }

  calendarWin = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    //backgroundMaterial: 'acrylic',
    show: false,
    hasShadow: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: { 
      nodeIntegration: false,       // 🔥 보안: 직접 접근 차단
      contextIsolation: true,       // 🔥 보안: 격리 모드 켜기
      preload: path.join(__dirname, 'preload.js') // 🔥 검문소 연결
    }
  });


  calendarWin.loadFile('calendar.html');
  // 창이 닫힐 때 메모리 정리
  calendarWin.on('closed', () => {
    calendarWin = null;
  });
  applyMaterialFix(calendarWin);

  calendarWin.once('ready-to-show', () => calendarWin.show());
  calendarWin.on('closed', () => { calendarWin = null; });
}

// Mica/Acrylic 렌더링 버그 픽스 (창 크기 미세 조절)
function applyMaterialFix(win) {
  if (!win) return;
  win.once('show', () => {
    setTimeout(() => {
      const [w, h] = win.getSize();
      win.setSize(w, h + 1);
      win.setSize(w, h);
    }, 100);
  });
}

// 데이바 위치/크기 계산 및 적용
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
      w = isExpanded ? expandSize : widgetSize; h = scrH;
      x = offX + scrW - w; y = offY; break;
    case 'bottom':
    default:
      w = scrW; h = isExpanded ? expandSize : widgetSize;
      x = offX; y = offY + scrH - h; break;
  }

  dayBarWin.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}


// ============================================================
// 3. 시스템 트레이
// ============================================================
function createSystemTray(lang = 'en') {
  if (tray) tray.destroy();

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'icon.ico');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    console.error('Tray icon error:', e);
    return;
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('WorkerFlow');

  const labels = {
    en: { open: 'Open', calendar: 'Calendar', quit: 'Quit' },
    ko: { open: '열기', calendar: '달력', quit: '종료' },
    ja: { open: '開く', calendar: 'カレンダー', quit: '終了' },
    zh: { open: '打开', calendar: '日历', quit: '退出' },
    es: { open: 'Abrir', calendar: 'Calendario', quit: 'Salir' }
  };
  const t = labels[lang] || labels.en;

  const contextMenu = Menu.buildFromTemplate([
    { label: t.open,     click: () => dayBarWin  && dayBarWin.show()  },
    { label: t.calendar, click: () => { if (calendarWin) calendarWin.show(); else createCalendarWindow(); } },
    { type: 'separator' },
    { label: t.quit,     click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (dayBarWin) {
      if (dayBarWin.isVisible()) dayBarWin.hide();
      else dayBarWin.show();
    }
  });
}


// ============================================================
// 4. Google OAuth 인증
// ============================================================
async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    const client = google.auth.fromJSON(credentials);
    // 토큰 자동 갱신 연결
    client.on('tokens', (tokens) => {
      if (tokens.refresh_token) saveCredentials(client);
    });
    return client;
  } catch {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  await fs.writeFile(TOKEN_PATH, JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  }));
}

// [main.js] Google OAuth 인증 영역의 signInWithPopup 함수 교체

function signInWithPopup() {
  return new Promise(async (resolve, reject) => {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const redirectUri = key.redirect_uris[0];

    const oauth2Client = new google.auth.OAuth2(key.client_id, key.client_secret, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

    const authWindow = new BrowserWindow({
      width: 500, height: 600,
      show: false, alwaysOnTop: true,
      title: 'Google 로그인',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    authWindow.loadURL(authUrl);
    authWindow.show();

    let isAuthSuccess = false; // 🔥 타이밍 버그를 막기 위한 성공 깃발

    const handleNav = async (url) => {
      if (!url.startsWith(redirectUri)) return;
      const params = new URL(url).searchParams;
      const code = params.get('code');
      const error = params.get('error');
      
      if (code) {
        try {
          // 🔥 1. 토큰을 먼저 완벽하게 받아오고 저장합니다.
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          await saveCredentials(oauth2Client);
          
          // 🔥 2. 성공 깃발을 꽂고 달력 쪽에 성공 신호를 보냅니다.
          isAuthSuccess = true; 
          resolve(oauth2Client);
          
          // 🔥 3. 모든 작업이 끝난 후에 가장 마지막으로 창을 닫습니다.
          authWindow.close(); 
        } catch (err) { 
          reject(err); 
          authWindow.close();
        }
      } else {
        reject(new Error(error || '인증 실패'));
        authWindow.close();
      }
    };

    authWindow.webContents.on('will-redirect', (_, url) => handleNav(url));
    authWindow.webContents.on('will-navigate',  (_, url) => handleNav(url));
    
    authWindow.on('closed', () => {
      // 🔥 유저가 X 버튼을 눌러 강제로 닫았을 때만 에러로 처리합니다.
      if (!isAuthSuccess) reject(new Error('로그인 창이 닫혔습니다.'));
    });
  });
}

async function authorize() {
  const client = await loadSavedCredentials();
  if (client) return client;
  return signInWithPopup();
}


// ============================================================
// 5. IPC 핸들러 — UI 제어
// ============================================================
ipcMain.on('toggle-pin', (event, isPinned) => {
  BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(isPinned);
});

ipcMain.on('minimize-window', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('close-window', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on('open-calendar', () => {
  if (calendarWin) calendarWin.show();
  else createCalendarWindow();
});

// 구글 연동 버튼을 눌렀을 때 로그인 진행하기
ipcMain.on('start-google-login', async (event) => {
  try {
    // 💡 여기에 기존에 앱 시작 시 실행하던 구글 인증 코드를 넣습니다.
    const auth = await authorize();
    
    // 로그인 및 데이터 가져오기가 성공하면 화면(Renderer)으로 알림
    event.sender.send('google-login-success', '연동 완료!');
    
  } catch (error) {
    console.error('구글 연동 에러:', error);
    event.sender.send('google-login-error', error.message);
  }
});

ipcMain.on('update-widget-bounds', (_, b) => { lastBounds = b; updateBounds(false); });
ipcMain.on('set-expand-mode',      (_, ex) => { updateBounds(ex); });
ipcMain.on('change-language',      (_, lang) => { createSystemTray(lang); });
ipcMain.on('force-quit',           () => { isQuitting = true; app.quit(); });

ipcMain.on('set-auto-start', (_, isEnabled) => {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: isEnabled, path: app.getPath('exe') });
});

// 달력에서 날짜 클릭 → 해당 날짜의 Google 일정만 필터해서 데이바로 전달
ipcMain.on('date-clicked', (_, dateStr) => {
  if (!dayBarWin) return;

  // 캐시에서 해당 날짜 일정 필터
  const dayEvents = cachedGoogleEvents.filter(item => {
    if (item.status === 'cancelled') return false;
    
    const startStr = item.start.date || item.start.dateTime?.slice(0, 10);
    const endStr   = item.end.date   || item.end.dateTime?.slice(0, 10);
    
    if (!startStr) return false;

    // 🔥 종일 일정은 종료일이 다음 날 0시로 잡히므로 '<' 기호로 비교
    if (item.start.date) {
      return startStr <= dateStr && dateStr < endStr;
    } 
    // 🔥 시간 지정 일정은 시작/종료일이 같은 날이므로 '<=' 기호로 비교
    else {
      return startStr <= dateStr && dateStr <= endStr;
    }
  });

  dayBarWin.webContents.send('change-date', { dateStr, googleEvents: dayEvents });
});


// ============================================================
// 6. IPC 핸들러 — Google Calendar CRUD
// ============================================================

// 공통: 이벤트 리소스 조립
function buildEventResource(eventData) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reminderSettings = { useDefault: false, overrides: [] };
  if (eventData.alarmMinutes !== 'none') {
    reminderSettings.overrides.push({ method: 'popup', minutes: parseInt(eventData.alarmMinutes, 10) });
  }

  let start, end;
  if (eventData.isAllDay) {
    const endObj = new Date(eventData.endDate);
    endObj.setDate(endObj.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const googleEnd = `${endObj.getFullYear()}-${pad(endObj.getMonth() + 1)}-${pad(endObj.getDate())}`;
    start = { date: eventData.startDate };
    end   = { date: googleEnd };
  } else {
    start = { dateTime: `${eventData.startDate}T${eventData.startTime}:00`, timeZone };
    end   = { dateTime: `${eventData.endDate}T${eventData.endTime}:00`, timeZone };
  }

  const resource = {
    summary:     eventData.title,
    location:    eventData.location,
    description: eventData.memo,
    start,
    end,
    reminders: reminderSettings,
  };

  if (eventData.colorId) resource.colorId = eventData.colorId;
  if (eventData.repeat !== 'none') {
    resource.recurrence = [`RRULE:FREQ=${eventData.repeat}`];
  }

  return resource;
}

// 일정 목록 불러오기 (최근 1개월 ~ 6개월)
ipcMain.on('load-initial-events', async (event) => {
  try {
    const auth = await authorize();
    const cal = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const pastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString();
    const nextYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();

    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: pastYear,
      timeMax: nextYear,
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
    });

    cachedGoogleEvents = res.data.items || [];
    event.reply('load-initial-events-reply', { success: true, events: cachedGoogleEvents });
  } catch (err) {
    console.error('일정 불러오기 실패:', err);
    event.reply('load-initial-events-reply', { success: false, error: err.message });
  }
});

// 일정 등록
ipcMain.on('add-google-event', async (event, eventData) => {
  try {
    const auth = await authorize();
    const cal = google.calendar({ version: 'v3', auth });
    const response = await cal.events.insert({
      calendarId: 'primary',
      resource: buildEventResource(eventData),
    });
    event.reply('add-google-event-reply', { success: true, link: response.data.htmlLink });
  } catch (err) {
    console.error('일정 등록 실패:', err);
    event.reply('add-google-event-reply', { success: false, error: err.message });
  }
});

// 일정 수정
ipcMain.on('update-google-event', async (event, { eventId, eventData }) => {
  try {
    const auth = await authorize();
    const cal = google.calendar({ version: 'v3', auth });
    const resource = buildEventResource(eventData);
    // 반복 없음으로 변경 시 명시적 제거
    if (eventData.repeat === 'none') resource.recurrence = null;
    await cal.events.update({ calendarId: 'primary', eventId, resource });
    event.reply('update-google-event-reply', { success: true });
  } catch (err) {
    console.error('일정 수정 실패:', err);
    event.reply('update-google-event-reply', { success: false, error: err.message });
  }
});

// 일정 삭제
ipcMain.on('delete-google-event', async (event, eventId) => {
  try {
    const auth = await authorize();
    const cal = google.calendar({ version: 'v3', auth });
    await cal.events.delete({ calendarId: 'primary', eventId });
    event.reply('delete-google-event-reply', { success: true });
  } catch (err) {
    console.error('일정 삭제 실패:', err);
    event.reply('delete-google-event-reply', { success: false, error: err.message });
  }
});

// 🔥 일정 연동 해제 (로그아웃)
ipcMain.on('disconnect-google', async (event) => {
  try {
    // token.json 파일을 삭제하여 인증 권한을 초기화합니다.
    await fs.unlink(TOKEN_PATH);
    cachedGoogleEvents = []; // 메모리에 남은 캐시도 싹 비움
    event.reply('disconnect-google-reply', { success: true });
  } catch (err) {
    // 파일이 이미 없거나 에러가 나도, 일단 해제된 것으로 취급하고 프론트에 성공 신호를 보냄
    cachedGoogleEvents = [];
    event.reply('disconnect-google-reply', { success: true });
  }
});

// ============================================================
// 7. 앱 생명주기
// ============================================================
app.whenReady().then(() => {
  createDayBarWindow(); 
});

app.on('window-all-closed', () => { 
  // 트레이 앱이므로 창을 모두 닫아도 프로세스를 완전히 종료하지 않음
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createDayBarWindow();
});