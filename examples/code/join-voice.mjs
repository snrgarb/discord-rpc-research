// Joins a server voice channel or a DM call by channel ID.
// Joining an empty DM call does NOT ring the other person.
//   node examples/code/join-voice.mjs <channel_id>
import { connectRpc } from '../../lib/discord-rpc.mjs';

const channelId = process.argv[2];
if (!channelId) throw new Error('Usage: join-voice.mjs <channel_id>');

const rpc = await connectRpc();
// force: true switches over even if you're already in another call.
const channel = await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: channelId, timeout: 10, force: true });
console.log(`Joined ${channel.name || 'DM call'} (${channel.guild_id ? 'server' : 'DM'})`);
rpc.close();
