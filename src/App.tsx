import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Bus,
  Check,
  Cloud,
  Compass,
  DollarSign,
  Droplets,
  Eye,
  Flame,
  FolderOpen,
  Grid,
  Hand,
  Landmark,
  Layers,
  LogOut,
  MessageSquare,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Shield,
  Sun,
  TrainFront,
  Trash2,
  Trees,
  Undo2,
  Volume2,
  VolumeX,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { soundFX } from './audio/soundEngine';
import { CloudSyncModal } from './components/CloudSyncModal';
import { PrivateAccess } from './components/PrivateAccess';
import {
  BUILDING_SPECS,
  CITY_MILESTONES,
  DISASTER_CATALOG,
  MAP_ARCHETYPES,
  ROAD_CATALOG,
  ZONE_CATALOG,
} from './config/catalog';
import { CellInspectInfo, CityEngine } from './engine/cityEngine';
import { CityViewport3D, PendingMobilePlacement } from './renderer/CityViewport3D';
import {
  CityHudSnapshot,
  CloudCitySummary,
  InfoOverlayMode,
  MapArchetypeId,
  RoadTier,
  SpecialBuildingId,
  ToolMode,
  ZoneKind,
} from './types/game';
import {
  AuthSessionData,
  authenticateWithServer,
  clearAuthSession,
  deleteCityEverywhere,
  fetchCloudCityFull,
  fetchCloudCitySummaries,
  flushPendingDirtySlots,
  getOrCreateDeviceId,
  hydrateEmergencyWalIfAny,
  listLocalCities,
  LocalSavedCityRecord,
  loadSavedSession,
  pushCityToCloud,
  saveCityLocally,
  writeEmergencyWalSync,
} from './utils/cloudSync';

const FALLBACK_BUILD_TIMESTAMP = '5:17 PM - 11/12/2026';
const BUILD_TS =
  typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : FALLBACK_BUILD_TIMESTAMP;

type BuildCategoryTab =
  | 'none'
  | 'roads'
  | 'zones'
  | 'utilities'
  | 'services'
  | 'transit'
  | 'monuments';

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSessionData | null>(() => loadSavedSession());
  const [cities, setCities] = useState<CloudCitySummary[]>(() => {
    const s = loadSavedSession();
    return s ? listLocalCities(s.accountId) : [];
  });

  // City Hub vs Active 3D Game
  const [inHub, setInHub] = useState(true);
  const [newCityName, setNewCityName] = useState('Nueva Fox City');
  const [selectedMap, setSelectedMap] = useState<MapArchetypeId>('emerald_bay');
  const [newSandbox, setNewSandbox] = useState(false);

  const engineRef = useRef<CityEngine | null>(null);
  const activeRevRef = useRef<number>(0);
  const [hud, setHud] = useState<CityHudSnapshot | null>(null);

  const [tool, setTool] = useState<ToolMode>({ kind: 'pan' });
  const [activeTab, setActiveTab] = useState<BuildCategoryTab>('none');
  const [overlay, setOverlay] = useState<InfoOverlayMode>('normal');
  const [buildingRotation, setBuildingRotation] = useState<0 | 1 | 2 | 3>(0);
  const [pendingPlacement, setPendingPlacement] = useState<PendingMobilePlacement | null>(null);

  const [inspectInfo, setInspectInfo] = useState<CellInspectInfo | null>(null);
  const [showTileModal, setShowTileModal] = useState(false);
  const [showEconomyModal, setShowEconomyModal] = useState(false);
  const [showDisasterModal, setShowDisasterModal] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showChirps, setShowChirps] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [muted, setMuted] = useState(false);

  const [syncState, setSyncState] = useState<'synced' | 'saving' | 'offline' | 'conflict'>('synced');
  const debouncePushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [conflictData, setConflictData] = useState<{
    serverCity: LocalSavedCityRecord;
    backupSlotId?: string | null;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'warn' | 'ok' } | null>(null);

  const showToast = useCallback((text: string, tone: 'info' | 'warn' | 'ok' = 'info') => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // Refresh cloud city list & flush any pending offline slots when session is active
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const runInitialCloudSync = async (allowRetry: boolean) => {
      await hydrateEmergencyWalIfAny();
      const remote = await fetchCloudCitySummaries(session);
      if (cancelled) return;
      if (remote) {
        setCities(remote);
        await flushPendingDirtySlots(session);
        const refreshed = await fetchCloudCitySummaries(session);
        if (cancelled) return;
        if (refreshed) setCities(refreshed);
        setSyncState('synced');
      } else {
        setSyncState('offline');
        if (allowRetry) {
          retryTimer = setTimeout(() => {
            void runInitialCloudSync(false);
          }, 12000);
        }
      }
    };

    void runInitialCloudSync(true);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [session]);

  const refreshHud = useCallback(() => {
    if (engineRef.current) {
      setHud(engineRef.current.getHudSnapshot());
    }
  }, []);

  // Build LocalSavedCityRecord from current engine
  const buildSaveRecord = useCallback((): LocalSavedCityRecord | null => {
    const eng = engineRef.current;
    if (!eng) return null;
    return {
      slotId: eng.cityId,
      name: eng.cityName,
      mapId: eng.mapId,
      seed: eng.seed,
      sandboxMode: eng.sandboxMode,
      population: eng.population,
      money: eng.money,
      happiness: eng.happiness,
      day: eng.day,
      serverRev: activeRevRef.current,
      updatedAt: new Date().toISOString(),
      deviceId: getOrCreateDeviceId(),
      compactState: eng.exportCompactState(),
    };
  }, []);

  const syncNow = useCallback(
    async (opts?: { keepalive?: boolean; forceOverwrite?: boolean }) => {
      if (!session || !engineRef.current) return;
      const rec = buildSaveRecord();
      if (!rec) return;

      setSyncState('saving');
      const res = await pushCityToCloud(session, rec, opts);
      if (res.status === 'synced') {
        activeRevRef.current = res.serverRev ?? activeRevRef.current;
        engineRef.current.dirtySync = false;
        setSyncState('synced');
        if (res.cities) setCities(res.cities);
      } else if (res.status === 'conflict' && res.serverCity) {
        setSyncState('conflict');
        setConflictData({
          serverCity: res.serverCity,
          backupSlotId: res.backupSlotId,
        });
        if (res.cities) setCities(res.cities);
      } else {
        setSyncState('offline');
      }
    },
    [buildSaveRecord, session]
  );

  // Simulation Clock Loop (Fixed amortized step independent of 60fps Three.js loop)
  useEffect(() => {
    if (inHub || !engineRef.current) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const eng = engineRef.current;
      if (!eng || eng.simSpeed === 0) return;
      const steps = eng.simSpeed === 4 ? 3 : eng.simSpeed === 2 ? 2 : 1;
      for (let i = 0; i < steps; i++) {
        eng.stepSimulationTick();
      }
      setHud(eng.getHudSnapshot());
    }, 320);

    return () => clearInterval(timer);
  }, [inHub]);

  // Periodic Auto-Sync + iOS Safari pagehide / visibilitychange protection + Auto-Pull on Focus
  useEffect(() => {
    if (!session || inHub) return;

    const periodic = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (engineRef.current?.dirtySync) {
        void syncNow();
      }
    }, 12000);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (debouncePushRef.current) {
          clearTimeout(debouncePushRef.current);
          debouncePushRef.current = null;
        }
        const rec = buildSaveRecord();
        if (rec) {
          writeEmergencyWalSync(session.accountId, { ...rec, dirtyOffline: true });
        }
        void syncNow({ keepalive: true });
      } else if (document.visibilityState === 'visible') {
        void flushPendingDirtySlots(session);
        if (engineRef.current && !engineRef.current.dirtySync) {
          // Check if another device saved newer progress while this tab was sleeping
          const curId = engineRef.current.cityId;
          void fetchCloudCityFull(session, curId).then((latest) => {
            if (latest && latest.serverRev > activeRevRef.current) {
              engineRef.current = CityEngine.fromCompactState(latest.compactState);
              activeRevRef.current = latest.serverRev;
              refreshHud();
              showToast('☁️ Ciudad actualizada automáticamente desde otro dispositivo', 'ok');
            }
          });
        }
      }
    };

    const onPageHide = () => {
      const rec = buildSaveRecord();
      if (rec) {
        writeEmergencyWalSync(session.accountId, { ...rec, dirtyOffline: true });
      }
      void syncNow({ keepalive: true });
    };

    const onOnline = () => {
      void flushPendingDirtySlots(session).then(() => {
        if (engineRef.current?.dirtySync) {
          void syncNow();
        }
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
    };
  }, [buildSaveRecord, inHub, refreshHud, session, showToast, syncNow]);

  const handleUnlock = async (password: string) => {
    const clean = password.trim();
    if (clean.length < 2) {
      return { ok: false, error: 'La contraseña debe tener al menos 2 caracteres.' };
    }
    const res = await authenticateWithServer(clean);
    if (!res.ok) return { ok: false, error: res.error };

    setSession(res.session);
    setCities(res.cities);
    setSyncState('synced');
    setInHub(true);
    return { ok: true };
  };

  const startNewCity = async () => {
    if (!session) return;
    const mapCfg = MAP_ARCHETYPES.find((m) => m.id === selectedMap) || MAP_ARCHETYPES[0];
    const seed = mapCfg.defaultSeed + Math.floor(Math.random() * 900);
    const eng = new CityEngine({
      cityId: `fox-${Date.now().toString(36)}`,
      cityName: newCityName.trim() || 'Fox City',
      mapId: selectedMap,
      seed,
      sandboxMode: newSandbox,
    });
    engineRef.current = eng;
    activeRevRef.current = 0;
    setHud(eng.getHudSnapshot());
    setTool({ kind: 'pan' });
    setActiveTab('none');
    setOverlay('normal');
    setInHub(false);
    soundFX.unlock();
    void syncNow();
  };

  const openSavedCity = async (slotId: string) => {
    if (!session) return;
    soundFX.unlock();
    const full = await fetchCloudCityFull(session, slotId);
    if (!full) {
      showToast('No se pudo abrir la ciudad seleccionada.', 'warn');
      return;
    }
    try {
      const eng = CityEngine.fromCompactState(full.compactState);
      engineRef.current = eng;
      activeRevRef.current = full.serverRev || 0;
      setHud(eng.getHudSnapshot());
      setTool({ kind: 'pan' });
      setActiveTab('none');
      setOverlay('normal');
      setInHub(false);
      setSyncState('synced');
    } catch {
      showToast('El archivo de la ciudad estaba corrupto.', 'warn');
    }
  };

  const handleAfterMutate = useCallback(() => {
    refreshHud();
    if (session && engineRef.current) {
      const rec = buildSaveRecord();
      if (rec) {
        // Instant local IndexedDB persistence (0 network stall) + debounced automatic cloud sync
        void saveCityLocally(session.accountId, { ...rec, dirtyOffline: true }).then(() => {
          setCities(listLocalCities(session.accountId));
        });
        if (debouncePushRef.current) clearTimeout(debouncePushRef.current);
        const delayMs = window.matchMedia('(pointer: coarse)').matches ? 4000 : 7000;
        debouncePushRef.current = setTimeout(() => {
          debouncePushRef.current = null;
          void syncNow();
        }, delayMs);
      }
    }
  }, [buildSaveRecord, refreshHud, session, syncNow]);

  const selectCategoryTab = (tab: BuildCategoryTab) => {
    soundFX.playClick();
    setPendingPlacement(null);
    if (activeTab === tab) {
      setActiveTab('none');
      setTool({ kind: 'pan' });
    } else {
      setActiveTab(tab);
    }
  };

  const confirmMobileBuilding = () => {
    if (!pendingPlacement || !engineRef.current) return;
    const res = engineRef.current.placeStructure(
      pendingPlacement.buildingId,
      pendingPlacement.x,
      pendingPlacement.z,
      pendingPlacement.rotation
    );
    if (!res.ok && res.reason) {
      showToast(res.reason, 'warn');
    } else {
      setPendingPlacement(null);
      handleAfterMutate();
    }
  };

  const rotateActiveBuilding = useCallback(() => {
    soundFX.playClick();
    setBuildingRotation((prev) => {
      const next = ((prev + 1) % 4) as 0 | 1 | 2 | 3;
      setPendingPlacement((cur) => {
        if (!cur || !engineRef.current) return cur;
        const check = engineRef.current.canPlaceStructure(cur.buildingId, cur.x, cur.z, next);
        return {
          ...cur,
          rotation: next,
          valid: check.ok,
          reason: check.reason,
        };
      });
      return next;
    });
  }, []);

  const formattedClock = useMemo(() => {
    if (!hud) return '10:30';
    const hrs = Math.floor(hud.timeOfDay);
    const mins = Math.floor((hud.timeOfDay - hrs) * 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }, [hud]);

  // 1. Private Access Gate
  if (!session) {
    return <PrivateAccess buildTimestamp={BUILD_TS} onUnlock={handleUnlock} />;
  }

  // 2. Multi-Device Cloud City Hub (Select existing city or Create on 1 of the 4 Maps)
  if (inHub || !engineRef.current || !hud) {
    return (
      <div className="relative w-full h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 sm:p-8">
        <div className="max-w-6xl mx-auto pb-14">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-700 flex items-center justify-center shadow-lg shadow-sky-500/25">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  FOX CITY
                </h1>
                <p className="text-xs sm:text-sm text-sky-300 font-medium flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5" /> Cuenta {session.mayorName} • Sincronización
                  Automática en la Nube Activa
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCloudModal(true)}
                className="px-3.5 py-2 rounded-xl border text-xs font-extrabold flex items-center gap-1.5 cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/50 text-emerald-200"
              >
                <Cloud className="w-3.5 h-3.5" />
                Nube y Respaldo
              </button>

              <button
                type="button"
                onClick={() => {
                  clearAuthSession();
                  setSession(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" /> Cambiar Cuenta
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Saved Cloud Cities Column */}
            <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-extrabold flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-sky-400" /> Tus Ciudades Guardadas
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    void fetchCloudCitySummaries(session).then((r) => {
                      if (r) setCities(r);
                    });
                  }}
                  className="text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                >
                  Actualizar Nube
                </button>
              </div>

              {cities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700/80 p-8 text-center text-slate-400 text-sm">
                  Aún no tienes ciudades creadas. Elige uno de los 4 mapas a la derecha y funda tu
                  primera metrópolis.
                </div>
              ) : (
                <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                  {cities.map((c) => {
                    const mapInfo =
                      MAP_ARCHETYPES.find((m) => m.id === c.mapId) || MAP_ARCHETYPES[0];
                    return (
                      <div
                        key={c.slotId}
                        className="group rounded-2xl bg-slate-950/75 hover:bg-slate-800/80 border border-slate-800 hover:border-sky-500/50 p-4 transition flex items-center justify-between gap-3"
                      >
                        <div
                          onClick={() => void openSavedCity(c.slotId)}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm sm:text-base">
                              {c.name}
                            </span>
                            {c.sandboxMode && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                Sandbox
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {mapInfo.name} • Día {c.day} • Rev #{c.serverRev}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs font-bold">
                            <span className="text-emerald-400">
                              👥 {c.population.toLocaleString()} hab.
                            </span>
                            <span className="text-sky-300">
                              {c.sandboxMode ? '∞ Fondos' : `$${c.money.toLocaleString()}`}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openSavedCity(c.slotId)}
                            className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-xs cursor-pointer"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const next = await deleteCityEverywhere(session, c.slotId);
                              setCities(next);
                            }}
                            title="Eliminar ciudad"
                            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-900/70 text-slate-400 hover:text-rose-200 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Create New City + 4 Selectable Maps Column */}
            <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
              <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2 mb-4">
                <Plus className="w-5 h-5 text-emerald-400" /> Fundar Nueva Metrópolis
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nombre de la Ciudad
                  </label>
                  <input
                    type="text"
                    value={newCityName}
                    onChange={(e) => setNewCityName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Régimen Económico
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewSandbox(false)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        !newSandbox
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Estándar ($120k)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewSandbox(true)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        newSandbox
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Sandbox (Todo Libre)
                    </button>
                  </div>
                </div>
              </div>

              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Selecciona el Territorio Inicial (9 Macro-Parcelas Desbloqueables)
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {MAP_ARCHETYPES.map((m) => {
                  const active = selectedMap === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMap(m.id)}
                      className={`text-left rounded-2xl p-4 border transition cursor-pointer ${
                        active
                          ? 'bg-slate-800/95 border-sky-400 shadow-lg shadow-sky-500/15'
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-extrabold text-sm text-white">{m.name}</span>
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: m.badgeColor }}
                        />
                      </div>
                      <div className="text-[11px] font-bold text-sky-300 mb-1.5">{m.subtitle}</div>
                      <p className="text-xs text-slate-400 leading-relaxed">{m.description}</p>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => void startNewCity()}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-400 hover:to-sky-400 text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/20 transition cursor-pointer"
              >
                Iniciar Construcción en 3D
              </button>
            </div>
          </div>
        </div>

        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-900/95 border border-sky-400/40 text-xs font-bold text-white shadow-2xl">
            {toast.text}
          </div>
        )}

        {showCloudModal && (
          <CloudSyncModal
            session={session}
            onClose={() => setShowCloudModal(false)}
            onCitiesUpdated={(next) => {
              setCities(next);
              setSyncState('synced');
            }}
            onToast={showToast}
          />
        )}

        {/* Global Deployment Verification Timestamp */}
        <div className="fixed bottom-1.5 right-2 z-50 pointer-events-none text-[10px] font-mono text-slate-300/85 bg-slate-950/80 border border-sky-400/20 px-1.5 py-0.5 rounded">
          Actualizado: {BUILD_TS}
        </div>
      </div>
    );
  }

  // 3. Active 3D Skylines Gameplay HUD
  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* 3D City Viewport */}
      <CityViewport3D
        engine={engineRef.current}
        tool={tool}
        overlay={overlay}
        buildingRotation={buildingRotation}
        onRotateBuilding={rotateActiveBuilding}
        showTileGridModal={showTileModal}
        onSelectInspect={(info) => setInspectInfo(info)}
        onToast={showToast}
        onAfterMutate={handleAfterMutate}
        pendingPlacement={pendingPlacement}
        setPendingPlacement={setPendingPlacement}
      />

      {/* TOP HUD BAR */}
      <div
        className="fixed top-0 inset-x-0 z-20 pointer-events-none px-2 sm:px-4 pt-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)' }}
      >
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          {/* Left Pill: Hub Button + City Name + Treasury + Population + RCI Demand */}
          <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 rounded-2xl px-2.5 py-1.5 shadow-xl">
            <button
              type="button"
              onClick={() => {
                void syncNow();
                setInHub(true);
              }}
              title="Volver al menú de ciudades"
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Ciudades</span>
            </button>

            <div className="hidden md:block pr-1 border-r border-slate-800">
              <div className="text-xs font-extrabold text-white leading-tight">{hud.cityName}</div>
              <div className="text-[10px] text-sky-400 font-semibold">{hud.milestoneTitle}</div>
            </div>

            {/* Treasury */}
            <button
              type="button"
              onClick={() => setShowEconomyModal(true)}
              className="px-2 py-1 rounded-xl hover:bg-slate-800/80 text-left transition cursor-pointer"
            >
              <div className="text-xs sm:text-sm font-black text-emerald-400">
                {hud.sandboxMode ? '∞ FOX$' : `$${hud.money.toLocaleString()}`}
              </div>
              <div
                className={`text-[10px] font-bold ${
                  hud.netIncomePerTick >= 0 ? 'text-emerald-300' : 'text-rose-400'
                }`}
              >
                {hud.netIncomePerTick >= 0 ? '+' : ''}
                {hud.netIncomePerTick}/ciclo
              </div>
            </button>

            {/* Population */}
            <div className="px-2 py-1 border-l border-slate-800">
              <div className="text-xs sm:text-sm font-black text-white">
                👥 {hud.population.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold">
                😊 {hud.happiness}%{hud.nextMilestonePop ? ` • Meta ${hud.nextMilestonePop.toLocaleString()}` : ''}
              </div>
            </div>

            {/* Skylines R-C-I Demand Bars */}
            <div
              className="flex items-end gap-1 h-7 px-1.5 py-0.5 rounded-lg bg-slate-900 border border-slate-800"
              title={`Demanda R:${hud.demand.residential}% C:${hud.demand.commercial}% I:${hud.demand.industrial}%`}
            >
              <div className="w-2 h-full bg-slate-800 rounded-sm flex items-end overflow-hidden">
                <div
                  className="w-full bg-emerald-500 transition-all"
                  style={{ height: `${hud.demand.residential}%` }}
                />
              </div>
              <div className="w-2 h-full bg-slate-800 rounded-sm flex items-end overflow-hidden">
                <div
                  className="w-full bg-sky-400 transition-all"
                  style={{ height: `${hud.demand.commercial}%` }}
                />
              </div>
              <div className="w-2 h-full bg-slate-800 rounded-sm flex items-end overflow-hidden">
                <div
                  className="w-full bg-amber-400 transition-all"
                  style={{ height: `${hud.demand.industrial}%` }}
                />
              </div>
            </div>
          </div>

          {/* Right Pill: Speed, Day/Night, Info Overlays, 9-Tiles, Disasters, Sync Badge */}
          <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 rounded-2xl px-2.5 py-1.5 shadow-xl">
            {/* Speed buttons */}
            <div className="flex items-center bg-slate-900 rounded-xl p-0.5 border border-slate-800">
              {([0, 1, 2, 4] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    if (!engineRef.current) return;
                    engineRef.current.simSpeed = sp;
                    refreshHud();
                  }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-extrabold transition cursor-pointer ${
                    hud.simSpeed === sp
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {sp === 0 ? <Pause className="w-3 h-3" /> : `${sp}x`}
                </button>
              ))}
            </div>

            {/* Day/Night toggle */}
            <button
              type="button"
              onClick={() => {
                if (!engineRef.current) return;
                const eng = engineRef.current;
                if (eng.timeOfDay >= 7 && eng.timeOfDay <= 18) {
                  eng.timeOfDay = 21.5;
                  eng.autoDayNight = false;
                } else {
                  eng.timeOfDay = 11.0;
                  eng.autoDayNight = true;
                }
                refreshHud();
              }}
              title="Alternar Día / Noche"
              className="px-2 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              {hud.timeOfDay >= 6.5 && hud.timeOfDay <= 19 ? (
                <Sun className="w-3.5 h-3.5 text-amber-300" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-sky-300" />
              )}
              <span className="hidden sm:inline">
                D{hud.day} {formattedClock}
              </span>
            </button>

            {/* White Analytical Info Views Button */}
            <button
              type="button"
              onClick={() => setShowOverlayMenu((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1 cursor-pointer ${
                overlay !== 'normal'
                  ? 'bg-white text-slate-950 border-white'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
              }`}
              title="Vistas Analíticas Blancas (Info Views)"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {overlay === 'normal' ? 'Vistas' : overlay.toUpperCase()}
              </span>
            </button>

            {/* 9 Macro-Tiles Expansion Button */}
            <button
              type="button"
              onClick={() => setShowTileModal((v) => !v)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Comprar Macro-Parcelas (9 Tiles)"
            >
              <Grid className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden lg:inline">Parcelas</span>
            </button>

            {/* Optional Disasters Button */}
            <button
              type="button"
              onClick={() => setShowDisasterModal(true)}
              className={`p-1.5 rounded-xl border cursor-pointer ${
                hud.activeDisasters.length > 0
                  ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-amber-400'
              }`}
              title="Desastres Opcionales y Simulacros"
            >
              <AlertTriangle className="w-4 h-4" />
            </button>

            {/* Chirper Feed Button */}
            <button
              type="button"
              onClick={() => setShowChirps((v) => !v)}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sky-400 cursor-pointer"
              title="FoxFeed Ciudadano"
            >
              <MessageSquare className="w-4 h-4" />
            </button>

            {/* Audio Mute */}
            <button
              type="button"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                soundFX.setMuted(next);
              }}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
              title="Sonido"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Cloud Sync Status Dot / Open Cloud Modal */}
            <button
              type="button"
              onClick={() => setShowCloudModal(true)}
              title={
                syncState === 'synced'
                  ? 'Sincronizado en la nube (toca para opciones/respaldo)'
                  : syncState === 'saving'
                  ? 'Guardando en la nube...'
                  : syncState === 'conflict'
                  ? 'Conflicto detectado (toca para resolver)'
                  : 'Modo local (reintentando conexión automático)'
              }
              className="px-2 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center gap-1.5 text-[10px] font-bold cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  syncState === 'synced'
                    ? 'bg-emerald-400'
                    : syncState === 'saving'
                    ? 'bg-amber-400 animate-ping'
                    : syncState === 'conflict'
                    ? 'bg-rose-500'
                    : 'bg-sky-400'
                }`}
              />
              <span className="hidden xl:inline">
                {syncState === 'synced' ? 'Nube' : syncState === 'saving' ? '...' : 'Local'}
              </span>
            </button>
          </div>
        </div>

        {/* Skylines White Analytical Info Views Popover */}
        {showOverlayMenu && (
          <div className="pointer-events-auto mt-2 ml-auto max-w-md bg-slate-950/92 backdrop-blur-xl border border-slate-700 rounded-2xl p-3 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-sky-400" /> Vistas Analíticas (Estilo Skylines)
              </span>
              <button
                type="button"
                onClick={() => setShowOverlayMenu(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'normal', label: 'Realista 3D' },
                  { id: 'power', label: `⚡ Luz (${hud.powerConsumedMW}/${hud.powerProducedMW}MW)` },
                  { id: 'water', label: `💧 Agua (${hud.waterConsumedML}/${hud.waterProducedML})` },
                  { id: 'traffic', label: `🚗 Tráfico (${hud.avgTraffic}%)` },
                  { id: 'pollution', label: '🏭 Polución + Viento' },
                  { id: 'land_value', label: `💎 Valor (${hud.avgLandValue})` },
                  { id: 'services', label: '🚓 Cobertura' },
                  { id: 'metro', label: '🚇 Metro Rayos-X' },
                ] as { id: InfoOverlayMode; label: string }[]
              ).map((ov) => (
                <button
                  key={ov.id}
                  type="button"
                  onClick={() => {
                    setOverlay(ov.id);
                    soundFX.playClick();
                  }}
                  className={`px-2.5 py-2 rounded-xl text-[11px] font-bold text-left transition cursor-pointer ${
                    overlay === ov.id
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-200'
                  }`}
                >
                  {ov.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/*Toast Banner */}
      {toast && (
        <div
          className={`fixed top-18 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-2xl text-xs font-extrabold shadow-2xl border backdrop-blur-md ${
            toast.tone === 'warn'
              ? 'bg-rose-950/90 border-rose-500/60 text-rose-200'
              : toast.tone === 'ok'
              ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
              : 'bg-slate-900/90 border-sky-400/50 text-sky-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Citizen Chirper Feed Panel */}
      {showChirps && (
        <div className="fixed top-20 right-3 z-30 w-80 max-w-[calc(100vw-24px)] bg-slate-950/92 backdrop-blur-xl border border-slate-800 rounded-2xl p-3.5 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-extrabold text-sky-400">🐦 FoxFeed Ciudadano</span>
            <button
              type="button"
              onClick={() => setShowChirps(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {hud.chirps.map((ch) => (
              <div
                key={ch.id}
                className="rounded-xl bg-slate-900/90 border border-slate-800 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold text-white">{ch.author}</span>
                  <span className="text-[10px] text-sky-400">{ch.handle}</span>
                </div>
                <p className="text-slate-300 leading-snug">{ch.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cell Inspector Card */}
      {inspectInfo && (
        <div className="fixed top-20 left-3 z-30 w-72 bg-slate-950/92 backdrop-blur-xl border border-slate-700 rounded-2xl p-3.5 shadow-2xl text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-extrabold text-white">
              📍 Parcela ({inspectInfo.x}, {inspectInfo.z})
            </span>
            <button
              type="button"
              onClick={() => setInspectInfo(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1 text-slate-300">
            {inspectInfo.structure && (
              <div className="font-bold text-sky-300">
                🏛️ {BUILDING_SPECS[inspectInfo.structure.buildingId].name}
              </div>
            )}
            {inspectInfo.zone !== ZoneKind.None && (
              <div>
                🏘️ {ZONE_CATALOG[inspectInfo.zone].name} • Nivel {inspectInfo.rciLevel}/5
                {inspectInfo.abandoned ? ' (Abandonado)' : ''}
              </div>
            )}
            {inspectInfo.roadTier !== RoadTier.None && (
              <div>
                🛣️ {ROAD_CATALOG[inspectInfo.roadTier].name}
                {inspectInfo.isBridge ? ' (Puente)' : ''} • Tráfico {inspectInfo.traffic}%
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <span className={inspectInfo.powered ? 'text-emerald-400' : 'text-rose-400'}>
                ⚡ {inspectInfo.powered ? 'Con Luz' : 'Sin Luz'}
              </span>
              <span className={inspectInfo.watered ? 'text-cyan-300' : 'text-rose-400'}>
                💧 {inspectInfo.watered ? 'Con Agua' : 'Sin Agua'}
              </span>
            </div>
            <div>
              💎 Valor Suelo: {inspectInfo.landValue}/100 • 🏭 Polución: {inspectInfo.pollution}%
            </div>
          </div>
        </div>
      )}

      {/* MOBILE FLOATING CONFIRMATION PILL FOR STRUCTURES & MONUMENTS */}
      {pendingPlacement && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-slate-950/95 backdrop-blur-xl border border-sky-400/50 rounded-2xl px-3 py-2 shadow-2xl">
          <div className="pr-2 border-r border-slate-800">
            <div className="text-xs font-extrabold text-white">
              {BUILDING_SPECS[pendingPlacement.buildingId].name}
            </div>
            <div
              className={`text-[11px] font-bold ${
                pendingPlacement.valid ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {pendingPlacement.valid
                ? `$${pendingPlacement.cost.toLocaleString()}`
                : pendingPlacement.reason || 'Posición no válida'}
            </div>
          </div>
          <button
            type="button"
            disabled={!pendingPlacement.valid}
            onClick={confirmMobileBuilding}
            className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-black text-xs flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-4 h-4" /> Construir
          </button>
          <button
            type="button"
            onClick={rotateActiveBuilding}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white cursor-pointer"
            title="Rotar"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPendingPlacement(null)}
            className="p-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-200 cursor-pointer"
            title="Cancelar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* FLOATING QUICK ACTION CHIPS (Undo / Finish Bus Line / Rotate Desktop) */}
      <div className="fixed bottom-20 right-3 z-20 flex flex-col items-end gap-2">
        {tool.kind === 'bus_line' && engineRef.current.draftBusStops.length >= 2 && (
          <button
            type="button"
            onClick={() => {
              const res = engineRef.current!.finishDraftBusLine();
              showToast(res.message, res.ok ? 'ok' : 'warn');
              handleAfterMutate();
            }}
            className="px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 font-black text-xs shadow-lg cursor-pointer"
          >
            ✓ Cerrar Línea de Bus ({engineRef.current.draftBusStops.length} paradas)
          </button>
        )}

        {tool.kind === 'building' && !pendingPlacement && (
          <button
            type="button"
            onClick={rotateActiveBuilding}
            className="px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-400" /> Rotar (R)
          </button>
        )}

        {hud.canUndo && (
          <button
            type="button"
            onClick={() => {
              if (engineRef.current?.undoLastAction()) {
                handleAfterMutate();
                showToast('↶ Última acción deshecha', 'info');
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-amber-400/40 text-amber-300 font-extrabold text-xs flex items-center gap-1.5 shadow-xl cursor-pointer"
          >
            <Undo2 className="w-4 h-4" /> Deshacer
          </button>
        )}
      </div>

      {/* BOTTOM CONSTRUCTION DOCK */}
      <div
        className="fixed bottom-0 inset-x-0 z-20 pointer-events-none px-2 pb-2"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
      >
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-2">
          {/* Sub-Drawer for Active Build Category */}
          {activeTab !== 'none' && (
            <div className="pointer-events-auto w-full bg-slate-950/92 backdrop-blur-xl border border-slate-800 rounded-2xl p-2.5 shadow-2xl overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 min-w-max">
                {activeTab === 'roads' &&
                  ([RoadTier.Local2L, RoadTier.Avenue4L, RoadTier.Highway6L] as const).map(
                    (rt) => {
                      const spec = ROAD_CATALOG[rt];
                      const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                      const selected = tool.kind === 'road' && tool.tier === rt;
                      return (
                        <button
                          key={rt}
                          type="button"
                          onClick={() => setTool({ kind: 'road', tier: rt })}
                          className={`px-3.5 py-2 rounded-xl border text-left transition cursor-pointer ${
                            selected
                              ? 'bg-sky-500/25 border-sky-400 text-white'
                              : locked
                              ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                          }`}
                        >
                          <div className="text-xs font-extrabold">{spec.shortName}</div>
                          <div className="text-[10px] text-sky-300">
                            {locked
                              ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                              : `$${spec.costPerCell}/celda • Recta/45°/Puente`}
                          </div>
                        </button>
                      );
                    }
                  )}

                {activeTab === 'zones' &&
                  (
                    [
                      ZoneKind.ResLow,
                      ZoneKind.ResHigh,
                      ZoneKind.ComLow,
                      ZoneKind.ComHigh,
                      ZoneKind.Industrial,
                      ZoneKind.Office,
                      ZoneKind.None,
                    ] as const
                  ).map((zk) => {
                    const spec = ZONE_CATALOG[zk];
                    const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                    const selected = tool.kind === 'zone' && tool.zone === zk;
                    return (
                      <button
                        key={zk}
                        type="button"
                        onClick={() => setTool({ kind: 'zone', zone: zk })}
                        className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          selected
                            ? 'bg-slate-800 border-white text-white'
                            : locked
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                        }`}
                      >
                        <span
                          className="w-3 h-6 rounded-sm shrink-0"
                          style={{ backgroundColor: spec.color }}
                        />
                        <div>
                          <div className="text-xs font-extrabold">{spec.shortName}</div>
                          <div className="text-[10px] text-slate-400">
                            {locked
                              ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                              : `$${spec.costPerCell}/celda`}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                {activeTab === 'utilities' &&
                  (
                    [
                      'wind_turbine',
                      'solar_plant',
                      'coal_plant',
                      'nuclear_plant',
                      'water_tower',
                      'water_pump',
                      'water_treatment',
                    ] as SpecialBuildingId[]
                  ).map((bid) => {
                    const spec = BUILDING_SPECS[bid];
                    const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                    const selected = tool.kind === 'building' && tool.buildingId === bid;
                    return (
                      <button
                        key={bid}
                        type="button"
                        onClick={() => {
                          setPendingPlacement(null);
                          setTool({ kind: 'building', buildingId: bid });
                        }}
                        className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                          selected
                            ? 'bg-sky-500/25 border-sky-400 text-white'
                            : locked
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{spec.name}</div>
                        <div className="text-[10px] text-emerald-300">
                          {locked
                            ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                            : `$${spec.cost.toLocaleString()} • ${
                                spec.powerMW > 0 ? `+${spec.powerMW}MW` : `+${spec.waterML}ML`
                              }`}
                        </div>
                      </button>
                    );
                  })}

                {activeTab === 'services' &&
                  (
                    [
                      'clinic',
                      'hospital',
                      'fire_station',
                      'police_station',
                      'school',
                      'university',
                      'city_park',
                      'botanical_plaza',
                    ] as SpecialBuildingId[]
                  ).map((bid) => {
                    const spec = BUILDING_SPECS[bid];
                    const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                    const selected = tool.kind === 'building' && tool.buildingId === bid;
                    return (
                      <button
                        key={bid}
                        type="button"
                        onClick={() => {
                          setPendingPlacement(null);
                          setTool({ kind: 'building', buildingId: bid });
                        }}
                        className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                          selected
                            ? 'bg-sky-500/25 border-sky-400 text-white'
                            : locked
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{spec.name}</div>
                        <div className="text-[10px] text-sky-300">
                          {locked
                            ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                            : `$${spec.cost.toLocaleString()} (${spec.w}x${spec.d})`}
                        </div>
                      </button>
                    );
                  })}

                {activeTab === 'transit' && (
                  <>
                    {(['bus_depot', 'metro_station'] as SpecialBuildingId[]).map((bid) => {
                      const spec = BUILDING_SPECS[bid];
                      const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                      const selected = tool.kind === 'building' && tool.buildingId === bid;
                      return (
                        <button
                          key={bid}
                          type="button"
                          onClick={() => {
                            setPendingPlacement(null);
                            setTool({ kind: 'building', buildingId: bid });
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                            selected
                              ? 'bg-sky-500/25 border-sky-400 text-white'
                              : locked
                              ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                          }`}
                        >
                          <div className="text-xs font-extrabold">{spec.name}</div>
                          <div className="text-[10px] text-sky-300">
                            {locked
                              ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                              : `$${spec.cost.toLocaleString()}`}
                          </div>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setPendingPlacement(null);
                        setTool({ kind: 'bus_line' });
                      }}
                      className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                        tool.kind === 'bus_line'
                          ? 'bg-sky-500/25 border-sky-400 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-extrabold">🚌 Trazar Línea de Bus</div>
                      <div className="text-[10px] text-emerald-300">
                        Toca paradas en calles ({hud.busLinesCount} activas)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPendingPlacement(null);
                        setTool({ kind: 'metro_tunnel' });
                      }}
                      className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                        tool.kind === 'metro_tunnel'
                          ? 'bg-cyan-500/25 border-cyan-400 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-extrabold">🚇 Túnel de Metro Subterráneo</div>
                      <div className="text-[10px] text-cyan-300">
                        Arrastra de Estación a Estación ({hud.metroSegmentsCount} tramos)
                      </div>
                    </button>
                  </>
                )}

                {activeTab === 'monuments' &&
                  (
                    [
                      'monument_stadium',
                      'monument_fox_tower',
                      'monument_airport',
                      'monument_arcology',
                    ] as SpecialBuildingId[]
                  ).map((bid) => {
                    const spec = BUILDING_SPECS[bid];
                    const built = hud.builtMonuments.includes(bid);
                    const locked = !hud.sandboxMode && hud.population < spec.unlockPop;
                    const selected = tool.kind === 'building' && tool.buildingId === bid;
                    return (
                      <button
                        key={bid}
                        type="button"
                        disabled={built}
                        onClick={() => {
                          setPendingPlacement(null);
                          setTool({ kind: 'building', buildingId: bid });
                        }}
                        className={`px-3.5 py-2 rounded-xl border text-left transition cursor-pointer ${
                          built
                            ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300 opacity-75'
                            : selected
                            ? 'bg-amber-500/25 border-amber-400 text-white'
                            : locked
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{spec.name}</div>
                        <div className="text-[10px] text-amber-300">
                          {built
                            ? '✓ Inaugurado'
                            : locked
                            ? `🔒 ${spec.unlockPop.toLocaleString()} hab.`
                            : `$${spec.cost.toLocaleString()} (${spec.w}x${spec.d})`}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Primary Category Bar */}
          <div className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 bg-slate-950/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-1.5 shadow-2xl overflow-x-auto max-w-full no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setActiveTab('none');
                setPendingPlacement(null);
                setTool({ kind: 'pan' });
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                tool.kind === 'pan' && activeTab === 'none'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Hand className="w-4 h-4" />
              <span className="hidden sm:inline">Cámara</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('none');
                setPendingPlacement(null);
                setTool({ kind: 'inspect' });
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                tool.kind === 'inspect'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Search className="w-4 h-4" />
              <span className="hidden md:inline">Inspección</span>
            </button>

            <button
              type="button"
              onClick={() => {
                selectCategoryTab('roads');
                setTool({ kind: 'road', tier: RoadTier.Local2L });
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'roads'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Compass className="w-4 h-4" />
              <span>Vías</span>
            </button>

            <button
              type="button"
              onClick={() => {
                selectCategoryTab('zones');
                setTool({ kind: 'zone', zone: ZoneKind.ResLow });
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'zones'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Zonas</span>
            </button>

            <button
              type="button"
              onClick={() => selectCategoryTab('utilities')}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'utilities'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Zap className="w-4 h-4" />
              <Droplets className="w-3.5 h-3.5 -ml-1" />
              <span className="hidden sm:inline">Luz/Agua</span>
            </button>

            <button
              type="button"
              onClick={() => selectCategoryTab('services')}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'services'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Shield className="w-4 h-4" />
              <Trees className="w-3.5 h-3.5 -ml-1" />
              <span className="hidden sm:inline">Servicios</span>
            </button>

            <button
              type="button"
              onClick={() => selectCategoryTab('transit')}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'transit'
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Bus className="w-4 h-4" />
              <TrainFront className="w-3.5 h-3.5 -ml-1" />
              <span className="hidden sm:inline">Tránsito</span>
            </button>

            <button
              type="button"
              onClick={() => selectCategoryTab('monuments')}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'monuments'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span className="hidden md:inline">Monumentos</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('none');
                setPendingPlacement(null);
                setTool({ kind: 'bulldoze' });
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                tool.kind === 'bulldoze'
                  ? 'bg-rose-600 text-white'
                  : 'text-rose-400 hover:bg-rose-950/60'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Demoler</span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: 9 MACRO-TILES PURCHASABLE TERRITORY */}
      {showTileModal && (
        <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-base text-white flex items-center gap-2">
                <Grid className="w-4 h-4 text-emerald-400" /> Macro-Parcelas Regionales (3×3)
              </h3>
              <button
                type="button"
                onClick={() => setShowTileModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              Parcelas activas: {engineRef.current.getUnlockedTileCount()} /{' '}
              {engineRef.current.getMaxAllowedTiles()} permitidas en tu hito actual.
            </p>

            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {Array.from({ length: 9 }, (_, idx) => {
                const unlocked = (hud.unlockedTilesMask & (1 << idx)) !== 0;
                const price = engineRef.current!.getTileUnlockPrice(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={unlocked}
                    onClick={() => {
                      const res = engineRef.current!.unlockMacroTile(idx);
                      if (!res.ok && res.reason) showToast(res.reason, 'warn');
                      else showToast('¡Nueva macro-parcela desbloqueada!', 'ok');
                      handleAfterMutate();
                    }}
                    className={`h-24 rounded-2xl border p-2 flex flex-col items-center justify-center text-center transition cursor-pointer ${
                      unlocked
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                        : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                  >
                    <span className="text-xs font-extrabold">
                      Sector {Math.floor(idx / 3) + 1}-{(idx % 3) + 1}
                    </span>
                    <span className="text-[11px] mt-1 font-bold text-sky-300">
                      {unlocked ? '✓ En Propiedad' : `$${price.toLocaleString()}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ECONOMY, TAXES & LOANS */}
      {showEconomyModal && (
        <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-base text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" /> Finanzas, Impuestos y Bonos
              </h3>
              <button
                type="button"
                onClick={() => setShowEconomyModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="rounded-2xl bg-slate-950 p-3 border border-slate-800">
                <div className="text-[11px] text-slate-400">Recaudación</div>
                <div className="text-sm font-black text-emerald-400">+${hud.lastTaxIncome}</div>
              </div>
              <div className="rounded-2xl bg-slate-950 p-3 border border-slate-800">
                <div className="text-[11px] text-slate-400">Mantenimiento</div>
                <div className="text-sm font-black text-rose-400">-${hud.lastMaintenanceCost}</div>
              </div>
              <div className="rounded-2xl bg-slate-950 p-3 border border-slate-800">
                <div className="text-[11px] text-slate-400">Pasajeros Bus/Metro</div>
                <div className="text-sm font-black text-sky-300">{hud.transitRiders}</div>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              {(
                [
                  { key: 'residential', label: 'Impuesto Residencial', color: 'accent-emerald-400' },
                  { key: 'commercial', label: 'Impuesto Comercial', color: 'accent-sky-400' },
                  { key: 'industrial', label: 'Impuesto Industrial / Oficinas', color: 'accent-amber-400' },
                ] as const
              ).map((row) => (
                <div key={row.key}>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span>{row.label}</span>
                    <span>{hud.taxes[row.key]}%</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={20}
                    value={hud.taxes[row.key]}
                    onChange={(e) => {
                      engineRef.current!.taxes[row.key] = Number(e.target.value);
                      engineRef.current!.recomputePopulationAndEconomy(false);
                      handleAfterMutate();
                    }}
                    className={`w-full ${row.color}`}
                  />
                </div>
              ))}
            </div>

            <div className="border-t border-slate-800 pt-4">
              <div className="text-xs font-extrabold text-slate-300 mb-2">
                Préstamos y Bonos Municipales
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {([' municipal_25k', 'metro_80k'] as const).map((lid) => {
                  const activeLoan = hud.loans.find((l) => l.id === lid);
                  const title =
                    lid === ' municipal_25k' ? 'Bono Rápido ($25,000)' : 'Bono Metro ($80,000)';
                  return (
                    <div
                      key={lid}
                      className="rounded-2xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{title}</div>
                        <div className="text-[11px] text-slate-400">
                          {activeLoan
                            ? `Restante: $${activeLoan.remaining.toLocaleString()}`
                            : 'Disponible al instante'}
                        </div>
                      </div>
                      {activeLoan ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (engineRef.current!.repayLoan(lid)) handleAfterMutate();
                            else showToast('Fondos insuficientes para liquidar.', 'warn');
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-xs cursor-pointer"
                        >
                          Liquidar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const r = engineRef.current!.takeLoan(lid);
                            if (r.ok) handleAfterMutate();
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold text-xs cursor-pointer"
                        >
                          Solicitar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OPTIONAL DISASTERS & EMERGENCY DRILLS */}
      {showDisasterModal && (
        <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-base text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-400" /> Control de Desastres Opcionales
              </h3>
              <button
                type="button"
                onClick={() => setShowDisasterModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-slate-950 border border-slate-800 p-3.5 mb-4">
              <div>
                <div className="text-xs font-extrabold text-white">Desastres Aleatorios</div>
                <div className="text-[11px] text-slate-400">
                  Opcional: activa o desactiva eventos climáticos imprevistos
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  engineRef.current!.randomDisastersEnabled = !hud.randomDisastersEnabled;
                  handleAfterMutate();
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black cursor-pointer ${
                  hud.randomDisastersEnabled
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {hud.randomDisastersEnabled ? 'ACTIVADOS' : 'DESACTIVADOS'}
              </button>
            </div>

            <div className="text-xs font-bold text-slate-300 mb-2">
              Probar Defensas de la Ciudad (Disparo Manual):
            </div>
            <div className="space-y-2">
              {DISASTER_CATALOG.map((d) => (
                <div
                  key={d.kind}
                  className="rounded-2xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-extrabold text-white">{d.name}</div>
                    <div className="text-[11px] text-slate-400">{d.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      engineRef.current!.triggerDisaster(d.kind);
                      setShowDisasterModal(false);
                      handleAfterMutate();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs shrink-0 cursor-pointer"
                  >
                    Lanzar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MULTI-DEVICE SYNC CONFLICT RESOLUTION (Zero Data Loss) */}
      {conflictData && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-amber-400/50 rounded-3xl p-5 shadow-2xl">
            <h3 className="font-black text-base text-amber-300 mb-2">
              ☁️ Versión más reciente detectada en otro dispositivo
            </h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Jugaste en otro equipo recientemente (Población en nube:{' '}
              <strong>{conflictData.serverCity.population.toLocaleString()} hab.</strong>).
              {conflictData.backupSlotId
                ? ' Tu sesión local ya quedó respaldada automáticamente como copia de seguridad.'
                : ''}{' '}
              ¿Qué versión deseas continuar aquí?
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  engineRef.current = CityEngine.fromCompactState(
                    conflictData.serverCity.compactState
                  );
                  activeRevRef.current = conflictData.serverCity.serverRev;
                  setConflictData(null);
                  setSyncState('synced');
                  refreshHud();
                }}
                className="py-2.5 px-3 rounded-xl bg-sky-500 text-slate-950 font-black text-xs cursor-pointer"
              >
                Cargar de la Nube
              </button>
              <button
                type="button"
                onClick={() => {
                  setConflictData(null);
                  void syncNow({ forceOverwrite: true });
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
              >
                Usar Esta Pantalla
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloudModal && (
        <CloudSyncModal
          session={session}
          onClose={() => setShowCloudModal(false)}
          onCitiesUpdated={(next) => {
            setCities(next);
            setSyncState('synced');
          }}
          onForcePushActiveCity={async () => {
            await syncNow({ forceOverwrite: true });
          }}
          onToast={showToast}
        />
      )}

      {/* Global Deployment Verification Timestamp in Corner */}
      <div className="fixed bottom-1 right-2 z-50 pointer-events-none text-[9px] font-mono text-slate-300/85 bg-slate-950/80 border border-sky-400/20 px-1.5 py-0.5 rounded">
        Actualizado: {BUILD_TS}
      </div>
    </div>
  );
};

export default App;
