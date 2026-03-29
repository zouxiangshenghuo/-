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

function createDefaultState() {
  return {
    config: {
      systemName: '新生报名叫号系统',
      rangeStart: 1,
      rangeEnd: 2000,
      voiceRepeat: 2,
      hallRecordLimit: 20,
      maxCounterNumber: 10,
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
      { username: 'user', password: 'user123', role: 'user' }
    ],
    pendingNumbers: Array.from({ length: 2000 }, (_, i) => i + 1),
    calledRecords: []
  };
}

function migrateState(rawState) {
  const defaults = createDefaultState();
  const rawConfig = rawState && rawState.config ? rawState.config : {};
  const merged = {
    ...defaults,
    ...rawState,
    config: {
      ...defaults.config,
      ...rawConfig,
      theme: {
        ...defaults.config.theme,
        ...(rawConfig.theme || {})
      },
      teacherPool: Array.isArray(rawConfig.teacherPool) ? rawConfig.teacherPool : defaults.config.teacherPool
    }
  };

  merged.accounts = Array.isArray(merged.accounts) ? merged.accounts : defaults.accounts;
  const normalizedAccounts = [];
  const accountMap = new Map();
  merged.accounts.forEach((account) => {
    if (!account || !account.username || !account.password || !['admin', 'user'].includes(account.role)) return;
    const username = String(account.username).trim();
    if (!username) return;
    if (accountMap.has(username)) return;
    accountMap.set(username, true);
    normalizedAccounts.push({ username, password: String(account.password), role: account.role });
  });
  if (!normalizedAccounts.find((a) => a.username === 'admin' && a.role === 'admin')) {
    normalizedAccounts.push({ username: 'admin', password: 'admin123', role: 'admin' });
  }
  if (!normalizedAccounts.find((a) => a.username === 'user')) {
    normalizedAccounts.push({ username: 'user', password: 'user123', role: 'user' });
  }
  merged.accounts = normalizedAccounts;
  merged.pendingNumbers = Array.isArray(merged.pendingNumbers) ? merged.pendingNumbers : defaults.pendingNumbers;
  merged.calledRecords = Array.isArray(merged.calledRecords) ? merged.calledRecords : [];

  if (!Number.isInteger(merged.config.rangeStart) || merged.config.rangeStart < 1) merged.config.rangeStart = 1;
  if (!Number.isInteger(merged.config.rangeEnd) || merged.config.rangeEnd > 2000) merged.config.rangeEnd = 2000;
  if (merged.config.rangeStart > merged.config.rangeEnd) merged.config.rangeStart = merged.config.rangeEnd;
  if (!Number.isInteger(merged.config.voiceRepeat) || merged.config.voiceRepeat < 1 || merged.config.voiceRepeat > 10) merged.config.voiceRepeat = 2;
  if (!Number.isInteger(merged.config.hallRecordLimit) || merged.config.hallRecordLimit < 1 || merged.config.hallRecordLimit > 100) merged.config.hallRecordLimit = 20;
  if (!Number.isInteger(merged.config.maxCounterNumber) || merged.config.maxCounterNumber < 1 || merged.config.maxCounterNumber > 100) merged.config.maxCounterNumber = 10;
  if (!merged.config.systemName || typeof merged.config.systemName !== 'string') merged.config.systemName = defaults.config.systemName;
  if (!merged.config.theme.fontFamily) merged.config.theme.fontFamily = defaults.config.theme.fontFamily;
  if (!Number.isInteger(merged.config.theme.titleFontSize) || merged.config.theme.titleFontSize < 20 || merged.config.theme.titleFontSize > 72) {
    merged.config.theme.titleFontSize = defaults.config.theme.titleFontSize;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(merged.config.theme.titleColor)) merged.config.theme.titleColor = defaults.config.theme.titleColor;
  merged.config.teacherPool = merged.config.teacherPool.map((t) => String(t).trim()).filter(Boolean).slice(0, 200);

  const cleanedCounters = {};
  Object.entries(merged.config.counters || {}).forEach(([key, teachers]) => {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > merged.config.maxCounterNumber) return;
    if (!Array.isArray(teachers)) return;
    cleanedCounters[String(n)] = teachers.map((t) => String(t).trim()).filter(Boolean).slice(0, 2);
  });
  merged.config.counters = cleanedCounters;

  return merged;
}

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultState(), null, 2));
const rawState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
let state = migrateState(rawState);
if (JSON.stringify(rawState) !== JSON.stringify(state)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
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

function normalizePending() {
  state.pendingNumbers = [...new Set(state.pendingNumbers)]
    .filter((n) => Number.isInteger(n) && n >= state.config.rangeStart && n <= state.config.rangeEnd)
    .sort((a, b) => a - b);
}

function publicState() {
  return {
    config: state.config,
    pendingCount: state.pendingNumbers.length,
    nextNumber: state.pendingNumbers[0] || null,
    calledRecords: state.calledRecords.slice(-state.config.hallRecordLimit)
  };
}

function pushEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
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
    if (req.method === 'GET' && req.url === '/api/events') {
      const user = getUser(req);
      if (!user) return json(res, 401, { error: '未登录' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

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

    if (req.url.startsWith('/api/')) {
      const user = getUser(req);
      if (!user) return json(res, 401, { error: '未登录' });

      if (req.method === 'POST' && req.url === '/api/logout') {
        sessions.delete(user.token);
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
      }
      if (req.method === 'GET' && req.url === '/api/me') return json(res, 200, { username: user.username, role: user.role });
      if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, publicState());

      if (req.method === 'POST' && req.url === '/api/call-next') {
        const body = await parseBody(req);
        const c = Number(body.counterNumber);
        if (!Number.isInteger(c) || c < 1 || c > state.config.maxCounterNumber) {
          return json(res, 400, { error: `登记处编号必须是1-${state.config.maxCounterNumber}` });
        }
        normalizePending();
        const number = state.pendingNumbers.shift();
        if (!number) return json(res, 400, { error: '没有待叫号流水码' });
        const record = { number, counterNumber: c, teachers: state.config.counters[String(c)] || [], calledAt: new Date().toISOString(), by: user.username };
        state.calledRecords.push(record);
        if (state.calledRecords.length > 1000) state.calledRecords = state.calledRecords.slice(-1000);
        saveState();
        pushEvent('state', publicState());
        pushEvent('called', { ...publicState(), latestRecord: record });
        return json(res, 200, record);
      }

      if (user.role !== 'admin') return json(res, 403, { error: '无权限' });

      if (req.method === 'POST' && req.url === '/api/admin/config') {
        const body = await parseBody(req);
        const start = Number(body.rangeStart);
        const end = Number(body.rangeEnd);
        const repeat = Number(body.voiceRepeat);
        const hallRecordLimit = Number(body.hallRecordLimit);
        const maxCounterNumber = Number(body.maxCounterNumber);
        const titleFontSize = Number(body.theme?.titleFontSize);
        const teacherPool = Array.isArray(body.teacherPool) ? body.teacherPool : [];

        if (!body.systemName) return json(res, 400, { error: '系统名称不能为空' });
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 2000 || start > end) {
          return json(res, 400, { error: '流水码区间必须在1-2000且起始小于结束' });
        }
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) return json(res, 400, { error: '语音播报次数必须是1-10' });
        if (!Number.isInteger(hallRecordLimit) || hallRecordLimit < 1 || hallRecordLimit > 100) {
          return json(res, 400, { error: '最近叫号记录显示条数必须在1-100' });
        }
        if (!Number.isInteger(maxCounterNumber) || maxCounterNumber < 1 || maxCounterNumber > 100) {
          return json(res, 400, { error: '登记处数量必须在1-100' });
        }
        if (!Number.isInteger(titleFontSize) || titleFontSize < 20 || titleFontSize > 72) {
          return json(res, 400, { error: '系统名称字号必须在20-72' });
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(body.theme?.titleColor || '')) {
          return json(res, 400, { error: '系统名称颜色必须是16进制格式（例如 #0f4aa8）' });
        }
        const cleanedTeacherPool = [...new Set(teacherPool.map((t) => String(t).trim()).filter(Boolean))].slice(0, 200);
        if (!cleanedTeacherPool.length) return json(res, 400, { error: '老师名单不能为空' });

        const cleanedCounters = {};
        Object.entries(body.counters || {}).forEach(([key, value]) => {
          const n = Number(key);
          if (Number.isInteger(n) && n >= 1 && n <= maxCounterNumber && Array.isArray(value)) {
            cleanedCounters[String(n)] = value
              .map((v) => String(v).trim())
              .filter((v) => cleanedTeacherPool.includes(v))
              .slice(0, 2);
          }
        });

        state.config = {
          systemName: body.systemName,
          rangeStart: start,
          rangeEnd: end,
          voiceRepeat: repeat,
          hallRecordLimit,
          maxCounterNumber,
          theme: {
            fontFamily: String(body.theme.fontFamily || 'Microsoft YaHei').trim() || 'Microsoft YaHei',
            titleFontSize,
            titleColor: body.theme.titleColor
          },
          teacherPool: cleanedTeacherPool,
          counters: cleanedCounters
        };
        state.pendingNumbers = state.pendingNumbers.filter((n) => n >= start && n <= end);
        if (!state.pendingNumbers.length) state.pendingNumbers = Array.from({ length: end - start + 1 }, (_, i) => i + start);
        normalizePending();
        saveState();
        pushEvent('state', publicState());
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && req.url === '/api/admin/add-number') {
        const body = await parseBody(req);
        const number = Number(body.number);
        if (!Number.isInteger(number) || number < state.config.rangeStart || number > state.config.rangeEnd) {
          return json(res, 400, { error: '号码不在当前配置区间内' });
        }
        state.pendingNumbers.push(number);
        normalizePending();
        saveState();
        pushEvent('state', publicState());
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && req.url === '/api/admin/accounts') return json(res, 200, state.accounts.map(({ password, ...rest }) => rest));

      if (req.method === 'POST' && req.url === '/api/admin/accounts') {
        const body = await parseBody(req);
        if (!body.username || !body.password || !['admin', 'user'].includes(body.role)) return json(res, 400, { error: '参数错误' });
        const existed = state.accounts.find((a) => a.username === body.username);
        if (existed) {
          existed.password = body.password;
          existed.role = body.role;
        } else {
          state.accounts.push({ username: body.username, password: body.password, role: body.role });
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
