#!/usr/bin/env python3
"""Validate source identity and execute the declared local checks."""
import argparse, hashlib, json, os, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--integrity-only', action='store_true')
parser.add_argument('--check', action='append', help='Run only the named check (repeatable).')
args = parser.parse_args()
provenance = json.loads((root/'EXPORT_PROVENANCE.json').read_text())
dependencies = json.loads((root/'EXPORT_DEPENDENCIES.json').read_text())
for item in provenance['files'] + dependencies['files']:
    p = root/item['path']
    b = os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
    assert hashlib.sha256(b).hexdigest() == item['sha256'], 'Source byte mismatch: '+item['path']
    assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest() == item['git_blob'], 'Source blob mismatch'
    if not p.is_symlink():
        assert bool(p.stat().st_mode & 0o111) == (item['mode']=='100755'), 'Source mode mismatch'
for item in dependencies['repairs']:
    if item['kind']=='compatibility-symlink':
        assert os.readlink(root/item['path']) == item['target']
        assert (root/item['path']).resolve().is_relative_to(root)
        assert (root/item['path']).exists()
    elif 'sha256' in item:
        assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256']
for name in json.loads((root/'EXPORT_EXCLUSIONS.json').read_text())['excluded_source_paths']:
    assert not (root/name).exists(), 'Excluded source unexpectedly present'
print('PASS source identity, file modes, explicit repairs and exclusions', flush=True)
if args.integrity_only:
    sys.exit(0)
checks=json.loads((root/'VALIDATE.json').read_text())['checks']
if args.check:
    assert set(args.check) <= {c['name'] for c in checks}, 'Unknown check'
    checks=[c for c in checks if c['name'] in args.check]
failed=[]
for check in checks:
    print('Running '+check['name'], flush=True)
    command=check['command'][:]
    if command[0]=='python': command[0]=sys.executable
    if command[0]=='cmake': command[0]=os.environ.get('CMAKE','cmake')
    if command[0]=='ctest': command[0]=os.environ.get('CTEST','ctest')
    try:
        completed=subprocess.run(command,cwd=root/check['cwd'],env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1',**check.get('environment',{})},timeout=check.get('timeout_seconds',300))
        if completed.returncode: failed.append(check['name'])
    except (OSError,subprocess.TimeoutExpired) as exc:
        print(type(exc).__name__+': '+str(exc), file=sys.stderr);failed.append(check['name'])
if failed:
    print('Failed checks: '+', '.join(failed),file=sys.stderr)
sys.exit(bool(failed))
