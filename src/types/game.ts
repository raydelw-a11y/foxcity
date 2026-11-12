export const GRID_SIZE = 108;
export const TILE_BLOCKS = 3;
export const MACRO_TILE_SIZE = 36; // 3 x 36 = 108
export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE; // 11,664

export type MapArchetypeId = 'emerald_bay' | 'grand_delta' | 'alpine_valley' | 'archipelago';

export const enum TerrainKind {
  DeepWater = 0,
  ShallowWater = 1,
  Beach = 2,
  Plains = 3,
  Fertile = 4,
  Hill = 5,
  Mountain = 6,
}

export const enum RoadTier {
  None = 0,
  Local2L = 1, // 2-lane neighborhood street
  Avenue4L = 2, // 4-lane landscaped boulevard
  Highway6L = 3, // 6-lane regional expressway
}

// 8-direction bitmask for smart octilinear roads (0°, 45°, 90°, 135°...)
export const DIR_N = 1 << 0; // (0, -1)
export const DIR_NE = 1 << 1; // (1, -1)
export const DIR_E = 1 << 2; // (1, 0)
export const DIR_SE = 1 << 3; // (1, 1)
export const DIR_S = 1 << 4; // (0, 1)
export const DIR_SW = 1 << 5; // (-1, 1)
export const DIR_W = 1 << 6; // (-1, 0)
export const DIR_NW = 1 << 7; // (-1, -1)

export const enum ZoneKind {
  None = 0,
  ResLow = 1,
  ResHigh = 2,
  ComLow = 3,
  ComHigh = 4,
  Industrial = 5,
  Office = 6,
}

export type SpecialBuildingId =
  | 'wind_turbine'
  | 'solar_plant'
  | 'coal_plant'
  | 'nuclear_plant'
  | 'water_tower'
  | 'water_pump'
  | 'water_treatment'
  | 'police_station'
  | 'fire_station'
  | 'clinic'
  | 'hospital'
  | 'school'
  | 'university'
  | 'city_park'
  | 'botanical_plaza'
  | 'bus_depot'
  | 'metro_station'
  | 'monument_stadium'
  | 'monument_fox_tower'
  | 'monument_airport'
  | 'monument_arcology';

export type InfoOverlayMode =
  | 'normal'
  | 'power'
  | 'water'
  | 'traffic'
  | 'pollution'
  | 'land_value'
  | 'services'
  | 'metro';

export type WeatherKind = 'clear' | 'rain';

export type DisasterKind = 'industrial_fire' | 'meteor_strike' | 'tornado' | 'coastal_flood';

export type ToolMode =
  | { kind: 'pan' }
  | { kind: 'inspect' }
  | { kind: 'bulldoze' }
  | { kind: 'road'; tier: RoadTier }
  | { kind: 'zone'; zone: ZoneKind }
  | { kind: 'building'; buildingId: SpecialBuildingId }
  | { kind: 'bus_line' }
  | { kind: 'metro_tunnel' };

export interface PlacedStructure {
  id: number;
  buildingId: SpecialBuildingId;
  x: number;
  z: number;
  w: number;
  d: number;
  rotation: 0 | 1 | 2 | 3;
  powered: boolean;
  watered: boolean;
  onFire: number; // 0..100
}

export interface TransitStopPoint {
  x: number;
  z: number;
}

export interface BusLineRecord {
  id: string;
  name: string;
  color: string;
  stops: TransitStopPoint[];
  ridership: number;
}

export interface MetroSegmentRecord {
  id: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  color: string;
}

export interface ActiveDisasterEvent {
  id: string;
  kind: DisasterKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  ticksLeft: number;
  maxTicks: number;
}

export interface LoanRecord {
  id: ' municipal_25k' | 'metro_80k';
  name: string;
  principal: number;
  remaining: number;
  interestRate: number;
  tickPayment: number;
}

export interface ChirpMessage {
  id: string;
  author: string;
  handle: string;
  text: string;
  mood: 'positive' | 'warning' | 'urgent';
  day: number;
}

export interface TaxRates {
  residential: number; // 4..20%
  commercial: number;
  industrial: number;
}

export interface RCIDemand {
  residential: number; // 0..100
  commercial: number; // 0..100
  industrial: number; // 0..100
}

export interface CityHudSnapshot {
  cityId: string;
  cityName: string;
  mapId: MapArchetypeId;
  sandboxMode: boolean;
  day: number;
  timeOfDay: number; // 0..24
  autoDayNight: boolean;
  weather: WeatherKind;
  simSpeed: 0 | 1 | 2 | 4;
  money: number;
  netIncomePerTick: number;
  lastTaxIncome: number;
  lastMaintenanceCost: number;
  population: number;
  jobsTotal: number;
  happiness: number;
  milestoneIndex: number;
  milestoneTitle: string;
  nextMilestonePop: number | null;
  demand: RCIDemand;
  taxes: TaxRates;
  powerProducedMW: number;
  powerConsumedMW: number;
  waterProducedML: number;
  waterConsumedML: number;
  avgTraffic: number;
  avgLandValue: number;
  avgPollution: number;
  transitRiders: number;
  busLinesCount: number;
  metroStationsCount: number;
  metroSegmentsCount: number;
  unlockedTilesMask: number; // 9-bit mask (bit 4 = center)
  randomDisastersEnabled: boolean;
  activeDisasters: ActiveDisasterEvent[];
  builtMonuments: SpecialBuildingId[];
  loans: LoanRecord[];
  chirps: ChirpMessage[];
  canUndo: boolean;
  windAngleRad: number;
}

export interface CloudCitySummary {
  slotId: string;
  name: string;
  mapId: MapArchetypeId;
  seed: number;
  sandboxMode: boolean;
  population: number;
  money: number;
  happiness: number;
  day: number;
  serverRev: number;
  updatedAt: string;
  deviceId: string;
}
