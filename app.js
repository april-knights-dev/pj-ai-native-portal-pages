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

function init() {
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
      renderApp();
      showApp();
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
  ].filter(p => p.roles.includes(role));

  const nav = document.getElementById('main-nav');
  nav.innerHTML = pages.map((p, i) =>
    `<button ${i===0 ? 'class="active"' : ''} onclick="showPage('${p.id}',this)">${p.label}</button>`
  ).join('');

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
    document.getElementById('evalTableTitle').textContent = 'Before→After 成長スコア（管理者: 承認ボタンで確認済みにできます）';
    document.getElementById('adminEvalSection').style.display = 'block';
  }

  renderOverviewPage();
  renderSummaryPage();
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

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page_' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'member')       renderMemberPage();
  if (name === 'eval')         renderEvalPage();
  if (name === 'gamification') renderGamificationPage();
  if (name === 'selfevals')    renderSelfEvalPage();
}

// ─── 施策概要 ─────────────────────────────────────────────────

function renderOverviewPage() {
  const cohort = D.cohort;
  const memberCount = cohort.teams.reduce((sum, team) => sum + team.members.length, 0);

  const phasesHtml = cohort.phases.map(p => `
    <div class="timeline-item">
      <span class="period">${p.period}</span>
      <h4>${p.name}</h4>
      <p>${p.desc}</p>
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
    <p class="overview-copy">
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
  const week  = latestWeek(src);
  const wGH   = src.filter(r => r.week_start === week);
  const gcWeek = latestWeek(D.gchat);
  const blWeek = latestWeek(D.backlog);
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
    chartArea: { left: 46, right: 18, top: 34, bottom: 42, width: '100%', height: '74%' },
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
    colors: [TEAM_COLOR.A, TEAM_COLOR.B, TEAM_COLOR.C],
    lineWidth: 3,
    pointSize: 6,
    crosshair: { trigger: 'focus', color: '#aeb6c8' },
  });
}

function renderTeamActivityChart() {
  const week   = latestWeek(D.github);
  const blWeek = latestWeek(D.backlog);
  const gcWeek = latestWeek(D.gchat);
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
      isStacked: false,
      legend: {
        position: 'top',
        alignment: 'start',
        textStyle: { color: '#5c667d', fontSize: 12 },
      },
      colors: [TEAM_COLOR.B, TEAM_COLOR.A, TEAM_COLOR.C, '#8991A9'],
      chartArea: { left: 70, right: 18, top: 34, bottom: 30, width: '100%', height: '76%' },
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
  const week      = latestWeek(D.github);

  const sel     = document.getElementById('filterMember');
  const cur     = sel.value;
  const members = [...new Set(D.github.map(r=>r.member))].sort();
  sel.innerHTML = '<option value="">全メンバー</option>' +
    members.map(m=>`<option value="${m}"${cur===m?' selected':''}>${m}</option>`).join('');

  let filtered = D.github.filter(r => r.week_start === week);
  if (selTeam)   filtered = filtered.filter(r => r.team === selTeam);
  if (selMember) filtered = filtered.filter(r => r.member === selMember);

  const chartRows = [['メンバー','コミット','PRオープン','PRマージ','レビュー提出']];
  filtered.forEach(r => chartRows.push([r.member, r.commits||0, r.prs_opened||0, r.prs_merged||0, r.reviews_given||0]));
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

  const gcWeek = latestWeek(D.gchat);
  const blWeek = latestWeek(D.backlog);
  let html = '<table><tr><th>メンバー</th><th>チーム</th><th>コミット</th><th>PR</th><th>レビュー</th><th>Chatメッセージ</th><th>完了タスク</th></tr>';
  filtMembers.forEach(m => {
    const g  = D.github.filter(r=>r.week_start===week&&r.member===m)[0] || {};
    const gc = D.gchat.filter(r=>r.week_start===gcWeek&&r.member===m).reduce((s,r)=>s+(r.messages_sent||0),0);
    const bl = D.backlog.filter(r=>r.week_start===blWeek&&r.member===m).reduce((s,r)=>s+(r.tasks_completed||0),0);
    const team = g.team || '';
    html += `<tr><td>${m}</td><td><span class="badge badge-${team.toLowerCase()}">${team}</span></td>` +
      `<td>${g.commits||0}</td><td>${g.prs_opened||0}</td><td>${g.reviews_given||0}</td><td>${gc}</td><td>${bl}</td></tr>`;
  });
  html += '</table>';
  document.getElementById('memberTable').innerHTML = html;
}

// ─── 評価スコア ─────────────────────────────────────────────────

function renderEvalPage() {
  ['before','after'].forEach(timing => {
    const rows = D.eval.filter(r => r.timing === timing && r.evaluator_type === '本人評価');
    if (!rows.length) return;
    const axes   = ['axis1_avg','axis2_avg','axis3_avg','axis4_avg'];
    const labels = ['上流工程力','実装技術力','AI活用力','チームコミュ'];
    const dt = new google.visualization.DataTable();
    dt.addColumn('string', '軸');
    ['A','B','C'].forEach(t => dt.addColumn('number','Team '+t));
    labels.forEach((lbl, i) => {
      const row = [lbl];
      ['A','B','C'].forEach(t => {
        const vals = rows.filter(r=>r.team===t).map(r=>parseFloat(r[axes[i]])||0);
        row.push(vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0);
      });
      dt.addRow(row);
    });
    const id = timing === 'before' ? 'chart_radar_before' : 'chart_radar_after';
    new google.visualization.LineChart(document.getElementById(id)).draw(dt, {
      colors: [TEAM_COLOR.A, TEAM_COLOR.B, TEAM_COLOR.C],
      legend: { position:'top' },
      backgroundColor: 'transparent',
      chartArea: { left:60, right:10, top:30, bottom:40 },
    });
  });

  const members = [...new Set(D.eval.map(r=>r.evaluatee))].sort();
  const role    = D.role;
  let html = '<table><tr><th>メンバー</th><th>チーム</th><th>評価者</th><th>Before平均</th><th>After平均</th><th>成長幅</th>';
  if (role === 'admin') html += '<th>判定</th>';
  html += '</tr>';

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
      const team  = before[0]?.team || '';
      const color = diff>0 ? 'color:#527EEC;font-weight:700' : diff<0 ? 'color:#D34B4B' : '';
      const approved = before[0]?.admin_approved;
      html += `<tr><td>${m}</td><td><span class="badge badge-${team.toLowerCase()}">${team}</span></td>`;
      html += `<td>${etype}</td><td>${b}</td><td>${a}</td>`;
      html += `<td style="${color}">${diff>0?'+':''}${diff}</td>`;
      if (role === 'admin') {
        const btnClass = approved ? 'approved-btn done' : 'approved-btn';
        const disabled  = approved ? ' disabled' : '';
        html += `<td><button class="${btnClass}"${disabled} onclick="approveEval('${m}','before')">${approved?'承認済み':'承認する'}</button></td>`;
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
