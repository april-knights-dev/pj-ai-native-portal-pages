# AIネイティブ施策ポータル - Claude Code 使用状況 Stop hook インストーラー (Windows / PowerShell)
# 使い方: iex (iwr 'https://april-knights-dev.github.io/pj-ai-native-portal-pages/setup-claude-hook.ps1' -UseBasicParsing).Content
$ErrorActionPreference = 'Stop'

$HookUrl      = 'https://april-knights-dev.github.io/pj-ai-native-portal-pages/claude-code-hook.py'
$HookDir      = "$env:USERPROFILE\.claude\hooks"
$HookPath     = "$HookDir\portal-usage.py"
$SettingsPath = "$env:USERPROFILE\.claude\settings.json"

Write-Host 'AIネイティブ施策ポータル: Claude Code フックのインストールを開始します...'

# hooks ディレクトリを作成
New-Item -ItemType Directory -Force -Path $HookDir | Out-Null

# フックスクリプトをダウンロード
Invoke-WebRequest -Uri $HookUrl -OutFile $HookPath -UseBasicParsing
Write-Host "  OK フックスクリプトを配置しました: $HookPath"

# Python 3 を検出（python3 → python → py の順に試みる）
$Python = $null
foreach ($cmd in @('python3', 'python', 'py')) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match 'Python 3') { $Python = $cmd; break }
    } catch {}
}
if (-not $Python) {
    Write-Error 'Python 3 が見つかりません。Python 3 をインストールしてから再実行してください。'
    exit 1
}
Write-Host "  OK Python を検出: $Python"

# パスをフォワードスラッシュに統一（Python / Claude Code が両形式を受け付ける）
$HookPathFwd     = $HookPath.Replace('\', '/')
$SettingsPathFwd = $SettingsPath.Replace('\', '/')

# settings.json に Stop hook を追加（Python で JSON 操作）
$Script = @"
import json, pathlib

hook_path = '$HookPathFwd'
settings_file = pathlib.Path('$SettingsPathFwd')

settings = {}
if settings_file.exists():
    try:
        settings = json.loads(settings_file.read_text('utf-8'))
    except Exception:
        settings = {}

stop_hooks = settings.setdefault('hooks', {}).setdefault('Stop', [])
entry = {'hooks': [{'type': 'command', 'command': 'python3 ' + hook_path}]}

already = any(
    hook_path in str(h.get('command', ''))
    for g in stop_hooks if isinstance(g, dict)
    for h in g.get('hooks', [])
)

if already:
    print('  INFO フックは既にインストール済みです（変更なし）')
else:
    stop_hooks.append(entry)
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(json.dumps(settings, indent=2, ensure_ascii=False), 'utf-8')
    print('  OK ~/.claude/settings.json に Stop hook を追加しました')
"@

& $Python -c $Script
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'インストール完了！'
Write-Host 'ai-native-team-a / b / c での Claude Code セッション終了後に'
Write-Host 'ポータルの「AI活用」タブへデータが自動送信されます。'
