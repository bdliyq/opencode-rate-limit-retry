# @bdliyq/opencode-rate-limit-retry

OpenCode plugin that retries the **same model** with exponential backoff when rate limited. Unlike model-switching fallback plugins, this keeps using your configured model and waits before retrying.

## When to Use

- You only have access to a single model (e.g., OpenCode Zen free tier)
- You encounter rate limit errors like `"Request rate increased too quickly"` and want automatic retry instead of session termination
- You want configurable backoff rather than relying on OpenCode's built-in (non-configurable) retry

## Installation

### Option 1: Local Plugin File

Copy `src/index.ts` to your OpenCode plugins directory:

```bash
mkdir -p ~/.config/opencode/plugins
cp src/index.ts ~/.config/opencode/plugins/rate-limit-retry.ts
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "./plugins/rate-limit-retry.ts"
  ]
}
```

### Option 2: npm Package

```bash
npm install @bdliyq/opencode-rate-limit-retry
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "@bdliyq/opencode-rate-limit-retry"
  ]
}
```

## Configuration

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

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin |
| `maxRetries` | `number` | `5` | Maximum retry attempts before giving up |
| `baseDelayMs` | `number` | `5000` | Initial delay in milliseconds |
| `maxDelayMs` | `number` | `120000` | Maximum delay cap (2 minutes) |
| `jitterFactor` | `number` | `0.2` | Random jitter factor (0.2 = ±20%) |
| `errorPatterns` | `string[]` | See above | Error strings to detect as rate limits |

### Config File Locations

The plugin searches for config in this order (highest priority first):

1. `~/.config/opencode/rate-limit-retry.json`
2. `<project>/.opencode/rate-limit-retry.json`
3. `<project>/rate-limit-retry.json`

## How It Works

```
Request → Rate Limit Error Detected → Abort Session
                                        ↓
                              Exponential Backoff
                              (5s → 10s → 20s → ...)
                                        ↓
                              Retry Same Model
                                        ↓
                              Success / Max Retries
```

### Retry Timeline

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1st | ~5s | ~5s |
| 2nd | ~10s | ~15s |
| 3rd | ~20s | ~35s |
| 4th | ~40s | ~75s |
| 5th | ~80s | ~155s (~2.6 min) |

## Build

```bash
npm install
npm run build
```

## License

MIT
