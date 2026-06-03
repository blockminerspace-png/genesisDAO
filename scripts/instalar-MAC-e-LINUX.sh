#!/usr/bin/env bash
#
# Instalador Inovare Proxy v2 — macOS e Linux
#
# Configura o Claude Code (CLI + VS Code + Cursor + Antigravity + Continue + Cline + Roo Code)
# pra usar o proxy Inovare (api.opus-sem-limites.com.br) com a chave virtual do cliente.
#
# Estratégia "à prova de erros":
#   1. Pede a chave virtual sk-virt-... ao cliente (valida formato)
#   2. Cria backup .bak.TIMESTAMP de TUDO que existir antes de modificar
#   3. Instala em VÁRIOS lugares possíveis (cobre TODAS as IDEs conhecidas)
#   4. Merge inteligente quando o arquivo tem outras configs (não destroi nada)
#   5. Exporta também no shell (.zshrc, .bashrc, .profile) pra qualquer SDK
#   6. Roda de qualquer pasta (auto-detecta SCRIPT_DIR)
#
# Uso:
#   chmod +x instalar-MAC-e-LINUX.sh
#   ./instalar-MAC-e-LINUX.sh
#
# Modo não-interativo (chave via variável):
#   VIRTUAL_KEY="sk-virt-xxx" ./instalar-MAC-e-LINUX.sh
#
# Somente pi-dev (não mexe no pi v0.78.0 nem IDEs):
#   ./instalar-pidev-inovare.sh

set -euo pipefail

# ======== Configurações ========
BASE_URL_DEFAULT="https://api.opus-sem-limites.com.br"

# ======== Cores ========
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; CYAN=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; RESET=''
fi
log()  { printf "%s[*]%s %s\n"  "$BLUE"   "$RESET" "$*"; }
ok()   { printf "%s[OK]%s %s\n" "$GREEN"  "$RESET" "$*"; }
warn() { printf "%s[!]%s %s\n"  "$YELLOW" "$RESET" "$*"; }
err()  { printf "%s[X]%s %s\n"  "$RED"    "$RESET" "$*" >&2; }
hdr()  { printf "\n%s%s%s\n" "$BOLD$CYAN" "==> $*" "$RESET"; }

# ======== Detectar SO ========
OS_KIND="$(uname -s)"
case "$OS_KIND" in
  Darwin)  PLATFORM="macOS"  ;;
  Linux)   PLATFORM="Linux"  ;;
  *)       err "SO não suportado: $OS_KIND. Use instalar-WINDOWS.ps1 no Windows."; exit 1 ;;
esac

# ======== Auto-detect SCRIPT_DIR (funciona de qualquer pasta) ========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "$PWD")"

# ======== Header ========
clear 2>/dev/null || true
echo "${BOLD}${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         INSTALADOR INOVARE PROXY v2                           ║"
echo "║         Configura Claude Code para todas as IDEs              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo "${RESET}"
log "SO detectado:  $PLATFORM"
log "Usuário:       ${USER:-$(whoami 2>/dev/null || echo unknown)}"
log "Home:          ${HOME:-/tmp}"
log "Script em:     $SCRIPT_DIR"
echo

# ======== Pré-requisitos ========
if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  warn "Python não encontrado — vou usar fallback simples (sem merge inteligente)."
  HAS_PYTHON=0
else
  HAS_PYTHON=1
fi

# ======== Pedir/Validar a chave virtual ========
VKEY="${VIRTUAL_KEY:-}"
BASE_URL="${BASE_URL_OVERRIDE:-$BASE_URL_DEFAULT}"

validate_key() {
  local k="$1"
  # Formato: sk-virt- seguido de pelo menos 16 chars alfanuméricos + _ + -
  [[ "$k" =~ ^sk-virt-[A-Za-z0-9_-]{16,}$ ]]
}

if [[ -z "$VKEY" ]]; then
  hdr "Sua chave virtual de cliente"
  echo "Cole a chave (formato sk-virt-...) e aperte ENTER:"
  echo "Você recebeu ela junto com este instalador."
  echo
  for try in 1 2 3; do
    read -r -p "Chave: " VKEY
    VKEY="$(echo "$VKEY" | tr -d '[:space:]')"
    if validate_key "$VKEY"; then break; fi
    err "Chave fora do formato esperado (deve começar com sk-virt- e ter ao menos 24 chars)."
    if [[ $try -eq 3 ]]; then
      err "3 tentativas erradas. Verifique a chave e rode o instalador de novo."
      exit 1
    fi
    warn "Tente de novo (tentativa $((try + 1)) de 3)."
  done
fi

if ! validate_key "$VKEY"; then
  err "Chave inválida: $VKEY"
  exit 1
fi
ok "Chave aceita (${VKEY:0:18}…)"

# ======== Testar conectividade com o proxy (smoke test rápido) ========
hdr "Testando conexão com o servidor Inovare"
if command -v curl >/dev/null 2>&1; then
  HTTP="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "$BASE_URL/healthz" 2>/dev/null || echo "000")"
  case "$HTTP" in
    200) ok "Servidor respondendo ($BASE_URL)" ;;
    000) warn "Sem rede ou servidor inacessível — vou instalar mesmo assim." ;;
    *)   warn "Servidor respondeu HTTP $HTTP — vou continuar." ;;
  esac
else
  warn "curl não encontrado, pulando teste de conectividade."
fi

# ======== Construir o settings.json final (com a chave injetada) ========
SETTINGS_JSON='{
  "env": {
    "ANTHROPIC_BASE_URL": "'"$BASE_URL"'",
    "ANTHROPIC_AUTH_TOKEN": "'"$VKEY"'",
    "ANTHROPIC_API_KEY": "'"$VKEY"'",
    "ANTHROPIC_TIMEOUT": "3000000",
    "ANTHROPIC_MAX_RETRIES": "50",
    "BASH_DEFAULT_TIMEOUT_MS": "300000",
    "BASH_MAX_TIMEOUT_MS": "600000",
    "BASH_MAX_OUTPUT_LENGTH": "500000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000",
    "MAX_THINKING_TOKENS": "64000",
    "MAX_MCP_OUTPUT_TOKENS": "100000",
    "CLAUDE_CODE_MAX_INPUT_TOKENS": "52000",
    "CLAUDE_CODE_AUTO_COMPACT_THRESHOLD": "52000",
    "DISABLE_TELEMETRY": "1",
    "DISABLE_ERROR_REPORTING": "1",
    "DISABLE_BUG_COMMAND": "1",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1",
    "DISABLE_AUTOUPDATER": "0"
  }
}'

# Salva em tempfile (vamos reusar)
SETTINGS_TMP="$(mktemp -t inovare-settings.XXXXXX)"
trap 'rm -f "$SETTINGS_TMP"' EXIT
echo "$SETTINGS_JSON" > "$SETTINGS_TMP"

# Valida JSON
if [[ $HAS_PYTHON -eq 1 ]]; then
  python3 -m json.tool "$SETTINGS_TMP" >/dev/null 2>&1 || python -m json.tool "$SETTINGS_TMP" >/dev/null
fi

# ======== Função: instalar settings.json em um destino (com merge inteligente) ========
TS="$(date +%Y%m%d-%H%M%S)"
INSTALLED=0
SKIPPED=0
ERRORED=0
INSTALLED_PATHS=()

install_settings() {
  local target="$1"
  local target_dir
  target_dir="$(dirname "$target")"

  if ! mkdir -p "$target_dir" 2>/dev/null; then
    warn "  Sem permissão pra criar $target_dir — pulando."
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  # Backup se já existe
  if [[ -f "$target" ]]; then
    local backup="$target.bak.$TS"
    if cp "$target" "$backup" 2>/dev/null; then
      log "  Backup: $backup"
    else
      warn "  Falha no backup — pulando."
      ERRORED=$((ERRORED + 1))
      return 0
    fi

    # Merge inteligente: mantém outras chaves que existirem
    if [[ $HAS_PYTHON -eq 1 ]]; then
      local merged_tmp
      merged_tmp="$(mktemp -t inovare-merged.XXXXXX)"
      if python3 - "$target" "$SETTINGS_TMP" "$merged_tmp" <<'PYEOF' 2>/dev/null
import json, sys
existing_path, new_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(existing_path) as f:
        existing = json.load(f)
except Exception:
    existing = {}
if not isinstance(existing, dict):
    existing = {}
with open(new_path) as f:
    new_cfg = json.load(f)
# Merge profundo: existing receives new_cfg, env é mesclado chave a chave
if "env" in new_cfg and isinstance(new_cfg["env"], dict):
    existing_env = existing.get("env") if isinstance(existing.get("env"), dict) else {}
    existing_env.update(new_cfg["env"])
    existing["env"] = existing_env
# Outras chaves top-level do new_cfg sobrescrevem (caso adicionemos futuramente)
for k, v in new_cfg.items():
    if k != "env":
        existing[k] = v
with open(out_path, "w") as f:
    json.dump(existing, f, indent=2, ensure_ascii=False)
PYEOF
      then
        cp "$merged_tmp" "$target" && {
          chmod 600 "$target" 2>/dev/null || true
          rm -f "$merged_tmp"
          ok "  ✓ $target (merge)"
          INSTALLED=$((INSTALLED + 1))
          INSTALLED_PATHS+=("$target")
          return 0
        }
        rm -f "$merged_tmp"
        warn "  Merge falhou — vou sobrescrever (backup já feito)"
      fi
      rm -f "$merged_tmp"
    fi
  fi

  # Sem merge (ou sem python): apenas copia
  if cp "$SETTINGS_TMP" "$target" 2>/dev/null; then
    chmod 600 "$target" 2>/dev/null || true
    ok "  ✓ $target"
    INSTALLED=$((INSTALLED + 1))
    INSTALLED_PATHS+=("$target")
  else
    err "  ✗ Falha em $target"
    ERRORED=$((ERRORED + 1))
  fi
}

# ======== 1. Claude Code CLI (oficial Anthropic) ========
hdr "1/6 · Claude Code CLI"
install_settings "$HOME/.claude/settings.json"
install_settings "$HOME/.claude.json"  # versões mais antigas

# ======== 2. Antigravity (Google) — 5 caminhos possíveis ========
hdr "2/6 · Antigravity (Google) — múltiplos caminhos"
install_settings "$HOME/.gemini/antigravity-cli/settings.json"
install_settings "$HOME/.gemini/antigravity-ide/settings.json"
install_settings "$HOME/.gemini/antigravity/settings.json"
install_settings "$HOME/.gemini/config/settings.json"
install_settings "$HOME/.antigravity/settings.json"

if [[ "$PLATFORM" == "macOS" ]]; then
  ANTIGRAV_VS_DIR="$HOME/Library/Application Support/Antigravity/User"
else
  ANTIGRAV_VS_DIR="$HOME/.config/Antigravity/User"
fi
if [[ -d "$(dirname "$ANTIGRAV_VS_DIR")" ]]; then
  install_settings "$ANTIGRAV_VS_DIR/settings.json"
else
  log "  Antigravity não instalado nesta máquina (pulando caminho VS Code-style)"
fi

# ======== 3. Cursor IDE ========
hdr "3/6 · Cursor IDE"
# Cursor usa os mesmos env vars do Claude Code se rodar Claude Code via terminal embutido.
# Também tem settings.json próprio (não confundir com Anthropic API).
if [[ "$PLATFORM" == "macOS" ]]; then
  CURSOR_DIR="$HOME/Library/Application Support/Cursor/User"
else
  CURSOR_DIR="$HOME/.config/Cursor/User"
fi
if [[ -d "$(dirname "$CURSOR_DIR")" ]]; then
  # Cursor settings.json é diferente (não usa "env"), mas vamos garantir merge
  install_settings "$CURSOR_DIR/settings.json"
else
  log "  Cursor não detectado (instale o Cursor antes pra ver os efeitos)"
fi

# ======== 4. VS Code + Continue extension ========
hdr "4/6 · VS Code (settings + Continue extension)"
if [[ "$PLATFORM" == "macOS" ]]; then
  VSCODE_DIR="$HOME/Library/Application Support/Code/User"
else
  VSCODE_DIR="$HOME/.config/Code/User"
fi
if [[ -d "$(dirname "$VSCODE_DIR")" ]]; then
  install_settings "$VSCODE_DIR/settings.json"
else
  log "  VS Code não detectado"
fi

# Continue extension config
CONT_DIR="$HOME/.continue"
mkdir -p "$CONT_DIR" 2>/dev/null || true
CONT_FILE="$CONT_DIR/config.json"
if [[ -f "$CONT_FILE" && $HAS_PYTHON -eq 1 ]]; then
  # Merge Continue (insere model anthropic apontando pro proxy)
  CONT_BAK="$CONT_FILE.bak.$TS"
  cp "$CONT_FILE" "$CONT_BAK" && log "  Backup Continue: $CONT_BAK"
  python3 - "$CONT_FILE" "$VKEY" "$BASE_URL" <<'PYEOF' || warn "  Merge Continue falhou"
import json, sys
fp, vkey, base = sys.argv[1], sys.argv[2], sys.argv[3]
with open(fp) as f:
    try:
        cfg = json.load(f)
    except Exception:
        cfg = {}
if not isinstance(cfg, dict):
    cfg = {}
cfg.setdefault("models", [])
# Remove modelos antigos do Inovare se existirem
cfg["models"] = [m for m in cfg["models"] if not (isinstance(m, dict) and "Inovare" in str(m.get("title", "")))]
# Adiciona modelos novos
for label, model in [
    ("Inovare Opus 4.8",   "claude-opus-4-8"),
    ("Inovare Sonnet 4.5", "claude-sonnet-4-5"),
    ("Inovare Haiku 4.5",  "claude-haiku-4-5"),
]:
    cfg["models"].append({
        "title": label,
        "provider": "anthropic",
        "model": model,
        "apiKey": vkey,
        "apiBase": base,
    })
with open(fp, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PYEOF
  ok "  ✓ Continue extension (~/.continue/config.json)"
  INSTALLED=$((INSTALLED + 1))
  INSTALLED_PATHS+=("$CONT_FILE")
elif [[ $HAS_PYTHON -eq 1 ]]; then
  # Cria do zero
  python3 - "$CONT_FILE" "$VKEY" "$BASE_URL" <<'PYEOF'
import json, sys
fp, vkey, base = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {
    "models": [
        {"title":"Inovare Opus 4.8",   "provider":"anthropic", "model":"claude-opus-4-8",   "apiKey":vkey, "apiBase":base},
        {"title":"Inovare Sonnet 4.5", "provider":"anthropic", "model":"claude-sonnet-4-5", "apiKey":vkey, "apiBase":base},
        {"title":"Inovare Haiku 4.5",  "provider":"anthropic", "model":"claude-haiku-4-5",  "apiKey":vkey, "apiBase":base},
    ],
}
with open(fp, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PYEOF
  ok "  ✓ Continue extension (criado novo)"
  INSTALLED=$((INSTALLED + 1))
  INSTALLED_PATHS+=("$CONT_FILE")
fi

# ======== 5. Cline / Roo Code (via VS Code settings.json keys) ========
hdr "5/6 · Cline + Roo Code (via VS Code settings.json)"
# Cline e Roo Code leem chaves específicas do settings.json do VS Code
if [[ -f "$VSCODE_DIR/settings.json" && $HAS_PYTHON -eq 1 ]]; then
  python3 - "$VSCODE_DIR/settings.json" "$VKEY" "$BASE_URL" <<'PYEOF' || warn "  Falha no merge Cline/Roo"
import json, sys
fp, vkey, base = sys.argv[1], sys.argv[2], sys.argv[3]
with open(fp) as f:
    try:
        cfg = json.load(f)
    except Exception:
        cfg = {}
if not isinstance(cfg, dict):
    cfg = {}
# Cline
cfg["cline.apiProvider"] = "anthropic"
cfg["cline.apiKey"] = vkey
cfg["cline.anthropicBaseUrl"] = base
cfg["cline.apiModelId"] = "claude-opus-4-8"
# Roo Code (mesmo formato)
cfg["roo-cline.apiProvider"] = "anthropic"
cfg["roo-cline.apiKey"] = vkey
cfg["roo-cline.anthropicBaseUrl"] = base
cfg["roo-cline.apiModelId"] = "claude-opus-4-8"
with open(fp, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PYEOF
  ok "  ✓ Cline + Roo Code keys adicionadas no VS Code settings.json"
fi

# ======== 6. Shell environment (ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY) ========
hdr "6/6 · Shell environment (cobre QUALQUER SDK Anthropic)"
INOVARE_MARKER_START="# >>> INOVARE PROXY (instalador v2) >>>"
INOVARE_MARKER_END="# <<< INOVARE PROXY (instalador v2) <<<"
EXPORT_BLOCK="$INOVARE_MARKER_START
# Configurado pelo instalador-MAC-e-LINUX.sh
export ANTHROPIC_BASE_URL=\"$BASE_URL\"
export ANTHROPIC_AUTH_TOKEN=\"$VKEY\"
export ANTHROPIC_API_KEY=\"$VKEY\"
$INOVARE_MARKER_END"

for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile"; do
  # Só mexe se já existe (não cria .bashrc se a pessoa só usa zsh, etc)
  if [[ ! -f "$rc" ]]; then
    # Cria .zshrc no macOS (default) e .bashrc no Linux
    case "$rc" in
      *zshrc)
        [[ "$PLATFORM" == "macOS" ]] && touch "$rc"
        ;;
      *bashrc)
        [[ "$PLATFORM" == "Linux" ]] && touch "$rc"
        ;;
    esac
  fi
  [[ -f "$rc" ]] || continue

  # Backup
  cp "$rc" "$rc.bak.$TS" 2>/dev/null && log "  Backup: $rc.bak.$TS"

  # Remove bloco antigo (idempotência)
  if grep -q "$INOVARE_MARKER_START" "$rc" 2>/dev/null; then
    # Apaga linhas entre markers (inclusive)
    if command -v gsed >/dev/null 2>&1; then
      SED_CMD=gsed
    else
      SED_CMD=sed
    fi
    # macOS sed precisa de '' depois do -i
    if [[ "$PLATFORM" == "macOS" ]] && [[ $SED_CMD == "sed" ]]; then
      $SED_CMD -i '' "/$INOVARE_MARKER_START/,/$INOVARE_MARKER_END/d" "$rc"
    else
      $SED_CMD -i "/$INOVARE_MARKER_START/,/$INOVARE_MARKER_END/d" "$rc"
    fi
    log "  Bloco antigo removido em $rc"
  fi

  # Adiciona bloco novo no final
  printf "\n%s\n" "$EXPORT_BLOCK" >> "$rc"
  ok "  ✓ $rc (export ANTHROPIC_*)"
  INSTALLED=$((INSTALLED + 1))
  INSTALLED_PATHS+=("$rc")
done

# ======== Resumo ========
hdr "RESUMO"
ok  "Instalações OK: $INSTALLED"
[[ $SKIPPED -gt 0 ]] && warn "Pulados: $SKIPPED"
[[ $ERRORED -gt 0 ]] && err "Erros:   $ERRORED"

echo
log "Arquivos modificados:"
for p in "${INSTALLED_PATHS[@]}"; do
  echo "    • $p"
done

echo
ok "${BOLD}Pronto!${RESET} Próximos passos:"
echo "  1. ${BOLD}FECHE todos os terminais e IDEs abertos.${RESET}"
echo "  2. Abra um terminal NOVO (pra carregar as variáveis de ambiente)."
echo "  3. No Claude Code, rode: ${CYAN}claude${RESET}"
echo "  4. No VS Code com Continue: abra a barra do Continue e veja 'Inovare Opus 4.8' no dropdown."
echo
echo "Backups com timestamp $TS estão preservados ao lado de cada arquivo modificado."
echo "Pra reverter: ${CYAN}cp ARQUIVO.bak.$TS ARQUIVO${RESET}"
echo
warn "Não compartilhe esta chave virtual com ninguém — ela é única do seu cliente."
echo
