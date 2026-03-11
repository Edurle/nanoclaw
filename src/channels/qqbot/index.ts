/**
 * QQ Bot Channel - NanoClaw 适配器
 *
 * 将 QQ Bot 适配到 NanoClaw 的 Channel 接口
 */

import type { Channel, OnInboundMessage, OnChatMetadata, NewMessage } from "../../types.js";
import { registerChannel, type ChannelOpts } from "../registry.js";
import { startGateway, type GatewayContext } from "./gateway.js";
import { sendText, type OutboundResult } from "./outbound.js";
import { resolveQQBotAccount, isQQBotConfigured } from "./config.js";
import type { ResolvedQQBotAccount } from "./types.js";
import { initApiConfig, getAccessToken, sendC2CInputNotify } from "./api.js";

export class QQBotChannel implements Channel {
  readonly name = "qqbot";
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private connected = false;
  private account: ResolvedQQBotAccount;
  private abortController: AbortController;

  constructor(opts: ChannelOpts) {
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.account = resolveQQBotAccount();
    this.abortController = new AbortController();

    // 初始化 API 配置
    if (this.account.appId && this.account.clientSecret) {
      initApiConfig({ markdownSupport: this.account.markdownSupport });
    }
  }

  async connect(): Promise<void> {
    if (!this.account.appId || !this.account.clientSecret) {
      console.log("[qqbot] Credentials not configured, skipping connection");
      return;
    }

    console.log(`[qqbot] Connecting with appId=${this.account.appId.slice(0, 8)}...`);

    const ctx: GatewayContext = {
      account: this.account,
      abortSignal: this.abortController.signal,
      onMessage: (chatJid: string, msg: NewMessage) => {
        this.onMessage(chatJid, msg);
      },
      onChatMetadata: this.onChatMetadata,
      onReady: () => {
        this.connected = true;
        console.log("[qqbot] Gateway connected and ready");
      },
      onError: (error: Error) => {
        console.error("[qqbot] Gateway error:", error.message);
        this.connected = false;
      },
    };

    await startGateway(ctx);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.account.appId || !this.account.clientSecret) {
      throw new Error("QQBot not configured (missing appId or clientSecret)");
    }

    console.log(`[qqbot] Sending message to ${jid}: ${text.slice(0, 50)}...`);

    const result: OutboundResult = await sendText({
      to: jid,
      text,
      account: this.account,
      replyToId: null,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    console.log(`[qqbot] Message sent, id=${result.messageId}`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    // 支持 qqbot: 前缀
    if (jid.startsWith("qqbot:")) return true;
    // 支持 c2c:, group:, channel: 前缀
    if (/^(c2c|group|channel):/i.test(jid)) return true;
    // 32位十六进制（QQ openid）
    if (/^[0-9a-fA-F]{32}$/.test(jid)) return true;
    return false;
  }

  async disconnect(): Promise<void> {
    console.log("[qqbot] Disconnecting...");
    this.abortController.abort();
    this.connected = false;
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // 只有 C2C 私聊支持输入提示
    if (isTyping && jid.includes("c2c")) {
      try {
        const token = await getAccessToken(this.account.appId, this.account.clientSecret);
        // 提取 openid
        const openid = jid.replace(/^qqbot:c2c:/, "").replace(/^c2c:/, "");
        await sendC2CInputNotify(token, openid);
        console.log(`[qqbot] Sent typing indicator to ${openid}`);
      } catch (err) {
        // 非关键功能，失败不影响主流程
        console.warn(`[qqbot] Failed to send typing indicator:`, err);
      }
    }
  }
}

// 自注册 Channel
registerChannel("qqbot", (opts: ChannelOpts): Channel | null => {
  if (!isQQBotConfigured()) {
    console.log("[qqbot] Credentials not configured, skipping channel registration");
    return null;
  }
  return new QQBotChannel(opts);
});
