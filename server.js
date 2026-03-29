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
      rangeEnd: 1000,
      voiceRepeat: 2,
      counters: {}
    },
    accounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'user', password: 'user123', role: 'user' }
    ],
    pendingNumbers: Array.from({ length: 1000 }, (_, i) => i + 1),
    calledRecords: []
  };
}

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultState(), null, 2));
let state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

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

function findInsertIndex(arr, target) {
  let left = 0;
  let right = arr.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left;
}

function addPendingNumber(number) {
  const idx = findInsertIndex(state.pendingNumbers, number);
  if (state.pendingNumbers[idx] === number) return false;
  state.pendingNumbers.splice(idx, 0, number);
  return true;
}

normalizePending();

function publicState() {
  return {
    config: state.config,
    pendingCount: state.pendingNumbers.length,
    nextNumber: state.pendingNumbers[0] || null,
    calledRecords: state.calledRecords.slice(-20)
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
      const account = state.accounts.find((a) => a.username === body.username && a.password === body.password);
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
        if (!Number.isInteger(c) || c < 1 || c > 100) return json(res, 400, { error: '登记处编号必须是1-100' });
        const number = state.pendingNumbers.shift();
        if (!number) return json(res, 400, { error: '没有待叫号流水码' });
        const record = { number, counterNumber: c, teachers: state.config.counters[String(c)] || [], calledAt: new Date().toISOString(), by: user.username };
        state.calledRecords.push(record);
        if (state.calledRecords.length > 500) state.calledRecords = state.calledRecords.slice(-500);
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
        if (!body.systemName) return json(res, 400, { error: '系统名称不能为空' });
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 1000 || start > end) return json(res, 400, { error: '流水码区间必须在1-1000且起始小于结束' });
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) return json(res, 400, { error: '语音播报次数必须是1-10' });

        const cleanedCounters = {};
        Object.entries(body.counters || {}).forEach(([key, value]) => {
          const n = Number(key);
          if (Number.isInteger(n) && n >= 1 && n <= 100 && Array.isArray(value)) cleanedCounters[String(n)] = value.filter(Boolean).slice(0, 3);
        });

        state.config = { systemName: body.systemName, rangeStart: start, rangeEnd: end, voiceRepeat: repeat, counters: cleanedCounters };
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
        if (!Number.isInteger(number) || number < state.config.rangeStart || number > state.config.rangeEnd) return json(res, 400, { error: '号码不在当前配置区间内' });
        addPendingNumber(number);
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
