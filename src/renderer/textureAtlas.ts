import * as THREE from 'three';

export interface CityProceduralAssets {
  resAlbedo: THREE.CanvasTexture;
  resEmissive: THREE.CanvasTexture;
  comAlbedo: THREE.CanvasTexture;
  comEmissive: THREE.CanvasTexture;
  indAlbedo: THREE.CanvasTexture;
  indEmissive: THREE.CanvasTexture;
  offAlbedo: THREE.CanvasTexture;
  offEmissive: THREE.CanvasTexture;
  facadeBump: THREE.CanvasTexture;
  terrainDetailTex: THREE.CanvasTexture;
  waterNormalTex: THREE.CanvasTexture;
  asphaltTex: THREE.CanvasTexture;
  sidewalkTex: THREE.CanvasTexture;
  sunGlowTex: THREE.CanvasTexture;
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
  style: 'res' | 'com' | 'ind' | 'off',
  anisotropy: number
): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 512;
  const [ac, actx] = makeCanvas(size, size);
  const [ec, ectx] = makeCanvas(size, size);

  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, size, size);

  if (style === 'res') {
    // Warm architectural stucco & brick courses with balcony rails & floor AO
    actx.fillStyle = '#efe6d8';
    actx.fillRect(0, 0, size, size);

    // Subtle plaster masonry texture
    for (let y = 0; y < size; y += 8) {
      actx.fillStyle = y % 16 === 0 ? 'rgba(120, 113, 108, 0.05)' : 'rgba(255, 255, 255, 0.06)';
      actx.fillRect(0, y, size, 4);
    }

    const cols = 8;
    const rows = 16;
    const cw = size / cols;
    const ch = size / rows;

    for (let r = 0; r < rows; r++) {
      // Floor slab & recessed balcony shadow strip
      actx.fillStyle = r % 2 === 0 ? '#cbd5e1' : '#d6cfc2';
      actx.fillRect(0, r * ch, size, 4);
      actx.fillStyle = 'rgba(30, 41, 59, 0.18)';
      actx.fillRect(0, r * ch + 4, size, 3);

      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 8;
        const wy = r * ch + 7;
        const ww = cw - 16;
        const wh = ch - 11;

        // Architectural lintel & frame
        actx.fillStyle = '#94a3b8';
        actx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        actx.fillStyle = '#e2e8f0';
        actx.fillRect(wx - 3, wy - 3, ww + 6, 3);

        const shade = ((r * 11 + c * 7) % 4) * 5;
        actx.fillStyle = `rgb(${54 + shade}, ${78 + shade}, ${102 + shade})`;
        actx.fillRect(wx, wy, ww, wh);

        // Sky sheen & curtain interior variation
        actx.fillStyle = 'rgba(224, 242, 254, 0.38)';
        actx.fillRect(wx + 1, wy + 1, ww - 2, 4);

        // Center mullion & balcony sill guardrail on even floors
        actx.fillStyle = '#cbd5e1';
        actx.fillRect(wx + ww * 0.5 - 1, wy, 2, wh);
        if ((r + c) % 3 === 0) {
          actx.fillStyle = 'rgba(241, 245, 249, 0.65)';
          actx.fillRect(wx - 2, wy + wh - 4, ww + 4, 2);
        }

        const h = ((r * 41 + c * 19 + r * c * 7) % 100) / 100;
        if (h < 0.65) {
          ectx.fillStyle = h < 0.38 ? '#fef08a' : h < 0.52 ? '#fed7aa' : '#fde68a';
          ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 3);
        }
      }
    }
  } else if (style === 'com') {
    // Sleek glass curtain wall & metallic spandrels with vibrant ground-floor retail storefronts & awnings
    actx.fillStyle = '#8aa0b8';
    actx.fillRect(0, 0, size, size);

    const cols = 10;
    const rows = 20;
    const cw = size / cols;
    const ch = size / rows;

    for (let r = 0; r < rows; r++) {
      const isGroundRetail = r >= rows - 2;
      actx.fillStyle = r % 4 === 0 ? '#dbeafe' : '#64748b';
      actx.fillRect(0, r * ch, size, 3);

      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 3;
        const wy = r * ch + 4;
        const ww = cw - 6;
        const wh = ch - 6;

        const shade = ((r * 17 + c * 13) % 6) * 7;
        actx.fillStyle = isGroundRetail
          ? '#1e3a5f'
          : `rgb(${40 + shade}, ${78 + shade}, ${124 + shade})`;
        actx.fillRect(wx, wy, ww, wh);

        // Crisp sky reflection streak
        actx.fillStyle = 'rgba(224, 242, 254, 0.48)';
        actx.fillRect(wx + 1, wy + 1, ww - 2, 3);

        if (isGroundRetail && r === rows - 2) {
          // Ground-floor retail awning accent
          actx.fillStyle = (c % 3 === 0) ? '#ea580c' : (c % 3 === 1) ? '#0284c7' : '#0f766e';
          actx.fillRect(wx - 1, wy - 2, ww + 2, 5);
        }

        const h = ((r * 37 + c * 29 + r * c * 11) % 100) / 100;
        if (isGroundRetail || h < 0.68) {
          ectx.fillStyle = isGroundRetail
            ? (c % 4 === 0 ? '#fed7aa' : '#fef08a')
            : h < 0.36
            ? '#bae6fd'
            : h < 0.54
            ? '#e0f2fe'
            : '#fde68a';
          ectx.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
        }
      }
    }
  } else if (style === 'off') {
    // High-tech cyan-silver office curtain wall with structural spandrel fins & cool LED floors
    actx.fillStyle = '#94b2ca';
    actx.fillRect(0, 0, size, size);

    const cols = 12;
    const rows = 24;
    const cw = size / cols;
    const ch = size / rows;

    for (let r = 0; r < rows; r++) {
      // Architectural double mechanical louver every 6 floors
      const isMechFloor = r % 6 === 0;
      actx.fillStyle = isMechFloor ? '#475569' : '#cbd5e1';
      actx.fillRect(0, r * ch, size, isMechFloor ? 5 : 2);

      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 2;
        const wy = r * ch + (isMechFloor ? 5 : 3);
        const ww = cw - 4;
        const wh = ch - (isMechFloor ? 6 : 4);

        const shade = ((r * 13 + c * 19) % 5) * 6;
        actx.fillStyle = isMechFloor
          ? '#334155'
          : `rgb(${56 + shade}, ${114 + shade}, ${152 + shade})`;
        actx.fillRect(wx, wy, ww, wh);

        // Specular curtain-glass highlight
        actx.fillStyle = 'rgba(224, 247, 255, 0.45)';
        actx.fillRect(wx + 1, wy + 1, ww - 2, 2);

        const h = ((r * 43 + c * 31 + r * c * 5) % 100) / 100;
        if (!isMechFloor && h < 0.7) {
          ectx.fillStyle = h < 0.45 ? '#e0f2fe' : h < 0.62 ? '#a5f3fc' : '#f8fafc';
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
      actx.fillStyle = x % 16 === 0 ? 'rgba(15, 23, 42, 0.09)' : 'rgba(255, 255, 255, 0.09)';
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

function buildAsphaltTex(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const twoPi = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const ny = (y / size) * twoPi;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * twoPi;
      const hash = (((x * 1619 + y * 31337) ^ ((x * y) << 2)) >>> 0) / 4294967295;
      const wear = Math.sin(nx * 2) * 5 + Math.cos(ny * 2 + nx) * 4;
      const grain = (hash - 0.5) * 26;
      const lum = Math.max(198, Math.min(255, Math.round(234 + wear + grain)));
      const idx = (y * size + x) * 4;
      d[idx] = lum;
      d[idx + 1] = lum;
      d[idx + 2] = Math.min(255, lum + 3);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = configureTex(c, anisotropy, true, 1, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function buildSidewalkTex(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, size, size);

  const step = 32;
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.28)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= size; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  for (let i = 0; i < 650; i++) {
    const x = ((i * 73) % size);
    const y = ((i * 139) % size);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(71,85,105,0.12)';
    ctx.fillRect(x, y, 2, 2);
  }
  return configureTex(c, anisotropy, true, 1, 1);
}

function buildSunGlowTex(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.18, 'rgba(255, 248, 225, 0.85)');
  g.addColorStop(0.45, 'rgba(254, 240, 138, 0.32)');
  g.addColorStop(1.0, 'rgba(254, 240, 138, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = configureTex(c, anisotropy, true, 1, 1);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function getCityProceduralAssets(renderer: THREE.WebGLRenderer): CityProceduralAssets {
  if (cachedAssets) return cachedAssets;

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const res = buildFacadePair('res', anisotropy);
  const com = buildFacadePair('com', anisotropy);
  const ind = buildFacadePair('ind', anisotropy);
  const off = buildFacadePair('off', anisotropy);
  const facadeBump = buildFacadeBump(anisotropy);
  const terrainDetailTex = buildTerrainDetailTex(anisotropy);
  const waterNormalTex = buildWaterNormalTex(anisotropy);
  const asphaltTex = buildAsphaltTex(anisotropy);
  const sidewalkTex = buildSidewalkTex(anisotropy);
  const sunGlowTex = buildSunGlowTex(anisotropy);

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
    offAlbedo: off.albedo,
    offEmissive: off.emissive,
    facadeBump,
    terrainDetailTex,
    waterNormalTex,
    asphaltTex,
    sidewalkTex,
    sunGlowTex,
    envMap,
  };
  return cachedAssets;
}
