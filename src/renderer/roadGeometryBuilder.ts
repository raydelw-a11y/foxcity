import * as THREE from 'three';
import { CityEngine, DIR_OFFSETS } from '../engine/cityEngine';
import { isWaterTerrain } from '../engine/mapGenerator';
import { GRID_SIZE, RoadTier } from '../types/game';

export interface RoadCellVertexRange {
  cellIdx: number;
  startVertex: number;
  vertexCount: number;
  baseR: number;
  baseG: number;
  baseB: number;
}

export interface BuiltRoadNetworkGeometries {
  sidewalkGeo: THREE.BufferGeometry;
  asphaltGeo: THREE.BufferGeometry;
  markingsGeo: THREE.BufferGeometry;
  asphaltCellRanges: RoadCellVertexRange[];
}

interface TierSpec {
  asphaltHalfW: number;
  curbHalfW: number;
  asphaltColor: number;
  bridgeColor: number;
  curbColor: number;
}

const TIER_SPECS: Record<number, TierSpec> = {
  [RoadTier.Local2L]: {
    asphaltHalfW: 0.255,
    curbHalfW: 0.345,
    asphaltColor: 0x2a3649,
    bridgeColor: 0x3b485b,
    curbColor: 0xcbd5e1,
  },
  [RoadTier.Avenue4L]: {
    asphaltHalfW: 0.34,
    curbHalfW: 0.43,
    asphaltColor: 0x1e293b,
    bridgeColor: 0x374357,
    curbColor: 0xdbe3ed,
  },
  [RoadTier.Highway6L]: {
    asphaltHalfW: 0.405,
    curbHalfW: 0.445,
    asphaltColor: 0x162030,
    bridgeColor: 0x323e52,
    curbColor: 0x94a3b8,
  },
};

function getSpec(tier: RoadTier): TierSpec {
  return TIER_SPECS[tier] || TIER_SPECS[RoadTier.Local2L];
}

export function getRoadBaseY(eng: CityEngine, x: number, z: number): number {
  const cx = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(x)));
  const cz = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(z)));
  const i = eng.idx(cx, cz);
  if (isWaterTerrain(eng.terrain[i])) {
    return 1.56;
  }
  return Math.max(0.05, eng.elevation[i]) + 0.035;
}

class MeshBufferAcc {
  public pos: number[] = [];
  public norm: number[] = [];
  public uv: number[] = [];
  public col: number[] = [];

  public get vertexCount(): number {
    return this.pos.length / 3;
  }

  public pushTriRaw(
    ax: number,
    ay: number,
    az: number,
    au: number,
    av: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    bv: number,
    cx: number,
    cy: number,
    cz: number,
    cu: number,
    cv: number,
    r: number,
    g: number,
    b: number
  ) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uv.push(au, av, bu, bv, cu, cv);
    this.col.push(r, g, b, r, g, b, r, g, b);
  }

  /** Pushes a triangle guaranteed to wind upward (+Y normal) in right-handed XZ space. */
  public pushTriUp(
    ax: number,
    ay: number,
    az: number,
    au: number,
    av: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    bv: number,
    cx: number,
    cy: number,
    cz: number,
    cu: number,
    cv: number,
    r: number,
    g: number,
    b: number
  ) {
    // In Three.js Y-up right-handed coordinates, (B - A) x (C - A) has +Y iff (bz-az)*(cx-ax) - (bx-ax)*(cz-az) > 0
    const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (crossY >= 0) {
      this.pushTriRaw(ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv, r, g, b);
    } else {
      this.pushTriRaw(ax, ay, az, au, av, cx, cy, cz, cu, cv, bx, by, bz, bu, bv, r, g, b);
    }
  }

  public pushQuadUp(
    p0x: number,
    p0y: number,
    p0z: number,
    u0: number,
    v0: number,
    p1x: number,
    p1y: number,
    p1z: number,
    u1: number,
    v1: number,
    p2x: number,
    p2y: number,
    p2z: number,
    u2: number,
    v2: number,
    p3x: number,
    p3y: number,
    p3z: number,
    u3: number,
    v3: number,
    r: number,
    g: number,
    b: number
  ) {
    this.pushTriUp(p0x, p0y, p0z, u0, v0, p1x, p1y, p1z, u1, v1, p2x, p2y, p2z, u2, v2, r, g, b);
    this.pushTriUp(p0x, p0y, p0z, u0, v0, p2x, p2y, p2z, u2, v2, p3x, p3y, p3z, u3, v3, r, g, b);
  }

  /** Pushes a vertical side skirt wall quad between top edge (A->B) and lower Ys (ayBot, byBot). */
  public pushSideWall(
    ax: number,
    ayTop: number,
    ayBot: number,
    az: number,
    bx: number,
    byTop: number,
    byBot: number,
    bz: number,
    r: number,
    g: number,
    b: number
  ) {
    this.pushTriRaw(ax, ayTop, az, 0, 1, ax, ayBot, az, 0, 0, bx, byTop, bz, 1, 1, r, g, b);
    this.pushTriRaw(bx, byTop, bz, 1, 1, ax, ayBot, az, 0, 0, bx, byBot, bz, 1, 0, r, g, b);
  }

  public toBufferGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

interface RibbonSample {
  x: number;
  y: number;
  z: number;
  nx: number; // right-hand horizontal normal in XZ
  nz: number;
  tx: number;
  tz: number;
  t: number;
  arc: number;
}

function sampleQuadBezierRibbon(
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  steps: number
): RibbonSample[] {
  const out: RibbonSample[] = [];
  let prevX = p0x;
  let prevZ = p0z;
  let arc = 0;

  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const omt = 1 - t;
    const x = omt * omt * p0x + 2 * omt * t * p1x + t * t * p2x;
    const y = omt * omt * p0y + 2 * omt * t * p1y + t * t * p2y;
    const z = omt * omt * p0z + 2 * omt * t * p1z + t * t * p2z;

    let dtx = 2 * omt * (p1x - p0x) + 2 * t * (p2x - p1x);
    let dtz = 2 * omt * (p1z - p0z) + 2 * t * (p2z - p1z);
    const len = Math.hypot(dtx, dtz);
    if (len > 1e-5) {
      dtx /= len;
      dtz /= len;
    } else {
      dtx = p2x - p0x;
      dtz = p2z - p0z;
      const l2 = Math.hypot(dtx, dtz) || 1;
      dtx /= l2;
      dtz /= l2;
    }

    if (k > 0) {
      arc += Math.hypot(x - prevX, z - prevZ);
    }
    prevX = x;
    prevZ = z;

    out.push({
      x,
      y,
      z,
      tx: dtx,
      tz: dtz,
      nx: -dtz,
      nz: dtx,
      t,
      arc,
    });
  }
  return out;
}

function emitRibbonLayer(
  buf: MeshBufferAcc,
  samples: RibbonSample[],
  yOffset: number,
  centerOffsetLat: number,
  halfWStart: number,
  halfWMid: number,
  halfWEnd: number,
  r: number,
  g: number,
  b: number,
  skirtDepth = 0,
  bridgeParapets = false
) {
  let prevLx = 0;
  let prevLy = 0;
  let prevLz = 0;
  let prevRx = 0;
  let prevRy = 0;
  let prevRz = 0;
  let prevV = 0;

  for (let k = 0; k < samples.length; k++) {
    const s = samples[k];
    // Smoothly interpolate half-width from edgeA -> center -> edgeB
    const hw =
      s.t <= 0.5
        ? halfWStart + (halfWMid - halfWStart) * (s.t * 2)
        : halfWMid + (halfWEnd - halfWMid) * ((s.t - 0.5) * 2);

    const cx = s.x + s.nx * centerOffsetLat;
    const cz = s.z + s.nz * centerOffsetLat;
    const y = s.y + yOffset;
    const lx = cx - s.nx * hw;
    const lz = cz - s.nz * hw;
    const rx = cx + s.nx * hw;
    const rz = cz + s.nz * hw;
    const vCoord = s.arc * 1.45;

    if (k > 0) {
      buf.pushQuadUp(
        prevLx,
        prevLy,
        prevLz,
        0,
        prevV,
        prevRx,
        prevRy,
        prevRz,
        1,
        prevV,
        rx,
        y,
        rz,
        1,
        vCoord,
        lx,
        y,
        lz,
        0,
        vCoord,
        r,
        g,
        b
      );

      if (skirtDepth > 0) {
        const dr = r * 0.72;
        const dg = g * 0.72;
        const db = b * 0.72;
        buf.pushSideWall(prevLx, prevLy, prevLy - skirtDepth, prevLz, lx, y, y - skirtDepth, lz, dr, dg, db);
        buf.pushSideWall(rx, y, y - skirtDepth, rz, prevRx, prevRy, prevRy - skirtDepth, prevRz, dr, dg, db);
      }

      if (bridgeParapets) {
        const pr = 0.88;
        const pg = 0.91;
        const pb = 0.95;
        const pw = 0.045;
        const ph = 0.14;
        // Left & right bridge safety parapets
        buf.pushQuadUp(
          prevLx - s.nx * pw,
          prevLy + ph,
          prevLz - s.nz * pw,
          0,
          0,
          prevLx,
          prevLy + ph,
          prevLz,
          1,
          0,
          lx,
          y + ph,
          lz,
          1,
          1,
          lx - s.nx * pw,
          y + ph,
          lz - s.nz * pw,
          0,
          1,
          pr,
          pg,
          pb
        );
        buf.pushSideWall(prevLx, prevLy + ph, prevLy, prevLz, lx, y + ph, y, lz, pr * 0.85, pg * 0.85, pb * 0.85);

        buf.pushQuadUp(
          prevRx,
          prevRy + ph,
          prevRz,
          0,
          0,
          prevRx + s.nx * pw,
          prevRy + ph,
          prevRz + s.nz * pw,
          1,
          0,
          rx + s.nx * pw,
          y + ph,
          rz + s.nz * pw,
          1,
          1,
          rx,
          y + ph,
          rz,
          0,
          1,
          pr,
          pg,
          pb
        );
        buf.pushSideWall(rx, y + ph, y, rz, prevRx, prevRy + ph, prevRy, prevRz, pr * 0.85, pg * 0.85, pb * 0.85);
      }
    }

    prevLx = lx;
    prevLy = y;
    prevLz = lz;
    prevRx = rx;
    prevRy = y;
    prevRz = rz;
    prevV = vCoord;
  }
}

interface PortAnchor {
  dx: number;
  dz: number;
  ux: number;
  uz: number;
  dist: number;
  phi: number;
  px: number;
  py: number;
  pz: number;
  asphaltW: number;
  curbW: number;
  diag: boolean;
}

export function buildRoadNetworkGeometries(eng: CityEngine): BuiltRoadNetworkGeometries {
  const sidewalkBuf = new MeshBufferAcc();
  const asphaltBuf = new MeshBufferAcc();
  const markingsBuf = new MeshBufferAcc();
  const asphaltCellRanges: RoadCellVertexRange[] = [];

  const tmpCol = new THREE.Color();
  const curbCol = new THREE.Color();

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const i = eng.idx(x, z);
      const tier = eng.roadTier[i] as RoadTier;
      if (tier === RoadTier.None) continue;

      const isBridge = isWaterTerrain(eng.terrain[i]);
      const yc = getRoadBaseY(eng, x, z);
      const spec = getSpec(tier);

      tmpCol.setHex(isBridge ? spec.bridgeColor : spec.asphaltColor);
      const ar = tmpCol.r;
      const ag = tmpCol.g;
      const ab = tmpCol.b;

      curbCol.setHex(isBridge ? 0x94a3b8 : spec.curbColor);
      const cr = curbCol.r;
      const cg = curbCol.g;
      const cb = curbCol.b;

      const startAsphaltVertex = asphaltBuf.vertexCount;
      const mask = eng.roadMask[i];

      const ports: PortAnchor[] = [];
      for (const d of DIR_OFFSETS) {
        if ((mask & d.bit) === 0) continue;
        const nx = x + d.dx;
        const nz = z + d.dz;
        if (!eng.inBounds(nx, nz)) continue;
        const ni = eng.idx(nx, nz);
        const nTier = eng.roadTier[ni] as RoadTier;
        if (nTier === RoadTier.None) continue;

        const nSpec = getSpec(nTier);
        const yn = getRoadBaseY(eng, nx, nz);
        const dist = d.diag ? Math.SQRT1_2 : 0.5;
        ports.push({
          dx: d.dx,
          dz: d.dz,
          ux: d.dx / Math.hypot(d.dx, d.dz),
          uz: d.dz / Math.hypot(d.dx, d.dz),
          dist,
          phi: Math.atan2(d.dz, d.dx),
          px: x + d.dx * 0.5,
          py: (yc + yn) * 0.5,
          pz: z + d.dz * 0.5,
          asphaltW: (spec.asphaltHalfW + nSpec.asphaltHalfW) * 0.5,
          curbW: (spec.curbHalfW + nSpec.curbHalfW) * 0.5,
          diag: d.diag,
        });
      }

      const deg = ports.length;

      if (deg === 0) {
        // Isolated circular pad
        const segs = 12;
        for (let s = 0; s < segs; s++) {
          const a0 = (s / segs) * Math.PI * 2;
          const a1 = ((s + 1) / segs) * Math.PI * 2;
          const c0 = Math.cos(a0);
          const s0 = Math.sin(a0);
          const c1 = Math.cos(a1);
          const s1 = Math.sin(a1);

          if (tier !== RoadTier.Highway6L || isBridge) {
            sidewalkBuf.pushTriUp(
              x,
              yc + 0.048,
              z,
              0.5,
              0.5,
              x + c0 * spec.curbHalfW,
              yc + 0.048,
              z + s0 * spec.curbHalfW,
              0.5 + c0 * 0.5,
              0.5 + s0 * 0.5,
              x + c1 * spec.curbHalfW,
              yc + 0.048,
              z + s1 * spec.curbHalfW,
              0.5 + c1 * 0.5,
              0.5 + s1 * 0.5,
              cr,
              cg,
              cb
            );
          }

          asphaltBuf.pushTriUp(
            x,
            yc + 0.07,
            z,
            0.5,
            0.5,
            x + c0 * spec.asphaltHalfW,
            yc + 0.07,
            z + s0 * spec.asphaltHalfW,
            0.5 + c0 * 0.5,
            0.5 + s0 * 0.5,
            x + c1 * spec.asphaltHalfW,
            yc + 0.07,
            z + s1 * spec.asphaltHalfW,
            0.5 + c1 * 0.5,
            0.5 + s1 * 0.5,
            ar,
            ag,
            ab
          );
        }
      } else if (deg === 1) {
        // Dead-end straight arm + rounded cul-de-sac cap
        const p0 = ports[0];
        const samples = sampleQuadBezierRibbon(
          p0.px,
          p0.py,
          p0.pz,
          (p0.px + x) * 0.5,
          (p0.py + yc) * 0.5,
          (p0.pz + z) * 0.5,
          x,
          yc,
          z,
          2
        );

        if (tier !== RoadTier.Highway6L || isBridge) {
          emitRibbonLayer(
            sidewalkBuf,
            samples,
            0.048,
            0,
            p0.curbW,
            spec.curbHalfW,
            spec.curbHalfW,
            cr,
            cg,
            cb,
            isBridge ? 0.16 : 0.06,
            isBridge
          );
        }
        emitRibbonLayer(
          asphaltBuf,
          samples,
          0.07,
          0,
          p0.asphaltW,
          spec.asphaltHalfW,
          spec.asphaltHalfW,
          ar,
          ag,
          ab,
          isBridge ? 0.18 : 0.03
        );

        // Semicircular cul-de-sac fan cap around (x, z) opposite incoming direction
        const baseAngle = Math.atan2(-p0.uz, -p0.ux);
        const capSegs = 10;
        for (let s = 0; s < capSegs; s++) {
          const a0 = baseAngle - Math.PI * 0.5 + (s / capSegs) * Math.PI;
          const a1 = baseAngle - Math.PI * 0.5 + ((s + 1) / capSegs) * Math.PI;
          const c0 = Math.cos(a0);
          const s0 = Math.sin(a0);
          const c1 = Math.cos(a1);
          const s1 = Math.sin(a1);

          if (tier !== RoadTier.Highway6L || isBridge) {
            sidewalkBuf.pushTriUp(
              x,
              yc + 0.048,
              z,
              0.5,
              0.5,
              x + c0 * spec.curbHalfW,
              yc + 0.048,
              z + s0 * spec.curbHalfW,
              0.5 + c0 * 0.5,
              0.5 + s0 * 0.5,
              x + c1 * spec.curbHalfW,
              yc + 0.048,
              z + s1 * spec.curbHalfW,
              0.5 + c1 * 0.5,
              0.5 + s1 * 0.5,
              cr,
              cg,
              cb
            );
          }

          asphaltBuf.pushTriUp(
            x,
            yc + 0.07,
            z,
            0.5,
            0.5,
            x + c0 * spec.asphaltHalfW,
            yc + 0.07,
            z + s0 * spec.asphaltHalfW,
            0.5 + c0 * 0.5,
            0.5 + s0 * 0.5,
            x + c1 * spec.asphaltHalfW,
            yc + 0.07,
            z + s1 * spec.asphaltHalfW,
            0.5 + c1 * 0.5,
            0.5 + s1 * 0.5,
            ar,
            ag,
            ab
          );
        }

        // Markings up to 0.36 from port
        if (tier === RoadTier.Avenue4L) {
          emitRibbonLayer(markingsBuf, samples, 0.08, 0, 0.04, 0.04, 0.02, 0.09, 0.64, 0.29);
        } else {
          emitRibbonLayer(
            markingsBuf,
            samples,
            0.08,
            0,
            tier === RoadTier.Highway6L ? 0.024 : 0.014,
            tier === RoadTier.Highway6L ? 0.024 : 0.014,
            tier === RoadTier.Highway6L ? 0.024 : 0.014,
            tier === RoadTier.Highway6L ? 0.98 : 0.89,
            tier === RoadTier.Highway6L ? 0.8 : 0.91,
            tier === RoadTier.Highway6L ? 0.08 : 0.94
          );
        }
      } else if (deg === 2) {
        // Unified smooth QuadraticBezierCurve3 ribbon across cell — ZERO overlapping boxes!
        const pA = ports[0];
        const pB = ports[1];
        const dot = pA.ux * pB.ux + pA.uz * pB.uz;
        const isStraight = dot < -0.96;
        const steps = isStraight ? 2 : 10;
        const samples = sampleQuadBezierRibbon(pA.px, pA.py, pA.pz, x, yc, z, pB.px, pB.py, pB.pz, steps);

        if (tier !== RoadTier.Highway6L || isBridge) {
          emitRibbonLayer(
            sidewalkBuf,
            samples,
            0.048,
            0,
            pA.curbW,
            spec.curbHalfW,
            pB.curbW,
            cr,
            cg,
            cb,
            isBridge ? 0.16 : 0.06,
            isBridge
          );
        }

        emitRibbonLayer(
          asphaltBuf,
          samples,
          0.07,
          0,
          pA.asphaltW,
          spec.asphaltHalfW,
          pB.asphaltW,
          ar,
          ag,
          ab,
          isBridge ? 0.18 : 0.03
        );

        // Smooth curved lane markings / medians following the exact same Bezier arc
        if (tier === RoadTier.Avenue4L) {
          // Green landscaped median
          emitRibbonLayer(markingsBuf, samples, 0.08, 0, 0.044, 0.044, 0.044, 0.09, 0.64, 0.29);
          // Crisp outer white shoulder edge lines
          emitRibbonLayer(markingsBuf, samples, 0.079, -spec.asphaltHalfW * 0.78, 0.012, 0.012, 0.012, 0.88, 0.92, 0.96);
          emitRibbonLayer(markingsBuf, samples, 0.079, spec.asphaltHalfW * 0.78, 0.012, 0.012, 0.012, 0.88, 0.92, 0.96);
        } else if (tier === RoadTier.Highway6L) {
          // Yellow center double barrier + lane lines
          emitRibbonLayer(markingsBuf, samples, 0.08, 0, 0.026, 0.026, 0.026, 0.98, 0.8, 0.08);
          emitRibbonLayer(markingsBuf, samples, 0.079, -spec.asphaltHalfW * 0.5, 0.012, 0.012, 0.012, 0.92, 0.95, 0.98);
          emitRibbonLayer(markingsBuf, samples, 0.079, spec.asphaltHalfW * 0.5, 0.012, 0.012, 0.012, 0.92, 0.95, 0.98);
        } else {
          // Dashed center line on Local 2L (every alternate segment)
          const midSlice = isStraight ? samples : samples.slice(1, samples.length - 1);
          if (midSlice.length >= 2) {
            emitRibbonLayer(markingsBuf, midSlice, 0.08, 0, 0.015, 0.015, 0.015, 0.93, 0.95, 0.98);
          }
        }
      } else {
        // Degree >= 3: Star-shaped monotonic perimeter polygon with smooth miter/Bezier fillets (zero overlap!)
        ports.sort((a, b) => a.phi - b.phi);

        const buildHubPerimeter = (useCurb: boolean): { px: number; py: number; pz: number }[] => {
          const ring: { px: number; py: number; pz: number }[] = [];
          const m = ports.length;

          for (let j = 0; j < m; j++) {
            const pJ = ports[j];
            const pK = ports[(j + 1) % m];
            const wJ = useCurb ? pJ.curbW : pJ.asphaltW;
            const wK = useCurb ? pK.curbW : pK.asphaltW;

            // Left-hand edge normal of outgoing arm J (pointing toward arm K in ascending phi)
            const nJoutX = -pJ.uz;
            const nJoutZ = pJ.ux;
            // Right-hand edge normal of outgoing arm K (pointing back toward arm J)
            const nKinX = pK.uz;
            const nKinZ = -pK.ux;

            // Port outer edge points
            const eJOutX = pJ.px + nJoutX * wJ;
            const eJOutZ = pJ.pz + nJoutZ * wJ;
            const eKInX = pK.px + nKinX * wK;
            const eKInZ = pK.pz + nKinZ * wK;

            // Exact midpoint on arm port edge (connects cleanly to arm J's port)
            ring.push({ px: pJ.px - nJoutX * wJ, py: pJ.py, pz: pJ.pz - nJoutZ * wJ });
            ring.push({ px: eJOutX, py: pJ.py, pz: eJOutZ });

            let dPhi = pK.phi - pJ.phi;
            if (dPhi <= 0) dPhi += Math.PI * 2;
            const bisAngle = pJ.phi + dPhi * 0.5;
            const bx = Math.cos(bisAngle);
            const bz = Math.sin(bisAngle);
            const wAvg = (wJ + wK) * 0.5;

            if (dPhi >= Math.PI * 0.96) {
              // Straight side of T-junction (~180 deg): gentle side curve passing outside center
              const wCenter = useCurb ? spec.curbHalfW : spec.asphaltHalfW;
              const ctrlX = x + bx * wCenter;
              const ctrlZ = z + bz * wCenter;
              for (let st = 1; st <= 3; st++) {
                const t = st / 4;
                const omt = 1 - t;
                ring.push({
                  px: omt * omt * eJOutX + 2 * omt * t * ctrlX + t * t * eKInX,
                  py: (pJ.py + pK.py + yc) / 3,
                  pz: omt * omt * eJOutZ + 2 * omt * t * ctrlZ + t * t * eKInZ,
                });
              }
            } else {
              const tanHalf = Math.max(0.18, Math.tan(dPhi * 0.5));
              const sinHalf = Math.max(0.18, Math.sin(dPhi * 0.5));
              const dMiter = wAvg / tanHalf;
              const maxD = Math.min(pJ.dist, pK.dist) * 0.92;

              if (dMiter <= maxD) {
                // Smooth rounded intersection corner fillet (90 deg or 135 deg)
                const setback = Math.min(maxD, dMiter + 0.08);
                const sJx = x + pJ.ux * setback + nJoutX * wJ;
                const sJz = z + pJ.uz * setback + nJoutZ * wJ;
                const sKx = x + pK.ux * setback + nKinX * wK;
                const sKz = z + pK.uz * setback + nKinZ * wK;
                const mDist = Math.min(0.68, wAvg / sinHalf);
                const mX = x + bx * mDist;
                const mZ = z + bz * mDist;

                ring.push({ px: sJx, py: (pJ.py + yc) * 0.5, pz: sJz });
                for (let st = 1; st <= 3; st++) {
                  const t = st / 4;
                  const omt = 1 - t;
                  ring.push({
                    px: omt * omt * sJx + 2 * omt * t * mX + t * t * sKx,
                    py: yc,
                    pz: omt * omt * sJz + 2 * omt * t * mZ + t * t * sKz,
                  });
                }
                ring.push({ px: sKx, py: (pK.py + yc) * 0.5, pz: sKz });
              } else {
                // Acute 45 deg fork: clamp inner corner cleanly onto bisector so arms never cross
                const clipR = Math.min(0.62, Math.min(pJ.dist, pK.dist) / Math.max(0.5, Math.cos(dPhi * 0.5)));
                ring.push({
                  px: x + bx * clipR,
                  py: (pJ.py + pK.py + yc) / 3,
                  pz: z + bz * clipR,
                });
              }
            }

            ring.push({ px: eKInX, py: pK.py, pz: eKInZ });
          }

          return ring;
        };

        const emitFan = (
          buf: MeshBufferAcc,
          ring: { px: number; py: number; pz: number }[],
          yOff: number,
          r: number,
          g: number,
          b: number,
          skirtDepth = 0
        ) => {
          for (let k = 0; k < ring.length; k++) {
            const p0 = ring[k];
            const p1 = ring[(k + 1) % ring.length];
            const cross = (p0.px - x) * (p1.pz - z) - (p0.pz - z) * (p1.px - x);
            if (Math.abs(cross) < 1e-6) continue;
            buf.pushTriUp(
              x,
              yc + yOff,
              z,
              0.5,
              0.5,
              p0.px,
              p0.py + yOff,
              p0.pz,
              (p0.px - x) * 1.45 + 0.5,
              (p0.pz - z) * 1.45 + 0.5,
              p1.px,
              p1.py + yOff,
              p1.pz,
              (p1.px - x) * 1.45 + 0.5,
              (p1.pz - z) * 1.45 + 0.5,
              r,
              g,
              b
            );
            if (skirtDepth > 0 && Math.hypot(p0.px - p1.px, p0.pz - p1.pz) > 1e-4) {
              // Add curb edge drop only on segments not lying on cell boundary ports
              const onPortEdge = Math.abs(Math.abs(p0.px - x) - 0.5) < 0.02 && Math.abs(Math.abs(p1.px - x) - 0.5) < 0.02
                || Math.abs(Math.abs(p0.pz - z) - 0.5) < 0.02 && Math.abs(Math.abs(p1.pz - z) - 0.5) < 0.02;
              if (!onPortEdge) {
                buf.pushSideWall(
                  p0.px,
                  p0.py + yOff,
                  p0.py + yOff - skirtDepth,
                  p0.pz,
                  p1.px,
                  p1.py + yOff,
                  p1.py + yOff - skirtDepth,
                  p1.pz,
                  r * 0.72,
                  g * 0.72,
                  b * 0.72
                );
              }
            }
          }
        };

        if (tier !== RoadTier.Highway6L || isBridge) {
          emitFan(sidewalkBuf, buildHubPerimeter(true), 0.048, cr, cg, cb, isBridge ? 0.14 : 0.05);
        }
        emitFan(asphaltBuf, buildHubPerimeter(false), 0.07, ar, ag, ab, isBridge ? 0.16 : 0.02);

        // Zebra crosswalk stripes on orthogonal main approaches of intersections
        if (tier !== RoadTier.Highway6L) {
          for (const p of ports) {
            if (p.diag) continue;
            const nx = -p.uz;
            const nz = p.ux;
            const cx = x + p.ux * 0.36;
            const cz = z + p.uz * 0.36;
            const cy = yc + (p.py - yc) * 0.72 + 0.08;
            const stripeHalfLen = 0.055;
            const stripeHalfW = 0.022;
            const maxSpan = p.asphaltW * 0.74;

            for (let off = -maxSpan + 0.05; off <= maxSpan - 0.04; off += 0.1) {
              const sx = cx + nx * off;
              const sz = cz + nz * off;
              markingsBuf.pushQuadUp(
                sx - nx * stripeHalfW - p.ux * stripeHalfLen,
                cy,
                sz - nz * stripeHalfW - p.uz * stripeHalfLen,
                0,
                0,
                sx + nx * stripeHalfW - p.ux * stripeHalfLen,
                cy,
                sz + nz * stripeHalfW - p.uz * stripeHalfLen,
                1,
                0,
                sx + nx * stripeHalfW + p.ux * stripeHalfLen,
                cy,
                sz + nz * stripeHalfW + p.uz * stripeHalfLen,
                1,
                1,
                sx - nx * stripeHalfW + p.ux * stripeHalfLen,
                cy,
                sz - nz * stripeHalfW + p.uz * stripeHalfLen,
                0,
                1,
                0.96,
                0.98,
                1.0
              );
            }
          }
        }
      }

      const endAsphaltVertex = asphaltBuf.vertexCount;
      if (endAsphaltVertex > startAsphaltVertex) {
        asphaltCellRanges.push({
          cellIdx: i,
          startVertex: startAsphaltVertex,
          vertexCount: endAsphaltVertex - startAsphaltVertex,
          baseR: ar,
          baseG: ag,
          baseB: ab,
        });
      }
    }
  }

  return {
    sidewalkGeo: sidewalkBuf.toBufferGeometry(),
    asphaltGeo: asphaltBuf.toBufferGeometry(),
    markingsGeo: markingsBuf.toBufferGeometry(),
    asphaltCellRanges,
  };
}

/**
 * Generates a smooth continuous curved ribbon BufferGeometry for live road drag preview.
 */
export function buildRoadPreviewRibbonGeometry(
  eng: CityEngine,
  path: { x: number; z: number }[],
  tier: RoadTier
): THREE.BufferGeometry {
  const buf = new MeshBufferAcc();
  const hw = getSpec(tier).asphaltHalfW + 0.06;

  if (path.length === 0) {
    return buf.toBufferGeometry();
  }

  if (path.length === 1) {
    const p = path[0];
    const y = getRoadBaseY(eng, p.x, p.z) + 0.14;
    const segs = 12;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      buf.pushTriUp(
        p.x,
        y,
        p.z,
        0.5,
        0.5,
        p.x + Math.cos(a0) * hw,
        y,
        p.z + Math.sin(a0) * hw,
        0,
        1,
        p.x + Math.cos(a1) * hw,
        y,
        p.z + Math.sin(a1) * hw,
        1,
        1,
        1,
        1,
        1
      );
    }
    return buf.toBufferGeometry();
  }

  for (let k = 0; k < path.length; k++) {
    const cur = path[k];
    const yc = getRoadBaseY(eng, cur.x, cur.z) + 0.13;
    const prev = k > 0 ? path[k - 1] : null;
    const next = k < path.length - 1 ? path[k + 1] : null;

    const p0x = prev ? (prev.x + cur.x) * 0.5 : cur.x;
    const p0y = prev ? ((getRoadBaseY(eng, prev.x, prev.z) + 0.13 + yc) * 0.5) : yc;
    const p0z = prev ? (prev.z + cur.z) * 0.5 : cur.z;

    const p2x = next ? (cur.x + next.x) * 0.5 : cur.x;
    const p2y = next ? ((yc + getRoadBaseY(eng, next.x, next.z) + 0.13) * 0.5) : yc;
    const p2z = next ? (cur.z + next.z) * 0.5 : cur.z;

    const samples = sampleQuadBezierRibbon(p0x, p0y, p0z, cur.x, yc, cur.z, p2x, p2y, p2z, prev && next ? 7 : 2);
    emitRibbonLayer(buf, samples, 0, 0, hw, hw, hw, 1, 1, 1);
  }

  return buf.toBufferGeometry();
}

/**
 * Evaluates a continuous Quadratic Bezier trajectory through a road cell so vehicles glide around 90° and 135° curves smoothly.
 */
export function sampleVehicleBezierPose(
  eng: CityEngine,
  cellX: number,
  cellZ: number,
  inDirIdx: number,
  outDirIdx: number,
  t: number,
  laneOffset: number
): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const yc = getRoadBaseY(eng, cellX, cellZ) + 0.085;
  const outD = DIR_OFFSETS[Math.max(0, Math.min(7, outDirIdx))];

  let p0x = cellX;
  let p0y = yc;
  let p0z = cellZ;
  if (inDirIdx >= 0 && inDirIdx < DIR_OFFSETS.length) {
    const inD = DIR_OFFSETS[inDirIdx];
    const ax = cellX + inD.dx;
    const az = cellZ + inD.dz;
    const ya = eng.inBounds(ax, az) ? getRoadBaseY(eng, ax, az) + 0.085 : yc;
    p0x = cellX + inD.dx * 0.5;
    p0y = (yc + ya) * 0.5;
    p0z = cellZ + inD.dz * 0.5;
  }

  const bx = cellX + outD.dx;
  const bz = cellZ + outD.dz;
  const yb = eng.inBounds(bx, bz) ? getRoadBaseY(eng, bx, bz) + 0.085 : yc;
  const p2x = cellX + outD.dx * 0.5;
  const p2y = (yc + yb) * 0.5;
  const p2z = cellZ + outD.dz * 0.5;

  const clampedT = Math.max(0, Math.min(1, t));
  const omt = 1 - clampedT;

  const cx = omt * omt * p0x + 2 * omt * clampedT * cellX + clampedT * clampedT * p2x;
  const cy = omt * omt * p0y + 2 * omt * clampedT * yc + clampedT * clampedT * p2y;
  const cz = omt * omt * p0z + 2 * omt * clampedT * cellZ + clampedT * clampedT * p2z;

  let tx = 2 * omt * (cellX - p0x) + 2 * clampedT * (p2x - cellX);
  const ty = 2 * omt * (yc - p0y) + 2 * clampedT * (p2y - yc);
  let tz = 2 * omt * (cellZ - p0z) + 2 * clampedT * (p2z - cellZ);

  const horizLen = Math.hypot(tx, tz);
  if (horizLen < 1e-4) {
    tx = outD.dx;
    tz = outD.dz;
  }

  const safeHoriz = Math.hypot(tx, tz) || 1;
  const ux = tx / safeHoriz;
  const uz = tz / safeHoriz;

  // Right-hand lane offset perpendicular to forward tangent (ux, uz)
  const rightX = -uz;
  const rightZ = ux;

  return {
    x: cx + rightX * laneOffset,
    y: cy,
    z: cz + rightZ * laneOffset,
    yaw: Math.atan2(ux, uz),
    pitch: -Math.atan2(ty, safeHoriz),
  };
}
