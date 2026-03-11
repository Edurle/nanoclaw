/**
 * QQ Bot 配置解析（NanoClaw 简化版）
 *
 * 与 OpenClaw 版本不同，这里只使用环境变量配置：
 * - QQBOT_APP_ID: 机器人 AppID
 * - QQBOT_CLIENT_SECRET: 机器人密钥
 * - QQBOT_MARKDOWN_SUPPORT: 是否支持 markdown（默认 true）
 */

import type { ResolvedQQBotAccount, QQBotAccountConfig } from "./types.js";
import { readEnvFile } from "../../env.js";

export const DEFAULT_ACCOUNT_ID = "default";

// Cache for env values
let cachedEnv: Record<string, string> | null = null;

function getEnv(key: string): string {
  if (!cachedEnv) {
    cachedEnv = readEnvFile([
      "QQBOT_APP_ID",
      "QQBOT_CLIENT_SECRET",
      "QQBOT_MARKDOWN_SUPPORT",
      "QQBOT_SYSTEM_PROMPT",
      "QQBOT_IMAGE_SERVER_BASE_URL",
    ]);
  }
  return cachedEnv[key] || process.env[key] || "";
}

/**
 * 解析 QQBot 账户配置（NanoClaw 简化版）
 * 从 .env 文件和 process.env 读取配置
 */
export function resolveQQBotAccount(): ResolvedQQBotAccount {
  const appId = getEnv("QQBOT_APP_ID");
  const clientSecret = getEnv("QQBOT_CLIENT_SECRET");
  const markdownSupport = getEnv("QQBOT_MARKDOWN_SUPPORT") !== "false";
  const systemPrompt = getEnv("QQBOT_SYSTEM_PROMPT") || undefined;
  const imageServerBaseUrl = getEnv("QQBOT_IMAGE_SERVER_BASE_URL") || undefined;

  let secretSource: "config" | "file" | "env" | "none" = "none";
  if (clientSecret) {
    secretSource = "env";
  }

  const accountConfig: QQBotAccountConfig = {
    enabled: true,
    markdownSupport,
    systemPrompt,
    imageServerBaseUrl,
  };

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled: !!appId && !!clientSecret,
    appId,
    clientSecret,
    secretSource,
    systemPrompt,
    imageServerBaseUrl,
    markdownSupport,
    config: accountConfig,
  };
}

/**
 * 检查 QQBot 是否已配置
 */
export function isQQBotConfigured(): boolean {
  const account = resolveQQBotAccount();
  return account.enabled && !!account.appId && !!account.clientSecret;
}
