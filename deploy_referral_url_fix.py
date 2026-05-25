#!/usr/bin/env python3
"""
Fix: Referral invite URL now points to /registro?ref=CODE
      (previously was /?ref=CODE, which showed home page and never pre-filled the form)

Run this script from the project root:
  python3 deploy_referral_url_fix.py
"""
import os, sys, subprocess, time, zipfile, shutil
from datetime import datetime

PROJECT = os.path.dirname(os.path.abspath(__file__))

# ── STEP 1: Build frontend ────────────────────────────────────────────────────
print('=== STEP 1: Building frontend ===')
result = subprocess.run(
    ['npm', 'run', 'build'],
    cwd=os.path.join(PROJECT, 'frontend'),
    capture_output=False,   # show output directly
    timeout=300
)
if result.returncode != 0:
    print(f'ERROR: Frontend build failed (exit {result.returncode})')
    sys.exit(1)
print('Frontend build OK\n')

# ── STEP 2: Create dist zip ───────────────────────────────────────────────────
ts = datetime.now().strftime('%Y%m%d_%H%M%S')
zip_name = f'referral-url-fix-{ts}.zip'
dist_dir = os.path.join(PROJECT, 'dist_uploads')
os.makedirs(dist_dir, exist_ok=True)
zip_path = os.path.join(dist_dir, zip_name)

changed_files = [
    'backend/modules/profile/profileState.service.ts',
    'backend/modules/profile/profileReferralOverview.service.ts',
    'backend/dist/modules/profile/profileState.service.js',
    'backend/dist/modules/profile/profileReferralOverview.service.js',
    'frontend/components/AuthPage.tsx',
    'frontend/App.tsx',
]

print(f'=== STEP 2: Creating zip at {zip_path} ===')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for rel in changed_files:
        full = os.path.join(PROJECT, rel)
        if os.path.exists(full):
            zf.write(full, rel)
            print(f'  + {rel}')
        else:
            print(f'  ! MISSING: {rel}')
print(f'Zip created: {zip_path}\n')

# ── STEP 3: Deploy to production via SSH ─────────────────────────────────────
print('=== STEP 3: Deploying to production ===')

try:
    import paramiko
except ImportError:
    print('paramiko not installed. Run: pip install paramiko')
    sys.exit(1)

HOST = '177.7.47.139'
PORT = 2222
USER = 'root'
PASS = 'VortexA9#Lumi'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=30)
sftp = ssh.open_sftp()

def run(cmd, timeout=120, label=None):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    tag = label or cmd[:80]
    status = 'OK' if code == 0 else 'FAIL'
    print(f'[{status}] {tag}')
    if out.strip(): print(out.strip()[:600])
    if err.strip(): print('ERR:', err.strip()[:300])
    return code, out, err

def ensure_remote_dir(path):
    parts = path.split('/')
    cur = ''
    for p in parts:
        if not p:
            cur = '/'
            continue
        cur = cur.rstrip('/') + '/' + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            try:
                sftp.mkdir(cur)
            except Exception:
                pass

def upload_dir(local_dir, remote_dir):
    ensure_remote_dir(remote_dir)
    for entry in sorted(os.listdir(local_dir)):
        lpath = os.path.join(local_dir, entry)
        rpath = f'{remote_dir}/{entry}'
        if os.path.isdir(lpath):
            upload_dir(lpath, rpath)
        else:
            sftp.put(lpath, rpath)

STAGING = '/tmp/dist_ref_url_fix'
run(f'rm -rf {STAGING} && mkdir -p {STAGING}/modules/profile {STAGING}/frontend_dist')

# Upload patched backend profile dist files
for fname in ['profileState.service.js', 'profileReferralOverview.service.js']:
    local = os.path.join(PROJECT, f'backend/dist/modules/profile/{fname}')
    remote = f'{STAGING}/modules/profile/{fname}'
    sftp.put(local, remote)
    print(f'  Uploaded: {fname}')

# Upload frontend dist
print('Uploading frontend/dist ...')
upload_dir(os.path.join(PROJECT, 'frontend/dist'), f'{STAGING}/frontend_dist')
print('All uploaded.\n')

# Copy into containers
run(f'docker cp {STAGING}/modules/profile/profileState.service.js app:/app/backend/dist/modules/profile/profileState.service.js', label='cp profileState → app')
run(f'docker cp {STAGING}/modules/profile/profileState.service.js app_worker:/app/backend/dist/modules/profile/profileState.service.js', label='cp profileState → app_worker')
run(f'docker cp {STAGING}/modules/profile/profileReferralOverview.service.js app:/app/backend/dist/modules/profile/profileReferralOverview.service.js', label='cp profileReferral → app')
run(f'docker cp {STAGING}/modules/profile/profileReferralOverview.service.js app_worker:/app/backend/dist/modules/profile/profileReferralOverview.service.js', label='cp profileReferral → app_worker')
run(f'docker cp {STAGING}/frontend_dist/. app:/app/frontend/dist/', timeout=120, label='cp frontend → app')

# Verify the fix
run("docker exec app grep -o '/registro' /app/backend/dist/modules/profile/profileState.service.js | head -1", label='verify /registro in profileState')

# Restart app container
run('docker restart app', timeout=30, label='restart app')
print('Waiting for startup...')
time.sleep(12)

# Check logs
run('docker logs --tail 15 app 2>&1', label='app logs')

sftp.close()
ssh.close()
print(f'\n=== DONE ===')
print(f'Zip: {zip_path}')
