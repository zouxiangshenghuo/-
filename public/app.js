const app = document.getElementById('app');
let me = null;
let currentState = null;
let mode = 'hall';
let deskCounter = 1;

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
  const repeat = currentState.config.voiceRepeat;
  const text = `请流水号 ${record.number} 到 ${record.counterNumber} 号登记处办理入学手续`;
  for (let i = 0; i < repeat; i += 1) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    speechSynthesis.speak(u);
  }
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
  return `<div class="card row">
    <h2>${currentState.config.systemName}</h2>
    <span class="tag">当前待叫号：${currentState.pendingCount}</span>
    <button class="secondary" id="logout">退出登录</button>
  </div>`;
}

function renderHall() {
  const latest = currentState.calledRecords[currentState.calledRecords.length - 1];
  return `<div class="card">
    <h2>报告厅界面</h2>
    <p>请家长根据叫号前往对应登记处办理。</p>
    ${latest ? `<div class="big-number">${latest.number}</div>
      <h3>请到 ${latest.counterNumber} 号登记处（${(latest.teachers || []).join('、') || '待配置老师'}）</h3>` : '<p>暂无叫号记录</p>'}
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
  return `<div class="card">
    <h2>登记处界面</h2>
    <div class="row">
      <label>登记处编号：<input id="counter" type="number" min="1" max="100" value="${deskCounter}" /></label>
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
      <p>登记处老师配置（格式：登记处:老师1,老师2,老师3；每行一个）</p>
      <textarea id="counters" rows="8" style="width:100%">${Object.entries(currentState.config.counters).map(([k,v]) => `${k}:${v.join(',')}`).join('\n')}</textarea>
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
    document.getElementById('saveConfig').onclick = async () => {
      try {
        const countersRaw = document.getElementById('counters').value.trim();
        const counters = {};
        if (countersRaw) {
          countersRaw.split('\n').forEach((line) => {
            const [key, names] = line.split(':');
            if (!key || !names) return;
            counters[key.trim()] = names.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
          });
        }
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
