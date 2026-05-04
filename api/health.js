// 환경변수 진단 엔드포인트 (키 앞 일부만 노출)
module.exports = function handler(req, res) {
  const claudeKey   = process.env.CLAUDE_API_KEY      || '';
  const supabaseUrl = process.env.SUPABASE_URL         || '';
  const supabaseKey = process.env.SUPABASE_ANON_KEY    || '';
  res.json({
    claude_key_set:     claudeKey.length > 0,
    claude_key_prefix:  claudeKey.length > 0 ? claudeKey.slice(0, 15) + '...' : '(없음)',
    naver_id_set:       !!process.env.NAVER_CLIENT_ID,
    supabase_url_set:   supabaseUrl.length > 0,
    supabase_url:       supabaseUrl || '(없음)',
    supabase_key_set:   supabaseKey.length > 0,
    supabase_key_prefix: supabaseKey.length > 0 ? supabaseKey.slice(0, 20) + '...' : '(없음)',
    node_env:           process.env.NODE_ENV || 'undefined',
  });
};
