#!/usr/bin/env python3
"""
Claude Code Portal Usage Hook — AIネイティブ施策ポータル向け Stop hook
セッション終了時にトークン・スキル・サブエージェント使用状況を GAS エンドポイントへ送信。
プロジェクトフィルタ（ai-native 限定）は GAS 側で実施。
依存ライブラリ: Python 標準ライブラリのみ
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from collections import Counter

PORTAL_GAS_URL = (
    'https://script.google.com/macros/s/'
    'AKfycbx3Y3YMynssVLnUy2awDXp-Qc9f0dWicwSWcgeZuXE_kovvdyjyzCoKxpqJXM_W4xJH/exec'
)

# /help, /clear 等の組み込みコマンドはスキルとして記録しない
BUILTIN_COMMANDS = {
    '/compact', '/clear', '/help', '/review', '/status',
    '/config', '/doctor', '/bug', '/terminal', '/vim',
    '/memory', '/cost', '/mcp', '/init',
}


def get_claude_email():
    try:
        result = subprocess.run(
            ['claude', 'auth', 'status'],
            capture_output=True, text=True, timeout=10,
        )
        for line in (result.stdout + result.stderr).splitlines():
            match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', line)
            if match:
                return match.group(0).lower()
    except Exception:
        pass
    return None


def find_session_file(session_id):
    config_dir = pathlib.Path(
        os.environ.get('CLAUDE_CONFIG_DIR', str(pathlib.Path.home() / '.claude'))
    )
    projects_dir = config_dir / 'projects'
    if not projects_dir.exists():
        return None
    for project_dir in projects_dir.iterdir():
        candidate = project_dir / f'{session_id}.jsonl'
        if candidate.exists():
            return candidate
    return None


def decode_project_dir(session_file):
    """ハッシュディレクトリ名（URL エンコードされたパス）からプロジェクトパスを復元する。"""
    hash_dir = session_file.parent.name
    try:
        decoded = urllib.parse.unquote(hash_dir)
        if decoded.startswith('/') or (len(decoded) > 2 and decoded[1] == ':'):
            return decoded
    except Exception:
        pass
    return hash_dir


def get_git_branch(project_dir):
    try:
        result = subprocess.run(
            ['git', '-C', project_dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ''


def parse_session(session_file):
    records = []
    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception:
        return None

    if not records:
        return None

    timestamps = []
    turns = 0
    seen_msg_ids = set()
    input_tokens = output_tokens = cache_read = cache_creation = 0
    model_counter = Counter()
    skill_events = []
    seen_skill_keys = set()
    subagent_events = []
    mcp_events = []

    for r in records:
        ts = r.get('timestamp', '')
        if ts:
            timestamps.append(ts)

        rtype = r.get('type', '')
        msg = r.get('message') or {}
        if not isinstance(msg, dict):
            continue

        if rtype == 'user':
            turns += 1
            content = msg.get('content', [])
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    text = block.get('text', '')
                    for cmd in re.findall(r'<command-message>(.*?)</command-message>', text):
                        cmd = cmd.strip()
                        if not cmd or cmd in BUILTIN_COMMANDS:
                            continue
                        key = (cmd, ts[:16])
                        if key not in seen_skill_keys:
                            seen_skill_keys.add(key)
                            skill_events.append({'skill_name': cmd, 'timestamp': ts})

        elif rtype == 'assistant':
            msg_id = msg.get('id', '')
            if msg_id and msg_id in seen_msg_ids:
                continue
            if msg_id:
                seen_msg_ids.add(msg_id)

            usage = msg.get('usage') or {}
            input_tokens    += usage.get('input_tokens', 0)
            output_tokens   += usage.get('output_tokens', 0)
            cache_read      += usage.get('cache_read_input_tokens', 0)
            cache_creation  += usage.get('cache_creation_input_tokens', 0)

            m = msg.get('model', '')
            if m:
                model_counter[m] += 1

            content = msg.get('content', [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get('type') != 'tool_use':
                    continue
                name = block.get('name', '')
                inp = block.get('input') or {}
                if name == 'Agent':
                    subtype = inp.get('subagent_type', 'unknown')
                    subagent_events.append({'subagent_type': subtype, 'timestamp': ts})
                elif name.startswith('mcp__'):
                    parts = name.split('__', 2)
                    server = parts[1] if len(parts) > 1 else name
                    method = parts[2] if len(parts) > 2 else ''
                    mcp_events.append({
                        'tool_name': name,
                        'mcp_server': server,
                        'mcp_method': method,
                        'timestamp': ts,
                    })

    model = model_counter.most_common(1)[0][0] if model_counter else 'unknown'

    return {
        'model':              model,
        'first_event_at':     min(timestamps) if timestamps else '',
        'last_event_at':      max(timestamps) if timestamps else '',
        'turns':              turns,
        'input_tokens':       input_tokens,
        'output_tokens':      output_tokens,
        'cache_read_tokens':  cache_read,
        'cache_creation_tokens': cache_creation,
        'skill_usage_events':    skill_events,
        'subagent_usage_events': subagent_events,
        'mcp_usage_events':      mcp_events,
    }


def post_to_portal(payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        PORTAL_GAS_URL,
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except Exception:
        pass  # fire-and-forget


def main():
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except Exception:
        return

    session_id = hook_input.get('session_id', '')
    if not session_id:
        return

    email = get_claude_email()
    if not email:
        return

    session_file = find_session_file(session_id)
    if not session_file:
        return

    parsed = parse_session(session_file)
    if not parsed:
        return

    project_dir = decode_project_dir(session_file)
    branch = get_git_branch(project_dir)

    payload = {
        'email':      email,
        'session_id': session_id,
        'project_dir': project_dir,
        'git_branch':  branch,
        **parsed,
    }

    post_to_portal(payload)


if __name__ == '__main__':
    main()
