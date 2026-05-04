// Vercel Serverless Function — Supabase 클립 히스토리 프록시
// GET  /api/clips?slot=7&date=2026-05-04  → 당일 해당 슬롯 클립 조회
// POST /api/clips                          → 클립 저장

const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TABLE             = 'clips';

// KST(UTC+9) 기준 오늘 날짜 반환 (YYYY-MM-DD)
function getTodayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: 'Supabase 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)가 Vercel에 설정되지 않았습니다.',
    });
  }

  const supabaseHeaders = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
  };

  // ── GET: 당일 해당 슬롯 클립 조회 ──────────────────────
  if (req.method === 'GET') {
    const { slot, date } = req.query;
    if (!slot) return res.status(400).json({ error: 'slot 파라미터가 필요합니다.' });

    const targetDate = date || getTodayKST();
    const params = new URLSearchParams({
      time_slot: `eq.${slot}`,
      clip_date:  `eq.${targetDate}`,
      order:      'fetched_at.desc',
      limit:      '1',
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${params}`, {
        headers: supabaseHeaders,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Supabase GET Error]', response.status, errText);
        return res.status(response.status).json({ error: errText });
      }

      const data = await response.json();
      return res.status(200).json(data.length > 0 ? data[0] : null);
    } catch (err) {
      console.error('[Supabase GET Exception]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: 클립 저장 ──────────────────────────────────
  if (req.method === 'POST') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Supabase POST Error]', response.status, errText);
        return res.status(response.status).json({ error: errText });
      }

      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[Supabase POST Exception]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
