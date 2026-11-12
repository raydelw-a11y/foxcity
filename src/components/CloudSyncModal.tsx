import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { CloudCitySummary } from '../types/game';
import {
  AuthSessionData,
  connectAndSyncGitHubToken,
  disconnectGitHubCloud,
  exportAccountBackupJson,
  fetchCloudCitySummaries,
  getCloudConfig,
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
  const initialCfg = getCloudConfig();
  const [patInput, setPatInput] = useState(initialCfg.pat);
  const [cfg, setCfg] = useState(initialCfg);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshCfg = () => setCfg(getCloudConfig());

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatusMsg('Buscando o creando Gist secreto automáticamente...');
    const res = await connectAndSyncGitHubToken(session, patInput);
    setBusy(false);

    if (!res.ok) {
      setStatusMsg(res.error || 'Error al conectar con GitHub.');
      onToast(res.error || 'Error al conectar con GitHub.', 'warn');
      return;
    }

    if (onForcePushActiveCity) {
      await onForcePushActiveCity();
    }
    refreshCfg();
    if (res.cities) onCitiesUpdated(res.cities);
    setStatusMsg('¡Nube GitHub conectada y sincronizada automáticamente!');
    onToast('☁️ GitHub Cloud vinculada con auto-descubrimiento de Gist', 'ok');
  };

  const handleSyncNow = async () => {
    if (busy) return;
    setBusy(true);
    setStatusMsg('Sincronizando ciudades con GitHub Gist...');
    if (onForcePushActiveCity) {
      await onForcePushActiveCity();
    }
    const merged = await fetchCloudCitySummaries(session);
    if (merged) onCitiesUpdated(merged);
    refreshCfg();
    setBusy(false);
    setStatusMsg('Sincronización completada.');
    onToast('☁️ Ciudades sincronizadas al día', 'ok');
  };

  const handleDisconnect = () => {
    disconnectGitHubCloud();
    setPatInput('');
    refreshCfg();
    setStatusMsg('Desconectado de GitHub. Tus ciudades siguen guardadas localmente.');
    onToast('Modo local activado en este equipo', 'info');
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

  const connected = Boolean(cfg.pat && cfg.gistId);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-sky-400/35 rounded-3xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h3 className="font-black text-base text-white">
                Nube Multi-Dispositivo (GitHub Gist)
              </h3>
              <p className="text-[11px] text-slate-400">
                100% gratis y sin servidor Render • Auto-descubrimiento automático
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

        {/* Connection Status Banner */}
        <div
          className={`rounded-2xl p-3.5 mb-4 border text-xs ${
            connected
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-slate-950/80 border-slate-800 text-slate-300'
          }`}
        >
          {connected ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-extrabold flex items-center gap-1.5 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" /> Sincronización Automática Activa
                  {cfg.githubLogin ? ` (@${cfg.githubLogin})` : ''}
                </div>
                <div className="text-[11px] text-slate-300 mt-1">
                  Gist secreto detectado: <code className="text-sky-300">{cfg.gistId.slice(0, 10)}…</code>
                  {cfg.lastSyncedAt
                    ? ` • Último sync: ${new Date(cfg.lastSyncedAt).toLocaleTimeString()}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSyncNow()}
                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                Sincronizar Ahora
              </button>
            </div>
          ) : (
            <div>
              <div className="font-bold text-white mb-0.5">Modo Local en este dispositivo</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Pega tu Token de GitHub una sola vez por equipo (Mac, PC, iPhone o iPad). Fox City
                encontrará o creará tu Gist secreto solo, sin copiar IDs.
              </p>
            </div>
          )}
        </div>

        {/* GitHub Token Form */}
        <form onSubmit={handleConnectToken} className="space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-sky-400" /> GitHub Personal Access Token (permiso{' '}
              <code className="text-sky-300">gist</code>)
            </label>
            <a
              href="https://github.com/settings/tokens/new?scopes=gist&description=FoxCity-CloudSync"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-bold text-sky-400 hover:text-sky-300 inline-flex items-center gap-1"
            >
              Crear token en 1 clic <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <input
            type="password"
            value={patInput}
            onChange={(e) => setPatInput(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !patInput.trim()}
              className="flex-1 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs transition cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Conectando...' : connected ? 'Actualizar Token y Sincronizar' : 'Conectar Nube Automática'}
            </button>

            {cfg.pat && (
              <button
                type="button"
                onClick={handleDisconnect}
                title="Quitar token de este navegador"
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-rose-900/70 text-slate-300 hover:text-rose-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Desvincular
              </button>
            )}
          </div>

          {statusMsg && (
            <div className="text-[11px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-500/30 rounded-xl px-3 py-2">
              {statusMsg}
            </div>
          )}
        </form>

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
