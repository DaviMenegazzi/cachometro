// Cachômetro API — Node puro (http + sqlite embutidos), sem dependências.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA_DIR ?? './data';
const PHOTOS = join(DATA, 'photos');
const MAX_PHOTO = 10 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const SHAPES = ['squircle', 'heart', 'star', 'circle', 'soft-square', 'square'];
const STICKERS = join(DATA, 'stickers');
const MAX_STICKER = 2 * 1024 * 1024;
const MAX_STICKERS_PER_USER = 200;
// Reação: um emoji (até 16 caracteres, sem letras/números) ou "sticker:<id>" de um sticker do casal.
const isEmoji = (s) => typeof s === 'string' && s.length <= 16 && /\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}]/u.test(s);

const CUTOUT_URL = process.env.CUTOUT_URL ?? '';
const isPng = (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const coord = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(400, 'posição inválida'); return Math.max(0, Math.min(1, n)); };

mkdirSync(PHOTOS, { recursive: true });
mkdirSync(STICKERS, { recursive: true });
const db = new DatabaseSync(join(DATA, 'cachometro.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS couples (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, couple_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, couple_id TEXT NOT NULL, sender_id TEXT NOT NULL, photo_key TEXT UNIQUE NOT NULL,
    message TEXT NOT NULL, shape TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    opened_at INTEGER, reaction TEXT
  );
  CREATE TABLE IF NOT EXISTS stickers (id TEXT PRIMARY KEY, couple_id TEXT NOT NULL, file_key TEXT UNIQUE NOT NULL, mime TEXT NOT NULL, created_at INTEGER NOT NULL);
  -- Stickers colados numa foto; x/y = centro do sticker, de 0 a 1 dentro do quadrado da foto.
  CREATE TABLE IF NOT EXISTS placements (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, sticker_id TEXT NOT NULL, user_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created_at INTEGER NOT NULL);
`);

// Colunas novas em bancos já existentes (o SQLite não tem "ADD COLUMN IF NOT EXISTS").
for (const col of ['scale REAL NOT NULL DEFAULT 1', 'rotation REAL NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE placements ADD COLUMN ${col}`); } catch {}
}
// Cada pessoa tem a própria coleção de stickers (user_id). Stickers antigos (sem dono) continuam valendo para o casal.
try { db.exec('ALTER TABLE stickers ADD COLUMN user_id TEXT'); } catch {}
const myStickerSql = 'SELECT * FROM stickers WHERE id = ? AND couple_id = ? AND (user_id = ? OR user_id IS NULL)';
const STICKER_SCALE = [0.4, 2.4];
const scaleOf = (v) => { const n = Number(v ?? 1); if (!Number.isFinite(n)) throw new HttpError(400, 'tamanho inválido'); return Math.max(STICKER_SCALE[0], Math.min(STICKER_SCALE[1], n)); };
const angleOf = (v) => { const n = Number(v ?? 0); if (!Number.isFinite(n)) throw new HttpError(400, 'ângulo inválido'); return n % 360; };

const sha = (s) => createHash('sha256').update(s).digest('hex');
const newCode = () => randomBytes(4).toString('hex').toUpperCase().slice(0, 6); // ponytail: 6 hex = 16M combinações; basta para um casal
const now = () => Date.now();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'arquivo grande demais');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  try { return JSON.parse((await readBody(req, 16_384)).toString('utf8') || '{}'); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'json inválido'); }
}

function cleanName(name) {
  const n = String(name ?? '').trim().slice(0, 30);
  if (!n) throw new HttpError(400, 'nome obrigatório');
  return n;
}

function createUser(coupleId, name) {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(id, coupleId, name, sha(token), now());
  return { token, userId: id };
}

function auth(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = token && db.prepare('SELECT * FROM users WHERE token_hash = ?').get(sha(token));
  if (!user) throw new HttpError(401, 'não autenticado');
  return user;
}

function ownPost(user, id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND couple_id = ? AND expires_at > ?').get(id, user.couple_id, now());
  if (!post) throw new HttpError(404, 'publicação não encontrada');
  return post;
}

function cleanup() {
  const expired = db.prepare('SELECT id, photo_key FROM posts WHERE expires_at <= ?').all(now());
  for (const p of expired) {
    try { unlinkSync(join(PHOTOS, `${p.photo_key}.jpg`)); } catch {}
    db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
    db.prepare('DELETE FROM placements WHERE post_id = ?').run(p.id);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const [, a, b, c] = url.pathname.split('/');

  if (req.method === 'GET' && a === 'health') return send(res, 200, { ok: true });

  if (req.method === 'POST' && a === 'couples' && !b) {
    const { name } = await readJson(req);
    const coupleId = randomUUID(); const code = newCode();
    db.prepare('INSERT INTO couples VALUES (?, ?, ?)').run(coupleId, code, now());
    return send(res, 201, { ...createUser(coupleId, cleanName(name)), code });
  }

  if (req.method === 'POST' && a === 'couples' && b === 'join') {
    const { name, code } = await readJson(req);
    const couple = db.prepare('SELECT * FROM couples WHERE code = ?').get(String(code ?? '').trim().toUpperCase());
    if (!couple) throw new HttpError(404, 'código não encontrado');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users WHERE couple_id = ?').get(couple.id);
    if (n >= 2) throw new HttpError(409, 'este código já tem duas pessoas');
    return send(res, 201, { ...createUser(couple.id, cleanName(name)), code: couple.code });
  }

  // Fotos: a chave aleatória (128 bits) só é entregue a membros do casal e morre em 24h.
  if (req.method === 'GET' && a === 'photos' && /^[a-f0-9]{32}$/.test(b ?? '')) {
    const file = join(PHOTOS, `${b}.jpg`);
    const post = db.prepare('SELECT 1 FROM posts WHERE photo_key = ? AND expires_at > ?').get(b, now());
    if (!post || !existsSync(file)) throw new HttpError(404, 'foto expirada');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' });
    return res.end(readFileSync(file));
  }

  // Stickers não expiram; a chave aleatória só é entregue aos dois membros do casal.
  if (req.method === 'GET' && a === 'stickers' && /^[a-f0-9]{32}$/.test(b ?? '')) {
    const sticker = db.prepare('SELECT mime FROM stickers WHERE file_key = ?').get(b);
    const file = join(STICKERS, b);
    if (!sticker || !existsSync(file)) throw new HttpError(404, 'sticker não encontrado');
    res.writeHead(200, { 'content-type': sticker.mime, 'cache-control': 'private, max-age=31536000, immutable' });
    return res.end(readFileSync(file));
  }

  const user = auth(req);

  if (req.method === 'GET' && a === 'stickers' && !b) {
    const rows = db.prepare('SELECT id, file_key FROM stickers WHERE couple_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC').all(user.couple_id, user.id);
    return send(res, 200, rows.map((s) => ({ id: s.id, path: `/stickers/${s.file_key}` })));
  }

  if (req.method === 'POST' && a === 'stickers' && !b) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM stickers WHERE user_id = ?').get(user.id);
    if (n >= MAX_STICKERS_PER_USER) throw new HttpError(409, 'limite de stickers atingido');
    let img = await readBody(req, MAX_STICKER);
    let png = isPng(img);
    const jpeg = img.length > 3 && img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff;
    if (!png && !jpeg) throw new HttpError(415, 'envie PNG ou JPEG');
    // Recorte automático do fundo (serviço "cutout"); se ele falhar, o sticker fica com a imagem original.
    if (CUTOUT_URL && url.searchParams.get('cutout') !== '0') {
      try {
        const r = await fetch(CUTOUT_URL, { method: 'POST', body: img, signal: AbortSignal.timeout(30_000) });
        const out = Buffer.from(await r.arrayBuffer());
        if (r.ok && isPng(out)) { img = out; png = true; }
      } catch {}
    }
    const key = randomBytes(16).toString('hex'); const id = randomUUID();
    writeFileSync(join(STICKERS, key), img);
    db.prepare('INSERT INTO stickers (id, couple_id, file_key, mime, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.couple_id, key, png ? 'image/png' : 'image/jpeg', now(), user.id);
    return send(res, 201, { id, path: `/stickers/${key}` });
  }

  if (req.method === 'DELETE' && a === 'stickers' && b) {
    const sticker = db.prepare(myStickerSql).get(b, user.couple_id, user.id);
    if (!sticker) throw new HttpError(404, 'sticker não encontrado');
    try { unlinkSync(join(STICKERS, sticker.file_key)); } catch {}
    db.prepare('DELETE FROM stickers WHERE id = ?').run(sticker.id);
    db.prepare('DELETE FROM placements WHERE sticker_id = ?').run(sticker.id);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && a === 'me') {
    const couple = db.prepare('SELECT code FROM couples WHERE id = ?').get(user.couple_id);
    const partner = db.prepare('SELECT name FROM users WHERE couple_id = ? AND id != ?').get(user.couple_id, user.id);
    return send(res, 200, { name: user.name, code: couple.code, partner: partner?.name ?? null });
  }

  if (req.method === 'GET' && a === 'feed') {
    const rows = db.prepare(`
      SELECT p.*, u.name AS sender_name FROM posts p JOIN users u ON u.id = p.sender_id
      WHERE p.couple_id = ? AND p.expires_at > ? ORDER BY p.created_at DESC LIMIT 50
    `).all(user.couple_id, now());
    const placed = db.prepare(`
      SELECT pl.id, pl.post_id, pl.sticker_id, pl.user_id, pl.x, pl.y, pl.scale, pl.rotation, st.file_key FROM placements pl
      JOIN posts p ON p.id = pl.post_id JOIN stickers st ON st.id = pl.sticker_id
      WHERE p.couple_id = ? ORDER BY pl.created_at
    `).all(user.couple_id);
    return send(res, 200, rows.map((p) => ({
      id: p.id, mine: p.sender_id === user.id, senderName: p.sender_name, photoPath: `/photos/${p.photo_key}`,
      message: p.message, shape: p.shape, createdAt: p.created_at, expiresAt: p.expires_at,
      openedAt: p.opened_at, reaction: p.reaction,
      stickers: placed.filter((s) => s.post_id === p.id).map((s) => ({
        id: s.id, stickerId: s.sticker_id, path: `/stickers/${s.file_key}`, mine: s.user_id === user.id,
        x: s.x, y: s.y, scale: s.scale, rotation: s.rotation,
      })),
    })));
  }

  if (req.method === 'POST' && a === 'posts' && !b) {
    const shape = String(req.headers['x-shape'] ?? '');
    if (!SHAPES.includes(shape)) throw new HttpError(400, 'formato inválido');
    let message = '';
    try { message = decodeURIComponent(String(req.headers['x-message'] ?? '')).trim().slice(0, 240); }
    catch { throw new HttpError(400, 'mensagem inválida'); }
    const photo = await readBody(req, MAX_PHOTO);
    if (photo.length < 4 || photo[0] !== 0xff || photo[1] !== 0xd8 || photo[2] !== 0xff) throw new HttpError(415, 'envie um JPEG');
    const key = randomBytes(16).toString('hex');
    writeFileSync(join(PHOTOS, `${key}.jpg`), photo);
    const id = randomUUID(); const t = now();
    db.prepare('INSERT INTO posts (id, couple_id, sender_id, photo_key, message, shape, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.couple_id, user.id, key, message, shape, t, t + TTL_MS);
    return send(res, 201, { id, expiresAt: t + TTL_MS });
  }

  if (req.method === 'DELETE' && a === 'posts' && b && !c) {
    const post = ownPost(user, b);
    if (post.sender_id !== user.id) throw new HttpError(403, 'só quem enviou pode apagar');
    try { unlinkSync(join(PHOTOS, `${post.photo_key}.jpg`)); } catch {}
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    db.prepare('DELETE FROM placements WHERE post_id = ?').run(post.id);
    return send(res, 200, { ok: true });
  }

  // Colar stickers da própria coleção em qualquer foto; só quem colou pode mover ou tirar.
  if (a === 'posts' && c === 'stickers') {
    const post = ownPost(user, b);
    const d = url.pathname.split('/')[4];
    if (req.method === 'POST' && !d) {
      const { stickerId, x, y } = await readJson(req);
      if (!db.prepare(myStickerSql).get(stickerId, user.couple_id, user.id)) throw new HttpError(400, 'sticker inválido');
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM placements WHERE post_id = ?').get(post.id);
      if (n >= 30) throw new HttpError(409, 'stickers demais nesta foto');
      const id = randomUUID();
      db.prepare('INSERT INTO placements (id, post_id, sticker_id, user_id, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, post.id, stickerId, user.id, coord(x), coord(y), now());
      return send(res, 201, { id });
    }
    const placement = d && db.prepare('SELECT * FROM placements WHERE id = ? AND post_id = ?').get(d, post.id);
    if (!placement) throw new HttpError(404, 'sticker não encontrado nesta foto');
    if (placement.user_id !== user.id) throw new HttpError(403, 'só quem colou pode mexer');
    if (req.method === 'PATCH') {
      const { x, y, scale, rotation } = await readJson(req);
      db.prepare('UPDATE placements SET x = ?, y = ?, scale = ?, rotation = ? WHERE id = ?')
        .run(coord(x ?? placement.x), coord(y ?? placement.y), scaleOf(scale ?? placement.scale), angleOf(rotation ?? placement.rotation), placement.id);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM placements WHERE id = ?').run(placement.id);
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && a === 'posts' && c === 'open') {
    const post = ownPost(user, b);
    if (post.sender_id !== user.id && !post.opened_at) db.prepare('UPDATE posts SET opened_at = ? WHERE id = ?').run(now(), post.id);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && a === 'posts' && c === 'react') {
    const post = ownPost(user, b);
    if (post.sender_id === user.id) throw new HttpError(403, 'reaja às fotos da outra pessoa');
    const { emoji } = await readJson(req);
    if (typeof emoji === 'string' && emoji.startsWith('sticker:')) {
      const ok = db.prepare(myStickerSql).get(emoji.slice(8), user.couple_id, user.id);
      if (!ok) throw new HttpError(400, 'sticker inválido');
    } else if (emoji !== null && !isEmoji(emoji)) throw new HttpError(400, 'emoji inválido');
    db.prepare('UPDATE posts SET reaction = ? WHERE id = ?').run(emoji, post.id);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, 'rota não encontrada');
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!(e instanceof HttpError)) console.error(e.stack ?? e); // nunca loga fotos, mensagens ou tokens
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.status ? e.message : 'erro interno' });
  });
}).listen(PORT, () => console.log(`cachometro-api on :${PORT}`));

setInterval(cleanup, 5 * 60 * 1000);
cleanup();
