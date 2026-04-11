const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'state.json');

const sessions = new Map();
const sseClients = new Set();

const TICKET_STATUS = {
  WAITING: 'waiting',
  CALLED: 'called',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABSENT: 'absent',
  CANCELLED: 'cancelled',
  EXCEPTION: 'exception'
};

function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function createDefaultState() {
  const today = ymd();
  return {
    config: {
      systemName: '学生现场报名叫号系统',
      queuePrefix: 'BM',
      shortPrefix: 'A',
      voiceRepeat: 2,
      hallRecordLimit: 20,
      maxCounterNumber: 6,
      allowRepeatTakeByPhone: false,
      businessTypes: ['新生报名', '转校生报名', '补录报名'],
      theme: {
        fontFamily: 'Microsoft YaHei',
        titleFontSize: 42,
        titleColor: '#0f4aa8'
      },
      teacherPool: ['张老师', '李老师', '王老师'],
      counters: {}
    },
    accounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher' }
    ],
    sequenceByDay: { [today]: 0 },
    tickets: [],
    calledRecords: []
  };
}

function migrateState(rawState) {
  const defaults = createDefaultState();
  const merged = {
    ...defaults,
    ...(rawState || {}),
    config: {
      ...defaults.config,
      ...((rawState && rawState.config) || {}),
      theme: {
        ...defaults.config.theme,
        ...(((rawState && rawState.config && rawState.config.theme) || {}))
      }
    }
  };

  if (!Array.isArray(merged.accounts)) merged.accounts = defaults.accounts;
  merged.accounts = merged.accounts
    .filter((a) => a && a.username && a.password && ['admin', 'teacher'].includes(a.role))
    .map((a) => ({ username: String(a.username).trim(), password: String(a.password), role: a.role }));

  if (!merged.accounts.some((a) => a.username === 'admin')) merged.accounts.push(defaults.accounts[0]);
  if (!merged.accounts.some((a) => a.role === 'teacher')) merged.accounts.push(defaults.accounts[1]);

  if (!Array.isArray(merged.tickets)) {
    const pendingNumbers = Array.isArray(rawState?.pendingNumbers) ? rawState.pendingNumbers : [];
    const today = ymd();
    merged.tickets = pendingNumbers.map((num) => ({
      id: crypto.randomUUID(),
      serialNumber: `${merged.config.queuePrefix || 'BM'}${today}-${String(num).padStart(3, '0')}`,
      shortCode: `${merged.config.shortPrefix || 'A'}${String(num).padStart(3, '0')}`,
      sequence: num,
      queueDate: today,
      status: TICKET_STATUS.WAITING,
      ticketAt: new Date().toISOString(),
      callCount: 0,
      businessType: merged.config.businessTypes?.[0] || '新生报名',
      counterNumber: null,
      studentName: '',
      phone: '',
      updatedAt: new Date().toISOString()
    }));
  }

  if (!Array.isArray(merged.calledRecords)) merged.calledRecords = [];
  if (!merged.sequenceByDay || typeof merged.sequenceByDay !== 'object') merged.sequenceByDay = { [ymd()]: merged.tickets.length };

  merged.config.queuePrefix = String(merged.config.queuePrefix || 'BM').slice(0, 6);
  merged.config.shortPrefix = String(merged.config.shortPrefix || 'A').slice(0, 2);
  if (!Number.isInteger(merged.config.voiceRepeat) || merged.config.voiceRepeat < 1 || merged.config.voiceRepeat > 10) merged.config.voiceRepeat = 2;
  if (!Number.isInteger(merged.config.hallRecordLimit) || merged.config.hallRecordLimit < 1 || merged.config.hallRecordLimit > 100) merged.config.hallRecordLimit = 20;
  if (!Number.isInteger(merged.config.maxCounterNumber) || merged.config.maxCounterNumber < 1 || merged.config.maxCounterNumber > 100) merged.config.maxCounterNumber = 6;
  merged.config.allowRepeatTakeByPhone = Boolean(merged.config.allowRepeatTakeByPhone);
  merged.config.businessTypes = Array.isArray(merged.config.businessTypes)
    ? merged.config.businessTypes.map((s) => String(s).trim()).filter(Boolean).slice(0, 30)
    : defaults.config.businessTypes;
  if (!merged.config.businessTypes.length) merged.config.businessTypes = defaults.config.businessTypes;
  merged.config.teacherPool = Array.isArray(merged.config.teacherPool)
    ? merged.config.teacherPool.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
    : defaults.config.teacherPool;

  const cleanedCounters = {};
  Object.entries(merged.config.counters || {}).forEach(([key, value]) => {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > merged.config.maxCounterNumber || !Array.isArray(value)) return;
    cleanedCounters[String(n)] = value.map((t) => String(t).trim()).filter(Boolean).slice(0, 2);
  });
  merged.config.counters = cleanedCounters;

  merged.tickets = merged.tickets.map((ticket) => ({
    id: ticket.id || crypto.randomUUID(),
    serialNumber: String(ticket.serialNumber || ''),
    shortCode: String(ticket.shortCode || ''),
    sequence: Number(ticket.sequence) || 0,
    queueDate: String(ticket.queueDate || ymd()),
    status: Object.values(TICKET_STATUS).includes(ticket.status) ? ticket.status : TICKET_STATUS.WAITING,
    ticketAt: ticket.ticketAt || new Date().toISOString(),
    callCount: Number(ticket.callCount) || 0,
    businessType: String(ticket.businessType || merged.config.businessTypes[0]),
    counterNumber: Number.isInteger(ticket.counterNumber) ? ticket.counterNumber : null,
    studentName: String(ticket.studentName || ''),
    phone: String(ticket.phone || ''),
    note: String(ticket.note || ''),
    handledBy: String(ticket.handledBy || ''),
    callAt: ticket.callAt || null,
    beginAt: ticket.beginAt || null,
    finishAt: ticket.finishAt || null,
    updatedAt: ticket.updatedAt || ticket.ticketAt || new Date().toISOString()
  }));

  return merged;
}

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultState(), null, 2));
const rawState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
let state = migrateState(rawState);
if (JSON.stringify(state) !== JSON.stringify(rawState)) fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(
    cookie
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((item) => {
        const i = item.indexOf('=');
        return [item.slice(0, i), decodeURIComponent(item.slice(i + 1))];
      })
  );
}

function getUser(req) {
  const token = parseCookies(req).token;
  return token && sessions.has(token) ? { ...sessions.get(token), token } : null;
}

function pushEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) c.write(payload);
}

function todayQueue() {
  const today = ymd();
  return state.tickets.filter((t) => t.queueDate === today);
}

function waitingQueue() {
  return todayQueue()
    .filter((t) => [TICKET_STATUS.WAITING, TICKET_STATUS.ABSENT].includes(t.status))
    .sort((a, b) => a.sequence - b.sequence);
}

function calledByCounter(counterNumber) {
  return [...state.calledRecords]
    .reverse()
    .find((r) => r.counterNumber === counterNumber) || null;
}

function maskName(name) {
  const n = String(name || '').trim();
  if (!n) return '匿名同学';
  if (n.length === 1) return `${n}*`;
  return `${n.slice(0, 1)}${'*'.repeat(n.length - 1)}`;
}

function publicState() {
  const queue = waitingQueue();
  return {
    config: state.config,
    pendingCount: queue.length,
    nextTicket: queue[0]
      ? { shortCode: queue[0].shortCode, serialNumber: queue[0].serialNumber, businessType: queue[0].businessType }
      : null,
    activeCalls: Array.from({ length: state.config.maxCounterNumber }, (_, i) => i + 1)
      .map((counterNumber) => {
        const latest = calledByCounter(counterNumber);
        if (!latest) return null;
        return {
          counterNumber,
          shortCode: latest.shortCode,
          serialNumber: latest.serialNumber,
          studentNameMasked: latest.studentNameMasked,
          calledAt: latest.calledAt
        };
      })
      .filter(Boolean),
    calledRecords: state.calledRecords.slice(-state.config.hallRecordLimit)
  };
}

function getTicketById(id) {
  return state.tickets.find((t) => t.id === id);
}

function generateTicket(payload) {
  const today = ymd();
  const nextSeq = (state.sequenceByDay[today] || 0) + 1;
  state.sequenceByDay[today] = nextSeq;
  const serialNumber = `${state.config.queuePrefix}${today}-${String(nextSeq).padStart(3, '0')}`;
  const shortCode = `${state.config.shortPrefix}${String(nextSeq).padStart(3, '0')}`;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    serialNumber,
    shortCode,
    sequence: nextSeq,
    queueDate: today,
    status: TICKET_STATUS.WAITING,
    ticketAt: now,
    callCount: 0,
    businessType: payload.businessType,
    counterNumber: null,
    studentName: payload.studentName,
    phone: payload.phone,
    note: payload.note,
    handledBy: '',
    callAt: null,
    beginAt: null,
    finishAt: null,
    updatedAt: now
  };
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath);
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };
  res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/login') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const account = state.accounts.find((a) => a.username === username && a.password === password);
      if (!account) return json(res, 401, { error: '账号或密码错误' });
      const token = crypto.randomUUID();
      sessions.set(token, { username: account.username, role: account.role });
      return json(res, 200, { username: account.username, role: account.role }, { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Lax` });
    }

    if (req.method === 'GET' && req.url === '/api/public/state') return json(res, 200, publicState());

    if (req.method === 'POST' && req.url === '/api/public/take-ticket') {
      const body = await parseBody(req);
      const studentName = String(body.studentName || '').trim();
      const phone = String(body.phone || '').trim();
      const note = String(body.note || '').trim();
      const businessType = String(body.businessType || state.config.businessTypes[0]).trim();
      if (!state.config.businessTypes.includes(businessType)) return json(res, 400, { error: '报名类型无效' });

      if (!state.config.allowRepeatTakeByPhone && phone) {
        const exists = todayQueue().find((t) => t.phone && t.phone === phone && ![TICKET_STATUS.COMPLETED, TICKET_STATUS.CANCELLED].includes(t.status));
        if (exists) {
          return json(res, 400, {
            error: '该手机号已存在有效排队号',
            existing: { id: exists.id, shortCode: exists.shortCode, serialNumber: exists.serialNumber, status: exists.status }
          });
        }
      }

      const ticket = generateTicket({ studentName, phone, note, businessType });
      state.tickets.push(ticket);
      saveState();
      pushEvent('state', publicState());
      return json(res, 200, {
        ...ticket,
        aheadCount: waitingQueue().filter((t) => t.sequence < ticket.sequence).length
      });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/public/ticket/')) {
      const id = req.url.split('/').pop();
      const ticket = getTicketById(id);
      if (!ticket) return json(res, 404, { error: '未找到该取号记录' });
      const aheadCount = waitingQueue().filter((t) => t.sequence < ticket.sequence).length;
      return json(res, 200, { ...ticket, aheadCount, publicState: publicState() });
    }

    if (req.url.startsWith('/api/')) {
      const user = getUser(req);
      if (!user) return json(res, 401, { error: '未登录' });

      if (req.method === 'POST' && req.url === '/api/logout') {
        sessions.delete(user.token);
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
      }
      if (req.method === 'GET' && req.url === '/api/me') return json(res, 200, { username: user.username, role: user.role });
      if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, publicState());

      if (req.method === 'GET' && req.url === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/api/teacher/queue')) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const counterNumber = Number(url.searchParams.get('counter'));
        const queue = waitingQueue();
        return json(res, 200, {
          counterNumber: Number.isInteger(counterNumber) ? counterNumber : null,
          queue: queue.map((t) => ({ id: t.id, shortCode: t.shortCode, businessType: t.businessType, status: t.status, ticketAt: t.ticketAt })),
          current: Number.isInteger(counterNumber) ? calledByCounter(counterNumber) : null
        });
      }

      if (req.method === 'POST' && req.url === '/api/teacher/call-next') {
        const body = await parseBody(req);
        const counterNumber = Number(body.counterNumber);
        if (!Number.isInteger(counterNumber) || counterNumber < 1 || counterNumber > state.config.maxCounterNumber) {
          return json(res, 400, { error: `登记处编号必须是1-${state.config.maxCounterNumber}` });
        }
        const next = waitingQueue()[0];
        if (!next) return json(res, 400, { error: '当前无待叫号学生' });

        next.status = TICKET_STATUS.CALLED;
        next.counterNumber = counterNumber;
        next.callCount += 1;
        next.callAt = new Date().toISOString();
        next.updatedAt = next.callAt;
        next.handledBy = user.username;

        const record = {
          ticketId: next.id,
          shortCode: next.shortCode,
          serialNumber: next.serialNumber,
          businessType: next.businessType,
          counterNumber,
          studentNameMasked: maskName(next.studentName),
          calledAt: next.callAt,
          teachers: state.config.counters[String(counterNumber)] || [],
          by: user.username
        };
        state.calledRecords.push(record);
        if (state.calledRecords.length > 2000) state.calledRecords = state.calledRecords.slice(-2000);
        saveState();
        pushEvent('state', publicState());
        pushEvent('called', { ...publicState(), latestRecord: record });
        return json(res, 200, record);
      }

      if (req.method === 'POST' && req.url === '/api/teacher/recall') {
        const body = await parseBody(req);
        const ticket = getTicketById(String(body.ticketId || ''));
        if (!ticket) return json(res, 404, { error: '号码不存在' });
        if (![TICKET_STATUS.CALLED, TICKET_STATUS.ABSENT].includes(ticket.status)) return json(res, 400, { error: '该号码当前不可重呼' });

        ticket.status = TICKET_STATUS.CALLED;
        ticket.callCount += 1;
        ticket.callAt = new Date().toISOString();
        ticket.updatedAt = ticket.callAt;
        saveState();
        pushEvent('state', publicState());
        return json(res, 200, { ok: true, ticket });
      }

      if (req.method === 'POST' && req.url === '/api/teacher/update-status') {
        const body = await parseBody(req);
        const ticket = getTicketById(String(body.ticketId || ''));
        const status = String(body.status || '');
        if (!ticket) return json(res, 404, { error: '号码不存在' });
        if (![TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.COMPLETED, TICKET_STATUS.ABSENT, TICKET_STATUS.CANCELLED, TICKET_STATUS.EXCEPTION, TICKET_STATUS.WAITING].includes(status)) {
          return json(res, 400, { error: '状态不支持' });
        }

        ticket.status = status;
        ticket.note = String(body.note || ticket.note || '');
        ticket.updatedAt = new Date().toISOString();
        ticket.handledBy = user.username;
        if (status === TICKET_STATUS.IN_PROGRESS && !ticket.beginAt) ticket.beginAt = ticket.updatedAt;
        if (status === TICKET_STATUS.COMPLETED) ticket.finishAt = ticket.updatedAt;
        if (status === TICKET_STATUS.WAITING) ticket.counterNumber = null;

        saveState();
        pushEvent('state', publicState());
        return json(res, 200, { ok: true, ticket });
      }

      if (user.role !== 'admin') return json(res, 403, { error: '无权限' });

      if (req.method === 'GET' && req.url === '/api/admin/tickets') {
        return json(res, 200, state.tickets.slice().reverse());
      }

      if (req.method === 'POST' && req.url === '/api/admin/config') {
        const body = await parseBody(req);
        const hallRecordLimit = Number(body.hallRecordLimit);
        const voiceRepeat = Number(body.voiceRepeat);
        const maxCounterNumber = Number(body.maxCounterNumber);
        const titleFontSize = Number(body.theme?.titleFontSize);

        if (!body.systemName) return json(res, 400, { error: '系统名称不能为空' });
        if (!Number.isInteger(hallRecordLimit) || hallRecordLimit < 1 || hallRecordLimit > 100) return json(res, 400, { error: '大屏记录条数需在1-100' });
        if (!Number.isInteger(voiceRepeat) || voiceRepeat < 1 || voiceRepeat > 10) return json(res, 400, { error: '语音播报次数需在1-10' });
        if (!Number.isInteger(maxCounterNumber) || maxCounterNumber < 1 || maxCounterNumber > 100) return json(res, 400, { error: '登记处数量需在1-100' });
        if (!Number.isInteger(titleFontSize) || titleFontSize < 20 || titleFontSize > 72) return json(res, 400, { error: '系统名称字号需在20-72' });
        if (!/^#[0-9a-fA-F]{6}$/.test(body.theme?.titleColor || '')) return json(res, 400, { error: '标题颜色格式错误' });

        const businessTypes = Array.isArray(body.businessTypes)
          ? body.businessTypes.map((b) => String(b).trim()).filter(Boolean).slice(0, 30)
          : [];
        if (!businessTypes.length) return json(res, 400, { error: '至少保留一个报名类型' });

        state.config = {
          ...state.config,
          systemName: String(body.systemName).trim(),
          queuePrefix: String(body.queuePrefix || state.config.queuePrefix).trim() || 'BM',
          shortPrefix: String(body.shortPrefix || state.config.shortPrefix).trim() || 'A',
          hallRecordLimit,
          voiceRepeat,
          maxCounterNumber,
          allowRepeatTakeByPhone: Boolean(body.allowRepeatTakeByPhone),
          businessTypes,
          theme: {
            fontFamily: String(body.theme.fontFamily || 'Microsoft YaHei').trim() || 'Microsoft YaHei',
            titleFontSize,
            titleColor: body.theme.titleColor
          },
          teacherPool: Array.isArray(body.teacherPool)
            ? [...new Set(body.teacherPool.map((t) => String(t).trim()).filter(Boolean))].slice(0, 200)
            : state.config.teacherPool,
          counters: body.counters || {}
        };

        saveState();
        pushEvent('state', publicState());
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && req.url === '/api/admin/accounts') return json(res, 200, state.accounts.map(({ password, ...rest }) => rest));

      if (req.method === 'POST' && req.url === '/api/admin/accounts') {
        const body = await parseBody(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const role = String(body.role || 'teacher');
        if (!username || !password || !['admin', 'teacher'].includes(role)) return json(res, 400, { error: '参数错误' });
        const found = state.accounts.find((a) => a.username === username);
        if (found) {
          found.password = password;
          found.role = role;
        } else {
          state.accounts.push({ username, password, role });
        }
        saveState();
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: '接口不存在' });
    }

    if (!serveStatic(req, res)) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(index, 'utf8'));
    }
  } catch (error) {
    json(res, 500, { error: error.message || '服务错误' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
