# How desktop Discord's RPC works

## Transport

The desktop Discord app listens on a local IPC socket. No network port is involved.

| OS | Path |
| --- | --- |
| macOS | `$TMPDIR/discord-ipc-0` (e.g. `/var/folders/.../T/discord-ipc-0`) |
| Linux | `$XDG_RUNTIME_DIR/discord-ipc-0` (falls back to `/tmp`) |
| Windows | named pipe `\\?\pipe\discord-ipc-0` |

If several Discord clients run (Stable, PTB, Canary) they take `-0`, `-1`, `-2`… Try 0 to 9.

Every message, in both directions, is one frame:

```
int32 LE  opcode     0 HANDSHAKE, 1 FRAME, 2 CLOSE, 3 PING, 4 PONG
int32 LE  length     byte length of the JSON payload
bytes     payload    UTF-8 JSON
```

Frames can arrive split or merged across socket reads, so buffer until `8 + length` bytes are available. Answer `PING` with `PONG` and the same payload.

## Connection flow

```
client                                        Discord
  │ HANDSHAKE {v:1, client_id}                   │
  │─────────────────────────────────────────────▶│
  │◀──────────── FRAME {cmd:DISPATCH, evt:READY, data:{user, config}}
  │ AUTHORIZE {client_id, scopes, redirect_uri}  │  ← shows "Authorize" prompt
  │─────────────────────────────────────────────▶│
  │◀──────────── {data:{code}}                   │
  │ POST https://discord.com/api/oauth2/token  (code + client secret + redirect_uri)
  │ AUTHENTICATE {access_token}                  │
  │─────────────────────────────────────────────▶│
  │◀──────────── {data:{scopes, user, application}}
  │ …commands and SUBSCRIBE…                     │
```

`READY` arrives before authentication ([example](../examples/ready.json)). Without `AUTHENTICATE` only rich presence (`SET_ACTIVITY`) works.

**Gotcha found in the spike:** `AUTHORIZE` must include `redirect_uri`, or Discord answers `5000: OAuth2 Error: invalid_request: Missing "redirect_uri"`. It must match a redirect registered on the app and the one sent in the token exchange.

The access token lasts about a week; the response also has a `refresh_token`. The examples simply re-authorize when the cached token is rejected.

## Requests and responses

```json
{ "cmd": "GET_CHANNELS", "args": { "guild_id": "..." }, "nonce": "uuid" }
```

The response echoes `cmd` and `nonce` with a `data` field. On failure `evt` is `"ERROR"` and `data` is `{ "code", "message" }`.

## Events

```json
{ "cmd": "SUBSCRIBE", "evt": "SPEAKING_START", "args": { "channel_id": "..." }, "nonce": "uuid" }
```

After that, Discord pushes `{ "cmd": "DISPATCH", "evt": "SPEAKING_START", "data": {...} }` with no nonce. Some events need a `channel_id` or `guild_id` in `args`. See [EVENTS.md](EVENTS.md).

## Scopes

| Scope | Unlocks |
| --- | --- |
| `rpc` | Basic commands: guilds, channels |
| `identify` | Your user object |
| `rpc.voice.read` | Voice settings, voice state, speaking events |
| `rpc.voice.write` | Join/leave voice, change voice settings |
| `rpc.notifications.read` | `NOTIFICATION_CREATE` |

All five were granted to the app owner in the spike.
