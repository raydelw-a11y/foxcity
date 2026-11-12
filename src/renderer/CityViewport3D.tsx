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
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const WORLD_CENTER = GRID_SIZE * 0.5;
const WORLD_SPHERE = new THREE.Sphere(new THREE.Vector3(WORLD_CENTER, 0, WORLD_CENTER), 140);

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
  dirIdx: number;
  progress: number;
  speed: number;
  kind: 'car' | 'truck' | 'police' | 'fire';
  colorHex: number;
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

  // Latest props refs for event listeners & RAF loop without tearing down WebGL scene
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

    // --- 1. WebGLRenderer & Scene Setup ---
    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobileTouch,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileTouch ? 1.75 : 2.0));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#8ecae6');
    scene.fog = new THREE.FogExp2('#9ad1ea', 0.0042);

    const assets = getCityProceduralAssets(renderer);
    scene.environment = assets.envMap;

    const camera = new THREE.PerspectiveCamera(
      44,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.8,
      360
    );

    // Smooth Orbital Camera State
    const camState = {
      targetX: 52,
      targetZ: 48,
      yaw: 0.62,
      pitch: 0.78, // radians above horizon
      distance: isMobileTouch ? 56 : 48,
      velX: 0,
      velZ: 0,
    };

    // Lights
    const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#334155', 0.85);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#fff7ed', 1.65);
    sunLight.position.set(85, 95, 35);
    scene.add(sunLight);

    // --- 2. Terrain Heightfield + Analytical DataTexture ---
    const terrainGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE - 1, GRID_SIZE - 1);
    terrainGeo.rotateX(-Math.PI / 2);
    terrainGeo.translate(GRID_SIZE * 0.5 - 0.5, 0, GRID_SIZE * 0.5 - 0.5);

    const vCount = terrainGeo.attributes.position.count;
    const baseColors = new Float32Array(vCount * 3);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(baseColors, 3));

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
      roughness: 0.88,
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
    scene.add(terrainMesh);

    // Reflective Water Surface Plane (Y = 0)
    const waterGeo = new THREE.PlaneGeometry(GRID_SIZE + 80, GRID_SIZE + 80);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate(WORLD_CENTER, -0.04, WORLD_CENTER);
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      roughness: 0.14,
      metalness: 0.55,
      transparent: true,
      opacity: 0.86,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    scene.add(waterMesh);

    // --- 3. Shared Materials (Realistic PBR vs Skylines White Analytical) ---
    const bldgRealisticMat = new THREE.MeshStandardMaterial({
      map: assets.facadeAlbedo,
      emissiveMap: assets.facadeEmissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.0,
      roughness: 0.36,
      metalness: 0.28,
      transparent: true,
      opacity: 1,
    });

    const solidRealisticMat = new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.18,
      transparent: true,
      opacity: 1,
    });

    const whiteInfoMat = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 1,
    });

    // Helper to create world-spanning InstancedMesh safely
    const makeInstanced = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      maxCount: number
    ): THREE.InstancedMesh => {
      geo.boundingSphere = WORLD_SPHERE;
      const im = new THREE.InstancedMesh(geo, mat, maxCount);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Initialize instanceColor buffer upfront
      im.setColorAt(0, new THREE.Color('#ffffff'));
      return im;
    };

    // Static Instanced Pools
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0); // Pivot at ground base!

    const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    cylGeo.translate(0, 0.5, 0);

    const coneGeo = new THREE.ConeGeometry(0.55, 1, 8);
    coneGeo.translate(0, 0.5, 0);

    const roadDeckMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 28000);
    const roadStripeMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 24000);
    const bridgePierMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 4000);
    const zonePadMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, TOTAL_CELLS);
    const rciTowerMesh = makeInstanced(boxGeo.clone(), bldgRealisticMat, TOTAL_CELLS * 2);
    const rciRoofMesh = makeInstanced(coneGeo.clone(), solidRealisticMat, 6000);
    const treeFoliageMesh = makeInstanced(coneGeo.clone(), solidRealisticMat, 8000);
    const civicBoxMesh = makeInstanced(boxGeo.clone(), solidRealisticMat, 4000);
    const civicCylMesh = makeInstanced(cylGeo.clone(), solidRealisticMat, 2000);

    scene.add(
      roadDeckMesh,
      roadStripeMesh,
      bridgePierMesh,
      zonePadMesh,
      rciTowerMesh,
      rciRoofMesh,
      treeFoliageMesh,
      civicBoxMesh,
      civicCylMesh
    );

    // Underground & Transit Layer Group
    const metroGroup = new THREE.Group();
    scene.add(metroGroup);

    const busLinesGroup = new THREE.Group();
    scene.add(busLinesGroup);

    // Macro-Tile Borders Group (9 purchasable tiles)
    const tileBordersGroup = new THREE.Group();
    scene.add(tileBordersGroup);

    // Dynamic Instanced Pools (60 FPS animated)
    const vehicleMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      420
    );
    const headlightMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#fef08a' }),
      420
    );
    const turbineBladeMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3 }),
      600
    );
    const metroTrainMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#22d3ee' }),
      120
    );
    const fxParticleMesh = makeInstanced(
      boxGeo.clone(),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      650
    );

    scene.add(vehicleMesh, headlightMesh, turbineBladeMesh, metroTrainMesh, fxParticleMesh);

    // Animated Airplane Group (visible once International Airport monument is built)
    const airplaneGroup = new THREE.Group();
    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.14, 1.9, 10),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.25 })
    );
    fuselage.rotation.z = Math.PI / 2;
    const wings = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.05, 1.95),
      new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.3 })
    );
    const tailFin = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.06),
      new THREE.MeshStandardMaterial({ color: '#0284c7' })
    );
    tailFin.position.set(-0.78, 0.22, 0);
    airplaneGroup.add(fuselage, wings, tailFin);
    airplaneGroup.visible = false;
    scene.add(airplaneGroup);

    // Interactive Preview & Coverage Ring Group
    const previewGroup = new THREE.Group();
    scene.add(previewGroup);

    const coverageRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      })
    );
    coverageRing.rotation.x = -Math.PI / 2;
    coverageRing.visible = false;
    scene.add(coverageRing);

    // Wind turbines locations cache + Airport position cache for fast RAF animation
    let windTurbineCoords: { x: number; y: number; z: number }[] = [];
    let airportCoords: { x: number; y: number; z: number } | null = null;
    let roadCellsList: number[] = [];

    // Store realistic vs analytical colors per static instance so toggling Info Views takes 0.05ms
    let rciRealColors: Uint32Array = new Uint32Array(TOTAL_CELLS * 2);
    let rciCellIndices: Int32Array = new Int32Array(TOTAL_CELLS * 2);
    let roadDeckCellIndices: Int32Array = new Int32Array(28000);
    let roadDeckRealColors: Uint32Array = new Uint32Array(28000);
    let civicStructIds: Int32Array = new Int32Array(4000);
    let civicRealColors: Uint32Array = new Uint32Array(4000);

    const vehicles: VehicleAgent[] = [];

    // --- 4. Rebuild Terrain Geometry & Static City Meshes ---
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

          const tk = eng.terrain[i] as TerrainKind;
          const unlocked = eng.isTileUnlockedAt(x, z);
          if (tk === TerrainKind.DeepWater) {
            _color.setHex(0x075985);
          } else if (tk === TerrainKind.ShallowWater) {
            _color.setHex(0x0ea5e9);
          } else if (tk === TerrainKind.Beach) {
            _color.setHex(0xe7d3a8);
          } else if (tk === TerrainKind.Fertile) {
            _color.setHex(0x3f8f4e);
          } else if (tk === TerrainKind.Hill) {
            _color.setHex(0x527955);
          } else if (tk === TerrainKind.Mountain) {
            _color.setHex(h > 8.6 ? 0xe2e8f0 : 0x64748b);
          } else {
            _color.setHex(0x4d9457);
          }

          if (!unlocked) {
            _color.lerp(new THREE.Color('#1e293b'), 0.36);
          }
          colAttr.setXYZ(i, _color.r, _color.g, _color.b);
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      terrainGeo.computeVertexNormals();
    };

    const rebuildTileBorders = (eng: CityEngine) => {
      while (tileBordersGroup.children.length > 0) {
        const ch = tileBordersGroup.children.pop()!;
        tileBordersGroup.remove(ch);
      }

      for (let tz = 0; tz < 3; tz++) {
        for (let tx = 0; tx < 3; tx++) {
          const tIdx = tz * 3 + tx;
          const unlocked = (eng.unlockedTilesMask & (1 << tIdx)) !== 0;
          const x0 = tx * MACRO_TILE_SIZE - 0.5;
          const z0 = tz * MACRO_TILE_SIZE - 0.5;
          const s = MACRO_TILE_SIZE;
          const y = 1.8;

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
            opacity: showTilesRef.current ? 0.92 : unlocked ? 0.25 : 0.42,
          });
          tileBordersGroup.add(new THREE.Line(lineGeo, lineMat));
        }
      }
    };

    const rebuildStaticCityMeshes = (eng: CityEngine) => {
      let deckSlot = 0;
      let stripeSlot = 0;
      let pierSlot = 0;
      let zoneSlot = 0;
      let rciSlot = 0;
      let roofSlot = 0;
      let treeSlot = 0;
      let civicBoxSlot = 0;
      let civicCylSlot = 0;

      windTurbineCoords = [];
      airportCoords = null;
      roadCellsList = [];

      // 1. Roads, Intersections, Diagonals & Automatic Bridges over Water
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
            const asphaltHex =
              tier === RoadTier.Highway6L
                ? 0x1e293b
                : tier === RoadTier.Avenue4L
                ? 0x273449
                : 0x334155;

            // Central road hub pad
            _dummy.position.set(x, baseY, z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(width, isBridge ? 0.22 : 0.09, width);
            _dummy.updateMatrix();
            roadDeckMesh.setMatrixAt(deckSlot, _dummy.matrix);
            _color.setHex(isBridge ? 0x475569 : asphaltHex);
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

              _dummy.position.set(mx, armY, mz);
              _dummy.rotation.set(0, angle, 0);
              _dummy.scale.set(width, isBridge ? 0.2 : 0.09, armLen);
              _dummy.updateMatrix();
              roadDeckMesh.setMatrixAt(deckSlot, _dummy.matrix);
              _color.setHex(isBridge ? 0x475569 : asphaltHex);
              roadDeckMesh.setColorAt(deckSlot, _color);
              roadDeckCellIndices[deckSlot] = i;
              roadDeckRealColors[deckSlot] = _color.getHex();
              deckSlot++;

              // Center lane divider / landscaped median
              if (stripeSlot < 23900) {
                _dummy.position.set(mx, armY + (isBridge ? 0.21 : 0.095), mz);
                _dummy.rotation.set(0, angle, 0);
                _dummy.scale.set(
                  tier === RoadTier.Avenue4L ? 0.1 : 0.045,
                  0.025,
                  armLen * 0.72
                );
                _dummy.updateMatrix();
                roadStripeMesh.setMatrixAt(stripeSlot, _dummy.matrix);
                _color.setHex(
                  tier === RoadTier.Avenue4L
                    ? 0x22c55e
                    : tier === RoadTier.Highway6L
                    ? 0xfacc15
                    : 0xe2e8f0
                );
                roadStripeMesh.setColorAt(stripeSlot, _color);
                stripeSlot++;
              }
            }

            // Intersection crosswalk + traffic signal post on 3+ way junctions
            if (degCount >= 3 && stripeSlot < 23900) {
              _dummy.position.set(x, baseY + 0.1, z);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(width * 0.85, 0.02, width * 0.85);
              _dummy.updateMatrix();
              roadStripeMesh.setMatrixAt(stripeSlot, _dummy.matrix);
              _color.setHex(0x64748b);
              roadStripeMesh.setColorAt(stripeSlot, _color);
              stripeSlot++;
            }

            // Automatic concrete bridge piers & suspension pylons over water
            if (isBridge && pierSlot < 3950 && (x + z) % 2 === 0) {
              const bedY = Math.min(-0.6, eng.elevation[i]);
              const pierH = 1.55 - bedY;
              _dummy.position.set(x, bedY, z);
              _dummy.rotation.set(0, 0, 0);
              _dummy.scale.set(0.24, pierH, 0.24);
              _dummy.updateMatrix();
              bridgePierMesh.setMatrixAt(pierSlot, _dummy.matrix);
              _color.setHex(0x94a3b8);
              bridgePierMesh.setColorAt(pierSlot, _color);
              pierSlot++;

              if (tier >= RoadTier.Avenue4L && (x + z) % 6 === 0 && pierSlot < 3950) {
                _dummy.position.set(x, 1.55, z);
                _dummy.scale.set(0.16, 2.2, 0.85);
                _dummy.updateMatrix();
                bridgePierMesh.setMatrixAt(pierSlot, _dummy.matrix);
                _color.setHex(0xe2e8f0);
                bridgePierMesh.setColorAt(pierSlot, _color);
                pierSlot++;
              }
            }
          }

          // 2. Zoned Parcels & Organic RCI Buildings (Levels 1..5)
          const zKind = eng.zones[i] as ZoneKind;
          if (zKind !== ZoneKind.None) {
            const groundY = surfaceHeightAt(eng, x, z);
            const lv = eng.rciLevel[i];
            const diagMode = eng.rciDiag[i];
            const rotY =
              diagMode === 1
                ? Math.PI / 4
                : diagMode === 2
                ? -Math.PI / 4
                : ((eng.rciVariant[i] & 3) * Math.PI) / 2;
            const lotScale = diagMode !== 0 ? 0.66 : 0.84;

            // Subtle zone lot pad
            _dummy.position.set(x, groundY + 0.015, z);
            _dummy.rotation.set(0, rotY, 0);
            _dummy.scale.set(lotScale, 0.04, lotScale);
            _dummy.updateMatrix();
            zonePadMesh.setMatrixAt(zoneSlot, _dummy.matrix);
            _color.set(ZONE_CATALOG[zKind].color);
            if (lv > 0) _color.lerp(new THREE.Color('#94a3b8'), 0.65);
            zonePadMesh.setColorAt(zoneSlot, _color);
            zoneSlot++;

            if (lv > 0 && rciSlot < TOTAL_CELLS * 2 - 4) {
              const abandoned = eng.rciAbandoned[i] === 1;
              const variant = eng.rciVariant[i];

              // Calculate realistic height & architectural silhouette by zone & level (1..5)
              let h = 0.7;
              let w = lotScale * 0.82;
              let d = lotScale * 0.82;
              let tint = 0xffffff;

              if (zKind === ZoneKind.ResLow) {
                h = 0.48 + lv * 0.22;
                w = lotScale * 0.66;
                d = lotScale * 0.62;
                tint = [0xfef3c7, 0xfde68a, 0xe2e8f0, 0xfecdd3][variant % 4];
              } else if (zKind === ZoneKind.ResHigh) {
                h = 1.6 + lv * 1.15 + (variant % 3) * 0.35;
                tint = [0xe2e8f0, 0xcbd5e1, 0xbae6fd, 0xfef9c3][variant % 4];
              } else if (zKind === ZoneKind.ComLow) {
                h = 0.65 + lv * 0.28;
                tint = [0xbae6fd, 0xfde68a, 0xddd6fe, 0xfed7aa][variant % 4];
              } else if (zKind === ZoneKind.ComHigh) {
                h = 2.0 + lv * 1.45 + (variant % 3) * 0.4;
                tint = [0x93c5fd, 0xa5f3fc, 0xc7d2fe, 0xe2e8f0][variant % 4];
              } else if (zKind === ZoneKind.Industrial) {
                h = 0.65 + lv * 0.26;
                w = lotScale * 0.88;
                tint = [0xd6d3d1, 0xfde047, 0xfdba74, 0xa8a29e][variant % 4];
              } else {
                // Clean Tech Office skyscrapers
                h = 2.2 + lv * 1.55 + (variant % 2) * 0.5;
                tint = [0x67e8f9, 0x93c5fd, 0xe0f2fe, 0xc4b5fd][variant % 4];
              }

              if (abandoned) tint = 0x475569;
              if (eng.cellFire[i] > 0) tint = 0xf97316;

              // Main building volume
              _dummy.position.set(x, groundY + 0.04, z);
              _dummy.rotation.set(0, rotY, 0);
              _dummy.scale.set(w, h, d);
              _dummy.updateMatrix();
              rciTowerMesh.setMatrixAt(rciSlot, _dummy.matrix);
              _color.setHex(tint);
              rciTowerMesh.setColorAt(rciSlot, _color);
              rciRealColors[rciSlot] = tint;
              rciCellIndices[rciSlot] = i;
              rciSlot++;

              // Upper setback tower crown for Level 4-5 skyscrapers
              if (
                lv >= 4 &&
                (zKind === ZoneKind.ResHigh ||
                  zKind === ZoneKind.ComHigh ||
                  zKind === ZoneKind.Office) &&
                rciSlot < TOTAL_CELLS * 2 - 2
              ) {
                const crownH = h * 0.36;
                _dummy.position.set(x, groundY + 0.04 + h, z);
                _dummy.rotation.set(0, rotY, 0);
                _dummy.scale.set(w * 0.64, crownH, d * 0.64);
                _dummy.updateMatrix();
                rciTowerMesh.setMatrixAt(rciSlot, _dummy.matrix);
                _color.setHex(tint);
                rciTowerMesh.setColorAt(rciSlot, _color);
                rciRealColors[rciSlot] = tint;
                rciCellIndices[rciSlot] = i;
                rciSlot++;
              }

              // Pitched roof on low-density houses
              if (zKind === ZoneKind.ResLow && roofSlot < 5950) {
                _dummy.position.set(x, groundY + 0.04 + h, z);
                _dummy.rotation.set(0, rotY + Math.PI / 4, 0);
                _dummy.scale.set(w * 1.15, 0.36, d * 1.15);
                _dummy.updateMatrix();
                rciRoofMesh.setMatrixAt(roofSlot, _dummy.matrix);
                _color.setHex(
                  abandoned ? 0x334155 : [0xb45309, 0x991b1b, 0x334155, 0x0f766e][variant % 4]
                );
                rciRoofMesh.setColorAt(roofSlot, _color);
                roofSlot++;
              }
            }
          }

          // 3. Natural Forest Trees
          if (eng.trees[i] > 0 && treeSlot < 7950) {
            const groundY = surfaceHeightAt(eng, x, z);
            const s = 0.45 + eng.trees[i] * 0.16;
            _dummy.position.set(x, groundY, z);
            _dummy.rotation.set(0, (i * 1.3) % Math.PI, 0);
            _dummy.scale.set(s, s * 1.85, s);
            _dummy.updateMatrix();
            treeFoliageMesh.setMatrixAt(treeSlot, _dummy.matrix);
            _color.setHex(eng.trees[i] === 3 ? 0x15803d : 0x16a34a);
            treeFoliageMesh.setColorAt(treeSlot, _color);
            treeSlot++;
          }
        }
      }

      // 4. Civic Structures, Power/Water Plants, Parks, Transit & Unique Monuments
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
          if (civicBoxSlot >= 3980) return;
          _dummy.position.set(px, py, pz);
          _dummy.rotation.set(0, (st.rotation * Math.PI) / 2, 0);
          _dummy.scale.set(sx, sy, sz);
          _dummy.updateMatrix();
          civicBoxMesh.setMatrixAt(civicBoxSlot, _dummy.matrix);
          _color.setHex(hex);
          civicBoxMesh.setColorAt(civicBoxSlot, _color);
          civicStructIds[civicBoxSlot] = st.id;
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
          if (civicCylSlot >= 1980) return;
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
          pushCyl(cx, gy, cz, 0.22, 3.2, 0.22, 0xf8fafc);
          windTurbineCoords.push({ x: cx, y: gy + 3.15, z: cz });
        } else if (st.buildingId === 'water_tower') {
          pushCyl(cx, gy, cz, 0.28, 1.8, 0.28, 0x94a3b8);
          pushCyl(cx, gy + 1.75, cz, 0.78, 0.75, 0.78, 0x38bdf8);
        } else if (st.buildingId === 'coal_plant') {
          pushBox(cx, gy, cz, 1.75, 1.2, 1.75, 0x78716c);
          pushCyl(cx - 0.45, gy + 1.2, cz - 0.4, 0.32, 2.2, 0.32, 0xd6d3d1);
          pushCyl(cx + 0.45, gy + 1.2, cz - 0.4, 0.32, 2.0, 0.32, 0xd6d3d1);
        } else if (st.buildingId === 'nuclear_plant') {
          pushBox(cx, gy, cz, 2.6, 1.3, 2.6, 0xcbd5e1);
          pushCyl(cx - 0.65, gy + 1.1, cz - 0.5, 0.95, 2.8, 0.95, 0xe2e8f0);
          pushCyl(cx + 0.65, gy + 1.1, cz + 0.5, 0.95, 2.8, 0.95, 0xe2e8f0);
        } else if (st.buildingId === 'solar_plant') {
          pushBox(cx, gy, cz, 1.85, 0.16, 1.85, 0x94a3b8);
          pushBox(cx, gy + 0.16, cz - 0.4, 1.65, 0.22, 0.6, 0x1d4ed8);
          pushBox(cx, gy + 0.16, cz + 0.4, 1.65, 0.22, 0.6, 0x1d4ed8);
        } else if (st.buildingId === 'city_park' || st.buildingId === 'botanical_plaza') {
          pushBox(cx, gy, cz, st.w - 0.12, 0.1, st.d - 0.12, 0x16a34a);
          pushCyl(cx, gy + 0.1, cz, 0.65, 0.18, 0.65, 0x38bdf8);
          if (treeSlot < 7950) {
            _dummy.position.set(cx - 0.6, gy + 0.1, cz - 0.6);
            _dummy.scale.set(0.55, 1.1, 0.55);
            _dummy.updateMatrix();
            treeFoliageMesh.setMatrixAt(treeSlot, _dummy.matrix);
            _color.setHex(0x22c55e);
            treeFoliageMesh.setColorAt(treeSlot, _color);
            treeSlot++;
          }
        } else if (st.buildingId === 'monument_stadium') {
          // Grand Oval Stadium with green pitch
          pushCyl(cx, gy, cz, 3.7, 1.55, 3.4, 0xe2e8f0);
          pushCyl(cx, gy + 0.2, cz, 2.4, 1.4, 2.1, 0x16a34a);
          pushBox(cx - 1.5, gy + 1.55, cz - 1.5, 0.2, 1.1, 0.2, 0xfef08a);
          pushBox(cx + 1.5, gy + 1.55, cz + 1.5, 0.2, 1.1, 0.2, 0xfef08a);
        } else if (st.buildingId === 'monument_fox_tower') {
          // Panoramic Needle Spire
          pushCyl(cx, gy, cz, 2.1, 0.7, 2.1, 0x334155);
          pushCyl(cx, gy + 0.7, cz, 0.55, 7.6, 0.55, 0xe2e8f0);
          pushCyl(cx, gy + 6.4, cz, 1.45, 0.65, 1.45, 0x38bdf8);
          pushCyl(cx, gy + 8.3, cz, 0.12, 2.2, 0.12, 0xef4444);
        } else if (st.buildingId === 'monument_airport') {
          // International Terminal + Control Tower + Active Runway
          pushBox(cx, gy, cz - 0.9, st.w - 0.3, 0.95, 1.4, 0x93c5fd);
          pushCyl(cx - 1.6, gy + 0.95, cz - 0.9, 0.38, 2.1, 0.38, 0xf8fafc);
          // Asphalt runway strip
          pushBox(cx, gy, cz + 0.95, st.w - 0.1, 0.12, 1.35, 0x1e293b);
          airportCoords = { x: cx, y: gy + 0.35, z: cz + 0.95 };
        } else if (st.buildingId === 'monument_arcology') {
          // Futuristic terraced pyramid mega-spire
          pushBox(cx, gy, cz, 3.6, 1.8, 3.6, 0x0f766e);
          pushBox(cx, gy + 1.8, cz, 2.6, 3.2, 2.6, 0x0ea5e9);
          pushBox(cx, gy + 5.0, cz, 1.6, 4.2, 1.6, 0xa855f7);
          pushCyl(cx, gy + 9.2, cz, 0.25, 2.6, 0.25, 0xfef08a);
        } else {
          // Clinics, Hospitals, Schools, Universities, Police, Fire, Bus Depot, Metro Station
          const baseH =
            st.buildingId === 'hospital' || st.buildingId === 'university'
              ? 2.2
              : st.buildingId === 'metro_station'
              ? 0.68
              : 1.25;
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
        }
      }

      roadDeckMesh.count = deckSlot;
      roadStripeMesh.count = stripeSlot;
      bridgePierMesh.count = pierSlot;
      zonePadMesh.count = zoneSlot;
      rciTowerMesh.count = rciSlot;
      rciRoofMesh.count = roofSlot;
      treeFoliageMesh.count = treeSlot;
      civicBoxMesh.count = civicBoxSlot;
      civicCylMesh.count = civicCylSlot;

      for (const m of [
        roadDeckMesh,
        roadStripeMesh,
        bridgePierMesh,
        zonePadMesh,
        rciTowerMesh,
        rciRoofMesh,
        treeFoliageMesh,
        civicBoxMesh,
        civicCylMesh,
      ]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }

      // 5. Rebuild Bus Stop Markers & Colored Line Ribbons
      while (busLinesGroup.children.length > 0) {
        busLinesGroup.remove(busLinesGroup.children[0]);
      }
      for (const line of eng.busLines) {
        const pts: THREE.Vector3[] = [];
        for (const st of line.stops) {
          const y = (isWaterTerrain(eng.terrain[eng.idx(st.x, st.z)]) ? 1.8 : surfaceHeightAt(eng, st.x, st.z)) + 0.28;
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
        metroGroup.remove(metroGroup.children[0]);
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

      rciTowerMesh.material = isWhiteInfo ? whiteInfoMat : bldgRealisticMat;
      bldgRealisticMat.opacity = isMetroXray ? 0.22 : 1.0;
      solidRealisticMat.opacity = isMetroXray ? 0.3 : 1.0;
      treeFoliageMesh.visible = !isWhiteInfo && !isMetroXray;
      rciRoofMesh.visible = !isWhiteInfo && !isMetroXray;
      metroGroup.visible = isMetroXray || eng.metroSegments.length > 0;

      if (!isWhiteInfo) {
        // Restore realistic colors if coming back from white view
        if (lastOverlayMode !== 'normal' && lastOverlayMode !== 'metro') {
          for (let s = 0; s < rciTowerMesh.count; s++) {
            _color.setHex(rciRealColors[s]);
            rciTowerMesh.setColorAt(s, _color);
          }
          if (rciTowerMesh.instanceColor) rciTowerMesh.instanceColor.needsUpdate = true;

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

      // Color RCI buildings analytically
      for (let s = 0; s < rciTowerMesh.count; s++) {
        const ci = rciCellIndices[s];
        if (mode === 'power') {
          _color.setHex(eng.powerMap[ci] ? 0x0ea5e9 : 0xef4444);
        } else if (mode === 'water') {
          _color.setHex(eng.waterMap[ci] ? 0x06b6d4 : 0xf97316);
        } else if (mode === 'traffic') {
          _color.setHex(0xf1f5f9);
        } else if (mode === 'land_value') {
          _color.setHSL(0.36, 0.8, 0.78 - (eng.landValueMap[ci] / 100) * 0.42);
        } else if (mode === 'pollution') {
          const p = eng.pollutionMap[ci] / 100;
          _color.setRGB(0.95 - p * 0.15, 0.95 - p * 0.65, 0.96 - p * 0.25);
        } else {
          _color.setHSL(0.58, 0.85, 0.82 - (eng.serviceMap[ci] / 100) * 0.45);
        }
        rciTowerMesh.setColorAt(s, _color);
      }
      if (rciTowerMesh.instanceColor) rciTowerMesh.instanceColor.needsUpdate = true;

      // Color Roads (Traffic green->amber->red heatmap in Traffic view)
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

    // --- 6. Live Ghost Preview Builder ---
    const updatePreviewVisuals = (
      startCell: { x: number; z: number } | null,
      hoverCell: { x: number; z: number } | null
    ) => {
      while (previewGroup.children.length > 0) {
        previewGroup.remove(previewGroup.children[0]);
      }
      coverageRing.visible = false;

      const eng = engineRef.current;
      const curTool = toolRef.current;

      // Show pending mobile structure placement if active
      const activeStructPlacement =
        pendingRef.current ||
        (curTool.kind === 'building' && hoverCell
          ? {
              buildingId: curTool.buildingId,
              x: hoverCell.x,
              z: hoverCell.z,
              rotation: rotRef.current,
              ...eng.canPlaceStructure(
                curTool.buildingId,
                hoverCell.x,
                hoverCell.z,
                rotRef.current
              ),
              valid: eng.canPlaceStructure(
                curTool.buildingId,
                hoverCell.x,
                hoverCell.z,
                rotRef.current
              ).ok,
            }
          : null);

      if (activeStructPlacement) {
        const spec = BUILDING_SPECS[activeStructPlacement.buildingId];
        const w = activeStructPlacement.rotation % 2 === 1 ? spec.d : spec.w;
        const d = activeStructPlacement.rotation % 2 === 1 ? spec.w : spec.d;
        const cx = activeStructPlacement.x + w * 0.5 - 0.5;
        const cz = activeStructPlacement.z + d * 0.5 - 0.5;
        const gy = eng.inBounds(activeStructPlacement.x, activeStructPlacement.z)
          ? surfaceHeightAt(eng, activeStructPlacement.x, activeStructPlacement.z)
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

      if (!hoverCell) return;

      if (curTool.kind === 'road') {
        const pts = startCell
          ? eng.computeSmartRoadPath(startCell.x, startCell.z, hoverCell.x, hoverCell.z)
          : [hoverCell];
        const est = eng.estimateRoadPathCost(pts, curTool.tier);
        const col = est.valid ? '#38bdf8' : '#ef4444';
        for (const p of pts) {
          const isW = isWaterTerrain(eng.terrain[eng.idx(p.x, p.z)]);
          const y = isW ? 1.65 : surfaceHeightAt(eng, p.x, p.z) + 0.16;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(0.75, 0.18, 0.75),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 })
          );
          m.position.set(p.x, y, p.z);
          previewGroup.add(m);
        }
      } else if (curTool.kind === 'zone' || curTool.kind === 'bulldoze') {
        const a = startCell || hoverCell;
        const minX = Math.min(a.x, hoverCell.x);
        const maxX = Math.max(a.x, hoverCell.x);
        const minZ = Math.min(a.z, hoverCell.z);
        const maxZ = Math.max(a.z, hoverCell.z);
        const w = maxX - minX + 1;
        const d = maxZ - minZ + 1;
        const col =
          curTool.kind === 'bulldoze' ? '#ef4444' : ZONE_CATALOG[curTool.zone].color;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w, 0.25, d),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45 })
        );
        box.position.set(
          minX + w * 0.5 - 0.5,
          surfaceHeightAt(eng, hoverCell.x, hoverCell.z) + 0.18,
          minZ + d * 0.5 - 0.5
        );
        previewGroup.add(box);
      } else if (curTool.kind === 'metro_tunnel' && startCell) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(startCell.x, -1.9, startCell.z),
          new THREE.Vector3(hoverCell.x, -1.9, hoverCell.z),
        ]);
        previewGroup.add(
          new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#22d3ee' }))
        );
      }
    };

    // --- 7. Unified Desktop Mouse/Keyboard + Mobile Touch Gesture State Machine ---
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);

    const screenToCell = (
      clientX: number,
      clientY: number,
      applyTouchOffset: boolean
    ): { x: number; z: number } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const adjY = applyTouchOffset ? clientY - 42 : clientY;
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((adjY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      const gx = Math.round(hit.x);
      const gz = Math.round(hit.z);
      if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return null;
      return { x: gx, z: gz };
    };

    const activePointers = new Map<number, { x: number; y: number; type: string }>();
    let dragStartCell: { x: number; z: number } | null = null;
    let lastHoverCell: { x: number; z: number } | null = null;
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

      // 2+ fingers immediately preempts any drawing tool and switches to pinch-zoom / twist-orbit
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

      // Desktop right/middle button -> Orbit or Pan
      if (e.button === 2 || e.button === 1) {
        isRightOrbiting = e.button === 2 && !e.shiftKey;
        isPanning1Finger = e.button === 1 || (e.button === 2 && e.shiftKey);
        return;
      }

      const isTouch = e.pointerType === 'touch';
      const curTool = toolRef.current;

      // Neutral Camera Pan or Inspect
      if (curTool.kind === 'pan') {
        isPanning1Finger = true;
        return;
      }

      const cell = screenToCell(
        e.clientX,
        e.clientY,
        isTouch && curTool.kind !== 'inspect'
      );
      if (!cell) {
        isPanning1Finger = true;
        return;
      }

      if (curTool.kind === 'inspect') {
        onSelectInspect(engineRef.current.inspectCell(cell.x, cell.z));
        isPanning1Finger = true;
        return;
      }

      if (curTool.kind === 'bus_line') {
        const res = engineRef.current.addBusStopTap(cell.x, cell.z);
        onToast(res.message, res.ok ? 'ok' : 'warn');
        onAfterMutate();
        return;
      }

      if (curTool.kind === 'building') {
        if (isTouch) {
          // Mobile: position ghost preview + show Floating Confirmation Pill!
          const check = engineRef.current.canPlaceStructure(
            curTool.buildingId,
            cell.x,
            cell.z,
            rotRef.current
          );
          const nextPending: PendingMobilePlacement = {
            buildingId: curTool.buildingId,
            x: cell.x,
            z: cell.z,
            rotation: rotRef.current,
            cost: check.cost,
            valid: check.ok,
            reason: check.reason,
          };
          pendingRef.current = nextPending;
          setPendingPlacement(nextPending);
          setTouchReticle({ x: e.clientX, y: e.clientY - 42 });
          updatePreviewVisuals(null, cell);
        } else {
          // Desktop: direct click placement
          const placed = engineRef.current.placeStructure(
            curTool.buildingId,
            cell.x,
            cell.z,
            rotRef.current
          );
          if (!placed.ok && placed.reason) onToast(placed.reason, 'warn');
          onAfterMutate();
        }
        return;
      }

      // Drag tools: Road, Zone, Bulldoze, Metro Tunnel
      dragStartCell = cell;
      lastHoverCell = cell;
      if (isTouch) {
        setTouchReticle({ x: e.clientX, y: e.clientY - 42 });
      }
      updatePreviewVisuals(cell, cell);
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = activePointers.get(e.pointerId);
      if (prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

        // 2-finger pinch zoom + twist orbit + vertical tilt
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
      const cell = screenToCell(
        e.clientX,
        e.clientY,
        isTouch && curTool.kind !== 'pan' && curTool.kind !== 'inspect'
      );
      if (!cell) return;

      lastHoverCell = cell;

      if (isTouch && (dragStartCell || curTool.kind === 'building') && activePointers.size === 1) {
        setTouchReticle({ x: e.clientX, y: e.clientY - 42 });
      }

      if (isTouch && curTool.kind === 'building' && activePointers.size === 1) {
        const check = engineRef.current.canPlaceStructure(
          curTool.buildingId,
          cell.x,
          cell.z,
          rotRef.current
        );
        const nextPending: PendingMobilePlacement = {
          buildingId: curTool.buildingId,
          x: cell.x,
          z: cell.z,
          rotation: rotRef.current,
          cost: check.cost,
          valid: check.ok,
          reason: check.reason,
        };
        pendingRef.current = nextPending;
        setPendingPlacement(nextPending);
        updatePreviewVisuals(null, cell);
        return;
      }

      updatePreviewVisuals(dragStartCell, cell);

      if (dragStartCell && curTool.kind === 'road') {
        const pts = engineRef.current.computeSmartRoadPath(
          dragStartCell.x,
          dragStartCell.z,
          cell.x,
          cell.z
        );
        const est = engineRef.current.estimateRoadPathCost(pts, curTool.tier);
        setDragBanner({
          label: est.hasBridge
            ? `🌉 Puente (${pts.length} tramos)`
            : `${ROAD_CATALOG[curTool.tier].shortName} (${pts.length})`,
          cost: est.cost,
          valid: est.valid,
          screenX: e.clientX,
          screenY: isTouch ? e.clientY - 82 : e.clientY - 34,
        });
      } else if (dragStartCell && curTool.kind === 'zone') {
        const count =
          (Math.abs(cell.x - dragStartCell.x) + 1) * (Math.abs(cell.z - dragStartCell.z) + 1);
        setDragBanner({
          label: `${ZONE_CATALOG[curTool.zone].shortName} (${count} celdas)`,
          cost: count * ZONE_CATALOG[curTool.zone].costPerCell,
          valid: true,
          screenX: e.clientX,
          screenY: isTouch ? e.clientY - 82 : e.clientY - 34,
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

      if (dragStartCell && lastHoverCell) {
        const curTool = toolRef.current;
        const eng = engineRef.current;
        if (curTool.kind === 'road') {
          const res = eng.buildRoadPath(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverCell.x,
            lastHoverCell.z,
            curTool.tier
          );
          if (!res.ok && res.reason) onToast(res.reason, 'warn');
          onAfterMutate();
        } else if (curTool.kind === 'zone') {
          const res = eng.paintZoneRect(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverCell.x,
            lastHoverCell.z,
            curTool.zone
          );
          if (!res.ok && res.reason) onToast(res.reason, 'warn');
          onAfterMutate();
        } else if (curTool.kind === 'bulldoze') {
          eng.bulldozeArea(dragStartCell.x, dragStartCell.z, lastHoverCell.x, lastHoverCell.z);
          onAfterMutate();
        } else if (curTool.kind === 'metro_tunnel') {
          const res = eng.buildMetroTunnel(
            dragStartCell.x,
            dragStartCell.z,
            lastHoverCell.x,
            lastHoverCell.z
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

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - prevTime) * 0.001);
      prevTime = now;

      const eng = engineRef.current;

      // Sync terrain & static meshes only when mutated or city switched
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

      // Day / Sunset / Night Lighting & Lit Skyscraper Windows
      const hr = eng.timeOfDay; // 0..24
      const sunAngle = ((hr - 6) / 24) * Math.PI * 2;
      const sunElev = Math.sin(sunAngle); // >0 day, <0 night
      const nightFactor = THREE.MathUtils.clamp(-sunElev * 1.6 + 0.25, 0, 1);

      if (overlayRef.current !== 'normal' && overlayRef.current !== 'metro') {
        scene.background = _color.setHex(0xe2e8f0);
        (scene.fog as THREE.FogExp2).color.setHex(0xe2e8f0);
        sunLight.intensity = 1.25;
        hemiLight.intensity = 1.1;
        bldgRealisticMat.emissiveIntensity = 0;
      } else {
        const daySky = new THREE.Color(eng.weather === 'rain' ? '#64748b' : '#7dd3fc');
        const sunsetSky = new THREE.Color('#fb923c');
        const nightSky = new THREE.Color('#070d19');

        const skyCol = daySky.clone();
        if (Math.abs(sunElev) < 0.28) {
          skyCol.lerp(sunsetSky, 1 - Math.abs(sunElev) / 0.28);
        }
        skyCol.lerp(nightSky, nightFactor);
        scene.background = skyCol;
        (scene.fog as THREE.FogExp2).color.copy(skyCol);

        sunLight.position.set(
          WORLD_CENTER + Math.cos(sunAngle) * 75,
          Math.max(14, Math.abs(sunElev) * 88),
          WORLD_CENTER + 30
        );
        sunLight.intensity = THREE.MathUtils.lerp(1.65, 0.22, nightFactor);
        hemiLight.intensity = THREE.MathUtils.lerp(0.88, 0.34, nightFactor);
        bldgRealisticMat.emissiveIntensity = nightFactor * 1.35;
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

      // Commercial Airplane Take-off & Landing Loop on International Airport
      if (airportCoords) {
        airplaneGroup.visible = true;
        const cycle = (now * 0.00018) % 1; // 0..1 loop
        const rx = airportCoords.x - 16 + cycle * 32;
        const climb =
          cycle < 0.32
            ? (0.32 - cycle) * 14
            : cycle > 0.68
            ? (cycle - 0.68) * 16
            : 0;
        airplaneGroup.position.set(rx, airportCoords.y + climb, airportCoords.z);
        airplaneGroup.rotation.set(
          0,
          0,
          cycle < 0.32 ? -0.14 : cycle > 0.68 ? 0.18 : 0
        );
      } else {
        airplaneGroup.visible = false;
      }

      // Live Road Traffic Vehicles + Bus Fleet
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

      const speedMult = eng.simSpeed === 0 ? 0 : eng.simSpeed === 1 ? 1 : eng.simSpeed === 2 ? 1.6 : 2.3;
      let vehSlot = 0;
      let lightSlot = 0;

      for (let idx = 0; idx < vehicles.length && vehSlot < 370; idx++) {
        const v = vehicles[idx];
        const cellIdx = eng.idx(v.x, v.z);
        const mask = eng.roadMask[cellIdx];
        if (mask === 0) {
          if (roadCellsList.length > 0) {
            const pick = roadCellsList[idx % roadCellsList.length];
            v.x = pick % GRID_SIZE;
            v.z = Math.floor(pick / GRID_SIZE);
          }
          continue;
        }

        let dir = DIR_OFFSETS[v.dirIdx];
        if ((mask & dir.bit) === 0) {
          // Pick a connected outgoing arm
          for (let k = 0; k < 8; k++) {
            const cand = (v.dirIdx + k) % 8;
            if ((mask & DIR_OFFSETS[cand].bit) !== 0) {
              v.dirIdx = cand;
              dir = DIR_OFFSETS[cand];
              break;
            }
          }
        }

        v.progress += dt * v.speed * speedMult;
        if (v.progress >= 1) {
          v.progress -= 1;
          const nx = v.x + dir.dx;
          const nz = v.z + dir.dz;
          if (eng.inBounds(nx, nz) && eng.roadTier[eng.idx(nx, nz)] !== RoadTier.None) {
            v.x = nx;
            v.z = nz;
            const nMask = eng.roadMask[eng.idx(nx, nz)];
            // Prefer continuing straight or turning smoothly (avoid U-turn unless dead-end)
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
          }
        }

        const curDir = DIR_OFFSETS[Math.max(0, v.dirIdx)];
        const angle = Math.atan2(curDir.dx, curDir.dz);
        // Right-hand lane offset
        const perpX = Math.cos(angle) * 0.14;
        const perpZ = -Math.sin(angle) * 0.14;
        const wx = v.x + curDir.dx * v.progress + perpX;
        const wz = v.z + curDir.dz * v.progress + perpZ;
        const onBridge = isWaterTerrain(eng.terrain[cellIdx]);
        const wy = onBridge ? 1.79 : surfaceHeightAt(eng, v.x, v.z) + 0.15;

        _dummy.position.set(wx, wy, wz);
        _dummy.rotation.set(0, angle, 0);
        _dummy.scale.set(
          0.16,
          v.kind === 'truck' || v.kind === 'fire' ? 0.19 : 0.12,
          v.kind === 'truck' || v.kind === 'fire' ? 0.38 : 0.28
        );
        _dummy.updateMatrix();
        vehicleMesh.setMatrixAt(vehSlot, _dummy.matrix);
        _color.setHex(v.colorHex);
        vehicleMesh.setColorAt(vehSlot, _color);
        vehSlot++;

        if (nightFactor > 0.35 && lightSlot < 410) {
          _dummy2.position.set(
            wx + Math.sin(angle) * 0.22,
            wy + 0.04,
            wz + Math.cos(angle) * 0.22
          );
          _dummy2.rotation.set(0, angle, 0);
          _dummy2.scale.set(0.14, 0.04, 0.18);
          _dummy2.updateMatrix();
          headlightMesh.setMatrixAt(lightSlot++, _dummy2.matrix);
        }
      }

      // Add Articulated City Buses along active Bus Lines!
      for (let li = 0; li < eng.busLines.length; li++) {
        const line = eng.busLines[li];
        if (line.stops.length < 2) continue;
        for (let b = 0; b < 2 && vehSlot < 418; b++) {
          const t = ((now * 0.00028 * Math.max(0.2, speedMult) + b * 0.5 + li * 0.23) % 1) * line.stops.length;
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
            ? 1.82
            : surfaceHeightAt(eng, Math.round(bx), Math.round(bz)) + 0.17;

          _dummy.position.set(bx, by, bz);
          _dummy.rotation.set(0, ang, 0);
          _dummy.scale.set(0.22, 0.24, 0.58);
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

      // Underground Metro Trains along tunnels (Y = -2.1)
      let trainSlot = 0;
      for (let mi = 0; mi < eng.metroSegments.length && trainSlot < 115; mi++) {
        const seg = eng.metroSegments[mi];
        const pingPong = Math.abs((((now * 0.00045 * Math.max(0.25, speedMult) + mi * 0.37) % 2) - 1));
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

      // FX Particles: Fires, Tornado Funnel, Meteor, Rain & Wind Arrows in Pollution Overlay
      let fxSlot = 0;

      // Active cell fires
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

      // Active Disasters (Tornado vortex / Meteor fireball)
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

      // Wind direction streaks in Pollution overlay
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
        // Atmospheric rain streaks around camera target
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
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (dom.parentElement === host) {
        host.removeChild(dom);
      }
    };
  }, []);

  return (
    <div ref={hostRef} className="city-canvas-host relative w-full h-full overflow-hidden">
      {/* Touch Offset Reticle (+42px above thumb so finger never blocks target cell) */}
      {touchReticle && (
        <div
          className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-1/2"
          style={{ left: touchReticle.x, top: touchReticle.y }}
        >
          <div className="w-8 h-8 rounded-full border-2 border-sky-400 bg-sky-400/20 shadow-[0_0_14px_rgba(56,189,248,0.85)] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
          <div className="mx-auto w-0.5 h-9 bg-gradient-to-b from-sky-400 to-transparent" />
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
