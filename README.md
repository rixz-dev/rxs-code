# rxs-code

```
 ██████╗ ██╗  ██╗███████╗      ██████╗ ██████╗ ██████╗ ███████╗
 ██╔══██╗╚██╗██╔╝██╔════╝     ██╔════╝██╔═══██╗██╔══██╗██╔════╝
 ██████╔╝ ╚███╔╝ ███████╗     ██║     ██║   ██║██║  ██║█████╗
 ██╔══██╗ ██╔██╗ ╚════██║     ██║     ██║   ██║██║  ██║██╔══╝
 ██║  ██║██╔╝ ██╗███████║     ╚██████╗╚██████╔╝██████╔╝███████╗
 ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
```

**Terminal AI Coding Assistant — v0.3.0**

Multi-provider, streaming, tool-use. Dibangun buat Termux & Linux.
Bukan wrapper API biasa — ini autonomous coding agent yang bisa baca, edit, jalanin kode, browsing, dan manage task sendiri.

---

## Daftar Isi

- [Requirements](#requirements)
- [Install](#install)
- [Konfigurasi](#konfigurasi)
- [Quick Start](#quick-start)
- [Providers](#providers)
- [Tools](#tools--apa-yang-bisa-dilakukan-ai)
- [Skills](#skills--auto-deteksi)
- [Commands](#commands)
- [Themes](#themes)
- [Fitur Lanjutan](#fitur-lanjutan)
- [Non-Interactive Mode](#non-interactive-mode)
- [Struktur Project](#struktur-project)

---

## Requirements

| Dependency | Versi | Keterangan |
|---|---|---|
| **Node.js** | ≥ 18 | ESM modules, native fetch |
| **npm** | ≥ 8 | bundled sama Node |
| **git** | any | untuk `/git` command |
| **fzf** | any | _opsional_ — interactive model picker |
| **ripgrep** | any | _opsional_ — faster code search (fallback ke grep) |
| **termux-api** | any | _opsional, Termux only_ — clipboard support |

**Minimal satu API key** dari provider yang didukung. Lihat bagian [Providers](#providers).

### Install Node.js

```bash
# Termux
pkg install nodejs

# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# macOS
brew install node

# nvm (universal)
nvm install 20 && nvm use 20
```

---

## Install

```bash
git clone https://github.com/rixz-dev/rxs-code.git
cd rxs-code
bash setup.sh
```

Script `setup.sh` otomatis:
- Cek Node.js version
- `npm ci` install dependencies
- `chmod +x bin/rxs-code`
- Buat symlink ke `$PREFIX/bin` (Termux) atau `~/.local/bin` (Linux)
- Generate `.env` template kalau belum ada
- Cek optional tools

**Flags:**
```bash
bash setup.sh --global    # symlink ke /usr/local/bin (butuh sudo)
bash setup.sh --no-env    # skip .env setup
```

**Manual install:**
```bash
chmod +x bin/rxs-code
npm install
ln -sf "$(pwd)/bin/rxs-code" "$PREFIX/bin/rxs-code"   # Termux
# atau
ln -sf "$(pwd)/bin/rxs-code" "$HOME/.local/bin/rxs-code"   # Linux
```

---

## Konfigurasi

Copy dan edit `.env` di root project:

```bash
cp .env.example .env
nano .env
```

### API Keys

Isi **minimal satu** key. Tool auto-detect provider mana yang tersedia sesuai urutan prioritas.

```env
# ── FAST / FREE ───────────────────────────────────────────────
GROQ_API_KEY=          # https://console.groq.com         — tercepat, LPU hardware
CEREBRAS_API_KEY=      # https://cloud.cerebras.ai        — 1M tok/day, WSE chip
SAMBANOVA_API_KEY=     # https://cloud.sambanova.ai       — free, RDU inference

# ── FREE CREDITS ──────────────────────────────────────────────
XAI_API_KEY=           # https://console.x.ai             — $175 kredit bulan pertama
TOGETHER_API_KEY=      # https://api.together.ai          — ~$100 credits
KIMI_API_KEY=          # https://platform.moonshot.ai     — trial credits
QWEN_API_KEY=          # https://alibabacloud.com         — trial credits
MINIMAX_API_KEY=       # https://platform.minimax.io      — trial credits

# ── ONGOING FREE TIER ─────────────────────────────────────────
GEMINI_API_KEY=        # https://aistudio.google.com      — 1500 req/day
MISTRAL_API_KEY=       # https://console.mistral.ai       — 1B tok/month
OPENROUTER_API_KEY=    # https://openrouter.ai/keys       — 30+ free models
NVIDIA_NIM_API_KEY=    # https://build.nvidia.com         — free NIM credits

# ── OPTIONAL ──────────────────────────────────────────────────
TAVILY_API_KEY=        # https://tavily.com               — untuk web_search tool
```

### Config Opsional

```env
RXS_PROVIDER=auto               # force provider: groq | gemini | openrouter | ...
RXS_DEFAULT_MODEL=auto          # force model ID
RXS_MAX_CONTEXT_TOKENS=120000   # batas context window
RXS_MAX_RESPONSE_TOKENS=8000    # max output per response
RXS_TEMPERATURE=0.7             # kreativitas (0.0–1.0)
```

---

## Quick Start

```bash
rxs-code                     # masuk interactive mode
```

```
  ❯  buat REST API untuk auth dengan JWT di Node.js
  ❯  refactor file ini biar lebih clean: src/utils/parser.js
  ❯  cari semua TODO di codebase dan buatin issue list
  ❯  debug kenapa test ini fail, cek output error-nya
```

Langsung ketik task — AI akan baca file yang relevan, edit kode, jalanin command, dan lapor hasilnya secara streaming real-time.

---

## Providers

12 provider didukung, auto-fallback berdasarkan key yang tersedia.

| Provider | Env Key | Keunggulan |
|---|---|---|
| **Groq** | `GROQ_API_KEY` | Tercepat (LPU), free tier generous |
| **Cerebras** | `CEREBRAS_API_KEY` | 1M token/hari gratis, WSE chip |
| **SambaNova** | `SAMBANOVA_API_KEY` | Free, cepat, RDU hardware |
| **xAI (Grok)** | `XAI_API_KEY` | $175 kredit pertama, Grok-3 |
| **Together AI** | `TOGETHER_API_KEY` | ~$100 credits, banyak model |
| **Kimi (Moonshot)** | `KIMI_API_KEY` | Context panjang, trial credits |
| **Qwen** | `QWEN_API_KEY` | Alibaba Cloud, trial credits |
| **Minimax** | `MINIMAX_API_KEY` | Trial credits |
| **Gemini** | `GEMINI_API_KEY` | 1500 req/hari gratis, multimodal |
| **Mistral** | `MISTRAL_API_KEY` | 1B token/bulan gratis |
| **OpenRouter** | `OPENROUTER_API_KEY` | 30+ free models, satu key |
| **NVIDIA NIM** | `NVIDIA_NIM_API_KEY` | Free NIM credits, quality models |

### Ganti Provider di Runtime

```bash
/provider groq
/provider gemini
/provider openrouter
```

Atau force dari CLI:

```bash
rxs-code --provider openrouter --model deepseek/deepseek-r1
```

---

## Tools — Apa yang Bisa Dilakukan AI

AI punya akses ke tool-tool ini selama sesi. Semua dieksekusi di mesin lokal kamu.

| Tool | Fungsi |
|---|---|
| `read_file` | Baca isi file — dengan file state cache |
| `write_file` | Tulis / overwrite file |
| `edit_file` | Edit presisi pakai str_replace — preferred untuk file existing |
| `create_file` | Buat file baru |
| `list_directory` | List isi directory, support recursive |
| `glob` | Cari file berdasarkan pattern (`**/*.ts`, `src/**/*.test.*`) |
| `execute_command` | Jalanin shell command — dengan permission prompt |
| `search_codebase` | Grep di seluruh project, ripgrep kalau tersedia |
| `web_search` | Search internet (butuh `TAVILY_API_KEY`) |
| `web_fetch` | Fetch konten dari URL |
| `todo_write` | Kelola task list dalam sesi |
| `ask_user` | AI bisa tanya clarification kalau perlu |

### Permission System

Write operations dan shell command butuh konfirmasi sebelum dieksekusi:

```
  ⚠  Allow $ npm install ?  [y]es  [n]o  [a]lways  [q]uit session
```

- `y` — allow sekali
- `a` — allow semua operasi sejenis untuk sesi ini
- `n` — deny, AI dikasih tau dan lanjut
- `q` — keluar dari sesi

Atau skip konfirmasi sepenuhnya dengan `/trust` toggle.

### File State Cache

`read_file` pakai cache berbasis hash — kalau file tidak berubah sejak terakhir dibaca, AI dapat stub ringkas bukan full content lagi. Ini hemat banyak token di project besar.

---

## Skills — Auto-Deteksi

AI otomatis load skill yang relevan berdasarkan kata kunci di prompt kamu. Tidak perlu diset manual.

| Skill | Trigger Keywords | System Prompt Tambahan |
|---|---|---|
| **frontend** | component, ui, css, html, react, vue, tailwind, design, layout, style... | Best practices frontend, aksesibilitas, mobile-first |
| **backend** | api, endpoint, database, server, auth, middleware, prisma, sql... | Security, validasi input, HTTP standards |
| **security** | vuln, exploit, pentest, audit, CVE, injection, XSS, bypass... | Offensive security mindset, attack chain thinking |
| **refactor** | refactor, clean, optimize, dry, improve, restructure, debt... | Code quality, naming, separation of concerns |

Lihat skill yang aktif:
```bash
/skills
```

---

## Commands

Semua command dimulai dengan `/`. Ketik `/help` di dalam sesi untuk quick reference.

### Navigasi & Info

| Command | Fungsi |
|---|---|
| `/help` | Tampilkan semua command |
| `/status` | Provider, model, thinking mode, tokens, roadmap aktif |
| `/tokens` | Context usage bar visual |
| `/skills` | Skill apa yang aktif di sesi ini |
| `/roadmap` | Lihat roadmap task multi-step yang sedang jalan |
| `/todos` | Task list sesi (pending / in progress / done) |

### Provider & Model

| Command | Fungsi |
|---|---|
| `/provider <name>` | Ganti provider — reset history dan model |
| `/model [id]` | Set model langsung atau buka interactive picker |
| `/models` | List semua model available dari provider aktif (dengan context window) |
| `/thinking <level>` | Set thinking mode: `off` `low` `medium` `high` `max` |
| `/refresh` | Clear model catalog cache (kalau list model stale) |

### Session & Memory

| Command | Fungsi |
|---|---|
| `/save [name]` | Simpan conversation history ke file |
| `/load [name]` | Load conversation history yang tersimpan |
| `/clear` | Hapus conversation history, reset roadmap |
| `/undo` | Hapus exchange terakhir (user + assistant) dari history |
| `/remember <teks>` | Append note ke `MEMORY.md` di project dir |
| `/memory` | Tampilkan isi `MEMORY.md` aktif |
| `/export [nama]` | Export seluruh conversation ke file `.md` |

### Context & Performance

| Command | Fungsi |
|---|---|
| `/compact` | Flag manual compact — jalan di message berikutnya |
| `/cache` | Statistik file state cache (entries, memory usage) |
| `/budget` | Status token budget aktif |
| `/continue` | Manual resume kalau response terpotong |

### Environment & Util

| Command | Fungsi |
|---|---|
| `/doctor` | Diagnosa environment: Node, git, rg, .env, API keys + live provider ping |
| `/theme [nama]` | Ganti tema UI — `dark` `cyber` `amoled` `matrix` `amber` |
| `/git` | Tampilkan git branch, status, dan 5 commit terakhir |
| `/cost` | Estimasi biaya token sesi berdasarkan model pricing |
| `/trust` | Toggle auto-approve semua write & shell operations |

---

## Themes

5 tema built-in, persistent via `~/.rxs-code/theme.json`.

| Tema | Vibe |
|---|---|
| `dark` | Default — purple accent, emerald success |
| `cyber` | Cyberpunk — neon green on black, matrix border |
| `amoled` | Pure black AMOLED — white accent, buat layar OLED |
| `matrix` | Cascading green — semua elemen hijau neon |
| `amber` | Retro terminal — amber/orange, old-school CRT feel |

```bash
/theme cyber       # switch tema
/theme             # lihat list semua tema
```

> Restart rxs-code setelah ganti tema untuk apply penuh.

---

## Fitur Lanjutan

### Roadmap System

Untuk task yang melibatkan banyak file atau langkah, AI otomatis generate roadmap terstruktur:

```
<rxs-roadmap>
GOAL: Buat REST API auth dengan JWT
[x] 1. Setup Express server + middleware
[x] 2. Buat user model + Prisma schema
[ ] 3. Implement register & login endpoint
[ ] 4. JWT sign/verify util
[ ] 5. Protected route middleware
</rxs-roadmap>
```

Roadmap di-update setiap step selesai. Kalau koneksi putus di tengah, AI otomatis resume dari step yang belum selesai tanpa ngulang yang sudah done.

```bash
/roadmap    # lihat progress roadmap saat ini
```

### Token Budget

Set budget token dan AI terus kerja autonomous sampai budget habis tanpa diminta continue:

```
+500k      → budget 500.000 token
+2m        → budget 2.000.000 token
use 1m tokens   → sama, verbose syntax
```

Berguna untuk task besar — generate seluruh codebase, dokumentasi panjang, atau analisis mendalam.

```bash
/budget    # lihat status budget saat ini
```

### Thinking Mode

Aktifkan extended thinking untuk problem kompleks yang butuh reasoning mendalam:

```bash
/thinking low      # sedikit thinking
/thinking medium   # balanced
/thinking high     # reasoning intensif
/thinking max      # maximum — lebih lambat, akurat
/thinking off      # default, tanpa thinking
```

> Support tergantung provider. Tidak semua provider support thinking mode.

### Memory System

Simpan konteks yang mau diingat AI antar sesi:

```bash
/remember stack yang dipakai: Next.js + Prisma + Supabase
/remember jangan pakai useEffect untuk data fetching
/remember prefer Server Actions untuk mutations
```

Disimpan ke `MEMORY.md` di project directory. Otomatis di-load setiap kali buka sesi di project yang sama.

AI juga auto-load `RXSCODE.md` kalau ada — taruh konvensi, arsitektur, dan aturan project di situ.

### Context Management — 3 Layer

rxs-code punya sistem otomatis buat jaga context tetap fit:

| Layer | Trigger | Cara Kerja |
|---|---|---|
| **MicroCompact** | Context > 70% | Hapus tool result lama dari memory, tanpa API call |
| **AutoCompact** | Context > 85% | Sub-agent summarize conversation, lanjut dari summary |
| **ReactiveCompact** | API return 413 | Trigger compact langsung setelah error |

Kamu tidak perlu handle ini manual — semua otomatis.

### Auto-Continue

Kalau response terpotong karena `max_output_tokens` atau network error, AI otomatis inject "Resume directly" dan lanjut sampai 3x sebelum menyerah.

Bisa juga trigger manual:
```bash
/continue
```

### RXSCODE.md — Project Context

Buat file `RXSCODE.md` di root project kamu:

```markdown
# Project Context

## Stack
- Next.js 15 App Router
- TypeScript strict
- Prisma + PostgreSQL
- Tailwind CSS

## Conventions
- Server Components by default
- Server Actions untuk mutations
- Zod untuk semua validasi

## File structure
...
```

AI akan auto-load ini setiap sesi di folder tersebut.

---

## Non-Interactive Mode

Jalanin single task langsung dari command line, tanpa masuk interactive mode:

```bash
rxs-code --prompt "buat unit test untuk src/utils/auth.ts"

rxs-code --prompt "fix ESLint errors di seluruh project" \
  --provider groq \
  --model llama-3.3-70b-versatile

rxs-code --prompt "analisa security issues di codebase ini" \
  --provider openrouter \
  --model deepseek/deepseek-r1
```

Berguna untuk CI/CD pipeline, alias, atau scripting.

---

## Diagnosa

Cek kesehatan environment dan semua provider:

```bash
/doctor
```

Output:

```
  ✓  Node.js  v22.4.0
  ✓  npm  v10.8.0
  ✓  git  git version 2.45.0
  ✓  ripgrep (rg)  ripgrep 14.1.0
  ✓  .env file  found
  ✓  API keys configured  Groq, Gemini, OpenRouter

  PROVIDER HEALTH
  ✓  groq          124ms
  ✓  gemini        201ms
  ✗  openrouter    (rate limited)
```

---

## Struktur Project

```
rxs-code/
├── bin/
│   └── rxs-code              entry point binary
├── src/
│   ├── core/
│   │   ├── cli.js            REPL loop, command handler, streaming engine
│   │   ├── context.js        file relevance detection
│   │   ├── context-manager.js 3-layer context compression
│   │   ├── file-state-cache.js hash-based file cache
│   │   ├── memory.js         MEMORY.md read/write
│   │   ├── provider-factory.js provider registry + auto-detect
│   │   ├── sub-agent.js      isolated single-task completions
│   │   └── token-budget.js   +500k / use 2m token budget parser
│   ├── providers/            satu file per provider
│   │   ├── groq-provider.js
│   │   ├── gemini-provider.js
│   │   ├── nvidia-provider.js
│   │   └── ...
│   ├── prompts/
│   │   └── system.js         system prompt builder
│   ├── skills/
│   │   ├── frontend.js       frontend skill + triggers
│   │   ├── backend.js
│   │   ├── security.js
│   │   └── refactor.js
│   ├── tools/
│   │   ├── file-ops.js       read, write, list
│   │   ├── file-edit.js      edit_file, create_file
│   │   ├── shell.js          execute_command
│   │   ├── search.js         search_codebase (grep/rg)
│   │   ├── web-fetch.js      web_search, web_fetch
│   │   ├── todo.js           todo_write
│   │   └── ask-user.js       ask_user
│   └── utils/
│       ├── config.js          .env loader + defaults
│       ├── cost.js            token cost estimator (12 model pricing)
│       ├── doctor.js          environment + provider health check
│       ├── git.js             git status, log, branch wrapper
│       ├── model-catalog.js   fetch + cache model list dari provider
│       ├── session.js         save/load conversation
│       ├── themes.js          5 color themes
│       ├── tokenizer.js       token estimator
│       └── ui.js              chalk rendering, banner, box printer
├── .env                       API keys (gitignored)
├── .env.example               template
├── MEMORY.md                  persistent memory (auto-created)
├── setup.sh                   installer
└── package.json
```

---

## Tips

**Context yang lebih baik** — taruh `RXSCODE.md` di project dengan stack, konvensi, dan file structure. AI jadi jauh lebih presisi.

**Task besar** — pakai token budget `+2m` supaya AI kerja autonomous sampai selesai tanpa kamu harus terus ketik continue.

**Model terbaik per use case:**
- Speed / free: `llama-3.3-70b-versatile` via Groq
- Reasoning: `deepseek/deepseek-r1` via OpenRouter
- Coding quality: `nvidia/llama-3.1-nemotron-70b` via NVIDIA NIM
- Long context: Kimi K2 via `moonshotai/kimi-k2-instruct`

**Termux optimization** — install `ripgrep` dan `fzf` untuk experience terbaik:
```bash
pkg install ripgrep fzf termux-api
```

**Export conversation** — pakai `/export nama-task` setelah session panjang buat dokumentasi atau review nanti.

---

## License

GPL v3 — by riz-dev
