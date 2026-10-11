# Findings

Runs: macOS 26 (Darwin 25.6), Node 22, desktop Discord Stable, 11 October 2026. App owner as the authorized user; all five scopes granted.

## What an overlay can do

- **Server browser.** `GET_GUILDS` returned all 53 servers with icon URLs in one call. `GET_CHANNELS` per server gives the voice channels.
- **Join voice.** `SELECT_VOICE_CHANNEL` joined a server channel and a DM call instantly, no prompt.
- **Call panel.** `GET_CHANNEL` + `VOICE_STATE_*` give participants with names, avatars and mute state. `SPEAKING_START/STOP` give a live talking indicator per person, with sub-second latency.
- **Audio controls.** Mute, deafen and device lists via voice settings.
- **Incoming calls from known DMs.** Watch DM channels for the caller joining (see [EVENTS.md](EVENTS.md#detecting-an-incoming-dm-call)); answer by joining.
- **Connection quality.** Ping every ~5 s from `VOICE_CONNECTION_STATUS`.

## What it can't do

- **Start a DM call that rings someone.** Joining an empty DM call puts you in a silent call; the other person's Discord did not ring. Workaround (untested): open the DM in the desktop app with a `discord://` link and press Call there.
- **DM notifications.** `NOTIFICATION_CREATE` never fired.
- **Messages.** `MESSAGE_CREATE` refused on DM channels.
- **List DMs or friends.** No command for it, which is why ring detection needs known channel IDs.
- **Decline a call.** No command; ignoring it is the only option.
- **Member lists.** `GET_GUILD` returns `members: []`.

## Recommendation

Use RPC for everything voice: server and channel picker, joining, the in-call panel, mute/deafen, and incoming calls from a favorites list of DMs. It is the supported route, needs no Discord UI scraping, and carries no account risk beyond a normal OAuth app.

Keep a separate path for text (reading and sending messages, DM notifications): either the desktop app itself, or a wrapper such as Discord Pad that drives the web UI.

A small always-on bridge process (hold the RPC connection, expose a local WebSocket for the overlay) is the natural next step. `lib/discord-rpc.mjs` and `examples/code/call-monitor.mjs` are most of it already.

## Risks

- RPC is officially a closed beta; Discord could change or restrict it. That risks the feature, not your account.
- The desktop Discord app must be running and logged in on the same machine.
- Access tokens expire (about a week); handle re-auth or use the refresh token.
