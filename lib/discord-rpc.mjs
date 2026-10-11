// Minimal client for the desktop Discord app's local RPC (IPC socket).
// No dependencies; Node 18+.
//
//   const rpc = await connectRpc();          // reads DISCORD_CLIENT_ID / _SECRET
//   const { guilds } = await rpc.request('GET_GUILDS');
//   await rpc.subscribe('SPEAKING_START', { channel_id }, (data) => ...);

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

export const DEFAULT_SCOPES = ['rpc', 'identify', 'rpc.voice.read', 'rpc.voice.write', 'rpc.notifications.read'];

export async function connectRpc({
  clientId = process.env.DISCORD_CLIENT_ID,
  clientSecret = process.env.DISCORD_CLIENT_SECRET,
  redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1',
  scopes = DEFAULT_SCOPES,
  tokenCache = path.join(os.homedir(), '.discord-rpc-spike-token.json'),
} = {}) {
  if (!clientId || !clientSecret) throw new Error('Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET');
  const transport = await openSocket();
  const client = new RpcClient(transport, clientId);
  client.ready = await client.handshake();
  await authenticate(client, { clientId, clientSecret, redirectUri, scopes, tokenCache });
  return client;
}

async function authenticate(client, { clientId, clientSecret, redirectUri, scopes, tokenCache }) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(tokenCache, 'utf8')); } catch { /* first run */ }
  if (cached?.access_token) {
    try {
      client.auth = await client.request('AUTHENTICATE', { access_token: cached.access_token });
      return;
    } catch { /* expired or revoked: authorize again */ }
  }

  // Shows the "Authorize" prompt inside the Discord app. redirect_uri must be
  // registered on the app and must match the one sent in the token exchange.
  const { code } = await client.request('AUTHORIZE', { client_id: clientId, scopes, redirect_uri: redirectUri });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(token)}`);
  fs.writeFileSync(tokenCache, JSON.stringify(token), { mode: 0o600 });
  client.auth = await client.request('AUTHENTICATE', { access_token: token.access_token });
}

function socketPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return Array.from({ length: 10 }, (_, i) => path.join(base, `discord-ipc-${i}`));
}

async function openSocket() {
  for (const p of socketPaths()) {
    const sock = await new Promise((resolve) => {
      const s = net.createConnection(p, () => resolve(s));
      s.once('error', () => resolve(null));
    });
    if (sock) return sock;
  }
  throw new Error('No discord-ipc socket found. Is the desktop Discord app running?');
}

// Frames are: int32 LE opcode, int32 LE byte length, UTF-8 JSON.
export class RpcClient {
  constructor(sock, clientId) {
    this.sock = sock;
    this.clientId = clientId;
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.handlers = new Map();
    this.readyWaiter = null;
    sock.on('data', (chunk) => this.#onData(chunk));
    sock.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Socket closed'));
      this.pending.clear();
    });
  }

  handshake() {
    return new Promise((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.#write(OP.HANDSHAKE, { v: 1, client_id: this.clientId });
    });
  }

  // Sends a command and resolves with its `data` (rejects on evt: ERROR).
  request(cmd, args = {}, evt) {
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`${cmd} timed out`));
      }, cmd === 'AUTHORIZE' ? 120_000 : 15_000);
      this.pending.set(nonce, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.#write(OP.FRAME, { cmd, args, evt, nonce });
    });
  }

  // Subscribes to an event and calls handler(data) for each dispatch.
  async subscribe(evt, args = {}, handler) {
    if (handler) this.on(evt, handler);
    await this.request('SUBSCRIBE', args, evt);
  }

  async unsubscribe(evt, args = {}) {
    await this.request('UNSUBSCRIBE', args, evt);
  }

  on(evt, handler) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(handler);
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
      this.readyWaiter?.reject(new Error(`Discord closed the connection: ${msg.message ?? JSON.stringify(msg)}`));
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.readyWaiter?.resolve(msg.data);
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
    if (msg.cmd === 'DISPATCH') {
      for (const h of this.handlers.get(msg.evt) ?? []) h(msg.data);
    }
  }
}
