import type { Plugin } from "@opencode-ai/plugin";

interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  errorPatterns: string[];
}

const DEFAULT_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 5,
  baseDelayMs: 5000,
  maxDelayMs: 120000,
  jitterFactor: 0.2,
  errorPatterns: [
    "rate increased too quickly",
    "scale requests more smoothly",
    "ensure system stability",
    "rate limit",
    "rate_limit",
    "too many requests",
    "quota exceeded",
    "usage exceeded",
  ],
};

function loadConfig(fs: typeof import("fs"), path: typeof import("path")): RetryConfig {
  const configPaths = [
    path.join(process.env.HOME || "~", ".config", "opencode", "rate-limit-retry.json"),
    path.join(process.cwd(), ".opencode", "rate-limit-retry.json"),
    path.join(process.cwd(), "rate-limit-retry.json"),
  ];
  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, "utf-8")) };
      }
    } catch {
    }
  }
  return DEFAULT_CONFIG;
}

function isRateLimitError(error: unknown, patterns: string[]): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { message?: string; name?: string; data?: { message?: string; responseBody?: string; statusCode?: number } };
  const allText = [
    String(err.data?.responseBody || ""),
    String(err.data?.message || err.message || ""),
    String(err.name || ""),
    String(err.data?.statusCode || ""),
  ].join(" ").toLowerCase();
  return patterns.some((p) => allText.includes(p.toLowerCase()));
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterFactor: number): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = exponential * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function isSessionErrorEvent(event: { type: string; properties?: unknown }): event is { type: "session.error"; properties: { sessionID: string; error: unknown } } {
  return event.type === "session.error" && typeof event.properties === "object" && event.properties !== null && "sessionID" in event.properties && "error" in event.properties;
}

function isMessageUpdatedEvent(event: { type: string; properties?: unknown }): event is { type: "message.updated"; properties: { info?: { sessionID?: string; error?: unknown; role?: string; id?: string; providerID?: string; modelID?: string } } } {
  return event.type === "message.updated" && typeof event.properties === "object" && event.properties !== null && "info" in event.properties;
}

export const RateLimitRetry: Plugin = async ({ client }) => {
  const fs = await import("fs");
  const path = await import("path");
  const config = loadConfig(fs.default, path.default);

  if (!config.enabled) return {};

  const debugLogPath = path.join(process.env.HOME || "~", ".config", "opencode", "rate-limit-retry-debug.log");

  function writeDebugLog(content: string) {
    try {
      fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${content}\n`);
    } catch {
      // Ignore log write errors
    }
  }

  const retryState = new Map<string, { attempts: number; lastAttemptTime: number; currentModel: { providerID: string; modelID: string } | null }>();
  const retryingSessions = new Set<string>();
  const sessionModels = new Map<string, { providerID: string; modelID: string }>();

  return {
    event: async ({ event }) => {
      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        if (info?.providerID && info?.modelID && info?.sessionID && info.role === "assistant") {
          sessionModels.set(info.sessionID, { providerID: info.providerID, modelID: info.modelID });
          writeDebugLog(`[TRACK] sessionModels.set: ${info.sessionID} => ${info.providerID}/${info.modelID}`);
        }
      }

      if (isSessionErrorEvent(event)) {
        const { sessionID, error } = event.properties;
        writeDebugLog(`[EVENT] session.error received for session: ${sessionID}`);

        if (!isRateLimitError(error, config.errorPatterns)) {
          writeDebugLog(`[SKIP] Not a rate limit error`);
          return;
        }
        writeDebugLog(`[MATCH] Rate limit error pattern matched`);

        const err = error as Record<string, unknown>;
        const data = (err.data ?? {}) as Record<string, unknown>;
        const debugInfo = {
          sessionID,
          timestamp: new Date().toISOString(),
          error_message: err.message,
          error_name: err.name,
          status_code: data.statusCode,
          data_message: data.message,
          response_body: data.responseBody,
          headers: data.headers,
          error_keys: Object.keys(err),
          data_keys: Object.keys(data),
          full_error: JSON.stringify(error, null, 2),
        };

        const logContent = `=== RATE LIMIT ERROR ===\n${JSON.stringify(debugInfo, null, 2)}\n=== END ===`;
        writeDebugLog(logContent);

        const toastMsg = `Rate limit! statusCode=${data.statusCode || "unknown"}. See ~/.config/opencode/rate-limit-retry-debug.log`;
        try {
          await client.tui?.toast({
            title: "Rate Limit Detected",
            message: toastMsg,
            variant: "error",
            duration: 10000,
          });
        } catch {
          // Ignore toast errors
        }

        if (retryingSessions.has(sessionID)) {
          writeDebugLog(`[SKIP] Already retrying session ${sessionID}`);
          return;
        }

        let state = retryState.get(sessionID);
        if (!state || Date.now() - state.lastAttemptTime > 300000) {
          state = { attempts: 0, lastAttemptTime: Date.now(), currentModel: sessionModels.get(sessionID) || null };
          retryState.set(sessionID, state);
          writeDebugLog(`[STATE] New retry state created for ${sessionID}, model=${state.currentModel ? `${state.currentModel.providerID}/${state.currentModel.modelID}` : "null"}`);
        }

        if (state.attempts >= config.maxRetries) {
          writeDebugLog(`[SKIP] Max retries exceeded for ${sessionID} (${state.attempts}/${config.maxRetries})`);
          retryState.delete(sessionID);
          return;
        }

        const model = state.currentModel || sessionModels.get(sessionID);
        if (!model) {
          writeDebugLog(`[SKIP] No model found for session ${sessionID}`);
          return;
        }
        writeDebugLog(`[RETRY] Attempting retry ${state.attempts + 1}/${config.maxRetries} with model ${model.providerID}/${model.modelID}`);

        state.attempts++;
        state.lastAttemptTime = Date.now();
        retryingSessions.add(sessionID);

        const delay = calculateDelay(state.attempts - 1, config.baseDelayMs, config.maxDelayMs, config.jitterFactor);

        try {
          await client.session.abort({ path: { id: sessionID } });
          writeDebugLog(`[ABORT] Session aborted successfully`);
        } catch (e) {
          writeDebugLog(`[ABORT] Failed: ${JSON.stringify(e)}`);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));

        try {
          const messagesResult = await client.session.messages({ path: { id: sessionID } });
          if (!messagesResult.data) {
            writeDebugLog(`[RETRY] No messages data for session ${sessionID}`);
            retryingSessions.delete(sessionID);
            return;
          }

          const lastUserMessage = [...messagesResult.data].reverse().find((m) => m.info?.role === "user");
          if (!lastUserMessage) {
            writeDebugLog(`[RETRY] No user message found for session ${sessionID}`);
            retryingSessions.delete(sessionID);
            return;
          }

          const parts = lastUserMessage.parts || [];
          if (parts.length === 0) {
            writeDebugLog(`[RETRY] No parts in user message for session ${sessionID}`);
            retryingSessions.delete(sessionID);
            return;
          }

          writeDebugLog(`[RETRY] Found ${parts.length} parts, sending retry notice and re-prompt`);

          const retryNotice: any = {
            type: "text",
            text: `⚠️ Rate Limit Retry — Attempt ${state.attempts}/${config.maxRetries} (waiting ${Math.round(delay / 1000)}s before retry)`,
            synthetic: true,
          };

          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              parts: [retryNotice, ...parts.map((p: any) => {
                if (p.type === "text") return { type: "text" as const, text: p.content ?? p.text ?? "" };
                return p;
              })],
              model: { providerID: model.providerID, modelID: model.modelID },
            },
          });
          writeDebugLog(`[RETRY] promptAsync completed successfully`);
        } catch (e) {
          writeDebugLog(`[RETRY] promptAsync failed: ${JSON.stringify(e)}`);
        } finally {
          retryingSessions.delete(sessionID);
          writeDebugLog(`[RETRY] Cleaned up retryingSessions for ${sessionID}`);
        }
      }
    },
  };
};

export default RateLimitRetry;
