/**
 * AIネイティブ開発施策 ポータル — フロントエンド
 *
 * 認証フロー:
 *   1. localStorage の portal_token を確認
 *   2. なければ GAS_AUTH_URL へリダイレクト（DOMAIN認証 → トークン発行）
 *   3. あれば GAS_API_URL?token=TOKEN でデータ取得
 *   4. 401 → トークン削除して再サインイン
 */

'use strict';

const TOKEN_KEY   = 'portal_token';
const TEAM_COLOR  = { A: '#6AB7F4', B: '#527EEC', C: '#A496FB' };

let D = null; // ポータルデータ（fetchData後にセット）
let PUBLIC_META = null;
let CAPS = null;

// ─── 初期化 ─────────────────────────────────────────────────────

google.charts.load('current', { packages: ['corechart', 'bar'], language: 'ja' });
google.charts.setOnLoadCallback(init);

let _pollTimer = null;
let _resizeTimer = null;

function init() {
  window.addEventListener('resize', handleWindowResize);
  fetchPublicMeta();

  const urlToken = consumeTokenFromUrl();
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
  }

  const token = urlToken || localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showSignIn();
    return;
  }
  showLoading();
  fetchData(token);
}

function consumeTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return '';

  url.searchParams.delete('token');
  window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  return token;
}

function fetchPublicMeta() {
  fetch(GAS_API_URL + '?action=public_meta')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.cohort) return;
      PUBLIC_META = data;
      applyLandingMeta(data.cohort);
    })
    .catch(() => {});
}

// ─── サインイン / アウト ──────────────────────────────────────

function randomState() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function showSignIn() {
  document.getElementById('signin-screen').style.display = 'flex';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';

  const btn = document.getElementById('signin-btn');
  btn.href = '#';
  btn.onclick = (ev) => {
    ev.preventDefault();
    startAuthFlow();
  };
}

function startAuthFlow() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  const state   = randomState();
  const authUrl = buildAuthUrl(state);

  // ポップアップを開く。ブロックされた環境では同一タブへフォールバックする。
  let popup = null;
  try {
    popup = window.open(authUrl, 'gas-auth', 'width=480,height=600,popup=yes');
  } catch (err) {
    popup = null;
  }

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    window.location.href = buildAuthUrl(state, currentPortalUrl());
    return;
  }

  // ローディング表示に切り替えてポーリング開始
  document.getElementById('signin-screen').style.display = 'none';
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('loading-screen').innerHTML =
    '<div class="loading-shell">' +
    '<div class="loading-panel">' +
    '<div class="spinner"></div>' +
    '<div>' +
    '<span class="brand-kicker">Authorizing</span>' +
    '<h1>Google 認証中...</h1>' +
    '<p class="loading-copy">認証完了後、このページが自動更新されます。</p>' +
    '</div>' +
    '<div class="loading-actions">' +
    '<button class="cancel-btn" onclick="cancelAuth()">キャンセル</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  let elapsed = 0;
  _pollTimer = setInterval(() => {
    elapsed += 2;
    if (elapsed > 300) { cancelAuth(); return; } // 5分タイムアウト
    fetch(GAS_API_URL + '?action=check_state&state=' + state)
      .then(r => r.json())
      .then(data => {
        if (data.token) {
          clearInterval(_pollTimer); _pollTimer = null;
          if (popup && !popup.closed) popup.close();
          localStorage.setItem(TOKEN_KEY, data.token);
          document.getElementById('loading-screen').innerHTML =
            '<div class="loading-shell">' +
            '<div class="loading-panel">' +
            '<div class="spinner"></div>' +
            '<div>' +
            '<span class="brand-kicker">Loading Portal</span>' +
            '<h1>データを読み込み中...</h1>' +
            '<p class="loading-copy">認証結果を反映して最新データを取得しています。</p>' +
            '</div>' +
            '</div>' +
            '</div>';
          fetchData(data.token);
        }
      })
      .catch(() => {}); // ネットワークエラーは無視してリトライ
  }, 2000);
}

function buildAuthUrl(state, redirectTo = '') {
  let url = GAS_AUTH_URL + '?action=auth&state=' + encodeURIComponent(state);
  if (redirectTo) {
    url += '&redirect_to=' + encodeURIComponent(redirectTo);
  }
  return url;
}

function currentPortalUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  return url.toString();
}

function cancelAuth() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  showSignIn();
}

function showLoading() {
  document.getElementById('signin-screen').style.display = 'none';
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('signin-screen').style.display = 'none';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  showSignIn();
}

// ─── データ取得 ────────────────────────────────────────────────

function fetchData(token) {
  const url = GAS_API_URL + '?token=' + encodeURIComponent(token);
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error === 'unauthorized') {
        localStorage.removeItem(TOKEN_KEY);
        showSignIn();
        return;
      }
      D = data;
      applyLandingMeta(D.cohort);
      showApp();
      renderApp();
    })
    .catch(err => {
      console.error('データ取得エラー:', err);
      document.getElementById('loading-screen').innerHTML =
        '<div class="loading-shell">' +
        '<div class="loading-panel">' +
        '<div class="error-msg">データの読み込みに失敗しました。<br>' +
        '<button class="btn btn-primary" style="margin-top:16px" onclick="signOut()">再サインイン</button></div>' +
        '</div>' +
        '</div>';
    });
}

// ─── アプリ描画 ────────────────────────────────────────────────

function renderApp() {
  const role = D.role;
  const cohort = getCohort();
  applyLandingMeta(cohort);
  CAPS = resolveCapabilities(role, D.capabilities);

  // ロールバッジ
  const badgeEl = document.getElementById('role-badge');
  badgeEl.textContent = role === 'admin' ? '管理者' : role === 'member' ? '参加メンバー' : '閲覧者';

  // ナビゲーション構築
  const pages = [
    { id: 'overview',     label: '施策概要',             roles: ['admin', 'member', 'viewer'], enabled: CAPS.canViewOverview },
    { id: 'summary',      label: '全体サマリー',         roles: ['admin', 'member', 'viewer'], enabled: CAPS.canViewSummary },
    { id: 'artifacts',    label: '成果物',               roles: ['admin', 'member', 'viewer'], enabled: CAPS.canViewArtifacts },
    { id: 'member',       label: '個人アクティビティ',   roles: ['admin', 'member'],           enabled: CAPS.canViewMemberActivity },
    { id: 'eval',         label: '評価スコア',           roles: ['admin', 'member'],           enabled: CAPS.canViewEvaluation },
    { id: 'gamification', label: 'ゲーミフィケーション', roles: ['admin', 'member'],           enabled: CAPS.canViewGamification },
    { id: 'selfevals',    label: '自己評価',             roles: ['admin', 'member'],           enabled: CAPS.canViewSelfEvaluations },
    { id: 'claude',       label: 'AI活用',               roles: ['admin', 'member'],           enabled: CAPS.canViewClaudeUsage },
  ].filter(p => p.roles.includes(role) && p.enabled !== false);

  const nav = document.getElementById('main-nav');
  nav.innerHTML = pages.map((p) =>
    `<button data-page="${p.id}" onclick="showPage('${p.id}',this)">${p.label}</button>`
  ).join('');

  renderAppHero(cohort, pages, role);

  // viewer notice
  document.getElementById('viewer-notice').style.display = role === 'viewer' ? 'block' : 'none';

  // 評価フォームリンク
  if (D.evalFormUrl) {
    document.getElementById('evalFormLink').innerHTML =
      `<a class="btn btn-primary" href="${D.evalFormUrl}" target="_blank">評価フォームを開く</a>`;
  } else {
    document.getElementById('evalFormLink').innerHTML =
      '<p class="subtle-text">フォームURLは管理者が設定中です。</p>';
  }

  // 評価テーブルタイトル（admin は承認ボタンあり）
  if (role === 'admin' && CAPS.canApproveEvaluation) {
    document.getElementById('evalTableTitle').textContent = 'Before→After 成長スコア';
    document.getElementById('adminEvalSection').style.display = 'block';
  } else {
    document.getElementById('adminEvalSection').style.display = 'none';
  }

  if (!pages.length) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page_overview').classList.add('active');
    document.getElementById('overview-content').innerHTML =
      '<div class="card"><p class="subtle-text">現在の権限では閲覧可能なページがありません。</p></div>';
    return;
  }

  const initialPage = pages[0].id;
  showPage(initialPage, nav.querySelector(`button[data-page="${initialPage}"]`));
}

function renderAppHero(cohort, pages, role) {
  const teams = Array.isArray(cohort.teams) ? cohort.teams : [];
  const phases = Array.isArray(cohort.phases) ? cohort.phases : [];
  const memberCount = teams.reduce((sum, team) => sum + ((team.members && team.members.length) || 0), 0);

  setText('hero-cohort-chip', cohort.name || '');
  setText('hero-period', cohort.period || '-');
  setText('hero-session', cohort.weeklySession || '-');
  setText('hero-members', `${memberCount}名`);
  setText('hero-teams', `${teams.length}チーム`);

  const phaseStrip = document.getElementById('hero-phase-strip');
  if (phaseStrip) {
    phaseStrip.innerHTML = phases.map((phase, index) => `
      <div class="hero-phase-card">
        <span class="hero-phase-index">Phase ${index + 1}</span>
        <strong>${escapeHtml(phase.name || '')}</strong>
        <span>${escapeHtml(phase.period || '')}</span>
      </div>
    `).join('');
  }

  const surfaceGrid = document.getElementById('hero-surface-grid');
  if (surfaceGrid) {
    surfaceGrid.innerHTML = pages.map((page) => `
      <div class="hero-surface-card">
        <span class="hero-surface-label">${escapeHtml(page.label)}</span>
      </div>
    `).join('');
  }

  const dataPills = document.getElementById('hero-data-pills');
  if (dataPills) {
    dataPills.innerHTML = ['GitHub', 'Google Chat', 'Backlog', 'Evaluation']
      .map((label) => `<span class="hero-pill">${label}</span>`)
      .join('');
  }

  const roleMap = {
    admin: ['管理者', '参加メンバー', '閲覧者'],
    member: ['参加メンバー', '閲覧者'],
    viewer: ['閲覧者'],
  };
  const rolePills = document.getElementById('hero-role-pills');
  if (rolePills) {
    rolePills.innerHTML = (roleMap[role] || [role]).map((label) => `
      <span class="hero-pill hero-pill-muted">${label}</span>
    `).join('');
  }
}

function applyLandingMeta(cohort) {
  if (!cohort) return;

  const teams = Array.isArray(cohort.teams) ? cohort.teams : [];
  const phases = Array.isArray(cohort.phases) ? cohort.phases : [];
  const memberCount = typeof cohort.memberCount === 'number'
    ? cohort.memberCount
    : teams.reduce((sum, team) => sum + ((team.members && team.members.length) || 0), 0);
  const teamCount = typeof cohort.teamCount === 'number' ? cohort.teamCount : teams.length;
  const themeText = teams.map(team => team.theme).filter(Boolean).join(' / ');

  setText('cohort-chip', `${cohort.name || 'Cohort'} ${cohort.period || ''}`.trim());
  setText('session-chip', cohort.weeklySession || 'Weekly Session');
  setText('team-chip', `${teamCount} Teams / ${memberCount} Members`);
  setText('themes-text', themeText || 'テーマ情報は管理者が設定します');

  const phaseList = document.getElementById('signin-phase-list');
  if (phaseList) {
    phaseList.innerHTML = phases.map(phase => `
      <div class="timeline-step">
        <div class="timeline-copy">
          <strong>${escapeHtml(phase.name || '')}</strong>
          <span>${escapeHtml(phase.period || '')}</span>
        </div>
        <div class="timeline-track"><span class="timeline-fill"></span></div>
        <span class="metric-trend">${escapeHtml(phase.desc || '')}</span>
      </div>
    `).join('');
  }

  const teamList = document.getElementById('signin-team-list');
  if (teamList) {
    teamList.innerHTML = teams.map(team => `
      <div class="preview-feed-item">
        <span class="preview-dot team-${String(team.id || '').toLowerCase()}"></span>
        <div>
          <strong>Team ${escapeHtml(team.id || '')}</strong>
          <span>${escapeHtml(team.theme || '')}</span>
        </div>
      </div>
    `).join('');
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function pickFirstString(obj, keys, fallback = '') {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const key of keys) {
    const value = obj[key];
    if (value === 0) return '0';
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function pickFirstValue(obj, keys, fallback = '') {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return fallback;
}

function capabilityValue(raw, keys, fallback) {
  const sources = [raw, raw && raw.pages, raw && raw.page, raw && raw.features, raw && raw.flags];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of keys) {
      const parsed = toBoolean(source[key]);
      if (parsed !== null) return parsed;
    }
  }

  const granted = [];
  if (Array.isArray(raw)) granted.push(...raw.map(v => String(v)));
  if (raw && typeof raw === 'object' && Array.isArray(raw.enabled)) granted.push(...raw.enabled.map(v => String(v)));
  for (const key of keys) {
    if (granted.includes(key)) return true;
  }

  return fallback;
}

function resolveCapabilities(role, rawCapabilities) {
  const defaultByRole = {
    canViewOverview: true,
    canViewSummary: true,
    canViewAiInsights: true,
    canViewQuickLinks: true,
    canViewArtifacts: true,
    canViewMemberActivity: role !== 'viewer',
    canViewEvaluation: role !== 'viewer',
    canApproveEvaluation: role === 'admin',
    canViewGamification: role !== 'viewer',
    canViewAchievements: role !== 'viewer',
    canViewSelfEvaluations: role !== 'viewer',
    canViewClaudeUsage: role !== 'viewer',
  };

  const raw = rawCapabilities && typeof rawCapabilities === 'object' ? rawCapabilities : {};
  const explicitArtifactScope = capabilityValue(raw, ['canViewArtifacts', 'page_artifacts', 'artifactsEnabled'], null);
  const artifactDerivedScope = ['canViewPublishedArtifacts', 'canViewEmployeeArtifacts', 'canViewParticipantArtifacts', 'canViewAdminArtifacts']
    .some((key) => toBoolean(raw[key]) === true);
  const artifactScope = explicitArtifactScope === null
    ? (artifactDerivedScope || defaultByRole.canViewArtifacts)
    : explicitArtifactScope;

  return {
    canViewOverview: capabilityValue(raw, ['canViewOverview', 'page_overview'], defaultByRole.canViewOverview),
    canViewSummary: capabilityValue(raw, ['canViewSummary', 'page_summary'], defaultByRole.canViewSummary),
    canViewAiInsights: capabilityValue(raw, ['canViewAiInsights', 'canViewAIInsights', 'canViewInsights', 'aiInsightsEnabled', 'summaryAiInsightsEnabled'], defaultByRole.canViewAiInsights),
    canViewQuickLinks: capabilityValue(raw, ['canViewQuickLinks', 'canViewOverviewQuickLinks', 'quickLinksEnabled'], defaultByRole.canViewQuickLinks),
    canViewArtifacts: artifactScope,
    canViewMemberActivity: capabilityValue(raw, ['canViewMemberActivity', 'page_member'], defaultByRole.canViewMemberActivity),
    canViewEvaluation: capabilityValue(raw, ['canViewEvaluation', 'page_eval'], defaultByRole.canViewEvaluation),
    canApproveEvaluation: capabilityValue(raw, ['canApproveEvaluation'], defaultByRole.canApproveEvaluation),
    canViewGamification: capabilityValue(raw, ['canViewGamification', 'page_gamification'], defaultByRole.canViewGamification),
    canViewAchievements: capabilityValue(raw, ['canViewAchievements', 'canViewHallOfFame', 'badgesEnabled'], defaultByRole.canViewAchievements),
    canViewSelfEvaluations: capabilityValue(raw, ['canViewSelfEvaluations', 'canViewSelfEvals', 'page_selfevals'], defaultByRole.canViewSelfEvaluations),
    canViewClaudeUsage: capabilityValue(raw, ['canViewClaudeUsage', 'page_claude'], defaultByRole.canViewClaudeUsage),
  };
}

function toSafeUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

function getCohort() {
  const raw = D && D.cohort && typeof D.cohort === 'object' ? D.cohort : {};
  return {
    id: raw.id || '',
    name: raw.name || 'Cohort',
    period: raw.period || '-',
    weeklySession: raw.weeklySession || '-',
    phases: Array.isArray(raw.phases) ? raw.phases : [],
    teams: Array.isArray(raw.teams) ? raw.teams : [],
  };
}

function extractMonthNumbers(value) {
  return String(value || '').match(/\d{1,2}(?=月)/g)?.map(Number) || [];
}

function extractBaseYear(value, fallbackYear = new Date().getFullYear()) {
  const match = String(value || '').match(/(20\d{2})年/);
  return match ? Number(match[1]) : fallbackYear;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computeRangeProgress(now, startDate, endDate) {
  if (now <= startDate) return 0;
  if (now >= endDate) return 1;
  return clamp((now.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime()), 0, 1);
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function buildPhaseTimeline(cohort, now = new Date()) {
  const phases = Array.isArray(cohort.phases) ? cohort.phases : [];
  const baseYear = extractBaseYear(cohort.period, now.getFullYear());
  let yearOffset = 0;
  let previousMonth = null;

  const items = phases.map((phase) => {
    const months = extractMonthNumbers(phase.period);
    const startMonth = months[0] || previousMonth || (now.getMonth() + 1);
    const endMonth = months[months.length - 1] || startMonth;

    if (previousMonth !== null && startMonth < previousMonth) {
      yearOffset += 1;
    }
    previousMonth = endMonth;

    const year = baseYear + yearOffset;
    const startDate = new Date(year, startMonth - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, endMonth, 0, 23, 59, 59, 999);
    const progress = computeRangeProgress(now, startDate, endDate);

    let status = 'upcoming';
    let statusLabel = 'これから';
    if (now > endDate) {
      status = 'completed';
      statusLabel = '完了';
    } else if (now >= startDate) {
      status = 'current';
      statusLabel = '進行中';
    }

    return {
      ...phase,
      startDate,
      endDate,
      progressPercent: Math.round(progress * 100),
      status,
      statusLabel,
      rangeLabel: `${formatMonthDay(startDate)} - ${formatMonthDay(endDate)}`,
    };
  });

  const startDate = items[0]?.startDate || now;
  const endDate = items[items.length - 1]?.endDate || now;
  const overallPercent = Math.round(computeRangeProgress(now, startDate, endDate) * 100);
  const currentPhase = items.find((item) => item.status === 'current');

  let overallLabel = '開始前';
  if (now > endDate) {
    overallLabel = '全フェーズ完了';
  } else if (currentPhase) {
    overallLabel = `${currentPhase.name} が進行中`;
  }

  return {
    items,
    overallPercent,
    overallLabel,
    todayLabel: formatDisplayDate(now.toISOString()),
  };
}

function showPage(name, btn) {
  const pageEl = document.getElementById('page_' + name);
  if (!pageEl) return;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#main-nav button').forEach(b => b.classList.remove('active'));
  pageEl.classList.add('active');

  const activeBtn = btn || document.querySelector(`#main-nav button[data-page="${name}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (name === 'overview')     renderOverviewPage();
  if (name === 'summary')      requestAnimationFrame(() => renderSummaryPage());
  if (name === 'artifacts')    renderArtifactsPage();
  if (name === 'member')       renderMemberPage();
  if (name === 'eval')         renderEvalPage();
  if (name === 'gamification') renderGamificationPage();
  if (name === 'selfevals')    renderSelfEvalPage();
  if (name === 'claude')       requestAnimationFrame(() => renderClaudePage());
}

function openPage(name) {
  const btn = document.querySelector(`#main-nav button[data-page="${name}"]`);
  if (!btn) return;
  showPage(name, btn);
}

function handleWindowResize() {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;

    if (activePage.id === 'page_summary') {
      renderSummaryPage();
    } else if (activePage.id === 'page_overview') {
      renderOverviewPage();
    } else if (activePage.id === 'page_artifacts') {
      renderArtifactsPage();
    } else if (activePage.id === 'page_member') {
      renderMemberPage();
    } else if (activePage.id === 'page_eval') {
      renderEvalPage();
    } else if (activePage.id === 'page_gamification') {
      renderGamificationPage();
    } else if (activePage.id === 'page_claude') {
      renderClaudePage();
    }
  }, 120);
}

// ─── 施策概要 ─────────────────────────────────────────────────

function normalizeQuickLinkKey(raw) {
  const key = String(raw || '').toLowerCase();
  if (key.includes('git') || key.includes('repo')) return 'github';
  if (key.includes('backlog')) return 'backlog';
  if (key.includes('chat')) return 'chat';
  if (key.includes('artifact') || key.includes('deliverable') || key.includes('成果')) return 'artifacts';
  return '';
}

function applyQuickLinkSource(target, source) {
  if (!source) return;

  if (Array.isArray(source)) {
    source.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const key = normalizeQuickLinkKey(
        pickFirstString(item, ['key', 'id', 'name', 'label', 'title', 'type', 'category'], '')
      );
      if (!key) return;
      const url = toSafeUrl(pickFirstString(item, ['url', 'href', 'link', 'value'], ''));
      if (url) target[key] = url;
    });
    return;
  }

  if (typeof source !== 'object') return;
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = normalizeQuickLinkKey(rawKey);
    if (!key) return;
    if (typeof rawValue === 'string') {
      const url = toSafeUrl(rawValue);
      if (url) target[key] = url;
      return;
    }
    if (rawValue && typeof rawValue === 'object') {
      const url = toSafeUrl(pickFirstString(rawValue, ['url', 'href', 'link', 'value'], ''));
      if (url) target[key] = url;
    }
  });
}

function buildQuickLinks() {
  const cohort = getCohort();
  const teamLinks = D.links && D.links.teams && typeof D.links.teams === 'object'
    ? Object.values(D.links.teams)
    : [];
  const cohortTeamLinks = cohort.teams
    .map(team => (team && typeof team.links === 'object') ? team.links : null)
    .filter(Boolean);
  const firstTeam = teamLinks[0] || {};
  const firstCohortTeam = cohortTeamLinks[0] || {};
  const links = {
    github: toSafeUrl(firstTeam.github) || toSafeUrl(firstCohortTeam.github) || 'https://github.com/april-knights-dev',
    backlog: toSafeUrl(firstTeam.backlog) || toSafeUrl(firstCohortTeam.backlog) || toSafeUrl(D.links && D.links.backlogProject) || 'https://ak-galahad.backlog.com',
    chat: toSafeUrl(firstTeam.gchat) || toSafeUrl(firstCohortTeam.gchat) || 'https://chat.google.com',
    artifacts: toSafeUrl(firstTeam.artifacts) || toSafeUrl(firstCohortTeam.artifacts) || '',
  };

  applyQuickLinkSource(links, D.links);
  applyQuickLinkSource(links, cohort);
  applyQuickLinkSource(links, cohort.links);
  applyQuickLinkSource(links, cohort.quickLinks);

  return [
    { id: 'github', label: 'GitHub', desc: 'リポジトリとPRを確認', url: links.github },
    { id: 'backlog', label: 'Backlog', desc: '課題管理を確認', url: links.backlog },
    { id: 'chat', label: 'Google Chat', desc: '施策スペースを確認', url: links.chat },
    {
      id: 'artifacts',
      label: '成果物',
      desc: '成果物ページへ移動',
      url: links.artifacts,
      internalPage: 'artifacts',
    },
  ];
}

function renderOverviewPage() {
  const cohort = getCohort();
  const teams = Array.isArray(cohort.teams) ? cohort.teams : [];
  const memberCount = teams.reduce((sum, team) => sum + ((team && Array.isArray(team.members)) ? team.members.length : 0), 0);
  const timelineMeta = buildPhaseTimeline(cohort);
  const quickLinks = buildQuickLinks();

  const phasesHtml = timelineMeta.items.map(item => `
    <div class="timeline-item timeline-item-${item.status}">
      <div class="timeline-item-head">
        <span class="period">${item.period}</span>
        <span class="timeline-status timeline-status-${item.status}">${item.statusLabel}</span>
      </div>
      <h4>${item.name}</h4>
      <p>${item.desc}</p>
      <div class="timeline-meter"><span style="width:${item.progressPercent}%"></span></div>
      <div class="timeline-meta">
        <span>${item.rangeLabel}</span>
        <strong>${item.progressPercent}%</strong>
      </div>
    </div>`).join('');

  const teamsHtml = teams.map(t => {
    const teamId = String((t && t.id) || '').toLowerCase();
    const members = (t && Array.isArray(t.members)) ? t.members : [];
    const po = (t && Array.isArray(t.po)) ? t.po : [];
    return `
    <div class="team-card team-${escapeHtml(teamId)}">
      <div class="team-card-head">
        <span class="badge badge-${escapeHtml(teamId)}">Team ${escapeHtml((t && t.id) || '-')}</span>
        <h4>${escapeHtml((t && t.theme) || 'テーマ未設定')}</h4>
      </div>
      <div class="members">メンバー: ${escapeHtml(members.join('・') || '未設定')} / リーダー: ${escapeHtml((t && t.leader) || '未設定')}</div>
      <div class="team-po">PO: ${escapeHtml(po.join('・') || '未設定')}</div>
    </div>`;
  }).join('');

  const quickLinksHtml = CAPS && CAPS.canViewQuickLinks
    ? quickLinks.map((link) => {
      const disabled = link.id === 'artifacts' && CAPS && !CAPS.canViewArtifacts;
      if (disabled) {
        return `
          <div class="quick-link quick-link-disabled">
            <span class="quick-link-label">${escapeHtml(link.label)}</span>
            <span class="quick-link-desc">閲覧権限がありません</span>
          </div>`;
      }
      if (link.url) {
        return `
          <a class="quick-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
            <span class="quick-link-label">${escapeHtml(link.label)}</span>
            <span class="quick-link-desc">${escapeHtml(link.desc)}</span>
          </a>`;
      }
      return `
        <button class="quick-link quick-link-action" type="button" onclick="openPage('${link.internalPage || 'artifacts'}')">
          <span class="quick-link-label">${escapeHtml(link.label)}</span>
          <span class="quick-link-desc">${escapeHtml(link.desc)}</span>
        </button>`;
    }).join('')
    : '<div class="quick-links-empty">クイックリンクは現在の表示設定で無効化されています。</div>';

  document.getElementById('overview-content').innerHTML = `
  <div class="grid grid-2">
    <div class="card">
      <span class="section-kicker">Program Overview</span>
      <h2>施策について</h2>
      <p class="overview-copy">
        AIネイティブ開発プロジェクトは、AI-first な開発手法を実践しながら
        上流工程力・実装技術力・AI活用力・チームコミュニケーション力を総合的に鍛えます。<br>
        参加メンバーは期ごとにローテーションし、社内の AI ネイティブ人材を継続的に育成します。
      </p>
      <div class="overview-facts">
        <div class="overview-fact"><span>Cohort</span><strong>${cohort.name} / ${cohort.id}</strong></div>
        <div class="overview-fact"><span>Period</span><strong>${cohort.period}</strong></div>
        <div class="overview-fact"><span>Weekly Session</span><strong>${cohort.weeklySession}</strong></div>
        <div class="overview-fact"><span>Team Setup</span><strong>${teams.length}チーム / ${memberCount}名</strong></div>
      </div>
    </div>
    <div class="card">
      <span class="section-kicker">Timeline</span>
      <h2>フェーズ・タイムライン</h2>
      <div class="timeline-summary">
        <div>
          <span class="timeline-summary-label">Current Progress</span>
          <strong>${timelineMeta.overallLabel}</strong>
          <p>${timelineMeta.todayLabel} 時点の進行状況</p>
        </div>
        <div class="timeline-summary-progress">
          <div class="timeline-summary-track"><span style="width:${timelineMeta.overallPercent}%"></span></div>
          <strong>${timelineMeta.overallPercent}%</strong>
        </div>
      </div>
      <div class="timeline">${phasesHtml}</div>
    </div>
  </div>
  <div class="card quick-links-card" style="margin-top:16px">
    <span class="section-kicker">Quick Links</span>
    <h2>主要リンク</h2>
    <div class="quick-link-grid">${quickLinksHtml}</div>
  </div>
  <div class="card" style="margin-top:16px">
    <span class="section-kicker">Teams</span>
    <h2>チーム構成（${cohort.name}）</h2>
    <div class="teams-grid">${teamsHtml || '<p class="subtle-text">チーム情報は準備中です。</p>'}</div>
  </div>
  <div class="card" style="margin-top:16px">
    <span class="section-kicker">Evaluation Policy</span>
    <h2>評価について</h2>
    <p class="overview-copy evaluation-copy">
      本施策の評価は、参加メンバーを序列化するためではなく、<strong>成長の可視化と次の育成支援</strong> に活用する前提で扱います。<br>
      施策責任者・チームリーダー・本人の 3 者評価をもとに、振り返り、次期アサイン、施策改善の参考情報として整理します。<br>
      なお、本施策のスコアだけで人事評価や処遇を決めるのではなく、日常業務での成果や上長評価とあわせて補助的に扱う想定です。
    </p>
    <table>
      <tr><th>タイミング</th><th>内容</th></tr>
      <tr><td>Before（施策開始前）</td><td>開始時点の自己評価・期待値確認</td></tr>
      <tr><td>After（施策終了後）</td><td>3者評価による振り返りと成長確認</td></tr>
    </table>
    <p class="overview-note">
      最終スコア = (本人 + チームリーダー + 施策責任者) ÷ 3　｜　成長スコア = After − Before　｜　主用途 = 振り返り・次期育成支援・施策改善
    </p>
  </div>`;
}

// ─── 全体サマリー ─────────────────────────────────────────────

function renderSummaryPage() {
  const role  = D.role;
  const src   = role === 'viewer' ? asArray(D.gh_team) : asArray(D.github);
  const gchat = asArray(D.gchat);
  const backlog = asArray(D.backlog);
  const week  = latestActiveWeek(src, ['commits', 'prs_opened', 'prs_merged', 'reviews_given']);
  const wGH   = src.filter(r => r.week_start === week);
  const gcWeek = latestActiveWeek(gchat, ['messages_sent']);
  const blWeek = latestActiveWeek(backlog, ['tasks_completed']);
  const wGC   = gchat.filter(r => r.week_start === gcWeek);
  const wBL   = backlog.filter(r => r.week_start === blWeek);
  const latestLabel = week ? formatDisplayDate(week) : '未取得';

  document.getElementById('scoreCards').innerHTML =
    scoreCard(wGH.reduce((s,r)=>s+(r.commits||0),0),   '今週のコミット数', latestLabel) +
    scoreCard(wGC.reduce((s,r)=>s+(r.messages_sent||0),0), '今週のChatメッセージ', formatDisplayDate(gcWeek || week)) +
    scoreCard(wBL.reduce((s,r)=>s+(r.tasks_completed||0),0), '今週の完了タスク', formatDisplayDate(blWeek || week));

  document.getElementById('updated-at').textContent = latestLabel;
  setText('summary-updated', latestLabel);
  setText('summary-caption', '各チームの週次推移を折れ線で比較し、最新週の活動量はカードと横棒で確認できるようにしています。');
  setText('meta_chart_week', summaryMeta(src));
  setText('meta_chart_gchat_week', summaryMeta(gchat));
  setText('meta_chart_backlog_week', summaryMeta(backlog));
  setText('meta_chart_team_activity', latestLabel === '未取得' ? 'データ待ち' : `最新週 ${latestLabel}`);

  renderSummaryInsights();
  renderWeeklyTrendChart(src,      'commits',         'chart_week');
  renderWeeklyTrendChart(gchat,    'messages_sent',   'chart_gchat_week');
  renderWeeklyTrendChart(backlog,  'tasks_completed', 'chart_backlog_week');
  renderTeamActivityChart({ github: src, gchat, backlog });
}

function scoreCard(val, lbl, meta = '') {
  return `<div class="score-card"><div class="val">${val}</div><div class="lbl">${lbl}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>`;
}

function formatDisplayDate(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return String(value);
}

function latestWeek(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(r => r.week_start).sort().pop();
}

function latestActiveWeek(arr, fields) {
  if (!arr || !arr.length) return '';
  const weeks = [...new Set(arr.map(r => r.week_start).filter(Boolean))].sort();
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    const hasData = arr.filter(r => r.week_start === w)
                       .some(r => fields.some(f => (r[f] || 0) > 0));
    if (hasData) return w;
  }
  return weeks[weeks.length - 1] || '';
}

function formatCompactDate(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}`;
  return formatDisplayDate(value);
}

function summaryMeta(data) {
  const count = [...new Set((data || []).map(row => row.week_start).filter(Boolean))].length;
  return count ? `${count}週分` : 'データ待ち';
}

function collectAiInsights() {
  const src = D.ai_insights || D.aiInsights || D.insights || [];
  if (Array.isArray(src)) return src;
  if (src && typeof src === 'object') {
    if (Array.isArray(src.rows)) return src.rows;
    if (Array.isArray(src.list)) return src.list;
    if (Array.isArray(src.data)) return src.data;
    if (Array.isArray(src.insights)) return src.insights;
    if (Array.isArray(src.items)) return src.items;
    if (Array.isArray(src.teams)) return src.teams;
    if (src.by_team && typeof src.by_team === 'object') return Object.values(src.by_team);
    return [src];
  }
  return [];
}

function renderSummaryInsights() {
  const panel = document.getElementById('summary-ai-insights');
  const container = document.getElementById('ai-insights-content');
  if (!panel || !container) return;

  if (CAPS && !CAPS.canViewAiInsights) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const insights = collectAiInsights();
  const rows = insights.map((item, index) => ({
    team: pickFirstString(item, ['team', 'target', 'scope', 'group', 'scope_id'], `Insight ${index + 1}`),
    title: pickFirstString(item, ['title', 'headline', 'theme', 'kind'], '活動インサイト'),
    summary: pickFirstString(item, ['summary', 'insight', 'analysis', 'message', 'text', 'content', 'body', 'highlight', 'mvp'], ''),
    advice: pickFirstString(item, ['advice', 'recommendation', 'next_action', 'action', 'next_focus', 'next_week_focus'], ''),
    cheer: pickFirstString(item, ['cheer', 'encouragement', 'cheer_message'], ''),
    week: pickFirstString(item, ['week_start', 'week'], ''),
    updatedAt: pickFirstString(item, ['updated_at', 'created_at', 'generated_at'], ''),
  })).filter(row => row.summary || row.advice || row.cheer);

  if (!rows.length) {
    setText('ai-insights-meta', 'データ待ち');
    container.innerHTML = '<div class="ai-insight-empty">AIインサイトはまだ生成されていません。</div>';
    return;
  }

  const latest = rows.find(row => row.week || row.updatedAt) || rows[0];
  setText('ai-insights-meta', latest.week ? `対象週 ${formatDisplayDate(latest.week)}` : `更新 ${formatDisplayDate(latest.updatedAt)}`);
  container.innerHTML = rows.slice(0, 3).map((row) => `
    <article class="ai-insight-item">
      <div class="ai-insight-head">
        <span class="ai-insight-team">${escapeHtml(row.team)}</span>
        <strong>${escapeHtml(row.title)}</strong>
      </div>
      <p>${escapeHtml(row.summary || '要約データは準備中です。')}</p>
      ${row.advice ? `<p class="ai-insight-sub">次の一手: ${escapeHtml(row.advice)}</p>` : ''}
      ${row.cheer ? `<p class="ai-insight-sub">応援: ${escapeHtml(row.cheer)}</p>` : ''}
    </article>
  `).join('');
}

function collectArtifacts() {
  const src = D.artifacts || D.deliverables || [];
  const list = Array.isArray(src)
    ? src
    : Array.isArray(src.items) ? src.items
      : Array.isArray(src.rows) ? src.rows
        : Array.isArray(src.list) ? src.list
          : Array.isArray(src.data) ? src.data
            : [];
  return list.map((item) => ({
    title: pickFirstString(item, ['title', 'artifact_title', 'artifact_name', 'name', 'deliverable_title'], '成果物'),
    summary: pickFirstString(item, ['summary', 'description', 'abstract', 'desc', 'note'], ''),
    team: pickFirstString(item, ['team', 'team_id', 'scope_id'], ''),
    type: pickFirstString(item, ['type', 'artifact_type', 'category', 'kind', 'source_type'], ''),
    status: pickFirstString(item, ['status', 'publish_status'], 'published'),
    visibility: pickFirstString(item, ['visibility', 'scope', 'access_scope'], ''),
    url: toSafeUrl(pickFirstString(item, ['url', 'link', 'href', 'demo_url', 'repo_url', 'artifact_url', 'source_url', 'target_url'], '')),
    updatedAt: pickFirstValue(item, ['updated_at', 'published_at', 'created_at', 'week_start'], ''),
  })).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function renderArtifactsPage() {
  const target = document.getElementById('artifacts-content');
  if (!target) return;

  if (CAPS && !CAPS.canViewArtifacts) {
    target.innerHTML = '<div class="card"><p class="subtle-text">成果物ページの閲覧権限がありません。</p></div>';
    return;
  }

  const artifacts = collectArtifacts();
  if (!artifacts.length) {
    target.innerHTML = `
      <div class="card">
        <p class="subtle-text">成果物データはまだ登録されていません。公開URLが設定されるとここに表示されます。</p>
      </div>`;
    return;
  }

  const cards = artifacts.map((artifact) => `
    <article class="artifact-card">
      <div class="artifact-head">
        <h3>${escapeHtml(artifact.title)}</h3>
        <div class="artifact-tags">
          ${artifact.team ? `<span class="artifact-tag">Team ${escapeHtml(artifact.team)}</span>` : ''}
          ${artifact.type ? `<span class="artifact-tag">${escapeHtml(artifact.type)}</span>` : ''}
          ${artifact.status ? `<span class="artifact-tag artifact-tag-status">${escapeHtml(artifact.status)}</span>` : ''}
          ${artifact.visibility ? `<span class="artifact-tag">${escapeHtml(artifact.visibility)}</span>` : ''}
        </div>
      </div>
      ${artifact.summary ? `<p class="artifact-summary">${escapeHtml(artifact.summary)}</p>` : ''}
      <div class="artifact-foot">
        ${artifact.updatedAt ? `<span class="artifact-meta">更新: ${escapeHtml(formatDisplayDate(artifact.updatedAt))}</span>` : '<span class="artifact-meta">更新日未設定</span>'}
        ${artifact.url
          ? `<a class="artifact-link" href="${escapeHtml(artifact.url)}" target="_blank" rel="noopener noreferrer">成果物を開く</a>`
          : '<span class="artifact-link artifact-link-disabled">URL未設定</span>'}
      </div>
    </article>
  `).join('');

  target.innerHTML = `<div class="artifacts-grid">${cards}</div>`;
}

function renderEmptyChart(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="chart-empty">${message}</div>`;
}

function baseChartOptions() {
  return {
    backgroundColor: 'transparent',
    legend: {
      position: 'top',
      alignment: 'start',
      textStyle: { color: '#5c667d', fontSize: 12 },
    },
    hAxis: {
      textStyle: { color: '#5c667d', fontSize: 11 },
      gridlines: { color: 'transparent' },
      baselineColor: '#d7deea',
    },
    vAxis: {
      minValue: 0,
      textStyle: { color: '#5c667d', fontSize: 11 },
      gridlines: { color: '#eef2f8' },
      baselineColor: '#d7deea',
      viewWindow: { min: 0 },
    },
  };
}

function sizedChartOptions(target, padding = {}) {
  const left = padding.left ?? 44;
  const right = padding.right ?? 8;
  const top = padding.top ?? 34;
  const bottom = padding.bottom ?? 42;
  const width = Math.max(target.clientWidth || 0, 280);
  const height = Math.max(target.clientHeight || 0, 280);

  return {
    width,
    height,
    chartArea: {
      left,
      right,
      top,
      bottom,
      width: Math.max(width - left - right, 180),
      height: Math.max(height - top - bottom, 160),
    },
  };
}

function renderWeeklyTrendChart(data, metric, elId) {
  const target = document.getElementById(elId);
  if (!target) return;

  const weeks = [...new Set(data.map(r=>r.week_start))].sort();
  const teams = ['A','B','C'];
  const rows  = [['週', ...teams.map(t=>'Team '+t)]];
  weeks.forEach(w => {
    const row = [formatCompactDate(w)];
    teams.forEach(t => row.push(
      data.filter(r=>r.week_start===w&&r.team===t).reduce((s,r)=>s+(r[metric]||0),0)
    ));
    rows.push(row);
  });

  if (rows.length < 2) {
    renderEmptyChart(elId, '表示できる週次データがまだありません。');
    return;
  }

  const dt = google.visualization.arrayToDataTable(rows);
  target.innerHTML = '';
  new google.visualization.LineChart(target).draw(dt, {
    ...baseChartOptions(),
    ...sizedChartOptions(target, { left: 44, right: 10, top: 34, bottom: 34 }),
    colors: [TEAM_COLOR.A, TEAM_COLOR.B, TEAM_COLOR.C],
    lineWidth: 3,
    pointSize: 6,
    crosshair: { trigger: 'focus', color: '#aeb6c8' },
  });
}

function renderTeamActivityChart(sources = {}) {
  const github = asArray(sources.github || D.github);
  const backlog = asArray(sources.backlog || D.backlog);
  const gchat = asArray(sources.gchat || D.gchat);

  const week   = latestActiveWeek(github, ['commits', 'prs_opened']);
  const blWeek = latestActiveWeek(backlog, ['tasks_completed']);
  const gcWeek = latestActiveWeek(gchat, ['messages_sent']);
  const rows = [['チーム','コミット','PR','完了タスク','Chatメッセージ']];
  ['A','B','C'].forEach(t => {
    const g  = github.filter(r=>r.week_start===week&&r.team===t)
                       .reduce((a,r)=>({c:a.c+(r.commits||0),p:a.p+(r.prs_opened||0)}),{c:0,p:0});
    const bl = backlog.filter(r=>r.week_start===blWeek&&r.team===t).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const gc = gchat.filter(r=>r.week_start===gcWeek&&r.team===t).reduce((s,r)=>s+(r.messages_sent||0),0);
    rows.push(['Team '+t, g.c, g.p, bl, gc]);
  });
  const hasActivity = rows.slice(1).some(row => row.slice(1).some(value => (value || 0) > 0));
  if (!hasActivity) {
    renderEmptyChart('chart_team_activity', '最新週の活動量データがまだありません。');
    return;
  }

  const target = document.getElementById('chart_team_activity');
  target.innerHTML = '';
  new google.visualization.BarChart(target)
    .draw(google.visualization.arrayToDataTable(rows), {
      ...baseChartOptions(),
      ...sizedChartOptions(target, { left: 70, right: 12, top: 34, bottom: 24 }),
      isStacked: false,
      legend: {
        position: 'top',
        alignment: 'start',
        textStyle: { color: '#5c667d', fontSize: 12 },
      },
      colors: [TEAM_COLOR.B, TEAM_COLOR.A, TEAM_COLOR.C, '#8991A9'],
      hAxis: {
        ...baseChartOptions().hAxis,
        minValue: 0,
        viewWindow: { min: 0 },
        gridlines: { color: '#eef2f8' },
      },
      vAxis: {
        ...baseChartOptions().vAxis,
        textStyle: { color: '#2c3242', fontSize: 12 },
        gridlines: { color: 'transparent' },
      },
    });
}

// ─── 個人アクティビティ ────────────────────────────────────────

function renderMemberPage() {
  const githubRows = asArray(D.github);
  const gchatRows = asArray(D.gchat);
  const backlogRows = asArray(D.backlog);
  const selMember = document.getElementById('filterMember').value;
  const selTeam   = document.getElementById('filterTeam').value;

  const sel     = document.getElementById('filterMember');
  const cur     = sel.value;
  const members = [...new Set(githubRows.map(r=>r.member))].sort();
  sel.innerHTML = '<option value="">全メンバー</option>' +
    members.map(m=>`<option value="${m}"${cur===m?' selected':''}>${m}</option>`).join('');

  // 全期間累積：メンバーごとに合算
  const ghCumulative = {};
  githubRows.forEach(r => {
    if (!ghCumulative[r.member]) ghCumulative[r.member] = { member: r.member, team: r.team, commits: 0, prs_opened: 0, prs_merged: 0, reviews_given: 0 };
    ghCumulative[r.member].commits      += r.commits       || 0;
    ghCumulative[r.member].prs_opened   += r.prs_opened    || 0;
    ghCumulative[r.member].prs_merged   += r.prs_merged    || 0;
    ghCumulative[r.member].reviews_given += r.reviews_given || 0;
  });
  let filtered = Object.values(ghCumulative);
  if (selTeam)   filtered = filtered.filter(r => r.team === selTeam);
  if (selMember) filtered = filtered.filter(r => r.member === selMember);

  const chartRows = [['メンバー','コミット','PRオープン','PRマージ','レビュー提出']];
  filtered.forEach(r => chartRows.push([r.member, r.commits, r.prs_opened, r.prs_merged, r.reviews_given]));
  if (chartRows.length > 1) {
    new google.visualization.BarChart(document.getElementById('chart_member'))
      .draw(google.visualization.arrayToDataTable(chartRows), {
        isStacked: true,
        legend: { position:'top' },
        backgroundColor: 'transparent',
        chartArea: { left:60, right:10, top:30, bottom:20 },
      });
  }

  const filtMembers = selMember ? [selMember]
    : (selTeam ? githubRows.filter(r=>r.team===selTeam).map(r=>r.member).filter((v,i,a)=>a.indexOf(v)===i)
               : members);
  const weeks = [...new Set(githubRows.map(r=>r.week_start))].sort();
  const trendRows = [['週', ...filtMembers]];
  weeks.forEach(w => {
    const row = [formatDisplayDate(w)];
    filtMembers.forEach(m => row.push(
      githubRows.filter(r=>r.week_start===w&&r.member===m).reduce((s,r)=>s+(r.commits||0),0)
    ));
    trendRows.push(row);
  });
  if (trendRows.length > 1) {
    new google.visualization.LineChart(document.getElementById('chart_commit_trend'))
      .draw(google.visualization.arrayToDataTable(trendRows), {
        legend: { position:'top' },
        backgroundColor: 'transparent',
        chartArea: { left:40, right:10, top:30, bottom:40 },
      });
  }

  let html = '<table><tr><th>メンバー</th><th>チーム</th><th>コミット</th><th>PR</th><th>レビュー</th><th>Chatメッセージ</th><th>完了タスク</th></tr>';
  filtMembers.forEach(m => {
    const g  = ghCumulative[m] || {};
    const gc = gchatRows.filter(r=>r.member===m).reduce((s,r)=>s+(r.messages_sent||0),0);
    const bl = backlogRows.filter(r=>r.member===m).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const team = g.team || '';
    html += `<tr><td>${m}</td><td><span class="badge badge-${team.toLowerCase()}">${team}</span></td>` +
      `<td>${g.commits||0}</td><td>${g.prs_opened||0}</td><td>${g.reviews_given||0}</td><td>${gc}</td><td>${bl}</td></tr>`;
  });
  html += '</table>';
  document.getElementById('memberTable').innerHTML = html;
}

// ─── 評価スコア ─────────────────────────────────────────────────

function getMemberTeam(name) {
  if (!D || !D.cohort || !Array.isArray(D.cohort.teams)) return '';
  for (const team of D.cohort.teams) {
    if ((team.members || []).some(m => name.includes(m) || m.includes(name))) return team.id;
  }
  return '';
}

function renderEvalPage() {
  const noDataStyle = 'display:flex;align-items:center;justify-content:center;height:100%;min-height:200px;color:#8991A9;font-size:14px;flex-direction:column;gap:8px';

  ['before','after'].forEach(timing => {
    const rows = D.eval.filter(r => r.timing === timing && r.evaluator_type === '本人評価');
    const id = timing === 'before' ? 'chart_radar_before' : 'chart_radar_after';
    if (!rows.length) {
      const msg = timing === 'after'
        ? '<span>After評価はまだ実施されていません</span><span style="font-size:12px">施策終了後に評価フォームへの回答が集まると表示されます</span>'
        : '<span>データがありません</span>';
      document.getElementById(id).innerHTML = `<div style="${noDataStyle}">${msg}</div>`;
      return;
    }
    const axes   = ['axis1_avg','axis2_avg','axis3_avg','axis4_avg'];
    const labels = ['上流工程力','実装技術力','AI活用力','チームコミュ'];
    const dt = new google.visualization.DataTable();
    dt.addColumn('string', '軸');
    ['A','B','C'].forEach(t => dt.addColumn('number','Team '+t));
    labels.forEach((lbl, i) => {
      const row = [lbl];
      ['A','B','C'].forEach(t => {
        const vals = rows.filter(r=>getMemberTeam(r.evaluatee)===t).map(r=>parseFloat(r[axes[i]])||0);
        row.push(vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0);
      });
      dt.addRow(row);
    });
    new google.visualization.LineChart(document.getElementById(id)).draw(dt, {
      colors: [TEAM_COLOR.A, TEAM_COLOR.B, TEAM_COLOR.C],
      legend: { position:'top' },
      backgroundColor: 'transparent',
      chartArea: { left:60, right:10, top:30, bottom:40 },
    });
  });

  const members = [...new Set(D.eval.map(r=>r.evaluatee))].sort();
  const role    = D.role;
  const colSpan = role === 'admin' ? 7 : 6;
  let html = '<table><tr><th>メンバー</th><th>チーム</th><th>評価者</th><th>Before平均</th><th>After平均</th><th>成長幅</th>';
  if (role === 'admin') html += '<th>判定 <span style="font-size:11px;font-weight:400;color:#8991A9">※Before評価の内容確認済みをマーク</span></th>';
  html += '</tr>';

  if (!members.length) {
    html += `<tr><td colspan="${colSpan}" style="color:#8991A9;text-align:center;padding:24px">評価データがまだありません</td></tr>`;
  }

  members.forEach(m => {
    ['本人評価','チームリーダー','施策責任者（畠山）'].forEach(etype => {
      const before = D.eval.filter(r=>r.evaluatee===m&&r.timing==='before'&&r.evaluator_type===etype);
      const after  = D.eval.filter(r=>r.evaluatee===m&&r.timing==='after' &&r.evaluator_type===etype);
      if (!before.length) return;
      const avg = rows => {
        const vals = rows.flatMap(r=>['axis1_avg','axis2_avg','axis3_avg','axis4_avg'].map(k=>parseFloat(r[k])||0));
        return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : '-';
      };
      const b = avg(before), a = avg(after);
      const diff  = (b!=='-'&&a!=='-') ? (parseFloat(a)-parseFloat(b)).toFixed(2) : '-';
      const team  = getMemberTeam(m);
      const color = diff>0 ? 'color:#527EEC;font-weight:700' : diff<0 ? 'color:#D34B4B' : '';
      const approved = before[0]?.admin_approved;
      html += `<tr><td>${m}</td><td><span class="badge badge-${team.toLowerCase()}">${team || '?'}</span></td>`;
      html += `<td>${etype}</td><td>${b}</td><td>${a}</td>`;
      html += `<td style="${color}">${diff>0?'+':''}${diff}</td>`;
      if (role === 'admin') {
        const btnClass = approved ? 'approved-btn done' : 'approved-btn';
        const disabled  = approved ? ' disabled' : '';
        const tip = 'Before評価の内容を管理者が確認済みであることを記録します（確認後は変更不可）';
        html += `<td><button class="${btnClass}"${disabled} title="${tip}" onclick="approveEval('${m}','before',this)">${approved?'確認済み':'確認する'}</button></td>`;
      }
      html += '</tr>';
    });
  });
  html += '</table>';
  document.getElementById('evalTable').innerHTML = html;
}

function approveEval(evaluatee, timing, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = '確認中...';
    btn.classList.add('loading');
  }
  const token = localStorage.getItem(TOKEN_KEY);
  const url = GAS_API_URL + '?action=approve&evaluatee=' + encodeURIComponent(evaluatee) +
    '&timing=' + encodeURIComponent(timing) + '&token=' + encodeURIComponent(token);
  fetch(url)
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        if (btn) {
          btn.classList.remove('loading');
          btn.classList.add('done');
          btn.textContent = '確認済み';
        }
      } else {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.textContent = '確認する';
        }
        alert('承認エラー: ' + (res.error || '不明なエラー'));
      }
    })
    .catch(() => {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = '確認する';
      }
    });
}

// ─── ゲーミフィケーション ─────────────────────────────────────

// week_start がシート上でDate型になりJSON化でISO文字列になるケースを正規化して 'YYYY-MM-DD' に揃える
function normalizeWeek_(ws) {
  if (!ws) return '';
  const s = String(ws);
  if (s.length <= 10) return s;
  // "2026-04-20T15:00:00.000Z" → JST (UTC+9) に戻して日付部分を取る
  const d = new Date(new Date(s).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function collectAchievements() {
  const src = D.achievements || [];
  if (Array.isArray(src)) {
    const badges = src.filter(item => (
      pickFirstString(item, ['type'], '').toLowerCase() === 'badge' ||
      pickFirstString(item, ['badge', 'badge_name', 'badge_title', 'badge_label', 'badge_id'], '')
    ));
    const levels = src.filter(item => (
      pickFirstString(item, ['type'], '').toLowerCase() === 'level' ||
      pickFirstValue(item, ['level', 'level_value', 'current_level'], '') !== ''
    ));
    return { badges, levels };
  }

  if (src && typeof src === 'object') {
    return {
      badges: asArray(src.badges || src.badge || src.items).filter(Boolean),
      levels: asArray(src.levels || src.level || src.ranks).filter(Boolean),
    };
  }
  return { badges: [], levels: [] };
}

function renderAchievementPanels() {
  const badgesEl = document.getElementById('badgesPanel');
  const levelsEl = document.getElementById('levelsPanel');
  if (!badgesEl || !levelsEl) return;

  if (CAPS && !CAPS.canViewAchievements) {
    badgesEl.innerHTML = '<p class="subtle-text">この表示は現在の権限では利用できません。</p>';
    levelsEl.innerHTML = '<p class="subtle-text">この表示は現在の権限では利用できません。</p>';
    return;
  }

  const { badges, levels } = collectAchievements();
  const badgeRows = badges.map((item) => ({
    name: pickFirstString(item, ['badge', 'badge_name', 'badge_title', 'badge_label', 'title'], 'バッジ'),
    emoji: pickFirstString(item, ['emoji', 'badge_emoji'], ''),
    member: pickFirstString(item, ['member', 'user', 'name', 'recipient'], ''),
    team: pickFirstString(item, ['team', 'team_id'], ''),
    detail: pickFirstString(item, ['description', 'desc', 'reason'], ''),
    points: Number(pickFirstValue(item, ['points', 'point', 'points_awarded'], 0)) || 0,
  }));

  // Level records may not exist yet. Derive levels from earned badge points.
  const levelsByMember = {};
  (badges || []).forEach((item) => {
    const member = pickFirstString(item, ['member', 'user', 'name', 'recipient'], '');
    if (!member) return;
    const team = pickFirstString(item, ['team', 'team_id'], '');
    const points = Number(pickFirstValue(item, ['points', 'point', 'points_awarded'], 0)) || 0;
    if (!levelsByMember[member]) levelsByMember[member] = { member, team, xp: 0 };
    levelsByMember[member].xp += points;
  });
  const explicitLevels = levels.map((item) => ({
    member: pickFirstString(item, ['member', 'user', 'name'], ''),
    team: pickFirstString(item, ['team', 'team_id'], ''),
    level: Number(pickFirstValue(item, ['level', 'level_value', 'current_level'], 0)) || 0,
    label: pickFirstString(item, ['level_name', 'title', 'rank'], ''),
    xp: Number(pickFirstValue(item, ['xp', 'points', 'score'], 0)) || 0,
  })).filter(row => row.member);

  const derivedLevels = Object.values(levelsByMember).map((row) => {
    const lv = levelFromPoints_(row.xp);
    return {
      member: row.member,
      team: row.team,
      level: lv.level,
      label: lv.label,
      xp: row.xp,
    };
  });
  const levelRows = (explicitLevels.length ? explicitLevels : derivedLevels)
    .sort((a, b) => b.level - a.level || b.xp - a.xp);

  if (!badgeRows.length) {
    badgesEl.innerHTML = '<p class="subtle-text">バッジ実績はまだありません。</p>';
  } else {
    badgesEl.innerHTML = `<div class="achievement-list">` + badgeRows.slice(0, 12).map((row) => `
      <div class="achievement-item">
        <div class="achievement-main">
          <strong>${row.emoji ? `${escapeHtml(row.emoji)} ` : ''}${escapeHtml(row.name)}</strong>
          ${row.member ? `<span>${escapeHtml(row.member)}${row.team ? ` / Team ${escapeHtml(row.team)}` : ''}${row.points ? ` / ${row.points}pt` : ''}</span>` : ''}
        </div>
        ${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ''}
      </div>
    `).join('') + `</div>`;
  }

  if (!levelRows.length) {
    levelsEl.innerHTML = '<p class="subtle-text">レベル実績はまだありません。</p>';
  } else {
    levelsEl.innerHTML = `<div class="levels-list">` + levelRows.slice(0, 10).map((row) => `
      <div class="level-item">
        <div>
          <strong>${escapeHtml(row.member || 'member')}</strong>
          <span>${escapeHtml(row.label || `Level ${row.level}`)}</span>
        </div>
        <div class="level-meta">
          <span>Lv.${row.level}</span>
          <span>${row.xp}pt</span>
        </div>
      </div>
    `).join('') + `</div>`;
  }
}

function levelFromPoints_(points) {
  const p = Number(points) || 0;
  if (p >= 300) return { level: 5, label: 'AIネイティブマスター' };
  if (p >= 160) return { level: 4, label: 'テックリード候補' };
  if (p >= 80) return { level: 3, label: 'シニアビルダー' };
  if (p >= 30) return { level: 2, label: 'ジュニアビルダー' };
  return { level: 1, label: '見習いエンジニア' };
}

function renderGamificationPage() {
  const githubRows = asArray(D.github);
  const gchatRows = asArray(D.gchat);
  const backlogRows = asArray(D.backlog);
  const members = [...new Set(githubRows.map(r=>r.member))].sort();
  const points  = members.map(m => {
    const gh = githubRows.filter(r=>r.member===m).reduce((a,r)=>({
      commits: a.commits+(r.commits||0),
      prs:     a.prs+(r.prs_opened||0),
      reviews: a.reviews+(r.reviews_given||0),
    }), {commits:0,prs:0,reviews:0});
    const gc = gchatRows.filter(r=>r.member===m).reduce((s,r)=>s+(r.messages_sent||0)+(r.reactions_given||0)+(r.reactions_received||0),0);
    const bl = backlogRows.filter(r=>r.member===m).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const pt = gh.commits*3 + gh.prs*5 + gh.reviews*4 + gc*1 + bl*4;
    const team = (githubRows.find(r=>r.member===m)||{}).team || '';
    return { name:m, team, pt, commits:gh.commits, prs:gh.prs, reviews:gh.reviews, chat:gc, tasks:bl };
  }).sort((a,b) => b.pt-a.pt);

  if (!points.length) {
    renderEmptyChart('chart_rank', 'ゲーミフィケーションの集計データがまだありません。');
    renderEmptyChart('chart_streak', '連続活動データがまだありません。');
    document.getElementById('rankTable').innerHTML =
      '<table><tr><th>順位</th><th>メンバー</th><th>チーム</th><th>総合PT</th><th>コミット×3</th><th>PR×5</th><th>レビュー×4</th><th>Chat×1</th><th>タスク×4</th></tr>' +
      '<tr><td colspan="9" style="color:#8991A9;text-align:center">集計対象データがありません</td></tr></table>';
    renderAchievementPanels();
    return;
  }

  const rows = [['メンバー','ポイント',{role:'style'}]];
  points.forEach((p,i) => {
    const color = i===0 ? '#f4b400' : i===1 ? '#8991A9' : i===2 ? '#b88652' : TEAM_COLOR[p.team]||TEAM_COLOR.B;
    rows.push([p.name+'（'+p.pt+'pt）', p.pt, 'color:'+color]);
  });
  new google.visualization.BarChart(document.getElementById('chart_rank'))
    .draw(google.visualization.arrayToDataTable(rows), {
      legend: 'none',
      backgroundColor: 'transparent',
      chartArea: { left:120, right:10, top:10, bottom:20 },
    });

  // week_start を正規化してから一意週リストを作成（型不整合対策）
  const weeks = [...new Set(githubRows.map(r=>normalizeWeek_(r.week_start)))].sort();
  const streakRows = [['メンバー','連続活動週数']];
  members.forEach(m => {
    let streak = 0, started = false;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      const active = githubRows.some(r => normalizeWeek_(r.week_start) === w && r.member === m && (r.commits || 0) > 0)
                  || gchatRows.some(r => normalizeWeek_(r.week_start) === w && r.member === m && (r.messages_sent || 0) > 0);
      if (active) { started = true; streak++; }
      else if (started) break;
      // started=false かつ inactive → まだ活動開始前の週なのでスキップ
    }
    streakRows.push([m, streak]);
  });

  const allZero = streakRows.slice(1).every(r => r[1] === 0);
  if (allZero) {
    document.getElementById('chart_streak').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8991A9;font-size:14px;text-align:center;flex-direction:column;gap:6px">' +
      '<span>まだ連続活動データが蓄積されていません</span>' +
      '<span style="font-size:12px">GitHub コミットまたは Chat 投稿が記録されると表示されます</span></div>';
  } else {
    new google.visualization.BarChart(document.getElementById('chart_streak'))
      .draw(google.visualization.arrayToDataTable(streakRows), {
        colors: [TEAM_COLOR.B],
        legend: 'none',
        backgroundColor: 'transparent',
        chartArea: { left:60, right:10, top:10, bottom:20 },
      });
  }

  let html = '<table><tr><th>順位</th><th>メンバー</th><th>チーム</th><th>総合PT</th>' +
    '<th>コミット×3</th><th>PR×5</th><th>レビュー×4</th><th>Chat×1</th><th>タスク×4</th></tr>';
  points.forEach((p,i) => {
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'位';
    html += `<tr><td>${medal}</td><td>${p.name}</td>` +
      `<td><span class="badge badge-${p.team.toLowerCase()}">${p.team}</span></td>` +
      `<td><b>${p.pt}</b></td><td>${p.commits}</td><td>${p.prs}</td>` +
      `<td>${p.reviews}</td><td>${p.chat}</td><td>${p.tasks}</td></tr>`;
  });
  html += '</table>';
  document.getElementById('rankTable').innerHTML = html;
  renderAchievementPanels();
}

// ─── AI活用 ───────────────────────────────────────────────────

const CLAUDE_PRICES = {
  'claude-opus-4-7':   { in: 5, out: 25,  cr: 0.50, cc: 6.25 },
  'claude-opus-4-5':   { in: 5, out: 25,  cr: 0.50, cc: 6.25 },
  'claude-sonnet-4-6': { in: 3, out: 15,  cr: 0.30, cc: 3.75 },
  'claude-sonnet-4-5': { in: 3, out: 15,  cr: 0.30, cc: 3.75 },
  'claude-haiku-4-5':  { in: 1, out: 5,   cr: 0.10, cc: 1.25 },
};

function calcClaudeCost_(rows) {
  const p = CLAUDE_PRICES['claude-sonnet-4-6'];
  return rows.reduce((total, r) => total +
    (r.input_tokens / 1e6) * p.in +
    (r.output_tokens / 1e6) * p.out +
    (r.cache_read_tokens / 1e6) * p.cr +
    (r.cache_creation_tokens / 1e6) * p.cc, 0);
}

function renderClaudePage() {
  const weekly    = (D.claude && D.claude.weekly)    || [];
  const skills    = (D.claude && D.claude.skills)    || [];
  const subagents = (D.claude && D.claude.subagents) || [];

  // ─── KPI カード ─────────────────────────────────────────────
  const totalSessions = weekly.reduce((s, r) => s + (r.sessions || 0), 0);
  const totalTokensM  = weekly.reduce((s, r) =>
    s + (r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens) / 1e6, 0);
  const totalCost     = calcClaudeCost_(weekly);

  document.getElementById('claude-kpi-cards').innerHTML =
    scoreCard(totalSessions,          '累計セッション数',             '') +
    scoreCard('$' + totalCost.toFixed(2), '推定コスト（Sonnet基準）', '') +
    scoreCard(totalTokensM.toFixed(1) + 'M', '総トークン数',          '');

  // ─── 週次トークン推移 ─────────────────────────────────────────
  (function() {
    const target = document.getElementById('chart_claude_trend');
    if (!target) return;
    const weeks = [...new Set(weekly.map(r => r.week_start))].sort();
    if (weeks.length === 0) { renderEmptyChart('chart_claude_trend', 'データが送信されるとここに表示されます。'); return; }
    const rows = [['週', 'Team A', 'Team B', 'Team C']];
    weeks.forEach(w => {
      const row = [formatCompactDate(w)];
      ['A','B','C'].forEach(t => {
        const total = weekly.filter(r => r.week_start === w && r.team === t)
          .reduce((s, r) => s + r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens, 0);
        row.push(Math.round(total / 1000)); // K tokens
      });
      rows.push(row);
    });
    target.innerHTML = '';
    new google.visualization.LineChart(target).draw(
      google.visualization.arrayToDataTable(rows), {
        ...baseChartOptions(),
        ...sizedChartOptions(target, { left: 50, right: 10, top: 34, bottom: 34 }),
        colors: [TEAM_COLOR.A, TEAM_COLOR.B, TEAM_COLOR.C],
        lineWidth: 3, pointSize: 6,
        vAxis: { ...baseChartOptions().vAxis, title: 'トークン（K）' },
      }
    );
  })();

  // ─── メンバー別セッション数 ───────────────────────────────────
  (function() {
    const target = document.getElementById('chart_claude_sessions');
    if (!target) return;
    const memberTotals = {};
    weekly.forEach(r => {
      if (!memberTotals[r.member]) memberTotals[r.member] = { sessions: 0, team: r.team };
      memberTotals[r.member].sessions += r.sessions || 0;
    });
    const entries = Object.entries(memberTotals).sort((a, b) => b[1].sessions - a[1].sessions);
    if (entries.length === 0) { renderEmptyChart('chart_claude_sessions', 'データが送信されるとここに表示されます。'); return; }
    const rows = [['メンバー', 'セッション数', { role: 'style' }]];
    entries.forEach(([name, v]) => {
      rows.push([name, v.sessions, 'color:' + (TEAM_COLOR[v.team] || TEAM_COLOR.B)]);
    });
    target.innerHTML = '';
    new google.visualization.BarChart(target).draw(
      google.visualization.arrayToDataTable(rows), {
        ...baseChartOptions(),
        ...sizedChartOptions(target, { left: 70, right: 10, top: 20, bottom: 24 }),
        legend: 'none',
      }
    );
  })();

  // ─── スキル Top10 ─────────────────────────────────────────────
  (function() {
    const target = document.getElementById('chart_claude_skills');
    if (!target) return;
    const top = skills.slice(0, 10);
    if (top.length === 0) { renderEmptyChart('chart_claude_skills', 'スキル使用実績がまだありません。'); return; }
    const rows = [['スキル', '件数']];
    top.forEach(s => rows.push([s.name, s.count]));
    target.innerHTML = '';
    new google.visualization.BarChart(target).draw(
      google.visualization.arrayToDataTable(rows), {
        ...baseChartOptions(),
        ...sizedChartOptions(target, { left: 120, right: 10, top: 20, bottom: 24 }),
        legend: 'none',
        colors: [TEAM_COLOR.B],
      }
    );
  })();

  // ─── サブエージェント分布 ─────────────────────────────────────
  (function() {
    const target = document.getElementById('chart_claude_subagents');
    if (!target) return;
    if (subagents.length === 0) { renderEmptyChart('chart_claude_subagents', 'サブエージェント使用実績がまだありません。'); return; }
    const rows = [['タイプ', '件数']];
    subagents.forEach(s => rows.push([s.type, s.count]));
    target.innerHTML = '';
    new google.visualization.BarChart(target).draw(
      google.visualization.arrayToDataTable(rows), {
        ...baseChartOptions(),
        ...sizedChartOptions(target, { left: 80, right: 10, top: 20, bottom: 24 }),
        legend: 'none',
        colors: [TEAM_COLOR.C],
      }
    );
  })();

  // ─── メンバー別サマリーテーブル ───────────────────────────────
  const memberSummary = {};
  weekly.forEach(r => {
    if (!memberSummary[r.member]) memberSummary[r.member] = {
      team: r.team, sessions: 0, turns: 0,
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0,
      skill_calls: 0, subagent_calls: 0,
    };
    const m = memberSummary[r.member];
    m.sessions      += r.sessions      || 0;
    m.turns         += r.turns         || 0;
    m.input_tokens  += r.input_tokens  || 0;
    m.output_tokens += r.output_tokens || 0;
    m.cache_read_tokens    += r.cache_read_tokens    || 0;
    m.cache_creation_tokens += r.cache_creation_tokens || 0;
    m.skill_calls   += r.skill_calls   || 0;
    m.subagent_calls += r.subagent_calls || 0;
  });

  const memberEntries = Object.entries(memberSummary)
    .sort((a, b) => b[1].sessions - a[1].sessions);

  let tHtml = '<table><tr><th>メンバー</th><th>チーム</th><th>セッション</th><th>総ターン</th>' +
    '<th>総トークン</th><th>推定コスト</th><th>スキル呼出</th><th>Subagent</th></tr>';
  if (memberEntries.length === 0) {
    tHtml += '<tr><td colspan="8" style="color:#8991A9;text-align:center">まだデータがありません。下のセットアップ手順でフックを導入してください。</td></tr>';
  } else {
    memberEntries.forEach(([name, v]) => {
      const totalTok = ((v.input_tokens + v.output_tokens + v.cache_read_tokens + v.cache_creation_tokens) / 1e6).toFixed(2);
      const cost = calcClaudeCost_([v]).toFixed(3);
      tHtml += `<tr><td>${escapeHtml(name)}</td>` +
        `<td><span class="badge badge-${v.team.toLowerCase()}">${v.team}</span></td>` +
        `<td>${v.sessions}</td><td>${v.turns}</td>` +
        `<td>${totalTok}M</td><td>$${cost}</td>` +
        `<td>${v.skill_calls}</td><td>${v.subagent_calls}</td></tr>`;
    });
  }
  tHtml += '</table>';
  document.getElementById('claude-member-table').innerHTML = tHtml;
}

// ─── 自己評価 ─────────────────────────────────────────────────

function renderSelfEvalPage() {
  const selfEval = D.eval.filter(r => r.evaluator_type === '本人評価');
  let html = '<table><tr><th>メンバー</th><th>タイミング</th><th>上流工程力</th><th>実装技術力</th><th>AI活用力</th><th>チームコミュ</th></tr>';
  selfEval.forEach(r => {
    html += `<tr><td>${r.evaluatee}</td><td>${r.timing}</td><td>${r.axis1_avg||'-'}</td>` +
      `<td>${r.axis2_avg||'-'}</td><td>${r.axis3_avg||'-'}</td><td>${r.axis4_avg||'-'}</td></tr>`;
  });
  if (!selfEval.length) html += '<tr><td colspan="6" style="color:#8991A9;text-align:center">評価データがまだありません</td></tr>';
  html += '</table>';
  document.getElementById('myEvalTable').innerHTML = html;

  if (D.role === 'admin') {
    let ahtml = '<table><tr><th>メンバー</th><th>チーム</th><th>評価者タイプ</th><th>タイミング</th>' +
      '<th>上流工程力</th><th>実装技術力</th><th>AI活用力</th><th>チームコミュ</th><th>承認</th></tr>';
    D.eval.forEach(r => {
      const team     = getMemberTeam(r.evaluatee);
      const approved = r.admin_approved;
      ahtml += `<tr><td>${r.evaluatee}</td><td><span class="badge badge-${team.toLowerCase()}">${team || '?'}</span></td>` +
        `<td>${r.evaluator_type}</td><td>${r.timing}</td>` +
        `<td>${r.axis1_avg||'-'}</td><td>${r.axis2_avg||'-'}</td><td>${r.axis3_avg||'-'}</td><td>${r.axis4_avg||'-'}</td>` +
        `<td><button class="approved-btn${approved?' done':''}" ` +
        `onclick="approveEval('${r.evaluatee}','${r.timing}',this)"${approved?' disabled':''}>${approved?'確認済み':'確認する'}</button></td></tr>`;
    });
    if (!D.eval.length) ahtml += '<tr><td colspan="9" style="color:#8991A9;text-align:center">評価データがまだありません</td></tr>';
    ahtml += '</table>';
    document.getElementById('adminEvalTable').innerHTML = ahtml;
  }
}
