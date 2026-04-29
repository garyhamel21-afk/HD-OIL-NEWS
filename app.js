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

  naver: {
    endpoint: '/api/naver/news',  // server.js 프록시
    display:  5,
  },

  supabase: {
    url:     'https://gsmcbriozeyafhevohfo.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY',   // ← Supabase 대시보드 > Settings > API 에서 확인
    table:   'clips',
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
  const chipMap = { 7: 'chip-07', 11: 'chip-11', 15: 'chip-15', 19: 'chip-19' };
  CONFIG.updateHours.forEach(slot => {
    const chip = document.getElementById(chipMap[slot]);
    if (!chip) return;
    chip.title = `${String(slot).padStart(2, '0')}:00 클리핑 보기`;
    chip.addEventListener('click', () => handleTimeChipClick(slot));
  });
}

// ── 시간 칩 클릭: Supabase에서 해당 슬롯 데이터 로드 ──
async function handleTimeChipClick(slot) {
  // 이미 선택된 슬롯 재클릭 시 라이브 뷰로 복귀
  if (viewingClipSlot === slot) {
    exitClipMode();
    return;
  }

  const chipMap = { 7: 'chip-07', 11: 'chip-11', 15: 'chip-15', 19: 'chip-19' };

  // 선택 상태 업데이트
  Object.values(chipMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('selected', 'active');
  });
  const chip = document.getElementById(chipMap[slot]);
  if (chip) chip.classList.add('selected', 'loading');

  showLoading(
    `${String(slot).padStart(2, '0')}:00 클리핑 불러오는 중...`,
    'Supabase에서 저장된 뉴스를 조회합니다'
  );

  try {
    const clip = await loadClipFromSupabase(slot);

    if (!clip) {
      showToast(`${String(slot).padStart(2, '0')}:00 클리핑 데이터가 없습니다`);
      // 선택 해제 후 현재 시간 복원
      if (chip) chip.classList.remove('selected', 'loading');
      highlightCurrentUpdateTime();
      viewingClipSlot = null;
      return;
    }

    viewingClipSlot = slot;
    if (chip) chip.classList.remove('loading');

    renderAll(clip.news, clip.briefing, new Date(clip.fetched_at).getTime());
    setClipModeLabel(slot, clip.fetched_at);
    showToast(`${String(slot).padStart(2, '0')}:00 클리핑 표시 중`);

  } catch (err) {
    console.error('Supabase 조회 오류:', err);
    showToast('데이터 로드 중 오류가 발생했습니다');
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
  const d = new Date(fetchedAt);
  const dateStr = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const timeStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  label.textContent = `${String(slot).padStart(2,'0')}:00 클리핑 보는 중 · ${dateStr} ${timeStr}`;
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

    showLoading('AI 브리핑 생성 중...', `${articles.length}건 기사를 분석합니다`);
    const { news, briefing } = await callClaudeWithArticles(articles);

    const cacheData = saveCache(news, briefing);
    renderAll(news, briefing, cacheData.fetchedAt);

    // Supabase에 클립 저장
    const slot = getCurrentTimeSlot();
    if (slot !== null) await saveClipToSupabase(news, briefing, slot);

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

// ── Supabase: 클립 저장 ────────────────────────────────
async function saveClipToSupabase(news, briefing, timeSlot) {
  if (CONFIG.supabase.anonKey === 'YOUR_SUPABASE_ANON_KEY') {
    console.warn('Supabase anonKey가 설정되지 않았습니다.');
    return;
  }
  try {
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/${CONFIG.supabase.table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        CONFIG.supabase.anonKey,
        'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        time_slot:  timeSlot,
        news:       news,
        briefing:   briefing,
        fetched_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Supabase 저장 오류:', err);
    } else {
      console.log(`Supabase에 ${timeSlot}:00 클립 저장 완료`);
    }
  } catch (e) {
    console.error('Supabase 저장 실패:', e);
  }
}

// ── Supabase: 클립 조회 (해당 슬롯 최신 1건) ─────────
async function loadClipFromSupabase(timeSlot) {
  if (CONFIG.supabase.anonKey === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('Supabase anonKey가 설정되지 않았습니다. CONFIG.supabase.anonKey를 설정해주세요.');
  }
  const params = new URLSearchParams({
    time_slot: `eq.${timeSlot}`,
    order:     'fetched_at.desc',
    limit:     '1',
  });
  const res = await fetch(
    `${CONFIG.supabase.url}/rest/v1/${CONFIG.supabase.table}?${params}`,
    {
      headers: {
        'apikey':        CONFIG.supabase.anonKey,
        'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
      },
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase 조회 오류: ${err}`);
  }
  const data = await res.json();
  return data.length > 0 ? data[0] : null;
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
  return results.slice(0, 40);
}

// ── Claude: 수집된 기사 기반 브리핑 생성 ─────────────
async function callClaudeWithArticles(articles) {
  const today   = new Date();
  const dateStr = today.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // 설명을 80자로 잘라 토큰 절약
  const articleText = articles.map((a, i) =>
    `[${i + 1}] ${a.title}\n출처:${a.source} 날짜:${a.date}\nURL:${a.url}\n내용:${a.description.slice(0, 80)}`
  ).join('\n---\n');

  const systemPrompt =
`HD현대오일뱅크 유류산업 뉴스 클리핑 AI. 순수 JSON만 반환 (코드블록 금지).
형식:
{"news":[{"id":1,"title":"제목","url":"URL","source":"언론사","date":"YYYY-MM-DD","tag":"price|company|station|policy|mobility|general","summary":"요약(30자)"}],"briefing":"종합브리핑(200-400자,HTML허용:<strong><br>)"}
태그: price=유가/환율, company=정유사, station=주유소, policy=유류세/정책, mobility=전기차/수소. 중복제거, 최대30개.`;

  const userPrompt = `${dateStr} 유류산업 뉴스:\n\n${articleText}\n\n최대30개 선별 후 JSON만 응답.`;

  const response = await fetch('/api/claude/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      CONFIG.model,
      max_tokens: 8192,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API 오류: ${response.status}`);
  }

  const data     = await response.json();
  const fullText = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed   = parseClaudeJson(fullText, articles);

  const urlMap = Object.fromEntries(articles.map(a => [a.title.slice(0, 20), a]));
  parsed.news = parsed.news.map(item => ({
    ...item,
    url: item.url || urlMap[item.title?.slice(0, 20)]?.url || '#',
    tag: item.tag || classifyTag(item.title),
  }));

  return { news: parsed.news.slice(0, CONFIG.maxNews), briefing: parsed.briefing || '' };
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
  try { return new Date(pubDate).toISOString().split('T')[0]; }
  catch { return ''; }
}
