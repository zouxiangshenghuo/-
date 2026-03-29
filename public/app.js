const app = document.getElementById('app');
let me = null;
let currentState = null;
let mode = 'hall';
let deskCounter = 1;
let speechUnlocked = false;
let lastSpeechKey = '';

const VOICE_PROFILE_KEYWORDS = ['zhiling', '志玲', 'xiaoxiao', 'xiaoyi', 'huihui', 'female', '女'];

function pickLinZhilingStyleVoice() {
  const voices = speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const normalized = voices.map((voice) => ({
    voice,
    key: `${voice.name} ${voice.lang}`.toLowerCase()
  }));

  const preferred = normalized.find((item) => VOICE_PROFILE_KEYWORDS.some((k) => item.key.includes(k)));
  if (preferred) return preferred.voice;

  const zhFemale = normalized.find((item) => (item.key.includes('zh') || item.key.includes('cmn')) && item.key.includes('female'));
  if (zhFemale) return zhFemale.voice;

  const zhAny = normalized.find((item) => item.key.includes('zh') || item.key.includes('cmn'));
  return zhAny ? zhAny.voice : voices[0];
}

function waitVoicesReady(timeout = 1500) {
  return new Promise((resolve) => {
    const ready = speechSynthesis.getVoices();
    if (ready && ready.length) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeout);
  });
}


function unlockSpeechByGesture() {
  if (speechUnlocked || !window.speechSynthesis) return;
  try {
    const unlockUtterance = new SpeechSynthesisUtterance('');
    unlockUtterance.volume = 0;
    speechSynthesis.speak(unlockUtterance);
    speechSynthesis.cancel();
    speechUnlocked = true;
  } catch {
    speechUnlocked = false;
  }
}

const VOICE_PROFILE_KEYWORDS = ['zhiling', '志玲', 'xiaoxiao', 'xiaoyi', 'huihui', 'female', '女'];

function pickLinZhilingStyleVoice() {
  const voices = speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const normalized = voices.map((voice) => ({
    voice,
    key: `${voice.name} ${voice.lang}`.toLowerCase()
  }));

  const preferred = normalized.find((item) => VOICE_PROFILE_KEYWORDS.some((k) => item.key.includes(k)));
  if (preferred) return preferred.voice;

  const zhFemale = normalized.find((item) => (item.key.includes('zh') || item.key.includes('cmn')) && item.key.includes('female'));
  if (zhFemale) return zhFemale.voice;

  const zhAny = normalized.find((item) => item.key.includes('zh') || item.key.includes('cmn'));
  return zhAny ? zhAny.voice : voices[0];
}

function waitVoicesReady(timeout = 1500) {
  return new Promise((resolve) => {
    const ready = speechSynthesis.getVoices();
    if (ready && ready.length) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeout);
  });
}

const api = async (url, method = 'GET', body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
};

function applyTheme() {
  if (!currentState) return;
  const { theme = {} } = currentState.config;
  document.documentElement.style.setProperty('--dynamic-font-family', theme.fontFamily || 'Microsoft YaHei');
  document.documentElement.style.setProperty('--dynamic-title-size', `${theme.titleFontSize || 42}px`);
  document.documentElement.style.setProperty('--dynamic-title-color', theme.titleColor || '#0f4aa8');
}

async function speak(record) {
  if (!record || !currentState || !window.speechSynthesis) return;
  const speechKey = `${record.number}-${record.counterNumber}-${record.calledAt || ''}`;
  if (speechKey === lastSpeechKey) return;
  lastSpeechKey = speechKey;

  await waitVoicesReady();
  speechSynthesis.cancel();

  const repeat = currentState.config.voiceRepeat;
  const teacherText = (record.teachers || []).length
    ? `，由${record.teachers.join('、')}老师办理`
    : '，当前登记处老师信息未配置';
  const text = `请注意：流水码 ${record.number} ，请到 ${record.counterNumber} 号登记处办理入学手续${teacherText}`;
  const selectedVoice = pickLinZhilingStyleVoice();

  for (let i = 0; i < repeat; i += 1) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedVoice?.lang || 'zh-CN';
    utterance.rate = 0.95;
    utterance.pitch = 1.15;
    if (selectedVoice) utterance.voice = selectedVoice;
    speechSynthesis.speak(utterance);
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    currentState = JSON.parse(e.data);
    applyTheme();
    render();
  });
  es.addEventListener('called', (e) => {
    const data = JSON.parse(e.data);
    currentState = data;
    applyTheme();
    void speak(data.latestRecord);
    render();
  });
}

async function init() {
  try {
    me = await api('/api/me');
    currentState = await api('/api/state');
    applyTheme();
    connectEvents();
    render();
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="card login-card center-text">
      <h1 class="sys-name">新生报名叫号系统</h1>
      <p>默认管理员：admin / admin123；普通账号：user / user123</p>
      <div class="row center-row">
        <input id="u" placeholder="用户名" />
        <input id="p" type="password" placeholder="密码" />
        <button id="login">登录</button>
      </div>
      <p class="notice" id="err"></p>
    </div>`;
  document.getElementById('login').onclick = async () => {
    unlockSpeechByGesture();
    try {
      await api('/api/login', 'POST', {
        username: document.getElementById('u').value.trim(),
        password: document.getElementById('p').value
      });
      init();
    } catch (e) {
      document.getElementById('err').textContent = e.message;
    }
  };
}

function renderHeader() {
  return `<div class="card top-header center-text">
    <div class="school-title">苏州市立达中学校园服务平台</div>
    <h2 class="sys-name">${currentState.config.systemName}</h2>
    <div class="row center-row">
      <span class="tag">当前待叫号：${currentState.pendingCount}</span>
      <button class="secondary" id="logout">退出登录</button>
    </div>
  </div>`;
}

function renderHall() {
  const latest = currentState.calledRecords[currentState.calledRecords.length - 1];
  return `<div class="card center-text">
    <h2>报告厅界面</h2>
    <p>请家长根据叫号前往对应登记处办理。</p>
    ${
      latest
        ? `<div class="big-number">${latest.number}</div>
      <h3>请到 ${latest.counterNumber} 号登记处（${(latest.teachers || []).join('、') || '待配置老师'}）</h3>`
        : '<p>暂无叫号记录</p>'
    }
  </div>
  <div class="card">
    <h3 class="center-text">最近叫号记录（显示${currentState.config.hallRecordLimit}条以内）</h3>
    <table class="table"><tr><th>流水码</th><th>登记处</th><th>老师</th><th>时间</th></tr>
      ${currentState.calledRecords
        .slice()
        .reverse()
        .map(
          (r) =>
            `<tr><td>${r.number}</td><td>${r.counterNumber}</td><td>${(r.teachers || []).join('、') || '未配置'}</td><td>${new Date(r.calledAt).toLocaleString()}</td></tr>`
        )
        .join('')}
    </table>
  </div>`;
}

function counterOptions() {
  return Array.from({ length: currentState.config.maxCounterNumber }, (_, i) => i + 1)
    .map((n) => `<option value="${n}">${n}号登记处</option>`)
    .join('');
}

function renderDesk() {
  const teachers = currentState.config.counters[String(deskCounter)] || [];
  return `<div class="card center-text">
    <h2>登记处界面</h2>
    <div class="row center-row">
      <label>登记处编号：
        <select id="counter">
          ${Array.from({ length: currentState.config.maxCounterNumber }, (_, i) => i + 1)
            .map((n) => `<option value="${n}" ${n === deskCounter ? 'selected' : ''}>${n}号登记处</option>`)
            .join('')}
        </select>
      </label>
      <button id="saveCounter" class="secondary">设置</button>
      <span>老师：${teachers.join('、') || '未配置'}</span>
    </div>
    <div class="row center-row" style="margin-top:10px">
      <span>系统分配流水码：<strong>${currentState.nextNumber || '无'}</strong></span>
      <button id="call">叫号</button>
    </div>
    <p id="deskErr" class="notice"></p>
  </div>`;
}

function counterRowsHtml() {
  const entries = Object.entries(currentState.config.counters);
  const rows = entries.length ? entries : [['1', ['']]];
  const teacherPool = currentState.config.teacherPool || [];
  const teacherOptions = ['<option value="">未选择</option>', ...teacherPool.map((name) => `<option value="${name}">${name}</option>`)].join('');
  return rows
    .map(([counter, teachers], idx) => {
      const teacherA = teachers?.[0] || '';
      const teacherB = teachers?.[1] || '';
      return `<div class="row counter-row" data-row="${idx}">
      <label>登记处
        <select class="counter-select">
          ${Array.from({ length: currentState.config.maxCounterNumber }, (_, i) => i + 1)
            .map((n) => `<option value="${n}" ${String(n) === String(counter) ? 'selected' : ''}>${n}号</option>`)
            .join('')}
        </select>
      </label>
      <label>老师1
        <select class="teacher-select-a">
          ${teacherOptions.replace(`value="${teacherA}"`, `value="${teacherA}" selected`)}
        </select>
      </label>
      <label>老师2
        <select class="teacher-select-b">
          ${teacherOptions.replace(`value="${teacherB}"`, `value="${teacherB}" selected`)}
        </select>
      </label>
      <button type="button" class="danger remove-counter">删除</button>
    </div>`;
    })
    .join('');
}

function renderAdmin() {
  const { config } = currentState;
  return `<div class="grid-2">
    <div class="card">
      <h3 class="center-text">系统配置</h3>
      <div class="row center-row"><input id="sysName" value="${config.systemName}" placeholder="系统名称" /></div>
      <div class="row center-row">
        <label>区间 <input id="start" type="number" min="1" max="2000" value="${config.rangeStart}" /></label>
        <label>到 <input id="end" type="number" min="1" max="2000" value="${config.rangeEnd}" /></label>
      </div>
      <div class="row center-row">
        <label>语音播报次数 <input id="repeat" type="number" min="1" max="10" value="${config.voiceRepeat}" /></label>
        <label>记录显示条数 <input id="hallRecordLimit" type="number" min="1" max="100" value="${config.hallRecordLimit}" /></label>
        <label>登记处数量 <input id="maxCounterNumber" type="number" min="1" max="100" value="${config.maxCounterNumber}" /></label>
      </div>
      <div class="row center-row">
        <label>系统字体 <input id="fontFamily" value="${config.theme.fontFamily}" /></label>
        <label>系统名称字号 <input id="titleFontSize" type="number" min="20" max="72" value="${config.theme.titleFontSize}" /></label>
        <label>系统名称颜色 <input id="titleColor" type="color" value="${config.theme.titleColor}" /></label>
      </div>
      <div class="row center-row">
        <label>老师名单（逗号分隔）<input id="teacherPool" value="${(config.teacherPool || []).join('，')}" /></label>
      </div>
      <p class="center-text">登记处老师配置（每个登记处最多2位老师）</p>
      <div id="counterRows">${counterRowsHtml()}</div>
      <div class="row center-row">
        <button id="addCounterRow" type="button" class="secondary">新增登记处老师配置</button>
        <button id="saveConfig">保存配置</button>
      </div>
      <p class="notice center-text" id="cfgErr"></p>
    </div>
    <div class="card">
      <h3 class="center-text">过号处理</h3>
      <div class="row center-row">
        <input id="manualNumber" type="number" placeholder="输入过号流水码" />
        <button id="searchNumber" class="secondary">搜索编码状态</button>
        <button id="addNumber">手动添加回队列</button>
      </div>
      <p class="center-text" id="numberStatus"></p>
      <p class="notice center-text" id="manualErr"></p>
      <hr/>
      <h3 class="center-text">账号管理</h3>
      <div class="row center-row">
        <input id="newUser" placeholder="用户名" />
        <input id="newPwd" placeholder="密码" />
        <select id="newRole"><option value="user">普通账号</option><option value="admin">管理员</option></select>
        <button id="saveUser">新增/更新账号</button>
      </div>
      <p class="notice center-text" id="accErr"></p>
      <ul id="accList"></ul>
    </div>
  </div>`;
}

async function loadAccounts() {
  if (me.role !== 'admin') return;
  const list = await api('/api/admin/accounts');
  document.getElementById('accList').innerHTML = list.map((u) => `<li>${u.username}（${u.role}）</li>`).join('');
}

function bindActions() {
  document.getElementById('logout').onclick = async () => {
    await api('/api/logout', 'POST');
    me = null;
    renderLogin();
  };

  const hallBtn = document.getElementById('hallBtn');
  const deskBtn = document.getElementById('deskBtn');
  if (hallBtn) hallBtn.onclick = () => {
    unlockSpeechByGesture();
    mode = 'hall';
    render();
  };
  if (deskBtn) deskBtn.onclick = () => {
    unlockSpeechByGesture();
    mode = 'desk';
    render();
  };

  if (document.getElementById('saveCounter')) {
    document.getElementById('saveCounter').onclick = () => {
      const value = Number(document.getElementById('counter').value);
      if (Number.isInteger(value) && value >= 1 && value <= currentState.config.maxCounterNumber) deskCounter = value;
      render();
    };

    document.getElementById('call').onclick = async () => {
      unlockSpeechByGesture();
      try {
        const record = await api('/api/call-next', 'POST', { counterNumber: deskCounter });
        void speak(record);
        document.getElementById('deskErr').textContent = '叫号成功';
      } catch (e) {
        document.getElementById('deskErr').textContent = e.message;
      }
    };
  }

  if (me.role === 'admin') {
    const rowsContainer = document.getElementById('counterRows');

    document.getElementById('addCounterRow').onclick = () => {
      const row = document.createElement('div');
      row.className = 'row counter-row';
      row.innerHTML = `
      <label>登记处
        <select class="counter-select">
          ${counterOptions()}
        </select>
      </label>
      <label>老师1
        <select class="teacher-select-a">
          <option value="">未选择</option>
          ${(currentState.config.teacherPool || []).map((name) => `<option value="${name}">${name}</option>`).join('')}
        </select>
      </label>
      <label>老师2
        <select class="teacher-select-b">
          <option value="">未选择</option>
          ${(currentState.config.teacherPool || []).map((name) => `<option value="${name}">${name}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="danger remove-counter">删除</button>`;
      rowsContainer.appendChild(row);
    };

    rowsContainer.onclick = (event) => {
      if (!event.target.classList.contains('remove-counter')) return;
      const rows = rowsContainer.querySelectorAll('.counter-row');
      if (rows.length <= 1) return;
      event.target.closest('.counter-row').remove();
    };

    document.getElementById('saveConfig').onclick = async () => {
      try {
        const counters = {};
        rowsContainer.querySelectorAll('.counter-row').forEach((row) => {
          const counter = row.querySelector('.counter-select').value;
          const teacherA = row.querySelector('.teacher-select-a').value;
          const teacherB = row.querySelector('.teacher-select-b').value;
          const teachers = [...new Set([teacherA, teacherB].filter(Boolean))].slice(0, 2);
          if (teachers.length) counters[counter] = teachers;
        });
        const teacherPool = document
          .getElementById('teacherPool')
          .value.split(/[、,，]/)
          .map((s) => s.trim())
          .filter(Boolean);

        await api('/api/admin/config', 'POST', {
          systemName: document.getElementById('sysName').value.trim(),
          rangeStart: Number(document.getElementById('start').value),
          rangeEnd: Number(document.getElementById('end').value),
          voiceRepeat: Number(document.getElementById('repeat').value),
          hallRecordLimit: Number(document.getElementById('hallRecordLimit').value),
          maxCounterNumber: Number(document.getElementById('maxCounterNumber').value),
          theme: {
            fontFamily: document.getElementById('fontFamily').value.trim(),
            titleFontSize: Number(document.getElementById('titleFontSize').value),
            titleColor: document.getElementById('titleColor').value
          },
          teacherPool,
          counters
        });
        document.getElementById('cfgErr').textContent = '配置保存成功';
      } catch (e) {
        document.getElementById('cfgErr').textContent = e.message;
      }
    };

    document.getElementById('addNumber').onclick = async () => {
      try {
        await api('/api/admin/add-number', 'POST', { number: Number(document.getElementById('manualNumber').value) });
        document.getElementById('manualErr').textContent = '已加入优先队列（按最小号优先）';
        document.getElementById('numberStatus').textContent = '';
      } catch (e) {
        document.getElementById('manualErr').textContent = e.message;
      }
    };
    document.getElementById('searchNumber').onclick = async () => {
      try {
        const number = Number(document.getElementById('manualNumber').value);
        const result = await api(`/api/admin/number-status?number=${number}`);
        const statusMap = {
          pending: '待叫号队列中',
          called: `已叫号（登记处${result.latestCalled.counterNumber}，时间：${new Date(result.latestCalled.calledAt).toLocaleString()}）`,
          unused: '未叫号，且不在队列中',
          out_of_range: '不在当前流水码区间内'
        };
        document.getElementById('numberStatus').textContent = `流水码 ${number} 当前状态：${statusMap[result.status] || result.status}`;
        document.getElementById('manualErr').textContent = '';
      } catch (e) {
        document.getElementById('manualErr').textContent = e.message;
      }
    };

    document.getElementById('saveUser').onclick = async () => {
      try {
        await api('/api/admin/accounts', 'POST', {
          username: document.getElementById('newUser').value.trim(),
          password: document.getElementById('newPwd').value.trim(),
          role: document.getElementById('newRole').value
        });
        document.getElementById('accErr').textContent = '账号已保存';
        loadAccounts();
      } catch (e) {
        document.getElementById('accErr').textContent = e.message;
      }
    };

    loadAccounts();
  }
}

function render() {
  app.innerHTML = `${renderHeader()}
    <div class="card row center-row">
      <button id="hallBtn" class="${mode === 'hall' ? '' : 'secondary'}">报告厅界面</button>
      <button id="deskBtn" class="${mode === 'desk' ? '' : 'secondary'}">登记处界面</button>
      <span>当前账号：${me.username}（${me.role === 'admin' ? '管理员' : '普通账号'}）</span>
    </div>
    ${mode === 'hall' ? renderHall() : renderDesk()}
    ${me.role === 'admin' ? renderAdmin() : ''}`;
  bindActions();
}

init();
