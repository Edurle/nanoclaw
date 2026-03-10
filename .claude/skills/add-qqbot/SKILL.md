---
name: add-qqbot
description: Add QQ Bot as a channel. Connects via official QQ Bot API with WebSocket support for real-time messaging.
---

# Add QQ Bot Channel

This skill adds QQ Bot (QQ机器人) as a messaging channel to NanoClaw, allowing you to interact with users through QQ's official Bot API.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/qqbot/index.ts` exists. If it does, skip to Phase 3.

### Ask the user

AskUserQuestion: Do you have QQ Bot credentials (AppID and ClientSecret)?

Options:
- Yes, I have them - Proceed with installation
- No, help me get them - Guide user to QQ Bot platform

## Phase 2: Apply Code Changes

### Copy files from skill

Copy all files from the skill's `src/channels/qqbot/` directory to NanoClaw's `src/channels/qqbot/`:

```bash
# Create target directory
mkdir -p src/channels/qqbot/utils

# Copy main files
cp .claude/skills/add-qqbot/src/channels/qqbot/*.ts src/channels/qqbot/

# Copy utility files
cp .claude/skills/add-qqbot/src/channels/qqbot/utils/*.ts src/channels/qqbot/utils/
```

### Update barrel file

Add the qqbot channel import to `src/channels/index.ts`:

```typescript
// qqbot
import './qqbot/index.js';
```

### Add npm dependencies

Install the required npm packages:

```bash
npm install silk-wasm ws mpg123-decoder
```

### Install TypeScript types (if needed)

```bash
npm install -D @types/ws
```

### Validate build

```bash
npm run build
```

## Phase 3: Setup

### Create QQ Bot Application

Guide the user through the QQ Bot setup process:

1. **Open QQ Bot Platform**
   - Go to https://bot.q.qq.com
   - Log in with your QQ account

2. **Create a Bot Application**
   - Click "创建机器人" (Create Bot)
   - Fill in the bot information
   - Submit for review (if required)

3. **Get Credentials**
   - Navigate to your bot's settings
   - Copy the **AppID** (机器人AppID)
   - Copy the **ClientSecret** (机器人密钥)

### Configure environment

Add the following to your `.env` file:

```env
# QQ Bot Configuration
QQBOT_APP_ID=your_app_id_here
QQBOT_CLIENT_SECRET=your_client_secret_here

# Optional: Markdown support (default: true)
QQBOT_MARKDOWN_SUPPORT=true

# Optional: System prompt for the bot
QQBOT_SYSTEM_PROMPT=You are a helpful assistant responding via QQ.

# Optional: Image server URL for sending local images
# QQBOT_IMAGE_SERVER_BASE_URL=http://your-public-ip:18765
```

Sync the environment to the data directory:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

Build and restart NanoClaw:

```bash
# macOS
npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
npm run build && systemctl --user restart nanoclaw
```

## Phase 4: Registration

### Get OpenID

To register a chat, you need the user's or group's OpenID:

1. Send a message to your QQ bot
2. Check the logs for the openid:

```bash
tail -f logs/nanoclaw.log | grep -i qqbot
```

You should see something like:
```
[qqbot] C2C message from ABC123DEF456...
```

The `ABC123DEF456` is the user's openid.

### Register the chat

Use the IPC register flow with the JID format:

- **Private chat**: `qqbot:c2c:<openid>`
- **Group chat**: `qqbot:group:<group_openid>`
- **Channel**: `qqbot:channel:<channel_id>`

Example:
```bash
echo "register qqbot:c2c:ABC123DEF456 my-qq-chat" > /tmp/nanoclaw-ipc
```

## Phase 5: Verify

### Test the connection

1. Check that the bot is online in QQ
2. Send a message to the bot
3. Verify the response comes back through NanoClaw

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i qqbot
```

You should see:
- `[qqbot] Gateway connected and ready`
- `[qqbot] C2C message from ...`
- `[qqbot] Sending message to ...`

## Troubleshooting

### Bot not connecting

1. **Check credentials**: Verify `QQBOT_APP_ID` and `QQBOT_CLIENT_SECRET` are correct
2. **Check network**: Ensure the server can reach `api.sgroup.qq.com` and `bots.qq.com`
3. **Check intents**: Make sure your bot has the required permissions (私聊、群聊)

### Messages not sending

1. **Check reply limits**: QQ Bot has limits on passive replies (4 per message per hour)
2. **Check proactive quota**: Proactive messages have monthly limits (4 per user/group)
3. **Check markdown**: If markdown is enabled, ensure the bot has markdown permissions

### Audio not working

1. **Install ffmpeg**: Required for audio format conversion
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
   - Windows: Download from https://ffmpeg.org

2. **Check silk-wasm**: Ensure Node.js version is 16+

## JID Format Reference

| Type | Format | Example |
|------|--------|---------|
| Private chat | `qqbot:c2c:{openid}` | `qqbot:c2c:207A5B8339D01F6582911C014668B77B` |
| Group chat | `qqbot:group:{groupid}` | `qqbot:group:ABC123DEF456` |
| Channel | `qqbot:channel:{channelid}` | `qqbot:channel:12345678` |

## Features

- Real-time messaging via WebSocket
- Private chat (C2C)
- Group chat
- Channel (Guild) messages
- Markdown support
- Media support (images, voice, video, files)
- Typing indicators
- Auto-reconnection

## Limitations

- Passive reply limit: 4 replies per message within 1 hour
- Proactive message quota: 4 per user/group per month
- Voice messages require ffmpeg for format conversion
- Local image sending requires a public image server
