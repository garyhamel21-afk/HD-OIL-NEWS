/* ============================
   OIL PULSE — app.js
   네이버 뉴스 API + Claude AI 브리핑 + Supabase 클리핑 DB
   ============================ */

// ── 설정 ──────────────────────────────────────────────
const CONFIG = {
  updateHours: [7, 11, 15, 19],
  maxNews: 30,
  cacheKey: 'oilpulse_cache',
  cacheExpiry: 3.5 * 60 * 60 * 1000,
  model: 'claude-sonnet-4-6',
  briefingModel: 'claude-haiku-4-5-20251001',

  naver: {
    endpoint: '/api/naver/news',
    display:  10,
  },

  clips: {
    endpoint: '/api/clips',  // server.js 프록시 (Supabase 키는 서버에서 관리)
  },
};

// ── 네이버 검색 키워드 ────────────────────────────────
const NAVER_KEYWORDS = [
  '국제유가', 'WTI 유가', '브렌트유 두바이유',
  'HD현대오일뱅크', '주유소 휘발유 가격', '주유소 경유 가격',
  '유류세', 'OPEC 감산', '정유사 실적',
  '알뜰주유소', '전기차 충전 에너지', '수소충전소',
];

// ── 카테고리 분류 기준 ─────────────────────────────────
const CATEGORY_RULES = [
  { tag: 'price',    keywords: ['유가','WTI','브렌트','두바이','정제마진','오피넷','환율','원유 가격','휘발유 가격','경유 가격','OPEC'] },
  { tag: 'company',  keywords: ['오일뱅크','SK에너지','GS칼텍스','에쓰오일','정유사','정유업계','실적'] },
  { tag: 'station',  keywords: ['주유소','알뜰주유소','셀프주유소','농협주유소'] },
  { tag: 'policy',   keywords: ['유류세','수입부과금','석유사업법','탄소중립','규제','정책','대기환경'] },
  { tag: 'mobility', keywords: ['전기차','수소차','수소충전소','EV','충전','모빌리티'] },
];

// ── 상태 ───────────────────────────────────────────────
let allNews      = [];
let filteredNews = [];
let currentFilter = 'all';
let viewingClipSlot = null;   // 현재 조회 중인 타임슬롯 (null = 최신 라이브)

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  highlightCurrentUpdateTime();
  updateLastUpdatedDisplay();
  setupFilterButtons();
  setupTimeChips();
  setupAutoRefresh();

  const cached = loadCache();
  if (cached) {
    renderAll(cached.news, cached.briefing, cached.fetchedAt);
  } else {
    fetchNews();
  }
});

// ── 업데이트 시간 강조 ──────────────────────────────────
function highlightCurrentUpdateTime() {
  const h = new Date().getHours();
  const chipMap = { 7: 'chip-07', 11: 'chip-11', 15: 'chip-15', 19: 'chip-19' };
  let latest = null;
  CONFIG.updateHours.forEach(hour => { if (h >= hour) latest = hour; });

  // 현재 시간 외 .active 제거
  Object.values(chipMap).forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('selected')) el.classList.remove('active');
  });

  if (latest !== null) {
    const chip = document.getElementById(chipMap[latest]);
    if (chip && !chip.classList.contains('selected')) chip.classList.add('active');
  }
}

// ── 시간 칩 클릭 핸들러 설정 ────────────────────────────
function setupTimeChips() {
  const chipMap  = { 7: 'chip-07', 11: 'chip-11', 15: 'chip-15', 19: 'chip-19' };
  const prevHour = { 7: 0, 11: 7, 15: 11, 19: 15 };  // 각 슬롯의 시작 시간
  CONFIG.updateHours.forEach(slot => {
    const chip = document.getElementById(chipMap[slot]);
    if (!chip) return;
    const from = String(prevHour[slot]).padStart(2, '0');
    const to   = String(slot).padStart(2, '0');
    chip.title = `${from}:00 ~ ${to}:00 뉴스 클리핑 보기`;
    chip.addEventListener('click', () => handleTimeChipClick(slot));
  });
}

// ── 시간 칩 클릭: Supabase에서 해당 슬롯 데이터 로드 (없으면 자동 클리핑) ──
async function handleTimeChipClick(slot) {
  // 이미 선택된 슬롯 재클릭 시 라이브 뷰로 복귀
  if (viewingClipSlot === slot) {
    exitClipMode();
    return;
  }

  const chipMap  = { 7: 'chip-07', 11: 'chip-11', 15: 'chip-15', 19: 'chip-19' };
  const prevHour = { 7: 0, 11: 7, 15: 11, 19: 15 };
  const from = String(prevHour[slot] ?? 0).padStart(2, '0');
  const to   = String(slot).padStart(2, '0');

  // 선택 상태 업데이트
  Object.values(chipMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('selected', 'active');
  });
  const chip = document.getElementById(chipMap[slot]);
  if (chip) chip.classList.add('selected', 'loading');

  showLoading(
    `${to}:00 클리핑 확인 중...`,
    'Supabase에서 저장된 뉴스를 조회합니다'
  );

  try {
    const clip = await loadClipFromSupabase(slot);

    if (clip) {
      // ── 저장된 클립 있음 → 바로 표시 ──
      viewingClipSlot = slot;
      if (chip) chip.classList.remove('loading');
      renderAll(clip.news, clip.briefing, new Date(clip.fetched_at).getTime());
      setClipModeLabel(slot, clip.fetched_at);
      showToast(`${from}:00 ~ ${to}:00 클리핑 표시 중`);

    } else {
      // ── 저장된 클립 없음 → 지금 바로 수집·저장 ──
      showLoading(
        `${from}:00 ~ ${to}:00 뉴스 클리핑 중...`,
        '네이버에서 기사를 수집하고 AI가 정리합니다'
      );

      // ① 뉴스 수집
      const articles = await fetchAllNaverNews();

      // ② 브리핑(Haiku) + 큐레이션(Sonnet) 병렬 실행
      const [briefing, news] = await Promise.all([
        generateBriefing(articles).catch(() => ''),
        curateNewsWithClaude(articles).catch(() => articles.slice(0, CONFIG.maxNews)),
      ]);

      const fetchedAt = new Date().toISOString();

      // ③ Supabase에 해당 슬롯으로 저장 (비동기, 화면 차단 없음)
      saveClipToSupabase(news, briefing, slot);

      viewingClipSlot = slot;
      if (chip) chip.classList.remove('loading');

      renderAll(news, briefing, new Date(fetchedAt).getTime());
      setClipModeLabel(slot, fetchedAt);
      showToast(`${from}:00 ~ ${to}:00 뉴스 클리핑 완료`);
    }

  } catch (err) {
    console.error('클립 처리 오류:', err);
    showToast(err.message || '데이터 로드 중 오류가 발생했습니다', 5000);
    if (chip) chip.classList.remove('selected', 'loading');
    highlightCurrentUpdateTime();
    viewingClipSlot = null;
  } finally {
    hideLoading();
  }
}

// ── 클립 모드 해제 (라이브로 복귀) ──────────────────────
function exitClipMode() {
  viewingClipSlot = null;
  document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
  highlightCurrentUpdateTime();

  const label = document.getElementById('clip-mode-label');
  if (label) label.classList.remove('visible');

  const cached = loadCache();
  if (cached) {
    renderAll(cached.news, cached.briefing, cached.fetchedAt);
    showToast('최신 클리핑으로 돌아왔습니다');
  } else {
    fetchNews();
  }
}

// ── 클립 모드 레이블 표시 ───────────────────────────────
function setClipModeLabel(slot, fetchedAt) {
  const label = document.getElementById('clip-mode-label');
  if (!label) return;
  const prevHour = { 7: 0, 11: 7, 15: 11, 19: 15 };
  const d        = new Date(fetchedAt);
  const dateStr  = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const from     = String(prevHour[slot] ?? 0).padStart(2, '0');
  const to       = String(slot).padStart(2, '0');
  label.textContent = `${dateStr} ${from}:00 ~ ${to}:00 클리핑 보는 중`;
  label.classList.add('visible');
}

// ── 마지막 업데이트 표시 ────────────────────────────────
function updateLastUpdatedDisplay(dateStr) {
  const el = document.getElementById('last-updated-time');
  if (!el) return;
  if (dateStr) {
    el.textContent = dateStr;
  } else {
    const cached = loadCache();
    if (cached) el.textContent = formatTime(new Date(cached.fetchedAt));
  }
}

// ── 캐시 ───────────────────────────────────────────────
function saveCache(news, briefing) {
  const data = { news, briefing, fetchedAt: Date.now() };
  try { localStorage.setItem(CONFIG.cacheKey, JSON.stringify(data)); } catch(e) {}
  return data;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.cacheKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.fetchedAt > CONFIG.cacheExpiry) return null;
    return data;
  } catch(e) { return null; }
}

// ── 자동 새로고침 ───────────────────────────────────────
function setupAutoRefresh() {
  setInterval(() => {
    const now = new Date();
    if (CONFIG.updateHours.includes(now.getHours()) && now.getMinutes() === 0) {
      if (!viewingClipSlot) fetchNews();  // 클립 보기 중이면 자동 갱신 스킵
    }
    highlightCurrentUpdateTime();
  }, 60000);
}

// ── 필터 버튼 ───────────────────────────────────────────
function setupFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilter();
    });
  });
}

function applyFilter() {
  filteredNews = currentFilter === 'all' ? [...allNews] : allNews.filter(i => i.tag === currentFilter);
  renderNewsList(filteredNews);
  document.getElementById('news-count').textContent = filteredNews.length + ' 건';
}

// ── 메인 수집 함수 ─────────────────────────────────────
async function fetchNews() {
  const btn  = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  btn.disabled = true;
  icon.classList.add('spinning');

  // 클립 모드 상태 초기화
  const label = document.getElementById('clip-mode-label');
  if (label) label.classList.remove('visible');
  viewingClipSlot = null;

  try {
    showLoading('네이버 뉴스 검색 중...', '유류산업 키워드로 최신 기사를 수집합니다');
    const articles = await fetchAllNaverNews();

    // ① 네이버 수집 즉시 화면 표시 (Claude 대기 없음)
    hideLoading();
    renderRawArticles(articles);
    showBriefingLoading();

    // ② 두 개의 Claude 호출을 병렬 실행
    //    - 브리핑 (Haiku, 빠름) → 도착 즉시 화면 반영
    //    - 뉴스 큐레이션 (Sonnet, 정확도) → 백그라운드 진행
    const briefingPromise = generateBriefing(articles);
    const curationPromise = curateNewsWithClaude(articles);

    // 브리핑이 먼저 완성되면 곧바로 표시
    briefingPromise
      .then(briefing => renderBriefing(briefing, Date.now()))
      .catch(err => {
        console.warn('브리핑 생성 실패:', err.message);
        const body = document.getElementById('briefing-body');
        if (body) body.innerHTML =
          '<p style="color:var(--text3);font-size:13px;padding:8px 0;">브리핑 생성에 실패했습니다.</p>';
      });

    // 두 호출 모두 완료되면 캐시·Supabase 저장 및 최종 리렌더
    const briefing = await briefingPromise.catch(() => '');
    const news     = await curationPromise.catch(() => articles.slice(0, CONFIG.maxNews));

    const cacheData = saveCache(news, briefing);
    renderAll(news, briefing, cacheData.fetchedAt);

    // Supabase 저장은 렌더링과 병렬로 실행 (로딩 차단 없음)
    const slot = getCurrentTimeSlot();
    if (slot !== null) saveClipToSupabase(news, briefing, slot);

  } catch (err) {
    console.error('fetchNews error:', err);
    renderError(err.message);
  } finally {
    hideLoading();
    btn.disabled = false;
    icon.classList.remove('spinning');
  }
}

// ── 현재 타임슬롯 계산 ──────────────────────────────────
function getCurrentTimeSlot() {
  const h = new Date().getHours();
  let slot = null;
  CONFIG.updateHours.forEach(hour => { if (h >= hour) slot = hour; });
  return slot;
}

// ── KST 기준 오늘 날짜 (YYYY-MM-DD) ──────────────────
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ── Supabase: 클립 저장 (서버 프록시 경유) ─────────────
async function saveClipToSupabase(news, briefing, timeSlot) {
  try {
    const res = await fetch(CONFIG.clips.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time_slot:  timeSlot,
        clip_date:  getTodayKST(),
        news:       news,
        briefing:   briefing,
        fetched_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('클립 저장 오류:', err.error || res.status);
    } else {
      console.log(`${String(timeSlot).padStart(2,'0')}:00 클립 저장 완료 (${getTodayKST()})`);
    }
  } catch (e) {
    console.error('클립 저장 실패:', e);
  }
}

// ── Supabase: 당일 해당 슬롯 클립 조회 (서버 프록시 경유) ──
async function loadClipFromSupabase(timeSlot) {
  const params = new URLSearchParams({
    slot: timeSlot,
    date: getTodayKST(),
  });
  const res = await fetch(`${CONFIG.clips.endpoint}?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `클립 조회 오류: ${res.status}`);
  }
  return res.json();   // null 또는 clip 객체
}

// ── 네이버 뉴스 API 호출 (server.js 프록시 경유) ────────
async function fetchNaverNews(query) {
  const url = `${CONFIG.naver.endpoint}?${new URLSearchParams({
    query,
    display: CONFIG.naver.display,
    sort: 'date',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Naver API ${res.status}`);
  return res.json();
}

// ── 모든 키워드 뉴스 병렬 수집 + 중복 제거 ──────────
async function fetchAllNaverNews() {
  // 모든 키워드를 동시에 호출 (순차 → 병렬, 5~7배 빠름)
  const responses = await Promise.allSettled(
    NAVER_KEYWORDS.map(kw => fetchNaverNews(kw))
  );

  const seen    = new Set();
  const results = [];

  responses.forEach((res, i) => {
    if (res.status === 'rejected') {
      console.warn(`네이버 검색 실패 [${NAVER_KEYWORDS[i]}]:`, res.reason?.message);
      return;
    }
    const items = res.value?.items;
    if (!items) return;

    for (const item of items) {
      const url = item.originallink || item.link;
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        title:       stripHtml(item.title),
        url,
        source:      extractSource(item.link),
        date:        formatNaverDate(item.pubDate),
        description: stripHtml(item.description),
        tag:         classifyTag(stripHtml(item.title) + ' ' + stripHtml(item.description)),
      });
    }
  });

  results.sort((a, b) => (b.date > a.date ? 1 : -1));
  return results.slice(0, 80);
}

// ── Claude(Haiku): 브리핑만 빠르게 생성 ──────────────────
//   - 헤드라인만 입력 → 토큰 절약
//   - max_tokens 1024 → 출력 짧음 (브리핑 길이는 200-400자 유지)
//   - Haiku 모델 → Sonnet 대비 응답 속도 약 3~5배 빠름
async function generateBriefing(articles) {
  const today   = new Date();
  const dateStr = today.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // 헤드라인 + 출처만 전달 (입력 토큰 최소화)
  const headlinesText = articles.slice(0, 30).map((a, i) =>
    `[${i + 1}] ${a.title} (${a.source})`
  ).join('\n');

  const systemPrompt =
`당신은 HD현대오일뱅크 영업사원을 보조하는 유류산업 뉴스 브리핑 AI입니다.
주어진 뉴스 헤드라인을 종합 분석해 한국어로 200-400자 분량의 일일 브리핑을 작성하세요.
- 핵심 수치(유가, 환율, 가격 등)는 <strong>으로 강조
- 자연스러운 단락 흐름 유지
- JSON·코드블록·따옴표 묶음 없이 순수 브리핑 본문만 출력`;

  const userPrompt = `${dateStr} 유류산업 뉴스 헤드라인:\n\n${headlinesText}\n\n위 뉴스를 종합한 200-400자 분량의 일일 브리핑을 작성해주세요.`;

  const response = await fetch('/api/claude/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      CONFIG.briefingModel,
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `브리핑 API 오류: ${response.status}`);
  }

  const data     = await response.json();
  const fullText = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

  // 혹시 모를 따옴표/코드블록 잔재 제거
  return fullText
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

// ── Claude(Sonnet): 뉴스 큐레이션만 정확하게 생성 ─────────
async function curateNewsWithClaude(articles) {
  const today   = new Date();
  const dateStr = today.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // 큐레이션은 URL 매칭이 필요하므로 description은 짧게라도 유지
  const articleText = articles.map((a, i) =>
    `[${i + 1}] ${a.title}\n출처:${a.source} 날짜:${a.date}\nURL:${a.url}`
  ).join('\n---\n');

  const systemPrompt =
`HD현대오일뱅크 유류산업 뉴스 큐레이션 AI. 순수 JSON만 반환 (코드블록 금지).
형식:
{"news":[{"id":1,"title":"제목","url":"URL","source":"언론사","date":"YYYY-MM-DD HH:mm","tag":"price|company|station|policy|mobility|general"}]}
태그: price=유가/환율, company=정유사, station=주유소, policy=유류세/정책, mobility=전기차/수소.
중복제거 후 반드시 정확히 30개를 선별해 반환. 30개 미만이면 general 태그로라도 채워서 30개를 맞출 것.`;

  const userPrompt = `${dateStr} 유류산업 뉴스:\n\n${articleText}\n\n정확히 30개 선별 후 JSON만 응답.`;

  const response = await fetch('/api/claude/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      CONFIG.model,
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `큐레이션 API 오류: ${response.status}`);
  }

  const data     = await response.json();
  const fullText = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed   = parseClaudeJson(fullText, articles);

  const urlMap = Object.fromEntries(articles.map(a => [a.title.slice(0, 20), a]));
  const news = parsed.news.map(item => ({
    ...item,
    url: item.url || urlMap[item.title?.slice(0, 20)]?.url || '#',
    tag: item.tag || classifyTag(item.title),
  }));

  return news.slice(0, CONFIG.maxNews);
}

// ── JSON 파서 (잘린 응답 복구 포함) ───────────────────
function parseClaudeJson(text, articles) {
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) throw new Error('응답에서 JSON을 찾을 수 없습니다.');

  // 1차: 정상 파싱 시도
  try {
    const parsed = JSON.parse(clean.slice(start));
    if (parsed.news && Array.isArray(parsed.news)) return parsed;
  } catch (_) { /* 잘린 경우 복구 시도 */ }

  // 2차: news 배열에서 완성된 객체만 추출
  const arrStart = clean.indexOf('[', clean.indexOf('"news"'));
  if (arrStart === -1) throw new Error('news 배열을 찾을 수 없습니다.');

  const items = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  const body = clean.slice(arrStart + 1);

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (esc)          { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"')    { inStr = !inStr; continue; }
    if (inStr)        continue;
    if (c === '{')    { if (depth++ === 0) objStart = i; }
    else if (c === '}') {
      if (--depth === 0 && objStart !== -1) {
        try { items.push(JSON.parse(body.slice(objStart, i + 1))); } catch (_) {}
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }

  if (items.length === 0) throw new Error('파싱 가능한 뉴스 항목이 없습니다. 다시 시도해주세요.');

  // 브리핑 추출 (잘렸을 수 있으므로 선택적)
  let briefing = '';
  const bMatch = clean.match(/"briefing"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  if (bMatch) briefing = bMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');

  return { news: items, briefing };
}

// ── 로컬 태그 분류 ─────────────────────────────────────
function classifyTag(text) {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) return rule.tag;
  }
  return 'general';
}

// ── 네이버 수집 직후 즉시 렌더 (Claude 대기 없이) ───────
function renderRawArticles(articles) {
  allNews = articles.slice(0, CONFIG.maxNews);
  applyFilter();
  updateLastUpdatedDisplay(formatTime(new Date()));
  highlightCurrentUpdateTime();
}

function showBriefingLoading() {
  const body   = document.getElementById('briefing-body');
  const dateEl = document.getElementById('briefing-date');
  const d = new Date();
  dateEl.textContent =
    d.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
  body.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:8px 0;">AI 브리핑 생성 중...</p>';
}

// ── 렌더링 ─────────────────────────────────────────────
function renderAll(news, briefing, fetchedAt) {
  allNews = news;
  renderBriefing(briefing, fetchedAt);
  applyFilter();
  updateLastUpdatedDisplay(formatTime(new Date(fetchedAt)));
  highlightCurrentUpdateTime();
}

function renderBriefing(briefing, fetchedAt) {
  const body   = document.getElementById('briefing-body');
  const dateEl = document.getElementById('briefing-date');
  const d = new Date(fetchedAt);
  dateEl.textContent =
    d.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });

  body.innerHTML = briefing
    ? `<div class="briefing-text">${briefing}</div>`
    : '<p style="color:var(--text3);font-size:13px;">브리핑 데이터가 없습니다.</p>';
}

function renderNewsList(news) {
  const list = document.getElementById('news-list');
  document.getElementById('news-count').textContent = news.length + ' 건';

  if (!news || news.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:40px;">
        <div class="empty-icon">◈</div>
        <p>해당 카테고리의 뉴스가 없습니다.</p>
      </div>`;
    return;
  }

  list.innerHTML = news.map((item, idx) => `
    <a class="news-item" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" style="--i:${idx + 1}">
      <div class="item-num ${idx < 3 ? 'top3' : ''}">${String(idx + 1).padStart(2, '0')}</div>
      <div class="item-content">
        <div class="item-meta">
          <span class="item-tag tag-${item.tag || 'general'}">${getCategoryLabel(item.tag)}</span>
          <span class="item-source">${escapeHtml(item.source || '')}</span>
          <span class="item-date">${escapeHtml(item.date || '')}</span>
        </div>
        <div class="item-title">${escapeHtml(item.title || '')}</div>
      </div>
      <div class="item-arrow">→</div>
    </a>
  `).join('');
}

function renderError(message) {
  document.getElementById('news-list').innerHTML = `
    <div class="error-box">
      <strong>오류 발생</strong><br>${escapeHtml(message)}<br><br>
      <small>API 설정을 확인하거나 잠시 후 다시 시도해주세요.</small>
    </div>`;
  document.getElementById('briefing-body').innerHTML =
    `<div class="error-box">뉴스를 불러오지 못했습니다. 새로고침 버튼을 눌러 다시 시도해주세요.</div>`;
}

// ── 로딩 ───────────────────────────────────────────────
function showLoading(text, sub) {
  document.getElementById('loading-text').textContent = text || '불러오는 중...';
  document.getElementById('loading-sub').textContent  = sub  || '';
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ── 토스트 알림 ─────────────────────────────────────────
function showToast(message, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ── 유틸 ───────────────────────────────────────────────
function getCategoryLabel(tag) {
  const map = { price:'유가/가격', company:'정유사', station:'주유소', policy:'정책/규제', mobility:'모빌리티', general:'일반' };
  return map[tag] || '일반';
}

function formatTime(date) {
  return date.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) +
    ' ' + date.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .trim();
}

function extractSource(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    const sourceMap = {
      'chosun.com':'조선일보','joongang.co.kr':'중앙일보','donga.com':'동아일보',
      'hani.co.kr':'한겨레','yonhapnews.co.kr':'연합뉴스','yna.co.kr':'연합뉴스',
      'mk.co.kr':'매일경제','hankyung.com':'한국경제','sedaily.com':'서울경제',
      'newsis.com':'뉴시스','news1.kr':'뉴스1','oilprice.com':'OilPrice',
    };
    for (const [domain, name] of Object.entries(sourceMap)) {
      if (hostname.includes(domain)) return name;
    }
    return hostname.split('.')[0];
  } catch { return '뉴스'; }
}

function formatNaverDate(pubDate) {
  try {
    const d = new Date(pubDate);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  catch { return ''; }
}
