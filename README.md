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
  - [From npm](#from-npm)
  - [Link a local checkout](#link-a-local-checkout)
  - [Load a single file](#load-a-single-file)
- [Usage](#usage)
  - [The `openhop` tool](#the-openhop-tool)
  - [`/hop`](#hop)
  - [`/doctor`](#doctor)
- [What it reads](#what-it-reads)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [License](#license)

## Features

- **`openhop` tool** — `status`, `hop`, `doctor` actions callable by the model.
- **`/hop`** — rotate openhop's WARP exit address (single-flight, 120 s cap).
- **`/doctor`** — run openhop's diagnostics and open the full report in the editor.
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

### From npm

```bash
omp plugin install omp-openhop
```

### Link a local checkout

```bash
git clone https://github.com/yayayapluto/OMP-openhop.git
cd OMP-openhop
omp plugin link .
```

### Load a single file

OMP can load one extension file directly:

```bash
omp --no-extensions -e ./src/index.ts -p "hello"
```

To load it in every session, register it in `~/.omp/agent/config.yml` under `extensions:` or copy it
to `~/.omp/agent/extensions/`.

## Usage

### The `openhop` tool

The model calls it like any other tool:

| Action | Purpose | Notes |
| --- | --- | --- |
| `status` | Print install path, proxy listen state, keeper/guard heartbeat age, pause flag, egress mode, rotations today | `probe: true` adds one trace request through the proxy |
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

### `/hop`

```
/hop
```

Runs the same single-flight hop as the tool and notifies you with the old → new block. If it takes
longer than 120 seconds the child process is killed and you're told to check status rather than start
a second hop.

### `/doctor`

```
/doctor
```

Runs `openhop-doctor`, opens the raw output in the editor, and falls back to a notification when no
editor is available.

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
├── index.ts     # extension factory: registers the openhop tool + /hop + /doctor
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
