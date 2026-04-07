# @bdliyq/opencode-rate-limit-retry

[![npm version](https://img.shields.io/npm/v/@bdliyq/opencode-rate-limit-retry)](https://www.npmjs.com/package/@bdliyq/opencode-rate-limit-retry)
[![license](https://img.shields.io/npm/l/@bdliyq/opencode-rate-limit-retry)](./LICENSE)

> [中文](./README.md) | **English**

An OpenCode plugin that automatically retries the **same model** with **exponential backoff + jitter** when rate limited, instead of switching models.

---

## Table of Contents

- [Why This Plugin](#why-this-plugin)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Option 1: npm Package (Recommended)](#option-1-npm-package-recommended)
  - [Option 2: Local Plugin File](#option-2-local-plugin-file)
  - [Build from Source](#build-from-source)
- [Configuration](#configuration)
  - [Config File Paths](#config-file-paths)
  - [Config Options](#config-options)
  - [Full Config Example](#full-config-example)
- [How It Works](#how-it-works)
  - [Flow Overview](#flow-overview)
  - [Backoff Algorithm](#backoff-algorithm)
  - [Retry Timeline](#retry-timeline)
  - [Key Behaviors](#key-behaviors)
- [Debug Logging](#debug-logging)
- [FAQ](#faq)
- [License](#license)
- [Sponsor](#sponsor)

---

## Why This Plugin

Rate limiting is a common issue when using OpenCode model APIs, especially when:

- You only have access to a single model (e.g., OpenCode Zen free tier) and cannot fall back to alternatives
- Rate limit errors like `"Request rate increased too quickly"` terminate your session, requiring manual retry
- OpenCode's built-in retry mechanism is not configurable for your needs

This plugin **automatically waits and retries with the same model** upon detecting rate limit errors, using exponential backoff to avoid continuously hitting the limit.

## Features

- **Same-model retry**: Always retries with the current session's model instead of switching
- **Exponential backoff + jitter**: Wait time grows exponentially with random jitter to prevent synchronized retries
- **Smart error detection**: Configurable string pattern matching against multiple error fields
- **Session-level deduplication**: Prevents concurrent retries for the same session
- **Auto state reset**: Retry count resets after 5 minutes of inactivity or upon success
- **TUI notifications**: Shows toast notifications in OpenCode TUI when rate limits are detected
- **Debug logging**: Comprehensive event tracing for troubleshooting
- **Zero-config**: Works out of the box with sensible defaults

## Requirements

| Dependency | Version |
|-----------|---------|
| [OpenCode](https://opencode.ai) | Plugin-capable version |
| Node.js | >= 18 |
| npm | >= 8 |
| `@opencode-ai/plugin` | ^1.0.0 (peer dependency) |

## Installation

### Option 1: npm Package (Recommended)

**1. Install the package**

```bash
npm install @bdliyq/opencode-rate-limit-retry@latest
```

**2. Register the plugin**

Edit `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "@bdliyq/opencode-rate-limit-retry@latest"
  ]
}
```

**3. Restart OpenCode**

Save the config and restart OpenCode. The plugin will take effect immediately.

### Option 2: Local Plugin File

For those who want to modify the source or cannot use npm.

**1. Create plugins directory and copy source**

```bash
mkdir -p ~/.config/opencode/plugins
```

Copy `src/index.ts` to the plugins directory:

```bash
cp src/index.ts ~/.config/opencode/plugins/rate-limit-retry.ts
```

> Or clone from GitHub:
> ```bash
> git clone https://github.com/bdliyq/opencode-rate-limit-retry.git
> cp opencode-rate-limit-retry/src/index.ts ~/.config/opencode/plugins/rate-limit-retry.ts
> ```

**2. Register the plugin**

Edit `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "./plugins/rate-limit-retry.ts"
  ]
}
```

**3. Restart OpenCode**

Save the config and restart OpenCode. The plugin will take effect immediately.

### Build from Source

```bash
# Clone the repository
git clone https://github.com/bdliyq/opencode-rate-limit-retry.git
cd opencode-rate-limit-retry

# Install dependencies
npm install

# Build (output to dist/)
npm run build

# Watch mode (auto-compile on file changes)
npm run dev
```

## Configuration

The plugin works out of the box with no config file needed. Create a JSON config file to customize behavior.

### Config File Paths

The plugin searches for config files in the following order (first match wins):

| Priority | Path | Scope |
|----------|------|-------|
| 1 (highest) | `~/.config/opencode/rate-limit-retry.json` | Global (all projects) |
| 2 | `<project>/.opencode/rate-limit-retry.json` | Project-level |
| 3 | `<project>/rate-limit-retry.json` | Project root |

> `<project>` is the working directory where OpenCode is launched (`process.cwd()`).

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin. Set to `false` to fully disable |
| `maxRetries` | `number` | `5` | Maximum retry attempts per rate limit event |
| `baseDelayMs` | `number` | `5000` | Base delay for the first retry (milliseconds) |
| `maxDelayMs` | `number` | `120000` | Maximum delay cap (2 minutes) |
| `jitterFactor` | `number` | `0.2` | Jitter factor. `0.2` means ±20% random variation |
| `errorPatterns` | `string[]` | See below | Case-insensitive substring patterns for rate limit detection |

**Default `errorPatterns`:**

```json
[
  "rate increased too quickly",
  "scale requests more smoothly",
  "ensure system stability",
  "rate limit",
  "rate_limit",
  "too many requests",
  "quota exceeded",
  "usage exceeded"
]
```

These patterns are matched (case-insensitive) against the concatenation of the error's `message`, `name`, `data.message`, `data.responseBody`, and `data.statusCode` fields.

### Full Config Example

Create `~/.config/opencode/rate-limit-retry.json`:

```json
{
  "enabled": true,
  "maxRetries": 5,
  "baseDelayMs": 5000,
  "maxDelayMs": 120000,
  "jitterFactor": 0.2,
  "errorPatterns": [
    "rate increased too quickly",
    "scale requests more smoothly",
    "ensure system stability",
    "rate limit",
    "rate_limit",
    "too many requests",
    "quota exceeded",
    "usage exceeded"
  ]
}
```

> Only include fields you want to override; the rest use defaults. For example, to just increase retries:
> ```json
> { "maxRetries": 10 }
> ```

## How It Works

### Flow Overview

```
OpenCode sends request
       │
       ▼
  API returns rate limit error
       │
       ▼
  Plugin listens for session.error event
       │
       ▼
  Error matches errorPatterns? ──── No ──→ Ignore
       │
      Yes
       ▼
  Session already retrying? ──── Yes ──→ Skip (dedup)
       │
      No
       ▼
  Max retries reached? ──── Yes ──→ Give up, clean state
       │
      No
       ▼
  Calculate backoff delay (exponential + jitter)
       │
       ▼
  Wait for delay ...
       │
       ▼
  Retry with same model via promptAsync
       │
       ├── Success → Reset retry count to 0
       └── Failure → Log error, wait for next trigger
```

### Backoff Algorithm

```
exponential = min(baseDelayMs × 2^attempt, maxDelayMs)
jitter      = exponential × jitterFactor × random(-1, 1)
finalDelay  = max(0, round(exponential + jitter))
```

### Retry Timeline

With default config (`baseDelayMs=5000`, `maxDelayMs=120000`, `jitterFactor=0.2`):

| Attempt | Exponential | Actual Wait (with jitter) | Cumulative |
|---------|-------------|---------------------------|------------|
| 1st | 5s | ~4s – 6s | ~5s |
| 2nd | 10s | ~8s – 12s | ~15s |
| 3rd | 20s | ~16s – 24s | ~35s |
| 4th | 40s | ~32s – 48s | ~75s |
| 5th | 80s | ~64s – 96s | ~155s (~2.5 min) |

> Since `maxDelayMs=120000` (2 minutes), a single wait will never exceed ~144 seconds (120s + 20% jitter).

### Key Behaviors

- **Model tracking**: Automatically records each session's model via `message.updated` events, ensuring retries use the same model
- **Deduplication**: Only one retry flow runs per session at any time
- **Timeout reset**: Retry count resets after 5 minutes of inactivity
- **Success reset**: Count resets to 0 immediately upon successful retry
- **Retry mechanism**: Sends a new prompt to the current session with a retry notice; the AI continues from where it left off

## Debug Logging

Log file path:

```
~/.config/opencode/rate-limit-retry-debug.log
```

Log tags:

| Tag | Description |
|-----|-------------|
| `[TRACK]` | Model tracking records |
| `[EVENT]` | session.error event received |
| `[SKIP]` | Skipped processing (with reason) |
| `[MATCH]` | Rate limit error pattern matched |
| `[STATE]` | Retry state created/reset |
| `[RETRY]` | Retry execution details |

```bash
# Live monitoring
tail -f ~/.config/opencode/rate-limit-retry-debug.log

# Filter retry events only
grep "\[RETRY\]" ~/.config/opencode/rate-limit-retry-debug.log

# Clear log file
: > ~/.config/opencode/rate-limit-retry-debug.log
```

## FAQ

**Q: Plugin doesn't seem to work after installation?**

1. Verify the `plugin` array in `opencode.json` correctly references the plugin
2. Ensure `enabled` is not set to `false` in the config file
3. Check the debug log for incoming events
4. Confirm error messages match the `errorPatterns`

**Q: Retries keep failing?**

Rate limits have time windows. If `baseDelayMs` is too small, the window may not have reset before retry. Try increasing to `10000` and raising `maxRetries`.

**Q: Can it switch to a fallback model?**

This plugin focuses on same-model retry. For model switching, use a different plugin.

**Q: Log file keeps growing?**

Logs are append-only with no automatic rotation. Clear manually: `: > ~/.config/opencode/rate-limit-retry-debug.log`

## License

[MIT](./LICENSE) © 2026 leoli

## Sponsor

If you find this plugin helpful, feel free to support the author!

<p align="center">
  <img src="./assets/sponsor.png" alt="Sponsor QR Code" width="400" />
</p>
