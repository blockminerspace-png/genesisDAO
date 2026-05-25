#!/usr/bin/env python3
"""Deploy completo para VPS — sincroniza todos os ficheiros alterados e reinicia."""
import paramiko, os, posixpath, subprocess, time, sys

HOST = '161.97.176.125'
USER = 'root'
PASSWORD = 'equipefoda20026'
REMOTE_APP = '/root/minestation/app_production'
LOCAL_ROOT = '/home/gustavo/Documentos/minestation'

# Ficheiros backend source + compilados
BACKEND_TS_FILES = [
    'backend/models/authModel.ts',
    'backend/modules/auth-login/authLogin.controller.ts',
    'backend/controllers/authController.ts',
    'backend/controllers/userRegistrationController.ts',
    'backend/server.ts',
    'backend/utils/authFlowSecret.ts',
    'backend/utils/cloudflareTurnstile.ts',
    'backend/utils/signupProxyVpnGuard.ts',
    'backend/utils/clientIp.ts',
    'backend/modules/email-verification/emailVerification.service.ts',
    'backend/modules/email-verification/emailVerification.controller.ts',
    'backend/models/registrationValidation.ts',
    'backend/models/userModel.ts',
    'backend/models/userPutCoreTransaction.ts',
]

BACKEND_DIST_FILES = [
    'backend/dist/models/authModel.js',
    'backend/dist/modules/auth-login/authLogin.controller.js',
    'backend/dist/controllers/authController.js',
    'backend/dist/controllers/userRegistrationController.js',
    'backend/dist/utils/authFlowSecret.js',
    'backend/dist/utils/cloudflareTurnstile.js',
    'backend/dist/utils/signupProxyVpnGuard.js',
    'backend/dist/utils/clientIp.js',
    'backend/dist/modules/email-verification/emailVerification.service.js',
    'backend/dist/modules/email-verification/emailVerification.controller.js',
    'backend/dist/models/registrationValidation.js',
    'backend/dist/models/userModel.js',
    'backend/dist/models/userPutCoreTransaction.js',
    'backend/server.js',
]

def log(msg):
    print(msg, flush=True)

def build_backend():
    log('\n==> Compilando backend TypeScript...')
    r = subprocess.run(
        ['node', 'node_modules/typescript/bin/tsc'],
        cwd=os.path.join(LOCAL_ROOT, 'backend'),
        capture_output=True, text=True
    )
    if r.returncode != 0:
        log('ERRO TSC:')
        log(r.stdout[-2000:])
        log(r.stderr[-2000:])
        sys.exit(1)
    log('   Backend compilado com sucesso.')

def build_frontend():
    log('\n==> Compilando frontend...')
    r = subprocess.run(
        ['npm', 'run', 'build'],
        cwd=os.path.join(LOCAL_ROOT, 'frontend'),
        capture_output=True, text=True, timeout=300
    )
    if r.returncode != 0:
        log('ERRO FRONTEND BUILD:')
        log(r.stdout[-3000:])
        log(r.stderr[-3000:])
        sys.exit(1)
    log('   Frontend compilado com sucesso.')

def mkdir_p(sftp, remote_dir):
    parts = []
    path = remote_dir
    while path and path != '/':
        parts.insert(0, path)
        path = posixpath.dirname(path)
    for d in parts:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            try:
                sftp.mkdir(d)
            except Exception:
                pass

def upload_file(sftp, local_rel, remote_base):
    local_abs = os.path.join(LOCAL_ROOT, local_rel)
    if not os.path.exists(local_abs):
        log(f'   SKIP (not found): {local_rel}')
        return
    remote_path = posixpath.join(remote_base, local_rel)
    mkdir_p(sftp, posixpath.dirname(remote_path))
    sftp.put(local_abs, remote_path)
    log(f'   uploaded: {local_rel}')

def upload_dir_recursive(sftp, local_dir_rel, remote_base):
    local_abs = os.path.join(LOCAL_ROOT, local_dir_rel)
    if not os.path.isdir(local_abs):
        log(f'   SKIP dir (not found): {local_dir_rel}')
        return
    for root, dirs, files in os.walk(local_abs):
        for fname in files:
            fabs = os.path.join(root, fname)
            frel = os.path.relpath(fabs, LOCAL_ROOT)
            upload_file(sftp, frel, remote_base)

def main():
    # 1. Build
    build_backend()
    build_frontend()

    # 2. Connect
    log('\n==> Conectando ao VPS...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD)
    sftp = ssh.open_sftp()
    log('   Conectado.')

    # 3. Upload backend source (TS)
    log('\n==> Enviando ficheiros backend (source)...')
    for f in BACKEND_TS_FILES:
        upload_file(sftp, f, REMOTE_APP)

    # 4. Upload backend dist (JS)
    log('\n==> Enviando ficheiros backend (dist)...')
    for f in BACKEND_DIST_FILES:
        upload_file(sftp, f, REMOTE_APP)

    # 5. Upload frontend build
    log('\n==> Enviando frontend build...')
    upload_dir_recursive(sftp, 'frontend/build', REMOTE_APP)

    sftp.close()

    # 6. Restart container
    log('\n==> Reiniciando container app...')
    _, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_APP} && docker compose restart app 2>&1'
    )
    log(stdout.read().decode())
    log(stderr.read().decode())

    time.sleep(6)

    # 7. Health check
    _, stdout, _ = ssh.exec_command(
        f'cd {REMOTE_APP} && docker compose ps app 2>&1'
    )
    log(stdout.read().decode())

    ssh.close()
    log('\n==> Deploy concluido com sucesso.')

if __name__ == '__main__':
    main()
