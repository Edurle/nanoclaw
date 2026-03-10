/**
 * QQ Bot 配置解析（NanoClaw 简化版）
 *
 * 与 OpenClaw 版本不同，这里只使用环境变量配置：
 * - QQBOT_APP_ID: 机器人 AppID
 * - QQBOT_CLIENT_SECRET: 机器人密钥
 * - QQBOT_MARKDOWN_SUPPORT: 是否支持 markdown（默认 true）
 */

import type { ResolvedQQBotAccount, QQBotAccountConfig } from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

/**
 * 解析 QQBot 账户配置（NanoClaw 简化版）
 * 只从环境变量读取配置
 */
export function resolveQQBotAccount(): ResolvedQQBotAccount {
  const appId = process.env.QQBOT_APP_ID || "";
  const clientSecret = process.env.QQBOT_CLIENT_SECRET || "";
  const markdownSupport = process.env.QQBOT_MARKDOWN_SUPPORT !== "false";
  const systemPrompt = process.env.QQBOT_SYSTEM_PROMPT;
  const imageServerBaseUrl = process.env.QQBOT_IMAGE_SERVER_BASE_URL;

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
