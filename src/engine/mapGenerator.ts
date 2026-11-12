import {
  DIR_N,
  DIR_S,
  GRID_SIZE,
  MapArchetypeId,
  RoadTier,
  TerrainKind,
  TOTAL_CELLS,
} from '../types/game';

export interface GeneratedMapData {
  elevation: Float32Array; // -3.0 .. +14.0 (waterLevel = 0)
  terrain: Uint8Array; // TerrainKind
  trees: Uint8Array; // 0 = none, 1..3 = natural tree density/variant
  initialRoadTier: Uint8Array;
  initialRoadMask: Uint8Array;
  highwayEntryX: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smoothstep(x - xi);
  const zf = smoothstep(z - zi);

  const v00 = hash2D(xi, zi, seed);
  const v10 = hash2D(xi + 1, zi, seed);
  const v01 = hash2D(xi, zi + 1, seed);
  const v11 = hash2D(xi + 1, zi + 1, seed);

  const nx0 = v00 + (v10 - v00) * xf;
  const nx1 = v01 + (v11 - v01) * xf;
  return nx0 + (nx1 - nx0) * zf;
}

function fbm2D(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, z * freq, seed + i * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / norm;
}

export function isWaterTerrain(t: TerrainKind): boolean {
  return t === TerrainKind.DeepWater || t === TerrainKind.ShallowWater;
}

export function generateProceduralMap(mapId: MapArchetypeId, seed: number): GeneratedMapData {
  const elevation = new Float32Array(TOTAL_CELLS);
  const terrain = new Uint8Array(TOTAL_CELLS);
  const trees = new Uint8Array(TOTAL_CELLS);
  const initialRoadTier = new Uint8Array(TOTAL_CELLS);
  const initialRoadMask = new Uint8Array(TOTAL_CELLS);
  const rand = mulberry32(seed);

  const highwayEntryX = 52;

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const idx = z * GRID_SIZE + x;
      const nx = x / GRID_SIZE; // 0..1
      const nz = z / GRID_SIZE; // 0..1
      const n1 = fbm2D(x * 0.045, z * 0.045, seed, 4); // 0..1
      const n2 = fbm2D(x * 0.11, z * 0.11, seed + 401, 3); // 0..1

      let h = 1.4 + (n1 - 0.5) * 2.2;

      if (mapId === 'emerald_bay') {
        // Southern emerald ocean bay + central-east meandering river
        const coastZ = 0.77 + Math.sin(nx * Math.PI * 2.4 + 0.5) * 0.06 + (n2 - 0.5) * 0.05;
        if (nz > coastZ) {
          h = -0.8 - (nz - coastZ) * 9.5;
        } else if (nz > coastZ - 0.045) {
          h = 0.18 + ((coastZ - nz) / 0.045) * 0.9;
        }
        // River flowing from North-East into the bay while leaving center highway clear
        const riverCenterX = 63 + Math.sin(nz * Math.PI * 2.3) * 6.5;
        const distRiver = Math.abs(x - riverCenterX);
        const riverWidth = 3.2 + nz * 1.8;
        if (distRiver < riverWidth + 2.4 && nz <= coastZ + 0.02) {
          const factor = Math.max(0, 1 - distRiver / (riverWidth + 2.4));
          h -= factor * factor * 3.1;
        }
        // Scenic northern foothills
        if (nz < 0.16 && Math.abs(x - highwayEntryX) > 7) {
          h += (0.16 - nz) * 18 * n1;
        }
      } else if (mapId === 'grand_delta') {
        // Two rivers converging into a wide delta
        const r1X = 39 + Math.sin(nz * Math.PI * 2.0) * 5.0;
        const r2X = 69 - Math.sin(nz * Math.PI * 1.8 + 0.8) * 5.5;
        const mergeX = 56 + (nz - 0.62) * 14;
        const d1 = nz < 0.68 ? Math.abs(x - r1X) : Math.abs(x - mergeX);
        const d2 = nz < 0.68 ? Math.abs(x - r2X) : Math.abs(x - (mergeX + 6));
        const minD = Math.min(d1, d2);
        const w = nz < 0.68 ? 3.0 : 4.6;
        if (minD < w + 2.2) {
          const f = Math.max(0, 1 - minD / (w + 2.2));
          h = 1.2 - f * f * 3.0;
        } else {
          h = 1.25 + (n1 - 0.45) * 1.6;
        }
      } else if (mapId === 'alpine_valley') {
        // High mountain ridges on East & West, flat valley floor in the middle + glacial stream
        const valleyCenter = 54 + Math.sin(nz * Math.PI * 1.5) * 6;
        const distValley = Math.abs(x - valleyCenter);
        if (distValley > 24) {
          const climb = (distValley - 24) / 28;
          h = 1.8 + climb * climb * 11.5 * (0.65 + n1 * 0.7);
        } else {
          h = 1.5 + (n1 - 0.5) * 1.1;
        }
        const streamX = 62 + Math.cos(nz * Math.PI * 2.5) * 3.5;
        const dStream = Math.abs(x - streamX);
        if (dStream < 3.6) {
          const f = 1 - dStream / 3.6;
          h -= f * f * 2.7;
        }
      } else {
        // Archipelago: 5 major islands + shallow channels
        const islands = [
          { cx: 53, cz: 52, rx: 20, rz: 19 }, // Central main island
          { cx: 23, cz: 26, rx: 15, rz: 14 }, // NW island
          { cx: 84, cz: 28, rx: 15, rz: 15 }, // NE island
          { cx: 25, cz: 81, rx: 16, rz: 14 }, // SW island
          { cx: 82, cz: 80, rx: 17, rz: 15 }, // SE island
          { cx: 52, cz: 15, rx: 9, rz: 16 }, // Northern causeway peninsula for highway
        ];
        let best = -2.2;
        for (const isl of islands) {
          const dx = (x - isl.cx) / isl.rx;
          const dz = (z - isl.cz) / isl.rz;
          const d = Math.sqrt(dx * dx + dz * dz) + (n1 - 0.5) * 0.28;
          const islH = (1.05 - d) * 3.4;
          if (islH > best) best = islH;
        }
        h = Math.max(-2.4, best);
      }

      // Guarantee dry corridor for initial regional highway entrance (x=52, z=0..40)
      if (Math.abs(x - highwayEntryX) <= 2 && z <= 41 && mapId !== 'archipelago') {
        h = Math.max(h, 1.25);
      }

      elevation[idx] = h;

      let kind: TerrainKind;
      if (h < -1.1) {
        kind = TerrainKind.DeepWater;
      } else if (h < 0.0) {
        kind = TerrainKind.ShallowWater;
      } else if (h < 0.38) {
        kind = TerrainKind.Beach;
      } else if (h > 6.4) {
        kind = TerrainKind.Mountain;
      } else if (h > 3.4) {
        kind = TerrainKind.Hill;
      } else if (n2 > 0.58) {
        kind = TerrainKind.Fertile;
      } else {
        kind = TerrainKind.Plains;
      }
      terrain[idx] = kind;

      // Natural trees on fertile/plains/hills away from starter highway
      if (
        (kind === TerrainKind.Fertile || kind === TerrainKind.Plains || kind === TerrainKind.Hill) &&
        Math.abs(x - highwayEntryX) > 2
      ) {
        const treeRoll = rand();
        if (n2 > 0.56 && treeRoll < 0.34) {
          trees[idx] = 1 + Math.floor(rand() * 3);
        } else if (treeRoll < 0.07) {
          trees[idx] = 1 + Math.floor(rand() * 2);
        }
      }
    }
  }

  // Build starter Regional 6-Lane Highway from northern border (z=0) into unlocked center tile (z=40)
  for (let z = 0; z <= 40; z++) {
    const idx = z * GRID_SIZE + highwayEntryX;
    initialRoadTier[idx] = RoadTier.Highway6L;
    trees[idx] = 0;
    let mask = 0;
    if (z > 0) mask |= DIR_N;
    if (z < 40) mask |= DIR_S;
    initialRoadMask[idx] = mask;
  }

  return {
    elevation,
    terrain,
    trees,
    initialRoadTier,
    initialRoadMask,
    highwayEntryX,
  };
}
