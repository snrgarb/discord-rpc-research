// Live view of the call you're in: who's there, who's talking, mute state.
// Follows you between calls. This is the core of an overlay's call panel.
import { connectRpc } from '../../lib/discord-rpc.mjs';

const rpc = await connectRpc();
const people = new Map(); // user id -> { name, speaking, muted }
let current = null;

const render = () => {
  console.clear();
  if (!current) return console.log('Not in a call');
  console.log(`In call ${current}\n`);
  for (const p of people.values()) {
    console.log(`${p.speaking ? '🔊' : '  '} ${p.name}${p.muted ? ' (muted)' : ''}`);
  }
};

const upsert = (d) => {
  const vs = d.voice_state;
  people.set(d.user.id, {
    name: d.nick || d.user.global_name || d.user.username,
    speaking: people.get(d.user.id)?.speaking ?? false,
    muted: vs.mute || vs.self_mute,
  });
  render();
};
rpc.on('VOICE_STATE_CREATE', upsert);
rpc.on('VOICE_STATE_UPDATE', upsert);
rpc.on('VOICE_STATE_DELETE', (d) => { people.delete(d.user.id); render(); });
rpc.on('SPEAKING_START', (d) => { const p = people.get(d.user_id); if (p) { p.speaking = true; render(); } });
rpc.on('SPEAKING_STOP', (d) => { const p = people.get(d.user_id); if (p) { p.speaking = false; render(); } });

const channelEvents = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];

async function follow(channelId) {
  if (current) for (const evt of channelEvents) await rpc.unsubscribe(evt, { channel_id: current }).catch(() => {});
  people.clear();
  current = channelId;
  if (channelId) {
    const channel = await rpc.request('GET_CHANNEL', { channel_id: channelId });
    for (const vs of channel.voice_states ?? []) upsert(vs);
    for (const evt of channelEvents) await rpc.subscribe(evt, { channel_id: channelId });
  }
  render();
}

await rpc.subscribe('VOICE_CHANNEL_SELECT', {}, (d) => follow(d.channel_id));
const selected = await rpc.request('GET_SELECTED_VOICE_CHANNEL');
await follow(selected?.id ?? null);
