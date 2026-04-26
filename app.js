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
const TEAM_COLOR  = { A: '#1a73e8', B: '#34a853', C: '#ea4335' };

let D = null; // ポータルデータ（fetchData後にセット）

// ─── 初期化 ─────────────────────────────────────────────────────

google.charts.load('current', { packages: ['corechart', 'bar'], language: 'ja' });
google.charts.setOnLoadCallback(init);

function init() {
  // URL の ?token= を処理（GAS Auth からのリダイレクト）
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    history.replaceState(null, '', location.pathname);
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showSignIn();
    return;
  }

  showLoading();
  fetchData(token);
}

// ─── サインイン / アウト ──────────────────────────────────────

function showSignIn() {
  document.getElementById('signin-screen').style.display = 'flex';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';

  const btn = document.getElementById('signin-btn');
  const redirectTo = encodeURIComponent(location.origin + location.pathname);
  btn.href = GAS_AUTH_URL + '?action=auth&redirect_to=' + redirectTo;
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
      renderApp();
      showApp();
    })
    .catch(err => {
      console.error('データ取得エラー:', err);
      document.getElementById('loading-screen').innerHTML =
        '<div class="error-msg">データの読み込みに失敗しました。<br>' +
        '<button class="btn btn-primary" style="margin-top:16px" onclick="signOut()">再サインイン</button></div>';
    });
}

// ─── アプリ描画 ────────────────────────────────────────────────

function renderApp() {
  const role = D.role;

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
      '<p style="color:#999;font-size:13px">フォームURLは管理者が設定中です。</p>';
  }

  // 評価テーブルタイトル（admin は承認ボタンあり）
  if (role === 'admin') {
    document.getElementById('evalTableTitle').textContent = 'Before→After 成長スコア（管理者: 承認ボタンで確認済みにできます）';
    document.getElementById('adminEvalSection').style.display = 'block';
  }

  renderOverviewPage();
  renderSummaryPage();
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

  const phasesHtml = cohort.phases.map(p => `
    <div class="timeline-item">
      <span class="period">${p.period}</span>
      <h4>${p.name}</h4>
      <p>${p.desc}</p>
    </div>`).join('');

  const teamsHtml = cohort.teams.map(t => `
    <div class="team-card team-${t.id.toLowerCase()}">
      <h4><span class="badge badge-${t.id.toLowerCase()}">Team ${t.id}</span>　${t.theme}</h4>
      <div class="members">メンバー: ${t.members.join('・')}（リーダー: ${t.leader}）　｜　PO: ${t.po.join('・')}</div>
    </div>`).join('');

  document.getElementById('overview-content').innerHTML = `
  <div class="grid grid-2">
    <div class="card">
      <h2>施策について</h2>
      <p style="font-size:14px;line-height:1.8;color:#555;margin-bottom:16px">
        AIネイティブ開発プロジェクトは、AI-first な開発手法を実践しながら
        上流工程力・実装技術力・AI活用力・チームコミュニケーション力を総合的に鍛えます。<br>
        参加メンバーは期ごとにローテーションし、社内の AI ネイティブ人材を継続的に育成します。
      </p>
      <table>
        <tr><th style="width:100px">期</th><td>${cohort.name}（${cohort.id}）</td></tr>
        <tr><th>期間</th><td>${cohort.period}</td></tr>
        <tr><th>週次作業会</th><td>${cohort.weeklySession}</td></tr>
        <tr><th>チーム数</th><td>${cohort.teams.length}チーム</td></tr>
        <tr><th>参加人数</th><td>${cohort.teams.reduce((s,t)=>s+t.members.length,0)}名</td></tr>
      </table>
    </div>
    <div class="card">
      <h2>フェーズ・タイムライン</h2>
      <div class="timeline">${phasesHtml}</div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <h2>チーム構成（${cohort.name}）</h2>
    ${teamsHtml}
  </div>
  <div class="card" style="margin-top:16px">
    <h2>評価について</h2>
    <p style="font-size:14px;color:#555;margin-bottom:16px">
      評価はスキルの <strong>成長幅（After − Before）</strong> で行います。スタート地点は問いません。<br>
      施策責任者・チームリーダー・本人の 3 者評価で最終スコアを算出します。
    </p>
    <table>
      <tr><th style="width:160px">タイミング</th><th>内容</th></tr>
      <tr><td>Before（4月初旬）</td><td>キックオフ時の自己評価</td></tr>
      <tr><td>Mid-check（4月末）</td><td>Phase 1 完了後の中間確認</td></tr>
      <tr><td>After（6月末）</td><td>3者評価による最終スコア</td></tr>
    </table>
    <p style="font-size:12px;color:#999;margin-top:12px">
      最終スコア = (本人 + チームリーダー + 施策責任者) ÷ 3　｜　成長スコア = After − Before
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

  document.getElementById('scoreCards').innerHTML =
    scoreCard(wGH.reduce((s,r)=>s+(r.commits||0),0),   '今週のコミット数') +
    scoreCard(wGC.reduce((s,r)=>s+(r.messages_sent||0),0), '今週のChatメッセージ') +
    scoreCard(wBL.reduce((s,r)=>s+(r.tasks_completed||0),0), '今週の完了タスク');

  document.getElementById('updated-at').textContent = week ? '最終収集: ' + week : '';

  renderWeeklyChart(src,      'commits',         'chart_week');
  renderWeeklyChart(D.gchat,  'messages_sent',   'chart_gchat_week');
  renderWeeklyChart(D.backlog,'tasks_completed',  'chart_backlog_week');
  renderTeamActivityChart();
}

function scoreCard(val, lbl) {
  return `<div class="score-card"><div class="val">${val}</div><div class="lbl">${lbl}</div></div>`;
}

function latestWeek(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(r => r.week_start).sort().pop();
}

function renderWeeklyChart(data, metric, elId) {
  const weeks = [...new Set(data.map(r=>r.week_start))].sort();
  const teams = ['A','B','C'];
  const rows  = [['週', ...teams.map(t=>'Team '+t)]];
  weeks.forEach(w => {
    const row = [w];
    teams.forEach(t => row.push(
      data.filter(r=>r.week_start===w&&r.team===t).reduce((s,r)=>s+(r[metric]||0),0)
    ));
    rows.push(row);
  });
  if (rows.length < 2) return;
  const dt = google.visualization.arrayToDataTable(rows);
  new google.visualization.ColumnChart(document.getElementById(elId)).draw(dt, {
    colors: ['#1a73e8','#34a853','#ea4335'], legend: { position:'top' },
    isStacked: true, chartArea: { left:40, right:10, top:30, bottom:40 },
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
  if (rows.length < 2) return;
  new google.visualization.BarChart(document.getElementById('chart_team_activity'))
    .draw(google.visualization.arrayToDataTable(rows), {
      isStacked: true, legend: { position:'top' },
      colors: ['#1a73e8','#4285f4','#34a853','#ea4335'],
      chartArea: { left:60, right:10, top:30, bottom:20 },
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
        isStacked: true, legend: { position:'top' },
        chartArea: { left:60, right:10, top:30, bottom:20 },
      });
  }

  const filtMembers = selMember ? [selMember]
    : (selTeam ? D.github.filter(r=>r.team===selTeam).map(r=>r.member).filter((v,i,a)=>a.indexOf(v)===i)
               : members);
  const weeks = [...new Set(D.github.map(r=>r.week_start))].sort();
  const trendRows = [['週', ...filtMembers]];
  weeks.forEach(w => {
    const row = [w];
    filtMembers.forEach(m => row.push(
      D.github.filter(r=>r.week_start===w&&r.member===m).reduce((s,r)=>s+(r.commits||0),0)
    ));
    trendRows.push(row);
  });
  if (trendRows.length > 1) {
    new google.visualization.LineChart(document.getElementById('chart_commit_trend'))
      .draw(google.visualization.arrayToDataTable(trendRows), {
        legend: { position:'top' }, chartArea: { left:40, right:10, top:30, bottom:40 },
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
      colors: ['#1a73e8','#34a853','#ea4335'], legend: { position:'top' },
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
      const color = diff>0 ? 'color:#34a853;font-weight:600' : diff<0 ? 'color:#ea4335' : '';
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
    const color = i===0 ? '#f4b400' : i===1 ? '#9e9e9e' : i===2 ? '#cd7f32' : TEAM_COLOR[p.team]||'#1a73e8';
    rows.push([p.name+'（'+p.pt+'pt）', p.pt, 'color:'+color]);
  });
  new google.visualization.BarChart(document.getElementById('chart_rank'))
    .draw(google.visualization.arrayToDataTable(rows), {
      legend: 'none', chartArea: { left:120, right:10, top:10, bottom:20 },
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
      colors: ['#fbbc04'], legend: 'none', chartArea: { left:60, right:10, top:10, bottom:20 },
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
  if (!selfEval.length) html += '<tr><td colspan="6" style="color:#999;text-align:center">評価データがまだありません</td></tr>';
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
    if (!D.eval.length) ahtml += '<tr><td colspan="9" style="color:#999;text-align:center">評価データがまだありません</td></tr>';
    ahtml += '</table>';
    document.getElementById('adminEvalTable').innerHTML = ahtml;
  }
}
