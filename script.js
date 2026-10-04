// 只在目前瀏覽器保存資料，不需要帳號或資料庫。
const storageKey = 'voice-task-reminder-tasks';
const input = document.querySelector('#task-input');
const statusText = document.querySelector('#status');
let tasks = [];
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) tasks = saved.filter(task => task && typeof task.name === 'string' && typeof task.original === 'string').map(task => ({...task, time: Number.isFinite(task.time) ? task.time : null}));
} catch { statusText.textContent = '無法讀取保存資料，請確認瀏覽器允許本機儲存。'; }

function chineseNumber(text) {
  const digits = {'零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if (!/[十百]/.test(text)) return text.split('').map(char => digits[char]).join('');
  let total = 0, current = 0;
  for (const char of text) {
    if (char === '十' || char === '百') { total += (current || 1) * (char === '十' ? 10 : 100); current = 0; }
    else current = digits[char];
  }
  return String(total + current);
}

function normalize(text) {
  return text.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0)-65248))
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/[零〇一二兩三四五六七八九十百]+/g, chineseNumber)
    .replace(/點鐘|点|時(?!後)/g, '點')
    // 「小時」不能被前面的「時」替換，因此先還原，再統一單位。
    .replace(/小點/g, '小時').replace(/個小時|鐘頭/g, '小時')
    .replace(/分(?!鐘)/g, '分鐘');
}

function parseTask(original, now = new Date()) {
  let text = normalize(original), time = null, matched = '';
  const relative = text.match(/(\d+)(?:個)?半小時後|(\d+(?:\.\d+)?)小時後|半小時後|(\d+)分鐘後|等1下|待會|晚1點/);
  if (relative) {
    const minutes = relative[1] ? (+relative[1]+0.5)*60 : relative[2] ? +relative[2]*60 : relative[3] ? +relative[3] : relative[0] === '半小時後' ? 30 : relative[0] === '晚1點' ? 60 : 10;
    time = now.getTime() + minutes*60000; matched = relative[0];
  } else {
    const absolute = text.match(/(?:(今天|明天|明早|明晚|後天)|(下週|下周|下禮拜|這週|這周|這禮拜)([1-6日天]))?(早上|上午|中午|下午|晚上|早|晚)?(?:(\d{1,2})點(?:(半)|(\d{1,2})分鐘?)?)?/);
    // 沒有日期、時段或鐘點的輸入，不推測提醒時間。
    if (absolute && absolute[0] && !text.includes('睡前')) {
      const [,day,week,weekday,period,hour,half,minute] = absolute;
      let h = hour ? +hour : (day === '明早' || /早|上午/.test(period || '')) ? 8 : (day === '明晚' || /晚/.test(period || '')) ? 19 : period === '下午' ? 15 : period === '中午' ? 12 : 9;
      const m = half ? 30 : +(minute || 0);
      const afternoon = /下午|晚上|晚/.test(period || '') || day === '明晚';
      if (afternoon && h < 12) h += 12;
      if (/早|上午/.test(period || '') && h === 12) h = 0;
      if (period === '中午' && h < 11) h += 12;
      if (h <= 23 && m <= 59) {
        const date = new Date(now); date.setHours(h,m,0,0);
        if (day === '明天' || day === '明早' || day === '明晚') date.setDate(date.getDate()+1);
        if (day === '後天') date.setDate(date.getDate()+2);
        if (week) {
          const target = /日|天/.test(weekday) ? 7 : +weekday;
          const today = now.getDay() || 7;
          date.setDate(date.getDate() - today + target + (week.startsWith('下') ? 7 : 0));
        } else if (!day && date <= now) date.setDate(date.getDate()+1);
        time = date.getTime(); matched = absolute[0];
      }
    }
  }
  const name = text.replace(matched, '').replace(/睡前|提醒我/g, '') || '待辦事項';
  return {name, time, original};
}

function formatTime(time) {
  return time === null ? '未設定' : new Date(time).toLocaleString('zh-TW', {month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false});
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(tasks)); return true; }
  catch { statusText.textContent = '目前無法保存資料，重新整理可能遺失任務。'; return false; }
}

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

function calendarDate(time) { return new Date(time).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''); }
function calendarDescription(task) { return `原始輸入：${task.original}`; }
function googleUrl(task) {
  const params = new URLSearchParams({action:'TEMPLATE',text:task.name,dates:`${calendarDate(task.time)}/${calendarDate(task.time+1800000)}`,details:calendarDescription(task)});
  return `https://calendar.google.com/calendar/render?${params}`;
}

function downloadCalendar(task) {
  const escape = text => text.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//voice-task-reminder//ZH-TW','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${task.id}@voice-task-reminder`,`DTSTAMP:${calendarDate(Date.now())}`,`DTSTART:${calendarDate(task.time)}`,`DTEND:${calendarDate(task.time+1800000)}`,`SUMMARY:${escape(task.name)}`,`DESCRIPTION:${escape(calendarDescription(task))}`,'END:VEVENT','END:VCALENDAR'];
  // 行事曆格式每行最多 75 個位元組；避免中文文字在換行時被截斷。
  const encoder = new TextEncoder();
  const folded = lines.map(line => {
    let result = '', chunk = '', size = 0;
    for (const char of line) {
      const length = encoder.encode(char).length;
      if (size + length > 75) { result += chunk + '\r\n'; chunk = ' '; size = 1; }
      chunk += char; size += length;
    }
    return result + chunk;
  }).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([folded],{type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = '待辦提醒.ics'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function render() {
  const now = new Date(); const today = now.toDateString();
  const groups = [[],[],[],[]];
  for (const task of tasks) {
    const group = task.done ? 3 : task.time !== null && task.time <= now.getTime() ? 0 : task.time !== null && new Date(task.time).toDateString() === today ? 1 : 2;
    groups[group].push(task);
  }
  const lists = document.querySelector('#task-lists'); lists.replaceChildren();
  ['已到期','今日任務','待辦任務','已完成'].forEach((title,index) => {
    const section = element('section','group','');
    const heading = element('h3','',title); heading.append(element('span','badge',String(groups[index].length))); section.append(heading);
    if (!groups[index].length) section.append(element('p','empty','目前沒有任務'));
    groups[index].sort((a,b) => (a.time ?? Infinity)-(b.time ?? Infinity)).forEach(task => {
      const card = element('article',`task ${index === 0 ? 'overdue' : ''} ${task.done ? 'done' : ''}`,'');
      card.append(element('h4','task-name',task.name),element('p','time',`提醒時間：${formatTime(task.time)}`),element('p','original',`原始輸入：${task.original}`));
      const actions = element('div','actions','');
      const toggle = element('button','',task.done ? '標記未完成' : '標記完成'); toggle.onclick = () => { task.done = !task.done; save(); render(); };
      const remove = element('button','delete','刪除任務'); remove.onclick = () => { tasks = tasks.filter(item => item.id !== task.id); save(); render(); };
      actions.append(toggle,remove);
      if (task.time !== null) {
        const google = element('a','calendar-link','加入 Google Calendar'); google.href = googleUrl(task); google.target = '_blank'; google.rel = 'noopener noreferrer';
        const apple = element('button','','加入 Apple 行事曆'); apple.onclick = () => downloadCalendar(task); actions.append(google,apple);
      }
      card.append(actions); section.append(card);
    });
    lists.append(section);
  });
  document.querySelector('#count').textContent = `${tasks.filter(task => !task.done).length} 件待完成`;
}

input.addEventListener('input', () => {
  const task = parseTask(input.value);
  document.querySelector('#preview').textContent = input.value.trim() ? `提醒時間：${formatTime(task.time)}` : '試試「明早八點提醒我買早餐」';
});
document.querySelector('#task-form').addEventListener('submit', event => {
  event.preventDefault(); if (!input.value.trim()) return;
  tasks.push({...parseTask(input.value.trim()),id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,done:false});
  if (save()) statusText.textContent = '任務已新增並保存。';
  input.value = ''; input.dispatchEvent(new Event('input')); render();
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceButton = document.querySelector('#voice-button');
if (!SpeechRecognition) {
  voiceButton.disabled = true; statusText.textContent = '此瀏覽器不支援語音輸入，請改用打字';
} else {
  const recognition = new SpeechRecognition(); recognition.lang = 'zh-TW'; recognition.interimResults = false;
  let listening = false;
  recognition.onstart = () => { listening = true; voiceButton.textContent = '聆聽中...'; statusText.textContent = '請說出待辦事項與時間。'; };
  recognition.onresult = event => { input.value = event.results[0][0].transcript; input.dispatchEvent(new Event('input')); statusText.textContent = '辨識完成，確認內容後按「新增任務」。'; };
  recognition.onerror = event => { statusText.textContent = event.error === 'not-allowed' ? '請允許麥克風權限，或使用鍵盤輸入。' : '語音辨識未完成，請重試或改用打字。'; };
  recognition.onend = () => { listening = false; voiceButton.textContent = '語音輸入'; };
  voiceButton.onclick = () => { if (listening) recognition.stop(); else { try { recognition.start(); } catch { statusText.textContent = '無法開始語音辨識，請稍後重試。'; } } };
}
render();
// 定期更新分類，頁面開著時跨過提醒時間也會移至「已到期」。
setInterval(render, 30000);
