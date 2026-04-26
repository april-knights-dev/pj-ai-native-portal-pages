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
  applyLandingMeta(D.cohort);

  // ロールバッジ
  const badgeEl = document.getElementById('role-badge');
  badgeEl.textContent = role === 'admin' ? '管理者' : role === 'member' ? '参加メンバー' : '閲覧者';

  // ナビゲーション構築
  const pages = [
    { id: 'overview',     label: '施策概要',           roles: ['admin','member','viewer'] },
    { id: 'summary',      label: '全体サマリー',         roles: ['admin','member','viewer'] },
    { id: 'member',       label: '個人アクティビティ',   roles: ['admin','member'] },
    { id: 'eval',         label: '評価スコア',           roles: ['admin','member'] },
    { id: 'gamification', label: 'ゲーミフィケーション', roles: ['admin','member'] },
    { id: 'selfevals',    label: '自己評価',             roles: ['admin','member'] },
    { id: 'claude',       label: 'AI活用',               roles: ['admin','member'] },
  ].filter(p => p.roles.includes(role));

  const nav = document.getElementById('main-nav');
  nav.innerHTML = pages.map((p, i) =>
    `<button ${i===0 ? 'class="active"' : ''} onclick="showPage('${p.id}',this)">${p.label}</button>`
  ).join('');

  renderAppHero(D.cohort, pages, role);

  // viewer notice
  if (role === 'viewer') {
    document.getElementById('viewer-notice').style.display = 'block';
  }

  // 評価フォームリンク
  if (D.evalFormUrl) {
    document.getElementById('evalFormLink').innerHTML =
      `<a class="btn btn-primary" href="${D.evalFormUrl}" target="_blank">評価フォームを開く</a>`;
  } else {
    document.getElementById('evalFormLink').innerHTML =
      '<p class="subtle-text">フォームURLは管理者が設定中です。</p>';
  }

  // 評価テーブルタイトル（admin は承認ボタンあり）
  if (role === 'admin') {
    document.getElementById('evalTableTitle').textContent = 'Before→After 成長スコア';
    document.getElementById('adminEvalSection').style.display = 'block';
  }

  renderOverviewPage();
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
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page_' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'summary')      requestAnimationFrame(() => renderSummaryPage());
  if (name === 'member')       renderMemberPage();
  if (name === 'eval')         renderEvalPage();
  if (name === 'gamification') renderGamificationPage();
  if (name === 'selfevals')    renderSelfEvalPage();
  if (name === 'claude')       requestAnimationFrame(() => renderClaudePage());
}

function handleWindowResize() {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;

    if (activePage.id === 'page_summary') {
      renderSummaryPage();
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

function renderOverviewPage() {
  const cohort = D.cohort;
  const memberCount = cohort.teams.reduce((sum, team) => sum + team.members.length, 0);
  const timelineMeta = buildPhaseTimeline(cohort);

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

  const teamsHtml = cohort.teams.map(t => `
    <div class="team-card team-${t.id.toLowerCase()}">
      <div class="team-card-head">
        <span class="badge badge-${t.id.toLowerCase()}">Team ${t.id}</span>
        <h4>${t.theme}</h4>
      </div>
      <div class="members">メンバー: ${t.members.join('・')} / リーダー: ${t.leader}</div>
      <div class="team-po">PO: ${t.po.join('・')}</div>
    </div>`).join('');

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
        <div class="overview-fact"><span>Team Setup</span><strong>${cohort.teams.length}チーム / ${memberCount}名</strong></div>
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
  <div class="card" style="margin-top:16px">
    <span class="section-kicker">Teams</span>
    <h2>チーム構成（${cohort.name}）</h2>
    <div class="teams-grid">${teamsHtml}</div>
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
  const src   = role === 'viewer' ? D.gh_team : D.github;
  const week  = latestActiveWeek(src, ['commits', 'prs_opened', 'prs_merged', 'reviews_given']);
  const wGH   = src.filter(r => r.week_start === week);
  const gcWeek = latestActiveWeek(D.gchat, ['messages_sent']);
  const blWeek = latestActiveWeek(D.backlog, ['tasks_completed']);
  const wGC   = D.gchat.filter(r => r.week_start === gcWeek);
  const wBL   = D.backlog.filter(r => r.week_start === blWeek);
  const latestLabel = week ? formatDisplayDate(week) : '未取得';

  document.getElementById('scoreCards').innerHTML =
    scoreCard(wGH.reduce((s,r)=>s+(r.commits||0),0),   '今週のコミット数', latestLabel) +
    scoreCard(wGC.reduce((s,r)=>s+(r.messages_sent||0),0), '今週のChatメッセージ', formatDisplayDate(gcWeek || week)) +
    scoreCard(wBL.reduce((s,r)=>s+(r.tasks_completed||0),0), '今週の完了タスク', formatDisplayDate(blWeek || week));

  document.getElementById('updated-at').textContent = latestLabel;
  setText('summary-updated', latestLabel);
  setText('summary-caption', '各チームの週次推移を折れ線で比較し、最新週の活動量はカードと横棒で確認できるようにしています。');
  setText('meta_chart_week', summaryMeta(src));
  setText('meta_chart_gchat_week', summaryMeta(D.gchat));
  setText('meta_chart_backlog_week', summaryMeta(D.backlog));
  setText('meta_chart_team_activity', latestLabel === '未取得' ? 'データ待ち' : `最新週 ${latestLabel}`);

  renderWeeklyTrendChart(src,      'commits',         'chart_week');
  renderWeeklyTrendChart(D.gchat,  'messages_sent',   'chart_gchat_week');
  renderWeeklyTrendChart(D.backlog,'tasks_completed',  'chart_backlog_week');
  renderTeamActivityChart();
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

function renderTeamActivityChart() {
  const week   = latestActiveWeek(D.github, ['commits', 'prs_opened']);
  const blWeek = latestActiveWeek(D.backlog, ['tasks_completed']);
  const gcWeek = latestActiveWeek(D.gchat, ['messages_sent']);
  const rows = [['チーム','コミット','PR','完了タスク','Chatメッセージ']];
  ['A','B','C'].forEach(t => {
    const g  = D.github.filter(r=>r.week_start===week&&r.team===t)
                       .reduce((a,r)=>({c:a.c+(r.commits||0),p:a.p+(r.prs_opened||0)}),{c:0,p:0});
    const bl = D.backlog.filter(r=>r.week_start===blWeek&&r.team===t).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const gc = D.gchat.filter(r=>r.week_start===gcWeek&&r.team===t).reduce((s,r)=>s+(r.messages_sent||0),0);
    rows.push(['Team '+t, g.c, g.p, bl, gc]);
  });
  if (rows.length < 2) {
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
  const selMember = document.getElementById('filterMember').value;
  const selTeam   = document.getElementById('filterTeam').value;

  const sel     = document.getElementById('filterMember');
  const cur     = sel.value;
  const members = [...new Set(D.github.map(r=>r.member))].sort();
  sel.innerHTML = '<option value="">全メンバー</option>' +
    members.map(m=>`<option value="${m}"${cur===m?' selected':''}>${m}</option>`).join('');

  // 全期間累積：メンバーごとに合算
  const ghCumulative = {};
  D.github.forEach(r => {
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
    : (selTeam ? D.github.filter(r=>r.team===selTeam).map(r=>r.member).filter((v,i,a)=>a.indexOf(v)===i)
               : members);
  const weeks = [...new Set(D.github.map(r=>r.week_start))].sort();
  const trendRows = [['週', ...filtMembers]];
  weeks.forEach(w => {
    const row = [formatDisplayDate(w)];
    filtMembers.forEach(m => row.push(
      D.github.filter(r=>r.week_start===w&&r.member===m).reduce((s,r)=>s+(r.commits||0),0)
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
    const gc = D.gchat.filter(r=>r.member===m).reduce((s,r)=>s+(r.messages_sent||0),0);
    const bl = D.backlog.filter(r=>r.member===m).reduce((s,r)=>s+(r.tasks_completed||0),0);
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
        html += `<td><button class="${btnClass}"${disabled} title="${tip}" onclick="approveEval('${m}','before')">${approved?'確認済み':'確認する'}</button></td>`;
      }
      html += '</tr>';
    });
  });
  html += '</table>';
  document.getElementById('evalTable').innerHTML = html;
}

function approveEval(evaluatee, timing) {
  const token = localStorage.getItem(TOKEN_KEY);
  const url = GAS_API_URL + '?action=approve&evaluatee=' + encodeURIComponent(evaluatee) +
    '&timing=' + encodeURIComponent(timing) + '&token=' + encodeURIComponent(token);
  fetch(url)
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        fetchData(token); // データ再取得
      } else {
        alert('承認エラー: ' + (res.error || '不明なエラー'));
      }
    });
}

// ─── ゲーミフィケーション ─────────────────────────────────────

function renderGamificationPage() {
  const members = [...new Set(D.github.map(r=>r.member))].sort();
  const points  = members.map(m => {
    const gh = D.github.filter(r=>r.member===m).reduce((a,r)=>({
      commits: a.commits+(r.commits||0),
      prs:     a.prs+(r.prs_opened||0),
      reviews: a.reviews+(r.reviews_given||0),
    }), {commits:0,prs:0,reviews:0});
    const gc = D.gchat.filter(r=>r.member===m).reduce((s,r)=>s+(r.messages_sent||0)+(r.reactions_given||0)+(r.reactions_received||0),0);
    const bl = D.backlog.filter(r=>r.member===m).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const pt = gh.commits*3 + gh.prs*5 + gh.reviews*4 + gc*1 + bl*4;
    const team = (D.github.find(r=>r.member===m)||{}).team || '';
    return { name:m, team, pt, commits:gh.commits, prs:gh.prs, reviews:gh.reviews, chat:gc, tasks:bl };
  }).sort((a,b) => b.pt-a.pt);

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

  const weeks = [...new Set(D.github.map(r=>r.week_start))].sort();
  const streakRows = [['メンバー','連続活動週数']];
  members.forEach(m => {
    let streak = 0;
    for (let i=weeks.length-1; i>=0; i--) {
      const active = D.github.some(r=>r.week_start===weeks[i]&&r.member===m&&(r.commits||0)>0)
                  || D.gchat.some(r=>r.week_start===weeks[i]&&r.member===m&&(r.messages_sent||0)>0);
      if (active) streak++; else break;
    }
    streakRows.push([m, streak]);
  });
  new google.visualization.BarChart(document.getElementById('chart_streak'))
    .draw(google.visualization.arrayToDataTable(streakRows), {
      colors: [TEAM_COLOR.B],
      legend: 'none',
      backgroundColor: 'transparent',
      chartArea: { left:60, right:10, top:10, bottom:20 },
    });

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
      const team     = r.team || '';
      const approved = r.admin_approved;
      ahtml += `<tr><td>${r.evaluatee}</td><td><span class="badge badge-${team.toLowerCase()}">${team}</span></td>` +
        `<td>${r.evaluator_type}</td><td>${r.timing}</td>` +
        `<td>${r.axis1_avg||'-'}</td><td>${r.axis2_avg||'-'}</td><td>${r.axis3_avg||'-'}</td><td>${r.axis4_avg||'-'}</td>` +
        `<td><button class="approved-btn${approved?' done':''}" ` +
        `onclick="approveEval('${r.evaluatee}','${r.timing}')"${approved?' disabled':''}>${approved?'済':'承認'}</button></td></tr>`;
    });
    if (!D.eval.length) ahtml += '<tr><td colspan="9" style="color:#8991A9;text-align:center">評価データがまだありません</td></tr>';
    ahtml += '</table>';
    document.getElementById('adminEvalTable').innerHTML = ahtml;
  }
}
