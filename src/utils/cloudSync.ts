import { CloudCitySummary, MapArchetypeId } from '../types/game';

const SESSION_KEY = 'fox_city_auth_session_v1';
const DEVICE_KEY = 'fox_city_device_id_v1';
const LOCAL_INDEX_PREFIX = 'fox_city_index_';
const LOCAL_SLOT_PREFIX = 'fox_city_slot_';

export interface AuthSessionData {
  token: string;
  accountId: string;
  mayorName: string;
}

export interface LocalSavedCityRecord extends CloudCitySummary {
  compactState: string;
  dirtyOffline?: boolean;
}

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
    if (parsed?.token && parsed?.accountId) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export function saveAuthSession(session: AuthSessionData) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearAuthSession() {
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

function saveLocalIndex(accountId: string, list: CloudCitySummary[]) {
  try {
    localStorage.setItem(`${LOCAL_INDEX_PREFIX}${accountId}`, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function saveCityLocally(accountId: string, record: LocalSavedCityRecord) {
  try {
    localStorage.setItem(`${LOCAL_SLOT_PREFIX}${accountId}_${record.slotId}`, JSON.stringify(record));
    const index = listLocalCities(accountId).filter((c) => c.slotId !== record.slotId);
    const { compactState: _cs, dirtyOffline: _do, ...summary } = record;
    index.unshift(summary);
    saveLocalIndex(accountId, index.slice(0, 8));
  } catch (err) {
    console.warn('[FoxCity Sync] Local save warning:', err);
  }
}

export function loadCityLocally(accountId: string, slotId: string): LocalSavedCityRecord | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_SLOT_PREFIX}${accountId}_${slotId}`);
    if (!raw) return null;
    return JSON.parse(raw) as LocalSavedCityRecord;
  } catch {
    return null;
  }
}

export function removeCityLocally(accountId: string, slotId: string) {
  try {
    localStorage.removeItem(`${LOCAL_SLOT_PREFIX}${accountId}_${slotId}`);
    const filtered = listLocalCities(accountId).filter((c) => c.slotId !== slotId);
    saveLocalIndex(accountId, filtered);
  } catch {
    // ignore
  }
}

export async function authenticateWithServer(
  mayorName: string,
  password: string
): Promise<{
  ok: boolean;
  offlineFallback?: boolean;
  session: AuthSessionData;
  cities: CloudCitySummary[];
  error?: string;
}> {
  const cleanMayor = mayorName.trim() || 'Alcalde Principal';
  const cleanPass = password.trim();

  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mayorName: cleanMayor, password: cleanPass }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        session: { token: '', accountId: '', mayorName: cleanMayor },
        cities: [],
        error: data?.error || 'Error de autenticación.',
      };
    }

    const session: AuthSessionData = {
      token: data.token,
      accountId: data.accountId,
      mayorName: data.mayorName,
    };
    saveAuthSession(session);

    const merged = mergeCityLists(listLocalCities(session.accountId), data.cities || []);
    saveLocalIndex(session.accountId, merged);

    return {
      ok: true,
      session,
      cities: merged,
    };
  } catch {
    // Offline fallback so PWA still opens seamlessly without internet
    const fallbackId = `local-${btoa(unescape(encodeURIComponent(`${cleanMayor}:${cleanPass}`))).slice(0, 16)}`;
    const session: AuthSessionData = {
      token: `offline.${fallbackId}`,
      accountId: fallbackId,
      mayorName: cleanMayor,
    };
    saveAuthSession(session);
    return {
      ok: true,
      offlineFallback: true,
      session,
      cities: listLocalCities(fallbackId),
    };
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

export async function fetchCloudCitySummaries(
  session: AuthSessionData
): Promise<CloudCitySummary[] | null> {
  if (session.token.startsWith('offline.')) return null;
  try {
    const res = await fetch('/api/cities', {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && Array.isArray(data.cities)) {
      const merged = mergeCityLists(listLocalCities(session.accountId), data.cities);
      saveLocalIndex(session.accountId, merged);
      return merged;
    }
  } catch {
    // network unavailable
  }
  return null;
}

export async function fetchCloudCityFull(
  session: AuthSessionData,
  slotId: string
): Promise<LocalSavedCityRecord | null> {
  const localRec = loadCityLocally(session.accountId, slotId);
  if (session.token.startsWith('offline.')) return localRec;

  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(slotId)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return localRec;
    const data = await res.json();
    if (data?.ok && data.city) {
      const remote = data.city as LocalSavedCityRecord;
      if (!localRec || !localRec.dirtyOffline || remote.serverRev >= localRec.serverRev) {
        const cleanRemote: LocalSavedCityRecord = { ...remote, dirtyOffline: false };
        saveCityLocally(session.accountId, cleanRemote);
        return cleanRemote;
      }
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

  // Always save locally immediately first
  saveCityLocally(session.accountId, { ...record, deviceId, dirtyOffline: true });

  if (session.token.startsWith('offline.')) {
    return { status: 'offline' };
  }

  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(record.slotId)}/sync`, {
      method: 'POST',
      keepalive: Boolean(options?.keepalive),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        token: session.token,
        baseRev: record.serverRev || 0,
        deviceId,
        forceOverwrite: Boolean(options?.forceOverwrite),
        city: record,
      }),
    });

    const data = await res.json();

    if (res.status === 409 && data?.conflict) {
      return {
        status: 'conflict',
        serverCity: data.serverCity,
        backupSlotId: data.backupSlotId,
        cities: data.cities,
      };
    }

    if (res.ok && data?.ok) {
      const updated: LocalSavedCityRecord = {
        ...record,
        serverRev: data.serverRev,
        updatedAt: data.updatedAt || new Date().toISOString(),
        deviceId,
        dirtyOffline: false,
      };
      saveCityLocally(session.accountId, updated);
      return {
        status: 'synced',
        serverRev: data.serverRev,
        cities: data.cities,
      };
    }
  } catch {
    // stays safe in localStorage with dirtyOffline = true
  }

  return { status: 'offline' };
}

export async function deleteCityEverywhere(
  session: AuthSessionData,
  slotId: string
): Promise<CloudCitySummary[]> {
  removeCityLocally(session.accountId, slotId);
  if (!session.token.startsWith('offline.')) {
    try {
      const res = await fetch(`/api/cities/${encodeURIComponent(slotId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.cities)) {
        saveLocalIndex(session.accountId, data.cities);
        return data.cities;
      }
    } catch {
      // ignore
    }
  }
  return listLocalCities(session.accountId);
}
