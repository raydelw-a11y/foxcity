import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Cloud,
  ExternalLink,
  KeyRound,
  Lock,
  Sparkles,
  User,
} from 'lucide-react';
import { soundFX } from '../audio/soundEngine';
import { getCloudConfig } from '../utils/cloudSync';

interface PrivateAccessProps {
  buildTimestamp: string;
  onUnlock: (
    mayorName: string,
    password: string,
    optionalGithubPat?: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

export const PrivateAccess: React.FC<PrivateAccessProps> = ({ buildTimestamp, onUnlock }) => {
  const [mayorName, setMayorName] = useState(() => {
    try {
      return localStorage.getItem('foxcity:last_mayor') || 'Raydel';
    } catch {
      return 'Raydel';
    }
  });
  const [password, setPassword] = useState('');
  const [githubPat, setGithubPat] = useState(() => getCloudConfig().pat);
  const [showCloudField, setShowCloudField] = useState(() => false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const hasSavedPat = Boolean(getCloudConfig().pat);

  // Animated Modern Night Skyline Backdrop with Bridge & Moving Headlights
  useEffect(() => {
    let raf = 0;
    const renderSkyline = (now: number) => {
      raf = requestAnimationFrame(renderSkyline);
      if (document.visibilityState === 'hidden') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = (canvas.width = window.innerWidth);
      const h = (canvas.height = window.innerHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const t = now * 0.001;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#040914');
      sky.addColorStop(0.58, '#0f172a');
      sky.addColorStop(0.82, '#1e293b');
      sky.addColorStop(1, '#082f49');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Subtle stars
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      for (let i = 0; i < 45; i++) {
        const sx = ((i * 197) % 1000) * 0.001 * w;
        const sy = ((i * 311) % 500) * 0.001 * h;
        ctx.fillRect(sx, sy, 2, 2);
      }

      const horizonY = h * 0.74;

      // Distant skyscrapers silhouette + lit windows
      const towers = 26;
      for (let i = 0; i < towers; i++) {
        const tw = Math.max(26, w / 22);
        const tx = (i / towers) * w;
        const th = 70 + ((i * 73) % 170) + (i === 12 ? 95 : 0);
        const ty = horizonY - th;

        ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#16213a';
        ctx.fillRect(tx, ty, tw - 4, th);

        // Spire on central Fox Tower
        if (i === 12) {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(tx + (tw - 4) * 0.46, ty - 44, 3, 44);
          ctx.fillStyle = Math.sin(t * 4) > 0 ? '#ef4444' : '#7f1d1d';
          ctx.beginPath();
          ctx.arc(tx + (tw - 4) * 0.48, ty - 46, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Lit warm/cyan windows
        for (let wy = ty + 10; wy < horizonY - 10; wy += 12) {
          for (let wx = tx + 5; wx < tx + tw - 11; wx += 9) {
            const seed = (i * 31 + wy * 7 + wx * 3) % 11;
            if (seed < 6) {
              ctx.fillStyle = seed < 4 ? 'rgba(254, 240, 138, 0.72)' : 'rgba(125, 211, 252, 0.65)';
              ctx.fillRect(wx, wy, 4, 6);
            }
          }
        }
      }

      // Illuminated Highway Bridge Deck + Moving Cars
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, horizonY, w, 6);

      for (let c = 0; c < 18; c++) {
        const dir = c % 2 === 0 ? 1 : -1;
        const cx = (((c * 140 + t * (55 + (c % 3) * 18) * dir) % w) + w) % w;
        ctx.fillStyle = dir > 0 ? '#fef08a' : '#f87171';
        ctx.fillRect(cx, horizonY - 2, 8, 3);
      }

      // Bay Water Reflection
      const waterGrad = ctx.createLinearGradient(0, horizonY + 6, 0, h);
      waterGrad.addColorStop(0, '#0c4a6e');
      waterGrad.addColorStop(1, '#020617');
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, horizonY + 6, w, h - horizonY);
    };

    raf = requestAnimationFrame(renderSkyline);
    return () => cancelAnimationFrame(raf);
  }, []);

  const submitAccess = async () => {
    if (loading) return;
    const cleanPass = password.trim();
    if (!cleanPass) {
      setErrorMsg('Ingresa tu contraseña para acceder a Fox City.');
      return;
    }

    setErrorMsg('');
    setLoading(true);
    soundFX.unlock();

    try {
      localStorage.setItem('foxcity:last_mayor', mayorName.trim() || 'Raydel');
    } catch {
      // ignore
    }

    const res = await onUnlock(mayorName.trim() || 'Raydel', cleanPass, githubPat.trim() || undefined);
    setLoading(false);
    if (!res.ok) {
      setErrorMsg(res.error || 'Contraseña incorrecta.');
    } else {
      soundFX.playMilestoneFanfare();
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitAccess();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitAccess();
    }
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center p-4 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      <div className="relative z-10 w-full max-w-md rounded-3xl bg-slate-900/85 backdrop-blur-xl border border-sky-400/25 shadow-[0_24px_80px_rgba(2,6,23,0.85)] p-6 sm:p-8">
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-700 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-400">
              <Sparkles className="w-3.5 h-3.5" /> Acceso Privado
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">FOX CITY</h1>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-slate-300 mb-4 leading-relaxed">
          Simulador metropolitano 3D en GitHub Pages con auto-sincronización entre escritorio,
          iPhone, iPad y Android.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Perfil de Alcalde (mismo nombre en todos tus equipos)
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={mayorName}
                onChange={(e) => setMayorName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tu nombre o usuario"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-400 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Contraseña de Acceso Privado
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ingresa tu clave y pulsa Enter..."
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-400 transition"
              />
            </div>
          </div>

          {/* Optional Collapsible GitHub Cloud Sync Accordion */}
          <div className="rounded-2xl bg-slate-950/65 border border-slate-800 px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => setShowCloudField((v) => !v)}
              className="w-full flex items-center justify-between text-left text-xs font-bold text-sky-300 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-sky-400" />
                {hasSavedPat
                  ? 'Nube GitHub Vinculada (Auto-Sync Activo)'
                  : 'Sincronizar con GitHub Cloud (Opcional)'}
              </span>
              {showCloudField ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showCloudField && (
              <div className="mt-2.5 space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="w-3 h-3 text-sky-400" /> Token con permiso{' '}
                    <code className="text-sky-300">gist</code>
                  </span>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=gist&description=FoxCity-CloudSync"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:text-sky-300 font-bold inline-flex items-center gap-1"
                  >
                    Crear en 1 clic <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <input
                  type="password"
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ghp_... (o déjalo vacío para jugar local)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Solo se pega una vez por dispositivo. Descubre tu Gist secreto automáticamente sin
                  pedir IDs. También puedes configurarlo luego dentro del juego.
                </p>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="text-xs font-semibold text-rose-300 bg-rose-950/60 border border-rose-500/40 rounded-xl px-3 py-2">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-sky-600/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Cloud className="w-4 h-4" />
            <span>{loading ? 'Abriendo Metrópolis...' : 'Entrar a Fox City'}</span>
          </button>
        </form>
      </div>

      {/* Global Deployment Verification Timestamp in Corner */}
      <div className="fixed bottom-1.5 right-2 z-50 pointer-events-none text-[10px] font-mono text-slate-300/85 bg-slate-950/80 border border-sky-400/20 px-1.5 py-0.5 rounded">
        Actualizado: {buildTimestamp}
      </div>
    </div>
  );
};
