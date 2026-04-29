// Vercel Serverless Function — Naver News API 프록시
module.exports = async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const NAVER_CLIENT_ID     = process.env.NAVER_CLIENT_ID     || 'LDuaU_BsVKq7vhG7uYRQ';
  const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'y4naSnDw5r';

  try {
    const params = new URLSearchParams(req.query);
    const url = `https://openapi.naver.com/v1/search/news.json?${params}`;

    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id':     NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[Naver API Error]', err.message);
    res.status(500).json({ error: err.message });
  }
};
