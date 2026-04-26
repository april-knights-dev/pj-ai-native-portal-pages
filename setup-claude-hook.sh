#!/usr/bin/env bash
# AIネイティブ施策ポータル — Claude Code 使用状況 Stop hook インストーラー
# 使い方: curl -fsSL https://april-knights-dev.github.io/pj-ai-native-portal-pages/setup-claude-hook.sh | bash
set -e

HOOK_URL="https://april-knights-dev.github.io/pj-ai-native-portal-pages/claude-code-hook.py"
HOOK_DIR="${HOME}/.claude/hooks"
HOOK_PATH="${HOOK_DIR}/portal-usage.py"

echo "AIネイティブ施策ポータル: Claude Code フックのインストールを開始します..."

# hooks ディレクトリを作成
mkdir -p "${HOOK_DIR}"

# フックスクリプトをダウンロード
curl -fsSL "${HOOK_URL}" -o "${HOOK_PATH}"
chmod +x "${HOOK_PATH}"
echo "  ✓ フックスクリプトを ${HOOK_PATH} に配置しました"

# settings.json に Stop hook を追加
python3 - "${HOOK_PATH}" << 'PYEOF'
import json, pathlib, sys

hook_path = sys.argv[1]
settings_file = pathlib.Path.home() / '.claude' / 'settings.json'

settings = {}
if settings_file.exists():
    try:
        settings = json.loads(settings_file.read_text(encoding='utf-8'))
    except Exception:
        settings = {}

hooks = settings.setdefault('hooks', {})
stop_hooks = hooks.setdefault('Stop', [])

new_entry = {
    'hooks': [
        {'type': 'command', 'command': f'python3 {hook_path}'}
    ]
}

already_installed = any(
    any(
        hook_path in str(h.get('command', ''))
        for h in group.get('hooks', [])
    )
    for group in stop_hooks
    if isinstance(group, dict)
)

if already_installed:
    print('  ℹ️  フックは既にインストール済みです（変更なし）')
else:
    stop_hooks.append(new_entry)
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(
        json.dumps(settings, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print('  ✓ ~/.claude/settings.json に Stop hook を追加しました')
PYEOF

echo ""
echo "✅ インストール完了！"
echo "   ai-native-team-a / b / c でのClaude Codeセッション終了後に"
echo "   ポータルの「AI活用」タブへデータが自動送信されます。"
