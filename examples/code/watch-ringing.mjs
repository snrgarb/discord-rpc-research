// Detects incoming DM calls from people you list, and answers on Enter.
// RPC has no "incoming call" event and can't list your DMs, so this watches
// known DM channel IDs: when the caller appears in the call before you've
// joined, it's ringing.
//   node examples/code/watch-ringing.mjs <dm_channel_id> [more ids...]
import readline from 'node:readline';
import { connectRpc } from '../../lib/discord-rpc.mjs';

const dmChannels = process.argv.slice(2);
if (!dmChannels.length) throw new Error('Usage: watch-ringing.mjs <dm_channel_id>...');

const rpc = await connectRpc();
const me = rpc.ready.user.id;
let inCall = (await rpc.request('GET_SELECTED_VOICE_CHANNEL'))?.id ?? null;
let ringing = null;

await rpc.subscribe('VOICE_CHANNEL_SELECT', {}, (d) => { inCall = d.channel_id; ringing = null; });

for (const channelId of dmChannels) {
  await rpc.subscribe('VOICE_STATE_CREATE', { channel_id: channelId });
}
rpc.on('VOICE_STATE_CREATE', (d) => {
  if (d.user.id === me || inCall) return;
  // The event payload has no channel id, so with several watched DMs, look
  // up which one the caller is in.
  Promise.all(dmChannels.map((id) => rpc.request('GET_CHANNEL', { channel_id: id }))).then((chs) => {
    const ch = chs.find((c) => c.voice_states?.some((vs) => vs.user.id === d.user.id));
    if (!ch) return;
    ringing = ch.id;
    console.log(`📞 ${d.nick || d.user.username} is calling. Press Enter to answer.`);
  });
});

readline.createInterface({ input: process.stdin }).on('line', async () => {
  if (!ringing) return;
  await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: ringing, force: true });
  console.log('Answered');
});
console.log(`Watching ${dmChannels.length} DM channel(s) for calls…`);
