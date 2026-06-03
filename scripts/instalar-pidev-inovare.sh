#!/usr/bin/env bash
#
# Instalador Inovare Proxy v2 — somente pi-dev (~/.pi-dev/agent)
# Não altera ~/.pi/agent, ~/.claude, Cursor, VS Code nem shell rc.
#
# Uso:
#   chmod +x instalar-pidev-inovare.sh
#   ./instalar-pidev-inovare.sh
#
# Modo não-interativo:
#   VIRTUAL_KEY="sk-virt-xxx" ./instalar-pidev-inovare.sh

set -euo pipefail

BASE_URL_DEFAULT="https://api.opus-sem-limites.com.br"
PI_DEV_AGENT="${PI_CODING_AGENT_DIR:-$HOME/.pi-dev/agent}"
PI_DEV_WRAPPER="$HOME/.local/bin/pi-dev"

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

validate_key() {
  local k="$1"
  [[ "$k" =~ ^sk-virt-[A-Za-z0-9_-]{16,}$ ]]
}

VKEY="${VIRTUAL_KEY:-}"
BASE_URL="${BASE_URL_OVERRIDE:-$BASE_URL_DEFAULT}"

if [[ -z "$VKEY" ]]; then
  hdr "Chave virtual Inovare (pi-dev)"
  echo "Cole a chave sk-virt-... e aperte ENTER:"
  for try in 1 2 3; do
    read -r -p "Chave: " VKEY
    VKEY="$(echo "$VKEY" | tr -d '[:space:]')"
    if validate_key "$VKEY"; then break; fi
    err "Formato inválido (sk-virt- + mín. 24 chars)."
    [[ $try -eq 3 ]] && exit 1
  done
fi

if ! validate_key "$VKEY"; then
  err "Chave inválida."
  exit 1
fi
ok "Chave aceita (${VKEY:0:18}…)"

hdr "Testando $BASE_URL"
if command -v curl >/dev/null 2>&1; then
  HTTP="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "$BASE_URL/healthz" 2>/dev/null || echo "000")"
  case "$HTTP" in
    200) ok "Servidor respondendo" ;;
    000) warn "Sem rede — continuo mesmo assim." ;;
    *)   warn "HTTP $HTTP — continuo." ;;
  esac
fi

TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PI_DEV_AGENT"

for f in auth.json models.json settings.json; do
  if [[ -f "$PI_DEV_AGENT/$f" ]]; then
    cp "$PI_DEV_AGENT/$f" "$PI_DEV_AGENT/$f.bak.$TS"
    log "Backup: $PI_DEV_AGENT/$f.bak.$TS"
  fi
done

python3 - "$PI_DEV_AGENT" "$VKEY" "$BASE_URL" <<'PYEOF'
import json, sys
agent_dir, vkey, base = sys.argv[1], sys.argv[2], sys.argv[3]

auth = {
    "anthropic": {
        "type": "api_key",
        "key": vkey,
    }
}

models = {
    "providers": {
        "anthropic": {
            "baseUrl": base,
            "apiKey": vkey,
            "authHeader": True,
            "compat": {
                "supportsEagerToolInputStreaming": False,
                "supportsCacheControlOnTools": False,
                "sendSessionAffinityHeaders": False,
                "allowEmptySignature": True,
            },
            "modelOverrides": {
                "claude-opus-4-7": {
                    "compat": {"forceAdaptiveThinking": False}
                },
                "claude-opus-4-8": {
                    "compat": {"forceAdaptiveThinking": False}
                },
            },
        }
    }
}

settings = {
    "lastChangelogVersion": "0.78.0",
    "defaultProvider": "anthropic",
    "defaultModel": "claude-opus-4-7",
    "defaultThinkingLevel": "xhigh",
    "theme": "dark",
    "retry": {
        "enabled": True,
        "maxRetries": 50,
        "baseDelayMs": 2000,
        "provider": {
            "timeoutMs": 3000000,
            "maxRetries": 50,
            "maxRetryDelayMs": 60000,
        },
    },
    "httpIdleTimeoutMs": 3000000,
    "images": {"blockImages": False},
    "enableSkillCommands": True,
    "showHardwareCursor": True,
    "terminal": {"showTerminalProgress": True},
}

for name, data in [("auth.json", auth), ("models.json", models), ("settings.json", settings)]:
    path = f"{agent_dir}/{name}"
    existing = {}
    if __import__("os").path.isfile(path):
        try:
            with open(path) as f:
                existing = json.load(f)
        except Exception:
            existing = {}
    if name == "settings.json" and isinstance(existing, dict):
        existing.update(settings)
        data = existing
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
PYEOF

chmod 600 "$PI_DEV_AGENT"/auth.json "$PI_DEV_AGENT"/models.json "$PI_DEV_AGENT"/settings.json 2>/dev/null || true

mkdir -p "$(dirname "$PI_DEV_WRAPPER")"
cat > "$PI_DEV_WRAPPER" <<WRAPPER
#!/usr/bin/env bash
# pi-dev — proxy Inovare (isolado de ~/.pi/agent do pi v0.78.0)
export PI_CODING_AGENT_DIR="\${PI_CODING_AGENT_DIR:-\$HOME/.pi-dev/agent}"
export ANTHROPIC_BASE_URL="$BASE_URL"
export ANTHROPIC_AUTH_TOKEN="$VKEY"
export ANTHROPIC_API_KEY="$VKEY"
export ANTHROPIC_TIMEOUT="3000000"
export ANTHROPIC_MAX_RETRIES="50"
export BASH_DEFAULT_TIMEOUT_MS="300000"
export BASH_MAX_TIMEOUT_MS="600000"
export BASH_MAX_OUTPUT_LENGTH="500000"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS="64000"
export MAX_THINKING_TOKENS="64000"
export MAX_MCP_OUTPUT_TOKENS="100000"
export CLAUDE_CODE_MAX_INPUT_TOKENS="52000"
export CLAUDE_CODE_AUTO_COMPACT_THRESHOLD="52000"
export DISABLE_TELEMETRY="1"
export DISABLE_ERROR_REPORTING="1"
export DISABLE_BUG_COMMAND="1"
export DISABLE_NON_ESSENTIAL_MODEL_CALLS="1"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
export CLAUDE_CODE_DISABLE_TERMINAL_TITLE="1"
export DISABLE_AUTOUPDATER="0"
exec pi "\$@"
WRAPPER
chmod +x "$PI_DEV_WRAPPER"

hdr "RESUMO pi-dev"
ok "Agent dir: $PI_DEV_AGENT"
ok "Launcher:  $PI_DEV_WRAPPER"
echo
ok "Pronto. Use: pi-dev"
echo "  (o comando pi normal continua em ~/.pi/agent — não foi alterado)"
echo
warn "Não compartilhe a chave virtual."
