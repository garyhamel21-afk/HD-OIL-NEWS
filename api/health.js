// 환경변수 진단 엔드포인트 (키 앞 10자만 노출)
module.exports = function handler(req, res) {
  const key = process.env.CLAUDE_API_KEY || '';
  res.json({
    claude_key_set:    key.length > 0,
    claude_key_prefix: key.length > 0 ? key.slice(0, 15) + '...' : '(없음)',
    claude_key_length: key.length,
    naver_id_set:      !!process.env.NAVER_CLIENT_ID,
    node_env:          process.env.NODE_ENV || 'undefined',
  });
};
