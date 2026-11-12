import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Download,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { CloudCitySummary } from '../types/game';
import {
  AuthSessionData,
  exportAccountBackupJson,
  fetchCloudCitySummaries,
  flushPendingDirtySlots,
  getLastCloudSyncTime,
  importAccountBackupJson,
} from '../utils/cloudSync';

interface CloudSyncModalProps {
  session: AuthSessionData;
  onClose: () => void;
  onCitiesUpdated: (cities: CloudCitySummary[]) => void;
  onForcePushActiveCity?: () => Promise<void>;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'ok') => void;
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  session,
  onClose,
  onCitiesUpdated,
  onForcePushActiveCity,
  onToast,
}) => {
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [lastSync, setLastSync] = useState(() => getLastCloudSyncTime());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSyncNow = async () => {
    if (busy) return;
    setBusy(true);
    setStatusMsg('Sincronizando ciudades con la nube...');
    if (onForcePushActiveCity) {
      await onForcePushActiveCity();
    }
    await flushPendingDirtySlots(session);
    const merged = await fetchCloudCitySummaries(session);
    setBusy(false);

    if (merged) {
      onCitiesUpdated(merged);
      setLastSync(getLastCloudSyncTime());
      setStatusMsg('¡Ciudades sincronizadas al día en la nube!');
      onToast('☁️ Ciudades sincronizadas al día', 'ok');
    } else {
      setStatusMsg('Sin conexión momentánea. Tus avances siguen a salvo en este dispositivo.');
      onToast('Guardado seguro en el dispositivo (reintentará al volver la red)', 'info');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setBusy(true);
      const res = await importAccountBackupJson(session, text);
      setBusy(false);
      if (!res.ok) {
        onToast(res.error || 'No se pudo importar el JSON.', 'warn');
      } else {
        onCitiesUpdated(res.cities);
        setLastSync(getLastCloudSyncTime());
        onToast(`✅ Se importaron ${res.importedCount} ciudad(es) con éxito`, 'ok');
        setStatusMsg(`Importadas ${res.importedCount} ciudad(es).`);
      }
    } catch {
      setBusy(false);
      onToast('No se pudo leer el archivo seleccionado.', 'warn');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-sky-400/35 rounded-3xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h3 className="font-black text-base text-white">Nube Multi-Dispositivo y Respaldo</h3>
              <p className="text-[11px] text-slate-400">
                Sincronización automática entre Mac, PC, iPhone, iPad y Android
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Automatic Cloud Status Banner */}
        <div className="rounded-2xl p-4 mb-4 border bg-emerald-950/35 border-emerald-500/40 text-emerald-100 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-extrabold flex items-center gap-1.5 text-emerald-300">
                <CheckCircle2 className="w-4 h-4" /> Nube Multi-Dispositivo Conectada Automáticamente
              </div>
              <div className="text-[11px] text-slate-300 mt-1">
                Perfil unificado: <strong className="text-white">{session.mayorName}</strong>
                {lastSync ? ` • Último sync: ${new Date(lastSync).toLocaleTimeString()}` : ''}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSyncNow()}
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Sincronizando...' : 'Sincronizar Ahora'}
            </button>
          </div>
        </div>

        {statusMsg && (
          <div className="mb-4 text-[11px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-500/30 rounded-xl px-3 py-2">
            {statusMsg}
          </div>
        )}

        {/* Manual JSON Backup Export / Import */}
        <div className="pt-4 border-t border-slate-800">
          <div className="text-xs font-extrabold text-slate-200 mb-2">
            Respaldo Manual Directo (.JSON)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                void exportAccountBackupJson(session);
                onToast('📦 Respaldo JSON descargado', 'ok');
              }}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" /> Exportar Ciudades (.JSON)
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" /> Importar Respaldo (.JSON)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleImportFile(e)}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
