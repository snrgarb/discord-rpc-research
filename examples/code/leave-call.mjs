// Leaves whatever call you're in.
import { connectRpc } from '../../lib/discord-rpc.mjs';

const rpc = await connectRpc();
await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: null, force: true });
console.log('Left the call');
rpc.close();
