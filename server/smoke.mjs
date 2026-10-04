// Teste rápido da API: `node smoke.mjs` (sobe o servidor num diretório temporário).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 8799, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['server.mjs'], {
  cwd: import.meta.dirname, env: { ...process.env, PORT, DATA_DIR: mkdtempSync(join(tmpdir(), 'cach-')), NODE_NO_WARNINGS: '1' },
});
await new Promise((r) => srv.stdout.once('data', r));

const call = async (path, { token, json, ...opts } = {}) => {
  const res = await fetch(B + path, {
    method: json || opts.body ? 'POST' : 'GET', ...opts,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...opts.headers },
    body: json ? JSON.stringify(json) : opts.body,
  });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};

try {
  const a = (await call('/couples', { json: { name: 'Davi' } })).body;
  const b = (await call('/couples/join', { json: { name: 'Amor', code: a.code.toLowerCase() } })).body;
  assert.equal((await call('/couples/join', { json: { name: 'X', code: a.code } })).status, 409);
  assert.equal((await call('/feed')).status, 401);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await call('/posts', { token: a.token, body: 'nope', headers: { 'x-shape': 'heart' } })).status, 415);
  const post = (await call('/posts', { token: a.token, body: jpeg, headers: { 'x-shape': 'heart', 'x-message': encodeURIComponent('oi amor 💖') } })).body;

  assert.equal((await call(`/posts/${post.id}/react`, { token: a.token, json: { emoji: '😍' } })).status, 403);
  await call(`/posts/${post.id}/open`, { token: b.token, json: {} });
  assert.equal((await call(`/posts/${post.id}/react`, { token: b.token, json: { emoji: '😍' } })).status, 200);

  const [p] = (await call('/feed', { token: a.token })).body;
  assert.equal(p.message, 'oi amor 💖');
  assert.equal(p.reaction, '😍');
  assert.ok(p.openedAt && p.mine);
  assert.equal((await fetch(B + p.photoPath)).status, 200);
  assert.equal((await call('/me', { token: b.token })).body.partner, 'Davi');

  // reações livres: qualquer emoji, nunca texto
  assert.equal((await call(`/posts/${post.id}/react`, { token: b.token, json: { emoji: '🥐' } })).status, 200);
  assert.equal((await call(`/posts/${post.id}/react`, { token: b.token, json: { emoji: 'oi' } })).status, 400);

  // stickers: cada pessoa tem a sua coleção; o que foi colado na foto os dois veem
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal((await call('/stickers', { token: b.token, body: 'nope' })).status, 415);
  const sticker = (await call('/stickers', { token: b.token, body: png })).body;
  assert.equal((await call('/stickers', { token: b.token })).body[0].id, sticker.id);
  assert.equal((await call('/stickers', { token: a.token })).body.length, 0);
  assert.equal((await fetch(B + sticker.path)).headers.get('content-type'), 'image/png');
  assert.equal((await call(`/posts/${post.id}/react`, { token: b.token, json: { emoji: `sticker:${sticker.id}` } })).status, 200);
  assert.equal((await call(`/posts/${post.id}/react`, { token: b.token, json: { emoji: 'sticker:nao-existe' } })).status, 400);

  // colar, mover e tirar sticker da foto
  assert.equal((await call(`/posts/${post.id}/stickers`, { token: a.token, json: { stickerId: sticker.id, x: 0.5, y: 0.5 } })).status, 400);
  const placed = (await call(`/posts/${post.id}/stickers`, { token: b.token, json: { stickerId: sticker.id, x: 0.5, y: 0.5 } })).body;
  assert.equal((await call(`/posts/${post.id}/stickers/${placed.id}`, { token: a.token, method: 'PATCH', json: { x: 0 } })).status, 403);
  assert.equal((await call(`/posts/${post.id}/stickers/${placed.id}`, { token: b.token, method: 'PATCH', json: { x: 2, y: 0.25, scale: 9, rotation: 405 } })).status, 200);
  let [withSticker] = (await call('/feed', { token: a.token })).body;
  assert.deepEqual(withSticker.stickers, [{ id: placed.id, stickerId: sticker.id, path: sticker.path, mine: false, x: 1, y: 0.25, scale: 2.4, rotation: 45 }]);
  assert.equal((await call(`/posts/${post.id}/stickers/${placed.id}`, { token: b.token, method: 'DELETE' })).status, 200);
  await call(`/posts/${post.id}/stickers`, { token: b.token, json: { stickerId: sticker.id, x: 0.1, y: 0.1 } });
  assert.equal((await call(`/stickers/${sticker.id}`, { token: a.token, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/stickers/${sticker.id}`, { token: b.token, method: 'DELETE' })).status, 200);
  [withSticker] = (await call('/feed', { token: a.token })).body;
  assert.equal(withSticker.stickers.length, 0); // apagar o sticker tira ele das fotos também

  assert.equal((await call(`/posts/${post.id}`, { token: b.token, method: 'DELETE' })).status, 403);
  assert.equal((await call(`/posts/${post.id}`, { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await call('/feed', { token: a.token })).body.length, 0);
  assert.equal((await fetch(B + p.photoPath)).status, 404);
  console.log('ok');
} finally { srv.kill(); }
