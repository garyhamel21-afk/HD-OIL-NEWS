// Vercel Serverless Function — Claude API 프록시
module.exports = async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY
    || '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';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         CLAUDE_API_KEY,
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
};
