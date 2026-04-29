/* ============================
   OIL PULSE — server.js
   로컬 프록시 서버
   실행: node server.js
   ============================ */

require('dotenv').config();
const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── API 키 설정 ──────────────────────────────────────────
const KEYS = {
  claude: {
    apiKey:  process.env.CLAUDE_API_KEY || '',
    model:   'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com',
  },
  naver: {
    clientId:     process.env.NAVER_CLIENT_ID     || 'LDuaU_BsVKq7vhG7uYRQ',
    clientSecret: process.env.NAVER_CLIENT_SECRET || 'y4naSnDw5r',
    baseUrl:      'https://openapi.naver.com',
  },
};

// ── 정적 파일 서빙 (index.html, style.css, app.js) ───────
app.use(express.static(path.join(__dirname)));

// ── Naver 뉴스 API 프록시 ────────────────────────────────
// GET /api/naver/news?query=국제유가&display=5&sort=date
app.get('/api/naver/news', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const url = `${KEYS.naver.baseUrl}/v1/search/news.json?${params}`;

    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id':     KEYS.naver.clientId,
        'X-Naver-Client-Secret': KEYS.naver.clientSecret,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }
    res.json(data);
  } catch (err) {
    console.error('[Naver API Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Claude API 프록시 ────────────────────────────────────
// POST /api/claude/messages  (body = Claude messages request body)
app.post('/api/claude/messages', async (req, res) => {
  if (KEYS.claude.apiKey === 'YOUR_CLAUDE_API_KEY') {
    return res.status(500).json({
      error: { message: 'Claude API 키가 설정되지 않았습니다. server.js의 KEYS.claude.apiKey를 입력해주세요.' },
    });
  }

  try {
    const response = await fetch(`${KEYS.claude.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         KEYS.claude.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[Claude API Error]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── 서버 시작 ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ██████╗ ██╗██╗     ██████╗ ██╗   ██╗██╗     ███████╗███████╗');
  console.log('  ██╔═══██╗██║██║     ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝');
  console.log('  ██║   ██║██║██║     ██████╔╝██║   ██║██║     ███████╗█████╗  ');
  console.log('  ██║   ██║██║██║     ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ');
  console.log('  ╚██████╔╝██║███████╗██║     ╚██████╔╝███████╗███████║███████╗');
  console.log('');
  console.log(`  ✅ OIL PULSE 서버 실행 중: http://localhost:${PORT}`);
  console.log(`  📰 Naver API: ${KEYS.naver.clientId ? '설정됨' : '⚠️  미설정'}`);
  console.log(`  🤖 Claude API: ${KEYS.claude.apiKey !== 'YOUR_CLAUDE_API_KEY' ? '설정됨' : '⚠️  미설정 (server.js에 키 입력 필요)'}`);
  console.log('');
});
