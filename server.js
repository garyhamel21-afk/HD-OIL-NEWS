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
  supabase: {
    url:     process.env.SUPABASE_URL      || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    table:   'clips',
  },
};

// ── 정적 파일 서빙 (index.html, style.css, app.js) ───────
app.use(express.static(path.join(__dirname)));

// ── 로컬 인메모리 캐시 (20분) ────────────────────────────
const naverCache = new Map();
const CACHE_TTL  = 20 * 60 * 1000;

// ── Naver 뉴스 API 프록시 ────────────────────────────────
app.get('/api/naver/news', async (req, res) => {
  const cacheKey = JSON.stringify(req.query);
  const cached   = naverCache.get(cacheKey);

  // 캐시 히트: 즉시 반환
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

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
    if (!response.ok) return res.status(response.status).json({ error: data });

    naverCache.set(cacheKey, { data, ts: Date.now() });
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

// ── Supabase 클립 저장 (POST /api/clips) ──────────────────
app.post('/api/clips', async (req, res) => {
  const { url, anonKey, table } = KEYS.supabase;
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Supabase 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)가 설정되지 않았습니다.' });
  }
  try {
    const response = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(req.body),
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[Supabase POST Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Supabase 클립 조회 (GET /api/clips?slot=7&date=2026-05-04) ──
app.get('/api/clips', async (req, res) => {
  const { url, anonKey, table } = KEYS.supabase;
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Supabase 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)가 설정되지 않았습니다.' });
  }

  const { slot, date } = req.query;
  if (!slot) return res.status(400).json({ error: 'slot 파라미터가 필요합니다.' });

  const targetDate = date || getTodayKST();

  // clip_date (KST 날짜 문자열) 기준 필터링 + time_slot
  const params = new URLSearchParams({
    time_slot: `eq.${slot}`,
    clip_date:  `eq.${targetDate}`,
    order:      'fetched_at.desc',
    limit:      '1',
  });

  try {
    const response = await fetch(`${url}/rest/v1/${table}?${params}`, {
      headers: {
        'apikey':        anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    res.json(data.length > 0 ? data[0] : null);
  } catch (err) {
    console.error('[Supabase GET Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// KST(UTC+9) 기준 오늘 날짜 반환 (YYYY-MM-DD)
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

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
  console.log(`  🤖 Claude API: ${KEYS.claude.apiKey ? '설정됨' : '⚠️  미설정 (.env에 CLAUDE_API_KEY 입력 필요)'}`);
  console.log(`  🗄️  Supabase: ${KEYS.supabase.url ? '설정됨' : '⚠️  미설정 (.env에 SUPABASE_URL, SUPABASE_ANON_KEY 입력 필요)'}`);
  console.log('');
});
