// 내 컴퓨터 미리보기 서버. 실행: node dev-server.js → http://localhost:3000
// .env.local 을 읽어 환경 변수로 쓰고, /api/judge 는 api/judge.js 로 처리한다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

// .env.local 읽기 (값은 출력하지 않는다)
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const judge = require('./api/judge');

// 보여 줘도 되는 파일만 내보낸다 (.env.local 등이 새지 않게).
const PUBLIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/data/defect-types.json': ['data/defect-types.json', 'application/json; charset=utf-8'],
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/judge') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch {
        req.body = {};
      }
      judge(req, res);
    });
    return;
  }

  const file = PUBLIC_FILES[url.pathname];
  if (!file) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', file[1]);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(ROOT, file[0])).pipe(res);
}).listen(PORT, 'localhost', () => {
  console.log(`미리보기 서버: http://localhost:${PORT}`);
  console.log(`모델: ${process.env.GEMINI_MODEL || '(비어 있음)'} / 키: ${process.env.GEMINI_API_KEY ? '있음' : '없음'}`);
});
