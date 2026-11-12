import { CloudCitySummary, MapArchetypeId } from '../types/game';

const MANIFEST_FILENAME = 'fox-city-cloud-sync.json';
const GIST_DESCRIPTION = 'Fox City — Metropolitan 3D Cloud Sync';

const SESSION_KEY = 'foxcity:auth_session_v2';
const DEVICE_KEY = 'foxcity:device_id_v1';
const CLOUD_CFG_KEY = 'foxcity:cloud_cfg_v1';
const ACCOUNTS_KEY = 'foxcity:accounts_v1';
const LOCAL_INDEX_PREFIX = 'foxcity:index:';
const DIRTY_SLOTS_KEY = 'foxcity:dirty_slots_v1';
const WAL_LATEST_KEY = 'foxcity:wal_latest_v1';

const IDB_NAME = 'foxcity_idb_v1';
const IDB_STORE = 'city_slots';

export interface AuthSessionData {
  token: string;
  accountId: string;
  mayorName: string;
}

export interface LocalSavedCityRecord extends CloudCitySummary {
  compactState: string;
  dirtyOffline?: boolean;
}

export interface GitHubCloudConfig {
  pat: string;
  gistId: string;
  githubLogin: string;
  lastEtag: string;
  lastSyncedAt: string;
}

interface StoredAccountAuth {
  mayorName: string;
  salt: string;
  passHash: string;
  createdAt: string;
}

interface GistAccountBlock {
  mayorName: string;
  salt: string;
  passHash: string;
  createdAt: string;
  cities: Record<string, CloudCitySummary>;
}

interface GistManifestV2 {
  schemaVersion: 2;
  app: 'fox-city';
  updatedAt: string;
  accounts: Record<string, GistAccountBlock>;
}

interface GistFileDescriptor {
  filename?: string;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
  size?: number;
}

interface GistApiResponse {
  id: string;
  html_url?: string;
  updated_at?: string;
  owner?: { login?: string };
  files?: Record<string, GistFileDescriptor>;
}

export interface BackupBundleV2 {
  app: 'fox-city-backup';
  version: 2;
  exportedAt: string;
  accountId: string;
  mayorName: string;
  cities: LocalSavedCityRecord[];
}

// --- Pure synchronous SHA-256 (works on HTTPS github.io, localhost, and plain LAN HTTP) ---
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(totalLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export function normalizeAccountId(mayorName: string): string {
  const slug = mayorName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `acc_${slug || 'alcalde'}`;
}

function slotGistFilename(accountId: string, slotId: string): string {
  const safeAcc = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSlot = slotId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `foxcity_slot_${safeAcc}_${safeSlot}.json`;
}

function idbRecordKey(accountId: string, slotId: string): string {
  return `${accountId}::${slotId}`;
}

// --- IndexedDB Async Store + In-Memory Cache + iOS Synchronous WAL ---
const memorySlotCache = new Map<string, LocalSavedCityRecord>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openCityDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbPutRecord(key: string, record: LocalSavedCityRecord): Promise<void> {
  memorySlotCache.set(key, record);
  const db = await openCityDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGetRecord(key: string): Promise<LocalSavedCityRecord | null> {
  const cached = memorySlotCache.get(key);
  if (cached) return cached;
  const db = await openCityDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const res = (req.result as LocalSavedCityRecord | undefined) || null;
        if (res) memorySlotCache.set(key, res);
        resolve(res);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbDeleteRecord(key: string): Promise<void> {
  memorySlotCache.delete(key);
  const db = await openCityDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Synchronous iOS Write-Ahead Buffer (protects last snapshot if Safari freezes IDB on pagehide)
export function writeEmergencyWalSync(accountId: string, record: LocalSavedCityRecord): void {
  try {
    const key = idbRecordKey(accountId, record.slotId);
    memorySlotCache.set(key, record);
    localStorage.setItem(
      WAL_LATEST_KEY,
      JSON.stringify({
        accountId,
        savedAtMs: Date.now(),
        record,
      })
    );
    const index = listLocalCities(accountId).filter((c) => c.slotId !== record.slotId);
    const { compactState: _cs, dirtyOffline: _do, ...summary } = record;
    index.unshift(summary);
    saveLocalIndex(accountId, index.slice(0, 12));
  } catch {
    // ignore storage pressure
  }
}

export async function hydrateEmergencyWalIfAny(): Promise<void> {
  try {
    const raw = localStorage.getItem(WAL_LATEST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      accountId?: string;
      record?: LocalSavedCityRecord;
    };
    if (!parsed?.accountId || !parsed?.record?.slotId) {
      localStorage.removeItem(WAL_LATEST_KEY);
      return;
    }
    const key = idbRecordKey(parsed.accountId, parsed.record.slotId);
    const existing = await idbGetRecord(key);
    const walTs = new Date(parsed.record.updatedAt).getTime() || 0;
    const curTs = existing ? new Date(existing.updatedAt).getTime() || 0 : -1;
    if (!existing || walTs >= curTs) {
      await idbPutRecord(key, parsed.record);
      const index = listLocalCities(parsed.accountId).filter(
        (c) => c.slotId !== parsed.record!.slotId
      );
      const { compactState: _cs, dirtyOffline: _do, ...summary } = parsed.record;
      index.unshift(summary);
      saveLocalIndex(parsed.accountId, index.slice(0, 12));
    }
    localStorage.removeItem(WAL_LATEST_KEY);
  } catch {
    // ignore
  }
}

// Dirty queue metadata in localStorage so resuming iOS tab knows what still needs Gist push
function markSlotDirty(accountId: string, slotId: string, dirty: boolean): void {
  try {
    const raw = localStorage.getItem(DIRTY_SLOTS_KEY);
    const map: Record<string, boolean> = raw ? JSON.parse(raw) : {};
    const key = idbRecordKey(accountId, slotId);
    if (dirty) {
      map[key] = true;
    } else {
      delete map[key];
    }
    localStorage.setItem(DIRTY_SLOTS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function hasDirtySlotsForAccount(accountId: string): string[] {
  try {
    const raw = localStorage.getItem(DIRTY_SLOTS_KEY);
    if (!raw) return [];
    const map: Record<string, boolean> = JSON.parse(raw);
    const prefix = `${accountId}::`;
    return Object.keys(map)
      .filter((k) => k.startsWith(prefix) && map[k])
      .map((k) => k.slice(prefix.length));
  } catch {
    return [];
  }
}

// --- Cloud Configuration (GitHub PAT + Auto-Discovered Secret Gist) ---
export function getCloudConfig(): GitHubCloudConfig {
  try {
    const raw = localStorage.getItem(CLOUD_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        pat: typeof parsed.pat === 'string' ? parsed.pat.trim() : '',
        gistId: typeof parsed.gistId === 'string' ? parsed.gistId.trim() : '',
        githubLogin: typeof parsed.githubLogin === 'string' ? parsed.githubLogin : '',
        lastEtag: typeof parsed.lastEtag === 'string' ? parsed.lastEtag : '',
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : '',
      };
    }
  } catch {
    // ignore
  }
  return { pat: '', gistId: '', githubLogin: '', lastEtag: '', lastSyncedAt: '' };
}

export function saveCloudConfig(partial: Partial<GitHubCloudConfig>): GitHubCloudConfig {
  const next: GitHubCloudConfig = {
    ...getCloudConfig(),
    ...partial,
  };
  if (typeof partial.pat === 'string') {
    next.pat = partial.pat.trim();
  }
  try {
    localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function disconnectGitHubCloud(): void {
  saveCloudConfig({
    pat: '',
    gistId: '',
    githubLogin: '',
    lastEtag: '',
  });
}

export function isGitHubCloudEnabled(): boolean {
  return Boolean(getCloudConfig().pat);
}

// --- Device & Session Helpers ---
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return 'dev-memory';
  }
}

export function loadSavedSession(): AuthSessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.accountId && parsed?.mayorName) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export function saveAuthSession(session: AuthSessionData): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function loadLocalAccounts(): Record<string, StoredAccountAuth> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveLocalAccounts(accounts: Record<string, StoredAccountAuth>): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore
  }
}

export function listLocalCities(accountId: string): CloudCitySummary[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_INDEX_PREFIX}${accountId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalIndex(accountId: string, list: CloudCitySummary[]): void {
  try {
    localStorage.setItem(`${LOCAL_INDEX_PREFIX}${accountId}`, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export async function saveCityLocally(
  accountId: string,
  record: LocalSavedCityRecord
): Promise<void> {
  const key = idbRecordKey(accountId, record.slotId);
  await idbPutRecord(key, record);
  markSlotDirty(accountId, record.slotId, Boolean(record.dirtyOffline));
  const index = listLocalCities(accountId).filter((c) => c.slotId !== record.slotId);
  const { compactState: _cs, dirtyOffline: _do, ...summary } = record;
  index.unshift(summary);
  saveLocalIndex(accountId, index.slice(0, 12));
}

export async function loadCityLocally(
  accountId: string,
  slotId: string
): Promise<LocalSavedCityRecord | null> {
  await hydrateEmergencyWalIfAny();
  const key = idbRecordKey(accountId, slotId);
  const fromIdb = await idbGetRecord(key);
  if (fromIdb) return fromIdb;

  // One-time legacy fallback if an earlier local test stored under fox_city_slot_
  try {
    const legacyRaw = localStorage.getItem(`fox_city_slot_${accountId}_${slotId}`);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as LocalSavedCityRecord;
      await idbPutRecord(key, parsed);
      localStorage.removeItem(`fox_city_slot_${accountId}_${slotId}`);
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function removeCityLocally(accountId: string, slotId: string): Promise<void> {
  await idbDeleteRecord(idbRecordKey(accountId, slotId));
  markSlotDirty(accountId, slotId, false);
  const filtered = listLocalCities(accountId).filter((c) => c.slotId !== slotId);
  saveLocalIndex(accountId, filtered);
}

// --- GitHub Gist Low-Level Helpers (ETag, Truncated Raw URL without Auth, Auto-Discovery) ---
function githubHeaders(pat: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat.trim()}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(extra || {}),
  };
}

let cachedGistPayload: GistApiResponse | null = null;
let cachedManifest: GistManifestV2 | null = null;

async function readGistFileText(file?: GistFileDescriptor): Promise<string | null> {
  if (!file) return null;
  if (file.truncated && file.raw_url) {
    // IMPORTANT: Never send Authorization header to gist.githubusercontent.com (triggers CORS preflight failure)
    const rawRes = await fetch(file.raw_url, { cache: 'no-store' });
    if (!rawRes.ok) return null;
    return await rawRes.text();
  }
  return typeof file.content === 'string' ? file.content : null;
}

function emptyManifest(): GistManifestV2 {
  return {
    schemaVersion: 2,
    app: 'fox-city',
    updatedAt: new Date().toISOString(),
    accounts: {},
  };
}

async function parseManifestFromGist(gist: GistApiResponse): Promise<GistManifestV2> {
  const file = gist.files?.[MANIFEST_FILENAME];
  const text = await readGistFileText(file);
  if (!text) return emptyManifest();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.accounts) {
      return parsed as GistManifestV2;
    }
  } catch {
    // ignore corrupt manifest
  }
  return emptyManifest();
}

export async function discoverOrCreateFoxCityGist(
  patInput?: string,
  forceNetwork = false
): Promise<{
  ok: boolean;
  gist?: GistApiResponse;
  manifest?: GistManifestV2;
  notModified?: boolean;
  error?: string;
}> {
  const cfg = getCloudConfig();
  const pat = (patInput ?? cfg.pat).trim();
  if (!pat) {
    return { ok: false, error: 'Sin token de GitHub configurado.' };
  }

  let gistId = patInput && patInput.trim() !== cfg.pat ? '' : cfg.gistId;

  // Step 1: Try cached gistId with conditional ETag (304 Not Modified costs 0 rate-limit quota)
  if (gistId) {
    try {
      const headers = githubHeaders(
        pat,
        !forceNetwork && cfg.lastEtag && cachedGistPayload && cachedManifest
          ? { 'If-None-Match': cfg.lastEtag }
          : undefined
      );
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      if (res.status === 304 && cachedGistPayload && cachedManifest) {
        return {
          ok: true,
          gist: cachedGistPayload,
          manifest: cachedManifest,
          notModified: true,
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: 'Token de GitHub inválido o sin permiso "gist". Verifica tu token.',
        };
      }

      if (res.status === 404) {
        // Secret Gist was deleted manually on GitHub -> auto-recover by clearing gistId and re-discovering
        gistId = '';
        saveCloudConfig({ gistId: '', lastEtag: '' });
      } else if (res.ok) {
        const gist = (await res.json()) as GistApiResponse;
        const manifest = await parseManifestFromGist(gist);
        const etag = res.headers.get('ETag') || '';
        cachedGistPayload = gist;
        cachedManifest = manifest;
        saveCloudConfig({
          pat,
          gistId: gist.id,
          githubLogin: gist.owner?.login || cfg.githubLogin,
          lastEtag: etag,
          lastSyncedAt: new Date().toISOString(),
        });
        return { ok: true, gist, manifest };
      }
    } catch {
      return { ok: false, error: 'Sin conexión a GitHub API. Tus cambios siguen seguros localmente.' };
    }
  }

  // Step 2: Paginated Auto-Discovery (pages 1..5, 100 per page) so user NEVER needs to copy/paste a Gist ID
  try {
    const matches: GistApiResponse[] = [];
    let detectedOwner = cfg.githubLogin;

    for (let page = 1; page <= 5; page++) {
      const listRes = await fetch(
        `https://api.github.com/gists?per_page=100&page=${page}`,
        {
          method: 'GET',
          headers: githubHeaders(pat),
          cache: 'no-store',
        }
      );

      if (listRes.status === 401 || listRes.status === 403) {
        return {
          ok: false,
          error: 'Token rechazado por GitHub. Asegúrate de habilitar el permiso "gist".',
        };
      }
      if (!listRes.ok) break;

      const list = (await listRes.json()) as GistApiResponse[];
      if (!Array.isArray(list) || list.length === 0) break;

      if (!detectedOwner && list[0]?.owner?.login) {
        detectedOwner = list[0].owner.login;
      }

      for (const g of list) {
        if (g.files && g.files[MANIFEST_FILENAME]) {
          matches.push(g);
        }
      }

      if (list.length < 100) break;
    }

    if (matches.length > 0) {
      matches.sort(
        (a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      );
      const chosenId = matches[0].id;
      const fullRes = await fetch(
        `https://api.github.com/gists/${encodeURIComponent(chosenId)}`,
        {
          method: 'GET',
          headers: githubHeaders(pat),
          cache: 'no-store',
        }
      );
      if (fullRes.ok) {
        const gist = (await fullRes.json()) as GistApiResponse;
        const manifest = await parseManifestFromGist(gist);
        const etag = fullRes.headers.get('ETag') || '';
        cachedGistPayload = gist;
        cachedManifest = manifest;
        saveCloudConfig({
          pat,
          gistId: gist.id,
          githubLogin: gist.owner?.login || detectedOwner,
          lastEtag: etag,
          lastSyncedAt: new Date().toISOString(),
        });
        return { ok: true, gist, manifest };
      }
    }

    // Step 3: No existing Fox City secret Gist found -> create one automatically
    const initialManifest = emptyManifest();
    const createRes = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: githubHeaders(pat, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: {
          [MANIFEST_FILENAME]: {
            content: JSON.stringify(initialManifest, null, 2),
          },
        },
      }),
    });

    if (!createRes.ok) {
      return {
        ok: false,
        error: `No se pudo crear el Gist automático (HTTP ${createRes.status}). Revisa que el Token tenga permiso "gist".`,
      };
    }

    const createdGist = (await createRes.json()) as GistApiResponse;
    const etag = createRes.headers.get('ETag') || '';
    cachedGistPayload = createdGist;
    cachedManifest = initialManifest;
    saveCloudConfig({
      pat,
      gistId: createdGist.id,
      githubLogin: createdGist.owner?.login || detectedOwner,
      lastEtag: etag,
      lastSyncedAt: new Date().toISOString(),
    });
    return { ok: true, gist: createdGist, manifest: initialManifest };
  } catch {
    return { ok: false, error: 'Error de red al conectar con GitHub Gist.' };
  }
}

export function mergeCityLists(
  localList: CloudCitySummary[],
  remoteList: CloudCitySummary[]
): CloudCitySummary[] {
  const map = new Map<string, CloudCitySummary>();
  for (const item of localList) {
    map.set(item.slotId, item);
  }
  for (const r of remoteList) {
    const loc = map.get(r.slotId);
    if (!loc || r.serverRev >= (loc.serverRev || 0)) {
      map.set(r.slotId, { ...r, mapId: r.mapId as MapArchetypeId });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

// --- Serialized Push Queue so rapid edits never overlap PATCH calls ---
let pushQueueChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = pushQueueChain.then(fn, fn);
  pushQueueChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// --- Authentication (Static Local + Multi-Device GitHub Gist Verification) ---
export async function authenticateWithServer(
  mayorName: string,
  password: string,
  optionalGithubPat?: string
): Promise<{
  ok: boolean;
  offlineFallback?: boolean;
  session: AuthSessionData;
  cities: CloudCitySummary[];
  error?: string;
}> {
  await hydrateEmergencyWalIfAny();

  const cleanMayor = mayorName.trim() || 'Alcalde Principal';
  const cleanPass = password.trim();
  const accountId = normalizeAccountId(cleanMayor);

  if (optionalGithubPat && optionalGithubPat.trim()) {
    saveCloudConfig({ pat: optionalGithubPat.trim() });
  }

  const pat = getCloudConfig().pat;
  const localAccounts = loadLocalAccounts();

  // Path A: GitHub Cloud Token configured -> verify/sync against Secret Gist
  if (pat) {
    const disc = await discoverOrCreateFoxCityGist(pat, true);
    if (!disc.ok && optionalGithubPat?.trim()) {
      // User explicitly entered an invalid token on login screen -> tell them clearly
      return {
        ok: false,
        session: { token: '', accountId: '', mayorName: cleanMayor },
        cities: [],
        error: disc.error || 'No se pudo validar el Token de GitHub.',
      };
    }

    if (disc.ok && disc.manifest && disc.gist) {
      const remoteAcc = disc.manifest.accounts[accountId];
      if (remoteAcc) {
        const expected = sha256Hex(`${remoteAcc.salt}:${cleanPass}`);
        if (expected !== remoteAcc.passHash) {
          return {
            ok: false,
            session: { token: '', accountId: '', mayorName: cleanMayor },
            cities: [],
            error: `Contraseña incorrecta para el perfil "${remoteAcc.mayorName}".`,
          };
        }
        // Sync verified credentials locally
        localAccounts[accountId] = {
          mayorName: remoteAcc.mayorName,
          salt: remoteAcc.salt,
          passHash: remoteAcc.passHash,
          createdAt: remoteAcc.createdAt,
        };
        saveLocalAccounts(localAccounts);

        const remoteCities = Object.values(remoteAcc.cities || {});
        const merged = mergeCityLists(listLocalCities(accountId), remoteCities);
        saveLocalIndex(accountId, merged);

        const session: AuthSessionData = {
          token: `gist.${accountId}`,
          accountId,
          mayorName: remoteAcc.mayorName || cleanMayor,
        };
        saveAuthSession(session);
        return { ok: true, session, cities: merged };
      } else {
        // Account does not exist on Gist yet -> check local account if any, then register on Gist
        let acc = localAccounts[accountId];
        if (acc) {
          if (sha256Hex(`${acc.salt}:${cleanPass}`) !== acc.passHash) {
            return {
              ok: false,
              session: { token: '', accountId: '', mayorName: cleanMayor },
              cities: [],
              error: 'Contraseña local incorrecta.',
            };
          }
        } else {
          const salt = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          acc = {
            mayorName: cleanMayor,
            salt,
            passHash: sha256Hex(`${salt}:${cleanPass}`),
            createdAt: new Date().toISOString(),
          };
          localAccounts[accountId] = acc;
          saveLocalAccounts(localAccounts);
        }

        const localList = listLocalCities(accountId);
        const citiesMap: Record<string, CloudCitySummary> = {};
        for (const c of localList) citiesMap[c.slotId] = c;

        disc.manifest.accounts[accountId] = {
          mayorName: cleanMayor,
          salt: acc.salt,
          passHash: acc.passHash,
          createdAt: acc.createdAt,
          cities: citiesMap,
        };
        disc.manifest.updatedAt = new Date().toISOString();

        // Upload initial account + any existing local slots
        const filesPayload: Record<string, { content: string }> = {
          [MANIFEST_FILENAME]: { content: JSON.stringify(disc.manifest, null, 2) },
        };
        for (const c of localList) {
          const full = await loadCityLocally(accountId, c.slotId);
          if (full) {
            filesPayload[slotGistFilename(accountId, c.slotId)] = {
              content: JSON.stringify(full),
            };
          }
        }

        try {
          const patchRes = await fetch(
            `https://api.github.com/gists/${encodeURIComponent(disc.gist.id)}`,
            {
              method: 'PATCH',
              headers: githubHeaders(pat, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ files: filesPayload }),
            }
          );
          if (patchRes.ok) {
            cachedGistPayload = (await patchRes.json()) as GistApiResponse;
            cachedManifest = disc.manifest;
            saveCloudConfig({
              lastEtag: patchRes.headers.get('ETag') || '',
              lastSyncedAt: new Date().toISOString(),
            });
          }
        } catch {
          // stays safe locally
        }

        const session: AuthSessionData = {
          token: `gist.${accountId}`,
          accountId,
          mayorName: cleanMayor,
        };
        saveAuthSession(session);
        return { ok: true, session, cities: localList };
      }
    }
  }

  // Path B: Pure Local / Offline Instant Mode (zero server needed)
  let localAcc = localAccounts[accountId];
  if (localAcc) {
    if (sha256Hex(`${localAcc.salt}:${cleanPass}`) !== localAcc.passHash) {
      return {
        ok: false,
        session: { token: '', accountId: '', mayorName: cleanMayor },
        cities: [],
        error: 'Contraseña incorrecta para este perfil local.',
      };
    }
  } else {
    const salt = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localAcc = {
      mayorName: cleanMayor,
      salt,
      passHash: sha256Hex(`${salt}:${cleanPass}`),
      createdAt: new Date().toISOString(),
    };
    localAccounts[accountId] = localAcc;
    saveLocalAccounts(localAccounts);
  }

  const session: AuthSessionData = {
    token: `local.${accountId}`,
    accountId,
    mayorName: localAcc.mayorName || cleanMayor,
  };
  saveAuthSession(session);
  return {
    ok: true,
    offlineFallback: !pat,
    session,
    cities: listLocalCities(accountId),
  };
}

// Connect or refresh GitHub Token while already logged into the Hub or 3D Game
export async function connectAndSyncGitHubToken(
  session: AuthSessionData,
  patInput: string
): Promise<{
  ok: boolean;
  githubLogin?: string;
  gistId?: string;
  cities?: CloudCitySummary[];
  error?: string;
}> {
  const cleanPat = patInput.trim();
  if (!cleanPat) {
    return { ok: false, error: 'Pega un Personal Access Token válido de GitHub.' };
  }

  const disc = await discoverOrCreateFoxCityGist(cleanPat, true);
  if (!disc.ok || !disc.gist || !disc.manifest) {
    return { ok: false, error: disc.error || 'No se pudo conectar con GitHub Gist.' };
  }

  const localAccounts = loadLocalAccounts();
  const localAcc = localAccounts[session.accountId];
  let accBlock = disc.manifest.accounts[session.accountId];

  if (!accBlock) {
    const fallbackSalt = `${Date.now().toString(36)}-sync`;
    accBlock = {
      mayorName: session.mayorName,
      salt: localAcc?.salt || fallbackSalt,
      passHash: localAcc?.passHash || sha256Hex(`${fallbackSalt}:foxcity`),
      createdAt: localAcc?.createdAt || new Date().toISOString(),
      cities: {},
    };
    disc.manifest.accounts[session.accountId] = accBlock;
  } else {
    // Adopt canonical salt/hash from Gist so both devices stay aligned
    localAccounts[session.accountId] = {
      mayorName: accBlock.mayorName || session.mayorName,
      salt: accBlock.salt,
      passHash: accBlock.passHash,
      createdAt: accBlock.createdAt,
    };
    saveLocalAccounts(localAccounts);
  }

  // Merge local cities that are newer or missing on Gist
  const localList = listLocalCities(session.accountId);
  const filesToPatch: Record<string, { content: string }> = {};
  let needsPatch = false;

  for (const locSummary of localList) {
    const remSummary = accBlock.cities[locSummary.slotId];
    if (!remSummary || (locSummary.serverRev || 0) > (remSummary.serverRev || 0)) {
      const fullLocal = await loadCityLocally(session.accountId, locSummary.slotId);
      if (fullLocal) {
        const nextRev = Math.max(locSummary.serverRev || 0, remSummary?.serverRev || 0) + 1;
        const cleanRec: LocalSavedCityRecord = {
          ...fullLocal,
          serverRev: nextRev,
          dirtyOffline: false,
        };
        const { compactState: _cs, dirtyOffline: _do, ...summary } = cleanRec;
        accBlock.cities[locSummary.slotId] = summary;
        filesToPatch[slotGistFilename(session.accountId, locSummary.slotId)] = {
          content: JSON.stringify(cleanRec),
        };
        await saveCityLocally(session.accountId, cleanRec);
        needsPatch = true;
      }
    }
  }

  if (needsPatch || Object.keys(filesToPatch).length > 0) {
    disc.manifest.updatedAt = new Date().toISOString();
    filesToPatch[MANIFEST_FILENAME] = {
      content: JSON.stringify(disc.manifest, null, 2),
    };
    try {
      const patchRes = await fetch(
        `https://api.github.com/gists/${encodeURIComponent(disc.gist.id)}`,
        {
          method: 'PATCH',
          headers: githubHeaders(cleanPat, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ files: filesToPatch }),
        }
      );
      if (patchRes.ok) {
        cachedGistPayload = (await patchRes.json()) as GistApiResponse;
        cachedManifest = disc.manifest;
        saveCloudConfig({
          lastEtag: patchRes.headers.get('ETag') || '',
          lastSyncedAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }

  const merged = mergeCityLists(
    listLocalCities(session.accountId),
    Object.values(accBlock.cities || {})
  );
  saveLocalIndex(session.accountId, merged);

  const updatedSession: AuthSessionData = {
    ...session,
    token: `gist.${session.accountId}`,
  };
  saveAuthSession(updatedSession);

  const cfg = getCloudConfig();
  return {
    ok: true,
    githubLogin: cfg.githubLogin,
    gistId: cfg.gistId,
    cities: merged,
  };
}

export async function fetchCloudCitySummaries(
  session: AuthSessionData
): Promise<CloudCitySummary[] | null> {
  await hydrateEmergencyWalIfAny();
  const pat = getCloudConfig().pat;
  if (!pat) return listLocalCities(session.accountId);

  const disc = await discoverOrCreateFoxCityGist(pat, false);
  if (!disc.ok || !disc.manifest) return null;

  const remoteCities = Object.values(disc.manifest.accounts[session.accountId]?.cities || {});
  const merged = mergeCityLists(listLocalCities(session.accountId), remoteCities);
  saveLocalIndex(session.accountId, merged);
  return merged;
}

export async function fetchCloudCityFull(
  session: AuthSessionData,
  slotId: string
): Promise<LocalSavedCityRecord | null> {
  const localRec = await loadCityLocally(session.accountId, slotId);
  const pat = getCloudConfig().pat;
  if (!pat) return localRec;

  const disc = await discoverOrCreateFoxCityGist(pat, false);
  if (!disc.ok || !disc.gist || !disc.manifest) return localRec;

  const remMeta = disc.manifest.accounts[session.accountId]?.cities?.[slotId];
  if (!remMeta) return localRec;

  // If local already has equal/newer revision or unsynced offline edits, avoid extra download
  if (localRec && (localRec.dirtyOffline || localRec.serverRev >= remMeta.serverRev)) {
    return localRec;
  }

  const slotFilename = slotGistFilename(session.accountId, slotId);
  let fileDesc = disc.gist.files?.[slotFilename];

  // If cached gist response came from 304 without fresh file body, fetch fresh gist
  if (!fileDesc) {
    const fresh = await discoverOrCreateFoxCityGist(pat, true);
    if (fresh.ok && fresh.gist) {
      fileDesc = fresh.gist.files?.[slotFilename];
    }
  }

  const rawText = await readGistFileText(fileDesc);
  if (!rawText) return localRec;

  try {
    const remoteRec = JSON.parse(rawText) as LocalSavedCityRecord;
    if (remoteRec?.compactState) {
      const cleanRemote: LocalSavedCityRecord = {
        ...remoteRec,
        dirtyOffline: false,
      };
      await saveCityLocally(session.accountId, cleanRemote);
      return cleanRemote;
    }
  } catch {
    // fallback to local
  }
  return localRec;
}

export async function pushCityToCloud(
  session: AuthSessionData,
  record: LocalSavedCityRecord,
  options?: { keepalive?: boolean; forceOverwrite?: boolean }
): Promise<{
  status: 'synced' | 'offline' | 'conflict';
  serverRev?: number;
  serverCity?: LocalSavedCityRecord;
  backupSlotId?: string | null;
  cities?: CloudCitySummary[];
}> {
  const deviceId = getOrCreateDeviceId();
  const dirtyRecord: LocalSavedCityRecord = {
    ...record,
    deviceId,
    dirtyOffline: true,
  };

  if (options?.keepalive) {
    writeEmergencyWalSync(session.accountId, dirtyRecord);
  }
  await saveCityLocally(session.accountId, dirtyRecord);

  const pat = getCloudConfig().pat;
  if (!pat) {
    return { status: 'offline', cities: listLocalCities(session.accountId) };
  }

  return runSerialized(async () => {
    const disc = await discoverOrCreateFoxCityGist(pat, false);
    if (!disc.ok || !disc.gist || !disc.manifest) {
      return { status: 'offline', cities: listLocalCities(session.accountId) };
    }

    const manifest = disc.manifest;
    const localAccounts = loadLocalAccounts();
    const localAcc = localAccounts[session.accountId];

    if (!manifest.accounts[session.accountId]) {
      const salt = localAcc?.salt || `${Date.now().toString(36)}-auto`;
      manifest.accounts[session.accountId] = {
        mayorName: session.mayorName,
        salt,
        passHash: localAcc?.passHash || sha256Hex(`${salt}:foxcity`),
        createdAt: localAcc?.createdAt || new Date().toISOString(),
        cities: {},
      };
    }

    const accBlock = manifest.accounts[session.accountId];
    const remoteMeta = accBlock.cities[record.slotId];

    // Conflict Check: another device saved a strictly newer revision while we were offline
    if (
      remoteMeta &&
      remoteMeta.serverRev > (record.serverRev || 0) &&
      remoteMeta.deviceId !== deviceId &&
      !options?.forceOverwrite
    ) {
      const remoteFile = disc.gist.files?.[slotGistFilename(session.accountId, record.slotId)];
      const remoteText = await readGistFileText(remoteFile);
      if (remoteText) {
        try {
          const remoteFull = JSON.parse(remoteText) as LocalSavedCityRecord;
          // Auto-backup local progress into a separate safe slot so zero work is ever lost
          const backupSlotId = `${record.slotId}-bkp-${Date.now().toString(36).slice(-4)}`;
          const backupRec: LocalSavedCityRecord = {
            ...record,
            slotId: backupSlotId,
            name: `${record.name} (Respaldo Local)`,
            serverRev: 1,
            updatedAt: new Date().toISOString(),
            deviceId,
            dirtyOffline: false,
          };
          await saveCityLocally(session.accountId, backupRec);
          const { compactState: _cs, dirtyOffline: _do, ...bkpSummary } = backupRec;
          accBlock.cities[backupSlotId] = bkpSummary;
          manifest.updatedAt = new Date().toISOString();

          await fetch(`https://api.github.com/gists/${encodeURIComponent(disc.gist.id)}`, {
            method: 'PATCH',
            headers: githubHeaders(pat, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              files: {
                [MANIFEST_FILENAME]: { content: JSON.stringify(manifest, null, 2) },
                [slotGistFilename(session.accountId, backupSlotId)]: {
                  content: JSON.stringify(backupRec),
                },
              },
            }),
          }).catch(() => undefined);

          const merged = mergeCityLists(
            listLocalCities(session.accountId),
            Object.values(accBlock.cities)
          );
          saveLocalIndex(session.accountId, merged);

          return {
            status: 'conflict',
            serverCity: remoteFull,
            backupSlotId,
            cities: merged,
          };
        } catch {
          // proceed if remote file unreadable
        }
      }
    }

    const nextRev = Math.max(record.serverRev || 0, remoteMeta?.serverRev || 0) + 1;
    const nowIso = new Date().toISOString();
    const syncedRecord: LocalSavedCityRecord = {
      ...record,
      serverRev: nextRev,
      updatedAt: nowIso,
      deviceId,
      dirtyOffline: false,
    };

    const { compactState: _cs, dirtyOffline: _do, ...summary } = syncedRecord;
    accBlock.cities[record.slotId] = summary;
    manifest.updatedAt = nowIso;

    const patchBody = JSON.stringify({
      files: {
        [MANIFEST_FILENAME]: {
          content: JSON.stringify(manifest, null, 2),
        },
        [slotGistFilename(session.accountId, record.slotId)]: {
          content: JSON.stringify(syncedRecord),
        },
      },
    });

    // Guard hard 64 KiB WebKit/Chromium fetch keepalive ceiling
    const byteLength = new TextEncoder().encode(patchBody).byteLength;
    const safeKeepalive = Boolean(options?.keepalive) && byteLength < 60000;

    try {
      const res = await fetch(
        `https://api.github.com/gists/${encodeURIComponent(disc.gist.id)}`,
        {
          method: 'PATCH',
          keepalive: safeKeepalive,
          headers: githubHeaders(pat, { 'Content-Type': 'application/json' }),
          body: patchBody,
        }
      );

      if (res.ok) {
        const updatedGist = (await res.json()) as GistApiResponse;
        const etag = res.headers.get('ETag') || '';
        cachedGistPayload = updatedGist;
        cachedManifest = manifest;
        saveCloudConfig({
          lastEtag: etag,
          lastSyncedAt: nowIso,
        });

        await saveCityLocally(session.accountId, syncedRecord);
        const merged = mergeCityLists(
          listLocalCities(session.accountId),
          Object.values(accBlock.cities)
        );
        saveLocalIndex(session.accountId, merged);

        return {
          status: 'synced',
          serverRev: nextRev,
          cities: merged,
        };
      }
    } catch {
      // remains marked dirty in IndexedDB + dirty_slots for automatic flush on resume
    }

    return { status: 'offline', cities: listLocalCities(session.accountId) };
  });
}

export async function flushPendingDirtySlots(session: AuthSessionData): Promise<void> {
  if (!getCloudConfig().pat) return;
  const dirtySlotIds = hasDirtySlotsForAccount(session.accountId);
  for (const slotId of dirtySlotIds) {
    const rec = await loadCityLocally(session.accountId, slotId);
    if (rec && rec.dirtyOffline) {
      await pushCityToCloud(session, rec);
    } else {
      markSlotDirty(session.accountId, slotId, false);
    }
  }
}

export async function deleteCityEverywhere(
  session: AuthSessionData,
  slotId: string
): Promise<CloudCitySummary[]> {
  await removeCityLocally(session.accountId, slotId);

  const pat = getCloudConfig().pat;
  if (pat) {
    await runSerialized(async () => {
      const disc = await discoverOrCreateFoxCityGist(pat, false);
      if (disc.ok && disc.gist && disc.manifest) {
        const accBlock = disc.manifest.accounts[session.accountId];
        if (accBlock?.cities?.[slotId]) {
          delete accBlock.cities[slotId];
          disc.manifest.updatedAt = new Date().toISOString();
          try {
            const res = await fetch(
              `https://api.github.com/gists/${encodeURIComponent(disc.gist.id)}`,
              {
                method: 'PATCH',
                headers: githubHeaders(pat, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                  files: {
                    [MANIFEST_FILENAME]: {
                      content: JSON.stringify(disc.manifest, null, 2),
                    },
                    [slotGistFilename(session.accountId, slotId)]: null,
                  },
                }),
              }
            );
            if (res.ok) {
              cachedGistPayload = (await res.json()) as GistApiResponse;
              cachedManifest = disc.manifest;
              saveCloudConfig({
                lastEtag: res.headers.get('ETag') || '',
                lastSyncedAt: new Date().toISOString(),
              });
            }
          } catch {
            // ignore
          }
        }
      }
    });
  }

  return listLocalCities(session.accountId);
}

// --- Universal JSON Backup Export & Import (Works 100% with or without GitHub Token) ---
export async function exportAccountBackupJson(session: AuthSessionData): Promise<void> {
  const summaries = listLocalCities(session.accountId);
  const fullRecords: LocalSavedCityRecord[] = [];

  for (const sum of summaries) {
    const full = await fetchCloudCityFull(session, sum.slotId);
    if (full) {
      fullRecords.push({ ...full, dirtyOffline: false });
    }
  }

  const payload: BackupBundleV2 = {
    app: 'fox-city-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    accountId: session.accountId,
    mayorName: session.mayorName,
    cities: fullRecords,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fox-city-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importAccountBackupJson(
  session: AuthSessionData,
  jsonText: string
): Promise<{ ok: boolean; importedCount: number; cities: CloudCitySummary[]; error?: string }> {
  try {
    const parsed = JSON.parse(jsonText);
    const incoming: LocalSavedCityRecord[] = Array.isArray(parsed?.cities)
      ? parsed.cities
      : parsed?.compactState && parsed?.slotId
      ? [parsed as LocalSavedCityRecord]
      : [];

    if (incoming.length === 0) {
      return {
        ok: false,
        importedCount: 0,
        cities: listLocalCities(session.accountId),
        error: 'El archivo JSON no contiene ciudades válidas de Fox City.',
      };
    }

    for (const item of incoming) {
      if (!item?.slotId || !item?.compactState) continue;
      const rec: LocalSavedCityRecord = {
        ...item,
        dirtyOffline: true,
        updatedAt: new Date().toISOString(),
      };
      await saveCityLocally(session.accountId, rec);
      if (isGitHubCloudEnabled()) {
        await pushCityToCloud(session, rec, { forceOverwrite: true });
      }
    }

    return {
      ok: true,
      importedCount: incoming.length,
      cities: listLocalCities(session.accountId),
    };
  } catch {
    return {
      ok: false,
      importedCount: 0,
      cities: listLocalCities(session.accountId),
      error: 'Archivo JSON inválido o corrupto.',
    };
  }
}
