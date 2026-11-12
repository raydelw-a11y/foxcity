import {
  DisasterKind,
  MapArchetypeId,
  RoadTier,
  SpecialBuildingId,
  ZoneKind,
} from '../types/game';

export interface MapArchetypeConfig {
  id: MapArchetypeId;
  name: string;
  subtitle: string;
  description: string;
  windBonus: number;
  windAngleDeg: number;
  defaultSeed: number;
  badgeColor: string;
}

export const MAP_ARCHETYPES: MapArchetypeConfig[] = [
  {
    id: 'emerald_bay',
    name: 'Bahía Esmeralda',
    subtitle: 'Costa Marítima + Río Central',
    description:
      'Amplia bahía oceánica al sur con playas de alto valor inmobiliario y un gran río navegable ideal para puentes emblemáticos.',
    windBonus: 1.05,
    windAngleDeg: 38,
    defaultSeed: 104729,
    badgeColor: '#0ea5e9',
  },
  {
    id: 'grand_delta',
    name: 'Gran Delta',
    subtitle: 'Confluencia de Dos Ríos',
    description:
      'Penínsulas fértiles separadas por dos brazos fluviales. Requiere planificar avenidas, puentes y líneas de metro inter-riberas.',
    windBonus: 1.0,
    windAngleDeg: 15,
    defaultSeed: 228913,
    badgeColor: '#10b981',
  },
  {
    id: 'alpine_valley',
    name: 'Valle Alpino',
    subtitle: 'Cordillera + Corredor Eólico',
    description:
      'Llanura glaciar flanqueada por cumbres nevadas y río de deshielo. +35% de rendimiento en energía eólica.',
    windBonus: 1.35,
    windAngleDeg: 0,
    defaultSeed: 519247,
    badgeColor: '#6366f1',
  },
  {
    id: 'archipelago',
    name: 'Archipiélago',
    subtitle: 'Islas Conectadas',
    description:
      'Cinco grandes islas rodeadas de aguas turquesas. Conéctalas con autopistas elevadas sobre el mar y túneles submarinos de metro.',
    windBonus: 1.2,
    windAngleDeg: -32,
    defaultSeed: 883411,
    badgeColor: '#14b8a6',
  },
];

export interface MilestoneConfig {
  index: number;
  title: string;
  populationRequired: number;
  rewardMoney: number;
  maxUnlockedTiles: number;
  unlockSummary: string;
}

export const CITY_MILESTONES: MilestoneConfig[] = [
  {
    index: 0,
    title: 'Asentamiento Pionero',
    populationRequired: 0,
    rewardMoney: 0,
    maxUnlockedTiles: 1,
    unlockSummary: 'Calles 2L, Zonas Básicas, Eólica/Carbón, Agua y Parques',
  },
  {
    index: 1,
    title: 'Pueblo en Marcha',
    populationRequired: 150,
    rewardMoney: 18000,
    maxUnlockedTiles: 2,
    unlockSummary: 'Avenidas 4L, Clínica, Bomberos, Policía, Escuela y 2ª Parcela',
  },
  {
    index: 2,
    title: 'Villa Comercial',
    populationRequired: 600,
    rewardMoney: 30000,
    maxUnlockedTiles: 4,
    unlockSummary: 'Líneas de Autobús, Planta Solar, Impuestos y 4 Parcelas',
  },
  {
    index: 3,
    title: 'Ciudad Emergente',
    populationRequired: 1800,
    rewardMoney: 50000,
    maxUnlockedTiles: 6,
    unlockSummary: 'Alta Densidad R/C, Oficinas, Autopistas 6L y Gran Estadio',
  },
  {
    index: 4,
    title: 'Gran Metrópolis',
    populationRequired: 4500,
    rewardMoney: 85000,
    maxUnlockedTiles: 8,
    unlockSummary: 'Metro Subterráneo, Hospital, Universidad, Tratamiento y Torre Fox',
  },
  {
    index: 5,
    title: 'Capital Internacional',
    populationRequired: 10000,
    rewardMoney: 140000,
    maxUnlockedTiles: 9,
    unlockSummary: 'Central Nuclear, Aeropuerto Internacional y las 9 Parcelas',
  },
  {
    index: 6,
    title: 'Megalópolis del Futuro',
    populationRequired: 20000,
    rewardMoney: 240000,
    maxUnlockedTiles: 9,
    unlockSummary: 'Arcología / Mega-Aguja Solar Autosuficiente',
  },
];

export interface RoadCatalogItem {
  tier: RoadTier;
  name: string;
  shortName: string;
  costPerCell: number;
  bridgeMultiplier: number;
  maintenancePerCell: number;
  capacity: number;
  speedMultiplier: number;
  unlockPop: number;
  description: string;
}

export const ROAD_CATALOG: Record<RoadTier, RoadCatalogItem> = {
  [RoadTier.None]: {
    tier: RoadTier.None,
    name: 'Ninguna',
    shortName: '-',
    costPerCell: 0,
    bridgeMultiplier: 1,
    maintenancePerCell: 0,
    capacity: 0,
    speedMultiplier: 1,
    unlockPop: 0,
    description: '',
  },
  [RoadTier.Local2L]: {
    tier: RoadTier.Local2L,
    name: 'Calle Local (2 Carriles)',
    shortName: 'Calle 2L',
    costPerCell: 60,
    bridgeMultiplier: 2.4,
    maintenancePerCell: 0.25,
    capacity: 28,
    speedMultiplier: 1.0,
    unlockPop: 0,
    description: 'Ideal para barrios residenciales y comercios locales. Se hace puente sobre agua.',
  },
  [RoadTier.Avenue4L]: {
    tier: RoadTier.Avenue4L,
    name: 'Avenida Arbolada (4 Carriles)',
    shortName: 'Avenida 4L',
    costPerCell: 140,
    bridgeMultiplier: 2.5,
    maintenancePerCell: 0.6,
    capacity: 70,
    speedMultiplier: 1.4,
    unlockPop: 150,
    description: 'Bulevar con mediana verde e intersecciones semaforizadas de alta capacidad.',
  },
  [RoadTier.Highway6L]: {
    tier: RoadTier.Highway6L,
    name: 'Autopista Rápida (6 Carriles)',
    shortName: 'Autopista 6L',
    costPerCell: 260,
    bridgeMultiplier: 2.6,
    maintenancePerCell: 1.1,
    capacity: 150,
    speedMultiplier: 2.1,
    unlockPop: 1800,
    description: 'Vía rápida regional para conectar distritos e islas sin atascos.',
  },
};

export interface ZoneCatalogItem {
  zone: ZoneKind;
  name: string;
  shortName: string;
  color: string;
  costPerCell: number;
  unlockPop: number;
  description: string;
}

export const ZONE_CATALOG: Record<ZoneKind, ZoneCatalogItem> = {
  [ZoneKind.None]: {
    zone: ZoneKind.None,
    name: 'Deszonificar',
    shortName: 'Limpiar',
    color: '#94a3b8',
    costPerCell: 0,
    unlockPop: 0,
    description: 'Elimina la zonificación de celdas vacías.',
  },
  [ZoneKind.ResLow]: {
    zone: ZoneKind.ResLow,
    name: 'Residencial Baja Densidad',
    shortName: 'Res. Baja',
    color: '#22c55e',
    costPerCell: 15,
    unlockPop: 0,
    description: 'Casas unifamiliares con jardín que evolucionan hasta chalets modernos.',
  },
  [ZoneKind.ResHigh]: {
    zone: ZoneKind.ResHigh,
    name: 'Residencial Alta Densidad',
    shortName: 'Res. Alta',
    color: '#15803d',
    costPerCell: 35,
    unlockPop: 1800,
    description: 'Edificios de apartamentos y grandes rascacielos residenciales iluminados.',
  },
  [ZoneKind.ComLow]: {
    zone: ZoneKind.ComLow,
    name: 'Comercial Baja Densidad',
    shortName: 'Com. Baja',
    color: '#38bdf8',
    costPerCell: 20,
    unlockPop: 0,
    description: 'Tiendas, cafeterías y supermercados de barrio.',
  },
  [ZoneKind.ComHigh]: {
    zone: ZoneKind.ComHigh,
    name: 'Comercial Alta Densidad',
    shortName: 'Com. Alta',
    color: '#1d4ed8',
    costPerCell: 40,
    unlockPop: 1800,
    description: 'Grandes almacenes, hoteles y torres comerciales con neón nocturno.',
  },
  [ZoneKind.Industrial]: {
    zone: ZoneKind.Industrial,
    name: 'Zona Industrial',
    shortName: 'Industria',
    color: '#eab308',
    costPerCell: 20,
    unlockPop: 0,
    description: 'Fábricas y logística. Genera mucho empleo e impuestos, pero contamina.',
  },
  [ZoneKind.Office]: {
    zone: ZoneKind.Office,
    name: 'Parque de Oficinas / Tech',
    shortName: 'Oficinas',
    color: '#06b6d4',
    costPerCell: 45,
    unlockPop: 1800,
    description: 'Empleo corporativo limpio de alta tecnología sin humo industrial.',
  },
};

export interface SpecialBuildingSpec {
  id: SpecialBuildingId;
  name: string;
  category: 'power' | 'water' | 'service' | 'park' | 'transit' | 'monument';
  w: number;
  d: number;
  cost: number;
  maintenance: number;
  unlockPop: number;
  powerMW: number; // positive = produces, negative = consumes
  waterML: number; // positive = produces, negative = consumes
  serviceRadius: number;
  pollution: number;
  landValueBoost: number;
  requiresWaterEdge?: boolean;
  uniqueMonument?: boolean;
  colorHex: string;
  description: string;
}

export const BUILDING_SPECS: Record<SpecialBuildingId, SpecialBuildingSpec> = {
  wind_turbine: {
    id: 'wind_turbine',
    name: 'Aerogenerador Eólico',
    category: 'power',
    w: 1,
    d: 1,
    cost: 3200,
    maintenance: 18,
    unlockPop: 0,
    powerMW: 28,
    waterML: 0,
    serviceRadius: 14,
    pollution: 0,
    landValueBoost: 0,
    colorHex: '#e2e8f0',
    description: 'Energía 100% limpia. Rinde más en colinas y Valle Alpino.',
  },
  solar_plant: {
    id: 'solar_plant',
    name: 'Planta Solar Fotovoltaica',
    category: 'power',
    w: 2,
    d: 2,
    cost: 9500,
    maintenance: 42,
    unlockPop: 600,
    powerMW: 95,
    waterML: -2,
    serviceRadius: 18,
    pollution: 0,
    landValueBoost: 4,
    colorHex: '#2563eb',
    description: 'Paneles solares con baterías de respaldo nocturno y cero emisiones.',
  },
  coal_plant: {
    id: 'coal_plant',
    name: 'Central Termoeléctrica',
    category: 'power',
    w: 2,
    d: 2,
    cost: 7500,
    maintenance: 55,
    unlockPop: 0,
    powerMW: 130,
    waterML: -6,
    serviceRadius: 20,
    pollution: 55,
    landValueBoost: -18,
    colorHex: '#78716c',
    description: 'Gran potencia a bajo costo inicial, pero emite humo arrastrado por el viento.',
  },
  nuclear_plant: {
    id: 'nuclear_plant',
    name: 'Central Nuclear Avanzada',
    category: 'power',
    w: 3,
    d: 3,
    cost: 42000,
    maintenance: 190,
    unlockPop: 10000,
    powerMW: 620,
    waterML: -25,
    serviceRadius: 30,
    pollution: 4,
    landValueBoost: -6,
    colorHex: '#cbd5e1',
    description: 'Torres de refrigeración masivas capaces de abastecer toda una metrópolis.',
  },
  water_tower: {
    id: 'water_tower',
    name: 'Torre de Agua Municipal',
    category: 'water',
    w: 1,
    d: 1,
    cost: 2800,
    maintenance: 16,
    unlockPop: 0,
    powerMW: -4,
    waterML: 45,
    serviceRadius: 18,
    pollution: 0,
    landValueBoost: 0,
    colorHex: '#38bdf8',
    description: 'Extrae agua subterránea en cualquier terreno firme.',
  },
  water_pump: {
    id: 'water_pump',
    name: 'Estación de Bombeo Fluvial',
    category: 'water',
    w: 2,
    d: 1,
    cost: 5600,
    maintenance: 32,
    unlockPop: 0,
    powerMW: -10,
    waterML: 130,
    serviceRadius: 24,
    pollution: 0,
    landValueBoost: 0,
    requiresWaterEdge: true,
    colorHex: '#0284c7',
    description: 'Se instala junto a ríos o costa para bombear grandes caudales de agua.',
  },
  water_treatment: {
    id: 'water_treatment',
    name: 'Planta Depuradora Eco',
    category: 'water',
    w: 2,
    d: 2,
    cost: 12000,
    maintenance: 60,
    unlockPop: 4500,
    powerMW: -16,
    waterML: 220,
    serviceRadius: 28,
    pollution: -25,
    landValueBoost: 6,
    colorHex: '#0d9488',
    description: 'Recicla y purifica el suministro hídrico reduciendo la contaminación regional.',
  },
  clinic: {
    id: 'clinic',
    name: 'Clínica Médica',
    category: 'service',
    w: 2,
    d: 1,
    cost: 4800,
    maintenance: 30,
    unlockPop: 150,
    powerMW: -6,
    waterML: -4,
    serviceRadius: 16,
    pollution: 0,
    landValueBoost: 12,
    colorHex: '#f43f5e',
    description: 'Atención primaria y ambulancias para los barrios cercanos.',
  },
  hospital: {
    id: 'hospital',
    name: 'Hospital Metropolitano',
    category: 'service',
    w: 3,
    d: 2,
    cost: 18500,
    maintenance: 95,
    unlockPop: 4500,
    powerMW: -20,
    waterML: -14,
    serviceRadius: 30,
    pollution: 0,
    landValueBoost: 22,
    colorHex: '#e11d48',
    description: 'Complejo hospitalario con helipuerto y máxima cobertura sanitaria.',
  },
  fire_station: {
    id: 'fire_station',
    name: 'Parque de Bomberos',
    category: 'service',
    w: 2,
    d: 1,
    cost: 4600,
    maintenance: 28,
    unlockPop: 150,
    powerMW: -5,
    waterML: -5,
    serviceRadius: 18,
    pollution: 0,
    landValueBoost: 10,
    colorHex: '#ef4444',
    description: 'Despacha camiones de bomberos automáticamente ante incendios y desastres.',
  },
  police_station: {
    id: 'police_station',
    name: 'Comisaría de Policía',
    category: 'service',
    w: 2,
    d: 1,
    cost: 4800,
    maintenance: 30,
    unlockPop: 150,
    powerMW: -6,
    waterML: -4,
    serviceRadius: 18,
    pollution: 0,
    landValueBoost: 12,
    colorHex: '#3b82f6',
    description: 'Patrulla las calles, mantiene el orden y eleva el valor comercial.',
  },
  school: {
    id: 'school',
    name: 'Instituto Educativo',
    category: 'service',
    w: 2,
    d: 2,
    cost: 6200,
    maintenance: 35,
    unlockPop: 150,
    powerMW: -7,
    waterML: -6,
    serviceRadius: 18,
    pollution: 0,
    landValueBoost: 14,
    colorHex: '#f59e0b',
    description: 'Forma a los ciudadanos para desbloquear edificios de mayor nivel.',
  },
  university: {
    id: 'university',
    name: 'Campus Universitario',
    category: 'service',
    w: 3,
    d: 3,
    cost: 22000,
    maintenance: 110,
    unlockPop: 4500,
    powerMW: -22,
    waterML: -16,
    serviceRadius: 34,
    pollution: 0,
    landValueBoost: 26,
    colorHex: '#8b5cf6',
    description: 'Impulsa parques tecnológicos de Oficinas y rascacielos Nivel 5.',
  },
  city_park: {
    id: 'city_park',
    name: 'Parque Urbano Arbolado',
    category: 'park',
    w: 2,
    d: 2,
    cost: 1800,
    maintenance: 10,
    unlockPop: 0,
    powerMW: -1,
    waterML: -2,
    serviceRadius: 12,
    pollution: -12,
    landValueBoost: 22,
    colorHex: '#16a34a',
    description: 'Pulmón verde con senderos y fuentes que dispara el valor del suelo.',
  },
  botanical_plaza: {
    id: 'botanical_plaza',
    name: 'Gran Plaza Cívica',
    category: 'park',
    w: 3,
    d: 3,
    cost: 5200,
    maintenance: 24,
    unlockPop: 600,
    powerMW: -3,
    waterML: -4,
    serviceRadius: 18,
    pollution: -20,
    landValueBoost: 34,
    colorHex: '#10b981',
    description: 'Jardín botánico y espejo de agua ideal para rodear de torres residenciales.',
  },
  bus_depot: {
    id: 'bus_depot',
    name: 'Terminal de Autobuses',
    category: 'transit',
    w: 2,
    d: 2,
    cost: 6500,
    maintenance: 38,
    unlockPop: 600,
    powerMW: -8,
    waterML: -4,
    serviceRadius: 22,
    pollution: 2,
    landValueBoost: 10,
    colorHex: '#0ea5e9',
    description: 'Habilita la flota municipal de autobuses para reducir el tráfico de autos.',
  },
  metro_station: {
    id: 'metro_station',
    name: 'Estación de Metro',
    category: 'transit',
    w: 2,
    d: 1,
    cost: 9200,
    maintenance: 48,
    unlockPop: 4500,
    powerMW: -14,
    waterML: -3,
    serviceRadius: 20,
    pollution: 0,
    landValueBoost: 24,
    colorHex: '#06b6d4',
    description: 'Acceso superficial y andén subterráneo. Conecta estaciones con Túneles de Metro.',
  },
  monument_stadium: {
    id: 'monument_stadium',
    name: 'Gran Estadio Metropolitano',
    category: 'monument',
    w: 4,
    d: 4,
    cost: 48000,
    maintenance: 150,
    unlockPop: 1800,
    powerMW: -30,
    waterML: -20,
    serviceRadius: 42,
    pollution: 4,
    landValueBoost: 38,
    uniqueMonument: true,
    colorHex: '#22c55e',
    description: 'Monumento Único: +15% felicidad global e ingresos por grandes eventos.',
  },
  monument_fox_tower: {
    id: 'monument_fox_tower',
    name: 'Torre Fox Panorámica',
    category: 'monument',
    w: 3,
    d: 3,
    cost: 75000,
    maintenance: 210,
    unlockPop: 4500,
    powerMW: -35,
    waterML: -12,
    serviceRadius: 52,
    pollution: 0,
    landValueBoost: 52,
    uniqueMonument: true,
    colorHex: '#38bdf8',
    description: 'Monumento Único: Aguja icónica de acero y cristal que dispara el valor comercial.',
  },
  monument_airport: {
    id: 'monument_airport',
    name: 'Aeropuerto Internacional',
    category: 'monument',
    w: 6,
    d: 4,
    cost: 125000,
    maintenance: 320,
    unlockPop: 10000,
    powerMW: -55,
    waterML: -30,
    serviceRadius: 65,
    pollution: 18,
    landValueBoost: 30,
    uniqueMonument: true,
    colorHex: '#60a5fa',
    description: 'Monumento Único: Pista activa con vuelos comerciales que multiplican el comercio.',
  },
  monument_arcology: {
    id: 'monument_arcology',
    name: 'Arcología / Mega-Aguja Solar',
    category: 'monument',
    w: 4,
    d: 4,
    cost: 210000,
    maintenance: 260,
    unlockPop: 20000,
    powerMW: 520,
    waterML: 160,
    serviceRadius: 65,
    pollution: -35,
    landValueBoost: 65,
    uniqueMonument: true,
    colorHex: '#a855f7',
    description: 'Monumento Cumbre: Genera +520 MW limpios, purifica el aire y aloja 2,800 ciudadanos.',
  },
};

export const DISASTER_CATALOG: {
  kind: DisasterKind;
  name: string;
  description: string;
  color: string;
}[] = [
  {
    kind: 'industrial_fire',
    name: 'Incendio Mayor',
    description: 'Foco de llamas que se propaga si no llega cobertura del Parque de Bomberos.',
    color: '#f97316',
  },
  {
    kind: 'meteor_strike',
    name: 'Impacto de Meteorito',
    description: 'Bólido espacial con onda expansiva e incendios secundarios.',
    color: '#ef4444',
  },
  {
    kind: 'tornado',
    name: 'Tornado F4',
    description: 'Vórtice destructivo que atraviesa un corredor urbano siguiendo el viento.',
    color: '#94a3b8',
  },
  {
    kind: 'coastal_flood',
    name: 'Tormenta e Inundación',
    description: 'Temporal severo con crecida costera/fluvial y sobrecarga eléctrica.',
    color: '#0ea5e9',
  },
];

export const BUS_LINE_COLORS = [
  '#0ea5e9',
  '#f97316',
  '#a855f7',
  '#ec4899',
  '#10b981',
  '#eab308',
];
