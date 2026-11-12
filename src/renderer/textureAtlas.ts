import * as THREE from 'three';

export interface CityProceduralAssets {
  facadeAlbedo: THREE.CanvasTexture;
  facadeEmissive: THREE.CanvasTexture;
  envMap: THREE.Texture;
}

let cachedAssets: CityProceduralAssets | null = null;

export function getCityProceduralAssets(renderer: THREE.WebGLRenderer): CityProceduralAssets {
  if (cachedAssets) return cachedAssets;

  // 1. Single shared 1024x1024 Facade + Window Grid Atlas (Albedo + Night Emissive)
  const size = 1024;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d')!;

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = size;
  emissiveCanvas.height = size;
  const ectx = emissiveCanvas.getContext('2d')!;

  // Base architectural facade neutral wall (tinted per-instance via instanceColor!)
  actx.fillStyle = '#dbe4ee';
  actx.fillRect(0, 0, size, size);

  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, size, size);

  // Subtle horizontal floor spandrel bands & vertical mullions
  const cols = 16;
  const rows = 32;
  const cw = size / cols;
  const ch = size / rows;

  for (let r = 0; r < rows; r++) {
    // Concrete/aluminum floor slab line
    actx.fillStyle = r % 4 === 0 ? '#94a3b8' : '#cbd5e1';
    actx.fillRect(0, r * ch, size, 4);

    for (let c = 0; c < cols; c++) {
      const wx = c * cw + 6;
      const wy = r * ch + 6;
      const ww = cw - 12;
      const wh = ch - 10;

      // Daytime reflective blue-slate glass pane
      const shade = ((r * 13 + c * 7) % 5) * 6;
      actx.fillStyle = `rgb(${56 + shade}, ${78 + shade}, ${106 + shade})`;
      actx.fillRect(wx, wy, ww, wh);

      // Specular sky highlight strip on top of window
      actx.fillStyle = 'rgba(186, 230, 253, 0.35)';
      actx.fillRect(wx + 2, wy + 2, ww - 4, 4);

      // Nighttime lit apartments / offices (~58% lit with warm/cool variety)
      const hash = ((r * 37 + c * 23 + r * c * 11) % 100) / 100;
      if (hash < 0.58) {
        if (hash < 0.34) {
          ectx.fillStyle = '#fef08a'; // Warm residential lamp
        } else if (hash < 0.48) {
          ectx.fillStyle = '#bae6fd'; // Cool modern LED office
        } else {
          ectx.fillStyle = '#fed7aa'; // Soft amber interior
        }
        ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
  }

  const facadeAlbedo = new THREE.CanvasTexture(albedoCanvas);
  facadeAlbedo.colorSpace = THREE.SRGBColorSpace;
  facadeAlbedo.wrapS = THREE.RepeatWrapping;
  facadeAlbedo.wrapT = THREE.RepeatWrapping;
  facadeAlbedo.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const facadeEmissive = new THREE.CanvasTexture(emissiveCanvas);
  facadeEmissive.colorSpace = THREE.SRGBColorSpace;
  facadeEmissive.wrapS = THREE.RepeatWrapping;
  facadeEmissive.wrapT = THREE.RepeatWrapping;

  // 2. Procedural HDR Environment Map (PMREM) for crisp glass & water reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();

  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d')!;
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0284c7');
  grad.addColorStop(0.46, '#bae6fd');
  grad.addColorStop(0.52, '#fef3c7');
  grad.addColorStop(1, '#334155');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 512, 256);

  sctx.fillStyle = '#ffffff';
  sctx.beginPath();
  sctx.arc(170, 68, 24, 0, Math.PI * 2);
  sctx.fill();

  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  envScene.add(skyDome);

  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  skyTex.dispose();
  skyDome.geometry.dispose();

  cachedAssets = {
    facadeAlbedo,
    facadeEmissive,
    envMap,
  };
  return cachedAssets;
}
