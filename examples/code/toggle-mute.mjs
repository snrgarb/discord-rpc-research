// Toggles your microphone mute. (SET_VOICE_SETTINGS was not exercised in the
// spike runs; GET_VOICE_SETTINGS and VOICE_SETTINGS_UPDATE were.)
import { connectRpc } from '../../lib/discord-rpc.mjs';

const rpc = await connectRpc();
const { mute } = await rpc.request('GET_VOICE_SETTINGS');
const next = await rpc.request('SET_VOICE_SETTINGS', { mute: !mute });
console.log(`Mute is now ${next.mute ? 'on' : 'off'}`);
rpc.close();
