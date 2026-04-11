const app = document.getElementById('app');

let me = null;
let currentState = null;
let mode = 'public';
let deskCounter = 1;
let selectedTicketId = '';
let myTicketId = localStorage.getItem('myTicketId') || '';

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

function statusText(status) {
  return {
    waiting: '待叫号',
    called: '已叫号',
    in_progress: '办理中',
    completed: '已完成',
    absent: '过号',
    cancelled: '已取消',
    exception: '异常挂起'
  }[status] || status;
}

function connectEvents() {
  if (!me) return;
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    currentState = JSON.parse(e.data);
    applyTheme();
    render();
  });
}

async function loadPublicState() {
  currentState = await api('/api/public/state');
  applyTheme();
}

async function loadPrivateState() {
  currentState = await api('/api/state');
  applyTheme();
}

function renderHeader() {
  return `<div class="card top-header center-text">
    <h2 class="sys-name">${currentState?.config?.systemName || '学生现场报名叫号系统'}</h2>
    <div class="row center-row">
      <span class="tag">当前等待人数：${currentState?.pendingCount || 0}</span>
      ${me ? `<span class="tag">账号：${me.username}（${me.role === 'admin' ? '管理员' : '登记老师'}）</span>` : ''}
    </div>
  </div>`;
}

function renderPublic() {
  const active = (currentState.activeCalls || [])
    .map((r) => `<tr><td>${r.shortCode}</td><td>${r.counterNumber}号窗口</td><td>${new Date(r.calledAt).toLocaleTimeString()}</td></tr>`)
    .join('');

  return `<div class="grid-2">
    <div class="card">
      <h3>学生扫码取号</h3>
      <p>现场二维码可指向本页面地址，学生填写信息后点击“立即取号”。</p>
      <div class="row">
        <input id="studentName" placeholder="学生姓名（选填）" />
        <input id="phone" placeholder="手机号（选填）" />
      </div>
      <div class="row" style="margin-top:8px">
        <select id="businessType">
          ${(currentState.config.businessTypes || []).map((b) => `<option value="${b}">${b}</option>`).join('')}
        </select>
        <button id="takeTicket">立即取号</button>
      </div>
      <p class="notice" id="publicErr"></p>
      <div id="ticketResult"></div>
    </div>
    <div class="card">
      <h3>等候区叫号信息</h3>
      <p>当前叫号</p>
      <table class="table"><tr><th>号码</th><th>窗口</th><th>时间</th></tr>${active || '<tr><td colspan="3">暂无叫号</td></tr>'}</table>
      <h4>最近记录</h4>
      <ul>${(currentState.calledRecords || []).slice().reverse().map((r) => `<li>${r.shortCode} → ${r.counterNumber}号窗口（${new Date(r.calledAt).toLocaleTimeString()}）</li>`).join('')}</ul>
    </div>
  </div>`;
}

function renderMyTicket(ticket) {
  if (!ticket) return '';
  return `<div class="card center-text">
    <h3>我的排队信息</h3>
    <p class="big-number">${ticket.shortCode}</p>
    <p>流水码：${ticket.serialNumber}</p>
    <p>当前状态：${statusText(ticket.status)}</p>
    <p>前方等待：${ticket.aheadCount} 人</p>
    <p>报名类型：${ticket.businessType}</p>
  </div>`;
}

function renderDesk() {
  return `<div class="card">
    <h3>登记处叫号</h3>
    <div class="row">
      <label>窗口：
        <select id="counterSelect">
          ${Array.from({ length: currentState.config.maxCounterNumber }, (_, i) => i + 1)
            .map((n) => `<option value="${n}" ${n === deskCounter ? 'selected' : ''}>${n}号窗口</option>`)
            .join('')}
        </select>
      </label>
      <button id="callNext">下一号</button>
      <button id="refreshQueue" class="secondary">刷新队列</button>
    </div>
    <div class="row" style="margin-top:8px">
      <select id="ticketSelect"><option value="">选择已叫号码后操作</option></select>
      <button id="recall" class="secondary">重呼</button>
      <button id="inProgress" class="secondary">办理中</button>
      <button id="complete">完成</button>
      <button id="absent" class="danger">过号</button>
      <button id="requeue" class="secondary">重新排队</button>
    </div>
    <p class="notice" id="deskErr"></p>
    <div id="deskQueue"></div>
  </div>`;
}

function renderAdmin() {
  return `<div class="card">
    <h3>管理后台</h3>
    <div class="row">
      <input id="sysName" value="${currentState.config.systemName}" placeholder="系统名称" />
      <input id="queuePrefix" value="${currentState.config.queuePrefix}" placeholder="流水码前缀" />
      <input id="shortPrefix" value="${currentState.config.shortPrefix}" placeholder="简码前缀" />
    </div>
    <div class="row" style="margin-top:8px">
      <label>语音播报次数 <input id="voiceRepeat" type="number" min="1" max="10" value="${currentState.config.voiceRepeat}" /></label>
      <label>记录条数 <input id="hallRecordLimit" type="number" min="1" max="100" value="${currentState.config.hallRecordLimit}" /></label>
      <label>窗口数量 <input id="maxCounterNumber" type="number" min="1" max="100" value="${currentState.config.maxCounterNumber}" /></label>
    </div>
    <div class="row" style="margin-top:8px">
      <label>报名类型（逗号分隔）<input id="businessTypes" value="${(currentState.config.businessTypes || []).join('，')}" /></label>
      <label><input id="allowRepeatTakeByPhone" type="checkbox" ${currentState.config.allowRepeatTakeByPhone ? 'checked' : ''}/> 允许手机号重复取号</label>
    </div>
    <div class="row" style="margin-top:8px">
      <label>字体 <input id="fontFamily" value="${currentState.config.theme.fontFamily}" /></label>
      <label>标题字号 <input id="titleFontSize" type="number" min="20" max="72" value="${currentState.config.theme.titleFontSize}" /></label>
      <label>标题颜色 <input id="titleColor" type="color" value="${currentState.config.theme.titleColor}" /></label>
      <button id="saveConfig">保存配置</button>
    </div>
    <p class="notice" id="adminErr"></p>
  </div>`;
}

function bindPublicActions() {
  const takeBtn = document.getElementById('takeTicket');
  if (takeBtn) {
    takeBtn.onclick = async () => {
      try {
        const ticket = await api('/api/public/take-ticket', 'POST', {
          studentName: document.getElementById('studentName').value.trim(),
          phone: document.getElementById('phone').value.trim(),
          businessType: document.getElementById('businessType').value
        });
        myTicketId = ticket.id;
        localStorage.setItem('myTicketId', myTicketId);
        document.getElementById('ticketResult').innerHTML = renderMyTicket(ticket);
        document.getElementById('publicErr').textContent = '';
        await loadPublicState();
        render();
      } catch (e) {
        document.getElementById('publicErr').textContent = e.message;
      }
    };
  }
}

async function refreshDeskQueue() {
  const data = await api(`/api/teacher/queue?counter=${deskCounter}`);
  const deskQueue = document.getElementById('deskQueue');
  const ticketSelect = document.getElementById('ticketSelect');
  if (!deskQueue || !ticketSelect) return;
  deskQueue.innerHTML = `<table class="table"><tr><th>号码</th><th>类型</th><th>状态</th><th>取号时间</th></tr>
    ${data.queue.map((q) => `<tr><td>${q.shortCode}</td><td>${q.businessType}</td><td>${statusText(q.status)}</td><td>${new Date(q.ticketAt).toLocaleTimeString()}</td></tr>`).join('') || '<tr><td colspan="4">暂无排队</td></tr>'}
  </table>`;
  ticketSelect.innerHTML = '<option value="">选择已叫号码后操作</option>' + (currentState.calledRecords || [])
    .slice()
    .reverse()
    .filter((r) => r.counterNumber === deskCounter)
    .slice(0, 10)
    .map((r) => `<option value="${r.ticketId}">${r.shortCode} (${new Date(r.calledAt).toLocaleTimeString()})</option>`)
    .join('');
}

function bindDeskActions() {
  const counterSelect = document.getElementById('counterSelect');
  if (!counterSelect) return;

  counterSelect.onchange = async () => {
    deskCounter = Number(counterSelect.value);
    await refreshDeskQueue();
  };

  document.getElementById('refreshQueue').onclick = async () => {
    await refreshDeskQueue();
  };

  document.getElementById('callNext').onclick = async () => {
    try {
      await api('/api/teacher/call-next', 'POST', { counterNumber: deskCounter });
      document.getElementById('deskErr').textContent = '叫号成功';
      await loadPrivateState();
      render();
    } catch (e) {
      document.getElementById('deskErr').textContent = e.message;
    }
  };

  const doUpdate = async (status) => {
    const ticketId = document.getElementById('ticketSelect').value;
    if (!ticketId) {
      document.getElementById('deskErr').textContent = '请先选择一个号码';
      return;
    }
    await api('/api/teacher/update-status', 'POST', { ticketId, status });
    await loadPrivateState();
    render();
  };

  document.getElementById('recall').onclick = async () => {
    const ticketId = document.getElementById('ticketSelect').value;
    if (!ticketId) return;
    await api('/api/teacher/recall', 'POST', { ticketId });
    await loadPrivateState();
    render();
  };

  document.getElementById('inProgress').onclick = () => doUpdate('in_progress');
  document.getElementById('complete').onclick = () => doUpdate('completed');
  document.getElementById('absent').onclick = () => doUpdate('absent');
  document.getElementById('requeue').onclick = () => doUpdate('waiting');

  refreshDeskQueue();
}

function bindAdminActions() {
  const saveConfig = document.getElementById('saveConfig');
  if (!saveConfig) return;
  saveConfig.onclick = async () => {
    try {
      await api('/api/admin/config', 'POST', {
        systemName: document.getElementById('sysName').value.trim(),
        queuePrefix: document.getElementById('queuePrefix').value.trim(),
        shortPrefix: document.getElementById('shortPrefix').value.trim(),
        voiceRepeat: Number(document.getElementById('voiceRepeat').value),
        hallRecordLimit: Number(document.getElementById('hallRecordLimit').value),
        maxCounterNumber: Number(document.getElementById('maxCounterNumber').value),
        allowRepeatTakeByPhone: document.getElementById('allowRepeatTakeByPhone').checked,
        businessTypes: document.getElementById('businessTypes').value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
        teacherPool: currentState.config.teacherPool || [],
        counters: currentState.config.counters || {},
        theme: {
          fontFamily: document.getElementById('fontFamily').value.trim(),
          titleFontSize: Number(document.getElementById('titleFontSize').value),
          titleColor: document.getElementById('titleColor').value
        }
      });
      document.getElementById('adminErr').textContent = '配置已保存';
      await loadPrivateState();
      render();
    } catch (e) {
      document.getElementById('adminErr').textContent = e.message;
    }
  };
}

function bindCommonActions() {
  const toPublic = document.getElementById('toPublic');
  if (toPublic) {
    toPublic.onclick = async () => {
      mode = 'public';
      await loadPublicState();
      render();
    };
  }

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      try {
        me = await api('/api/login', 'POST', {
          username: document.getElementById('u').value.trim(),
          password: document.getElementById('p').value
        });
        mode = 'hall';
        await loadPrivateState();
        connectEvents();
        render();
      } catch (e) {
        document.getElementById('loginErr').textContent = e.message;
      }
    };
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api('/api/logout', 'POST');
      me = null;
      mode = 'public';
      await loadPublicState();
      render();
    };
  }

  const hallBtn = document.getElementById('hallBtn');
  if (hallBtn) hallBtn.onclick = () => { mode = 'hall'; render(); };
  const deskBtn = document.getElementById('deskBtn');
  if (deskBtn) deskBtn.onclick = () => { mode = 'desk'; render(); bindDeskActions(); };
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.onclick = () => { mode = 'admin'; render(); };
}

async function render() {
  let myTicket = null;
  if (myTicketId) {
    try {
      myTicket = await api(`/api/public/ticket/${myTicketId}`);
    } catch {
      myTicketId = '';
      localStorage.removeItem('myTicketId');
    }
  }

  const privateNav = me
    ? `<div class="card row center-row">
      <button id="hallBtn" class="${mode === 'hall' ? '' : 'secondary'}">等候区大屏</button>
      <button id="deskBtn" class="${mode === 'desk' ? '' : 'secondary'}">教师叫号台</button>
      ${me.role === 'admin' ? `<button id="adminBtn" class="${mode === 'admin' ? '' : 'secondary'}">管理后台</button>` : ''}
      <button id="logoutBtn" class="danger">退出</button>
    </div>`
    : `<div class="card center-text">
      <div class="row center-row">
        <button id="toPublic" class="secondary">学生取号页</button>
      </div>
      <div class="row center-row" style="margin-top:8px">
        <input id="u" placeholder="账号" />
        <input id="p" type="password" placeholder="密码" />
        <button id="loginBtn">教师/管理员登录</button>
      </div>
      <p>默认账号：admin/admin123，teacher/teacher123</p>
      <p class="notice" id="loginErr"></p>
    </div>`;

  const hallContent = `<div class="card center-text">
    <h3>当前叫号总览</h3>
    ${(currentState.activeCalls || []).map((r) => `<p><strong>${r.shortCode}</strong> 请到 <strong>${r.counterNumber}号窗口</strong></p>`).join('') || '<p>暂无叫号</p>'}
  </div>`;

  app.innerHTML = `${renderHeader()}${privateNav}${
    !me || mode === 'public'
      ? renderPublic() + renderMyTicket(myTicket)
      : mode === 'desk'
        ? renderDesk()
        : mode === 'admin' && me.role === 'admin'
          ? renderAdmin()
          : hallContent
  }`;

  bindCommonActions();
  if (!me || mode === 'public') bindPublicActions();
  if (me && mode === 'desk') bindDeskActions();
  if (me && mode === 'admin' && me.role === 'admin') bindAdminActions();
}

(async function init() {
  try {
    me = await api('/api/me');
    await loadPrivateState();
    connectEvents();
  } catch {
    me = null;
    await loadPublicState();
  }
  await render();
})();
