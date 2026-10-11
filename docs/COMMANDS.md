# Commands

✅ worked in the spike · ⚪ not exercised (from Discord's docs)

| Command | Args | Status | Example response |
| --- | --- | --- | --- |
| `AUTHORIZE` | `client_id`, `scopes`, `redirect_uri` | ✅ | `{ "code": "..." }` |
| `AUTHENTICATE` | `access_token` | ✅ | `{ scopes, user, application, expires }` |
| `GET_GUILDS` | none | ✅ | [GET_GUILDS.json](../examples/GET_GUILDS.json) |
| `GET_GUILD` | `guild_id`, `timeout` | ✅ | [GET_GUILD.json](../examples/GET_GUILD.json) |
| `GET_CHANNELS` | `guild_id` | ✅ | [GET_CHANNELS.json](../examples/GET_CHANNELS.json) |
| `GET_CHANNEL` | `channel_id` | ✅ | [GET_CHANNEL-dm.json](../examples/GET_CHANNEL-dm.json) |
| `GET_SELECTED_VOICE_CHANNEL` | none | ✅ | [GET_SELECTED_VOICE_CHANNEL.json](../examples/GET_SELECTED_VOICE_CHANNEL.json) |
| `SELECT_VOICE_CHANNEL` | `channel_id` (or `null` to leave), `timeout`, `force` | ✅ | [server](../examples/SELECT_VOICE_CHANNEL-server.json), [DM](../examples/SELECT_VOICE_CHANNEL-dm.json) |
| `GET_VOICE_SETTINGS` | none | ✅ | [GET_VOICE_SETTINGS.json](../examples/GET_VOICE_SETTINGS.json) |
| `SET_VOICE_SETTINGS` | any of `mute`, `deaf`, `input`, `output`, `mode`… | ⚪ | Same shape as `GET_VOICE_SETTINGS` |
| `SUBSCRIBE` / `UNSUBSCRIBE` | event args, `evt` on the frame | ✅ | `{ "evt": "..." }` |
| `SELECT_TEXT_CHANNEL` | `channel_id` | ⚪ | Focuses a text channel in the app |
| `SET_USER_VOICE_SETTINGS` | `user_id`, `volume`, `mute`, `pan` | ⚪ | Per-person volume / local mute |
| `SET_ACTIVITY` | `pid`, `activity` | ⚪ | Rich presence; works without auth |

## Notes from the real responses

**Channel types** in `GET_CHANNELS`: `0` text, `2` voice, `4` category, `5` announcement. A voice menu filters on `type === 2`. DM channels report `type: 1` and an empty `name`.

**`GET_GUILD` `members` is always empty.** RPC does not give member lists.

**`GET_CHANNEL` on a voice channel** returns `voice_states`, the people currently in it. That's how to load a call's participants before subscribing to changes. `messages` was always empty in the spike.

**`SELECT_VOICE_CHANNEL`:**
- Joins immediately with no prompt. Connection took about one second.
- `force: true` is needed if you're already in another call, or Discord refuses.
- On a DM channel, it joins the DM call. **Joining an empty DM call does not ring the other person.** It answers an incoming ring fine.
- `channel_id: null` leaves the current call.

**`GET_VOICE_SETTINGS`** includes the device lists, so an overlay can offer an input/output picker.

## Errors seen

| Code | Message | Cause |
| --- | --- | --- |
| 5000 | `OAuth2 Error: invalid_request: Missing "redirect_uri"` | `AUTHORIZE` sent without `redirect_uri` |
| 4005 | `Invalid channel id` | `SUBSCRIBE MESSAGE_CREATE` on a DM channel ([example](../examples/subscribe-errors.json)) |
