# @bdliyq/opencode-rate-limit-retry

[![npm version](https://img.shields.io/npm/v/@bdliyq/opencode-rate-limit-retry)](https://www.npmjs.com/package/@bdliyq/opencode-rate-limit-retry)
[![license](https://img.shields.io/npm/l/@bdliyq/opencode-rate-limit-retry)](./LICENSE)

> **中文** | [English](./README_EN.md)

OpenCode 插件 —— 遭遇速率限制（Rate Limit）时，自动以**指数退避 + 抖动**策略重试**同一模型**，无需切换模型。

---

## 目录

- [为什么需要这个插件](#为什么需要这个插件)
- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [安装](#安装)
  - [方式一：npm 包安装（推荐）](#方式一npm-包安装推荐)
  - [方式二：本地文件安装](#方式二本地文件安装)
  - [从源码构建](#从源码构建)
- [配置](#配置)
  - [配置文件路径](#配置文件路径)
  - [配置项说明](#配置项说明)
  - [完整配置示例](#完整配置示例)
- [工作原理](#工作原理)
  - [流程概览](#流程概览)
  - [退避算法](#退避算法)
  - [重试时间线](#重试时间线)
  - [关键行为说明](#关键行为说明)
- [调试日志](#调试日志)
- [常见问题](#常见问题)
- [许可证](#许可证)
- [赞赏](#赞赏)

---

## 为什么需要这个插件

使用 OpenCode 时，模型 API 的速率限制（Rate Limit）是一个常见问题，尤其在以下场景：

- 你只能使用单一模型（例如 OpenCode Zen 免费额度），无法切换到备用模型
- 遇到 `"Request rate increased too quickly"` 等速率限制错误后，会话直接终止，需要手动重试
- OpenCode 内置的重试机制不可配置，无法满足你的需求

本插件在检测到速率限制错误后，**自动等待并使用同一模型重试**，配合指数退避策略避免持续触发限制，让你的工作流不被中断。

## 功能特性

- **同模型重试**：不切换模型，始终使用当前会话的同一模型重试
- **指数退避 + 抖动**：等待时间随重试次数指数增长，并加入随机抖动避免请求同步
- **智能错误识别**：通过可配置的字符串模式匹配多种速率限制错误
- **会话级防重复**：同一会话不会并发触发多个重试
- **状态自动重置**：超过 5 分钟未重试自动清零计数；重试成功后立即重置
- **TUI 通知**：速率限制触发时在 OpenCode TUI 中弹出提示
- **调试日志**：完整的事件追踪日志，便于排查问题
- **零配置开箱即用**：默认配置覆盖主流速率限制场景，无需额外配置文件

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| [OpenCode](https://opencode.ai) | 支持插件系统的版本 |
| Node.js | >= 18 |
| npm | >= 8 |
| `@opencode-ai/plugin` | ^1.0.0（peer dependency） |

## 安装

### 方式一：npm 包安装（推荐）

**1. 安装包**

```bash
npm install @bdliyq/opencode-rate-limit-retry@latest
```

**2. 注册插件**

编辑 OpenCode 配置文件 `~/.config/opencode/opencode.json`，在 `plugin` 数组中添加包名：

```json
{
  "plugin": [
    "@bdliyq/opencode-rate-limit-retry@latest"
  ]
}
```

**3. 重启 OpenCode**

保存配置后重启 OpenCode，插件即生效。

### 方式二：本地文件安装

适用于想直接修改插件源码或无法使用 npm 的场景。

**1. 创建插件目录并复制源码**

```bash
mkdir -p ~/.config/opencode/plugins
```

将本项目的 `src/index.ts` 复制到插件目录：

```bash
cp src/index.ts ~/.config/opencode/plugins/rate-limit-retry.ts
```

> 如果你是从 GitHub 克隆的项目：
> ```bash
> git clone https://github.com/bdliyq/opencode-rate-limit-retry.git
> cp opencode-rate-limit-retry/src/index.ts ~/.config/opencode/plugins/rate-limit-retry.ts
> ```

**2. 注册插件**

编辑 `~/.config/opencode/opencode.json`：

```json
{
  "plugin": [
    "./plugins/rate-limit-retry.ts"
  ]
}
```

**3. 重启 OpenCode**

保存配置后重启 OpenCode，插件即生效。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/bdliyq/opencode-rate-limit-retry.git
cd opencode-rate-limit-retry

# 安装依赖
npm install

# 构建（输出到 dist/ 目录）
npm run build

# 开发模式（监听文件变化自动编译）
npm run dev
```

## 配置

插件开箱即用，无需创建配置文件。如需自定义行为，可创建 JSON 配置文件。

### 配置文件路径

插件按以下顺序查找配置文件，**找到第一个即使用**：

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `~/.config/opencode/rate-limit-retry.json` | 全局配置，适用于所有项目 |
| 2 | `<项目目录>/.opencode/rate-limit-retry.json` | 项目级配置 |
| 3 | `<项目目录>/rate-limit-retry.json` | 项目根目录配置 |

> `<项目目录>` 为 OpenCode 启动时的工作目录（`process.cwd()`）。

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用插件。设为 `false` 完全禁用 |
| `maxRetries` | `number` | `5` | 单次速率限制事件的最大重试次数 |
| `baseDelayMs` | `number` | `5000` | 首次重试的基础等待时间（毫秒） |
| `maxDelayMs` | `number` | `120000` | 等待时间上限（2 分钟） |
| `jitterFactor` | `number` | `0.2` | 抖动系数。`0.2` 表示 ±20% 随机浮动 |
| `errorPatterns` | `string[]` | 见下方 | 匹配速率限制错误的字符串列表（不区分大小写） |

**默认 `errorPatterns`：**

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

这些模式会与错误对象的 `message`、`name`、`data.message`、`data.responseBody`、`data.statusCode` 等字段拼接后进行大小写不敏感的子串匹配。

### 完整配置示例

创建 `~/.config/opencode/rate-limit-retry.json`：

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

> 只需填写要覆盖的字段，其余使用默认值。例如只想增大重试次数：
> ```json
> { "maxRetries": 10 }
> ```

## 工作原理

### 流程概览

```
OpenCode 发送请求
       │
       ▼
  API 返回速率限制错误
       │
       ▼
  插件监听 session.error 事件
       │
       ▼
  错误文本匹配 errorPatterns？──── 否 ──→ 忽略
       │
      是
       ▼
  当前会话已在重试中？──── 是 ──→ 跳过（防重复）
       │
      否
       ▼
  重试次数达到上限？──── 是 ──→ 放弃，清理状态
       │
      否
       ▼
  计算退避延迟（指数退避 + 抖动）
       │
       ▼
  等待延迟时间 ...
       │
       ▼
  使用同一模型发送 promptAsync 重试
       │
       ├── 成功 → 重试计数归零
       └── 失败 → 记录日志，等待下次触发
```

### 退避算法

```
指数部分 = min(baseDelayMs × 2^attempt, maxDelayMs)
抖动量   = 指数部分 × jitterFactor × random(-1, 1)
最终延迟 = max(0, round(指数部分 + 抖动量))
```

### 重试时间线

以默认配置为例：

| 重试次数 | 指数退避 | 实际等待（含抖动）| 累计等待 |
|----------|---------|-------------------|---------|
| 第 1 次 | 5s | ~4s – 6s | ~5s |
| 第 2 次 | 10s | ~8s – 12s | ~15s |
| 第 3 次 | 20s | ~16s – 24s | ~35s |
| 第 4 次 | 40s | ~32s – 48s | ~75s |
| 第 5 次 | 80s | ~64s – 96s | ~155s（约 2.5 分钟） |

> 由于 `maxDelayMs=120000`（2 分钟），单次等待不会超过约 144 秒（120s + 20% 抖动）。

### 关键行为说明

- **模型追踪**：通过 `message.updated` 事件自动记录每个会话使用的模型，确保重试使用同一模型
- **去重保护**：同一会话同一时间只有一个重试流程运行
- **状态超时重置**：距离上次重试超过 5 分钟，计数自动归零
- **成功即重置**：重试成功后计数立即重置为 0
- **重试方式**：通过向当前会话发送新 prompt 实现，AI 将从中断处继续

## 调试日志

日志文件路径：

```
~/.config/opencode/rate-limit-retry-debug.log
```

日志标签含义：

| 标签 | 说明 |
|------|------|
| `[TRACK]` | 模型追踪记录 |
| `[EVENT]` | 收到 session.error 事件 |
| `[SKIP]` | 跳过处理（附原因） |
| `[MATCH]` | 匹配到速率限制错误 |
| `[STATE]` | 重试状态创建/重置 |
| `[RETRY]` | 重试执行详情 |

```bash
# 实时查看日志
tail -f ~/.config/opencode/rate-limit-retry-debug.log

# 只看重试相关
grep "\[RETRY\]" ~/.config/opencode/rate-limit-retry-debug.log

# 清空日志
: > ~/.config/opencode/rate-limit-retry-debug.log
```

## 常见问题

**Q: 插件安装后没有效果？**

1. 确认 `opencode.json` 中的 `plugin` 数组正确引用了插件
2. 确认配置文件中 `enabled` 没有设为 `false`
3. 查看调试日志确认插件是否收到了事件
4. 确认错误信息与 `errorPatterns` 中的模式匹配

**Q: 重试总是失败？**

速率限制有时间窗口，`baseDelayMs` 太小可能还没恢复就重试了。建议增大到 `10000` 并增加 `maxRetries`。

**Q: 能否切换到备用模型？**

本插件专注于"同模型重试"。如需模型切换，请使用其他插件。

**Q: 日志文件越来越大？**

日志不会自动轮转，定期清空即可：`: > ~/.config/opencode/rate-limit-retry-debug.log`

## 许可证

[MIT](./LICENSE) © 2026 leoli

## 赞赏

如果这个插件对你有帮助，欢迎赞赏支持！

<p align="center">
  <img src="./assets/sponsor.png" alt="赞赏码" width="400" />
</p>
