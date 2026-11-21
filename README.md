# omp-openhop

OMP plugin that connects an [OMP](https://github.com/oh-my-pi/oh-my-pi) session to a local
[openhop](https://openhop.cfd) install. It reports openhop's proxy/keeper/guard state, rotates the
WARP exit `/64` on demand, and shows the full openhop doctor report — without touching OMP's own
inference path.

openhop stays a separate program. This package only reads openhop's state files and calls the
`openhop-hop` / `openhop-doctor` CLIs that ship with it.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
  - [Step 1 — Install openhop itself (prerequisite)](#step-1--install-openhop-itself-prerequisite)
  - [Step 2 — Install the plugin into OMP](#step-2--install-the-plugin-into-omp)
  - [Step 3 — Verify it loaded](#step-3--verify-it-loaded)
- [Usage](#usage)
  - [Daily flow (when OpenCode hits the free limit)](#daily-flow-when-opencode-hits-the-free-limit)
  - [Asking the model](#asking-the-model)
  - [`/openhop`](#openhop)
  - [Reading the status fields](#reading-the-status-fields)
  - [Common prompts](#common-prompts)
- [What it reads](#what-it-reads)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [License](#license)

## Features

- **`openhop` tool** — `status`, `hop`, `doctor` actions callable by the model.
- **`/openhop hop`** — rotate openhop's WARP exit address (single-flight, 120 s cap).
- **`/openhop doctor`** — run openhop's diagnostics and open the full report in the editor.
- **`/openhop status`** — print the same status block as the tool.
- **Read-only by default** — status never writes anything; no keeper/guard process is started.
- **Cross-platform paths** — `%LOCALAPPDATA%\openhop` on Windows, `~/.local/share/opencode-unlimited`
  (or `~/.local/share/openhop`) on Linux.
- **Optional proxy probe** — one `cloudflare.com/cdn-cgi/trace` request through `127.0.0.1:41987`
  to confirm the exit IP and WARP status.

## Requirements

- OMP (`omp` CLI) with extension support.
- Bun 1.3+ (OMP's runtime; the plugin runs in-process, nothing to install for Bun itself).
- A local [openhop](https://openhop.cfd) install for the actions to do anything. Without it, `status`
  reports "not found" and `hop`/`doctor` return an explanatory error instead of failing hard.
- Windows or Linux. (openhop itself is Windows-first; the Linux paths match `install.sh`.)

## Install

### Step 1 — Install openhop itself (prerequisite)

The plugin only talks to openhop; openhop must exist first.

1. Download and install it from [openhop.cfd](https://openhop.cfd) (Windows installer, or
   `install.sh` on Linux).
2. Open the openhop app once and press **Fix everything**. This starts the keeper, the guard and the
   local proxy on `127.0.0.1:41987`.
3. Leave it running in the tray.

### Step 2 — Install the plugin into OMP

Pick one:

**From GitHub (recommended — the npm package is not published yet):**

```bash
omp plugin install github:yayayapluto/OMP-openhop
```

**From a local checkout:**

```bash
git clone https://github.com/yayayapluto/OMP-openhop.git
cd OMP-openhop
omp plugin link .
```

**Load one file directly (quick test):**

```bash
omp --no-extensions -e ./src/index.ts -p "hello"
```

To load it in every session once installed, `omp plugin enable omp-openhop`; to pin a single file
instead, register it in `~/.omp/agent/config.yml` under `extensions:` or copy it to
`~/.omp/agent/extensions/`.

> Marketplace note: `omp plugin marketplace add yayayapluto/OMP-openhop` registers the catalog, but
> `omp plugin install omp-openhop` resolves the npm name `omp-openhop`, which 404s until the package
> is published. Use the GitHub form above meanwhile.

### Step 3 — Verify it loaded

```bash
omp plugin list
```

Then inside any OMP session run `/openhop doctor`. If you see a report instead of an error, the plugin is
live.

## Usage

### Daily flow (when OpenCode hits the free limit)

1. OpenCode shows the free-usage-limit message. Usually openhop's keeper rotates the address by
   itself and types "continue" — you don't need to do anything.
2. If it doesn't (keeper paused, stale, or you want a manual rotation), open an OMP session and run:

   ```
   /openhop hop
   ```

   You get a notification like:

   ```text
   Fresh WARP /64: 2a09:bac5:1:2::/64 → 2a09:bac5:9:8::/64. Re-send the message or continue.
   ```

3. Go back to OpenCode and re-send your message (or type "continue").

### Asking the model

The `openhop` tool is callable by the model like any other tool, so plain requests work:

```text
check openhop status
openhop status with a proxy probe
rotate openhop
run openhop doctor and tell me what's broken
```

| Action | Purpose | Notes |
| --- | --- | --- |
| `status` | Install path, proxy listen state, keeper/guard heartbeat age, pause flag, egress mode, rotations today | `probe: true` adds one trace request through the proxy |
| `hop` | Rotate the WARP `/64` via `openhop-hop` | Single-flight: a second call joins the running hop |
| `doctor` | Run `openhop-doctor` | Full text opens in the editor; the model gets a compact summary |

Example `status` output:

```text
openhop: installed (C:\Users\me\AppData\Local\openhop)
proxy 127.0.0.1:41987: listening
keeper heartbeat: 14s ago
guard heartbeat: 12s ago
rotation paused: no
egress mode: warp
rotations today: 4
```

When the proxy is down:

```text
proxy 127.0.0.1:41987: closed
hint: open the openhop app, or press "Fix everything" so the keeper/proxy runs.
```

### `/openhop`

```
/openhop            # same as /openhop status
/openhop status
/openhop hop
/openhop doctor
```

- `status` prints the status block (no probe).
- `hop` runs the single-flight rotation and notifies you with the old → new block. If it takes longer
  than 120 seconds the child process is killed and you're told to check status rather than start a
  second hop.
- `doctor` runs `openhop-doctor`, opens the raw output in the editor, and falls back to a notification
  when no editor is available. The model gets counts of `[OK]`/`[!]`/`[X]` lines plus the problems.

### Reading the status fields

| Field | Meaning | What to do |
| --- | --- | --- |
| `proxy … listening` | openhop's proxy is up on `127.0.0.1:41987` | Nothing |
| `proxy … closed` | Keeper/proxy not running | Open the app, press "Fix everything" |
| `keeper heartbeat: Xs ago` | Last keeper tick | Older than a few minutes → keeper is stuck or stopped |
| `rotation paused: yes` | `keeper.pause` file exists | openhop intentionally paused it; unpause in the app |
| `egress mode: warp` | Current routing mode | `tor`/`proxy` are alternatives configured in the app |
| `rotations today: N` | Hops the guard counted today | Quota used on new addresses |
| `probe: ok (ip=…, warp=on)` | Live check through the proxy | Confirms the exit IP actually works |

### Common prompts

| You want | Type |
| --- | --- |
| Check everything is alive | `openhop status` |
| Prove the exit IP works | `openhop status with probe` |
| Force a new address | `/openhop hop` |
| Diagnose a broken proxy | `/openhop doctor` |

## What it reads

| Path | Purpose |
| --- | --- |
| `%LOCALAPPDATA%\openhop` / `~/.local/share/opencode-unlimited` | State root (Linux falls back to `~/.local/share/openhop`) |
| `<state>/keeper/heartbeat.txt` | Keeper mtime → heartbeat age |
| `<state>/guard/heartbeat.txt` | Guard mtime → heartbeat age |
| `<state>/guard/state.json` | `day_hops`, last error, pause fields (safe subset printed) |
| `<state>/lane/egress_mode.json` | Active egress mode |
| `<state>/keeper.pause` | Rotation pause marker |
| `<state>/bin/openhop-hop.cmd`, `openhop-doctor.cmd` | Windows CLIs |
| `~/.local/bin/opencode-unlimited-hop`, `opencode-unlimited-doctor` | Linux CLIs |

Nothing outside these paths is read. No credentials, cookies or model config are touched.

## Architecture

```text
src/
├── index.ts     # extension factory: registers the openhop tool + /openhop
├── paths.ts     # platform, state dir, CLI discovery, proxy port
├── run.ts       # Bun.spawn wrapper, .cmd handling, port probe, JSON/heartbeat reads
├── hop.ts       # openhop-hop runner, output parser, single-flight guard
├── doctor.ts    # openhop-doctor runner, [OK]/[!]/[X] summarizer
└── status.ts    # state assembly, optional proxy trace probe, status formatting
selfcheck.ts     # bun run selfcheck — parsers + path detection, no install needed
```

Flow for `hop`:

```text
tool/command ──> runHop()
                   ├─ findCli()           → missing? friendly error
                   ├─ single-flight       → join in-flight hop
                   ├─ Bun.spawn(hop)      → 120 s timeout, kill on timeout
                   └─ parseHopOutput()    → old/new /64, FRESH marker
```

Flow for `status`:

```text
collectStatus(probe?)
  ├─ stateDir() + findCli()
  ├─ portOpen(41987)
  ├─ ageSeconds(keeper/guard heartbeats)
  ├─ readJson(guard/state.json, lane/egress_mode.json)
  ├─ existsSync(keeper.pause)
  └─ probe? fetch trace through the proxy (3 s timeout)
```

## Development

```bash
bun run selfcheck          # 12 assertions: hop parser, doctor parser, paths, status text
bun selfcheck.ts           # same, direct
```

Smoke-testing inside OMP:

```bash
omp --no-extensions -e ./src/index.ts -p "Reply with exactly: ok"
```

The self-check does not need openhop installed; it uses synthetic hop/doctor output copied from
`src/zen_hop.py` and `scripts/zen-hop.sh`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `openhop-hop not found` | openhop not installed or not on PATH | Install from [openhop.cfd](https://openhop.cfd), or add `<state>/bin` to PATH |
| `proxy … closed` | Keeper/proxy not running | Open the openhop app and press "Fix everything" |
| `Hop still running after 120s` | WARP rotation is slow | Check `openhop` status; don't start a second hop |
| `cloudflare handed back the same block` | Cloudflare reused the same `/64` | Run `hop` again |
| `doctor timed out` | `openhop-doctor` hung | Run it manually in a terminal and inspect |
| Extension not loaded | Not registered in OMP | Check `~/.omp/agent/config.yml` or `omp plugin link .` |

## Security notes

- The plugin never opens a listener and never accepts network input.
- `openhop-hop` / `openhop-doctor` are executed from fixed paths with the current environment; on
  Windows `.cmd` wrappers run through `cmd.exe` with a quoted path and no user-supplied arguments.
- The optional probe sends one request to `cloudflare.com` **through openhop's local proxy** to read
  the exit IP; it uses no credentials and is off unless `probe: true` is passed.
- Output is capped at 200 KB before it reaches the model.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with OpenCode or Cloudflare.
