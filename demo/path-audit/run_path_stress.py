from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import time

HOST = 'yantw-novpn'
PROJECT = Path(__file__).resolve().parents[2]
BASE = PROJECT / 'demo' / 'path-audit'
REMOTE_ROOT = '~/aline-test/path-audit'
BACKSLASH = chr(92)


def ensure_case(name: str) -> Path:
    case = BASE / name
    case.mkdir(parents=True, exist_ok=True)
    (case / 'payload.txt').write_text(f'{name}-payload\n', encoding='utf-8')
    (case / 'nested').mkdir(exist_ok=True)
    (case / 'nested' / 'note.txt').write_text(f'{name}-nested\n', encoding='utf-8')
    return case


def normalize_files(root: Path):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())


def clear_local_dir(target: Path):
    if target.exists():
        shutil.rmtree(target)


def run(args, expect_ok=True, parse_json=False):
    proc = subprocess.run(args, capture_output=True, text=True, cwd=str(PROJECT))
    entry = {
        'cmd': ' '.join(str(a) for a in args),
        'code': proc.returncode,
        'stdout': proc.stdout.strip(),
        'stderr': proc.stderr.strip(),
    }
    if parse_json and proc.stdout.strip():
        try:
            entry['json'] = json.loads(proc.stdout)
        except Exception as error:
            entry['json_error'] = str(error)
    if expect_ok and proc.returncode != 0:
        print(json.dumps({'failure': entry}, ensure_ascii=False, indent=2))
        sys.exit(proc.returncode or 1)
    if not expect_ok and proc.returncode == 0:
        print(json.dumps({'unexpected_success': entry}, ensure_ascii=False, indent=2))
        sys.exit(1)
    return entry


def exec_follow(channel: str, command: str, expect_ok=True):
    return run(['node', './bin/aline', 'exec', HOST, '--channel', channel, '--follow', command], expect_ok=expect_ok)


def push(local_path, remote_path, extra=None):
    args = ['node', './bin/aline', 'push', HOST, '--local', str(local_path), '--remote', remote_path, '--json']
    if extra:
        args.extend(extra)
    return run(args, parse_json=True)


def pull(remote_path, local_path, extra=None):
    args = ['node', './bin/aline', 'pull', HOST, '--remote', remote_path, '--local', str(local_path), '--json']
    if extra:
        args.extend(extra)
    return run(args, parse_json=True)


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    abs_case = ensure_case('abs_case')
    rel_case = ensure_case('rel_case')
    tmp_case = ensure_case('tmp_case')
    merge_case = ensure_case('merge_case')
    sync_case = ensure_case('sync_case')

    space_local = BASE / 'space local case'
    space_local.mkdir(parents=True, exist_ok=True)
    (space_local / 'file one.txt').write_text('space-payload\n', encoding='utf-8')
    (space_local / 'nested dir').mkdir(exist_ok=True)
    (space_local / 'nested dir' / 'two.txt').write_text('nested-space\n', encoding='utf-8')

    run(['node', './bin/aline', 'connect', HOST, '--json'], parse_json=True)
    exec_follow(
        'prep-path-audit',
        "python3 - <<'PYREMOTE'\nimport pathlib, shutil\nfor value in ['~/aline-test/path-audit', '~/aline-test/path audit spaced', '/tmp/aline-path-audit-tmp']:\n    path = pathlib.Path(value).expanduser()\n    if path.exists():\n        shutil.rmtree(path)\npathlib.Path('~/aline-test/path-audit').expanduser().mkdir(parents=True, exist_ok=True)\nPYREMOTE",
    )

    # absolute local path push, repeated
    abs_methods = []
    for _ in range(5):
        abs_methods.append(push(abs_case.resolve(), f'{REMOTE_ROOT}/abs')['json']['data']['method'])
    abs_roundtrip = BASE / 'roundtrip_abs'
    clear_local_dir(abs_roundtrip)
    pull(f'{REMOTE_ROOT}/abs', abs_roundtrip.resolve())
    abs_files = normalize_files(abs_roundtrip)

    # relative local path push, repeated
    rel_local = os.path.relpath(rel_case, PROJECT)
    rel_methods = []
    for _ in range(3):
        rel_methods.append(push(rel_local, f'{REMOTE_ROOT}/rel')['json']['data']['method'])
    rel_roundtrip = BASE / 'roundtrip_rel'
    clear_local_dir(rel_roundtrip)
    pull(f'{REMOTE_ROOT}/rel', rel_roundtrip.resolve())
    rel_files = normalize_files(rel_roundtrip)

    # /tmp remote destination
    tmp_methods = []
    for _ in range(2):
        tmp_methods.append(push(tmp_case.resolve(), '/tmp/aline-path-audit-tmp')['json']['data']['method'])
    tmp_roundtrip = BASE / 'roundtrip_tmp'
    clear_local_dir(tmp_roundtrip)
    pull('/tmp/aline-path-audit-tmp', tmp_roundtrip.resolve())
    tmp_files = normalize_files(tmp_roundtrip)

    # remote path with spaces
    space_push = push(space_local, '~/aline-test/path audit spaced')
    space_roundtrip = BASE / 'roundtrip_space'
    clear_local_dir(space_roundtrip)
    space_pull = pull('~/aline-test/path audit spaced', space_roundtrip.resolve())
    space_files = normalize_files(space_roundtrip)

    # merge vs mirror
    push(merge_case.resolve(), f'{REMOTE_ROOT}/merge')
    push(merge_case.resolve(), f'{REMOTE_ROOT}/mirror')
    exec_follow(
        'prep-merge',
        "python3 - <<'PYREMOTE'\nfrom pathlib import Path\nfor p in ['~/aline-test/path-audit/merge/remote_only.txt','~/aline-test/path-audit/mirror/remote_only.txt']:\n    path = Path(p).expanduser(); path.parent.mkdir(parents=True, exist_ok=True); path.write_text('remote_only')\nPYREMOTE",
    )
    push(merge_case.resolve(), f'{REMOTE_ROOT}/merge', extra=['--merge'])
    push(merge_case.resolve(), f'{REMOTE_ROOT}/mirror')
    merge_roundtrip = BASE / 'roundtrip_merge'
    mirror_roundtrip = BASE / 'roundtrip_mirror'
    clear_local_dir(merge_roundtrip)
    clear_local_dir(mirror_roundtrip)
    pull(f'{REMOTE_ROOT}/merge', merge_roundtrip.resolve())
    pull(f'{REMOTE_ROOT}/mirror', mirror_roundtrip.resolve())
    merge_files = normalize_files(merge_roundtrip)
    mirror_files = normalize_files(mirror_roundtrip)

    # remote-created pull source -> abs and relative local destinations
    exec_follow(
        'prep-pull',
        "python3 - <<'PYREMOTE'\nfrom pathlib import Path\nroot = Path('~/aline-test/path-audit/pull-src').expanduser()\n(root / 'nested').mkdir(parents=True, exist_ok=True)\n(root / 'root.txt').write_text('pulled')\n(root / 'nested' / 'item.txt').write_text('nested')\nPYREMOTE",
    )
    abs_pull_local = BASE / 'pulled_abs'
    rel_pull_local = PROJECT / 'demo' / 'path-audit' / 'pulled_rel'
    clear_local_dir(abs_pull_local)
    clear_local_dir(rel_pull_local)
    abs_pull = pull(f'{REMOTE_ROOT}/pull-src', abs_pull_local.resolve())
    rel_pull = pull(f'{REMOTE_ROOT}/pull-src', Path('demo/path-audit/pulled_rel'))
    abs_pull_files = normalize_files(abs_pull_local)
    rel_pull_files = normalize_files(rel_pull_local)

    # sync with absolute local path
    sync_abs_marker = sync_case / 'sync_marker_abs.txt'
    if sync_abs_marker.exists():
        sync_abs_marker.unlink()
    run(['node', './bin/aline', 'sync', 'start', HOST, '--local', str(sync_case.resolve()), '--remote', f'{REMOTE_ROOT}/sync-abs', '--json'], parse_json=True)
    sync_abs_marker.write_text('sync-abs-ok\n', encoding='utf-8')
    time.sleep(3)
    run(['node', './bin/aline', 'sync', 'stop', HOST, '--json'], parse_json=True)
    sync_abs_roundtrip = BASE / 'roundtrip_sync_abs'
    clear_local_dir(sync_abs_roundtrip)
    pull(f'{REMOTE_ROOT}/sync-abs', sync_abs_roundtrip.resolve())
    sync_abs_files = normalize_files(sync_abs_roundtrip)

    # sync with relative local path
    sync_rel_marker = sync_case / 'sync_marker_rel.txt'
    if sync_rel_marker.exists():
        sync_rel_marker.unlink()
    run(['node', './bin/aline', 'sync', 'start', HOST, '--local', os.path.relpath(sync_case, PROJECT), '--remote', f'{REMOTE_ROOT}/sync-rel', '--json'], parse_json=True)
    sync_rel_marker.write_text('sync-rel-ok\n', encoding='utf-8')
    time.sleep(3)
    run(['node', './bin/aline', 'sync', 'stop', HOST, '--json'], parse_json=True)
    sync_rel_roundtrip = BASE / 'roundtrip_sync_rel'
    clear_local_dir(sync_rel_roundtrip)
    pull(f'{REMOTE_ROOT}/sync-rel', sync_rel_roundtrip.resolve())
    sync_rel_files = normalize_files(sync_rel_roundtrip)

    # negative tests: Windows-style remote paths must fail explicitly
    neg_forward = run(['node', './bin/aline', 'push', HOST, '--local', str(abs_case.resolve()), '--remote', 'C:/Users/bad/remote', '--json'], expect_ok=False, parse_json=True)
    neg_backslash = run(['node', './bin/aline', 'push', HOST, '--local', str(abs_case.resolve()), '--remote', 'C:\\Users\\bad\\remote', '--json'], expect_ok=False, parse_json=True)

    summary = {
        'methods_seen': [
            abs_methods,
            rel_methods,
            tmp_methods,
            space_push['json']['data']['method'],
            abs_pull['json']['data']['method'],
            rel_pull['json']['data']['method'],
            space_pull['json']['data']['method'],
        ],
        'abs_files': abs_files,
        'rel_files': rel_files,
        'tmp_files': tmp_files,
        'space_files': space_files,
        'merge_files': merge_files,
        'mirror_files': mirror_files,
        'abs_pull_files': abs_pull_files,
        'rel_pull_files': rel_pull_files,
        'sync_abs_files': sync_abs_files,
        'sync_rel_files': sync_rel_files,
        'negative_forward_error': neg_forward.get('json', {}).get('error', {}).get('message') or neg_forward['stdout'] or neg_forward['stderr'],
        'negative_backslash_error': neg_backslash.get('json', {}).get('error', {}).get('message') or neg_backslash['stdout'] or neg_backslash['stderr'],
    }

    all_file_text = json.dumps(summary, ensure_ascii=False)
    checks = {
        'no_windows_garbage_observed': ('C:' not in all_file_text) and (BACKSLASH not in all_file_text),
        'abs_push_roundtrip_ok': abs_files == ['nested/note.txt', 'payload.txt'],
        'rel_push_roundtrip_ok': rel_files == ['nested/note.txt', 'payload.txt'],
        'tmp_push_roundtrip_ok': tmp_files == ['nested/note.txt', 'payload.txt'],
        'space_path_roundtrip_ok': space_files == ['file one.txt', 'nested dir/two.txt'],
        'merge_keeps_remote_only': 'remote_only.txt' in merge_files,
        'mirror_removes_remote_only': 'remote_only.txt' not in mirror_files,
        'abs_pull_ok': abs_pull_files == ['nested/item.txt', 'root.txt'],
        'rel_pull_ok': rel_pull_files == ['nested/item.txt', 'root.txt'],
        'sync_abs_marker_present': 'sync_marker_abs.txt' in sync_abs_files,
        'sync_rel_marker_present': 'sync_marker_rel.txt' in sync_rel_files,
        'windows_remote_forward_rejected': 'Unix-like syntax' in summary['negative_forward_error'],
        'windows_remote_backslash_rejected': 'Unix-like syntax' in summary['negative_backslash_error'],
    }

    print(json.dumps({'summary': summary, 'checks': checks}, ensure_ascii=False, indent=2))
    if not all(checks.values()):
        sys.exit(1)


if __name__ == '__main__':
    main()
