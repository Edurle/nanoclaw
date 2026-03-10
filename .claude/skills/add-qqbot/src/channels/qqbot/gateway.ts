/**
 * QQ Bot Gateway - NanoClaw 简化版
 *
 * 相比 OpenClaw 版本，移除了：
 * - STT 语音转文字（可在 NanoClaw 容器内通过 MCP 工具实现）
 * - 图床服务器（如果不需要发送本地图片）
 * - 复杂的消息队列系统
 * - OpenClaw pluginRuntime 依赖
 *
 * 保留：
 * - WebSocket 连接和重连逻辑
 * - 消息解析和分发
 * - Token 管理
 */

import WebSocket from "ws";
import type { ResolvedQQBotAccount, WSPayload, C2CMessageEvent, GuildMessageEvent, GroupMessageEvent } from "./types.js";
import {
  getAccessToken,
  getGatewayUrl,
  initApiConfig,
  startBackgroundTokenRefresh,
  stopBackgroundTokenRefresh,
} from "./api.js";
import type { NewMessage, OnChatMetadata } from "../../../../types.js";

// QQ Bot intents
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

// 权限级别
const INTENT_LEVELS = [
  {
    name: "full",
    intents: INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C,
    description: "群聊+私信+频道",
  },
  {
    name: "group+channel",
    intents: INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.GROUP_AND_C2C,
    description: "群聊+频道",
  },
  {
    name: "channel-only",
    intents: INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.GUILD_MEMBERS,
    description: "仅频道消息",
  },
];

// 重连配置
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];
const MAX_RECONNECT_ATTEMPTS = 100;

/**
 * NanoClaw Gateway 上下文
 */
export interface GatewayContext {
  account: ResolvedQQBotAccount;
  abortSignal: AbortSignal;
  onMessage: (chatJid: string, msg: NewMessage) => void;
  onChatMetadata?: OnChatMetadata;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 解析 QQ 表情标签
 */
function parseFaceTags(text: string): string {
  if (!text) return text;
  return text.replace(/<faceType=\d+,faceId="[^"]*",ext="([^"]*)">/g, (_match, ext: string) => {
    try {
      const decoded = Buffer.from(ext, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      return `【表情: ${parsed.text || "未知表情"}】`;
    } catch {
      return _match;
    }
  });
}

/**
 * 启动 Gateway WebSocket 连接（NanoClaw 简化版）
 */
export async function startGateway(ctx: GatewayContext): Promise<void> {
  const { account, abortSignal, onMessage, onChatMetadata, onReady, onError } = ctx;

  if (!account.appId || !account.clientSecret) {
    throw new Error("QQBot not configured (missing appId or clientSecret)");
  }

  // 初始化 API 配置
  initApiConfig({
    markdownSupport: account.markdownSupport,
  });
  console.log(`[qqbot] API config: markdownSupport=${account.markdownSupport}`);

  // 启动后台 Token 刷新
  startBackgroundTokenRefresh(account.appId, account.clientSecret, {
    log: {
      info: (msg) => console.log(`[qqbot] ${msg}`),
      error: (msg) => console.error(`[qqbot] ${msg}`),
    },
  });

  let reconnectAttempts = 0;
  let isAborted = false;
  let currentWs: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let sessionId: string | null = null;
  let lastSeq: number | null = null;
  let isConnecting = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentLevelIndex = 0;

  abortSignal.addEventListener("abort", () => {
    isAborted = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    cleanup();
    stopBackgroundTokenRefresh(account.appId);
  });

  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
      currentWs.close();
    }
    currentWs = null;
  };

  const getReconnectDelay = () => {
    const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
    return RECONNECT_DELAYS[idx];
  };

  const scheduleReconnect = (customDelay?: number) => {
    if (isAborted || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[qqbot] Max reconnect attempts reached or aborted`);
      onError?.(new Error("Max reconnect attempts reached"));
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const delay = customDelay ?? getReconnectDelay();
    reconnectAttempts++;
    console.log(`[qqbot] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isAborted) {
        connect();
      }
    }, delay);
  };

  const connect = async () => {
    if (isConnecting) {
      console.log(`[qqbot] Already connecting, skip`);
      return;
    }
    isConnecting = true;

    try {
      cleanup();

      const accessToken = await getAccessToken(account.appId, account.clientSecret);
      console.log(`[qqbot] Access token obtained`);
      const gatewayUrl = await getGatewayUrl(accessToken);

      console.log(`[qqbot] Connecting to ${gatewayUrl}`);

      const ws = new WebSocket(gatewayUrl);
      currentWs = ws;

      ws.on("open", () => {
        console.log(`[qqbot] WebSocket connected`);
        reconnectAttempts = 0;
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString()) as WSPayload;
          handlePayload(payload);
        } catch (err) {
          console.error(`[qqbot] Failed to parse message:`, err);
        }
      });

      ws.on("close", (code: number, reason: Buffer) => {
        console.log(`[qqbot] WebSocket closed: code=${code}, reason=${reason.toString()}`);
        cleanup();
        if (!isAborted) {
          scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        console.error(`[qqbot] WebSocket error:`, err.message);
        onError?.(err);
      });

    } catch (err) {
      console.error(`[qqbot] Connection error:`, err);
      isConnecting = false;
      if (!isAborted) {
        scheduleReconnect();
      }
      return;
    }

    isConnecting = false;
  };

  const handlePayload = async (payload: WSPayload) => {
    // 保存序列号
    if (payload.s !== undefined) {
      lastSeq = payload.s;
    }

    switch (payload.op) {
      case 10: // Hello - 发送 Identify
        await sendIdentify();
        break;

      case 11: // Heartbeat ACK
        // 心跳响应，无需处理
        break;

      case 0: // Dispatch - 事件
        if (payload.t === "READY") {
          const d = payload.d as { session_id?: string };
          sessionId = d.session_id ?? null;
          console.log(`[qqbot] Gateway ready, session_id=${sessionId}`);
          onReady?.();

          // 启动心跳
          const d10 = payload.d as { heartbeat_interval?: number };
          const heartbeatIntervalMs = d10.heartbeat_interval ?? 41250;
          startHeartbeat(heartbeatIntervalMs);
        } else if (payload.t === "RESUMED") {
          console.log(`[qqbot] Session resumed`);
        } else {
          // 处理消息事件
          handleMessageEvent(payload);
        }
        break;

      case 7: // Reconnect
        console.log(`[qqbot] Server requested reconnect`);
        cleanup();
        scheduleReconnect();
        break;

      case 9: // Invalid Session
        console.log(`[qqbot] Invalid session, will reconnect`);
        sessionId = null;
        cleanup();
        scheduleReconnect();
        break;

      default:
        console.log(`[qqbot] Unknown opcode: ${payload.op}`);
    }
  };

  const sendIdentify = async () => {
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;

    const accessToken = await getAccessToken(account.appId, account.clientSecret);
    const intents = INTENT_LEVELS[intentLevelIndex]?.intents ?? INTENT_LEVELS[0].intents;

    const identify = {
      op: 2,
      d: {
        token: `QQBot ${accessToken}`,
        intents,
        shard: [0, 1],
        properties: {
          $os: process.platform,
          $browser: "nanoclaw-qqbot",
          $device: "nanoclaw",
        },
      },
    };

    console.log(`[qqbot] Sending identify with intents level: ${INTENT_LEVELS[intentLevelIndex]?.name}`);
    currentWs.send(JSON.stringify(identify));
  };

  const startHeartbeat = (intervalMs: number) => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    heartbeatInterval = setInterval(async () => {
      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        const heartbeat = { op: 1, d: lastSeq };
        currentWs.send(JSON.stringify(heartbeat));
      }
    }, intervalMs);
  };

  const handleMessageEvent = (payload: WSPayload) => {
    const t = payload.t;
    const d = payload.d;

    if (!d) return;

    try {
      if (t === "C2C_MESSAGE_CREATE") {
        handleC2CMessage(d as C2CMessageEvent);
      } else if (t === "GROUP_AT_MESSAGE_CREATE") {
        handleGroupMessage(d as GroupMessageEvent);
      } else if (t === "AT_MESSAGES_CREATE") {
        handleGuildMessage(d as GuildMessageEvent);
      }
    } catch (err) {
      console.error(`[qqbot] Error handling message event:`, err);
    }
  };

  const handleC2CMessage = (event: C2CMessageEvent) => {
    const content = parseFaceTags(event.content || "");
    const chatJid = `qqbot:c2c:${event.author.user_openid}`;

    const msg: NewMessage = {
      id: event.id,
      chat_jid: chatJid,
      sender: event.author.user_openid,
      sender_name: event.author.user_openid,
      content,
      timestamp: event.timestamp,
      is_from_me: false,
    };

    console.log(`[qqbot] C2C message from ${event.author.user_openid}: ${content.slice(0, 50)}...`);
    onMessage(chatJid, msg);

    // 通知元数据
    onChatMetadata?.(chatJid, event.timestamp, undefined, "qqbot", false);
  };

  const handleGroupMessage = (event: GroupMessageEvent) => {
    const content = parseFaceTags(event.content || "");
    const chatJid = `qqbot:group:${event.group_openid}`;

    const msg: NewMessage = {
      id: event.id,
      chat_jid: chatJid,
      sender: event.author.member_openid,
      sender_name: event.author.member_openid,
      content,
      timestamp: event.timestamp,
      is_from_me: false,
    };

    console.log(`[qqbot] Group message from ${event.author.member_openid} in ${event.group_openid}: ${content.slice(0, 50)}...`);
    onMessage(chatJid, msg);

    // 通知元数据
    onChatMetadata?.(chatJid, event.timestamp, event.group_openid, "qqbot", true);
  };

  const handleGuildMessage = (event: GuildMessageEvent) => {
    const content = parseFaceTags(event.content || "");
    const chatJid = `qqbot:channel:${event.channel_id}`;

    const senderName = event.member?.nick || event.author.username || event.author.id;

    const msg: NewMessage = {
      id: event.id,
      chat_jid: chatJid,
      sender: event.author.id,
      sender_name: senderName,
      content,
      timestamp: event.timestamp,
      is_from_me: false,
    };

    console.log(`[qqbot] Guild message from ${senderName} in channel ${event.channel_id}: ${content.slice(0, 50)}...`);
    onMessage(chatJid, msg);

    // 通知元数据
    onChatMetadata?.(chatJid, event.timestamp, event.channel_id, "qqbot", true);
  };

  // 开始连接
  await connect();
}
