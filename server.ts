import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

const PORT = Number(process.env.PORT || 3090);
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const DB_REPO = (process.env.DB_REPO || 'raydelw-a11y/huellas-chat-db').trim();
const DB_FILE_PATH = (process.env.FOX_CITY_DB_PATH || 'fox-city-saves.json').trim();
const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'fox-city-db.local.json');
const TOKEN_SECRET = process.env.FOX_CITY_SECRET || 'fox-city-metropolitan-sync-secret-2026';

export interface StoredCityRecord {
  slotId: string;
  name: string;
  mapId: string;
  seed: number;
  sandboxMode: boolean;
  population: number;
  money: number;
  happiness: number;
  day: number;
  serverRev: number;
  updatedAt: string;
  deviceId: string;
  compactState: string;
}

interface AccountRecord {
  accountId: string;
  mayorName: string;
  passHash: string;
  createdAt: string;
  cities: Record<string, StoredCityRecord>;
}

interface DatabaseSchema {
  version: number;
  updatedAt: string;
  accounts: Record<string, AccountRecord>;
}

let db: DatabaseSchema = {
  version: 1,
  updatedAt: new Date().toISOString(),
  accounts: {},
};

let githubFileSha: string | null = null;
let isSavingGitHub = false;
let savePendingGitHub = false;
let githubDebounceTimer: NodeJS.Timeout | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveLocalDisk() {
  try {
    ensureDataDir();
    db.updatedAt = new Date().toISOString();
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[FoxCity Server] Error writing local DB:', err);
  }
}

function loadLocalDisk(): boolean {
  try {
    if (fs.existsSync(LOCAL_DB_FILE)) {
      const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.accounts) {
        db = parsed;
        return true;
      }
    }
  } catch (err) {
    console.error('[FoxCity Server] Failed loading local DB:', err);
  }
  return false;
}

function githubRequest(
  method: string,
  apiPath: string,
  bodyObj?: unknown
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'User-Agent': 'FoxCity-CloudSync/1.0',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => {
          chunks += d;
        });
        res.on('end', () => {
          try {
            const parsed = chunks ? JSON.parse(chunks) : {};
            resolve({ status: res.statusCode || 500, data: parsed });
          } catch {
            resolve({ status: res.statusCode || 500, data: chunks });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function hydrateFromGitHubIfAvailable() {
  const hadLocal = loadLocalDisk();
  if (!GITHUB_TOKEN || !DB_REPO) return;

  try {
    const apiPath = `/repos/${DB_REPO}/contents/${encodeURIComponent(DB_FILE_PATH)}`;
    const res = await githubRequest('GET', apiPath);
    if (res.status === 200 && res.data && res.data.content) {
      githubFileSha = res.data.sha || null;
      const decoded = Buffer.from(res.data.content, 'base64').toString('utf8');
      const remoteDb = JSON.parse(decoded) as DatabaseSchema;
      if (remoteDb && remoteDb.accounts) {
        if (!hadLocal || new Date(remoteDb.updatedAt || 0) >= new Date(db.updatedAt || 0)) {
          db = remoteDb;
          saveLocalDisk();
          console.log('[FoxCity Server] Hydrated city saves from GitHub backup.');
        }
      }
    }
  } catch (err) {
    console.warn('[FoxCity Server] GitHub hydration skipped:', (err as Error).message);
  }
}

async function flushToGitHub() {
  if (!GITHUB_TOKEN || !DB_REPO) return;
  if (isSavingGitHub) {
    savePendingGitHub = true;
    return;
  }
  isSavingGitHub = true;
  savePendingGitHub = false;

  const apiPath = `/repos/${DB_REPO}/contents/${encodeURIComponent(DB_FILE_PATH)}`;
  try {
    if (!githubFileSha) {
      const check = await githubRequest('GET', apiPath);
      if (check.status === 200 && check.data?.sha) {
        githubFileSha = check.data.sha;
      }
    }

    const contentBase64 = Buffer.from(JSON.stringify(db), 'utf8').toString('base64');
    const putBody: Record<string, unknown> = {
      message: `Fox City auto-sync ${new Date().toISOString()}`,
      content: contentBase64,
    };
    if (githubFileSha) putBody.sha = githubFileSha;

    let res = await githubRequest('PUT', apiPath, putBody);

    if (res.status === 409) {
      const refresh = await githubRequest('GET', apiPath);
      if (refresh.status === 200 && refresh.data?.sha) {
        githubFileSha = refresh.data.sha;
        putBody.sha = githubFileSha;
        res = await githubRequest('PUT', apiPath, putBody);
      }
    }

    if ((res.status === 200 || res.status === 201) && res.data?.content?.sha) {
      githubFileSha = res.data.content.sha;
    }
  } catch (err) {
    console.warn('[FoxCity Server] GitHub backup error:', (err as Error).message);
  } finally {
    isSavingGitHub = false;
    if (savePendingGitHub) {
      scheduleGitHubBackup();
    }
  }
}

function scheduleGitHubBackup() {
  if (!GITHUB_TOKEN || !DB_REPO) return;
  if (githubDebounceTimer) clearTimeout(githubDebounceTimer);
  githubDebounceTimer = setTimeout(() => {
    githubDebounceTimer = null;
    void flushToGitHub();
  }, 4500);
}

function persistDatabase() {
  saveLocalDisk();
  scheduleGitHubBackup();
}

function makeAccountId(mayorName: string, password: string): string {
  const cleanMayor = (mayorName || 'alcalde').trim().toLowerCase();
  const cleanPass = password.trim();
  return crypto
    .createHash('sha256')
    .update(`foxcity:${cleanMayor}:${cleanPass}`)
    .digest('hex')
    .slice(0, 24);
}

function signAuthToken(accountId: string): string {
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(accountId).digest('hex').slice(0, 32);
  return `${accountId}.${sig}`;
}

function verifyAuthToken(token: string | undefined): AccountRecord | null {
  if (!token || !token.includes('.')) return null;
  const [accountId, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(accountId)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return db.accounts[accountId] || null;
}

function summarizeCities(account: AccountRecord) {
  return Object.values(account.cities)
    .map((c) => ({
      slotId: c.slotId,
      name: c.name,
      mapId: c.mapId,
      seed: c.seed,
      sandboxMode: Boolean(c.sandboxMode),
      population: c.population,
      money: c.money,
      happiness: c.happiness,
      day: c.day,
      serverRev: c.serverRev,
      updatedAt: c.updatedAt,
      deviceId: c.deviceId,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

function extractToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.body?.token === 'string') {
    return req.body.token;
  }
  return undefined;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    cloudBackupConfigured: Boolean(GITHUB_TOKEN && DB_REPO),
    serverTime: new Date().toISOString(),
  });
});

app.post('/api/auth/session', (req, res) => {
  const rawPassword = String(req.body?.password || '').trim();
  const rawMayor = String(req.body?.mayorName || 'Alcalde Principal').trim() || 'Alcalde Principal';

  if (!rawPassword) {
    res.status(400).json({ ok: false, error: 'Ingresa tu contraseña de Acceso Privado.' });
    return;
  }

  const accountId = makeAccountId(rawMayor, rawPassword);
  const passHash = crypto.createHash('sha256').update(rawPassword).digest('hex');

  if (!db.accounts[accountId]) {
    db.accounts[accountId] = {
      accountId,
      mayorName: rawMayor,
      passHash,
      createdAt: new Date().toISOString(),
      cities: {},
    };
    persistDatabase();
  } else {
    db.accounts[accountId].mayorName = rawMayor;
  }

  const account = db.accounts[accountId];
  const token = signAuthToken(accountId);

  res.json({
    ok: true,
    token,
    accountId,
    mayorName: account.mayorName,
    cities: summarizeCities(account),
  });
});

app.get('/api/cities', (req, res) => {
  const account = verifyAuthToken(extractToken(req));
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sesión no válida.' });
    return;
  }
  res.json({
    ok: true,
    mayorName: account.mayorName,
    cities: summarizeCities(account),
  });
});

app.get('/api/cities/:slotId', (req, res) => {
  const account = verifyAuthToken(extractToken(req));
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sesión no válida.' });
    return;
  }
  const city = account.cities[req.params.slotId];
  if (!city) {
    res.status(404).json({ ok: false, error: 'Ciudad no encontrada en la nube.' });
    return;
  }
  res.json({ ok: true, city });
});

app.post('/api/cities/:slotId/sync', (req, res) => {
  const account = verifyAuthToken(extractToken(req));
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sesión no válida.' });
    return;
  }

  const slotId = String(req.params.slotId || '').trim();
  const incoming = req.body?.city;
  const baseRev = Number(req.body?.baseRev || 0);
  const deviceId = String(req.body?.deviceId || 'unknown-device');
  const forceOverwrite = Boolean(req.body?.forceOverwrite);

  if (!slotId || !incoming || typeof incoming.compactState !== 'string') {
    res.status(400).json({ ok: false, error: 'Datos de ciudad incompletos.' });
    return;
  }

  const existing = account.cities[slotId];

  // Conflict check when another device saved newer state while this device was offline
  if (
    existing &&
    !forceOverwrite &&
    baseRev < existing.serverRev &&
    existing.deviceId !== deviceId
  ) {
    // Never lose progress: store incoming offline branch as a recoverable backup slot if space allows
    const cityKeys = Object.keys(account.cities);
    let backupSlotId: string | null = null;
    if (cityKeys.length < 8) {
      backupSlotId = `${slotId}-offline-${Date.now().toString(36).slice(-4)}`;
      account.cities[backupSlotId] = {
        slotId: backupSlotId,
        name: `${String(incoming.name || existing.name)} (Copia Offline)`,
        mapId: String(incoming.mapId || existing.mapId),
        seed: Number(incoming.seed || existing.seed),
        sandboxMode: Boolean(incoming.sandboxMode),
        population: Number(incoming.population || 0),
        money: Number(incoming.money || 0),
        happiness: Number(incoming.happiness || 75),
        day: Number(incoming.day || 1),
        serverRev: 1,
        updatedAt: new Date().toISOString(),
        deviceId,
        compactState: incoming.compactState,
      };
      persistDatabase();
    }

    res.status(409).json({
      ok: false,
      conflict: true,
      backupSlotId,
      serverCity: existing,
      cities: summarizeCities(account),
    });
    return;
  }

  const nextRev = (existing?.serverRev || 0) + 1;
  const record: StoredCityRecord = {
    slotId,
    name: String(incoming.name || existing?.name || 'Nueva Fox City').slice(0, 48),
    mapId: String(incoming.mapId || existing?.mapId || 'emerald_bay'),
    seed: Number(incoming.seed || existing?.seed || 104729),
    sandboxMode: Boolean(incoming.sandboxMode),
    population: Math.max(0, Math.round(Number(incoming.population || 0))),
    money: Math.round(Number(incoming.money || 0)),
    happiness: Math.max(0, Math.min(100, Math.round(Number(incoming.happiness ?? 80)))),
    day: Math.max(1, Math.round(Number(incoming.day || 1))),
    serverRev: nextRev,
    updatedAt: new Date().toISOString(),
    deviceId,
    compactState: incoming.compactState,
  };

  account.cities[slotId] = record;
  persistDatabase();

  res.json({
    ok: true,
    serverRev: record.serverRev,
    updatedAt: record.updatedAt,
    cities: summarizeCities(account),
  });
});

app.delete('/api/cities/:slotId', (req, res) => {
  const account = verifyAuthToken(extractToken(req));
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sesión no válida.' });
    return;
  }
  const slotId = req.params.slotId;
  if (account.cities[slotId]) {
    delete account.cities[slotId];
    persistDatabase();
  }
  res.json({ ok: true, cities: summarizeCities(account) });
});

// Static frontend in production
const distPath = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('manifest.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    const indexHtml = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(indexHtml);
    } else {
      next();
    }
  });
}

void hydrateFromGitHubIfAvailable().finally(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[FoxCity Server] Listening on http://0.0.0.0:${PORT}`);
  });
});
