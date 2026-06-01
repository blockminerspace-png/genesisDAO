#!/usr/bin/env python3
"""Deploy completo para VPS — sincroniza todos os ficheiros alterados e reinicia."""
import paramiko, os, posixpath, subprocess, time, sys

HOST = '177.7.47.139'
SSH_PORT = 2222
USER = 'root'
PASSWORD = 'VortexA9#Lumi'
REMOTE_APP = '/root/minestation/app_production'
LOCAL_ROOT = '/home/gustavo/Documentos/minestation'

# Postgres credentials (extraídos de docker-compose.yml + .env)
POSTGRES_USER = 'postgres'
POSTGRES_DB = 'minestation'
POSTGRES_SERVICE = 'db'  # nome do serviço no docker-compose

# Migration zerads
ZERADS_MIGRATION_DIR = 'backend/prisma/migrations/20260528140000_zerads_integration'
ZERADS_MIGRATION_SQL = f'{ZERADS_MIGRATION_DIR}/migration.sql'

# Ficheiros backend source + compilados
BACKEND_TS_FILES = [
    'backend/models/authModel.ts',
    'backend/modules/auth-login/authLogin.controller.ts',
    'backend/controllers/authController.ts',
    'backend/controllers/userRegistrationController.ts',
    'backend/controllers/zeradsCallbackController.ts',
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
    'backend/modules/shop/shop.productRules.ts',
    'backend/modules/shop/shop.checkout.service.ts',
    'backend/modules/shop/shop.catalog.ts',
]

BACKEND_DIST_FILES = [
    'backend/dist/models/authModel.js',
    'backend/dist/modules/auth-login/authLogin.controller.js',
    'backend/dist/controllers/authController.js',
    'backend/dist/controllers/userRegistrationController.js',
    'backend/dist/controllers/zeradsCallbackController.js',
    'backend/dist/utils/authFlowSecret.js',
    'backend/dist/utils/cloudflareTurnstile.js',
    'backend/dist/utils/signupProxyVpnGuard.js',
    'backend/dist/utils/clientIp.js',
    'backend/dist/modules/email-verification/emailVerification.service.js',
    'backend/dist/modules/email-verification/emailVerification.controller.js',
    'backend/dist/models/registrationValidation.js',
    'backend/dist/models/userModel.js',
    'backend/dist/models/userPutCoreTransaction.js',
    'backend/dist/modules/shop/shop.productRules.js',
    'backend/dist/modules/shop/shop.checkout.service.js',
    'backend/dist/modules/shop/shop.catalog.js',
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
    ssh.connect(HOST, port=SSH_PORT, username=USER, password=PASSWORD,
                timeout=60, banner_timeout=60, auth_timeout=60)
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

    # 5. Upload frontend build (Vite → dist/)
    log('\n==> Enviando frontend build (frontend/dist)...')
    upload_dir_recursive(sftp, 'frontend/dist', REMOTE_APP)

    # 6. Upload pasta de migration zerads (TODOS os ficheiros)
    log('\n==> Enviando pasta migration zerads...')
    upload_dir_recursive(sftp, ZERADS_MIGRATION_DIR, REMOTE_APP)

    # 6b. Verificar remoto e (se preciso) garantir migration.sql
    remote_migration_sql = posixpath.join(REMOTE_APP, ZERADS_MIGRATION_SQL)
    try:
        sftp.stat(remote_migration_sql)
        log(f'   migration.sql confirmado no remoto: {remote_migration_sql}')
    except FileNotFoundError:
        log('   migration.sql ausente no remoto após upload — reenviando...')
        upload_file(sftp, ZERADS_MIGRATION_SQL, REMOTE_APP)

    sftp.close()

    # 7. Aplicar migration zerads ANTES do restart (idempotente — CREATE TABLE IF NOT EXISTS)
    log('\n==> Aplicando migration zerads no postgres...')
    # Pipe do sql via stdin do psql dentro do container — não precisa montar volume.
    apply_cmd = (
        f'cd {REMOTE_APP} && '
        f'cat {ZERADS_MIGRATION_SQL} | '
        f'docker compose exec -T {POSTGRES_SERVICE} '
        f'psql -U {POSTGRES_USER} -d {POSTGRES_DB} -v ON_ERROR_STOP=0 2>&1'
    )
    _, stdout, stderr = ssh.exec_command(apply_cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    log(out)
    if err:
        log(f'   stderr: {err}')
    if exit_code != 0:
        log(f'   AVISO: migration retornou exit_code={exit_code} — provavelmente já aplicada. Continuando.')
    else:
        log('   Migration aplicada (ou já existia — idempotente).')

    # 8. Rebuild + recreate container app
    # IMPORTANTE: o Dockerfile usa COPY (não bind mount), então um simples
    # `docker compose restart` NÃO traz os ficheiros uploadados via SFTP para
    # dentro do container — a imagem precisa ser reconstruída. Por isso fazemos
    # `build` + `up -d --force-recreate` em vez de `restart`.
    log('\n==> Rebuildando imagem Docker (build + force-recreate)...')
    _, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_APP} && docker compose build app app_worker 2>&1 && '
        f'docker compose up -d --force-recreate app app_worker 2>&1'
    )
    log(stdout.read().decode())
    log(stderr.read().decode())

    time.sleep(6)

    # 9. Health check
    _, stdout, _ = ssh.exec_command(
        f'cd {REMOTE_APP} && docker compose ps app 2>&1'
    )
    log(stdout.read().decode())

    ssh.close()
    log('\n==> Deploy concluido com sucesso.')

if __name__ == '__main__':
    main()
