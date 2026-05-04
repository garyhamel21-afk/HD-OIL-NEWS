// Vercel Serverless Function — YouTube 유류/에너지 영상 조회
// GET /api/youtube  →  조회수 높은 최신 영상 5개 반환

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// 검색 키워드 (유류·에너지·정유 관련 YouTube 한국어 검색어)
const YT_KEYWORDS = ['국제유가 원유', '주유소 가격 휘발유', 'HD현대오일뱅크', 'OPEC 감산'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Vercel CDN에서 2시간 캐싱 (YouTube API 할당량 절약)
  res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({
      error: 'YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.',
    });
  }

  try {
    // 최근 30일 이내 영상만 검색
    const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 키워드별 검색 병렬 실행
    const searchResults = await Promise.allSettled(
      YT_KEYWORDS.map(kw => {
        const params = new URLSearchParams({
          part:              'snippet',
          q:                 kw,
          type:              'video',
          order:             'viewCount',
          publishedAfter,
          maxResults:        '8',
          regionCode:        'KR',
          relevanceLanguage: 'ko',
          key:               YOUTUBE_API_KEY,
        });
        return fetch(`${YT_BASE}/search?${params}`).then(r => r.json());
      })
    );

    // 중복 없이 videoId + snippet 수집
    const videoMap = new Map();
    for (const result of searchResults) {
      if (result.status !== 'fulfilled') continue;
      const items = result.value?.items || [];
      for (const item of items) {
        const id = item.id?.videoId;
        if (!id || videoMap.has(id)) continue;
        const s = item.snippet;
        videoMap.set(id, {
          id,
          title:       s.title,
          channel:     s.channelTitle,
          thumbnail:   s.thumbnails?.medium?.url || s.thumbnails?.default?.url || '',
          publishedAt: s.publishedAt,
          url:         `https://www.youtube.com/watch?v=${id}`,
          viewCount:   0,
        });
      }
    }

    if (videoMap.size === 0) {
      return res.status(200).json([]);
    }

    // 수집된 영상들의 조회수 일괄 조회
    const ids    = [...videoMap.keys()].slice(0, 50).join(',');
    const statsParams = new URLSearchParams({
      part: 'statistics',
      id:   ids,
      key:  YOUTUBE_API_KEY,
    });
    const statsRes  = await fetch(`${YT_BASE}/videos?${statsParams}`);
    const statsData = await statsRes.json();

    for (const item of (statsData.items || [])) {
      const video = videoMap.get(item.id);
      if (video) video.viewCount = parseInt(item.statistics?.viewCount || '0', 10);
    }

    // 조회수 내림차순 정렬 후 상위 5개 반환
    const top5 = [...videoMap.values()]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 5);

    return res.status(200).json(top5);
  } catch (err) {
    console.error('[YouTube API Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
