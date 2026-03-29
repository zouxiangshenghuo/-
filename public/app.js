const app = document.getElementById('app');
let me = null;
let currentState = null;
let mode = 'hall';
let deskCounter = 1;
const COUNTER_OPTIONS_HTML = Array.from({ length: 100 }, (_, i) => i + 1)
  .map((n) => `<option value="${n}">${n}号</option>`)
  .join('');

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

function speak(record) {
  if (!record || !currentState) return;
  const repeat = Math.max(1, Math.min(10, Number(currentState.config.voiceRepeat) || 1));
  const teacherText = (record.teachers || []).length ? `，由${record.teachers.join('、')}老师办理` : '';
  const text = `请流水码 ${record.number} 到 ${record.counterNumber} 号登记处办理入学手续${teacherText}`;
  speechSynthesis.cancel();
  let spoken = 0;
  const play = () => {
    if (spoken >= repeat) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    spoken += 1;
    u.onend = play;
    speechSynthesis.speak(u);
  };
  play();
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    currentState = JSON.parse(e.data);
    render();
  });
  es.addEventListener('called', (e) => {
    const data = JSON.parse(e.data);
    currentState = data;
    speak(data.latestRecord);
    render();
  });
}

async function init() {
  try {
    me = await api('/api/me');
    currentState = await api('/api/state');
    connectEvents();
    render();
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="card">
      <h1>新生报名叫号系统</h1>
      <p>默认管理员：admin / admin123；普通账号：user / user123</p>
      <div class="row">
        <input id="u" placeholder="用户名" />
        <input id="p" type="password" placeholder="密码" />
        <button id="login">登录</button>
      </div>
      <p class="notice" id="err"></p>
    </div>`;
  document.getElementById('login').onclick = async () => {
    try {
      await api('/api/login', 'POST', {
        username: document.getElementById('u').value,
        password: document.getElementById('p').value
      });
      init();
    } catch (e) {
      document.getElementById('err').textContent = e.message;
    }
  };
}

function renderHeader() {
  return `<div class="card row top-header">
    <div>
      <div class="school-title">苏州立达中学校园服务平台</div>
      <h2>${currentState.config.systemName}</h2>
    </div>
    <span class="tag">当前待叫号：${currentState.pendingCount}</span>
    <button class="secondary" id="logout">退出登录</button>
  </div>`;
}

function renderHall() {
  const latest = currentState.calledRecords[currentState.calledRecords.length - 1];
  return `<div class="card hall-panel">
    <h2>报告厅界面</h2>
    <p class="hall-tip">请家长根据叫号前往对应登记处办理。</p>
    ${latest ? `<div class="big-number">${latest.number}</div>
      <h3>请到 ${latest.counterNumber} 号登记处</h3>` : '<p class="hall-tip">暂无叫号记录</p>'}
  </div>
  <div class="card">
    <h3>最近叫号记录</h3>
    <table class="table"><tr><th>流水码</th><th>登记处</th><th>老师</th><th>时间</th></tr>
      ${currentState.calledRecords.slice().reverse().map(r => `<tr><td>${r.number}</td><td>${r.counterNumber}</td><td>${(r.teachers || []).join('、')}</td><td>${new Date(r.calledAt).toLocaleString()}</td></tr>`).join('')}
    </table>
  </div>`;
}

function renderDesk() {
  const t = currentState.config.counters[String(deskCounter)] || [];
  const deskOptions = COUNTER_OPTIONS_HTML.replace(`value="${deskCounter}"`, `value="${deskCounter}" selected`);
  return `<div class="card">
    <h2>登记处界面</h2>
    <div class="row">
      <label>登记处编号：
        <select id="counter">
          ${deskOptions}
        </select>
      </label>
      <button id="saveCounter" class="secondary">设置</button>
      <span>老师：${t.join('、') || '未配置'}</span>
    </div>
    <div class="row" style="margin-top:10px">
      <span>下一个系统分配流水码：<strong>${currentState.nextNumber || '无'}</strong></span>
      <button id="call">叫号</button>
    </div>
    <p id="deskErr" class="notice"></p>
  </div>`;
}

function counterRowsHtml() {
  const entries = Object.entries(currentState.config.counters);
  const rows = entries.length ? entries : [['1', ['']]];
  return rows.map(([counter, teachers], idx) => {
    const names = (teachers || []).slice(0, 3).join('、');
    const rowOptions = COUNTER_OPTIONS_HTML.replace(`value="${counter}"`, `value="${counter}" selected`);
    return `<div class="row counter-row" data-row="${idx}">
      <label>登记处
        <select class="counter-select">
          ${rowOptions}
        </select>
      </label>
      <input class="teacher-input" placeholder="老师姓名（最多3位，用、或,分隔）" value="${names}" />
      <button type="button" class="danger remove-counter">删除</button>
    </div>`;
  }).join('');
}

function renderAdmin() {
  return `<div class="grid-2">
    <div class="card">
      <h3>系统配置</h3>
      <div class="row"><input id="sysName" value="${currentState.config.systemName}" placeholder="系统名称" /></div>
      <div class="row">
        <label>区间 <input id="start" type="number" min="1" max="1000" value="${currentState.config.rangeStart}" /></label>
        <label>到 <input id="end" type="number" min="1" max="1000" value="${currentState.config.rangeEnd}" /></label>
        <label>语音播报次数 <input id="repeat" type="number" min="1" max="10" value="${currentState.config.voiceRepeat}" /></label>
      </div>
      <p>登记处老师配置（下拉选择登记处号码，填写老师姓名，最多3位）</p>
      <div id="counterRows">${counterRowsHtml()}</div>
      <button id="addCounterRow" type="button" class="secondary">新增登记处老师配置</button>
      <button id="saveConfig">保存配置</button>
      <p class="notice" id="cfgErr"></p>
    </div>
    <div class="card">
      <h3>过号处理</h3>
      <div class="row">
        <input id="manualNumber" type="number" placeholder="输入过号流水码" />
        <button id="addNumber">手动添加回队列</button>
      </div>
      <p class="notice" id="manualErr"></p>
      <hr/>
      <h3>账号管理</h3>
      <div class="row">
        <input id="newUser" placeholder="用户名" />
        <input id="newPwd" placeholder="密码" />
        <select id="newRole"><option value="user">普通账号</option><option value="admin">管理员</option></select>
        <button id="saveUser">新增/更新账号</button>
      </div>
      <p class="notice" id="accErr"></p>
      <ul id="accList"></ul>
    </div>
  </div>`;
}

async function loadAccounts() {
  if (me.role !== 'admin') return;
  const list = await api('/api/admin/accounts');
  document.getElementById('accList').innerHTML = list.map(u => `<li>${u.username}（${u.role}）</li>`).join('');
}

function bindActions() {
  document.getElementById('logout').onclick = async () => {
    await api('/api/logout', 'POST');
    me = null;
    renderLogin();
  };

  const hallBtn = document.getElementById('hallBtn');
  const deskBtn = document.getElementById('deskBtn');
  if (hallBtn) hallBtn.onclick = () => { mode = 'hall'; render(); };
  if (deskBtn) deskBtn.onclick = () => { mode = 'desk'; render(); };

  if (document.getElementById('saveCounter')) {
    document.getElementById('saveCounter').onclick = () => {
      const v = Number(document.getElementById('counter').value);
      if (Number.isInteger(v) && v >= 1 && v <= 100) deskCounter = v;
      render();
    };

    document.getElementById('call').onclick = async () => {
      try {
        await api('/api/call-next', 'POST', { counterNumber: deskCounter });
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
          ${COUNTER_OPTIONS_HTML}
        </select>
      </label>
      <input class="teacher-input" placeholder="老师姓名（最多3位，用、或,分隔）" />
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
          const rawTeachers = row.querySelector('.teacher-input').value.trim();
          const teachers = rawTeachers ? rawTeachers.split(/[、,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 3) : [];
          if (teachers.length) counters[counter] = teachers;
        });
        await api('/api/admin/config', 'POST', {
          systemName: document.getElementById('sysName').value.trim(),
          rangeStart: Number(document.getElementById('start').value),
          rangeEnd: Number(document.getElementById('end').value),
          voiceRepeat: Number(document.getElementById('repeat').value),
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
    <div class="card row">
      <button id="hallBtn" class="${mode === 'hall' ? '' : 'secondary'}">报告厅界面</button>
      <button id="deskBtn" class="${mode === 'desk' ? '' : 'secondary'}">登记处界面</button>
      <span>当前账号：${me.username}（${me.role === 'admin' ? '管理员' : '普通账号'}）</span>
    </div>
    ${mode === 'hall' ? renderHall() : renderDesk()}
    ${me.role === 'admin' ? renderAdmin() : ''}`;
  bindActions();
}

init();
