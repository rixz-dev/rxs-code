#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — rxs-code installer
# Usage : bash setup.sh [--global] [--no-env]
#   --global   symlink ke /usr/local/bin (butuh sudo di Linux)
#   --no-env   skip .env setup (kalau udah ada)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Flags ─────────────────────────────────────────────────────────────────────
OPT_GLOBAL=false
OPT_NO_ENV=false
for arg in "$@"; do
  case "$arg" in
    --global)  OPT_GLOBAL=true ;;
    --no-env)  OPT_NO_ENV=true ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_GREEN='\033[38;5;82m'
  C_CYAN='\033[38;5;51m'
  C_YELLOW='\033[38;5;220m'
  C_RED='\033[38;5;196m'
  C_PURPLE='\033[38;5;141m'
  C_WHITE='\033[97m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_GREEN='' C_CYAN=''
  C_YELLOW='' C_RED='' C_PURPLE='' C_WHITE=''
fi

ok()   { echo -e "  ${C_GREEN}✓${C_RESET}  $*"; }
info() { echo -e "  ${C_CYAN}◈${C_RESET}  $*"; }
warn() { echo -e "  ${C_YELLOW}⚠${C_RESET}  $*"; }
die()  { echo -e "  ${C_RED}✖${C_RESET}  $*" >&2; exit 1; }
step() { echo -e "\n${C_PURPLE}${C_BOLD}▸ $*${C_RESET}"; }
dim()  { echo -e "  ${C_DIM}$*${C_RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_PURPLE}${C_BOLD}"
echo "  ██████╗ ██╗  ██╗███████╗      ██████╗ ██████╗ ██████╗ ███████╗"
echo "  ██╔══██╗╚██╗██╔╝██╔════╝     ██╔════╝██╔═══██╗██╔══██╗██╔════╝"
echo "  ██████╔╝ ╚███╔╝ ███████╗     ██║     ██║   ██║██║  ██║█████╗  "
echo "  ██╔══██╗ ██╔██╗ ╚════██║     ██║     ██║   ██║██║  ██║██╔══╝  "
echo "  ██║  ██║██╔╝ ██╗███████║     ╚██████╗╚██████╔╝██████╔╝███████╗"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝"
echo -e "${C_RESET}"
echo -e "  ${C_DIM}Terminal AI Coding Assistant — v$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo '?')${C_RESET}"
echo ""

# ── Detect environment ─────────────────────────────────────────────────────────
IS_TERMUX=false
if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; then
  IS_TERMUX=true
fi

# ── Detect project root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  die "package.json not found. Jalankan setup.sh dari root project rxs-code."
fi

BIN_SRC="$PROJECT_DIR/bin/rxs-code"
if [ ! -f "$BIN_SRC" ]; then
  die "bin/rxs-code tidak ditemukan di $BIN_SRC"
fi

info "Project   : ${C_WHITE}$PROJECT_DIR${C_RESET}"
if $IS_TERMUX; then
  info "Env       : ${C_CYAN}Termux${C_RESET}"
else
  info "Env       : ${C_CYAN}Linux$([ "$(uname -s)" = "Darwin" ] && echo " / macOS")${C_RESET}"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Checking Node.js"
# ─────────────────────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  if $IS_TERMUX; then
    die "Node.js tidak ditemukan. Install: pkg install nodejs"
  else
    die "Node.js tidak ditemukan. Install: https://nodejs.org  atau  nvm install 20"
  fi
fi

NODE_VER=$(node --version)
NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')

if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js $NODE_VER terlalu lama. Butuh >=18. $(
    $IS_TERMUX && echo 'pkg install nodejs' || echo 'nvm install 20'
  )"
fi

ok "Node.js $NODE_VER"

if ! command -v npm &>/dev/null; then
  die "npm tidak ditemukan."
fi
ok "npm $(npm --version)"

# ─────────────────────────────────────────────────────────────────────────────
step "Installing dependencies"
# ─────────────────────────────────────────────────────────────────────────────

cd "$PROJECT_DIR"

if [ -f "package-lock.json" ]; then
  npm ci --prefer-offline 2>&1 | tail -3
else
  npm install 2>&1 | tail -3
fi

ok "node_modules installed"

# ─────────────────────────────────────────────────────────────────────────────
step "Setting up binary"
# ─────────────────────────────────────────────────────────────────────────────

chmod +x "$BIN_SRC"
ok "chmod +x bin/rxs-code"

# Resolve symlink target ───────────────────────────────────────────────────────
if $IS_TERMUX; then
  BIN_DIR="$PREFIX/bin"
elif $OPT_GLOBAL; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi

LINK_TARGET="$BIN_DIR/rxs-code"

# Remove stale symlink / old binary
if [ -L "$LINK_TARGET" ] || [ -f "$LINK_TARGET" ]; then
  rm -f "$LINK_TARGET"
  dim "Removed existing $LINK_TARGET"
fi

# Create symlink — sudo kalau /usr/local/bin dan bukan Termux
if $OPT_GLOBAL && ! $IS_TERMUX; then
  sudo ln -sf "$BIN_SRC" "$LINK_TARGET"
else
  ln -sf "$BIN_SRC" "$LINK_TARGET"
fi

ok "Symlinked  → $LINK_TARGET"

# PATH warning kalau ~/.local/bin belum di PATH ────────────────────────────────
if ! $IS_TERMUX && ! $OPT_GLOBAL; then
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    warn "${C_YELLOW}~/.local/bin belum ada di \$PATH.${C_RESET}"
    echo ""
    echo -e "  Tambahkan ke ${C_WHITE}~/.bashrc${C_RESET} atau ${C_WHITE}~/.zshrc${C_RESET}:"
    echo -e "  ${C_DIM}export PATH=\"\$HOME/.local/bin:\$PATH\"${C_RESET}"
    echo ""
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Creating config directory"
# ─────────────────────────────────────────────────────────────────────────────

RXS_CONFIG_DIR="$HOME/.rxs-code"
mkdir -p "$RXS_CONFIG_DIR"
ok "Config dir : $RXS_CONFIG_DIR"

# ─────────────────────────────────────────────────────────────────────────────
step "Setting up .env"
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

if $OPT_NO_ENV; then
  dim "Skipped (.env) — --no-env flag aktif"
elif [ -f "$ENV_FILE" ]; then
  ok ".env sudah ada — skip"

  # Cek minimal 1 API key sudah diset
  KEY_FOUND=false
  for key in GROQ_API_KEY NVIDIA_NIM_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY \
             CEREBRAS_API_KEY XAI_API_KEY MISTRAL_API_KEY SAMBANOVA_API_KEY \
             TOGETHER_API_KEY KIMI_API_KEY QWEN_API_KEY MINIMAX_API_KEY; do
    val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"'"'"' ')
    if [ -n "$val" ] && [ "$val" != "your_key_here" ] && [ "$val" != "" ]; then
      KEY_FOUND=true
      ok "API key   : ${C_DIM}${key} (set)${C_RESET}"
      break
    fi
  done

  if ! $KEY_FOUND; then
    warn "Tidak ada API key yang diset di .env"
    echo ""
    echo -e "  ${C_BOLD}Set minimal satu dari ini:${C_RESET}"
    echo -e "  ${C_GREEN}GROQ_API_KEY${C_RESET}         ${C_DIM}→ https://console.groq.com         (fastest free)${C_RESET}"
    echo -e "  ${C_GREEN}CEREBRAS_API_KEY${C_RESET}     ${C_DIM}→ https://cloud.cerebras.ai        (1M tok/day)${C_RESET}"
    echo -e "  ${C_GREEN}GEMINI_API_KEY${C_RESET}       ${C_DIM}→ https://aistudio.google.com      (1500 req/day)${C_RESET}"
    echo -e "  ${C_GREEN}OPENROUTER_API_KEY${C_RESET}   ${C_DIM}→ https://openrouter.ai/keys       (30+ free models)${C_RESET}"
    echo ""
    echo -e "  Edit: ${C_WHITE}nano $ENV_FILE${C_RESET}"
    echo ""
  fi

else
  # Generate .env dari .env.example kalau ada, atau buat template baru
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env dibuat dari .env.example"
  else
    cat > "$ENV_FILE" <<'ENVTEMPLATE'
# ─── rxs-code API Keys ───────────────────────────────────────────────────────
# Isi minimal satu. Tool akan auto-detect yang tersedia.

# === FAST / FREE ===
GROQ_API_KEY=
CEREBRAS_API_KEY=
SAMBANOVA_API_KEY=

# === FREE CREDITS ===
XAI_API_KEY=
TOGETHER_API_KEY=
KIMI_API_KEY=
QWEN_API_KEY=
MINIMAX_API_KEY=

# === ONGOING FREE TIER ===
GEMINI_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
NVIDIA_NIM_API_KEY=

# ─── Optional Config ─────────────────────────────────────────────────────────
# RXS_PROVIDER=auto            # force provider: groq | gemini | openrouter | ...
# RXS_DEFAULT_MODEL=auto       # force model ID
# RXS_MAX_CONTEXT_TOKENS=120000
# RXS_MAX_RESPONSE_TOKENS=8000
# RXS_TEMPERATURE=0.7
# TAVILY_API_KEY=              # untuk web_search tool
ENVTEMPLATE
    ok ".env template dibuat"
  fi

  warn "Jangan lupa isi API key di .env sebelum run:"
  echo -e "  ${C_WHITE}nano $ENV_FILE${C_RESET}"
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Checking optional tools"
# ─────────────────────────────────────────────────────────────────────────────

check_tool() {
  local bin="$1" label="$2" install_hint="$3"
  if command -v "$bin" &>/dev/null; then
    ok "$label"
  else
    warn "${C_DIM}$label tidak ditemukan${C_RESET}  ${C_DIM}($install_hint)${C_RESET}"
  fi
}

check_tool fzf    "fzf        (interactive model picker)" \
  "$($IS_TERMUX && echo 'pkg install fzf' || echo 'brew install fzf / apt install fzf')"

check_tool rg     "ripgrep    (faster code search)" \
  "$($IS_TERMUX && echo 'pkg install ripgrep' || echo 'apt install ripgrep / brew install ripgrep')"

check_tool git    "git        (required for /git command)" \
  "$($IS_TERMUX && echo 'pkg install git' || echo 'apt install git')"

# Termux-specific
if $IS_TERMUX; then
  check_tool termux-clipboard-set "termux-api (clipboard support)" "pkg install termux-api"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}${C_BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}  ✓  rxs-code siap.${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo ""
echo -e "  ${C_BOLD}Run:${C_RESET}"
echo -e "  ${C_WHITE}rxs-code${C_RESET}                     ${C_DIM}# interactive mode${C_RESET}"
echo -e "  ${C_WHITE}rxs-code --prompt \"...\"${C_RESET}       ${C_DIM}# one-shot mode${C_RESET}"
echo -e "  ${C_WHITE}rxs-code /doctor${C_RESET}             ${C_DIM}# cek environment${C_RESET}"
echo ""
echo -e "  ${C_DIM}Project: $PROJECT_DIR${C_RESET}"
echo -e "  ${C_DIM}Config : $RXS_CONFIG_DIR${C_RESET}"
echo ""
