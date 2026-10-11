// Lists every server, and the voice channels in one of them.
//   node examples/code/list-servers.mjs [server_id]
import { connectRpc } from '../../lib/discord-rpc.mjs';

const rpc = await connectRpc();
const { guilds } = await rpc.request('GET_GUILDS');
for (const g of guilds) console.log(`${g.id}  ${g.name}`);

const guildId = process.argv[2] ?? guilds[0]?.id;
if (guildId) {
  const { channels } = await rpc.request('GET_CHANNELS', { guild_id: guildId });
  console.log(`\nVoice channels in ${guildId}:`);
  for (const c of channels.filter((ch) => ch.type === 2)) console.log(`  ${c.id}  ${c.name}`);
}
rpc.close();
