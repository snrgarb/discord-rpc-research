# Events

Every event in Discord's documented RPC list. ✅ fired in the spike · ❌ subscribed but failed or never fired · ⚪ not tested

## Voice and calls

| Event | Subscribe args | Status | Payload |
| --- | --- | --- | --- |
| `VOICE_CHANNEL_SELECT` | none | ✅ | [join](../examples/events/VOICE_CHANNEL_SELECT-join.json), [leave](../examples/events/VOICE_CHANNEL_SELECT-leave.json) |
| `VOICE_CONNECTION_STATUS` | none | ✅ | [sequence](../examples/events/VOICE_CONNECTION_STATUS-sequence.json) |
| `VOICE_STATE_CREATE` | `channel_id` | ✅ | [incoming ring](../examples/events/VOICE_STATE_CREATE-incoming-ring.json) |
| `VOICE_STATE_UPDATE` | `channel_id` | ✅ | [example](../examples/events/VOICE_STATE_UPDATE.json) |
| `VOICE_STATE_DELETE` | `channel_id` | ✅ | [example](../examples/events/VOICE_STATE_DELETE.json) |
| `SPEAKING_START` | `channel_id` | ✅ | [example](../examples/events/SPEAKING_START.json) |
| `SPEAKING_STOP` | `channel_id` | ✅ | [example](../examples/events/SPEAKING_STOP.json) |
| `VOICE_SETTINGS_UPDATE` | none | ✅ | [example](../examples/events/VOICE_SETTINGS_UPDATE.json) |

- `VOICE_CHANNEL_SELECT` fires for server and DM calls. `guild_id` is `null` for DMs, and `channel_id` is `null` when you leave.
- `VOICE_CONNECTION_STATUS` walks `AWAITING_ENDPOINT → CONNECTING → AUTHENTICATING → VOICE_CONNECTING → VOICE_CONNECTED`, then repeats `VOICE_CONNECTED` about every 5 s with fresh pings. `DISCONNECTED` on leave.
- `VOICE_STATE_*` payloads carry the person's `nick`, `user` (id, username, global name, avatar hash), server/self mute and deafen, and your local volume for them. They do **not** include the channel ID.
- `SPEAKING_*` carry only `channel_id` and `user_id`. Match them to `VOICE_STATE_*` data for names.
- `VOICE_SETTINGS_UPDATE` fires once right after subscribing, with the current state.

Avatar URL: `https://cdn.discordapp.com/avatars/<user.id>/<user.avatar>.png`

## Detecting an incoming DM call

There is no "ringing" event. In the spike, subscribing to `VOICE_STATE_CREATE` on a DM channel caught the caller joining the call **8 seconds before** it was answered ([timeline](../examples/events/ringing-timeline.json)):

```
23:28:53.848  VOICE_STATE_CREATE    friend   ← ringing starts here
23:29:01.283  VOICE_CHANNEL_SELECT  dm       ← you answered (SELECT_VOICE_CHANNEL)
23:29:01.667  VOICE_STATE_CREATE    me
```

Rule: someone other than you appears in a watched DM channel while you aren't in a call → it's ringing. Answer with `SELECT_VOICE_CHANNEL`. See [watch-ringing.mjs](../examples/code/watch-ringing.mjs).

Limit: RPC can't list your DMs, so you can only watch DM channel IDs you already know (a favorites list, or ones remembered from past `VOICE_CHANNEL_SELECT` events).

## Notifications and messages

| Event | Subscribe args | Status | Notes |
| --- | --- | --- | --- |
| `NOTIFICATION_CREATE` | none | ❌ | Subscribed OK; nothing fired for incoming DMs across several runs |
| `MESSAGE_CREATE` | `channel_id` | ❌ | `4005 Invalid channel id` on a DM channel; server text channels untested |
| `MESSAGE_UPDATE` | `channel_id` | ⚪ | Same restriction expected |
| `MESSAGE_DELETE` | `channel_id` | ⚪ | Same restriction expected |

## Servers and channels

| Event | Subscribe args | Status | Notes |
| --- | --- | --- | --- |
| `GUILD_STATUS` | `guild_id` | ⚪ | Server name or icon changed |
| `GUILD_CREATE` | none | ⚪ | You joined a server |
| `CHANNEL_CREATE` | none | ⚪ | Channel created in one of your servers |

## Game activity

Only useful for games using Rich Presence.

| Event | Status |
| --- | --- |
| `ACTIVITY_JOIN` | ⚪ |
| `ACTIVITY_SPECTATE` | ⚪ |
| `ACTIVITY_JOIN_REQUEST` | ⚪ |

## Connection

| Event | Notes |
| --- | --- |
| `READY` | Sent after the handshake, before auth ([example](../examples/ready.json)) |
| `ERROR` | `evt` on a failed command's response |
