import * as THREE from 'three';

export interface CityProceduralAssets {
  resAlbedo: THREE.CanvasTexture;
  resEmissive: THREE.CanvasTexture;
  comAlbedo: THREE.CanvasTexture;
  comEmissive: THREE.CanvasTexture;
  indAlbedo: THREE.CanvasTexture;
  indEmissive: THREE.CanvasTexture;
  facadeBump: THREE.CanvasTexture;
  terrainDetailTex: THREE.CanvasTexture;
  waterNormalTex: THREE.CanvasTexture;
  envMap: THREE.Texture;
}

let cachedAssets: CityProceduralAssets | null = null;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return [c, c.getContext('2d')!];
}

function configureTex(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  srgb: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function buildFacadePair(
  style: 'res' | 'com' | 'ind',
  anisotropy: number
): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 512;
  const [ac, actx] = makeCanvas(size, size);
  const [ec, ectx] = makeCanvas(size, size);

  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, size, size);

  if (style === 'res') {
    // Warm architectural stucco & brick courses with balcony shadows
    actx.fillStyle = '#ebe3d5';
    actx.fillRect(0, 0, size, size);

    const cols = 8;
    const rows = 16;
    const cw = size / cols;
    const ch = size / rows;

    for (let r = 0; r < rows; r++) {
      // Floor slab & recessed balcony shadow strip
      actx.fillStyle = r % 2 === 0 ? '#cbd5e1' : '#d6cfc2';
      actx.fillRect(0, r * ch, size, 4);
      actx.fillStyle = 'rgba(51, 65, 85, 0.14)';
      actx.fillRect(0, r * ch + 4, size, 3);

      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 8;
        const wy = r * ch + 7;
        const ww = cw - 16;
        const wh = ch - 11;

        // Subtle stone/brick frame
        actx.fillStyle = '#94a3b8';
        actx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

        const shade = ((r * 11 + c * 7) % 4) * 5;
        actx.fillStyle = `rgb(${54 + shade}, ${76 + shade}, ${98 + shade})`;
        actx.fillRect(wx, wy, ww, wh);

        // Sky sheen
        actx.fillStyle = 'rgba(224, 242, 254, 0.35)';
        actx.fillRect(wx + 1, wy + 1, ww - 2, 3);

        // Center mullion
        actx.fillStyle = '#cbd5e1';
        actx.fillRect(wx + ww * 0.5 - 1, wy, 2, wh);

        const h = ((r * 41 + c * 19 + r * c * 7) % 100) / 100;
        if (h < 0.62) {
          ectx.fillStyle = h < 0.42 ? '#fef08a' : h < 0.54 ? '#fed7aa' : '#fde68a';
          ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 3);
        }
      }
    }
  } else if (style === 'com') {
    // Sleek glass curtain wall & metallic spandrels with bright ground-floor retail
    actx.fillStyle = '#94a3b8';
    actx.fillRect(0, 0, size, size);

    const cols = 10;
    const rows = 20;
    const cw = size / cols;
    const ch = size / rows;

    for (let r = 0; r < rows; r++) {
      const isGroundRetail = r >= rows - 2;
      actx.fillStyle = r % 4 === 0 ? '#cbd5e1' : '#64748b';
      actx.fillRect(0, r * ch, size, 3);

      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 3;
        const wy = r * ch + 4;
        const ww = cw - 6;
        const wh = ch - 6;

        const shade = ((r * 17 + c * 13) % 6) * 7;
        actx.fillStyle = isGroundRetail
          ? '#1e3a5f'
          : `rgb(${38 + shade}, ${74 + shade}, ${118 + shade})`;
        actx.fillRect(wx, wy, ww, wh);

        // Diagonal glass reflection glint
        actx.fillStyle = 'rgba(224, 242, 254, 0.42)';
        actx.fillRect(wx + 1, wy + 1, ww - 2, 3);

        const h = ((r * 37 + c * 29 + r * c * 11) % 100) / 100;
        if (isGroundRetail || h < 0.64) {
          ectx.fillStyle = isGroundRetail
            ? '#fef08a'
            : h < 0.36
            ? '#bae6fd'
            : h < 0.52
            ? '#e0f2fe'
            : '#fde68a';
          ectx.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
        }
      }
    }
  } else {
    // Industrial corrugated cladding, concrete pilasters, hazard trim & amber clerestories
    actx.fillStyle = '#b6b0a6';
    actx.fillRect(0, 0, size, size);

    // Corrugated vertical ribs
    for (let x = 0; x < size; x += 8) {
      actx.fillStyle = x % 16 === 0 ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      actx.fillRect(x, 0, 4, size);
    }

    // Concrete horizontal truss bands & lower safety stripe
    const rows = 8;
    const ch = size / rows;
    for (let r = 0; r < rows; r++) {
      actx.fillStyle = '#78716c';
      actx.fillRect(0, r * ch, size, 6);

      if (r % 2 === 1) {
        const cols = 6;
        const cw = size / cols;
        for (let c = 0; c < cols; c++) {
          const wx = c * cw + 10;
          const wy = r * ch + 14;
          const ww = cw - 20;
          const wh = 18;
          actx.fillStyle = '#334155';
          actx.fillRect(wx, wy, ww, wh);
          if (((r * 13 + c * 7) % 10) < 6) {
            ectx.fillStyle = (c + r) % 2 === 0 ? '#fbbf24' : '#fdba74';
            ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
          }
        }
      }
    }

    // Yellow/dark industrial base plinth stripe
    actx.fillStyle = '#57534e';
    actx.fillRect(0, size - 36, size, 36);
    actx.fillStyle = '#eab308';
    actx.fillRect(0, size - 40, size, 4);
  }

  return {
    albedo: configureTex(ac, anisotropy, true),
    emissive: configureTex(ec, anisotropy, true),
  };
}

function buildFacadeBump(anisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, size, size);

  const cols = 10;
  const rows = 20;
  const cw = size / cols;
  const ch = size / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, r * ch, size, 3);
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      ctx.fillStyle = '#484848';
      ctx.fillRect(cIdx * cw + 4, r * ch + 5, cw - 8, ch - 8);
    }
  }
  return configureTex(c, anisotropy, false);
}

function buildTerrainDetailTex(anisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // Periodic trigonometric + pseudo-random grain so tiling 30x30 has zero visible seams
  const twoPi = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const ny = (y / size) * twoPi;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * twoPi;
      const wave =
        Math.sin(nx * 4 + Math.cos(ny * 3)) * 0.35 +
        Math.cos(ny * 5 - Math.sin(nx * 6)) * 0.35 +
        Math.sin((nx + ny) * 11) * 0.15;
      const hash = (((x * 374761393 + y * 668265263) ^ ((x * y) << 3)) >>> 0) / 4294967295;
      const lum = Math.round(234 + wave * 12 + (hash - 0.5) * 14);
      const v = Math.max(204, Math.min(255, lum));
      const idx = (y * size + x) * 4;
      d[idx] = v;
      d[idx + 1] = Math.min(255, v + 3);
      d[idx + 2] = Math.max(198, v - 4);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = configureTex(c, anisotropy, true, 30, 30);
  return tex;
}

function buildWaterNormalTex(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const twoPi = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * twoPi;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * twoPi;
      // Exact periodic heightfield partial derivatives for seamless looping ripples
      const dhdx =
        0.34 * Math.cos(u * 4 + v * 2) * 4 +
        0.22 * Math.cos(u * 7 - v * 5) * 7 +
        0.12 * Math.cos(u * 12 + v * 9) * 12;
      const dhdy =
        0.34 * Math.cos(u * 4 + v * 2) * 2 -
        0.22 * Math.cos(u * 7 - v * 5) * 5 +
        0.12 * Math.cos(u * 12 + v * 9) * 9;

      const scale = 0.08;
      let nx = -dhdx * scale;
      let ny = -dhdy * scale;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;

      const idx = (y * size + x) * 4;
      d[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = configureTex(c, anisotropy, false, 18, 18);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function getCityProceduralAssets(renderer: THREE.WebGLRenderer): CityProceduralAssets {
  if (cachedAssets) return cachedAssets;

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const res = buildFacadePair('res', anisotropy);
  const com = buildFacadePair('com', anisotropy);
  const ind = buildFacadePair('ind', anisotropy);
  const facadeBump = buildFacadeBump(anisotropy);
  const terrainDetailTex = buildTerrainDetailTex(anisotropy);
  const waterNormalTex = buildWaterNormalTex(anisotropy);

  // Procedural HDR Environment Map (PMREM) for crisp glass & water reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();

  const [skyCanvas, sctx] = makeCanvas(512, 256);
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0369a1');
  grad.addColorStop(0.42, '#7dd3fc');
  grad.addColorStop(0.5, '#fef3c7');
  grad.addColorStop(0.62, '#475569');
  grad.addColorStop(1, '#1e293b');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 512, 256);

  // Bright sun halo
  const sunGlow = sctx.createRadialGradient(176, 66, 4, 176, 66, 48);
  sunGlow.addColorStop(0, 'rgba(255,255,255,1)');
  sunGlow.addColorStop(0.35, 'rgba(254,243,199,0.75)');
  sunGlow.addColorStop(1, 'rgba(254,243,199,0)');
  sctx.fillStyle = sunGlow;
  sctx.beginPath();
  sctx.arc(176, 66, 48, 0, Math.PI * 2);
  sctx.fill();

  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  envScene.add(skyDome);

  const envMap = pmrem.fromScene(envScene, 0.035).texture;
  pmrem.dispose();
  skyTex.dispose();
  skyDome.geometry.dispose();

  cachedAssets = {
    resAlbedo: res.albedo,
    resEmissive: res.emissive,
    comAlbedo: com.albedo,
    comEmissive: com.emissive,
    indAlbedo: ind.albedo,
    indEmissive: ind.emissive,
    facadeBump,
    terrainDetailTex,
    waterNormalTex,
    envMap,
  };
  return cachedAssets;
}
