# Discord RPC spike

Can a full-screen HTPC overlay drive Discord through the **desktop Discord app's local RPC**, without a bot, a self-bot, or scraping the Discord UI?

**Short answer: yes for voice and calls, no for messages.** Results come from real runs against Discord on macOS (October 2026). See [docs/FINDINGS.md](docs/FINDINGS.md).

| Works | Doesn't work |
| --- | --- |
| List all servers (names, IDs, icons) | Place a DM call that rings someone |
| List a server's channels, pick out voice channels | DM message notifications |
| Join a server voice channel or a DM call | Read messages in DMs |
| Who's in the call, with avatars and mute state | List your DMs |
| Live "who's speaking" per person | Decline a call |
| Mute, deafen, input/output devices | |
| Detect an incoming DM call (from DMs you already know) | |

## What's here

| Path | What it is |
| --- | --- |
| [`probe.mjs`](probe.mjs) | The spike: authorizes, runs every read command, records live events, writes a JSON report |
| [`lib/discord-rpc.mjs`](lib/discord-rpc.mjs) | Small reusable client (IPC framing, OAuth, request/subscribe) |
| [`examples/code/`](examples/code) | Runnable examples: list servers, join/leave voice, toggle mute, live call monitor, incoming-call watcher |
| [`examples/*.json`](examples) | Real command responses, anonymized |
| [`examples/events/`](examples/events) | Real event payloads, anonymized |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | How the IPC socket, handshake and auth work |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Every command we used, with args and example responses |
| [`docs/EVENTS.md`](docs/EVENTS.md) | Every documented event, marked tested / failed / untested |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Results, gaps and recommendations for an overlay |

No dependencies. Needs Node 18+ and the desktop Discord app running and logged in.

## One-time setup

1. Go to <https://discord.com/developers/applications> and click **New Application**. Any name works.
2. Open **OAuth2**:
   - Copy the **Client ID**.
   - Click **Reset Secret** and copy the **Client Secret**. It's shown once.
   - Under **Redirects**, add `http://127.0.0.1` exactly (no trailing slash) and save.
3. Open **App Testers** and add your own Discord account. Accept the invite if one arrives.

This is an *application*, not a bot. You never touch the Bot tab, and no code here sees your Discord password or login token. You approve access once in the Discord app, and can revoke it under Discord Settings → Authorized Apps.

RPC is officially a closed beta. It works for the app's owner and testers, which is all a personal overlay needs.

## Run the spike

```sh
export DISCORD_CLIENT_ID=your_id
export DISCORD_CLIENT_SECRET=your_secret   # never commit this
node probe.mjs
```

The first run shows an **Authorize** prompt in Discord. The token is cached in `~/.discord-rpc-spike-token.json` (mode 600), so later runs skip it.

While it records (120 s by default), join a call, mute and unmute, have someone talk, have someone ring you. Ctrl+C stops early and still saves `discord-rpc-report.json`. Tokens and secrets are redacted from the report.

| Option | Effect |
| --- | --- |
| `--listen <s>` | Record for longer or shorter |
| `--guilds <n>` | Fetch channels for the first *n* servers (default 3) |
| `--join <channel_id>` | Also join this voice channel or DM call |
| `--watch-dm <channel_id>` | Watch a DM channel for ringing calls |
| `--redirect <uri>` | Use a different registered redirect |
| `--out <file>` | Report path |

To get IDs, turn on **Developer Mode** in Discord (Settings → Advanced), then right-click a channel or DM and choose **Copy Channel ID**.

## Run the examples

```sh
node examples/code/list-servers.mjs              # all servers + voice channels in the first
node examples/code/join-voice.mjs <channel_id>   # join a voice channel or DM call
node examples/code/leave-call.mjs
node examples/code/toggle-mute.mjs
node examples/code/call-monitor.mjs              # live participants + speaking
node examples/code/watch-ringing.mjs <dm_channel_id> ...   # Enter to answer
```
