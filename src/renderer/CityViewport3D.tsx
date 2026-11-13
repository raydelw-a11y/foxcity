import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { BUILDING_SPECS, ROAD_CATALOG, ZONE_CATALOG } from '../config/catalog';
import { CellInspectInfo, CityEngine, DIR_OFFSETS } from '../engine/cityEngine';
import { isWaterTerrain } from '../engine/mapGenerator';
import {
  GRID_SIZE,
  InfoOverlayMode,
  MACRO_TILE_SIZE,
  RoadTier,
  SpecialBuildingId,
  TerrainKind,
  ToolMode,
  TOTAL_CELLS,
  ZoneKind,
} from '../types/game';
import { getCityProceduralAssets } from './textureAtlas';

const _dummy = new THREE.Object3D();
const _dummy2 = new THREE.Object3D();
const _color = new THREE.Color();
const TERRAIN_SPAN = GRID_SIZE - 1; // 107 spans for 108 vertices so spacing is exact 1.0
const TERRAIN_CENTER = TERRAIN_SPAN * 0.5; // 53.5
const WORLD_SPHERE = new THREE.Sphere(new THREE.Vector3(TERRAIN_CENTER, 0, TERRAIN_CENTER), 145);

export interface PendingMobilePlacement {
  buildingId: SpecialBuildingId;
  x: number;
  z: number;
  rotation: 0 | 1 | 2 | 3;
  cost: number;
  valid: boolean;
  reason?: string;
}

export interface LiveDragBanner {
  label: string;
  cost: number;
  valid: boolean;
  screenX: number;
  screenY: number;
}

interface CityViewport3DProps {
  engine: CityEngine;
  tool: ToolMode;
  overlay: InfoOverlayMode;
  buildingRotation: 0 | 1 | 2 | 3;
  onRotateBuilding: () => void;
  showTileGridModal: boolean;
  onSelectInspect: (info: CellInspectInfo | null) => void;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'ok') => void;
  onAfterMutate: () => void;
  pendingPlacement: PendingMobilePlacement | null;
  setPendingPlacement: React.Dispatch<React.SetStateAction<PendingMobilePlacement | null>>;
}

interface VehicleAgent {
  x: number;
  z: number;
  nx: number;
  nz: number;
  dirIdx: number;
  progress: number;
  speed: number;
  kind: 'car' | 'truck' | 'police' | 'fire';
  colorHex: number;
}

function getCenteredFootprintOrigin(
  hitX: number,
  hitZ: number,
  buildingId: SpecialBuildingId,
  rotation: 0 | 1 | 2 | 3
): { x: number; z: number; w: number; d: number } {
  const spec = BUILDING_SPECS[buildingId];
  const w = rotation % 2 === 1 ? spec.d : spec.w;
  const d = rotation % 2 === 1 ? spec.w : spec.d;
  const x = Math.max(0, Math.min(GRID_SIZE - w, Math.round(hitX - (w - 1) * 0.5)));
  const z = Math.max(0, Math.min(GRID_SIZE - d, Math.round(hitZ - (d - 1) * 0.5)));
  return { x, z, w, d };
}

/** Merges multiple ground-pivoted boxes into a single single-draw-call vehicle BufferGeometry. */
function createMergedBoxGeometry(
  parts: { sx: number; sy: number; sz: number; px: number; py: number; pz: number }[]
): THREE.BufferGeometry {
  const nonIdxList: THREE.BufferGeometry[] = [];
  let totalVerts = 0;

  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.sx, p.sy, p.sz).toNonIndexed();
    g.translate(p.px, p.py, p.pz);
    nonIdxList.push(g);
    totalVerts += g.attributes.position.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);

  let vOffset = 0;
  for (const g of nonIdxList) {
    const pArr = g.attributes.position.array as Float32Array;
    const nArr = g.attributes.normal.array as Float32Array;
    const uArr = g.attributes.uv.array as Float32Array;
    pos.set(pArr, vOffset * 3);
    norm.set(nArr, vOffset * 3);
    uv.set(uArr, vOffset * 2);
    vOffset += g.attributes.position.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

export const CityViewport3D: React.FC<CityViewport3DProps> = ({
  engine,
  tool,
  overlay,
  buildingRotation,
  onRotateBuilding,
  showTileGridModal,
  onSelectInspect,
  onToast,
  onAfterMutate,
  pendingPlacement,
  setPendingPlacement,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragBanner, setDragBanner] = useState<LiveDragBanner | null>(null);
  const [touchReticle, setTouchReticle] = useState<{ x: number; y: number } | null>(null);

  const engineRef = useRef(engine);
  engineRef.current = engine;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const rotRef = useRef(buildingRotation);
  rotRef.current = buildingRotation;
  const showTilesRef = useRef(showTileGridModal);
  showTilesRef.current = showTileGridModal;
  const pendingRef = useRef(pendingPlacement);
  pendingRef.current = pendingPlacement;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const isMobileTouch = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;

    // --- 1. WebGLRenderer, Soft PCF Shadows & Atmospheric Sky ---
    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobileTouch,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileTouch ? 1.75 : 2.0));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#7dd3fc');
    scene.fog = new THREE.FogExp2('#9ad1ea', 0.0038);

    const assets = getCityProceduralAssets(renderer);
    scene.environment = assets.envMap;

    const camera = new THREE.PerspectiveCamera(
      44,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.8,
      390
    );

    const camState = {
      targetX: 52,
      targetZ: 48,
      yaw: 0.62,
      pitch: 0.78,
      distance: isMobileTouch ? 56 : 48,
    };

    // Sky Dome (vertex-colored zenith -> mid -> horizon gradient updated cleanly with time of day)
    const skyGeo = new THREE.SphereGeometry(250, 32, 18);
    const skyPos = skyGeo.attributes.position as THREE.BufferAttribute;
    const skyColors = new Float32Array(skyPos.count * 3);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyDomeMesh = new THREE.Mesh(skyGeo, skyMat);
    skyDomeMesh.position.set(TERRAIN_CENTER, 0, TERRAIN_CENTER);
    scene.add(skyDomeMesh);

    const zenithCol = new THREE.Color();
    const horizonCol = new THREE.Color();
    const midSkyCol = new THREE.Color();
    let lastSkyKey = '';

    const updateSkyDome = (zenithHex: THREE.Color, horizonHex: THREE.Color) => {
      const colAttr = skyGeo.attributes.color as THREE.BufferAttribute;
      for (let idx = 0; idx < skyPos.count; idx++) {
        const ny = THREE.MathUtils.clamp(skyPos.getY(idx) / 250, 0, 1);
        const t = Math.pow(ny, 0.58);
        _color.copy(horizonHex).lerp(zenithHex, t);
        colAttr.setXYZ(idx, _color.r, _color.g, _color.b);
      }
      colAttr.needsUpdate = true;
    };

    // Lights + Texel-Snapped Soft Shadows
    const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#334155', 0.78);
    scene.add(hemiLight);

    const shadowRes = isMobileTouch ? 1024 : 2048;
    const SHADOW_HALF_EXTENT = 46;
    const sunLight = new THREE.DirectionalLight('#fff7ed', 1.72);
    sunLight.position.set(85, 95, 35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    sunLight.shadow.camera.near = 4;
    sunLight.shadow.camera.far = 220;
    sunLight.shadow.camera.left = -SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.right = SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.top = SHADOW_HALF_EXTENT;
    sunLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
    sunLight.shadow.bias = -0.00045;
    sunLight.shadow.normalBias = 0.035;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const fillLight = new THREE.DirectionalLight('#bae6fd', 0.36);
    fillLight.position.set(-55, 42, -45);
    scene.add(fillLight);

    // --- 2. Exact 1.0-Unit Terrain Heightfield + Shoreline Foam + Info DataTexture ---
    const terrainGeo = new THREE.PlaneGeometry(
      TERRAIN_SPAN,
      TERRAIN_SPAN,
      TERRAIN_SPAN,
      TERRAIN_SPAN
    );
    terrainGeo.rotateX(-Math.PI / 2);
    terrainGeo.translate(TERRAIN_CENTER, 0, TERRAIN_CENTER);

    const vCount = terrainGeo.attributes.position.count;
    const baseColors = new Float32Array(vCount * 3);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(baseColors, 3));

    // Align terrain UVs to exact cell centers (x + 0.5) / 108 for crisp overlayDataTex alignment
    const terrainUv = terrainGeo.attributes.uv as THREE.BufferAttribute;
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        terrainUv.setXY(z * GRID_SIZE + x, (x + 0.5) / GRID_SIZE, (z + 0.5) / GRID_SIZE);
      }
    }
    terrainUv.needsUpdate = true;

    const overlayTexData = new Uint8Array(TOTAL_CELLS * 4);
    const overlayDataTex = new THREE.DataTexture(
      overlayTexData,
      GRID_SIZE,
      GRID_SIZE,
      THREE.RGBAFormat
    );
    overlayDataTex.colorSpace = THREE.SRGBColorSpace;
    overlayDataTex.magFilter = THREE.LinearFilter;
    overlayDataTex.minFilter = THREE.LinearFilter;
    overlayDataTex.flipY = false;

    const terrainNormalMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: assets.terrainDetailTex,
      roughness: 0.85,
      metalness: 0.04,
      transparent: true,
      opacity: 1,
    });

    const terrainInfoMat = new THREE.MeshLambertMaterial({
      map: overlayDataTex,
      color: '#ffffff',
      transparent: true,
      opacity: 1,
    });

    const terrainMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
      terrainGeo,
      terrainNormalMat
    );
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Animated Water Plane + Coastal Shoreline Foam Layer
    const waterGeo = new THREE.PlaneGeometry(GRID_SIZE + 90, GRID_SIZE + 90);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate(TERRAIN_CENTER, -0.04, TERRAIN_CENTER);
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      normalMap: assets.waterNormalTex,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.09,
      metalness: 0.62,
      transparent: true,
      opacity: 0.86,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);

    const shoreFoamData = new Uint8Array(TOTAL_CELLS * 4);
    const shoreFoamTex = new THREE.DataTexture(
      shoreFoamData,
      GRID_SIZE,
      GRID_SIZE,
      THREE.RGBAFormat
    );
    shoreFoamTex.colorSpace = THREE.SRGBColorSpace;
    shoreFoamTex.magFilter = THREE.LinearFilter;
    shoreFoamTex.minFilter = THREE.LinearFilter;
    shoreFoamTex.flipY = false;

    const shoreFoamGeo = new THREE.PlaneGeometry(TERRAIN_SPAN, TERRAIN_SPAN);
    shoreFoamGeo.rotateX(-Math.PI / 2);
    shoreFoamGeo.translate(TERRAIN_CENTER, -0.015, TERRAIN_CENTER);
    const shoreFoamMat = new THREE.MeshBasicMaterial({
      map: shoreFoamTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const shoreFoamMesh = new THREE.Mesh(shoreFoamGeo, shoreFoamMat);
    scene.add(shoreFoamMesh);

    // --- 3. Shared Materials (3-Style PBR Buildings + Analytical White Mode) ---
    const rciResMat = new THREE.MeshStandardMaterial({
      map: assets.resAlbedo,
      emissiveMap: assets.resEmissive,
      bumpMap: assets.facadeBump,
      bumpScale: 0.024,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.0,
      roughness: 0.56,
      metalness: 0.12,
      transparent: true,
      opacity: 1,
    });

    const rciComMat = new THREE.MeshStandardMaterial({
      map: assets.comAlbedo,
      emissiveMap: assets.comEmissive,
      bumpMap: assets.facadeBump,
      bumpScale: 0.02,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.0,
      roughness: 0.18,
      metalness: 0.56,
      envMapIntensity: 1.35,
      transparent: true,
      opacity: 1,
    });

    const rciIndMat = new THREE.MeshStandardMaterial({
      map: assets.indAlbedo,
      emissiveMap: assets.indEmissive,
      bumpMap: assets.facadeBump,
      bumpScale: 0.028,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.0,
      roughness: 0.72,
      metalness: 0.28,
      transparent: true,
      opacity: 1,
    });

    const solidRealisticMat = new THREE.MeshStandardMaterial({
      roughness: 0.54,
      metalness: 0.16,
      transparent: true,
      opacity: 1,
    });

    const whiteInfoMat = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 1,
    });

    const streetBulbMat = new THREE.MeshBasicMaterial({ color: '#fde68a' });

    const makeInstanced = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      maxCount: number,
      opts?: { dynamic?: boolean; castShadow?: boolean; receiveShadow?: boolean }
    ): THREE.InstancedMesh => {
      geo.boundingSphere = WORLD_SPHERE;
      const im = new THREE.InstancedMesh(geo, mat, maxCount);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(opts?.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
      im.castShadow = Boolean(opts?.castShadow);
      im.receiveShadow = Boolean(opts?.receiveShadow);
      im.setColorAt(0, new THREE.Color('#ffffff'));
      return im;
    };

    // Base geometries
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);

    const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    cylGeo.translate(0, 0.5, 0);

    const coneGeo = new THREE.ConeGeometry(0.55, 1, 8);
    coneGeo.translate(0, 0.5, 0);

    const broadGeo = new THREE.IcosahedronGeometry(0.54, 1);
    broadGeo.translate(0, 0.5, 0);

    const vehicleMergedGeo = createMergedBoxGeometry([
      { sx: 0.16, sy: 0.075, sz: 0.30, px: 0, py: 0.0375, pz: 0 }, // Body chassis
      { sx: 0.13, sy: 0.055, sz: 0.16, px: 0, py: 0.1025, pz: -0.02 }, // Glass cabin
    ]);

    // Static Instanced Pools
    const roadSidewalkMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 28000, {
      receiveShadow: true,
    });
    const roadDeckMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 28000, {
      receiveShadow: true,
    });
    const roadStripeMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 32000);
    const bridgePierMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 4500, {
      castShadow: true,
      receiveShadow: true,
    });
    const streetLightPoleMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 6000, {
      castShadow: true,
    });
    const streetLightBulbMesh = makeInstanced(boxGeo.clone(), streetBulbMat, 6000);

    const zonePadMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, TOTAL_CELLS, {
      receiveShadow: true,
    });
    const rciResMesh = makeInstanced(boxGeo.clone(), rciResMat, TOTAL_CELLS * 2, {
      castShadow: true,
      receiveShadow: true,
    });
    const rciComMesh = makeInstanced(boxGeo.clone(), rciComMat, TOTAL_CELLS * 2, {
      castShadow: true,
      receiveShadow: true,
    });
    const rciIndMesh = makeInstanced(boxGeo.clone(), rciIndMat, TOTAL_CELLS * 2, {
      castShadow: true,
      receiveShadow: true,
    });
    const rciDetailMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, TOTAL_CELLS * 2, {
      castShadow: true,
      receiveShadow: true,
    });
    const rciRoofMesh = makeInstanced(coneGeo.clone(), solidRealisticMat, 6000, {
      castShadow: true,
    });

    const treeTrunkMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 8000, {
      castShadow: true,
    });
    const treePineMesh = makeInstanced(coneGeo.clone(), solidRealisticMat, 8000, {
      castShadow: true,
      receiveShadow: true,
    });
    const treeBroadMesh = makeInstanced(broadGeo.clone(), solidRealisticMat, 8000, {
      castShadow: true,
      receiveShadow: true,
    });

    const civicBoxMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 4500, {
      castShadow: true,
      receiveShadow: true,
    });
    const civicCylMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 2200, {
      castShadow: true,
      receiveShadow: true,
    });

    scene.add(
      roadSidewalkMesh,
      roadDeckMesh,
      roadStripeMesh,
      bridgePierMesh,
      streetLightPoleMesh,
      streetLightBulbMesh,
      zonePadMesh,
      rciResMesh,
      rciComMesh,
      rciIndMesh,
      rciDetailMesh,
      rciRoofMesh,
      treeTrunkMesh,
      treePineMesh,
      treeBroadMesh,
      civicBoxMesh,
      civicCylMesh
    );

    const metroGroup = new THREE.Group();
    scene.add(metroGroup);

    const busLinesGroup = new THREE.Group();
    scene.add(busLinesGroup);

    const tileBordersGroup = new THREE.Group();
    scene.add(tileBordersGroup);

    // Reusable per-cell zone drag preview InstancedMesh (0 heap allocations during touchmove)
    const zonePreviewMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
      1600,
      { dynamic: true }
    );
    scene.add(zonePreviewMesh);

    // Dynamic Instanced Pools (60 FPS animated)
    const vehicleMesh = makeInstanced(
      vehicleMergedGeo,
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.25 }),
      420,
      { dynamic: true, castShadow: true }
    );
    const headlightMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#fef08a' }),
      420,
      { dynamic: true }
    );
    const taillightMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#ef4444' }),
      420,
      { dynamic: true }
    );
    const sirenBeaconMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      120,
      { dynamic: true }
    );
    const turbineBladeMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3 }),
      600,
      { dynamic: true, castShadow: true }
    );
    const metroTrainMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#22d3ee' }),
      120,
      { dynamic: true }
    );
    const fxParticleMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      650,
      { dynamic: true }
    );

    scene.add(
      vehicleMesh,
      headlightMesh,
      taillightMesh,
      sirenBeaconMesh,
      turbineBladeMesh,
      metroTrainMesh,
      fxParticleMesh
    );

    // Animated Commercial Airplane
    const airplaneGroup = new THREE.Group();
    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.14, 1.9, 10),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.25 })
    );
    fuselage.rotation.z = Math.PI / 2;
    fuselage.castShadow = true;
    const wings = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.05, 1.95),
      new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.3 })
    );
    wings.castShadow = true;
    const tailFin = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.06),
      new THREE.MeshStandardMaterial({ color: '#0284c7' })
    );
    tailFin.position.set(-0.78, 0.22, 0);
    airplaneGroup.add(fuselage, wings, tailFin);
    airplaneGroup.visible = false;
    scene.add(airplaneGroup);

    const previewGroup = new THREE.Group();
    scene.add(previewGroup);

    const coverageRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78,
      })
    );
    coverageRing.rotation.x = -Math.PI / 2;
    coverageRing.visible = false;
    scene.add(coverageRing);

    let windTurbineCoords: { x: number; y: number; z: number }[] = [];
    let airportCoords: { x: number; y: number; z: number } | null = null;
    let roadCellsList: number[] = [];

    // Analytical view state arrays shared cleanly across RCI meshes
    const rciPoolEntries = [
      {
        mesh: rciResMesh,
        mat: rciResMat as THREE.Material,
        cellIndices: new Int32Array(TOTAL_CELLS * 2),
        realColors: new Uint32Array(TOTAL_CELLS * 2),
        slot: 0,
      },
      {
        mesh: rciComMesh,
        mat: rciComMat as THREE.Material,
        cellIndices: new Int32Array(TOTAL_CELLS * 2),
        realColors: new Uint32Array(TOTAL_CELLS * 2),
        slot: 0,
      },
      {
        mesh: rciIndMesh,
        mat: rciIndMat as THREE.Material,
        cellIndices: new Int32Array(TOTAL_CELLS * 2),
        realColors: new Uint32Array(TOTAL_CELLS * 2),
        slot: 0,
      },
      {
        mesh: rciDetailMesh,
        mat: solidRealisticMat as THREE.Material,
        cellIndices: new Int32Array(TOTAL_CELLS * 2),
        realColors: new Uint32Array(TOTAL_CELLS * 2),
        slot: 0,
      },
    ];

    const roadDeckCellIndices = new Int32Array(28000);
    const roadDeckRealColors = new Uint32Array(28000);
    const civicRealColors = new Uint32Array(4500);

    const vehicles: VehicleAgent[] = [];

    // --- 4. Terrain Geometry & Static City Mesh Builder ---
    let syncedCityId = '';
    let lastMeshVer = -1;
    let lastOverlayVer = -1;
    let lastOverlayMode: InfoOverlayMode = 'normal';
    let lastUnlockedMask = -1;
    let lastShowTiles = false;

    const surfaceHeightAt = (eng: CityEngine, x: number, z: number): number => {
      const i = eng.idx(x, z);
      return Math.max(0.05, eng.elevation[i]);
    };

    const rebuildTerrainVertices = (eng: CityEngine) => {
      const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
      const colAttr = terrainGeo.attributes.color as THREE.BufferAttribute;

      for (let z = 0; z < GRID_SIZE; z++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const i = z * GRID_SIZE + x;
          const h = eng.elevation[i];
          posAttr.setY(i, h);

          // Slope gradient for natural cliff rock shading
          const hx1 = x + 1 < GRID_SIZE ? eng.elevation[i + 1] : h;
          const hx0 = x > 0 ? eng.elevation[i - 1] : h;
          const hz1 = z + 1 < GRID_SIZE ? eng.elevation[i + GRID_SIZE] : h;
          const hz0 = z > 0 ? eng.elevation[i - GRID_SIZE] : h;
          const slope = Math.max(Math.abs(hx1 - hx0), Math.abs(hz1 - hz0)) * 0.5;

          const tk = eng.terrain[i] as TerrainKind;
          const unlocked = eng.isTileUnlockedAt(x, z);

          // Coastal shallow turquoise & animated shoreline foam data
          const foamOff = i * 4;
          if (isWaterTerrain(tk)) {
            let nearLand = false;
            for (const [dx, dz] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const nx = x + dx;
              const nz = z + dz;
              if (eng.inBounds(nx, nz) && !isWaterTerrain(eng.terrain[eng.idx(nx, nz)])) {
                nearLand = true;
                break;
              }
            }
            if (nearLand || h > -0.28) {
              shoreFoamData[foamOff] = nearLand ? 224 : 103;
              shoreFoamData[foamOff + 1] = nearLand ? 247 : 232;
              shoreFoamData[foamOff + 2] = 250;
              shoreFoamData[foamOff + 3] = nearLand ? 165 : 70;
            } else {
              shoreFoamData[foamOff] = 0;
              shoreFoamData[foamOff + 1] = 0;
              shoreFoamData[foamOff + 2] = 0;
              shoreFoamData[foamOff + 3] = 0;
            }
          } else {
            shoreFoamData[foamOff] = 0;
            shoreFoamData[foamOff + 1] = 0;
            shoreFoamData[foamOff + 2] = 0;
            shoreFoamData[foamOff + 3] = 0;
          }

          if (tk === TerrainKind.DeepWater) {
            _color.setHex(0x064e78);
          } else if (tk === TerrainKind.ShallowWater) {
            _color.setHex(0x0ea5e9);
          } else if (tk === TerrainKind.Beach) {
            _color.setHex(h < 0.2 ? 0xd4bd92 : 0xe9d8b4);
          } else if (tk === TerrainKind.Fertile) {
            _color.setHex(0x3a8f4d);
          } else if (tk === TerrainKind.Hill) {
            _color.setHex(0x4e7953);
          } else if (tk === TerrainKind.Mountain) {
            _color.setHex(h > 8.4 ? 0xf1f5f9 : 0x64748b);
          } else {
            _color.setHex(0x4c9658);
          }

          // Organic grass richness variation & cliff rock blending
          if (!isWaterTerrain(tk) && tk !== TerrainKind.Beach) {
            const patch = (((x * 37 + z * 53) % 11) - 5) * 0.008;
            _color.offsetHSL(patch * 0.25, 0.02, patch);
            if (slope > 0.52 && tk !== TerrainKind.Mountain) {
              const rockBlend = Math.min(0.82, (slope - 0.52) * 1.15);
              _color.lerp(new THREE.Color('#64748b'), rockBlend);
            }
          }

          if (!unlocked) {
            _color.lerp(new THREE.Color('#0f172a'), 0.42);
          }
          colAttr.setXYZ(i, _color.r, _color.g, _color.b);
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      shoreFoamTex.needsUpdate = true;
      terrainGeo.computeVertexNormals();
    };

    const rebuildTileBorders = (eng: CityEngine) => {
      while (tileBordersGroup.children.length > 0) {
        const ch = tileBordersGroup.children.pop()!;
        if ((ch as THREE.Line).geometry) (ch as THREE.Line).geometry.dispose();
        tileBordersGroup.remove(ch);
      }

      for (let tz = 0; tz < 3; tz++) {
        for (let tx = 0; tx < 3; tx++) {
          const tIdx = tz * 3 + tx;
          const unlocked = (eng.unlockedTilesMask & (1 << tIdx)) !== 0;
          const x0 = tx * MACRO_TILE_SIZE - 0.5;
          const z0 = tz * MACRO_TILE_SIZE - 0.5;
          const s = MACRO_TILE_SIZE;
          const y = 1.85;

          const pts = [
            new THREE.Vector3(x0, y, z0),
            new THREE.Vector3(x0 + s, y, z0),
            new THREE.Vector3(x0 + s, y, z0 + s),
            new THREE.Vector3(x0, y, z0 + s),
            new THREE.Vector3(x0, y, z0),
          ];
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({
            color: unlocked ? '#38bdf8' : '#f59e0b',
            transparent: true,
            opacity: showTilesRef.current ? 0.92 : unlocked ? 0.24 : 0.42,
          });
          tileBordersGroup.add(new THREE.Line(lineGeo, lineMat));
        }
      }
    };

    const pushRciBox = (
      poolIdx: number,
      cellIdx: number,
      px: number,
      py: number,
      pz: number,
      rotY: number,
      sx: number,
      sy: number,
      sz: number,
      hex: number
    ) => {
      const p = rciPoolEntries[poolIdx];
      if (p.slot >= TOTAL_CELLS * 2 - 2) return;
      _dummy.position.set(px, py, pz);
      _dummy.rotation.set(0, rotY, 0);
      _dummy.scale.set(sx, sy, sz);
      _dummy.updateMatrix();
      p.mesh.setMatrixAt(p.slot, _dummy.matrix);
      _color.setHex(hex);
      p.mesh.setColorAt(p.slot, _color);
      p.cellIndices[p.slot] = cellIdx;
      p.realColors[p.slot] = hex;
      p.slot++;
    };

    const rebuildStaticCityMeshes = (eng: CityEngine) => {
      let sidewalkSlot = 0;
      let deckSlot = 0;
      let stripeSlot = 0;
      let pierSlot = 0;
      let lightPoleSlot = 0;
      let lightBulbSlot = 0;
      let zoneSlot = 0;
      let roofSlot = 0;
      let trunkSlot = 0;
      let pineSlot = 0;
      let broadSlot = 0;
      let civicBoxSlot = 0;
      let civicCylSlot = 0;

      for (const p of rciPoolEntries) p.slot = 0;

      windTurbineCoords = [];
      airportCoords = null;
      roadCellsList = [];

      // 1. Roads, Sidewalk Curbs, Crosswalks, Bridges & Night Streetlights
      for (let z = 0; z < GRID_SIZE; z++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const i = eng.idx(x, z);
          const tier = eng.roadTier[i] as RoadTier;

          if (tier !== RoadTier.None) {
            roadCellsList.push(i);
            const isBridge = isWaterTerrain(eng.terrain[i]);
            const baseY = isBridge ? 1.55 : surfaceHeightAt(eng, x, z) + 0.04;
            const width =
              tier === RoadTier.Highway6L ? 0.86 : tier === RoadTier.Avenue4L ? 0.72 : 0.54;
            const curbWidth = width + 0.18;
            const asphaltHex =
              tier === RoadTier.Highway6L
                ? 0x162030
                : tier === RoadTier.Avenue4L
                ? 0x1e293b
                : 0x283548;

            // Curb / Sidewalk hub pad (non-highway) or raised bridge deck
            if (tier !== RoadTier.Highway6L && !isBridge && sidewalkSlot < 27900) {
              _dummy.position.set(x, baseY - 0.02, z);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(curbWidth, 0.075, curbWidth);
              _dummy.updateMatrix();
              roadSidewalkMesh.setMatrixAt(sidewalkSlot, _dummy.matrix);
              _color.setHex(0xcbd5e1);
              roadSidewalkMesh.setColorAt(sidewalkSlot, _color);
              sidewalkSlot++;
            }

            // Central asphalt hub pad
            _dummy.position.set(x, baseY, z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(width, isBridge ? 0.22 : 0.09, width);
            _dummy.updateMatrix();
            roadDeckMesh.setMatrixAt(deckSlot, _dummy.matrix);
            _color.setHex(isBridge ? 0x3f4c5e : asphaltHex);
            roadDeckMesh.setColorAt(deckSlot, _color);
            roadDeckCellIndices[deckSlot] = i;
            roadDeckRealColors[deckSlot] = _color.getHex();
            deckSlot++;

            const mask = eng.roadMask[i];
            let degCount = 0;

            for (const dir of DIR_OFFSETS) {
              if ((mask & dir.bit) === 0) continue;
              degCount++;
              const angle = Math.atan2(dir.dx, dir.dz);
              const armLen = dir.diag ? Math.SQRT2 * 0.56 : 0.56;
              const mx = x + dir.dx * 0.26;
              const mz = z + dir.dz * 0.26;
              const nx = x + dir.dx;
              const nz = z + dir.dz;
              const neighborBridge =
                eng.inBounds(nx, nz) && isWaterTerrain(eng.terrain[eng.idx(nx, nz)]);
              const armY =
                isBridge && neighborBridge
                  ? 1.55
                  : isBridge || neighborBridge
                  ? (baseY + (neighborBridge ? 1.55 : surfaceHeightAt(eng, nx, nz) + 0.04)) * 0.5
                  : (baseY + surfaceHeightAt(eng, nx, nz) + 0.04) * 0.5;

              if (tier !== RoadTier.Highway6L && !isBridge && sidewalkSlot < 27900) {
                _dummy.position.set(mx, armY - 0.02, mz);
                _dummy.rotation.set(0, angle, 0);
                _dummy.scale.set(curbWidth, 0.075, armLen);
                _dummy.updateMatrix();
                roadSidewalkMesh.setMatrixAt(sidewalkSlot, _dummy.matrix);
                _color.setHex(0xcbd5e1);
                roadSidewalkMesh.setColorAt(sidewalkSlot, _color);
                sidewalkSlot++;
              }

              if (deckSlot < 27900) {
                _dummy.position.set(mx, armY, mz);
                _dummy.rotation.set(0, angle, 0);
                _dummy.scale.set(width, isBridge ? 0.2 : 0.09, armLen);
                _dummy.updateMatrix();
                roadDeckMesh.setMatrixAt(deckSlot, _dummy.matrix);
                _color.setHex(isBridge ? 0x3f4c5e : asphaltHex);
                roadDeckMesh.setColorAt(deckSlot, _color);
                roadDeckCellIndices[deckSlot] = i;
                roadDeckRealColors[deckSlot] = _color.getHex();
                deckSlot++;
              }

              // Lane divider / Avenue landscaped median
              if (stripeSlot < 31900) {
                _dummy.position.set(mx, armY + (isBridge ? 0.21 : 0.095), mz);
                _dummy.rotation.set(0, angle, 0);
                _dummy.scale.set(
                  tier === RoadTier.Avenue4L ? 0.11 : 0.045,
                  0.025,
                  armLen * 0.68
                );
                _dummy.updateMatrix();
                roadStripeMesh.setMatrixAt(stripeSlot, _dummy.matrix);
                _color.setHex(
                  tier === RoadTier.Avenue4L
                    ? 0x16a34a
                    : tier === RoadTier.Highway6L
                    ? 0xfacc15
                    : 0xe2e8f0
                );
                roadStripeMesh.setColorAt(stripeSlot, _color);
                stripeSlot++;
              }

              // Bridge side safety parapets over water
              if (isBridge && sidewalkSlot < 27900) {
                const px = Math.cos(angle) * (width * 0.52);
                const pz = -Math.sin(angle) * (width * 0.52);
                for (const side of [-1, 1]) {
                  if (sidewalkSlot >= 27900) break;
                  _dummy.position.set(mx + px * side, armY + 0.18, mz + pz * side);
                  _dummy.rotation.set(0, angle, 0);
                  _dummy.scale.set(0.06, 0.16, armLen);
                  _dummy.updateMatrix();
                  roadSidewalkMesh.setMatrixAt(sidewalkSlot, _dummy.matrix);
                  _color.setHex(0xe2e8f0);
                  roadSidewalkMesh.setColorAt(sidewalkSlot, _color);
                  sidewalkSlot++;
                }
              }
            }

            // Zebra crosswalk stripes at intersections (degCount >= 3)
            if (degCount >= 3 && stripeSlot < 31880) {
              const zebraY = baseY + (isBridge ? 0.21 : 0.096);
              for (let sOff = -0.18; sOff <= 0.181; sOff += 0.12) {
                _dummy.position.set(x + sOff, zebraY, z);
                _dummy.rotation.set(0, 0, 0);
                _dummy.scale.set(0.05, 0.015, width * 0.72);
                _dummy.updateMatrix();
                roadStripeMesh.setMatrixAt(stripeSlot, _dummy.matrix);
                _color.setHex(0xf8fafc);
                roadStripeMesh.setColorAt(stripeSlot, _color);
                stripeSlot++;
              }
            }

            // Avenue 4L boulevard median mini-trees + Night Streetlights
            if (tier === RoadTier.Avenue4L && !isBridge && (x + z) % 2 === 0 && broadSlot < 7950) {
              _dummy.position.set(x, baseY + 0.11, z);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(0.22, 0.28, 0.22);
              _dummy.updateMatrix();
              treeBroadMesh.setMatrixAt(broadSlot, _dummy.matrix);
              _color.setHex(0x22c55e);
              treeBroadMesh.setColorAt(broadSlot, _color);
              broadSlot++;
            }

            if (
              tier !== RoadTier.Highway6L &&
              (x + z) % 3 === 0 &&
              lightPoleSlot < 5950 &&
              lightBulbSlot < 5950
            ) {
              const side = (x + z) % 2 === 0 ? 1 : -1;
              const lx = x + side * (width * 0.56);
              const lz = z + side * (width * 0.18);
              const ly = baseY + (isBridge ? 0.18 : 0.06);
              _dummy.position.set(lx, ly, lz);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(0.04, 0.52, 0.04);
              _dummy.updateMatrix();
              streetLightPoleMesh.setMatrixAt(lightPoleSlot, _dummy.matrix);
              _color.setHex(0x475569);
              streetLightPoleMesh.setColorAt(lightPoleSlot, _color);
              lightPoleSlot++;

              _dummy.position.set(lx, ly + 0.5, lz);
              _dummy.scale.set(0.11, 0.07, 0.11);
              _dummy.updateMatrix();
              streetLightBulbMesh.setMatrixAt(lightBulbSlot++, _dummy.matrix);
            }

            // Bridge piers & twin cable-stayed pylons over water
            if (isBridge && pierSlot < 4450 && (x + z) % 2 === 0) {
              const bedY = Math.min(-0.6, eng.elevation[i]);
              const pierH = 1.55 - bedY;
              _dummy.position.set(x, bedY, z);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(0.26, pierH, 0.26);
              _dummy.updateMatrix();
              bridgePierMesh.setMatrixAt(pierSlot, _dummy.matrix);
              _color.setHex(0x94a3b8);
              bridgePierMesh.setColorAt(pierSlot, _color);
              pierSlot++;

              if (tier >= RoadTier.Avenue4L && (x + z) % 6 === 0 && pierSlot < 4450) {
                _dummy.position.set(x, 1.55, z);
                _dummy.scale.set(0.16, 2.35, 0.92);
                _dummy.updateMatrix();
                bridgePierMesh.setMatrixAt(pierSlot, _dummy.matrix);
                _color.setHex(0xf1f5f9);
                bridgePierMesh.setColorAt(pierSlot, _color);
                pierSlot++;
              }
            }
          }

          // 2. Zoned Parcels & Oriented Multi-Volume RCI Architecture (Levels 1..5)
          const zKind = eng.zones[i] as ZoneKind;
          if (zKind !== ZoneKind.None) {
            const groundY = surfaceHeightAt(eng, x, z);
            const lv = eng.rciLevel[i];
            const diagMode = eng.rciDiag[i];
            const rotY = eng.getRoadFacingAngle(x, z);
            const lotScale = diagMode !== 0 ? 0.68 : 0.86;

            _dummy.position.set(x, groundY + 0.015, z);
            _dummy.rotation.set(0, rotY, 0);
            _dummy.scale.set(lotScale, 0.04, lotScale);
            _dummy.updateMatrix();
            zonePadMesh.setMatrixAt(zoneSlot, _dummy.matrix);
            _color.set(ZONE_CATALOG[zKind].color);
            if (lv > 0) _color.lerp(new THREE.Color('#64748b'), 0.7);
            zonePadMesh.setColorAt(zoneSlot, _color);
            zoneSlot++;

            if (lv > 0) {
              const abandoned = eng.rciAbandoned[i] === 1;
              const variant = eng.rciVariant[i];
              const isRes = zKind === ZoneKind.ResLow || zKind === ZoneKind.ResHigh;
              const isComOrOffice =
                zKind === ZoneKind.ComLow || zKind === ZoneKind.ComHigh || zKind === ZoneKind.Office;
              const poolIdx = isRes ? 0 : isComOrOffice ? 1 : 2;

              let h = 0.72;
              let w = lotScale * 0.82;
              let d = lotScale * 0.82;
              let tint = 0xffffff;

              if (zKind === ZoneKind.ResLow) {
                h = 0.46 + lv * 0.22;
                w = lotScale * 0.66;
                d = lotScale * 0.62;
                tint = [0xfef3c7, 0xfde68a, 0xf1f5f9, 0xfecdd3][variant % 4];
              } else if (zKind === ZoneKind.ResHigh) {
                h = 1.65 + lv * 1.18 + (variant % 3) * 0.35;
                tint = [0xe2e8f0, 0xfef3c7, 0xbae6fd, 0xdbeafe][variant % 4];
              } else if (zKind === ZoneKind.ComLow) {
                h = 0.65 + lv * 0.28;
                tint = [0xbae6fd, 0xfde68a, 0xddd6fe, 0xfed7aa][variant % 4];
              } else if (zKind === ZoneKind.ComHigh) {
                h = 2.05 + lv * 1.48 + (variant % 3) * 0.4;
                tint = [0x93c5fd, 0xa5f3fc, 0xc7d2fe, 0xe2e8f0][variant % 4];
              } else if (zKind === ZoneKind.Industrial) {
                h = 0.68 + lv * 0.28;
                w = lotScale * 0.88;
                tint = [0xd6d3d1, 0xfde047, 0xfdba74, 0xa8a29e][variant % 4];
              } else {
                h = 2.3 + lv * 1.58 + (variant % 2) * 0.5;
                tint = [0x67e8f9, 0x93c5fd, 0xe0f2fe, 0xc4b5fd][variant % 4];
              }

              if (abandoned) tint = 0x475569;
              if (eng.cellFire[i] > 0) tint = 0xf97316;

              const sinR = Math.sin(rotY);
              const cosR = Math.cos(rotY);

              // Main tower / volume
              pushRciBox(poolIdx, i, x, groundY + 0.04, z, rotY, w, h, d, tint);

              // Ground podium / porch / storefront awning oriented toward street (+Z local)
              if (zKind === ZoneKind.ResLow) {
                // Front porch step facing road
                pushRciBox(
                  3,
                  i,
                  x + sinR * (d * 0.52),
                  groundY + 0.04,
                  z + cosR * (d * 0.52),
                  rotY,
                  w * 0.52,
                  0.14,
                  0.18,
                  abandoned ? 0x334155 : 0xf8fafc
                );
                // Pitched roof
                if (roofSlot < 5950) {
                  _dummy.position.set(x, groundY + 0.04 + h, z);
                  _dummy.rotation.set(0, rotY + Math.PI / 4, 0);
                  _dummy.scale.set(w * 1.16, 0.36, d * 1.16);
                  _dummy.updateMatrix();
                  rciRoofMesh.setMatrixAt(roofSlot, _dummy.matrix);
                  _color.setHex(
                    abandoned ? 0x334155 : [0xb45309, 0x991b1b, 0x334155, 0x0f766e][variant % 4]
                  );
                  rciRoofMesh.setColorAt(roofSlot, _color);
                  roofSlot++;
                }
              } else if (zKind === ZoneKind.ComLow) {
                // Street-facing storefront awning
                pushRciBox(
                  3,
                  i,
                  x + sinR * (d * 0.53),
                  groundY + 0.32,
                  z + cosR * (d * 0.53),
                  rotY,
                  w * 0.88,
                  0.09,
                  0.18,
                  abandoned ? 0x475569 : [0x0ea5e9, 0xf97316, 0x10b981, 0x8b5cf6][variant % 4]
                );
              } else if (zKind === ZoneKind.Industrial) {
                // Industrial chimney stack
                pushRciBox(
                  3,
                  i,
                  x - w * 0.25,
                  groundY + 0.04 + h,
                  z - d * 0.25,
                  rotY,
                  0.14,
                  0.45 + lv * 0.08,
                  0.14,
                  0x57534e
                );
              } else {
                // High-rise ground lobby podium
                pushRciBox(
                  3,
                  i,
                  x,
                  groundY + 0.04,
                  z,
                  rotY,
                  lotScale * 0.94,
                  0.38,
                  lotScale * 0.94,
                  abandoned ? 0x334155 : 0x475569
                );
                // Upper setback crown for Lv 3..5 skyscrapers
                if (lv >= 3) {
                  const crownH = h * (lv >= 4 ? 0.36 : 0.22);
                  pushRciBox(
                    poolIdx,
                    i,
                    x,
                    groundY + 0.04 + h,
                    z,
                    rotY,
                    w * 0.64,
                    crownH,
                    d * 0.64,
                    tint
                  );
                  // Rooftop mechanical / helipad / spire on Lv 4-5
                  if (lv >= 4) {
                    pushRciBox(
                      3,
                      i,
                      x,
                      groundY + 0.04 + h + crownH,
                      z,
                      rotY,
                      w * 0.32,
                      0.16,
                      d * 0.32,
                      0x94a3b8
                    );
                    if (lv === 5 && (zKind === ZoneKind.ComHigh || zKind === ZoneKind.Office)) {
                      pushRciBox(
                        3,
                        i,
                        x,
                        groundY + 0.2 + h + crownH,
                        z,
                        rotY,
                        0.06,
                        0.95,
                        0.06,
                        0xf8fafc
                      );
                    }
                  }
                }
              }
            }
          }

          // 3. Natural Forest Trees (Wood Trunk + Conifer/Broadleaf Canopy)
          if (eng.trees[i] > 0 && trunkSlot < 7950) {
            const groundY = surfaceHeightAt(eng, x, z);
            const s = 0.46 + eng.trees[i] * 0.15;
            const tk = eng.terrain[i] as TerrainKind;

            // Wood trunk
            _dummy.position.set(x, groundY, z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(0.11 * s, 0.42 * s, 0.11 * s);
            _dummy.updateMatrix();
            treeTrunkMesh.setMatrixAt(trunkSlot, _dummy.matrix);
            _color.setHex(0x78350f);
            treeTrunkMesh.setColorAt(trunkSlot, _color);
            trunkSlot++;

            const isConifer = tk === TerrainKind.Hill || ((x * 13 + z * 7) % 3 === 0);
            if (isConifer && pineSlot < 7950) {
              _dummy.position.set(x, groundY + 0.28 * s, z);
              _dummy.rotation.set(0, (i * 1.3) % Math.PI, 0);
              _dummy.scale.set(s * 0.95, s * 1.65, s * 0.95);
              _dummy.updateMatrix();
              treePineMesh.setMatrixAt(pineSlot, _dummy.matrix);
              _color.setHex(eng.trees[i] === 3 ? 0x15803d : 0x166534);
              treePineMesh.setColorAt(pineSlot, _color);
              pineSlot++;
            } else if (broadSlot < 7950) {
              _dummy.position.set(x, groundY + 0.34 * s, z);
              _dummy.rotation.set(0, (i * 0.9) % Math.PI, 0);
              _dummy.scale.set(s * 0.88, s * 0.88, s * 0.88);
              _dummy.updateMatrix();
              treeBroadMesh.setMatrixAt(broadSlot, _dummy.matrix);
              _color.setHex(eng.trees[i] === 3 ? 0x16a34a : 0x22c55e);
              treeBroadMesh.setColorAt(broadSlot, _color);
              broadSlot++;
            }
          }
        }
      }

      // 4. Civic Structures, Power/Water Plants, Parks, Transit & Monuments
      for (const st of eng.structures) {
        const spec = BUILDING_SPECS[st.buildingId];
        const cx = st.x + st.w * 0.5 - 0.5;
        const cz = st.z + st.d * 0.5 - 0.5;
        const gy = surfaceHeightAt(eng, st.x, st.z);

        const pushBox = (
          px: number,
          py: number,
          pz: number,
          sx: number,
          sy: number,
          sz: number,
          hex: number
        ) => {
          if (civicBoxSlot >= 4480) return;
          _dummy.position.set(px, py, pz);
          _dummy.rotation.set(0, (st.rotation * Math.PI) / 2, 0);
          _dummy.scale.set(sx, sy, sz);
          _dummy.updateMatrix();
          civicBoxMesh.setMatrixAt(civicBoxSlot, _dummy.matrix);
          _color.setHex(hex);
          civicBoxMesh.setColorAt(civicBoxSlot, _color);
          civicRealColors[civicBoxSlot] = hex;
          civicBoxSlot++;
        };

        const pushCyl = (
          px: number,
          py: number,
          pz: number,
          rx: number,
          sy: number,
          rz: number,
          hex: number
        ) => {
          if (civicCylSlot >= 2180) return;
          _dummy.position.set(px, py, pz);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(rx, sy, rz);
          _dummy.updateMatrix();
          civicCylMesh.setMatrixAt(civicCylSlot, _dummy.matrix);
          _color.setHex(hex);
          civicCylMesh.setColorAt(civicCylSlot, _color);
          civicCylSlot++;
        };

        if (st.buildingId === 'wind_turbine') {
          pushCyl(cx, gy, cz, 0.24, 0.25, 0.24, 0x94a3b8);
          pushCyl(cx, gy + 0.2, cz, 0.16, 3.05, 0.16, 0xf8fafc);
          windTurbineCoords.push({ x: cx, y: gy + 3.15, z: cz });
        } else if (st.buildingId === 'water_tower') {
          pushCyl(cx, gy, cz, 0.3, 1.8, 0.3, 0x64748b);
          pushCyl(cx, gy + 1.75, cz, 0.82, 0.78, 0.82, 0x38bdf8);
          pushCyl(cx, gy + 2.53, cz, 0.45, 0.16, 0.45, 0x0284c7);
        } else if (st.buildingId === 'coal_plant') {
          pushBox(cx, gy, cz, 1.78, 1.25, 1.78, 0x78716c);
          pushCyl(cx - 0.45, gy + 1.25, cz - 0.4, 0.3, 2.35, 0.3, 0xd6d3d1);
          pushCyl(cx + 0.45, gy + 1.25, cz - 0.4, 0.3, 2.15, 0.3, 0xd6d3d1);
        } else if (st.buildingId === 'nuclear_plant') {
          pushBox(cx, gy, cz, 2.65, 1.25, 2.65, 0xcbd5e1);
          pushCyl(cx - 0.65, gy + 1.1, cz - 0.5, 0.96, 2.95, 0.96, 0xe2e8f0);
          pushCyl(cx + 0.65, gy + 1.1, cz + 0.5, 0.96, 2.95, 0.96, 0xe2e8f0);
        } else if (st.buildingId === 'solar_plant') {
          pushBox(cx, gy, cz, 1.85, 0.16, 1.85, 0x94a3b8);
          pushBox(cx, gy + 0.16, cz - 0.42, 1.68, 0.24, 0.62, 0x1d4ed8);
          pushBox(cx, gy + 0.16, cz + 0.42, 1.68, 0.24, 0.62, 0x1d4ed8);
        } else if (st.buildingId === 'city_park' || st.buildingId === 'botanical_plaza') {
          pushBox(cx, gy, cz, st.w - 0.1, 0.1, st.d - 0.1, 0x16a34a);
          pushCyl(cx, gy + 0.1, cz, 0.68, 0.2, 0.68, 0x38bdf8);
          for (const [ox, oz] of [
            [-0.6, -0.6],
            [0.6, 0.6],
          ]) {
            if (trunkSlot < 7950 && broadSlot < 7950) {
              _dummy.position.set(cx + ox, gy + 0.1, cz + oz);
              _dummy.scale.set(0.09, 0.32, 0.09);
              _dummy.updateMatrix();
              treeTrunkMesh.setMatrixAt(trunkSlot, _dummy.matrix);
              _color.setHex(0x78350f);
              treeTrunkMesh.setColorAt(trunkSlot++, _color);

              _dummy.position.set(cx + ox, gy + 0.34, cz + oz);
              _dummy.scale.set(0.65, 0.72, 0.65);
              _dummy.updateMatrix();
              treeBroadMesh.setMatrixAt(broadSlot, _dummy.matrix);
              _color.setHex(0x22c55e);
              treeBroadMesh.setColorAt(broadSlot++, _color);
            }
          }
        } else if (st.buildingId === 'monument_stadium') {
          pushCyl(cx, gy, cz, 3.75, 1.55, 3.45, 0xe2e8f0);
          pushCyl(cx, gy + 0.22, cz, 2.45, 1.4, 2.15, 0x16a34a);
          pushBox(cx - 1.55, gy + 1.55, cz - 1.55, 0.22, 1.25, 0.22, 0xfef08a);
          pushBox(cx + 1.55, gy + 1.55, cz + 1.55, 0.22, 1.25, 0.22, 0xfef08a);
          pushBox(cx - 1.55, gy + 1.55, cz + 1.55, 0.22, 1.25, 0.22, 0xfef08a);
          pushBox(cx + 1.55, gy + 1.55, cz - 1.55, 0.22, 1.25, 0.22, 0xfef08a);
        } else if (st.buildingId === 'monument_fox_tower') {
          pushCyl(cx, gy, cz, 2.15, 0.72, 2.15, 0x334155);
          pushCyl(cx, gy + 0.72, cz, 0.56, 7.65, 0.56, 0xe2e8f0);
          pushCyl(cx, gy + 6.45, cz, 1.5, 0.68, 1.5, 0x38bdf8);
          pushCyl(cx, gy + 8.37, cz, 0.12, 2.25, 0.12, 0xef4444);
        } else if (st.buildingId === 'monument_airport') {
          pushBox(cx, gy, cz - 0.9, st.w - 0.3, 0.95, 1.4, 0x93c5fd);
          pushCyl(cx - 1.6, gy + 0.95, cz - 0.9, 0.38, 2.15, 0.38, 0xf8fafc);
          pushBox(cx, gy, cz + 0.95, st.w - 0.1, 0.12, 1.38, 0x1e293b);
          airportCoords = { x: cx, y: gy + 0.36, z: cz + 0.95 };
        } else if (st.buildingId === 'monument_arcology') {
          pushBox(cx, gy, cz, 3.65, 1.85, 3.65, 0x0f766e);
          pushBox(cx, gy + 1.85, cz, 2.65, 3.25, 2.65, 0x0ea5e9);
          pushBox(cx, gy + 5.1, cz, 1.65, 4.25, 1.65, 0xa855f7);
          pushCyl(cx, gy + 9.35, cz, 0.26, 2.7, 0.26, 0xfef08a);
        } else {
          const baseH =
            st.buildingId === 'hospital' || st.buildingId === 'university'
              ? 2.25
              : st.buildingId === 'metro_station'
              ? 0.72
              : 1.28;
          pushBox(
            cx,
            gy,
            cz,
            st.w - 0.18,
            baseH,
            st.d - 0.18,
            new THREE.Color(spec.colorHex).getHex()
          );
          pushBox(cx, gy + baseH, cz, (st.w - 0.18) * 0.65, 0.28, (st.d - 0.18) * 0.65, 0xf8fafc);
          if (st.buildingId === 'hospital') {
            pushCyl(cx, gy + baseH + 0.28, cz, 0.65, 0.08, 0.65, 0xef4444);
          }
        }
      }

      roadSidewalkMesh.count = sidewalkSlot;
      roadDeckMesh.count = deckSlot;
      roadStripeMesh.count = stripeSlot;
      bridgePierMesh.count = pierSlot;
      streetLightPoleMesh.count = lightPoleSlot;
      streetLightBulbMesh.count = lightBulbSlot;
      zonePadMesh.count = zoneSlot;
      for (const p of rciPoolEntries) p.mesh.count = p.slot;
      rciRoofMesh.count = roofSlot;
      treeTrunkMesh.count = trunkSlot;
      treePineMesh.count = pineSlot;
      treeBroadMesh.count = broadSlot;
      civicBoxMesh.count = civicBoxSlot;
      civicCylMesh.count = civicCylSlot;

      for (const m of [
        roadSidewalkMesh,
        roadDeckMesh,
        roadStripeMesh,
        bridgePierMesh,
        streetLightPoleMesh,
        streetLightBulbMesh,
        zonePadMesh,
        rciResMesh,
        rciComMesh,
        rciIndMesh,
        rciDetailMesh,
        rciRoofMesh,
        treeTrunkMesh,
        treePineMesh,
        treeBroadMesh,
        civicBoxMesh,
        civicCylMesh,
      ]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }

      // 5. Rebuild Bus Stop Markers & Line Ribbons
      while (busLinesGroup.children.length > 0) {
        const ch = busLinesGroup.children.pop()!;
        if ((ch as THREE.Mesh).geometry) (ch as THREE.Mesh).geometry.dispose();
      }
      for (const line of eng.busLines) {
        const pts: THREE.Vector3[] = [];
        for (const st of line.stops) {
          const y =
            (isWaterTerrain(eng.terrain[eng.idx(st.x, st.z)]) ? 1.8 : surfaceHeightAt(eng, st.x, st.z)) +
            0.28;
          pts.push(new THREE.Vector3(st.x, y, st.z));
          const stopPole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 0.55, 10),
            new THREE.MeshBasicMaterial({ color: line.color })
          );
          stopPole.position.set(st.x + 0.28, y, st.z + 0.28);
          busLinesGroup.add(stopPole);
        }
        if (pts.length >= 2) {
          pts.push(pts[0].clone());
          const curveGeo = new THREE.BufferGeometry().setFromPoints(pts);
          busLinesGroup.add(
            new THREE.Line(curveGeo, new THREE.LineBasicMaterial({ color: line.color }))
          );
        }
      }
      for (const draft of eng.draftBusStops) {
        const y = surfaceHeightAt(eng, draft.x, draft.z) + 0.4;
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 12, 12),
          new THREE.MeshBasicMaterial({ color: '#38bdf8' })
        );
        marker.position.set(draft.x, y, draft.z);
        busLinesGroup.add(marker);
      }

      // 6. Rebuild Underground Metro Platforms & Glowing Tubes (Y = -2.1)
      while (metroGroup.children.length > 0) {
        const ch = metroGroup.children.pop()!;
        if ((ch as THREE.Mesh).geometry) (ch as THREE.Mesh).geometry.dispose();
      }
      for (const st of eng.structures) {
        if (st.buildingId !== 'metro_station') continue;
        const cx = st.x + st.w * 0.5 - 0.5;
        const cz = st.z + st.d * 0.5 - 0.5;
        const platform = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 0.45, 1.4),
          new THREE.MeshBasicMaterial({ color: '#06b6d4' })
        );
        platform.position.set(cx, -2.1, cz);
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, surfaceHeightAt(eng, st.x, st.z) + 2.2, 10),
          new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.65 })
        );
        shaft.position.set(cx, (surfaceHeightAt(eng, st.x, st.z) - 2.1) * 0.5, cz);
        metroGroup.add(platform, shaft);
      }
      for (const seg of eng.metroSegments) {
        const curve = new THREE.LineCurve3(
          new THREE.Vector3(seg.fromX, -2.1, seg.fromZ),
          new THREE.Vector3(seg.toX, -2.1, seg.toZ)
        );
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 16, 0.24, 8, false),
          new THREE.MeshBasicMaterial({ color: '#22d3ee' })
        );
        metroGroup.add(tube);
      }
    };

    // --- 5. Fast Skylines White Analytical Info Views Updater ---
    const refreshAnalyticalOverlay = (eng: CityEngine, mode: InfoOverlayMode) => {
      const isMetroXray =
        mode === 'metro' ||
        toolRef.current.kind === 'metro_tunnel' ||
        (toolRef.current.kind === 'building' && toolRef.current.buildingId === 'metro_station');

      const isWhiteInfo = mode !== 'normal' && mode !== 'metro';

      terrainMesh.material = isWhiteInfo ? terrainInfoMat : terrainNormalMat;
      terrainNormalMat.opacity = isMetroXray ? 0.24 : 1.0;
      terrainNormalMat.depthWrite = !isMetroXray;
      waterMat.opacity = isMetroXray ? 0.18 : isWhiteInfo ? 0.35 : 0.86;
      shoreFoamMesh.visible = !isWhiteInfo && !isMetroXray;

      for (const p of rciPoolEntries) {
        p.mesh.material = isWhiteInfo ? whiteInfoMat : p.mat;
      }
      rciResMat.opacity = isMetroXray ? 0.22 : 1.0;
      rciComMat.opacity = isMetroXray ? 0.22 : 1.0;
      rciIndMat.opacity = isMetroXray ? 0.22 : 1.0;
      solidRealisticMat.opacity = isMetroXray ? 0.3 : 1.0;

      treeTrunkMesh.visible = !isWhiteInfo && !isMetroXray;
      treePineMesh.visible = !isWhiteInfo && !isMetroXray;
      treeBroadMesh.visible = !isWhiteInfo && !isMetroXray;
      rciRoofMesh.visible = !isWhiteInfo && !isMetroXray;
      streetLightPoleMesh.visible = !isWhiteInfo && !isMetroXray;
      metroGroup.visible = isMetroXray || eng.metroSegments.length > 0;

      if (!isWhiteInfo) {
        if (lastOverlayMode !== 'normal' && lastOverlayMode !== 'metro') {
          for (const p of rciPoolEntries) {
            for (let s = 0; s < p.mesh.count; s++) {
              _color.setHex(p.realColors[s]);
              p.mesh.setColorAt(s, _color);
            }
            if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
          }

          for (let s = 0; s < roadDeckMesh.count; s++) {
            _color.setHex(roadDeckRealColors[s]);
            roadDeckMesh.setColorAt(s, _color);
          }
          if (roadDeckMesh.instanceColor) roadDeckMesh.instanceColor.needsUpdate = true;

          for (let s = 0; s < civicBoxMesh.count; s++) {
            _color.setHex(civicRealColors[s]);
            civicBoxMesh.setColorAt(s, _color);
          }
          if (civicBoxMesh.instanceColor) civicBoxMesh.instanceColor.needsUpdate = true;
        }
        return;
      }

      // Populate 108x108 DataTexture on crisp architectural white (#f1f5f9)
      for (let i = 0; i < TOTAL_CELLS; i++) {
        const off = i * 4;
        if (isWaterTerrain(eng.terrain[i])) {
          overlayTexData[off] = 203;
          overlayTexData[off + 1] = 229;
          overlayTexData[off + 2] = 248;
          overlayTexData[off + 3] = 255;
          continue;
        }

        let r = 241;
        let g = 245;
        let b = 249;

        if (mode === 'power') {
          if (eng.powerMap[i]) {
            r = 186;
            g = 230;
            b = 253;
          }
        } else if (mode === 'water') {
          if (eng.waterMap[i]) {
            r = 165;
            g = 243;
            b = 252;
          }
        } else if (mode === 'land_value') {
          const t = eng.landValueMap[i] / 100;
          r = Math.round(241 - t * 205);
          g = Math.round(245 - t * 50);
          b = Math.round(249 - t * 145);
        } else if (mode === 'pollution') {
          const t = eng.pollutionMap[i] / 100;
          r = Math.round(241 - t * 55);
          g = Math.round(245 - t * 175);
          b = Math.round(249 - t * 90);
        } else if (mode === 'services') {
          const t = eng.serviceMap[i] / 100;
          r = Math.round(241 - t * 185);
          g = Math.round(245 - t * 95);
          b = 250;
        }

        overlayTexData[off] = r;
        overlayTexData[off + 1] = g;
        overlayTexData[off + 2] = b;
        overlayTexData[off + 3] = 255;
      }
      overlayDataTex.needsUpdate = true;

      // Color all RCI meshes uniformly in analytical mode
      for (const p of rciPoolEntries) {
        for (let s = 0; s < p.mesh.count; s++) {
          const ci = p.cellIndices[s];
          if (mode === 'power') {
            _color.setHex(eng.powerMap[ci] ? 0x0ea5e9 : 0xef4444);
          } else if (mode === 'water') {
            _color.setHex(eng.waterMap[ci] ? 0x06b6d4 : 0xf97316);
          } else if (mode === 'traffic') {
            _color.setHex(0xf1f5f9);
          } else if (mode === 'land_value') {
            _color.setHSL(0.36, 0.8, 0.78 - (eng.landValueMap[ci] / 100) * 0.42);
          } else if (mode === 'pollution') {
            const poll = eng.pollutionMap[ci] / 100;
            _color.setRGB(0.95 - poll * 0.15, 0.95 - poll * 0.65, 0.96 - poll * 0.25);
          } else {
            _color.setHSL(0.58, 0.85, 0.82 - (eng.serviceMap[ci] / 100) * 0.45);
          }
          p.mesh.setColorAt(s, _color);
        }
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }

      for (let s = 0; s < roadDeckMesh.count; s++) {
        const ci = roadDeckCellIndices[s];
        if (mode === 'traffic') {
          const tr = eng.trafficMap[ci] / 100;
          _color.setHSL(Math.max(0, 0.33 - tr * 0.33), 0.9, 0.48);
        } else {
          _color.setHex(0xcbd5e1);
        }
        roadDeckMesh.setColorAt(s, _color);
      }
      if (roadDeckMesh.instanceColor) roadDeckMesh.instanceColor.needsUpdate = true;
    };

    // --- 6. Live Ghost & Per-Cell Road-Access Zone Preview ---
    const clearPreviewGroup = () => {
      while (previewGroup.children.length > 0) {
        const ch = previewGroup.children.pop()!;
        if ((ch as THREE.Mesh).geometry) (ch as THREE.Mesh).geometry.dispose();
        if ((ch as THREE.Mesh).material) {
          const mat = (ch as THREE.Mesh).material;
          if (!Array.isArray(mat)) mat.dispose();
        }
      }
    };

    const updatePreviewVisuals = (
      startCell: { x: number; z: number } | null,
      hoverHit: { x: number; z: number; hitX: number; hitZ: number } | null
    ) => {
      clearPreviewGroup();
      coverageRing.visible = false;
      zonePreviewMesh.count = 0;

      const eng = engineRef.current;
      const curTool = toolRef.current;

      const activeStructPlacement =
        pendingRef.current ||
        (curTool.kind === 'building' && hoverHit
          ? (() => {
              const centered = getCenteredFootprintOrigin(
                hoverHit.hitX,
                hoverHit.hitZ,
                curTool.buildingId,
                rotRef.current
              );
              const check = eng.canPlaceStructure(
                curTool.buildingId,
                centered.x,
                centered.z,
                rotRef.current
              );
              return {
                buildingId: curTool.buildingId,
                x: centered.x,
                z: centered.z,
                rotation: rotRef.current,
                cost: check.cost,
                valid: check.ok,
                reason: check.reason,
              };
            })()
          : null);

      if (activeStructPlacement) {
        const spec = BUILDING_SPECS[activeStructPlacement.buildingId];
        const w = activeStructPlacement.rotation % 2 === 1 ? spec.d : spec.w;
        const d = activeStructPlacement.rotation % 2 === 1 ? spec.w : spec.d;
        const cx = activeStructPlacement.x + w * 0.5 - 0.5;
        const cz = activeStructPlacement.z + d * 0.5 - 0.5;
        const gy = eng.inBounds(Math.round(cx), Math.round(cz))
          ? surfaceHeightAt(eng, Math.round(cx), Math.round(cz))
          : 1;

        const ghost = new THREE.Mesh(
          new THREE.BoxGeometry(w - 0.1, 1.8, d - 0.1),
          new THREE.MeshBasicMaterial({
            color: activeStructPlacement.valid ? '#22c55e' : '#ef4444',
            transparent: true,
            opacity: 0.52,
          })
        );
        ghost.position.set(cx, gy + 0.9, cz);
        previewGroup.add(ghost);

        if (spec.serviceRadius > 0) {
          coverageRing.visible = true;
          coverageRing.position.set(cx, gy + 0.18, cz);
          coverageRing.scale.set(spec.serviceRadius, spec.serviceRadius, 1);
        }
        return;
      }

      if (!hoverHit) return;

      if (curTool.kind === 'road') {
        const pts = startCell
          ? eng.computeSmartRoadPath(startCell.x, startCell.z, hoverHit.x, hoverHit.z)
          : [hoverHit];
        const est = eng.estimateRoadPathCost(pts, curTool.tier);
        const col = est.valid ? '#38bdf8' : '#ef4444';
        for (const p of pts) {
          const isW = isWaterTerrain(eng.terrain[eng.idx(p.x, p.z)]);
          const y = isW ? 1.65 : surfaceHeightAt(eng, p.x, p.z) + 0.16;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(0.76, 0.18, 0.76),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
          );
          m.position.set(p.x, y, p.z);
          previewGroup.add(m);
        }
      } else if (curTool.kind === 'zone') {
        const a = startCell || hoverHit;
        const evalRes = eng.evaluateZoneRect(a.x, a.z, hoverHit.x, hoverHit.z, curTool.zone);
        const validHex = new THREE.Color(ZONE_CATALOG[curTool.zone].color).getHex();
        let slot = 0;
        for (const c of evalRes.cells) {
          if (slot >= 1599) break;
          const cy = isWaterTerrain(eng.terrain[eng.idx(c.x, c.z)])
            ? 0.06
            : surfaceHeightAt(eng, c.x, c.z) + 0.08;
          _dummy.position.set(c.x, cy, c.z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(0.92, 0.16, 0.92);
          _dummy.updateMatrix();
          zonePreviewMesh.setMatrixAt(slot, _dummy.matrix);
          _color.setHex(c.valid ? validHex : 0xef4444);
          zonePreviewMesh.setColorAt(slot, _color);
          slot++;
        }
        zonePreviewMesh.count = slot;
        zonePreviewMesh.instanceMatrix.needsUpdate = true;
        if (zonePreviewMesh.instanceColor) zonePreviewMesh.instanceColor.needsUpdate = true;
      } else if (curTool.kind === 'bulldoze') {
        const a = startCell || hoverHit;
        const minX = Math.min(a.x, hoverHit.x);
        const maxX = Math.max(a.x, hoverHit.x);
        const minZ = Math.min(a.z, hoverHit.z);
        const maxZ = Math.max(a.z, hoverHit.z);
        let slot = 0;
        for (let zz = minZ; zz <= maxZ && slot < 1599; zz++) {
          for (let xx = minX; xx <= maxX && slot < 1599; xx++) {
            const cy = isWaterTerrain(eng.terrain[eng.idx(xx, zz)])
              ? 0.15
              : surfaceHeightAt(eng, xx, zz) + 0.08;
            _dummy.position.set(xx, cy, zz);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(0.94, 0.22, 0.94);
            _dummy.updateMatrix();
            zonePreviewMesh.setMatrixAt(slot, _dummy.matrix);
            _color.setHex(0xef4444);
            zonePreviewMesh.setColorAt(slot, _color);
            slot++;
          }
        }
        zonePreviewMesh.count = slot;
        zonePreviewMesh.instanceMatrix.needsUpdate = true;
        if (zonePreviewMesh.instanceColor) zonePreviewMesh.instanceColor.needsUpdate = true;
      } else if (curTool.kind === 'metro_tunnel' && startCell) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(startCell.x, -1.9, startCell.z),
          new THREE.Vector3(hoverHit.x, -1.9, hoverHit.z),
        ]);
        previewGroup.add(
          new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#22d3ee' }))
        );
      }
    };

    // --- 7. Exact 1:1 Analytic Heightfield Raycast (Zero Touch Offset, Zero Parallax) ---
    const raycaster = new THREE.Raycaster();
    const ndcVec = new THREE.Vector2();
    const fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    const slabHit = new THREE.Vector3();

    const sampleSurfaceY = (
      eng: CityEngine,
      wx: number,
      wz: number,
      considerBridges: boolean
    ): number => {
      const cx = THREE.MathUtils.clamp(wx, 0, GRID_SIZE - 1);
      const cz = THREE.MathUtils.clamp(wz, 0, GRID_SIZE - 1);
      const ix = Math.floor(cx);
      const iz = Math.floor(cz);
      const nx = Math.min(GRID_SIZE - 1, ix + 1);
      const nz = Math.min(GRID_SIZE - 1, iz + 1);
      const fx = cx - ix;
      const fz = cz - iz;

      const rx = Math.round(cx);
      const rz = Math.round(cz);
      const ci = eng.idx(rx, rz);
      if (considerBridges && eng.roadTier[ci] !== RoadTier.None && isWaterTerrain(eng.terrain[ci])) {
        return 1.62;
      }

      const h00 = isWaterTerrain(eng.terrain[eng.idx(ix, iz)]) ? 0 : Math.max(0.05, eng.elevation[eng.idx(ix, iz)]);
      const h10 = isWaterTerrain(eng.terrain[eng.idx(nx, iz)]) ? 0 : Math.max(0.05, eng.elevation[eng.idx(nx, iz)]);
      const h01 = isWaterTerrain(eng.terrain[eng.idx(ix, nz)]) ? 0 : Math.max(0.05, eng.elevation[eng.idx(ix, nz)]);
      const h11 = isWaterTerrain(eng.terrain[eng.idx(nx, nz)]) ? 0 : Math.max(0.05, eng.elevation[eng.idx(nx, nz)]);

      const h0 = h00 + (h10 - h00) * fx;
      const h1 = h01 + (h11 - h01) * fx;
      return h0 + (h1 - h0) * fz;
    };

    const raycastTerrainPoint = (
      clientX: number,
      clientY: number
    ): { x: number; z: number; hitX: number; hitZ: number } | null => {
      const eng = engineRef.current;
      const curTool = toolRef.current;
      const considerBridges =
        curTool.kind === 'bulldoze' || curTool.kind === 'inspect' || curTool.kind === 'bus_line';

      camera.updateMatrixWorld();
      const rect = renderer.domElement.getBoundingClientRect();
      ndcVec.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndcVec, camera);

      const ray = raycaster.ray;
      if (Math.abs(ray.direction.y) < 1e-4) return null;

      // Clip ray against vertical height slab Y in [-0.5, 14.5]
      const tTop = (14.5 - ray.origin.y) / ray.direction.y;
      const tBot = (-0.5 - ray.origin.y) / ray.direction.y;
      const tMin = Math.max(0.5, Math.min(tTop, tBot));
      const tMax = Math.max(tMin + 0.5, Math.max(tTop, tBot));

      const STEPS = 32;
      const dt = (tMax - tMin) / STEPS;
      let prevT = tMin;
      let hitFound = false;
      let lo = tMin;
      let hi = tMax;

      for (let s = 0; s <= STEPS; s++) {
        const t = tMin + s * dt;
        const px = ray.origin.x + ray.direction.x * t;
        const py = ray.origin.y + ray.direction.y * t;
        const pz = ray.origin.z + ray.direction.z * t;

        if (px >= -0.5 && px <= GRID_SIZE - 0.5 && pz >= -0.5 && pz <= GRID_SIZE - 0.5) {
          const surfY = sampleSurfaceY(eng, px, pz, considerBridges);
          if (py <= surfY) {
            lo = prevT;
            hi = t;
            hitFound = true;
            break;
          }
        }
        prevT = t;
      }

      let hitX: number;
      let hitZ: number;
      if (hitFound) {
        for (let b = 0; b < 6; b++) {
          const mid = (lo + hi) * 0.5;
          const mx = ray.origin.x + ray.direction.x * mid;
          const my = ray.origin.y + ray.direction.y * mid;
          const mz = ray.origin.z + ray.direction.z * mid;
          if (my <= sampleSurfaceY(eng, mx, mz, considerBridges)) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        const finalT = (lo + hi) * 0.5;
        hitX = ray.origin.x + ray.direction.x * finalT;
        hitZ = ray.origin.z + ray.direction.z * finalT;
      } else {
        if (!ray.intersectPlane(fallbackPlane, slabHit)) return null;
        hitX = slabHit.x;
        hitZ = slabHit.z;
      }

      const gx = Math.round(hitX);
      const gz = Math.round(hitZ);
      if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return null;
      return { x: gx, z: gz, hitX, hitZ };
    };

    const activePointers = new Map<number, { x: number; y: number; type: string }>();
    let dragStartCell: { x: number; z: number } | null = null;
    let lastHoverHit: { x: number; z: number; hitX: number; hitZ: number } | null = null;
    let isRightOrbiting = false;
    let isPanning1Finger = false;
    let prevPinchDist = 0;
    let prevTwoAngle = 0;
    let prevTwoMidY = 0;
    let abortedByMultiTouch = false;

    const panCameraScreenDelta = (dxPx: number, dyPx: number) => {
      const scale = camState.distance * 0.0021;
      const sin = Math.sin(camState.yaw);
      const cos = Math.cos(camState.yaw);
      camState.targetX -= (dxPx * cos + dyPx * sin) * scale;
      camState.targetZ -= (-dxPx * sin + dyPx * cos) * scale;
      camState.targetX = Math.max(4, Math.min(GRID_SIZE - 4, camState.targetX));
      camState.targetZ = Math.max(4, Math.min(GRID_SIZE - 4, camState.targetZ));
    };

    const onPointerDown = (e: PointerEvent) => {
      renderer.domElement.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

      if (activePointers.size >= 2) {
        abortedByMultiTouch = true;
        dragStartCell = null;
        isPanning1Finger = false;
        setDragBanner(null);
        setTouchReticle(null);
        updatePreviewVisuals(null, null);

        const pts = Array.from(activePointers.values());
        prevPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        prevTwoAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        prevTwoMidY = (pts[0].y + pts[1].y) * 0.5;
        return;
      }

      abortedByMultiTouch = false;

      if (e.button === 2 || e.button === 1) {
        isRightOrbiting = e.button === 2 && !e.shiftKey;
        isPanning1Finger = e.button === 1 || (e.button === 2 && e.shiftKey);
        return;
      }

      const isTouch = e.pointerType === 'touch';
      const curTool = toolRef.current;

      if (curTool.kind === 'pan') {
        isPanning1Finger = true;
        return;
      }

      // Exact 1:1 terrain raycast at actual contact coordinates (0px touch offset)
      const hit = raycastTerrainPoint(e.clientX, e.clientY);
      if (!hit) {
        isPanning1Finger = true;
        return;
      }

      if (curTool.kind === 'inspect') {
        onSelectInspect(engineRef.current.inspectCell(hit.x, hit.z));
        isPanning1Finger = true;
        return;
      }

      if (curTool.kind === 'bus_line') {
        const res = engineRef.current.addBusStopTap(hit.x, hit.z);
        onToast(res.message, res.ok ? 'ok' : 'warn');
        onAfterMutate();
        return;
      }

      if (curTool.kind === 'building') {
        const centered = getCenteredFootprintOrigin(
          hit.hitX,
          hit.hitZ,
          curTool.buildingId,
          rotRef.current
        );
        if (isTouch) {
          const check = engineRef.current.canPlaceStructure(
            curTool.buildingId,
            centered.x,
            centered.z,
            rotRef.current
          );
          const nextPending: PendingMobilePlacement = {
            buildingId: curTool.buildingId,
            x: centered.x,
            z: centered.z,
            rotation: rotRef.current,
            cost: check.cost,
            valid: check.ok,
            reason: check.reason,
          };
          pendingRef.current = nextPending;
          setPendingPlacement(nextPending);
          setTouchReticle({ x: e.clientX, y: e.clientY });
          updatePreviewVisuals(null, hit);
        } else {
          const placed = engineRef.current.placeStructure(
            curTool.buildingId,
            centered.x,
            centered.z,
            rotRef.current
          );
          if (!placed.ok && placed.reason) onToast(placed.reason, 'warn');
          onAfterMutate();
        }
        return;
      }

      dragStartCell = { x: hit.x, z: hit.z };
      lastHoverHit = hit;
      if (isTouch) {
        setTouchReticle({ x: e.clientX, y: e.clientY });
      }
      updatePreviewVisuals(dragStartCell, hit);
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = activePointers.get(e.pointerId);
      if (prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

        if (activePointers.size >= 2) {
          const pts = Array.from(activePointers.values());
          const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
          const midY = (pts[0].y + pts[1].y) * 0.5;

          if (prevPinchDist > 10) {
            const zoomRatio = prevPinchDist / Math.max(10, dist);
            camState.distance = Math.max(12, Math.min(135, camState.distance * zoomRatio));
          }
          let dAngle = angle - prevTwoAngle;
          if (dAngle > Math.PI) dAngle -= Math.PI * 2;
          if (dAngle < -Math.PI) dAngle += Math.PI * 2;
          camState.yaw += dAngle * 0.95;

          const dMidY = midY - prevTwoMidY;
          camState.pitch = Math.max(0.28, Math.min(1.38, camState.pitch + dMidY * 0.004));

          prevPinchDist = dist;
          prevTwoAngle = angle;
          prevTwoMidY = midY;
          return;
        }

        if (isRightOrbiting) {
          camState.yaw -= dx * 0.0065;
          camState.pitch = Math.max(0.26, Math.min(1.4, camState.pitch + dy * 0.0055));
          return;
        }

        if (isPanning1Finger) {
          panCameraScreenDelta(dx, dy);
          return;
        }
      }

      if (abortedByMultiTouch) return;

      const isTouch = e.pointerType === 'touch';
      const curTool = toolRef.current;
      if (curTool.kind === 'pan' || curTool.kind === 'inspect') return;

      const hit = raycastTerrainPoint(e.clientX, e.clientY);
      if (!hit) return;

      lastHoverHit = hit;

      if (isTouch && (dragStartCell || curTool.kind === 'building') && activePointers.size === 1) {
        setTouchReticle({ x: e.clientX, y: e.clientY });
      }

      if (isTouch && curTool.kind === 'building' && activePointers.size === 1) {
        const centered = getCenteredFootprintOrigin(
          hit.hitX,
          hit.hitZ,
          curTool.buildingId,
          rotRef.current
        );
        const check = engineRef.current.canPlaceStructure(
          curTool.buildingId,
          centered.x,
          centered.z,
          rotRef.current
        );
        const nextPending: PendingMobilePlacement = {
          buildingId: curTool.buildingId,
          x: centered.x,
          z: centered.z,
          rotation: rotRef.current,
          cost: check.cost,
          valid: check.ok,
          reason: check.reason,
        };
        pendingRef.current = nextPending;
        setPendingPlacement(nextPending);
        updatePreviewVisuals(null, hit);
        return;
      }

      updatePreviewVisuals(dragStartCell, hit);

      if (dragStartCell && curTool.kind === 'road') {
        const pts = engineRef.current.computeSmartRoadPath(
          dragStartCell.x,
          dragStartCell.z,
          hit.x,
          hit.z
        );
        const est = engineRef.current.estimateRoadPathCost(pts, curTool.tier);
        setDragBanner({
          label: est.hasBridge
            ? `🌉 Puente (${pts.length} tramos)`
            : `${ROAD_CATALOG[curTool.tier].shortName} (${pts.length})`,
          cost: est.cost,
          valid: est.valid,
          screenX: e.clientX,
          screenY: isTouch ? e.clientY - 64 : e.clientY - 34,
        });
      } else if (dragStartCell && curTool.kind === 'zone') {
        const evalRes = engineRef.current.evaluateZoneRect(
          dragStartCell.x,
          dragStartCell.z,
          hit.x,
          hit.z,
          curTool.zone
        );
        const isClear = curTool.zone === ZoneKind.None;
        setDragBanner({
          label:
            evalRes.validCount === 0
              ? isClear
                ? 'Sin zonas para limpiar'
                : 'Sin acceso directo a calle 2L/4L'
              : `${ZONE_CATALOG[curTool.zone].shortName} (${evalRes.validCount} válidas)`,
          cost: evalRes.cost,
          valid: evalRes.validCount > 0,
          screenX: e.clientX,
          screenY: isTouch ? e.clientY - 64 : e.clientY - 34,
        });
      }
    };

    const onPointerUpOrCancel = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      isRightOrbiting = false;
      isPanning1Finger = false;
      setTouchReticle(null);
      setDragBanner(null);

      if (abortedByMultiTouch) {
        if (activePointers.size === 0) abortedByMultiTouch = false;
        dragStartCell = null;
        updatePreviewVisuals(null, null);
        return;
      }

      if (dragStartCell && lastHoverHit) {
        const curTool = toolRef.current;
        const eng = engineRef.current;
        if (curTool.kind === 'road') {
          const res = eng.buildRoadPath(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverHit.x,
            lastHoverHit.z,
            curTool.tier
          );
          if (!res.ok && res.reason) onToast(res.reason, 'warn');
          onAfterMutate();
        } else if (curTool.kind === 'zone') {
          const res = eng.paintZoneRect(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverHit.x,
            lastHoverHit.z,
            curTool.zone
          );
          if (!res.ok && res.reason) onToast(res.reason, 'warn');
          onAfterMutate();
        } else if (curTool.kind === 'bulldoze') {
          eng.bulldozeArea(dragStartCell.x, dragStartCell.z, lastHoverHit.x, lastHoverHit.z);
          onAfterMutate();
        } else if (curTool.kind === 'metro_tunnel') {
          const res = eng.buildMetroTunnel(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverHit.x,
            lastHoverHit.z
          );
          if (!res.ok && res.reason) onToast(res.reason, 'warn');
          onAfterMutate();
        }
      }

      dragStartCell = null;
      if (!pendingRef.current) {
        updatePreviewVisuals(null, null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camState.distance = Math.max(
        10,
        Math.min(138, camState.distance * (1 + Math.sign(e.deltaY) * 0.09))
      );
    };

    const pressedKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      pressedKeys.add(k);
      if (k === 'r') {
        onRotateBuilding();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.delete(e.key.toLowerCase());
    };

    const preventCtx = (e: MouseEvent) => e.preventDefault();

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUpOrCancel);
    dom.addEventListener('pointercancel', onPointerUpOrCancel);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', preventCtx);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      if (!host) return;
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // --- 8. 60 FPS Render & Dynamic Agents Loop ---
    let rafId = 0;
    let prevTime = performance.now();

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    const onContextRestored = () => {
      const eng = engineRef.current;
      rebuildTerrainVertices(eng);
      rebuildStaticCityMeshes(eng);
      refreshAnalyticalOverlay(eng, overlayRef.current);
    };
    dom.addEventListener('webglcontextlost', onContextLost);
    dom.addEventListener('webglcontextrestored', onContextRestored);

    const getRoadSurfaceY = (eng: CityEngine, rx: number, rz: number): number => {
      const cx = Math.max(0, Math.min(GRID_SIZE - 1, rx));
      const cz = Math.max(0, Math.min(GRID_SIZE - 1, rz));
      const ci = eng.idx(cx, cz);
      return isWaterTerrain(eng.terrain[ci]) ? 1.77 : surfaceHeightAt(eng, cx, cz) + 0.135;
    };

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      if (document.visibilityState === 'hidden') {
        prevTime = now;
        return;
      }
      const dt = Math.min(0.05, (now - prevTime) * 0.001);
      prevTime = now;

      const eng = engineRef.current;

      if (syncedCityId !== eng.cityId) {
        syncedCityId = eng.cityId;
        rebuildTerrainVertices(eng);
        lastMeshVer = -1;
        lastOverlayVer = -1;
        vehicles.length = 0;
      }

      if (lastUnlockedMask !== eng.unlockedTilesMask || lastShowTiles !== showTilesRef.current) {
        lastUnlockedMask = eng.unlockedTilesMask;
        lastShowTiles = showTilesRef.current;
        rebuildTerrainVertices(eng);
        rebuildTileBorders(eng);
      }

      if (lastMeshVer !== eng.meshVersion) {
        lastMeshVer = eng.meshVersion;
        rebuildStaticCityMeshes(eng);
        refreshAnalyticalOverlay(eng, overlayRef.current);
      } else if (
        lastOverlayVer !== eng.overlayVersion ||
        lastOverlayMode !== overlayRef.current
      ) {
        lastOverlayVer = eng.overlayVersion;
        refreshAnalyticalOverlay(eng, overlayRef.current);
        lastOverlayMode = overlayRef.current;
      }

      if (pendingRef.current) {
        updatePreviewVisuals(null, null);
      }

      // WASD / QE Desktop Smooth Camera Movement
      const keySpeed = camState.distance * 0.85 * dt;
      const sinY = Math.sin(camState.yaw);
      const cosY = Math.cos(camState.yaw);
      if (pressedKeys.has('w') || pressedKeys.has('arrowup')) {
        camState.targetX -= sinY * keySpeed;
        camState.targetZ -= cosY * keySpeed;
      }
      if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) {
        camState.targetX += sinY * keySpeed;
        camState.targetZ += cosY * keySpeed;
      }
      if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) {
        camState.targetX -= cosY * keySpeed;
        camState.targetZ += sinY * keySpeed;
      }
      if (pressedKeys.has('d') || pressedKeys.has('arrowright')) {
        camState.targetX += cosY * keySpeed;
        camState.targetZ -= sinY * keySpeed;
      }
      if (pressedKeys.has('q')) camState.yaw -= 1.5 * dt;
      if (pressedKeys.has('e')) camState.yaw += 1.5 * dt;

      camState.targetX = Math.max(4, Math.min(GRID_SIZE - 4, camState.targetX));
      camState.targetZ = Math.max(4, Math.min(GRID_SIZE - 4, camState.targetZ));

      const horiz = Math.cos(camState.pitch) * camState.distance;
      const vert = Math.sin(camState.pitch) * camState.distance;
      camera.position.set(
        camState.targetX + Math.sin(camState.yaw) * horiz,
        1.2 + vert,
        camState.targetZ + Math.cos(camState.yaw) * horiz
      );
      camera.lookAt(camState.targetX, 0.8, camState.targetZ);

      // Animate water ripples & coastal shoreline foam
      assets.waterNormalTex.offset.x = (now * 0.000018) % 1;
      assets.waterNormalTex.offset.y = (now * 0.000012) % 1;
      if (shoreFoamMesh.visible) {
        shoreFoamMat.opacity = 0.56 + Math.sin(now * 0.0022) * 0.16;
      }

      // Day / Sunset / Night Lighting, Sky Dome, Shadows & Streetlights
      const hr = eng.timeOfDay;
      const sunAngle = ((hr - 6) / 24) * Math.PI * 2;
      const sunElev = Math.sin(sunAngle);
      const nightFactor = THREE.MathUtils.clamp(-sunElev * 1.6 + 0.25, 0, 1);

      const isAnalyticalWhite = overlayRef.current !== 'normal' && overlayRef.current !== 'metro';

      if (isAnalyticalWhite) {
        skyDomeMesh.visible = false;
        scene.background = _color.setHex(0xe2e8f0);
        (scene.fog as THREE.FogExp2).color.setHex(0xe2e8f0);
        sunLight.castShadow = false;
        sunLight.intensity = 1.25;
        hemiLight.intensity = 1.1;
        fillLight.intensity = 0.2;
        rciResMat.emissiveIntensity = 0;
        rciComMat.emissiveIntensity = 0;
        rciIndMat.emissiveIntensity = 0;
        streetLightBulbMesh.visible = false;
      } else {
        skyDomeMesh.visible = true;
        const sunsetAmt = Math.abs(sunElev) < 0.28 ? 1 - Math.abs(sunElev) / 0.28 : 0;

        zenithCol.set(eng.weather === 'rain' ? '#475569' : '#0284c7');
        zenithCol.lerp(new THREE.Color('#7c2d12'), sunsetAmt * 0.45);
        zenithCol.lerp(new THREE.Color('#020617'), nightFactor);

        horizonCol.set(eng.weather === 'rain' ? '#64748b' : '#bae6fd');
        horizonCol.lerp(new THREE.Color('#fb923c'), sunsetAmt * 0.85);
        horizonCol.lerp(new THREE.Color('#0f172a'), nightFactor);

        midSkyCol.copy(horizonCol).lerp(zenithCol, 0.35);
        scene.background = midSkyCol;
        (scene.fog as THREE.FogExp2).color.copy(midSkyCol);

        const skyKey = `${Math.round(hr * 8)}_${eng.weather}`;
        if (skyKey !== lastSkyKey) {
          lastSkyKey = skyKey;
          updateSkyDome(zenithCol, horizonCol);
        }

        // Quantize shadow camera target to shadow texel grid to prevent shadow swimming
        const texelSnap = (SHADOW_HALF_EXTENT * 2) / shadowRes;
        const qx = Math.round(camState.targetX / texelSnap) * texelSnap;
        const qz = Math.round(camState.targetZ / texelSnap) * texelSnap;
        sunLight.castShadow = overlayRef.current === 'normal';
        sunLight.target.position.set(qx, 0, qz);
        sunLight.target.updateMatrixWorld();
        sunLight.position.set(
          qx + Math.cos(sunAngle) * 72,
          Math.max(18, Math.abs(sunElev) * 86),
          qz + 32
        );

        sunLight.color.set('#fff7ed').lerp(new THREE.Color('#fdba74'), sunsetAmt * 0.65);
        sunLight.color.lerp(new THREE.Color('#93c5fd'), nightFactor * 0.75);
        sunLight.intensity = THREE.MathUtils.lerp(1.75, 0.32, nightFactor);
        hemiLight.intensity = THREE.MathUtils.lerp(0.84, 0.36, nightFactor);
        fillLight.intensity = THREE.MathUtils.lerp(0.36, 0.22, nightFactor);

        rciResMat.emissiveIntensity = nightFactor * 1.35;
        rciComMat.emissiveIntensity = nightFactor * 1.45;
        rciIndMat.emissiveIntensity = nightFactor * 1.2;
        streetLightBulbMesh.visible = overlayRef.current === 'normal' && nightFactor > 0.25;
      }

      // Spin Wind Turbine Blades
      let bladeSlot = 0;
      for (const wt of windTurbineCoords) {
        for (let b = 0; b < 3; b++) {
          if (bladeSlot >= 595) break;
          const ang = now * 0.0032 + (b * Math.PI * 2) / 3;
          _dummy.position.set(wt.x, wt.y, wt.z + 0.14);
          _dummy.rotation.set(0, 0, ang);
          _dummy.scale.set(0.08, 0.95, 0.04);
          _dummy.updateMatrix();
          turbineBladeMesh.setMatrixAt(bladeSlot++, _dummy.matrix);
        }
      }
      turbineBladeMesh.count = bladeSlot;
      if (bladeSlot > 0) turbineBladeMesh.instanceMatrix.needsUpdate = true;

      // Commercial Airplane Take-off & Landing Loop
      if (airportCoords) {
        airplaneGroup.visible = true;
        const cycle = (now * 0.00018) % 1;
        const rx = airportCoords.x - 16 + cycle * 32;
        const climb =
          cycle < 0.32 ? (0.32 - cycle) * 14 : cycle > 0.68 ? (cycle - 0.68) * 16 : 0;
        airplaneGroup.position.set(rx, airportCoords.y + climb, airportCoords.z);
        airplaneGroup.rotation.set(0, 0, cycle < 0.32 ? -0.14 : cycle > 0.68 ? 0.18 : 0);
      } else {
        airplaneGroup.visible = false;
      }

      // Live Road Traffic Vehicles with Smooth Slope Interpolation, Taillights & Sirens
      const desiredCars = Math.min(
        isMobileTouch ? 140 : 280,
        Math.max(8, Math.floor(roadCellsList.length * 0.22 + eng.population * 0.015))
      );

      while (vehicles.length < desiredCars && roadCellsList.length > 0) {
        const pickCell = roadCellsList[Math.floor(Math.random() * roadCellsList.length)];
        const vx = pickCell % GRID_SIZE;
        const vz = Math.floor(pickCell / GRID_SIZE);
        const roll = Math.random();
        const kind: VehicleAgent['kind'] =
          roll < 0.06
            ? 'police'
            : roll < 0.11
            ? 'fire'
            : roll < 0.26
            ? 'truck'
            : 'car';
        const palette = [0xf8fafc, 0xef4444, 0x3b82f6, 0xeab308, 0x10b981, 0x94a3b8];
        vehicles.push({
          x: vx,
          z: vz,
          nx: vx,
          nz: vz,
          dirIdx: Math.floor(Math.random() * 8),
          progress: Math.random(),
          speed: 1.6 + Math.random() * 1.1,
          kind,
          colorHex:
            kind === 'police'
              ? 0x2563eb
              : kind === 'fire'
              ? 0xdc2626
              : palette[Math.floor(Math.random() * palette.length)],
        });
      }

      const speedMult =
        eng.simSpeed === 0 ? 0 : eng.simSpeed === 1 ? 1 : eng.simSpeed === 2 ? 1.6 : 2.3;
      let vehSlot = 0;
      let lightSlot = 0;
      let tailSlot = 0;
      let sirenSlot = 0;

      for (let idx = 0; idx < vehicles.length && vehSlot < 370; idx++) {
        const v = vehicles[idx];
        const cellIdx = eng.idx(v.x, v.z);
        const mask = eng.roadMask[cellIdx];
        if (mask === 0) {
          if (roadCellsList.length > 0) {
            const pick = roadCellsList[idx % roadCellsList.length];
            v.x = pick % GRID_SIZE;
            v.z = Math.floor(pick / GRID_SIZE);
            v.nx = v.x;
            v.nz = v.z;
          }
          continue;
        }

        let dir = DIR_OFFSETS[v.dirIdx];
        if ((mask & dir.bit) === 0) {
          for (let k = 0; k < 8; k++) {
            const cand = (v.dirIdx + k) % 8;
            if ((mask & DIR_OFFSETS[cand].bit) !== 0) {
              v.dirIdx = cand;
              dir = DIR_OFFSETS[cand];
              break;
            }
          }
        }

        v.nx = Math.max(0, Math.min(GRID_SIZE - 1, v.x + dir.dx));
        v.nz = Math.max(0, Math.min(GRID_SIZE - 1, v.z + dir.dz));
        v.progress += dt * v.speed * speedMult;

        if (v.progress >= 1) {
          v.progress -= 1;
          if (eng.inBounds(v.nx, v.nz) && eng.roadTier[eng.idx(v.nx, v.nz)] !== RoadTier.None) {
            v.x = v.nx;
            v.z = v.nz;
            const nMask = eng.roadMask[eng.idx(v.x, v.z)];
            const candidates: number[] = [];
            for (let k = 0; k < 8; k++) {
              if ((nMask & DIR_OFFSETS[k].bit) !== 0 && DIR_OFFSETS[k].bit !== dir.opp) {
                candidates.push(k);
              }
            }
            if (candidates.length > 0) {
              v.dirIdx = candidates[Math.floor(Math.random() * candidates.length)];
            } else {
              v.dirIdx = DIR_OFFSETS.findIndex((d) => d.bit === dir.opp);
            }
            const nextDir = DIR_OFFSETS[Math.max(0, v.dirIdx)];
            v.nx = Math.max(0, Math.min(GRID_SIZE - 1, v.x + nextDir.dx));
            v.nz = Math.max(0, Math.min(GRID_SIZE - 1, v.z + nextDir.dz));
          }
        }

        const curDir = DIR_OFFSETS[Math.max(0, v.dirIdx)];
        const angle = Math.atan2(curDir.dx, curDir.dz);
        const perpX = Math.cos(angle) * 0.14;
        const perpZ = -Math.sin(angle) * 0.14;
        const wx = v.x + curDir.dx * v.progress + perpX;
        const wz = v.z + curDir.dz * v.progress + perpZ;

        const y0 = getRoadSurfaceY(eng, v.x, v.z);
        const y1 =
          eng.inBounds(v.nx, v.nz) && eng.roadTier[eng.idx(v.nx, v.nz)] !== RoadTier.None
            ? getRoadSurfaceY(eng, v.nx, v.nz)
            : y0;
        const wy = y0 + (y1 - y0) * v.progress;
        const stepDist = curDir.diag ? Math.SQRT2 : 1.0;
        const pitchTilt = -Math.atan2(y1 - y0, stepDist);

        const isHeavy = v.kind === 'truck' || v.kind === 'fire';
        _dummy.position.set(wx, wy, wz);
        _dummy.rotation.set(pitchTilt, angle, 0);
        _dummy.scale.set(isHeavy ? 1.1 : 1.0, isHeavy ? 1.38 : 1.0, isHeavy ? 1.25 : 1.0);
        _dummy.updateMatrix();
        vehicleMesh.setMatrixAt(vehSlot, _dummy.matrix);
        _color.setHex(v.colorHex);
        vehicleMesh.setColorAt(vehSlot, _color);
        vehSlot++;

        // Emergency rooftop alternating red/blue beacon
        if ((v.kind === 'police' || v.kind === 'fire') && sirenSlot < 118) {
          _dummy2.position.set(wx, wy + (isHeavy ? 0.22 : 0.165), wz);
          _dummy2.rotation.set(0, angle, 0);
          _dummy2.scale.set(0.08, 0.04, 0.08);
          _dummy2.updateMatrix();
          sirenBeaconMesh.setMatrixAt(sirenSlot, _dummy2.matrix);
          const flashBlue = Math.floor(now * 0.012 + idx) % 2 === 0;
          _color.setHex(v.kind === 'fire' || !flashBlue ? 0xef4444 : 0x38bdf8);
          sirenBeaconMesh.setColorAt(sirenSlot, _color);
          sirenSlot++;
        }

        if (nightFactor > 0.35 && lightSlot < 410 && tailSlot < 410) {
          const fSin = Math.sin(angle);
          const fCos = Math.cos(angle);
          _dummy2.position.set(wx + fSin * 0.22, wy + 0.05, wz + fCos * 0.22);
          _dummy2.rotation.set(0, angle, 0);
          _dummy2.scale.set(0.13, 0.035, 0.16);
          _dummy2.updateMatrix();
          headlightMesh.setMatrixAt(lightSlot++, _dummy2.matrix);

          _dummy2.position.set(wx - fSin * 0.17, wy + 0.05, wz - fCos * 0.17);
          _dummy2.rotation.set(0, angle, 0);
          _dummy2.scale.set(0.12, 0.03, 0.04);
          _dummy2.updateMatrix();
          taillightMesh.setMatrixAt(tailSlot++, _dummy2.matrix);
        }
      }

      // Articulated City Buses
      for (let li = 0; li < eng.busLines.length; li++) {
        const line = eng.busLines[li];
        if (line.stops.length < 2) continue;
        for (let b = 0; b < 2 && vehSlot < 418; b++) {
          const t =
            ((now * 0.00028 * Math.max(0.2, speedMult) + b * 0.5 + li * 0.23) % 1) *
            line.stops.length;
          const idxA = Math.floor(t) % line.stops.length;
          const idxB = (idxA + 1) % line.stops.length;
          const frac = t - Math.floor(t);
          const a = line.stops[idxA];
          const c = line.stops[idxB];
          const bx = a.x + (c.x - a.x) * frac;
          const bz = a.z + (c.z - a.z) * frac;
          const ang = Math.atan2(c.x - a.x, c.z - a.z);
          const cellI = eng.idx(Math.round(bx), Math.round(bz));
          const by = isWaterTerrain(eng.terrain[cellI])
            ? 1.79
            : surfaceHeightAt(eng, Math.round(bx), Math.round(bz)) + 0.14;

          _dummy.position.set(bx, by, bz);
          _dummy.rotation.set(0, ang, 0);
          _dummy.scale.set(1.35, 1.55, 1.85);
          _dummy.updateMatrix();
          vehicleMesh.setMatrixAt(vehSlot, _dummy.matrix);
          _color.set(line.color);
          vehicleMesh.setColorAt(vehSlot, _color);
          vehSlot++;
        }
      }

      vehicleMesh.count = vehSlot;
      vehicleMesh.instanceMatrix.needsUpdate = true;
      if (vehicleMesh.instanceColor) vehicleMesh.instanceColor.needsUpdate = true;

      headlightMesh.count = lightSlot;
      if (lightSlot > 0) headlightMesh.instanceMatrix.needsUpdate = true;

      taillightMesh.count = tailSlot;
      if (tailSlot > 0) taillightMesh.instanceMatrix.needsUpdate = true;

      sirenBeaconMesh.count = sirenSlot;
      if (sirenSlot > 0) {
        sirenBeaconMesh.instanceMatrix.needsUpdate = true;
        if (sirenBeaconMesh.instanceColor) sirenBeaconMesh.instanceColor.needsUpdate = true;
      }

      // Underground Metro Trains (Y = -2.05)
      let trainSlot = 0;
      for (let mi = 0; mi < eng.metroSegments.length && trainSlot < 115; mi++) {
        const seg = eng.metroSegments[mi];
        const pingPong = Math.abs(((now * 0.00045 * Math.max(0.25, speedMult) + mi * 0.37) % 2) - 1);
        const tx = seg.fromX + (seg.toX - seg.fromX) * pingPong;
        const tz = seg.fromZ + (seg.toZ - seg.fromZ) * pingPong;
        const ang = Math.atan2(seg.toX - seg.fromX, seg.toZ - seg.fromZ);
        _dummy.position.set(tx, -2.05, tz);
        _dummy.rotation.set(0, ang, 0);
        _dummy.scale.set(0.36, 0.34, 1.35);
        _dummy.updateMatrix();
        metroTrainMesh.setMatrixAt(trainSlot++, _dummy.matrix);
      }
      metroTrainMesh.count = trainSlot;
      if (trainSlot > 0) metroTrainMesh.instanceMatrix.needsUpdate = true;

      // FX Particles (Fires, Disasters, Wind Streaks, Rain)
      let fxSlot = 0;
      for (let i = 0; i < TOTAL_CELLS && fxSlot < 500; i += 1) {
        if (eng.cellFire[i] === 0) continue;
        const fx = i % GRID_SIZE;
        const fz = Math.floor(i / GRID_SIZE);
        const fy = surfaceHeightAt(eng, fx, fz);
        const flicker = ((now * 0.008 + i) % 1) * 1.6;
        _dummy.position.set(fx, fy + 0.5 + flicker, fz);
        _dummy.rotation.set(0, now * 0.004, 0);
        _dummy.scale.set(0.45, 0.65, 0.45);
        _dummy.updateMatrix();
        fxParticleMesh.setMatrixAt(fxSlot, _dummy.matrix);
        _color.setHex(flicker > 0.9 ? 0x475569 : 0xf97316);
        fxParticleMesh.setColorAt(fxSlot, _color);
        fxSlot++;
      }

      for (const d of eng.activeDisasters) {
        if (d.kind === 'tornado') {
          for (let ring = 0; ring < 18 && fxSlot < 620; ring++) {
            const h = ring * 0.65;
            const r = 0.25 + ring * 0.16;
            const a = now * 0.012 + ring * 0.8;
            _dummy.position.set(d.x + Math.cos(a) * r, 0.5 + h, d.z + Math.sin(a) * r);
            _dummy.rotation.set(a, a, 0);
            _dummy.scale.set(0.55, 0.38, 0.55);
            _dummy.updateMatrix();
            fxParticleMesh.setMatrixAt(fxSlot, _dummy.matrix);
            _color.setHex(0x94a3b8);
            fxParticleMesh.setColorAt(fxSlot, _color);
            fxSlot++;
          }
        } else if (d.kind === 'meteor_strike' && d.ticksLeft > d.maxTicks - 6 && fxSlot < 620) {
          const drop = (d.ticksLeft - (d.maxTicks - 6)) / 6;
          _dummy.position.set(d.x - drop * 12, 1.2 + drop * 26, d.z - drop * 8);
          _dummy.scale.set(1.6, 1.6, 1.6);
          _dummy.updateMatrix();
          fxParticleMesh.setMatrixAt(fxSlot, _dummy.matrix);
          _color.setHex(0xfacc15);
          fxParticleMesh.setColorAt(fxSlot, _color);
          fxSlot++;
        }
      }

      if (overlayRef.current === 'pollution') {
        const wx = Math.cos(eng.windAngleRad);
        const wz = Math.sin(eng.windAngleRad);
        const wAng = Math.atan2(wx, wz);
        for (let g = 0; g < 36 && fxSlot < 640; g++) {
          const bx = 18 + (g % 6) * 14;
          const bz = 18 + Math.floor(g / 6) * 14;
          const travel = ((now * 0.008 + g * 3) % 12) - 6;
          _dummy.position.set(bx + wx * travel, 3.5, bz + wz * travel);
          _dummy.rotation.set(0, wAng, 0);
          _dummy.scale.set(0.18, 0.08, 1.4);
          _dummy.updateMatrix();
          fxParticleMesh.setMatrixAt(fxSlot, _dummy.matrix);
          _color.setHex(0x6366f1);
          fxParticleMesh.setColorAt(fxSlot, _color);
          fxSlot++;
        }
      } else if (eng.weather === 'rain') {
        for (let r = 0; r < 90 && fxSlot < 645; r++) {
          const rx = camState.targetX + (((r * 19) % 44) - 22);
          const rz = camState.targetZ + (((r * 31) % 44) - 22);
          const ry = 18 - ((now * 0.032 + r * 2.3) % 18);
          _dummy.position.set(rx, ry, rz);
          _dummy.rotation.set(0, 0, 0.08);
          _dummy.scale.set(0.035, 0.85, 0.035);
          _dummy.updateMatrix();
          fxParticleMesh.setMatrixAt(fxSlot, _dummy.matrix);
          _color.setHex(0xbae6fd);
          fxParticleMesh.setColorAt(fxSlot, _color);
          fxSlot++;
        }
      }

      fxParticleMesh.count = fxSlot;
      if (fxSlot > 0) {
        fxParticleMesh.instanceMatrix.needsUpdate = true;
        if (fxParticleMesh.instanceColor) fxParticleMesh.instanceColor.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUpOrCancel);
      dom.removeEventListener('pointercancel', onPointerUpOrCancel);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', preventCtx);
      dom.removeEventListener('webglcontextlost', onContextLost);
      dom.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);

      // Dispose GPU geometries & scene-owned materials/textures cleanly
      skyGeo.dispose();
      skyMat.dispose();
      terrainGeo.dispose();
      terrainNormalMat.dispose();
      terrainInfoMat.dispose();
      overlayDataTex.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      shoreFoamGeo.dispose();
      shoreFoamMat.dispose();
      shoreFoamTex.dispose();
      rciResMat.dispose();
      rciComMat.dispose();
      rciIndMat.dispose();
      solidRealisticMat.dispose();
      whiteInfoMat.dispose();
      streetBulbMat.dispose();
      boxGeo.dispose();
      cylGeo.dispose();
      coneGeo.dispose();
      broadGeo.dispose();
      vehicleMergedGeo.dispose();

      renderer.dispose();
      if (dom.parentElement === host) {
        host.removeChild(dom);
      }
    };
  }, []);

  return (
    <div ref={hostRef} className="city-canvas-host relative w-full h-full overflow-hidden">
      {/* Exact 1:1 Contact Reticle directly on finger touch point */}
      {touchReticle && (
        <div
          className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-1/2"
          style={{ left: touchReticle.x, top: touchReticle.y }}
        >
          <div className="w-7 h-7 rounded-full border-2 border-sky-400 bg-sky-400/20 shadow-[0_0_12px_rgba(56,189,248,0.85)] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
      )}

      {/* Live Cost & Span Floating Tag while dragging Roads / Zones */}
      {dragBanner && (
        <div
          className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-full px-2.5 py-1 rounded-lg text-xs font-bold shadow-lg border backdrop-blur-md"
          style={{
            left: Math.max(70, Math.min(window.innerWidth - 70, dragBanner.screenX)),
            top: Math.max(54, dragBanner.screenY),
            background: dragBanner.valid ? 'rgba(15, 23, 42, 0.9)' : 'rgba(127, 29, 29, 0.92)',
            borderColor: dragBanner.valid ? 'rgba(56, 189, 248, 0.6)' : 'rgba(248, 113, 113, 0.7)',
          }}
        >
          <span>{dragBanner.label}</span>
          {dragBanner.cost > 0 && (
            <span className="ml-2 text-emerald-300">${dragBanner.cost.toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  );
};
