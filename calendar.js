// ============================================================
// 상태
// ============================================================
let calendar;
let isPinned = false;
let selectedColorId = '';
let clickTimer = null;
let isGoogleLinked = false; //  구글 연동 상태 추적

const defaultConf = { opacity: 0.1, color: '#03d8a7' };
let conf = JSON.parse(localStorage.getItem('calendarConfig')) || defaultConf;

// Google Calendar colorId → hex
const GOOGLE_COLORS = {
  '1':'#7986cb','2':'#33b679','3':'#8e24aa','4':'#e67c73',
  '5':'#f6c026','6':'#f5511d','7':'#039be5','8':'#616161',
  '9':'#3f51b5','10':'#0b8043','11':'#d50000'
};

// ============================================================
// 유틸
// ============================================================
function getLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function applyTheme() {
  const hex = conf.color;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  document.getElementById('app-container').style.background = `rgba(${r},${g},${b},${conf.opacity})`;
  document.getElementById('set-opacity').value = conf.opacity;
  document.getElementById('set-color').value   = conf.color;
}

function saveConf() { localStorage.setItem('calendarConfig', JSON.stringify(conf)); }

function toggleSettings() {
  const p = document.getElementById('cal-settings');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
}

function refreshCalendar() { window.electronAPI.send('load-initial-events'); }

// ============================================================
// 색상 팔레트
// ============================================================
function renderColorPicker() {
  const c = document.getElementById('color-picker');
  c.innerHTML = '';

  // 기본색 (회색)
  const def = document.createElement('div');
  def.style.cssText = `width:22px;height:22px;border-radius:50%;background:#555;cursor:pointer;border:2px solid ${selectedColorId===''?'white':'transparent'};box-sizing:border-box;`;
  def.title = '기본 색상';
  def.onclick = () => { selectedColorId = ''; renderColorPicker(); };
  c.appendChild(def);

  Object.entries(GOOGLE_COLORS).forEach(([id, hex]) => {
    const el = document.createElement('div');
    el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${hex};cursor:pointer;border:2px solid ${selectedColorId===id?'white':'transparent'};box-sizing:border-box;`;
    el.onclick = () => { selectedColorId = id; renderColorPicker(); };
    c.appendChild(el);
  });
}

// ============================================================
// 모달 열기/닫기
// ============================================================
function clearModal() {
  const modal = document.getElementById('event-modal');
  document.getElementById('modal-heading').innerText  = '새 일정 추가';
  document.getElementById('btn-save').innerText       = '저장';
  document.getElementById('btn-delete').style.display = 'none';
  delete modal.dataset.editId;

  ['m-title','m-location'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('m-memo').value      = '';
  document.getElementById('m-alarm').value     = '30';
  document.getElementById('m-repeat').value    = 'none';
  document.getElementById('m-allday').checked  = false;
  document.getElementById('m-start-time').style.display = 'inline-block';
  document.getElementById('m-end-time').style.display   = 'inline-block';

  selectedColorId = '';
  renderColorPicker();
}

function openAddModal(info) {
  clearModal();
  document.getElementById('m-start-date').value = getLocalDateStr(info.date);
  document.getElementById('m-end-date').value   = getLocalDateStr(info.date);
  document.getElementById('m-start-time').value = '09:00';
  document.getElementById('m-end-time').value   = '10:00';

  const allDayEl = document.getElementById('m-allday');
  allDayEl.checked = info.allDay || false;
  allDayEl.dispatchEvent(new Event('change'));

  document.getElementById('event-modal-bg').style.display = 'block';
  document.getElementById('event-modal').style.display    = 'block';
}

function closeModal() {
  document.getElementById('event-modal-bg').style.display = 'none';
  document.getElementById('event-modal').style.display    = 'none';
  calendar?.unselect();
  clearModal();
}

// ============================================================
// DOM 로드 후 초기화
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  renderColorPicker();
  applyTheme();

  // ── FullCalendar 초기화 ──
  const calEl = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(calEl, {
    initialView: 'dayGridMonth',
    locale: 'ko',
    height: '100%',
    headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
    selectable: true,
    selectMirror: true,

    // 날짜 클릭: 싱글=데이바 날짜 변경, 더블=새 일정 모달
    dateClick(info) {
      if (clickTimer === null) {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          // 싱글 클릭: 데이바 날짜 변경 (main.js가 캐시에서 Google 일정 필터해서 전송)
          window.electronAPI.send('date-clicked', info.dateStr);
        }, 250);
      } else {
        clearTimeout(clickTimer);
        clickTimer = null;
        // 더블 클릭: 새 일정 모달
        openAddModal(info);
      }
    },

    // 드래그 선택 (2일 이상)
    select(info) {
      const diff = new Date(info.end) - new Date(info.start);
      if (diff <= 86400000) return; // 단순 클릭은 무시

      clearModal();
      document.getElementById('m-start-date').value = getLocalDateStr(info.start);
      const endD = new Date(info.end);
      if (info.allDay) endD.setDate(endD.getDate() - 1);
      document.getElementById('m-end-date').value   = getLocalDateStr(endD);
      document.getElementById('m-start-time').value = '12:00';
      document.getElementById('m-end-time').value   = '13:00';

      const allDayEl = document.getElementById('m-allday');
      allDayEl.checked = info.allDay;
      allDayEl.dispatchEvent(new Event('change'));

      document.getElementById('event-modal-bg').style.display = 'block';
      document.getElementById('event-modal').style.display    = 'block';
    },

    // 일정 클릭: 수정 모달
    eventClick(info) {
      const ev = info.event;
      const modal = document.getElementById('event-modal');

      document.getElementById('modal-heading').innerText  = '일정 수정';
      document.getElementById('btn-save').innerText       = '수정';
      document.getElementById('btn-delete').style.display = 'block';
      modal.dataset.editId = ev.id;

      document.getElementById('m-title').value    = ev.title || '';
      document.getElementById('m-location').value = ev.extendedProps.location || '';
      document.getElementById('m-memo').value     = ev.extendedProps.memo || '';
      document.getElementById('m-alarm').value    = ev.extendedProps.alarm  || 'none';
      document.getElementById('m-repeat').value   = ev.extendedProps.repeat || 'none';

      selectedColorId = ev.extendedProps.colorId || '';
      renderColorPicker();

      const isAllDay = ev.allDay;
      document.getElementById('m-allday').checked = isAllDay;

      if (ev.start) {
        document.getElementById('m-start-date').value = getLocalDateStr(ev.start);
        if (!isAllDay) {
          document.getElementById('m-start-time').value = `${String(ev.start.getHours()).padStart(2,'0')}:${String(ev.start.getMinutes()).padStart(2,'0')}`;
          document.getElementById('m-start-time').style.display = 'inline-block';
        } else {
          document.getElementById('m-start-time').style.display = 'none';
        }
      }
      if (ev.end) {
        const endD = new Date(ev.end);
        if (isAllDay) endD.setDate(endD.getDate() - 1);
        document.getElementById('m-end-date').value = getLocalDateStr(endD);
        if (!isAllDay) {
          document.getElementById('m-end-time').value = `${String(endD.getHours()).padStart(2,'0')}:${String(endD.getMinutes()).padStart(2,'0')}`;
          document.getElementById('m-end-time').style.display = 'inline-block';
        } else {
          document.getElementById('m-end-time').style.display = 'none';
        }
      } else {
        document.getElementById('m-end-date').value = document.getElementById('m-start-date').value;
        document.getElementById('m-end-time').style.display = isAllDay ? 'none' : 'inline-block';
      }

      document.getElementById('event-modal-bg').style.display = 'block';
      modal.style.display = 'block';
    }
  });
  calendar.render();
  refreshCalendar();

  // ── 버튼 이벤트 ──
  document.getElementById('btn-sync').addEventListener('click', () => {
    if (isGoogleLinked) {
      // 이미 연동되어 있다면 해제할지 물어봄
      const msg = "구글 캘린더 연동을 해제하시겠습니까?\n\n(※ '취소'를 누르면 연동은 유지되고 최신 일정으로 새로고침 됩니다.)";
      if (confirm(msg)) {
        // 확인 -> 연동 해제 요청
        window.electronAPI.send('disconnect-google');
      } else {
        // 취소 -> 수동 동기화(새로고침) 진행
        refreshCalendar();
      }
    } else {
      // 연동되어 있지 않다면 로그인(동기화) 진행
      refreshCalendar();
    }
  });
  document.getElementById('btn-settings').addEventListener('click', toggleSettings);
  document.getElementById('btn-min').addEventListener('click',   () => window.electronAPI.send('minimize-window'));
  document.getElementById('btn-close').addEventListener('click', () => window.electronAPI.send('close-window'));

  document.getElementById('btn-pin').addEventListener('click', () => {
    isPinned = !isPinned;
    document.getElementById('btn-pin').classList.toggle('active', isPinned);
    window.electronAPI.send('toggle-pin', isPinned);
  });

  document.getElementById('set-opacity').addEventListener('input', (e) => {
    conf.opacity = parseFloat(e.target.value); saveConf(); applyTheme();
  });
  document.getElementById('set-color').addEventListener('input', (e) => {
    conf.color = e.target.value; saveConf(); applyTheme();
  });

  // 종일 체크박스
  document.getElementById('m-allday').addEventListener('change', (e) => {
    const show = e.target.checked ? 'none' : 'inline-block';
    document.getElementById('m-start-time').style.display = show;
    document.getElementById('m-end-time').style.display   = show;
  });

  // 날짜 검증
  document.getElementById('m-start-date').addEventListener('change', () => {
    if (document.getElementById('m-start-date').value > document.getElementById('m-end-date').value) {
      document.getElementById('m-end-date').value = document.getElementById('m-start-date').value;
    }
  });
  document.getElementById('m-end-date').addEventListener('change', () => {
    if (document.getElementById('m-end-date').value < document.getElementById('m-start-date').value) {
      document.getElementById('m-start-date').value = document.getElementById('m-end-date').value;
    }
  });

  // 취소
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('event-modal-bg').addEventListener('click', closeModal);

  // 저장
  document.getElementById('btn-save').addEventListener('click', () => {
    const modal   = document.getElementById('event-modal');
    const editId  = modal.dataset.editId;
    const isAllDay = document.getElementById('m-allday').checked;
    const startDate = document.getElementById('m-start-date').value;
    const endDate   = document.getElementById('m-end-date').value;
    const startTime = document.getElementById('m-start-time').value;
    const endTime   = document.getElementById('m-end-time').value;

    // 시간 유효성 검사
    if (isAllDay) {
      if (startDate > endDate) { alert('종료일은 시작일 이후여야 합니다.'); return; }
    } else {
      if (new Date(`${startDate}T${startTime}`) >= new Date(`${endDate}T${endTime}`)) {
        alert('종료 시간은 시작 시간 이후여야 합니다.'); return;
      }
    }

    const eventData = {
      title:        document.getElementById('m-title').value    || '(제목 없음)',
      isAllDay,
      startDate, startTime, endDate, endTime,
      location:     document.getElementById('m-location').value,
      memo:         document.getElementById('m-memo').value,
      alarmMinutes: document.getElementById('m-alarm').value,
      repeat:       document.getElementById('m-repeat').value,
      colorId:      selectedColorId
    };

    if (editId) {
      window.electronAPI.send('update-google-event', { eventId: editId, eventData });
    } else {
      window.electronAPI.send('add-google-event', eventData);
    }
    closeModal();
  });

  // 삭제
  document.getElementById('btn-delete').addEventListener('click', () => {
    const editId = document.getElementById('event-modal').dataset.editId;
    if (editId && confirm('정말 삭제하시겠습니까?')) {
      window.electronAPI.send('delete-google-event', editId);
      closeModal();
    }
  });
});

// ============================================================
// IPC 수신
// ============================================================
window.electronAPI.on('load-initial-events-reply', (_, result) => {
  const syncBtn = document.getElementById('btn-sync');

  if (!result.success || !calendar) { 
    isGoogleLinked = false; 
    syncBtn.style.opacity = '0.4'; // 미연동 시 버튼을 반투명하게 
    if (!result.success && result.error !== 'No token') console.error(result.error); 
    return; 
  }
  isGoogleLinked = true;
  if(syncBtn) syncBtn.style.opacity = '1'; 
  calendar.removeAllEvents();
  result.events.forEach(item => {
    if (item.status === 'cancelled') return;

    let alarm = 'none';
    if (item.reminders && item.reminders.overrides && item.reminders.overrides.length > 0) {
      alarm = String(item.reminders.overrides[0].minutes);
    }

    let repeat = 'none';
    if (item.recurrence && item.recurrence[0]) {
      const match = item.recurrence[0].match(/FREQ=([^;]+)/);
      if (match) repeat = match[1];
    }

    calendar.addEvent({
      id: item.id,
      title: item.summary || '',
      start: item.start.dateTime || item.start.date,
      end: item.end.dateTime || item.end.date,
      allDay: !!item.start.date,
      backgroundColor: item.colorId ? GOOGLE_COLORS[item.colorId] : '#56ccf2',
      extendedProps: {
        location: item.location || '',
        memo: item.description || '',
        colorId: item.colorId || '',
        alarm: alarm, 
        repeat: repeat
      }
    });
  });
});
window.electronAPI.on('disconnect-google-reply', (_, result) => {
  if (result.success) {
    isGoogleLinked = false;
    document.getElementById('btn-sync').style.opacity = '0.4';
    calendar.removeAllEvents(); // 달력에서 구글 일정 싹 지우기
    window.electronAPI.send('date-clicked', getLocalDateStr(new Date())); // 데이바에도 빈 일정 쏴주기
    alert('구글 캘린더 연동이 해제되었습니다.');
  }
});

window.electronAPI.on('add-google-event-reply',    (_, r) => r.success ? refreshCalendar() : alert('등록 실패: ' + r.error));
window.electronAPI.on('update-google-event-reply', (_, r) => r.success ? refreshCalendar() : alert('수정 실패: ' + r.error));
window.electronAPI.on('delete-google-event-reply', (_, r) => r.success ? refreshCalendar() : alert('삭제 실패: ' + r.error));