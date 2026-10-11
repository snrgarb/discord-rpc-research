#!/usr/bin/env node
// Discord RPC spike: connects to the desktop Discord app's local IPC socket,
// authorizes with your own developer app, runs the read-only RPC commands an
// overlay would need, listens for live events, and writes a report.
//
// No dependencies. Needs Node 18+ and the desktop Discord app running.
//
//   DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... node probe.mjs
//
// Options:
//   --listen <seconds>   how long to record live events (default 120)
//   --guilds <n>         fetch channels for the first n servers (default 3)
//   --join <channel_id>  also try joining this voice channel (SELECT_VOICE_CHANNEL)
//   --watch-dm <channel_id>  watch a DM channel for ringing calls and messages
//   --redirect <uri>     OAuth redirect registered on your app (default http://127.0.0.1)
//   --out <file>         report path (default ./discord-rpc-report.json)

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const LISTEN_SECONDS = Number(args.listen ?? 120);
const GUILD_LIMIT = Number(args.guilds ?? 3);
const REDIRECT_URI = args.redirect ?? 'http://127.0.0.1';
const OUT = path.resolve(args.out ?? 'discord-rpc-report.json');
const TOKEN_CACHE = path.join(os.homedir(), '.discord-rpc-spike-token.json');

const FULL_SCOPES = ['rpc', 'identify', 'rpc.voice.read', 'rpc.voice.write', 'rpc.notifications.read'];
const BASE_SCOPES = ['rpc', 'identify', 'rpc.voice.read', 'rpc.voice.write'];

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

const report = {
  startedAt: new Date().toISOString(),
  platform: `${process.platform} ${os.release()}`,
  node: process.version,
  socket: null,
  ready: null,
  scopesGranted: null,
  commands: {},
  subscriptions: {},
  events: [],
  errors: [],
};

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET (see the README next to this script).');
  process.exit(1);
}

main().catch((err) => {
  report.errors.push({ stage: 'fatal', message: err.message });
  console.error(`\nFailed: ${err.message}`);
  writeReport();
  process.exit(1);
});

async function main() {
  const rpc = await connect();
  console.log(`Connected to ${report.socket}`);

  const ready = await rpc.handshake();
  report.ready = { config: ready.data?.config, user: ready.data?.user, v: ready.data?.v };
  console.log(`Discord says hi to ${ready.data?.user?.username ?? 'unknown user'}`);

  await authenticate(rpc);

  // Read-only commands.
  const guilds = await run(rpc, 'GET_GUILDS', {});
  for (const g of (guilds?.guilds ?? []).slice(0, GUILD_LIMIT)) {
    await run(rpc, 'GET_GUILD', { guild_id: g.id, timeout: 5 }, `GET_GUILD ${g.name}`);
    await run(rpc, 'GET_CHANNELS', { guild_id: g.id }, `GET_CHANNELS ${g.name}`);
  }
  const selected = await run(rpc, 'GET_SELECTED_VOICE_CHANNEL', {});
  await run(rpc, 'GET_VOICE_SETTINGS', {});

  if (args.join) {
    await run(rpc, 'SELECT_VOICE_CHANNEL', { channel_id: args.join, timeout: 10, force: true }, 'SELECT_VOICE_CHANNEL (join)');
  }

  // Live events. Per-channel ones (who's in the call, who's speaking) need a
  // channel, so follow whichever call you're in, including ones joined later.
  const followed = new Set();
  const followCall = async (channelId) => {
    if (!channelId || followed.has(channelId)) return;
    followed.add(channelId);
    await run(rpc, 'GET_CHANNEL', { channel_id: channelId }, `GET_CHANNEL ${channelId} @${new Date().toISOString()}`);
    for (const evt of ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP']) {
      await subscribe(rpc, evt, { channel_id: channelId });
    }
  };

  rpc.onEvent = (msg) => {
    report.events.push({ at: new Date().toISOString(), evt: msg.evt, data: msg.data });
    console.log(`  event ${msg.evt}`);
    if (msg.evt === 'VOICE_CHANNEL_SELECT') followCall(msg.data?.channel_id);
  };

  await subscribe(rpc, 'VOICE_CHANNEL_SELECT');
  await subscribe(rpc, 'VOICE_CONNECTION_STATUS');
  await subscribe(rpc, 'VOICE_SETTINGS_UPDATE');
  await subscribe(rpc, 'NOTIFICATION_CREATE');
  await followCall(selected?.id || args.join);

  // A ringing DM call has no event of its own. Watching a DM channel shows
  // whether the caller joining it (VOICE_STATE_CREATE) or the "started a
  // call" message (MESSAGE_CREATE) arrives while it's still ringing.
  if (args['watch-dm']) {
    await followCall(args['watch-dm']);
    await subscribe(rpc, 'MESSAGE_CREATE', { channel_id: args['watch-dm'] });
  }

  console.log(`\nRecording events for ${LISTEN_SECONDS}s. Try: join a call with someone, mute/unmute,`);
  console.log('let them talk, have someone ring you before you answer, get a DM.');
  console.log('Ctrl+C stops early and still saves.\n');
  await waitOrInterrupt(LISTEN_SECONDS * 1000);

  rpc.close();
  writeReport();
}

// --- auth -------------------------------------------------------------------

async function authenticate(rpc) {
  const cached = readCache();
  if (cached?.access_token) {
    const res = await rpc.send('AUTHENTICATE', { access_token: cached.access_token }).catch((e) => e);
    if (!(res instanceof Error)) {
      report.scopesGranted = res.scopes;
      console.log('Authenticated with cached token');
      return;
    }
    console.log('Cached token rejected, authorizing again');
  }

  console.log('Asking Discord for permission. Approve the prompt in the Discord app.');
  // Discord now wants the redirect here too, and it must match the one
  // registered on the app and the one sent in the token exchange.
  const authorize = (scopes) => rpc.send('AUTHORIZE', {
    client_id: CLIENT_ID, scopes, redirect_uri: REDIRECT_URI,
  });
  let code;
  try {
    ({ code } = await authorize(FULL_SCOPES));
  } catch (err) {
    report.errors.push({ stage: 'AUTHORIZE full scopes', message: err.message });
    if (!/scope/i.test(err.message)) throw err;
    console.log(`Full scopes refused (${err.message}); retrying without notifications`);
    ({ code } = await authorize(BASE_SCOPES));
  }

  const token = await exchangeCode(code);
  writeCache(token);
  const res = await rpc.send('AUTHENTICATE', { access_token: token.access_token });
  report.scopesGranted = res.scopes;
  console.log(`Authenticated (scopes: ${res.scopes?.join(', ')})`);
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', body });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')); } catch { return null; }
}

function writeCache(token) {
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify(token), { mode: 0o600 });
}

// --- commands ---------------------------------------------------------------

async function run(rpc, cmd, cmdArgs, label = cmd) {
  try {
    const data = await rpc.send(cmd, cmdArgs);
    report.commands[label] = { ok: true, data };
    console.log(`  ok   ${label}`);
    return data;
  } catch (err) {
    report.commands[label] = { ok: false, error: err.message };
    console.log(`  fail ${label}: ${err.message}`);
    return null;
  }
}

async function subscribe(rpc, evt, subArgs = {}) {
  const key = subArgs.channel_id ? `${evt} ${subArgs.channel_id}` : evt;
  try {
    await rpc.send('SUBSCRIBE', subArgs, evt);
    report.subscriptions[key] = { ok: true };
    console.log(`  sub  ${key}`);
  } catch (err) {
    report.subscriptions[key] = { ok: false, error: err.message };
    console.log(`  fail SUBSCRIBE ${key}: ${err.message}`);
  }
}

// --- IPC transport ----------------------------------------------------------
// Each frame is: int32 LE opcode, int32 LE length, JSON payload.

function socketPaths() {
  const base = process.platform === 'win32'
    ? '\\\\?\\pipe\\'
    : (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp');
  return Array.from({ length: 10 }, (_, i) => (process.platform === 'win32'
    ? `${base}discord-ipc-${i}`
    : path.join(base, `discord-ipc-${i}`)));
}

async function connect() {
  for (const p of socketPaths()) {
    const sock = await new Promise((resolve) => {
      const s = net.createConnection(p, () => resolve(s));
      s.once('error', () => resolve(null));
    });
    if (sock) {
      report.socket = p;
      return new Rpc(sock);
    }
  }
  throw new Error('No discord-ipc socket found. Is the desktop Discord app running?');
}

class Rpc {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.readyWaiter = null;
    this.onEvent = null;
    sock.on('data', (chunk) => this.#onData(chunk));
    sock.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Socket closed'));
      this.pending.clear();
    });
  }

  handshake() {
    return new Promise((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.#write(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID });
    });
  }

  send(cmd, cmdArgs, evt) {
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error('Timed out waiting for Discord'));
      }, cmd === 'AUTHORIZE' ? 120_000 : 15_000);
      this.pending.set(nonce, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.#write(OP.FRAME, { cmd, args: cmdArgs, evt, nonce });
    });
  }

  close() {
    this.sock.end();
  }

  #write(op, payload) {
    const json = Buffer.from(JSON.stringify(payload));
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    this.sock.write(Buffer.concat([header, json]));
  }

  #onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      const msg = JSON.parse(this.buf.subarray(8, 8 + len).toString());
      this.buf = this.buf.subarray(8 + len);
      this.#onMessage(op, msg);
    }
  }

  #onMessage(op, msg) {
    if (op === OP.PING) return this.#write(OP.PONG, msg);
    if (op === OP.CLOSE) {
      const err = new Error(`Discord closed the connection: ${msg.message ?? JSON.stringify(msg)}`);
      this.readyWaiter?.reject(err);
      report.errors.push({ stage: 'close', message: err.message });
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.readyWaiter?.resolve(msg);
      this.readyWaiter = null;
      return;
    }
    const waiter = msg.nonce && this.pending.get(msg.nonce);
    if (waiter) {
      this.pending.delete(msg.nonce);
      if (msg.evt === 'ERROR') waiter.reject(new Error(`${msg.data?.code}: ${msg.data?.message}`));
      else waiter.resolve(msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH') this.onEvent?.(msg);
  }
}

// --- misc -------------------------------------------------------------------

function waitOrInterrupt(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    process.once('SIGINT', () => { clearTimeout(t); resolve(); });
  });
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  const text = JSON.stringify(report, (key, value) => (
    /token|secret/i.test(key) ? '[redacted]' : value
  ), 2);
  fs.writeFileSync(OUT, text);
  console.log(`\nReport saved to ${OUT}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return out;
}
