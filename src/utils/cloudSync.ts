import { CloudCitySummary, MapArchetypeId } from '../types/game';

const CLOUD_API_BASE = 'https://huellas-api-live.onrender.com/api/foxcity';
const DEFAULT_ACCOUNT_ID = 'acc_raydel';
const DEFAULT_MAYOR_NAME = 'Raydel';
const EXPECTED_UI_GATE_HASH =
  '0efc70c8fe77f1f313045ff26e75f71c15e459452cc4b9ff8aaf68f2f66d20bf';

const SESSION_KEY = 'foxcity:auth_session_v2';
const DEVICE_KEY = 'foxcity:device_id_v1';
const LOCAL_INDEX_PREFIX = 'foxcity:index:';
const DIRTY_SLOTS_KEY = 'foxcity:dirty_slots_v1';
const WAL_LATEST_KEY = 'foxcity:wal_latest_v1';
const LAST_SYNC_AT_KEY = 'foxcity:last_cloud_sync_at_v1';

const IDB_NAME = 'foxcity_idb_v1';
const IDB_STORE = 'city_slots';

// Purge legacy PAT/Gist configuration keys if any existed from an earlier build
try {
  localStorage.removeItem('foxcity:cloud_cfg_v1');
} catch {
  // ignore
}

export interface AuthSessionData {
  token: string;
  accountId: string;
  mayorName: string;
}

export interface LocalSavedCityRecord extends CloudCitySummary {
  compactState: string;
  dirtyOffline?: boolean;
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

export function getLastCloudSyncTime(): string {
  try {
    return localStorage.getItem(LAST_SYNC_AT_KEY) || '';
  } catch {
    return '';
  }
}

function setLastCloudSyncTime(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNC_AT_KEY, iso);
  } catch {
    // ignore
  }
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
    if (
      parsed &&
      typeof parsed.token === 'string' &&
      parsed.token.startsWith('rpc.') &&
      parsed.token.length === 68 &&
      parsed.accountId
    ) {
      return parsed as AuthSessionData;
    }
    // Invalidate legacy gist.*/local.* session once so user unlocks cleanly with admin123
    localStorage.removeItem(SESSION_KEY);
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
  return await idbGetRecord(key);
}

export async function removeCityLocally(accountId: string, slotId: string): Promise<void> {
  await idbDeleteRecord(idbRecordKey(accountId, slotId));
  markSlotDirty(accountId, slotId, false);
  const filtered = listLocalCities(accountId).filter((c) => c.slotId !== slotId);
  saveLocalIndex(accountId, filtered);
}

// --- Serialized Push Queue so rapid edits never overlap cloud calls ---
let pushQueueChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = pushQueueChain.then(fn, fn);
  pushQueueChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function prewarmCloudGateway(): void {
  try {
    void fetch(`${CLOUD_API_BASE}/health`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}

function extractRpcKey(session: AuthSessionData): string {
  return session.token.startsWith('rpc.') ? session.token.slice(4) : '';
}

async function postFoxCityRpc<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: { keepalive?: boolean; timeoutMs?: number }
): Promise<{ status: number; data: T | null }> {
  const bodyStr = JSON.stringify(payload);
  const byteLen = new TextEncoder().encode(bodyStr).byteLength;
  const safeKeepalive = Boolean(options?.keepalive) && byteLen < 60000;

  const controller = typeof AbortController !== 'undefined' && !safeKeepalive
    ? new AbortController()
    : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), options?.timeoutMs ?? 35000)
    : null;

  try {
    // CORS Simple Request (text/plain, NO Authorization header) skips preflight OPTIONS on iOS pagehide
    const res = await fetch(`${CLOUD_API_BASE}${endpoint}`, {
      method: 'POST',
      mode: 'cors',
      keepalive: safeKeepalive,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: bodyStr,
      ...(controller ? { signal: controller.signal } : {}),
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function authenticateWithServer(password: string): Promise<{
  ok: boolean;
  session: AuthSessionData;
  cities: CloudCitySummary[];
  error?: string;
}> {
  await hydrateEmergencyWalIfAny();
  const cleanPass = password.trim().toLowerCase();

  if (sha256Hex(`foxcity_ui_gate_v1:${cleanPass}`) !== EXPECTED_UI_GATE_HASH) {
    return {
      ok: false,
      session: { token: '', accountId: DEFAULT_ACCOUNT_ID, mayorName: DEFAULT_MAYOR_NAME },
      cities: [],
      error: 'Contraseña incorrecta.',
    };
  }

  const rpcKey = sha256Hex(`foxcity_cloud_rpc_v1:${cleanPass}`);
  const session: AuthSessionData = {
    token: `rpc.${rpcKey}`,
    accountId: DEFAULT_ACCOUNT_ID,
    mayorName: DEFAULT_MAYOR_NAME,
  };
  saveAuthSession(session);

  return {
    ok: true,
    session,
    cities: listLocalCities(DEFAULT_ACCOUNT_ID),
  };
}

export async function reconcileWithRemoteCities(
  accountId: string,
  remoteList: CloudCitySummary[]
): Promise<CloudCitySummary[]> {
  const localList = listLocalCities(accountId);
  const dirtySet = new Set(hasDirtySlotsForAccount(accountId));
  const remoteMap = new Map(remoteList.map((r) => [r.slotId, r]));
  const merged = new Map<string, CloudCitySummary>();

  for (const loc of localList) {
    if (!remoteMap.has(loc.slotId)) {
      if ((loc.serverRev || 0) === 0 || dirtySet.has(loc.slotId)) {
        merged.set(loc.slotId, loc);
      } else {
        await removeCityLocally(accountId, loc.slotId);
      }
    } else {
      merged.set(loc.slotId, loc);
    }
  }

  for (const r of remoteList) {
    const loc = merged.get(r.slotId);
    if (!loc || (!dirtySet.has(r.slotId) && r.serverRev >= (loc.serverRev || 0))) {
      merged.set(r.slotId, { ...r, mapId: r.mapId as MapArchetypeId });
    }
  }

  const sorted = Array.from(merged.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  saveLocalIndex(accountId, sorted);
  setLastCloudSyncTime(new Date().toISOString());
  return sorted;
}

export async function fetchCloudCitySummaries(
  session: AuthSessionData
): Promise<CloudCitySummary[] | null> {
  await hydrateEmergencyWalIfAny();
  const rpcKey = extractRpcKey(session);
  if (!rpcKey) return null;

  const { status, data } = await postFoxCityRpc<{
    ok?: boolean;
    cities?: CloudCitySummary[];
  }>('/list', {
    rpcKey,
    accountId: session.accountId,
  });

  if (status === 200 && data?.ok && Array.isArray(data.cities)) {
    return await reconcileWithRemoteCities(session.accountId, data.cities);
  }
  return null;
}

export async function fetchCloudCityFull(
  session: AuthSessionData,
  slotId: string
): Promise<LocalSavedCityRecord | null> {
  const localRec = await loadCityLocally(session.accountId, slotId);
  const rpcKey = extractRpcKey(session);
  if (!rpcKey) return localRec;

  const { status, data } = await postFoxCityRpc<{
    ok?: boolean;
    city?: LocalSavedCityRecord | null;
  }>('/get', {
    rpcKey,
    accountId: session.accountId,
    slotId,
  });

  if (status === 200 && data?.ok && data.city) {
    const remote = data.city;
    if (!localRec || (!localRec.dirtyOffline && remote.serverRev >= (localRec.serverRev || 0))) {
      const cleanRemote: LocalSavedCityRecord = {
        ...remote,
        dirtyOffline: false,
      };
      await saveCityLocally(session.accountId, cleanRemote);
      setLastCloudSyncTime(new Date().toISOString());
      return cleanRemote;
    }
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

  const rpcKey = extractRpcKey(session);
  if (!rpcKey) {
    return { status: 'offline', cities: listLocalCities(session.accountId) };
  }

  return runSerialized(async () => {
    const { status, data } = await postFoxCityRpc<{
      ok?: boolean;
      conflict?: boolean;
      serverRev?: number;
      updatedAt?: string;
      serverCity?: LocalSavedCityRecord;
      backupSlotId?: string | null;
      cities?: CloudCitySummary[];
    }>(
      '/sync',
      {
        rpcKey,
        accountId: session.accountId,
        slotId: record.slotId,
        baseRev: record.serverRev || 0,
        deviceId,
        forceOverwrite: Boolean(options?.forceOverwrite),
        city: record,
      },
      { keepalive: options?.keepalive }
    );

    if (status === 409 && data?.conflict && data.serverCity) {
      const reconciled = data.cities
        ? await reconcileWithRemoteCities(session.accountId, data.cities)
        : listLocalCities(session.accountId);
      return {
        status: 'conflict',
        serverCity: data.serverCity,
        backupSlotId: data.backupSlotId,
        cities: reconciled,
      };
    }

    if (status === 200 && data?.ok) {
      const syncedRec: LocalSavedCityRecord = {
        ...record,
        serverRev: data.serverRev ?? (record.serverRev || 0) + 1,
        updatedAt: data.updatedAt || new Date().toISOString(),
        deviceId,
        dirtyOffline: false,
      };
      await saveCityLocally(session.accountId, syncedRec);
      const reconciled = data.cities
        ? await reconcileWithRemoteCities(session.accountId, data.cities)
        : listLocalCities(session.accountId);
      setLastCloudSyncTime(new Date().toISOString());
      return {
        status: 'synced',
        serverRev: syncedRec.serverRev,
        cities: reconciled,
      };
    }

    return { status: 'offline', cities: listLocalCities(session.accountId) };
  });
}

export async function flushPendingDirtySlots(session: AuthSessionData): Promise<void> {
  if (!extractRpcKey(session)) return;
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
  const rpcKey = extractRpcKey(session);
  if (rpcKey) {
    await runSerialized(async () => {
      const { status, data } = await postFoxCityRpc<{
        ok?: boolean;
        cities?: CloudCitySummary[];
      }>('/delete', {
        rpcKey,
        accountId: session.accountId,
        slotId,
      });
      if (status === 200 && data?.ok && Array.isArray(data.cities)) {
        await reconcileWithRemoteCities(session.accountId, data.cities);
      }
    });
  }
  return listLocalCities(session.accountId);
}

// --- Universal JSON Backup Export & Import ---
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
      await pushCityToCloud(session, rec, { forceOverwrite: true });
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
