import {
  BUILDING_SPECS,
  BUS_LINE_COLORS,
  CITY_MILESTONES,
  MAP_ARCHETYPES,
  ROAD_CATALOG,
  ZONE_CATALOG,
} from '../config/catalog';
import { soundFX } from '../audio/soundEngine';
import {
  ActiveDisasterEvent,
  BusLineRecord,
  ChirpMessage,
  CityHudSnapshot,
  DIR_E,
  DIR_N,
  DIR_NE,
  DIR_NW,
  DIR_S,
  DIR_SE,
  DIR_SW,
  DIR_W,
  DisasterKind,
  GRID_SIZE,
  LoanRecord,
  MACRO_TILE_SIZE,
  MapArchetypeId,
  MetroSegmentRecord,
  PlacedStructure,
  RoadTier,
  SpecialBuildingId,
  TaxRates,
  TerrainKind,
  TOTAL_CELLS,
  TransitStopPoint,
  WeatherKind,
  ZoneKind,
} from '../types/game';
import { generateProceduralMap, isWaterTerrain } from './mapGenerator';

export const DIR_OFFSETS: { bit: number; opp: number; dx: number; dz: number; diag: boolean }[] = [
  { bit: DIR_N, opp: DIR_S, dx: 0, dz: -1, diag: false },
  { bit: DIR_NE, opp: DIR_SW, dx: 1, dz: -1, diag: true },
  { bit: DIR_E, opp: DIR_W, dx: 1, dz: 0, diag: false },
  { bit: DIR_SE, opp: DIR_NW, dx: 1, dz: 1, diag: true },
  { bit: DIR_S, opp: DIR_N, dx: 0, dz: 1, diag: false },
  { bit: DIR_SW, opp: DIR_NE, dx: -1, dz: 1, diag: true },
  { bit: DIR_W, opp: DIR_E, dx: -1, dz: 0, diag: false },
  { bit: DIR_NW, opp: DIR_SE, dx: -1, dz: -1, diag: true },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string, expectedLen: number): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(expectedLen);
  const len = Math.min(binary.length, expectedLen);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

interface UndoSnapshot {
  money: number;
  roadTier: Uint8Array;
  roadMask: Uint8Array;
  zones: Uint8Array;
  rciLevel: Uint8Array;
  rciVariant: Uint8Array;
  trees: Uint8Array;
  structures: PlacedStructure[];
  busLines: BusLineRecord[];
  metroSegments: MetroSegmentRecord[];
}

export interface CellInspectInfo {
  x: number;
  z: number;
  terrain: TerrainKind;
  elevation: number;
  tileUnlocked: boolean;
  tileIndex: number;
  roadTier: RoadTier;
  isBridge: boolean;
  zone: ZoneKind;
  rciLevel: number;
  abandoned: boolean;
  onFire: number;
  structure: PlacedStructure | null;
  powered: boolean;
  watered: boolean;
  landValue: number;
  pollution: number;
  traffic: number;
  serviceScore: number;
}

export class CityEngine {
  public cityId: string;
  public cityName: string;
  public mapId: MapArchetypeId;
  public seed: number;
  public sandboxMode: boolean;

  // World arrays (108 x 108 = 11,664)
  public elevation!: Float32Array;
  public terrain!: Uint8Array;
  public trees!: Uint8Array;
  public roadTier = new Uint8Array(TOTAL_CELLS);
  public roadMask = new Uint8Array(TOTAL_CELLS);
  public zones = new Uint8Array(TOTAL_CELLS);
  public rciLevel = new Uint8Array(TOTAL_CELLS); // 0 = empty, 1..5 = built level
  public rciProgress = new Int16Array(TOTAL_CELLS); // -100..100
  public rciVariant = new Uint8Array(TOTAL_CELLS); // style seed 0..7
  public rciAbandoned = new Uint8Array(TOTAL_CELLS); // 0 | 1
  public rciDiag = new Uint8Array(TOTAL_CELLS); // 0 = ortho, 1 = +45deg, 2 = -45deg
  public cellFire = new Uint8Array(TOTAL_CELLS); // 0..100
  public structureGrid = new Int32Array(TOTAL_CELLS); // -1 or structure.id

  // Analytical simulation maps (0..255)
  public powerMap = new Uint8Array(TOTAL_CELLS); // 0 | 1
  public waterMap = new Uint8Array(TOTAL_CELLS); // 0 | 1
  public landValueMap = new Uint8Array(TOTAL_CELLS); // 0..100
  public pollutionMap = new Uint8Array(TOTAL_CELLS); // 0..100
  public trafficMap = new Uint8Array(TOTAL_CELLS); // 0..100
  public serviceMap = new Uint8Array(TOTAL_CELLS); // 0..100
  public transitMap = new Uint8Array(TOTAL_CELLS); // 0..100

  public structures: PlacedStructure[] = [];
  private nextStructureId = 1;

  public busLines: BusLineRecord[] = [];
  public draftBusStops: TransitStopPoint[] = [];
  public metroSegments: MetroSegmentRecord[] = [];

  // Macro-tiles: 3x3 (bit 4 = center unlocked initially)
  public unlockedTilesMask = 1 << 4;

  // Economy & Clock
  public money = 120000;
  public simTick = 0;
  public day = 1;
  public timeOfDay = 10.5; // 0..24h
  public autoDayNight = true;
  public weather: WeatherKind = 'clear';
  public simSpeed: 0 | 1 | 2 | 4 = 1;

  public taxes: TaxRates = {
    residential: 9,
    commercial: 9,
    industrial: 9,
  };

  public demand = {
    residential: 78,
    commercial: 55,
    industrial: 62,
  };

  public population = 0;
  public jobsTotal = 0;
  public happiness = 84;
  public milestoneIndex = 0;
  public powerProducedMW = 0;
  public powerConsumedMW = 0;
  public waterProducedML = 0;
  public waterConsumedML = 0;
  public avgTraffic = 8;
  public avgLandValue = 42;
  public avgPollution = 4;
  public transitRiders = 0;
  public netIncomePerTick = 0;
  public lastTaxIncome = 0;
  public lastMaintenanceCost = 0;

  public randomDisastersEnabled = false;
  public activeDisasters: ActiveDisasterEvent[] = [];
  public loans: LoanRecord[] = [];
  public chirps: ChirpMessage[] = [];
  public windAngleRad = 0.4;

  // Dirty flags for 3D renderer so static InstancedMeshes only upload when mutated
  public meshVersion = 1;
  public overlayVersion = 1;
  public dirtySync = false;

  private undoStack: UndoSnapshot[] = [];

  constructor(opts?: {
    cityId?: string;
    cityName?: string;
    mapId?: MapArchetypeId;
    seed?: number;
    sandboxMode?: boolean;
  }) {
    this.cityId = opts?.cityId || `city-${Date.now().toString(36)}`;
    this.cityName = opts?.cityName || 'Nueva Fox City';
    this.mapId = opts?.mapId || 'emerald_bay';
    const mapCfg = MAP_ARCHETYPES.find((m) => m.id === this.mapId) || MAP_ARCHETYPES[0];
    this.seed = opts?.seed || mapCfg.defaultSeed;
    this.sandboxMode = Boolean(opts?.sandboxMode);
    this.windAngleRad = (mapCfg.windAngleDeg * Math.PI) / 180;

    this.initWorldFromMap();
  }

  private initWorldFromMap() {
    const gen = generateProceduralMap(this.mapId, this.seed);
    this.elevation = gen.elevation;
    this.terrain = gen.terrain;
    this.trees = gen.trees;
    this.roadTier.set(gen.initialRoadTier);
    this.roadMask.set(gen.initialRoadMask);
    this.structureGrid.fill(-1);

    if (this.sandboxMode) {
      this.money = 9999999;
      this.unlockedTilesMask = 0b111111111;
      this.milestoneIndex = CITY_MILESTONES.length - 1;
    }

    this.pushChirp(
      'Consejo Municipal',
      '@AlcaldiaFox',
      `¡Bienvenido a ${this.cityName}! Conecta una calle a la autopista norte, instala luz y agua, y pinta zonas Residenciales, Comerciales e Industriales.`,
      'positive'
    );

    this.recomputeUtilitiesAndCoverage();
    this.recomputeLandValueAndPollution();
    this.recomputePopulationAndEconomy(false);
    this.meshVersion++;
    this.overlayVersion++;
  }

  public idx(x: number, z: number): number {
    return z * GRID_SIZE + x;
  }

  public inBounds(x: number, z: number): boolean {
    return x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE;
  }

  public getMacroTileIndex(x: number, z: number): number {
    const tx = Math.min(2, Math.max(0, Math.floor(x / MACRO_TILE_SIZE)));
    const tz = Math.min(2, Math.max(0, Math.floor(z / MACRO_TILE_SIZE)));
    return tz * 3 + tx;
  }

  public isTileUnlockedAt(x: number, z: number): boolean {
    const tIdx = this.getMacroTileIndex(x, z);
    return (this.unlockedTilesMask & (1 << tIdx)) !== 0;
  }

  public getUnlockedTileCount(): number {
    let count = 0;
    for (let i = 0; i < 9; i++) {
      if ((this.unlockedTilesMask & (1 << i)) !== 0) count++;
    }
    return count;
  }

  public getMaxAllowedTiles(): number {
    if (this.sandboxMode) return 9;
    return CITY_MILESTONES[this.milestoneIndex]?.maxUnlockedTiles || 1;
  }

  public getTileUnlockPrice(tileIdx: number): number {
    if (this.sandboxMode) return 0;
    const isCorner = tileIdx === 0 || tileIdx === 2 || tileIdx === 6 || tileIdx === 8;
    const base = isCorner ? 28000 : 16000;
    return base + (this.getUnlockedTileCount() - 1) * 4500;
  }

  public unlockMacroTile(tileIdx: number): { ok: boolean; reason?: string } {
    if (tileIdx < 0 || tileIdx >= 9) return { ok: false, reason: 'Parcela inválida.' };
    if ((this.unlockedTilesMask & (1 << tileIdx)) !== 0) {
      return { ok: false, reason: 'Esta parcela ya está desbloqueada.' };
    }
    if (this.getUnlockedTileCount() >= this.getMaxAllowedTiles()) {
      const nextM = CITY_MILESTONES[this.milestoneIndex + 1];
      return {
        ok: false,
        reason: nextM
          ? `Aumenta la población a ${nextM.populationRequired.toLocaleString()} hab. para desbloquear más parcelas.`
          : 'Límite de parcelas alcanzado.',
      };
    }

    // Must be adjacent to an already unlocked tile
    const tx = tileIdx % 3;
    const tz = Math.floor(tileIdx / 3);
    let adjacent = false;
    for (const [dx, dz] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx >= 0 && nx < 3 && nz >= 0 && nz < 3) {
        const nIdx = nz * 3 + nx;
        if ((this.unlockedTilesMask & (1 << nIdx)) !== 0) adjacent = true;
      }
    }
    if (!adjacent) {
      return { ok: false, reason: 'Debes comprar una parcela colindante a tu territorio actual.' };
    }

    const price = this.getTileUnlockPrice(tileIdx);
    if (!this.sandboxMode && this.money < price) {
      return { ok: false, reason: `Fondos insuficientes ($${price.toLocaleString()}).` };
    }

    if (!this.sandboxMode) this.money -= price;
    this.unlockedTilesMask |= 1 << tileIdx;
    this.meshVersion++;
    this.dirtySync = true;
    soundFX.playMilestoneFanfare();
    this.pushChirp(
      'Expansión Territorial',
      '@CatastroFox',
      `¡Nueva macro-parcela incorporada al área metropolitana de ${this.cityName}!`,
      'positive'
    );
    return { ok: true };
  }

  private pushUndoSnapshot() {
    const snap: UndoSnapshot = {
      money: this.money,
      roadTier: this.roadTier.slice(),
      roadMask: this.roadMask.slice(),
      zones: this.zones.slice(),
      rciLevel: this.rciLevel.slice(),
      rciVariant: this.rciVariant.slice(),
      trees: this.trees.slice(),
      structures: this.structures.map((s) => ({ ...s })),
      busLines: this.busLines.map((b) => ({
        ...b,
        stops: b.stops.map((st) => ({ ...st })),
      })),
      metroSegments: this.metroSegments.map((m) => ({ ...m })),
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > 10) {
      this.undoStack.shift();
    }
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public undoLastAction(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.money = snap.money;
    this.roadTier.set(snap.roadTier);
    this.roadMask.set(snap.roadMask);
    this.zones.set(snap.zones);
    this.rciLevel.set(snap.rciLevel);
    this.rciVariant.set(snap.rciVariant);
    this.trees.set(snap.trees);
    this.structures = snap.structures;
    this.busLines = snap.busLines;
    this.metroSegments = snap.metroSegments;
    this.rebuildStructureGrid();
    this.recomputeUtilitiesAndCoverage();
    this.recomputeLandValueAndPollution();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playClick();
    return true;
  }

  private rebuildStructureGrid() {
    this.structureGrid.fill(-1);
    for (const s of this.structures) {
      for (let dz = 0; dz < s.d; dz++) {
        for (let dx = 0; dx < s.w; dx++) {
          if (this.inBounds(s.x + dx, s.z + dz)) {
            this.structureGrid[this.idx(s.x + dx, s.z + dz)] = s.id;
          }
        }
      }
    }
  }

  /**
   * Computes a smart octilinear path (0°, 45°, 90°, 135°...) from (x0,z0) to (x1,z1).
   */
  public computeSmartRoadPath(
    x0: number,
    z0: number,
    x1: number,
    z1: number
  ): { x: number; z: number }[] {
    const path: { x: number; z: number }[] = [];
    let cx = Math.max(0, Math.min(GRID_SIZE - 1, x0));
    let cz = Math.max(0, Math.min(GRID_SIZE - 1, z0));
    const tx = Math.max(0, Math.min(GRID_SIZE - 1, x1));
    const tz = Math.max(0, Math.min(GRID_SIZE - 1, z1));

    path.push({ x: cx, z: cz });
    let guard = 0;
    while ((cx !== tx || cz !== tz) && guard < 240) {
      guard++;
      const remX = tx - cx;
      const remZ = tz - cz;
      const absX = Math.abs(remX);
      const absZ = Math.abs(remZ);
      const sx = Math.sign(remX);
      const sz = Math.sign(remZ);

      // Pure 45-deg diagonal when |dx| == |dz| or close octilinear corner
      if (absX > 0 && absZ > 0 && (absX === absZ || Math.min(absX, absZ) >= 2)) {
        // Check diagonal X-crossing conflict before taking diagonal step
        if (!this.hasCrossingDiagonal(cx, cz, cx + sx, cz + sz)) {
          cx += sx;
          cz += sz;
          path.push({ x: cx, z: cz });
          continue;
        }
      }

      if (absX >= absZ && sx !== 0) {
        cx += sx;
      } else if (sz !== 0) {
        cz += sz;
      }
      path.push({ x: cx, z: cz });
    }
    return path;
  }

  private hasCrossingDiagonal(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) return false;
    // Check perpendicular diagonal between (x0 + dx, z0) and (x0, z0 + dz)
    const ax = x0 + dx;
    const az = z0;
    const bx = x0;
    const bz = z0 + dz;
    if (!this.inBounds(ax, az) || !this.inBounds(bx, bz)) return false;
    const aMask = this.roadMask[this.idx(ax, az)];
    const bdx = bx - ax;
    const bdz = bz - az;
    const match = DIR_OFFSETS.find((d) => d.dx === bdx && d.dz === bdz);
    return match ? (aMask & match.bit) !== 0 : false;
  }

  public estimateRoadPathCost(
    path: { x: number; z: number }[],
    tier: RoadTier
  ): { cost: number; valid: boolean; hasBridge: boolean; reason?: string } {
    const spec = ROAD_CATALOG[tier];
    if (!this.sandboxMode && this.population < spec.unlockPop) {
      return {
        cost: 0,
        valid: false,
        hasBridge: false,
        reason: `Requiere ${spec.unlockPop.toLocaleString()} hab.`,
      };
    }

    let cost = 0;
    let hasBridge = false;

    for (const pt of path) {
      if (!this.isTileUnlockedAt(pt.x, pt.z)) {
        return {
          cost,
          valid: false,
          hasBridge,
          reason: 'Fuera de tus parcelas compradas.',
        };
      }
      const i = this.idx(pt.x, pt.z);
      if (this.terrain[i] === TerrainKind.Mountain) {
        return { cost, valid: false, hasBridge, reason: 'Pendiente rocosa demasiado pronunciada.' };
      }
      if (this.structureGrid[i] !== -1) {
        return { cost, valid: false, hasBridge, reason: 'Ocupado por un edificio municipal.' };
      }
      const isWater = isWaterTerrain(this.terrain[i]);
      if (isWater) hasBridge = true;
      if (this.roadTier[i] < tier) {
        const mult = isWater ? spec.bridgeMultiplier : 1;
        cost += Math.round(spec.costPerCell * mult);
      }
    }

    if (!this.sandboxMode && cost > this.money) {
      return { cost, valid: false, hasBridge, reason: 'Fondos insuficientes.' };
    }

    return { cost, valid: true, hasBridge };
  }

  public buildRoadPath(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    tier: RoadTier
  ): { ok: boolean; reason?: string } {
    const path = this.computeSmartRoadPath(x0, z0, x1, z1);
    const est = this.estimateRoadPathCost(path, tier);
    if (!est.valid) return { ok: false, reason: est.reason };

    this.pushUndoSnapshot();
    if (!this.sandboxMode) this.money -= est.cost;

    for (let k = 0; k < path.length; k++) {
      const cur = path[k];
      const i = this.idx(cur.x, cur.z);

      if (this.roadTier[i] < tier) {
        this.roadTier[i] = tier;
      }
      // Clear zoned building or tree on road footprint
      this.zones[i] = ZoneKind.None;
      this.rciLevel[i] = 0;
      this.rciProgress[i] = 0;
      this.trees[i] = 0;

      // Link consecutive path nodes (supports both ortho & 45° diagonal)
      if (k > 0) {
        const prev = path[k - 1];
        const dx = cur.x - prev.x;
        const dz = cur.z - prev.z;
        const dir = DIR_OFFSETS.find((d) => d.dx === dx && d.dz === dz);
        if (dir) {
          this.roadMask[this.idx(prev.x, prev.z)] |= dir.bit;
          this.roadMask[i] |= dir.opp;
        }
      }

      // Auto-snap orthogonal adjacent existing roads for instant clean T / Cross intersections
      for (const ortho of DIR_OFFSETS) {
        if (ortho.diag) continue;
        const nx = cur.x + ortho.dx;
        const nz = cur.z + ortho.dz;
        if (this.inBounds(nx, nz)) {
          const ni = this.idx(nx, nz);
          if (this.roadTier[ni] !== RoadTier.None) {
            this.roadMask[i] |= ortho.bit;
            this.roadMask[ni] |= ortho.opp;
          }
        }
      }
    }

    this.enforceZoneRoadAccess();
    this.refreshDiagonalZoneAlignment();
    this.recomputeUtilitiesAndCoverage();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playRoadPlace(est.hasBridge);
    return { ok: true };
  }

  public paintZoneRect(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    zone: ZoneKind
  ): { ok: boolean; count: number; reason?: string } {
    const spec = ZONE_CATALOG[zone];
    if (!this.sandboxMode && this.population < spec.unlockPop) {
      return {
        ok: false,
        count: 0,
        reason: `Se desbloquea a los ${spec.unlockPop.toLocaleString()} hab.`,
      };
    }

    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(GRID_SIZE - 1, Math.max(x0, x1));
    const minZ = Math.max(0, Math.min(z0, z1));
    const maxZ = Math.min(GRID_SIZE - 1, Math.max(z0, z1));

    const { targets, cost: totalCost } = this.evaluateZoneTargets(minX, maxX, minZ, maxZ, zone);

    if (targets.length === 0) {
      return {
        ok: false,
        count: 0,
        reason:
          zone === ZoneKind.None
            ? 'No hay zonas seleccionadas para limpiar.'
            : 'Las zonas solo se pueden construir con acceso directo a una Calle 2L o Avenida 4L.',
      };
    }

    if (!this.sandboxMode && totalCost > this.money) {
      return { ok: false, count: 0, reason: 'Fondos insuficientes para zonificar.' };
    }

    this.pushUndoSnapshot();
    if (!this.sandboxMode) this.money -= totalCost;

    for (const i of targets) {
      this.zones[i] = zone;
      this.rciLevel[i] = 0;
      this.rciProgress[i] = 0;
      this.rciAbandoned[i] = 0;
      this.rciVariant[i] = (i * 7 + 3) & 7;
      if (zone !== ZoneKind.None) {
        this.trees[i] = 0;
      }
    }

    this.refreshDiagonalZoneAlignment();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playZonePaint();
    return { ok: true, count: targets.length };
  }

  private evaluateZoneTargets(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    zone: ZoneKind
  ): { targets: number[]; cost: number } {
    const spec = ZONE_CATALOG[zone];
    const targets: number[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isTileUnlockedAt(x, z)) continue;
        const i = this.idx(x, z);
        if (isWaterTerrain(this.terrain[i]) || this.terrain[i] === TerrainKind.Mountain) continue;
        if (this.roadTier[i] !== RoadTier.None || this.structureGrid[i] !== -1) continue;
        if (this.zones[i] === zone) continue;
        if (zone !== ZoneKind.None && !this.hasDirectRoadAccess(x, z)) continue;
        targets.push(i);
      }
    }
    return { targets, cost: targets.length * spec.costPerCell };
  }

  public evaluateZoneRect(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    zone: ZoneKind
  ): {
    cells: { x: number; z: number; valid: boolean }[];
    validCount: number;
    billableCount: number;
    cost: number;
  } {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(GRID_SIZE - 1, Math.max(x0, x1));
    const minZ = Math.max(0, Math.min(z0, z1));
    const maxZ = Math.min(GRID_SIZE - 1, Math.max(z0, z1));
    const spec = ZONE_CATALOG[zone];
    const cells: { x: number; z: number; valid: boolean }[] = [];
    let validCount = 0;
    let billableCount = 0;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const i = this.idx(x, z);
        const unlocked = this.isTileUnlockedAt(x, z);
        const terrainOk = !isWaterTerrain(this.terrain[i]) && this.terrain[i] !== TerrainKind.Mountain;
        const free = this.roadTier[i] === RoadTier.None && this.structureGrid[i] === -1;

        let valid = false;
        let billable = false;
        if (zone === ZoneKind.None) {
          valid = unlocked && free && this.zones[i] !== ZoneKind.None;
          billable = valid;
        } else {
          const roadOk = this.hasDirectRoadAccess(x, z);
          valid = unlocked && terrainOk && free && roadOk;
          billable = valid && this.zones[i] !== zone;
        }

        if (valid) validCount++;
        if (billable) billableCount++;
        if (cells.length < 1600) {
          cells.push({ x, z, valid });
        }
      }
    }

    return {
      cells,
      validCount,
      billableCount,
      cost: billableCount * spec.costPerCell,
    };
  }

  /** Strict 4-way orthogonal adjacency to a dry-land Local2L or Avenue4L street. */
  public hasDirectRoadAccess(x: number, z: number): boolean {
    const ortho: [number, number][] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    for (const [dx, dz] of ortho) {
      const nx = x + dx;
      const nz = z + dz;
      if (!this.inBounds(nx, nz)) continue;
      const ni = this.idx(nx, nz);
      const rt = this.roadTier[ni];
      if ((rt === RoadTier.Local2L || rt === RoadTier.Avenue4L) && !isWaterTerrain(this.terrain[ni])) {
        return true;
      }
    }
    return false;
  }

  public hasNearbyZoneableRoad(x: number, z: number): boolean {
    return this.hasDirectRoadAccess(x, z);
  }

  /** Returns the Y rotation angle so an RCI building's front (+Z) faces the adjacent road. */
  public getRoadFacingAngle(x: number, z: number): number {
    const i = this.idx(x, z);
    const diag = this.rciDiag[i];
    if (diag === 1) return Math.PI / 4;
    if (diag === 2) return -Math.PI / 4;

    const dirs: [number, number, number][] = [
      [0, 1, 0],
      [1, 0, Math.PI / 2],
      [0, -1, Math.PI],
      [-1, 0, -Math.PI / 2],
    ];
    for (const [dx, dz, ang] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      if (!this.inBounds(nx, nz)) continue;
      const ni = this.idx(nx, nz);
      if (this.roadTier[ni] === RoadTier.Avenue4L && !isWaterTerrain(this.terrain[ni])) {
        return ang;
      }
    }
    for (const [dx, dz, ang] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      if (!this.inBounds(nx, nz)) continue;
      const ni = this.idx(nx, nz);
      if (this.roadTier[ni] === RoadTier.Local2L && !isWaterTerrain(this.terrain[ni])) {
        return ang;
      }
    }
    return ((this.rciVariant[i] & 3) * Math.PI) / 2;
  }

  /** Immediately removes any zoned cells or RCI buildings lacking direct road access. */
  public enforceZoneRoadAccess(): number {
    let cleared = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.zones[i] === ZoneKind.None) continue;
      const x = i % GRID_SIZE;
      const z = Math.floor(i / GRID_SIZE);
      if (!this.hasDirectRoadAccess(x, z)) {
        this.zones[i] = ZoneKind.None;
        this.rciLevel[i] = 0;
        this.rciProgress[i] = 0;
        this.rciAbandoned[i] = 0;
        this.rciDiag[i] = 0;
        this.cellFire[i] = 0;
        cleared++;
      }
    }
    return cleared;
  }

  private refreshDiagonalZoneAlignment() {
    const diagMask = DIR_NE | DIR_NW | DIR_SE | DIR_SW;
    const orthoMask = DIR_N | DIR_S | DIR_E | DIR_W;
    for (let z = 1; z < GRID_SIZE - 1; z++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        const i = this.idx(x, z);
        if (this.zones[i] === ZoneKind.None) {
          this.rciDiag[i] = 0;
          continue;
        }
        let diagMode = 0;
        for (const off of DIR_OFFSETS) {
          const nx = x + off.dx;
          const nz = z + off.dz;
          const ni = this.idx(nx, nz);
          if (this.roadTier[ni] === RoadTier.None) continue;
          const m = this.roadMask[ni];
          if ((m & diagMask) !== 0 && (m & orthoMask) === 0) {
            diagMode = (m & (DIR_NE | DIR_SW)) !== 0 ? 1 : 2;
            break;
          }
        }
        this.rciDiag[i] = diagMode;
      }
    }
  }

  public canPlaceStructure(
    buildingId: SpecialBuildingId,
    x: number,
    z: number,
    rotation: 0 | 1 | 2 | 3
  ): { ok: boolean; cost: number; w: number; d: number; reason?: string } {
    const spec = BUILDING_SPECS[buildingId];
    const w = rotation % 2 === 1 ? spec.d : spec.w;
    const d = rotation % 2 === 1 ? spec.w : spec.d;

    if (!this.sandboxMode && this.population < spec.unlockPop) {
      return {
        ok: false,
        cost: spec.cost,
        w,
        d,
        reason: `Requiere ${spec.unlockPop.toLocaleString()} hab.`,
      };
    }

    if (spec.uniqueMonument && this.structures.some((s) => s.buildingId === buildingId)) {
      return {
        ok: false,
        cost: spec.cost,
        w,
        d,
        reason: 'Este Monumento Único ya fue construido en tu ciudad.',
      };
    }

    let touchesWater = false;

    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        if (!this.inBounds(cx, cz) || !this.isTileUnlockedAt(cx, cz)) {
          return { ok: false, cost: spec.cost, w, d, reason: 'Fuera de las parcelas desbloqueadas.' };
        }
        const i = this.idx(cx, cz);
        if (isWaterTerrain(this.terrain[i]) || this.terrain[i] === TerrainKind.Mountain) {
          return { ok: false, cost: spec.cost, w, d, reason: 'Terreno no apto (agua o cumbre).' };
        }
        if (this.roadTier[i] !== RoadTier.None || this.structureGrid[i] !== -1) {
          return { ok: false, cost: spec.cost, w, d, reason: 'Espacio ocupado por vía o edificio.' };
        }
        // Check adjacent water if required (e.g., river water pump)
        if (spec.requiresWaterEdge) {
          for (const off of DIR_OFFSETS) {
            const wx = cx + off.dx;
            const wz = cz + off.dz;
            if (this.inBounds(wx, wz) && isWaterTerrain(this.terrain[this.idx(wx, wz)])) {
              touchesWater = true;
            }
          }
        }
      }
    }

    if (spec.requiresWaterEdge && !touchesWater) {
      return {
        ok: false,
        cost: spec.cost,
        w,
        d,
        reason: 'Debe instalarse en la orilla de un río o bahía.',
      };
    }

    if (!this.sandboxMode && this.money < spec.cost) {
      return { ok: false, cost: spec.cost, w, d, reason: 'Fondos insuficientes.' };
    }

    return { ok: true, cost: spec.cost, w, d };
  }

  public placeStructure(
    buildingId: SpecialBuildingId,
    x: number,
    z: number,
    rotation: 0 | 1 | 2 | 3
  ): { ok: boolean; reason?: string } {
    const check = this.canPlaceStructure(buildingId, x, z, rotation);
    if (!check.ok) return { ok: false, reason: check.reason };

    const spec = BUILDING_SPECS[buildingId];
    this.pushUndoSnapshot();
    if (!this.sandboxMode) this.money -= spec.cost;

    const id = this.nextStructureId++;
    const record: PlacedStructure = {
      id,
      buildingId,
      x,
      z,
      w: check.w,
      d: check.d,
      rotation,
      powered: true,
      watered: true,
      onFire: 0,
    };
    this.structures.push(record);

    for (let dz = 0; dz < check.d; dz++) {
      for (let dx = 0; dx < check.w; dx++) {
        const i = this.idx(x + dx, z + dz);
        this.structureGrid[i] = id;
        this.zones[i] = ZoneKind.None;
        this.rciLevel[i] = 0;
        this.trees[i] = 0;
      }
    }

    this.recomputeUtilitiesAndCoverage();
    this.recomputeLandValueAndPollution();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playBuildStructure(Boolean(spec.uniqueMonument));

    if (spec.uniqueMonument) {
      this.pushChirp(
        'Hito Histórico',
        '@PrensaFox',
        `¡Se inauguró ${spec.name}! Miles de visitantes y empresas celebran la nueva maravilla urbana.`,
        'positive'
      );
    }

    return { ok: true };
  }

  public bulldozeArea(x0: number, z0: number, x1: number, z1: number): { removed: number } {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(GRID_SIZE - 1, Math.max(x0, x1));
    const minZ = Math.max(0, Math.min(z0, z1));
    const maxZ = Math.min(GRID_SIZE - 1, Math.max(z0, z1));

    let removed = 0;
    let pushedUndo = false;
    const ensureUndo = () => {
      if (!pushedUndo) {
        this.pushUndoSnapshot();
        pushedUndo = true;
      }
    };

    const structIdsToDelete = new Set<number>();

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isTileUnlockedAt(x, z)) continue;
        // Protect regional border highway stub at z <= 36
        if (x === 52 && z <= 36) continue;
        const i = this.idx(x, z);

        if (this.structureGrid[i] !== -1) {
          structIdsToDelete.add(this.structureGrid[i]);
        }

        if (this.roadTier[i] !== RoadTier.None) {
          ensureUndo();
          this.roadTier[i] = RoadTier.None;
          const m = this.roadMask[i];
          this.roadMask[i] = 0;
          for (const off of DIR_OFFSETS) {
            if ((m & off.bit) !== 0 && this.inBounds(x + off.dx, z + off.dz)) {
              this.roadMask[this.idx(x + off.dx, z + off.dz)] &= ~off.opp;
            }
          }
          removed++;
        }

        if (this.zones[i] !== ZoneKind.None || this.rciLevel[i] > 0) {
          ensureUndo();
          this.zones[i] = ZoneKind.None;
          this.rciLevel[i] = 0;
          this.rciProgress[i] = 0;
          this.rciAbandoned[i] = 0;
          this.cellFire[i] = 0;
          removed++;
        }
      }
    }

    if (structIdsToDelete.size > 0) {
      ensureUndo();
      for (const sid of structIdsToDelete) {
        const st = this.structures.find((s) => s.id === sid);
        if (st?.buildingId === 'metro_station') {
          this.metroSegments = this.metroSegments.filter(
            (seg) =>
              !(
                (Math.abs(seg.fromX - st.x) <= 2 && Math.abs(seg.fromZ - st.z) <= 2) ||
                (Math.abs(seg.toX - st.x) <= 2 && Math.abs(seg.toZ - st.z) <= 2)
              )
          );
        }
      }
      this.structures = this.structures.filter((s) => !structIdsToDelete.has(s.id));
      this.rebuildStructureGrid();
      removed += structIdsToDelete.size;
    }

    const orphanCleared = this.enforceZoneRoadAccess();
    if (orphanCleared > 0) {
      removed += orphanCleared;
    }

    if (removed > 0) {
      this.refreshDiagonalZoneAlignment();
      this.recomputeUtilitiesAndCoverage();
      this.recomputeLandValueAndPollution();
      this.meshVersion++;
      this.overlayVersion++;
      this.dirtySync = true;
      soundFX.playBulldoze();
    }

    return { removed };
  }

  // --- Public Transit: Bus Lines & Underground Metro ---
  public addBusStopTap(x: number, z: number): { ok: boolean; message: string; completed?: boolean } {
    if (!this.sandboxMode && this.population < 600) {
      return { ok: false, message: 'Las líneas de autobús se desbloquean a los 600 hab.' };
    }
    const hasDepot = this.structures.some((s) => s.buildingId === 'bus_depot');
    if (!hasDepot) {
      return { ok: false, message: 'Construye primero una Terminal de Autobuses.' };
    }

    // Snap to nearest road cell within radius 2
    let roadPt: TransitStopPoint | null = null;
    let bestD = 99;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        if (this.roadTier[this.idx(nx, nz)] !== RoadTier.None) {
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            roadPt = { x: nx, z: nz };
          }
        }
      }
    }

    if (!roadPt) {
      return { ok: false, message: 'Toca sobre una calle o avenida para colocar la parada.' };
    }

    if (this.draftBusStops.length >= 2) {
      const first = this.draftBusStops[0];
      if (Math.hypot(first.x - roadPt.x, first.z - roadPt.z) <= 2.5) {
        return this.finishDraftBusLine();
      }
    }

    this.draftBusStops.push(roadPt);
    soundFX.playClick();

    if (this.draftBusStops.length >= 5) {
      return this.finishDraftBusLine();
    }

    return {
      ok: true,
      message: `Parada #${this.draftBusStops.length} añadida. Añade otra parada o toca la 1ª para cerrar la línea.`,
    };
  }

  public finishDraftBusLine(): { ok: boolean; message: string; completed?: boolean } {
    if (this.draftBusStops.length < 2) {
      this.draftBusStops = [];
      return { ok: false, message: 'Se necesitan al menos 2 paradas para crear una línea.' };
    }
    this.pushUndoSnapshot();
    const num = this.busLines.length + 1;
    const color = BUS_LINE_COLORS[(num - 1) % BUS_LINE_COLORS.length];
    this.busLines.push({
      id: `bus-${Date.now().toString(36)}`,
      name: `Línea Bus L${num}`,
      color,
      stops: [...this.draftBusStops],
      ridership: 80,
    });
    this.draftBusStops = [];
    this.recomputeUtilitiesAndCoverage();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playBuildStructure(false);
    return { ok: true, completed: true, message: `¡Línea Bus L${num} en servicio activo!` };
  }

  public buildMetroTunnel(
    x0: number,
    z0: number,
    x1: number,
    z1: number
  ): { ok: boolean; reason?: string } {
    if (!this.sandboxMode && this.population < 4500) {
      return { ok: false, reason: 'El Metro Subterráneo se desbloquea a los 4,500 hab.' };
    }
    const findStationNear = (tx: number, tz: number) =>
      this.structures.find(
        (s) =>
          s.buildingId === 'metro_station' &&
          Math.hypot(s.x + s.w * 0.5 - tx, s.z + s.d * 0.5 - tz) <= 5.5
      );

    const stA = findStationNear(x0, z0);
    const stB = findStationNear(x1, z1);
    if (!stA || !stB || stA.id === stB.id) {
      return {
        ok: false,
        reason: 'Arrastra desde una Estación de Metro hasta otra Estación de Metro.',
      };
    }

    const ax = Math.round(stA.x + stA.w * 0.5);
    const az = Math.round(stA.z + stA.d * 0.5);
    const bx = Math.round(stB.x + stB.w * 0.5);
    const bz = Math.round(stB.z + stB.d * 0.5);

    const exists = this.metroSegments.some(
      (m) =>
        (m.fromX === ax && m.fromZ === az && m.toX === bx && m.toZ === bz) ||
        (m.fromX === bx && m.fromZ === bz && m.toX === ax && m.toZ === az)
    );
    if (exists) {
      return { ok: false, reason: 'Esas dos estaciones ya están conectadas por túnel.' };
    }

    const dist = Math.hypot(bx - ax, bz - az);
    const cost = Math.round(dist * 180);
    if (!this.sandboxMode && this.money < cost) {
      return { ok: false, reason: `Fondos insuficientes para excavar túnel ($${cost.toLocaleString()}).` };
    }

    this.pushUndoSnapshot();
    if (!this.sandboxMode) this.money -= cost;

    this.metroSegments.push({
      id: `metro-${Date.now().toString(36)}`,
      fromX: ax,
      fromZ: az,
      toX: bx,
      toZ: bz,
      color: '#06b6d4',
    });

    this.recomputeUtilitiesAndCoverage();
    this.meshVersion++;
    this.overlayVersion++;
    this.dirtySync = true;
    soundFX.playBuildStructure(false);
    return { ok: true };
  }

  // --- Loans & Disasters ---
  public takeLoan(loanId: ' municipal_25k' | 'metro_80k'): { ok: boolean; reason?: string } {
    if (this.loans.some((l) => l.id === loanId)) {
      return { ok: false, reason: 'Ya tienes este bono activo.' };
    }
    const cfg =
      loanId === ' municipal_25k'
        ? {
            id: loanId,
            name: 'Bono Municipal Rápido',
            principal: 25000,
            remaining: 26500,
            interestRate: 6,
            tickPayment: 45,
          }
        : {
            id: loanId,
            name: 'Bono Infraestructura Metro',
            principal: 80000,
            remaining: 86400,
            interestRate: 8,
            tickPayment: 135,
          };
    this.loans.push(cfg);
    this.money += cfg.principal;
    this.dirtySync = true;
    soundFX.playBuildStructure(false);
    return { ok: true };
  }

  public repayLoan(loanId: ' municipal_25k' | 'metro_80k'): boolean {
    const idx = this.loans.findIndex((l) => l.id === loanId);
    if (idx === -1) return false;
    const loan = this.loans[idx];
    if (!this.sandboxMode && this.money < loan.remaining) return false;
    if (!this.sandboxMode) this.money -= loan.remaining;
    this.loans.splice(idx, 1);
    this.dirtySync = true;
    soundFX.playClick();
    return true;
  }

  public triggerDisaster(kind: DisasterKind, targetX?: number, targetZ?: number) {
    // Pick a populated area or center of unlocked city
    let cx = targetX ?? 54;
    let cz = targetZ ?? 54;

    if (targetX === undefined || targetZ === undefined) {
      const builtIndices: number[] = [];
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (this.rciLevel[i] > 0) builtIndices.push(i);
      }
      if (builtIndices.length > 0) {
        const pick = builtIndices[Math.floor(Math.random() * builtIndices.length)];
        cx = pick % GRID_SIZE;
        cz = Math.floor(pick / GRID_SIZE);
      }
    }

    const ev: ActiveDisasterEvent = {
      id: `dis-${Date.now().toString(36)}`,
      kind,
      x: cx,
      z: cz,
      vx: Math.cos(this.windAngleRad) * 0.45,
      vz: Math.sin(this.windAngleRad) * 0.45,
      radius: kind === 'meteor_strike' ? 4 : kind === 'tornado' ? 3 : 5,
      ticksLeft: kind === 'meteor_strike' ? 24 : 45,
      maxTicks: kind === 'meteor_strike' ? 24 : 45,
    };

    if (kind === 'meteor_strike') {
      // Immediate crater blast + ignite outer ring
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = Math.round(cx + dx);
          const nz = Math.round(cz + dz);
          if (!this.inBounds(nx, nz)) continue;
          const dist = Math.hypot(dx, dz);
          const idx = this.idx(nx, nz);
          if (dist <= 2.4) {
            this.rciLevel[idx] = 0;
            this.rciProgress[idx] = 0;
            this.cellFire[idx] = 85;
            if (nx !== 52 || nz > 36) {
              this.roadTier[idx] = RoadTier.None;
              this.roadMask[idx] = 0;
            }
          } else if (dist <= 4.2 && this.rciLevel[idx] > 0) {
            this.cellFire[idx] = 75;
          }
        }
      }
      this.enforceZoneRoadAccess();
      this.pushChirp(
        'Defensa Civil',
        '@AlertaFox',
        '☄️ ¡Impacto de meteorito registrado! Envía cobertura de bomberos y reconstruye las arterias dañadas.',
        'urgent'
      );
    } else if (kind === 'industrial_fire') {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = Math.round(cx + dx);
          const nz = Math.round(cz + dz);
          if (this.inBounds(nx, nz) && this.rciLevel[this.idx(nx, nz)] > 0) {
            this.cellFire[this.idx(nx, nz)] = 85;
          }
        }
      }
      this.pushChirp(
        'Cuerpo de Bomberos',
        '@BomberosFox',
        '🔥 ¡Incendio declarado! Los parques de bomberos cercanos están despachando unidades.',
        'urgent'
      );
    } else if (kind === 'tornado') {
      this.weather = 'rain';
      this.pushChirp(
        'Servicio Meteorológico',
        '@ClimaFox',
        '🌪️ ¡Alerta de Tornado F4 atravesando el corredor metropolitano!',
        'urgent'
      );
    } else {
      this.weather = 'rain';
      this.pushChirp(
        'Red Eléctrica y Costas',
        '@EnergiaFox',
        '🌊 Tormenta severa: menor generación solar y crecida en riberas bajas.',
        'warning'
      );
    }

    this.activeDisasters.push(ev);
    this.meshVersion++;
    this.overlayVersion++;
    soundFX.playDisasterAlert();
  }

  // --- Simulation Tick (Amortized 4-phase engine) ---
  public stepSimulationTick() {
    if (this.simSpeed === 0) return;

    this.simTick++;
    if (this.autoDayNight) {
      this.timeOfDay = (this.timeOfDay + 0.08) % 24;
      if (this.timeOfDay < 0.08) {
        this.day++;
      }
    } else if (this.simTick % 60 === 0) {
      this.day++;
    }

    // Subtle weather shift when no flood/tornado is forcing rain
    if (this.activeDisasters.length === 0 && this.simTick % 140 === 0) {
      this.weather = Math.random() < 0.16 ? 'rain' : 'clear';
    }

    const phase = this.simTick % 4;
    if (phase === 0) {
      this.recomputeUtilitiesAndCoverage();
    } else if (phase === 1) {
      this.recomputeLandValueAndPollution();
    } else if (phase === 2) {
      this.stepRciOrganicEvolution();
    } else {
      this.stepDisastersAndFires();
      this.recomputePopulationAndEconomy(true);
    }

    this.overlayVersion++;
  }

  public recomputeUtilitiesAndCoverage() {
    this.powerMap.fill(0);
    this.waterMap.fill(0);
    this.serviceMap.fill(0);
    this.transitMap.fill(0);

    const mapCfg = MAP_ARCHETYPES.find((m) => m.id === this.mapId) || MAP_ARCHETYPES[0];
    const hasStormPenalty = this.activeDisasters.some((d) => d.kind === 'coastal_flood');

    let prodMW = 0;
    let consMW = 0;
    let prodML = 0;
    let consML = 0;

    // 1. Apply power/water generation & direct radii from structures
    for (const s of this.structures) {
      const spec = BUILDING_SPECS[s.buildingId];
      const cx = s.x + s.w * 0.5;
      const cz = s.z + s.d * 0.5;

      if (spec.powerMW > 0) {
        let out = spec.powerMW;
        if (s.buildingId === 'wind_turbine') {
          const h = this.elevation[this.idx(s.x, s.z)];
          out *= mapCfg.windBonus * (h > 2.8 ? 1.25 : 1.0);
        }
        if (s.buildingId === 'solar_plant' && hasStormPenalty) {
          out *= 0.68;
        }
        prodMW += Math.round(out);
        this.fillCircleBinary(this.powerMap, cx, cz, spec.serviceRadius);
      } else {
        consMW += Math.abs(spec.powerMW);
      }

      if (spec.waterML > 0) {
        prodML += spec.waterML;
        this.fillCircleBinary(this.waterMap, cx, cz, spec.serviceRadius);
      } else {
        consML += Math.abs(spec.waterML);
      }

      if (
        spec.category === 'service' ||
        spec.category === 'park' ||
        spec.category === 'monument'
      ) {
        const boost = spec.category === 'monument' ? 42 : spec.category === 'service' ? 28 : 18;
        this.addCircleScore(this.serviceMap, cx, cz, spec.serviceRadius, boost);
      }

      if (s.buildingId === 'metro_station') {
        this.addCircleScore(this.transitMap, cx, cz, 17, 55);
      } else if (s.buildingId === 'bus_depot') {
        this.addCircleScore(this.transitMap, cx, cz, 12, 20);
      }
    }

    // Bus stops boost transit coverage
    for (const line of this.busLines) {
      for (const st of line.stops) {
        this.addCircleScore(this.transitMap, st.x, st.z, 11, 38);
      }
    }

    // 2. Propagate Power & Water along connected roads and built parcels (BFS)
    const pQueue: number[] = [];
    const wQueue: number[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.powerMap[i]) pQueue.push(i);
      if (this.waterMap[i]) wQueue.push(i);
      if (this.rciLevel[i] > 0) {
        const lv = this.rciLevel[i];
        consMW += lv * 0.35;
        consML += lv * 0.3;
      }
    }

    this.bfsConductiveSpread(this.powerMap, pQueue);
    this.bfsConductiveSpread(this.waterMap, wQueue);

    // Global brownout check if consumption vastly exceeds production
    this.powerProducedMW = Math.round(prodMW);
    this.powerConsumedMW = Math.round(consMW);
    this.waterProducedML = Math.round(prodML);
    this.waterConsumedML = Math.round(consML);

    if (!this.sandboxMode && prodMW < consMW * 0.75 && consMW > 10) {
      // Partial brownout at far cells
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if ((i * 13) % 5 === 0) this.powerMap[i] = 0;
      }
    }
    if (!this.sandboxMode && prodML < consML * 0.75 && consML > 10) {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if ((i * 17) % 5 === 0) this.waterMap[i] = 0;
      }
    }

    for (const s of this.structures) {
      const i = this.idx(s.x, s.z);
      s.powered = this.powerMap[i] === 1 || BUILDING_SPECS[s.buildingId].powerMW > 0;
      s.watered = this.waterMap[i] === 1 || BUILDING_SPECS[s.buildingId].waterML >= 0;
    }
  }

  private bfsConductiveSpread(mask: Uint8Array, queue: number[]) {
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const x = cur % GRID_SIZE;
      const z = Math.floor(cur / GRID_SIZE);

      // Conducts through roads, structures, and zoned cells within 2 steps
      const isConductor =
        this.roadTier[cur] !== RoadTier.None ||
        this.structureGrid[cur] !== -1 ||
        this.zones[cur] !== ZoneKind.None;
      if (!isConductor) continue;

      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > 4) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (!this.inBounds(nx, nz)) continue;
          const ni = this.idx(nx, nz);
          if (mask[ni]) continue;
          if (
            this.roadTier[ni] !== RoadTier.None ||
            this.zones[ni] !== ZoneKind.None ||
            this.structureGrid[ni] !== -1
          ) {
            mask[ni] = 1;
            queue.push(ni);
          }
        }
      }
    }
  }

  private fillCircleBinary(arr: Uint8Array, cx: number, cz: number, r: number) {
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(GRID_SIZE - 1, Math.ceil(cx + r));
    const minZ = Math.max(0, Math.floor(cz - r));
    const maxZ = Math.min(GRID_SIZE - 1, Math.ceil(cz + r));
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) <= r2) {
          arr[this.idx(x, z)] = 1;
        }
      }
    }
  }

  private addCircleScore(arr: Uint8Array, cx: number, cz: number, r: number, maxBoost: number) {
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(GRID_SIZE - 1, Math.ceil(cx + r));
    const minZ = Math.max(0, Math.floor(cz - r));
    const maxZ = Math.min(GRID_SIZE - 1, Math.ceil(cz + r));
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d <= r) {
          const i = this.idx(x, z);
          const falloff = 1 - d / (r + 0.001);
          arr[i] = Math.min(100, arr[i] + Math.round(maxBoost * falloff));
        }
      }
    }
  }

  public recomputeLandValueAndPollution() {
    this.pollutionMap.fill(0);
    this.trafficMap.fill(0);

    const wx = Math.cos(this.windAngleRad);
    const wz = Math.sin(this.windAngleRad);

    // 1. Industrial & Power plant pollution advected along wind vector
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = this.idx(x, z);
        if (this.zones[i] === ZoneKind.Industrial && this.rciLevel[i] > 0 && !this.rciAbandoned[i]) {
          const strength = 14 + this.rciLevel[i] * 5;
          this.addCircleScore(
            this.pollutionMap,
            x + wx * 3.5,
            z + wz * 3.5,
            8,
            strength
          );
        }
      }
    }

    for (const s of this.structures) {
      const spec = BUILDING_SPECS[s.buildingId];
      const cx = s.x + s.w * 0.5;
      const cz = s.z + s.d * 0.5;
      if (spec.pollution > 0) {
        this.addCircleScore(
          this.pollutionMap,
          cx + wx * 5,
          cz + wz * 5,
          14,
          spec.pollution
        );
      } else if (spec.pollution < 0) {
        // Eco scrubbers / parks clean air locally
        const r = 12;
        const minX = Math.max(0, Math.floor(cx - r));
        const maxX = Math.min(GRID_SIZE - 1, Math.ceil(cx + r));
        const minZ = Math.max(0, Math.floor(cz - r));
        const maxZ = Math.min(GRID_SIZE - 1, Math.ceil(cz + r));
        for (let zz = minZ; zz <= maxZ; zz++) {
          for (let xx = minX; xx <= maxX; xx++) {
            const idx = this.idx(xx, zz);
            this.pollutionMap[idx] = Math.max(0, this.pollutionMap[idx] + Math.round(spec.pollution * 0.6));
          }
        }
      }
    }

    // 2. Road traffic load (mitigated by Bus & Metro transit coverage!)
    let trafficSum = 0;
    let roadCount = 0;
    const metroNetworkBonus = Math.min(0.45, this.metroSegments.length * 0.09);

    for (let z = 1; z < GRID_SIZE - 1; z++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        const i = this.idx(x, z);
        const tier = this.roadTier[i] as RoadTier;
        if (tier === RoadTier.None) continue;
        roadCount++;

        let localDemand = 8;
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            const ni = this.idx(x + dx, z + dz);
            const lv = this.rciLevel[ni];
            if (lv > 0 && !this.rciAbandoned[ni]) {
              const zKind = this.zones[ni];
              const mult =
                zKind === ZoneKind.ComHigh || zKind === ZoneKind.ResHigh
                  ? 3.2
                  : zKind === ZoneKind.Industrial
                  ? 2.6
                  : 1.4;
              localDemand += lv * mult;
            }
          }
        }

        const transitRelief = 1 - Math.min(0.62, (this.transitMap[i] / 100) * 0.48 + metroNetworkBonus);
        const cap = ROAD_CATALOG[tier].capacity;
        const loadPct = Math.min(100, Math.round(((localDemand * transitRelief) / cap) * 58));
        this.trafficMap[i] = loadPct;
        trafficSum += loadPct;
      }
    }
    this.avgTraffic = roadCount > 0 ? Math.round(trafficSum / roadCount) : 0;

    // 3. Land Value calculation (waterfront, parks, services, monuments - pollution)
    const hasFoxTower = this.structures.some((s) => s.buildingId === 'monument_fox_tower');
    let lvSum = 0;
    let pollSum = 0;
    let unlockedCells = 0;

    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = this.idx(x, z);
        let val = 32;
        if (this.terrain[i] === TerrainKind.Beach) val += 22;
        if (this.terrain[i] === TerrainKind.Fertile) val += 8;
        // Waterfront bonus
        for (const off of DIR_OFFSETS) {
          const nx = x + off.dx * 2;
          const nz = z + off.dz * 2;
          if (this.inBounds(nx, nz) && isWaterTerrain(this.terrain[this.idx(nx, nz)])) {
            val += 5;
          }
        }
        val += Math.round(this.serviceMap[i] * 0.45);
        val += Math.round(this.transitMap[i] * 0.25);
        if (hasFoxTower) val += 16;
        val -= Math.round(this.pollutionMap[i] * 0.65);

        const clamped = Math.max(5, Math.min(100, val));
        this.landValueMap[i] = clamped;

        if (this.isTileUnlockedAt(x, z) && !isWaterTerrain(this.terrain[i])) {
          lvSum += clamped;
          pollSum += this.pollutionMap[i];
          unlockedCells++;
        }
      }
    }

    for (const s of this.structures) {
      const spec = BUILDING_SPECS[s.buildingId];
      if (spec.landValueBoost > 0) {
        this.addCircleScore(
          this.landValueMap,
          s.x + s.w * 0.5,
          s.z + s.d * 0.5,
          spec.serviceRadius * 0.85,
          spec.landValueBoost
        );
      }
    }

    this.avgLandValue = unlockedCells > 0 ? Math.round(lvSum / unlockedCells) : 40;
    this.avgPollution = unlockedCells > 0 ? Math.round(pollSum / unlockedCells) : 0;
  }

  private stepRciOrganicEvolution() {
    let geometryMutated = false;

    for (let z = 1; z < GRID_SIZE - 1; z++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        const i = this.idx(x, z);
        const zKind = this.zones[i] as ZoneKind;
        if (zKind === ZoneKind.None) continue;
        if (!this.hasDirectRoadAccess(x, z)) {
          this.zones[i] = ZoneKind.None;
          this.rciLevel[i] = 0;
          this.rciProgress[i] = 0;
          this.rciAbandoned[i] = 0;
          this.rciDiag[i] = 0;
          this.cellFire[i] = 0;
          geometryMutated = true;
          continue;
        }
        if (this.cellFire[i] > 0) continue;

        const hasPower = this.powerMap[i] === 1;
        const hasWater = this.waterMap[i] === 1;
        const lv = this.rciLevel[i];

        const sectorDemand =
          zKind === ZoneKind.ResLow || zKind === ZoneKind.ResHigh
            ? this.demand.residential
            : zKind === ZoneKind.ComLow || zKind === ZoneKind.ComHigh
            ? this.demand.commercial
            : this.demand.industrial;

        const sectorTax =
          zKind === ZoneKind.ResLow || zKind === ZoneKind.ResHigh
            ? this.taxes.residential
            : zKind === ZoneKind.ComLow || zKind === ZoneKind.ComHigh
            ? this.taxes.commercial
            : this.taxes.industrial;

        if (lv === 0) {
          // Spawn Level 1 building organically if utilities & road & demand exist
          if (hasPower && hasWater && sectorDemand > 18 && this.hasNearbyZoneableRoad(x, z)) {
            this.rciProgress[i] += Math.round(16 + sectorDemand * 0.35);
            if (this.rciProgress[i] >= 100) {
              this.rciLevel[i] = 1;
              this.rciProgress[i] = 20;
              this.rciAbandoned[i] = 0;
              geometryMutated = true;
            }
          }
          continue;
        }

        // Existing building: check abandonment / recovery
        if (!hasPower || !hasWater || sectorTax >= 18) {
          this.rciProgress[i] -= 22;
          if (this.rciProgress[i] <= -70 && !this.rciAbandoned[i]) {
            this.rciAbandoned[i] = 1;
            geometryMutated = true;
          }
          continue;
        } else if (this.rciAbandoned[i]) {
          this.rciAbandoned[i] = 0;
          this.rciProgress[i] = 15;
          geometryMutated = true;
        }

        // Desirability score for Level 1 -> 5 evolution
        if (lv < 5) {
          const desirability =
            this.landValueMap[i] * 0.52 +
            this.serviceMap[i] * 0.38 +
            this.transitMap[i] * 0.24 -
            (zKind === ZoneKind.Industrial ? 0 : this.pollutionMap[i] * 0.55) -
            (sectorTax - 9) * 4.5;

          const targetThreshold = lv * 19; // Lv1->2: 19, Lv2->3: 38, Lv3->4: 57, Lv4->5: 76
          if (desirability >= targetThreshold && sectorDemand > 12) {
            this.rciProgress[i] += 18;
            if (this.rciProgress[i] >= 100) {
              this.rciLevel[i] = (lv + 1) as 1 | 2 | 3 | 4 | 5;
              this.rciProgress[i] = 15;
              geometryMutated = true;
            }
          }
        }
      }
    }

    if (geometryMutated) {
      this.meshVersion++;
      this.dirtySync = true;
    }
  }

  private stepDisastersAndFires() {
    // Optional random disaster trigger (very rare so it stays fun)
    if (
      this.randomDisastersEnabled &&
      this.activeDisasters.length === 0 &&
      this.population >= 450 &&
      this.simTick % 180 === 0 &&
      Math.random() < 0.22
    ) {
      const kinds: DisasterKind[] = [
        'industrial_fire',
        'coastal_flood',
        'tornado',
        'meteor_strike',
      ];
      this.triggerDisaster(kinds[Math.floor(Math.random() * kinds.length)]);
    }

    let mutated = false;

    // Step active disasters
    for (let idx = this.activeDisasters.length - 1; idx >= 0; idx--) {
      const d = this.activeDisasters[idx];
      d.ticksLeft--;

      if (d.kind === 'tornado') {
        d.x += d.vx;
        d.z += d.vz;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = Math.round(d.x + dx);
            const nz = Math.round(d.z + dz);
            if (!this.inBounds(nx, nz)) continue;
            const ci = this.idx(nx, nz);
            if (this.rciLevel[ci] > 0 && Math.random() < 0.35) {
              this.rciLevel[ci] = Math.max(0, this.rciLevel[ci] - 2);
              mutated = true;
            }
          }
        }
      }

      if (d.ticksLeft <= 0) {
        this.activeDisasters.splice(idx, 1);
        if (this.activeDisasters.length === 0) {
          this.weather = 'clear';
        }
      }
    }

    // Fire extinguishing (by nearby fire_station) or spreading
    const fireStations = this.structures.filter((s) => s.buildingId === 'fire_station' && s.powered);
    for (let z = 1; z < GRID_SIZE - 1; z++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        const i = this.idx(x, z);
        const fire = this.cellFire[i];
        if (fire === 0) continue;

        const covered = fireStations.some(
          (fs) => Math.hypot(fs.x - x, fs.z - z) <= BUILDING_SPECS.fire_station.serviceRadius + 4
        );

        if (covered) {
          this.cellFire[i] = Math.max(0, fire - 28);
          if (this.cellFire[i] === 0) mutated = true;
        } else {
          this.cellFire[i] = Math.max(0, fire - 6);
          if (fire > 45 && Math.random() < 0.14) {
            const off = DIR_OFFSETS[Math.floor(Math.random() * 8)];
            const ni = this.idx(x + off.dx, z + off.dz);
            if (this.rciLevel[ni] > 0 && this.cellFire[ni] === 0) {
              this.cellFire[ni] = 75;
              mutated = true;
            }
          }
          if (this.cellFire[i] === 0 && this.rciLevel[i] > 0) {
            this.rciLevel[i] = 0;
            this.rciProgress[i] = 0;
            mutated = true;
          }
        }
      }
    }

    if (mutated) {
      this.meshVersion++;
    }
  }

  public recomputePopulationAndEconomy(applyCashflow: boolean) {
    let resPop = 0;
    let comJobs = 0;
    let indJobs = 0;

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const lv = this.rciLevel[i];
      if (lv === 0 || this.rciAbandoned[i]) continue;
      const z = this.zones[i] as ZoneKind;

      if (z === ZoneKind.ResLow) {
        resPop += lv * 9;
      } else if (z === ZoneKind.ResHigh) {
        resPop += lv * 34;
      } else if (z === ZoneKind.ComLow) {
        comJobs += lv * 7;
      } else if (z === ZoneKind.ComHigh) {
        comJobs += lv * 26;
      } else if (z === ZoneKind.Industrial) {
        indJobs += lv * 12;
      } else if (z === ZoneKind.Office) {
        indJobs += lv * 28;
      }
    }

    // Arcology monument resident bonus
    if (this.structures.some((s) => s.buildingId === 'monument_arcology')) {
      resPop += 2800;
      indJobs += 900;
    }

    this.population = resPop;
    this.jobsTotal = comJobs + indJobs;

    // Transit ridership
    let riders = 0;
    for (const line of this.busLines) {
      line.ridership = Math.round(Math.min(resPop * 0.18, line.stops.length * 42 + resPop * 0.04));
      riders += line.ridership;
    }
    riders += Math.round(Math.min(resPop * 0.35, this.metroSegments.length * 260));
    this.transitRiders = riders;

    // RCI Demand balance
    const hasAirport = this.structures.some((s) => s.buildingId === 'monument_airport');
    const taxPenaltyR = (this.taxes.residential - 9) * 4;
    const taxPenaltyC = (this.taxes.commercial - 9) * 4;
    const taxPenaltyI = (this.taxes.industrial - 9) * 4;

    const jobRatio = resPop > 0 ? this.jobsTotal / (resPop * 0.58) : 1.3;
    this.demand.residential = Math.max(
      8,
      Math.min(100, Math.round(58 + (jobRatio - 1) * 45 - taxPenaltyR))
    );
    this.demand.commercial = Math.max(
      8,
      Math.min(
        100,
        Math.round(46 + (resPop * 0.25 - comJobs) * 0.18 + (hasAirport ? 26 : 0) - taxPenaltyC)
      )
    );
    this.demand.industrial = Math.max(
      8,
      Math.min(100, Math.round(52 + (resPop * 0.34 - indJobs) * 0.16 - taxPenaltyI))
    );

    // Happiness
    const hasStadium = this.structures.some((s) => s.buildingId === 'monument_stadium');
    const avgTax = (this.taxes.residential + this.taxes.commercial + this.taxes.industrial) / 3;
    const rawHappy =
      68 +
      this.avgLandValue * 0.26 -
      this.avgPollution * 0.35 -
      Math.max(0, this.avgTraffic - 45) * 0.25 -
      (avgTax - 9) * 2.4 +
      (hasStadium ? 15 : 0);
    this.happiness = Math.max(15, Math.min(100, Math.round(rawHappy)));

    // Cashflow calculation
    const taxIncome = Math.round(
      resPop * 0.22 * (this.taxes.residential / 9) +
        comJobs * 0.34 * (this.taxes.commercial / 9) +
        indJobs * 0.3 * (this.taxes.industrial / 9) +
        (hasStadium ? 220 : 0) +
        (hasAirport ? 540 : 0)
    );

    let roadMaint = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const rt = this.roadTier[i] as RoadTier;
      if (rt !== RoadTier.None) {
        roadMaint += ROAD_CATALOG[rt].maintenancePerCell;
      }
    }

    let structMaint = 0;
    for (const s of this.structures) {
      structMaint += BUILDING_SPECS[s.buildingId].maintenance;
    }

    // Pioneer grace subsidy during early settlement so player never goes bankrupt in first minutes
    const pioneerSubsidy = this.simTick < 220 && this.population < 250 ? 0.45 : 1.0;
    let loanPayment = 0;
    for (let i = this.loans.length - 1; i >= 0; i--) {
      const ln = this.loans[i];
      const pay = Math.min(ln.remaining, ln.tickPayment);
      loanPayment += pay;
      if (applyCashflow) {
        ln.remaining -= pay;
        if (ln.remaining <= 0) this.loans.splice(i, 1);
      }
    }

    const totalMaint = Math.round((roadMaint + structMaint) * pioneerSubsidy + loanPayment);
    this.lastTaxIncome = taxIncome;
    this.lastMaintenanceCost = totalMaint;
    this.netIncomePerTick = taxIncome - totalMaint;

    if (applyCashflow && !this.sandboxMode) {
      this.money += this.netIncomePerTick;
      this.dirtySync = true;
    }

    // Check Milestones progression
    while (
      this.milestoneIndex + 1 < CITY_MILESTONES.length &&
      this.population >= CITY_MILESTONES[this.milestoneIndex + 1].populationRequired
    ) {
      this.milestoneIndex++;
      const m = CITY_MILESTONES[this.milestoneIndex];
      if (!this.sandboxMode) {
        this.money += m.rewardMoney;
      }
      soundFX.playMilestoneFanfare();
      this.pushChirp(
        '¡Nuevo Hito Alcanzado!',
        '@AlcaldiaFox',
        `🏆 ${this.cityName} ahora es "${m.title}" (+$${m.rewardMoney.toLocaleString()}). Desbloqueado: ${m.unlockSummary}.`,
        'positive'
      );
    }

    // Occasional citizen feedback chirp
    if (applyCashflow && this.simTick % 72 === 0) {
      this.emitCitizenContextualChirp();
    }
  }

  private emitCitizenContextualChirp() {
    if (this.powerConsumedMW > this.powerProducedMW) {
      this.pushChirp(
        'Elena Vargas',
        '@ElenaVecina',
        '⚡ Hay cortes de luz en nuestro distrito. ¡Necesitamos otra planta eléctrica pronto!',
        'urgent'
      );
    } else if (this.waterConsumedML > this.waterProducedML) {
      this.pushChirp(
        'Carlos Ruiz',
        '@RuizComercio',
        '💧 La presión del agua está cayendo en varios edificios. Revisa las bombas o torres.',
        'urgent'
      );
    } else if (this.avgTraffic > 62) {
      this.pushChirp(
        'Radio Tráfico',
        '@ViasFox',
        '🚗 Se reportan embotellamientos en hora pico. Ampliar a Avenidas 4L o abrir una línea de Autobús/Metro aliviará la carga.',
        'warning'
      );
    } else if (this.happiness > 86 && this.population > 200) {
      this.pushChirp(
        'Marco Solís',
        '@MarcoArquitecto',
        `✨ El skyline de ${this.cityName} se ve espectacular de noche. Los parques y avenidas subieron el nivel del barrio.`,
        'positive'
      );
    }
  }

  public pushChirp(
    author: string,
    handle: string,
    text: string,
    mood: 'positive' | 'warning' | 'urgent'
  ) {
    this.chirps.unshift({
      id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      author,
      handle,
      text,
      mood,
      day: this.day,
    });
    if (this.chirps.length > 16) {
      this.chirps.length = 16;
    }
  }

  public inspectCell(x: number, z: number): CellInspectInfo | null {
    if (!this.inBounds(x, z)) return null;
    const i = this.idx(x, z);
    const sid = this.structureGrid[i];
    return {
      x,
      z,
      terrain: this.terrain[i] as TerrainKind,
      elevation: Number(this.elevation[i].toFixed(2)),
      tileUnlocked: this.isTileUnlockedAt(x, z),
      tileIndex: this.getMacroTileIndex(x, z),
      roadTier: this.roadTier[i] as RoadTier,
      isBridge: this.roadTier[i] !== RoadTier.None && isWaterTerrain(this.terrain[i]),
      zone: this.zones[i] as ZoneKind,
      rciLevel: this.rciLevel[i],
      abandoned: this.rciAbandoned[i] === 1,
      onFire: this.cellFire[i],
      structure: sid !== -1 ? this.structures.find((s) => s.id === sid) || null : null,
      powered: this.powerMap[i] === 1,
      watered: this.waterMap[i] === 1,
      landValue: this.landValueMap[i],
      pollution: this.pollutionMap[i],
      traffic: this.trafficMap[i],
      serviceScore: this.serviceMap[i],
    };
  }

  public getHudSnapshot(): CityHudSnapshot {
    const curM = CITY_MILESTONES[this.milestoneIndex] || CITY_MILESTONES[0];
    const nextM = CITY_MILESTONES[this.milestoneIndex + 1] || null;
    return {
      cityId: this.cityId,
      cityName: this.cityName,
      mapId: this.mapId,
      sandboxMode: this.sandboxMode,
      day: this.day,
      timeOfDay: this.timeOfDay,
      autoDayNight: this.autoDayNight,
      weather: this.weather,
      simSpeed: this.simSpeed,
      money: this.money,
      netIncomePerTick: this.netIncomePerTick,
      lastTaxIncome: this.lastTaxIncome,
      lastMaintenanceCost: this.lastMaintenanceCost,
      population: this.population,
      jobsTotal: this.jobsTotal,
      happiness: this.happiness,
      milestoneIndex: this.milestoneIndex,
      milestoneTitle: curM.title,
      nextMilestonePop: nextM ? nextM.populationRequired : null,
      demand: { ...this.demand },
      taxes: { ...this.taxes },
      powerProducedMW: this.powerProducedMW,
      powerConsumedMW: this.powerConsumedMW,
      waterProducedML: this.waterProducedML,
      waterConsumedML: this.waterConsumedML,
      avgTraffic: this.avgTraffic,
      avgLandValue: this.avgLandValue,
      avgPollution: this.avgPollution,
      transitRiders: this.transitRiders,
      busLinesCount: this.busLines.length,
      metroStationsCount: this.structures.filter((s) => s.buildingId === 'metro_station').length,
      metroSegmentsCount: this.metroSegments.length,
      unlockedTilesMask: this.unlockedTilesMask,
      randomDisastersEnabled: this.randomDisastersEnabled,
      activeDisasters: this.activeDisasters.map((d) => ({ ...d })),
      builtMonuments: this.structures
        .filter((s) => BUILDING_SPECS[s.buildingId].uniqueMonument)
        .map((s) => s.buildingId),
      loans: this.loans.map((l) => ({ ...l })),
      chirps: this.chirps.slice(0, 8),
      canUndo: this.undoStack.length > 0,
      windAngleRad: this.windAngleRad,
    };
  }

  // --- Compact Serialization (~30 KB JSON/Base64 for instant CloudSync) ---
  public exportCompactState(): string {
    const dto = {
      v: 1,
      cityId: this.cityId,
      cityName: this.cityName,
      mapId: this.mapId,
      seed: this.seed,
      sandboxMode: this.sandboxMode,
      money: this.money,
      simTick: this.simTick,
      day: this.day,
      timeOfDay: Number(this.timeOfDay.toFixed(2)),
      autoDayNight: this.autoDayNight,
      weather: this.weather,
      taxes: this.taxes,
      milestoneIndex: this.milestoneIndex,
      unlockedTilesMask: this.unlockedTilesMask,
      randomDisastersEnabled: this.randomDisastersEnabled,
      nextStructureId: this.nextStructureId,
      structures: this.structures,
      busLines: this.busLines,
      metroSegments: this.metroSegments,
      loans: this.loans,
      chirps: this.chirps.slice(0, 6),
      b64: {
        roadTier: bytesToBase64(this.roadTier),
        roadMask: bytesToBase64(this.roadMask),
        zones: bytesToBase64(this.zones),
        rciLevel: bytesToBase64(this.rciLevel),
        rciVariant: bytesToBase64(this.rciVariant),
        rciAbandoned: bytesToBase64(this.rciAbandoned),
        trees: bytesToBase64(this.trees),
      },
    };
    return JSON.stringify(dto);
  }

  public static fromCompactState(compactJson: string): CityEngine {
    const dto = JSON.parse(compactJson);
    const eng = new CityEngine({
      cityId: dto.cityId,
      cityName: dto.cityName,
      mapId: dto.mapId,
      seed: dto.seed,
      sandboxMode: Boolean(dto.sandboxMode),
    });

    eng.money = Number(dto.money ?? 120000);
    eng.simTick = Number(dto.simTick ?? 0);
    eng.day = Number(dto.day ?? 1);
    eng.timeOfDay = Number(dto.timeOfDay ?? 10.5);
    eng.autoDayNight = dto.autoDayNight !== false;
    eng.weather = dto.weather === 'rain' ? 'rain' : 'clear';
    if (dto.taxes) eng.taxes = { ...eng.taxes, ...dto.taxes };
    eng.milestoneIndex = Number(dto.milestoneIndex ?? 0);
    eng.unlockedTilesMask = Number(dto.unlockedTilesMask ?? 1 << 4);
    eng.randomDisastersEnabled = Boolean(dto.randomDisastersEnabled);
    eng.nextStructureId = Number(dto.nextStructureId ?? 1);
    eng.structures = Array.isArray(dto.structures) ? dto.structures : [];
    eng.busLines = Array.isArray(dto.busLines) ? dto.busLines : [];
    eng.metroSegments = Array.isArray(dto.metroSegments) ? dto.metroSegments : [];
    eng.loans = Array.isArray(dto.loans) ? dto.loans : [];
    if (Array.isArray(dto.chirps) && dto.chirps.length > 0) {
      eng.chirps = dto.chirps;
    }

    if (dto.b64) {
      if (dto.b64.roadTier) eng.roadTier.set(base64ToBytes(dto.b64.roadTier, TOTAL_CELLS));
      if (dto.b64.roadMask) eng.roadMask.set(base64ToBytes(dto.b64.roadMask, TOTAL_CELLS));
      if (dto.b64.zones) eng.zones.set(base64ToBytes(dto.b64.zones, TOTAL_CELLS));
      if (dto.b64.rciLevel) eng.rciLevel.set(base64ToBytes(dto.b64.rciLevel, TOTAL_CELLS));
      if (dto.b64.rciVariant) eng.rciVariant.set(base64ToBytes(dto.b64.rciVariant, TOTAL_CELLS));
      if (dto.b64.rciAbandoned) {
        eng.rciAbandoned.set(base64ToBytes(dto.b64.rciAbandoned, TOTAL_CELLS));
      }
      if (dto.b64.trees) eng.trees.set(base64ToBytes(dto.b64.trees, TOTAL_CELLS));
    }

    eng.rebuildStructureGrid();
    eng.enforceZoneRoadAccess();
    eng.refreshDiagonalZoneAlignment();
    eng.recomputeUtilitiesAndCoverage();
    eng.recomputeLandValueAndPollution();
    eng.recomputePopulationAndEconomy(false);
    eng.meshVersion++;
    eng.overlayVersion++;
    eng.dirtySync = false;
    return eng;
  }
}
