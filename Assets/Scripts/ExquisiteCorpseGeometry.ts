// ExquisiteCorpseGeometry.ts
//
// OWNS: the pure geometry of the game — 2D canvas-space types, polyline
// clipping against a band rect, and the neon ribbon mesh construction.
//
// This is where the game's central rule lives: a stroke is CLIPPED, never
// masked. The seam a player sees is a genuinely different, shorter polyline
// built from the previous band's stroke data — there is no hidden geometry
// sitting offscreen waiting to be revealed.
//
// EXPECTS: nothing. Pure functions plus one mesh writer. No scene access, no
// component lifecycle, no game state.
//
// MUST NOT: read game state, touch SceneObjects, or know about turns.

/** A point in canvas-local 2D space. Centimetres, origin at canvas centre. */
export interface Vec2Cm {
  x: number
  y: number
}

/** An axis-aligned region of the canvas, in canvas-local centimetres. */
export interface BandRect {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** One captured stroke: an ordered polyline plus the player who drew it. */
export interface Stroke {
  playerIndex: number
  points: Vec2Cm[]
}

const EPS = 1e-4

function lerpPt(a: Vec2Cm, b: Vec2Cm, t: number): Vec2Cm {
  return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}
}

function samePt(a: Vec2Cm, b: Vec2Cm): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

function pointInRect(p: Vec2Cm, r: BandRect): boolean {
  return p.x >= r.minX - EPS && p.x <= r.maxX + EPS && p.y >= r.minY - EPS && p.y <= r.maxY + EPS
}

/**
 * Liang-Barsky clip of one segment to the rect.
 * Returns the surviving sub-segment, or null when the segment misses entirely.
 */
function clipSegment(p0: Vec2Cm, p1: Vec2Cm, r: BandRect): {a: Vec2Cm; b: Vec2Cm} | null {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y

  const P = [-dx, dx, -dy, dy]
  const Q = [p0.x - r.minX, r.maxX - p0.x, p0.y - r.minY, r.maxY - p0.y]

  let t0 = 0
  let t1 = 1

  for (let i = 0; i < 4; i++) {
    if (Math.abs(P[i]) < EPS) {
      // Parallel to this edge: reject only if it starts outside it.
      if (Q[i] < 0) return null
      continue
    }
    const t = Q[i] / P[i]
    if (P[i] < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }

  return {a: lerpPt(p0, p1, t0), b: lerpPt(p0, p1, t1)}
}

/**
 * Clip a polyline to a rect, returning the surviving runs.
 *
 * A gesture that drifts out of the player's band and back in yields TWO runs
 * rather than being rejected — that is the "clip the stroke at the boundary
 * rather than rejecting the whole stroke" rule from the spec.
 */
export function clipPolyline(points: Vec2Cm[], r: BandRect): Vec2Cm[][] {
  if (points.length === 0) return []
  if (points.length === 1) {
    return pointInRect(points[0], r) ? [[points[0]]] : []
  }

  const runs: Vec2Cm[][] = []
  let current: Vec2Cm[] | null = null

  for (let i = 0; i < points.length - 1; i++) {
    const clipped = clipSegment(points[i], points[i + 1], r)
    if (!clipped) {
      if (current) {
        runs.push(current)
        current = null
      }
      continue
    }
    if (current && samePt(current[current.length - 1], clipped.a)) {
      current.push(clipped.b)
    } else {
      if (current) runs.push(current)
      current = [clipped.a, clipped.b]
    }
  }
  if (current) runs.push(current)

  return runs
}

/** Clip every stroke in a list, flattening to runs tagged with their player. */
export function clipStrokes(strokes: Stroke[], r: BandRect): Stroke[] {
  const out: Stroke[] = []
  for (const s of strokes) {
    for (const run of clipPolyline(s.points, r)) {
      out.push({playerIndex: s.playerIndex, points: run})
    }
  }
  return out
}

/**
 * Break a polyline into dashes of `dashCm` separated by `gapCm`.
 *
 * Walks by arc length rather than per-segment so dashes stay an even length
 * across corners — a per-segment approach restarts the pattern at every vertex
 * and makes rectangle corners look ragged.
 */
export function dashPolyline(points: Vec2Cm[], dashCm: number, gapCm: number): Vec2Cm[][] {
  if (points.length < 2 || dashCm <= 0 || gapCm <= 0) return points.length ? [points] : []

  const period = dashCm + gapCm
  const out: Vec2Cm[][] = []
  let current: Vec2Cm[] | null = null
  let travelled = 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (segLen < EPS) continue

    let done = 0
    while (done < segLen) {
      const phase = travelled % period
      const inDash = phase < dashCm
      const remainingInPhase = inDash ? dashCm - phase : period - phase
      const step = Math.min(remainingInPhase, segLen - done)

      const t0 = done / segLen
      const t1 = (done + step) / segLen
      const p0 = {x: a.x + dx * t0, y: a.y + dy * t0}
      const p1 = {x: a.x + dx * t1, y: a.y + dy * t1}

      if (inDash) {
        if (current && samePt(current[current.length - 1], p0)) current.push(p1)
        else {
          if (current) out.push(current)
          current = [p0, p1]
        }
      } else if (current) {
        out.push(current)
        current = null
      }

      done += step
      travelled += step
    }
  }
  if (current) out.push(current)
  return out
}

// ── Ribbon construction ──────────────────────────────────────────────────────

/** Vertex layout consumed by buildRibbon: position(3) + color(4). */
export const RIBBON_LAYOUT = [
  {name: "position", components: 3},
  {name: "color", components: 4}
]

/** Maps a canvas-local 2D point to a world-space position. */
export type PlacePoint = (p: Vec2Cm) => vec3

export interface RibbonStyle {
  /** Half-width of the bright core, in centimetres. */
  coreHalfCm: number
  /** Half-width of the outer glow falloff, in centimetres. */
  glowHalfCm: number
  /** Brightness multiplier applied to the whole ribbon. */
  intensity: number
  /** How far the core is pushed toward white, 0..1. Gives neon its hot centre. */
  coreWhiteness: number
}

interface Accum {
  verts: number[]
  indices: number[]
  vertexCount: number
}

function normalize2(x: number, y: number): Vec2Cm {
  const len = Math.sqrt(x * x + y * y)
  if (len < EPS) return {x: 0, y: 0}
  return {x: x / len, y: y / len}
}

/**
 * Append one polyline to the accumulator as a 5-column ribbon.
 *
 * Columns run [-glow, -core, 0, +core, +glow] across the stroke, with vertex
 * colour fading to fully transparent at the outer columns. Under an additive
 * material that gradient IS the glow — no second pass, no post-process, and
 * one draw call for the whole band.
 *
 * Joins use averaged adjacent normals (a miter) so consecutive quads share
 * their edge vertices exactly. Overlapping quads would double-brighten at
 * every joint under additive blending, which reads as a beaded line.
 */
function appendPolyline(
  acc: Accum,
  pts: Vec2Cm[],
  color: vec4,
  style: RibbonStyle,
  place: PlacePoint
): void {
  if (pts.length === 0) return

  // A single tap becomes a tiny horizontal dash so it still renders.
  let p = pts
  if (p.length === 1) {
    const d = style.coreHalfCm * 0.75
    p = [
      {x: pts[0].x - d, y: pts[0].y},
      {x: pts[0].x + d, y: pts[0].y}
    ]
  }

  const n = p.length
  const base = acc.vertexCount

  const inten = style.intensity
  const w = style.coreWhiteness
  const cr = (color.r + (1 - color.r) * w) * inten
  const cg = (color.g + (1 - color.g) * w) * inten
  const cb = (color.b + (1 - color.b) * w) * inten
  const er = color.r * inten
  const eg = color.g * inten
  const eb = color.b * inten

  const offsets = [-style.glowHalfCm, -style.coreHalfCm, 0, style.coreHalfCm, style.glowHalfCm]
  const cols: number[][] = [
    [0, 0, 0, 0],
    [er, eg, eb, 1],
    [cr, cg, cb, 1],
    [er, eg, eb, 1],
    [0, 0, 0, 0]
  ]

  for (let i = 0; i < n; i++) {
    let tx: number
    let ty: number
    if (i === 0) {
      tx = p[1].x - p[0].x
      ty = p[1].y - p[0].y
    } else if (i === n - 1) {
      tx = p[n - 1].x - p[n - 2].x
      ty = p[n - 1].y - p[n - 2].y
    } else {
      const a = normalize2(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
      const b = normalize2(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y)
      tx = a.x + b.x
      ty = a.y + b.y
      if (Math.abs(tx) < EPS && Math.abs(ty) < EPS) {
        tx = a.x
        ty = a.y
      }
    }
    const t = normalize2(tx, ty)
    // In-plane perpendicular.
    const nx = -t.y
    const ny = t.x

    for (let c = 0; c < 5; c++) {
      const off = offsets[c]
      const world = place({x: p[i].x + nx * off, y: p[i].y + ny * off})
      const col = cols[c]
      acc.verts.push(world.x, world.y, world.z, col[0], col[1], col[2], col[3])
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 5
    const b = base + (i + 1) * 5
    for (let c = 0; c < 4; c++) {
      acc.indices.push(a + c, b + c, b + c + 1)
      acc.indices.push(a + c, b + c + 1, a + c + 1)
    }
  }

  acc.vertexCount += n * 5
}

/**
 * Rebuild `builder` so it contains exactly `strokes`, rendered as neon ribbons.
 *
 * `colorFor` resolves a player index to their stroke colour. `place` maps
 * canvas-local centimetres to world space.
 */
export function rebuildRibbonMesh(
  builder: MeshBuilder,
  strokes: Stroke[],
  style: RibbonStyle,
  colorFor: (playerIndex: number) => vec4,
  place: PlacePoint,
  styleFor?: (playerIndex: number) => RibbonStyle
): void {
  const vCount = builder.getVerticesCount()
  if (vCount > 0) builder.eraseVertices(0, vCount)
  const iCount = builder.getIndicesCount()
  if (iCount > 0) builder.eraseIndices(0, iCount)

  const acc: Accum = {verts: [], indices: [], vertexCount: 0}
  for (const s of strokes) {
    // styleFor lets one mesh mix widths — the band outlines use it so the
    // active band's frame is genuinely thicker, not merely brighter.
    const st = styleFor ? styleFor(s.playerIndex) : style
    appendPolyline(acc, s.points, colorFor(s.playerIndex), st, place)
  }

  if (acc.vertexCount > 0) {
    builder.appendVerticesInterleaved(acc.verts)
    builder.appendIndices(acc.indices)
  }
  builder.updateMesh()
}

/**
 * Take a prefix of a stroke list totalling `budget` points, for the replay
 * draw-on animation. The final partial stroke is truncated mid-polyline so the
 * line grows from its start rather than popping in whole.
 */
export function takePointPrefix(strokes: Stroke[], budget: number): Stroke[] {
  const out: Stroke[] = []
  let remaining = Math.max(0, Math.floor(budget))
  for (const s of strokes) {
    if (remaining <= 0) break
    if (s.points.length <= remaining) {
      out.push(s)
      remaining -= s.points.length
    } else {
      out.push({playerIndex: s.playerIndex, points: s.points.slice(0, remaining)})
      remaining = 0
    }
  }
  return out
}

/** Total point count across a stroke list. Drives the replay timeline. */
export function totalPoints(strokes: Stroke[]): number {
  let n = 0
  for (const s of strokes) n += s.points.length
  return n
}

// ── Bringing the corpse to life ───────────────────────────────────────────────

/** One stroke's shape summary, used to guess which marks are facial features. */
interface StrokeShape {
  index: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  cx: number
  cy: number
  width: number
  height: number
  arcLength: number
  /** 1 = the stroke ends where it started; 0 = it ends a whole arc-length away. */
  closure: number
}

export interface FaceParts {
  /** Indices into the stroke array. Eyes are always a pair or absent. */
  eyes: number[]
  mouth: number
  /** The stroke taken to be the head's outline, or -1 if none stands out. */
  outline: number
  /**
   * Strokes lying mostly OUTSIDE the outline — hair, ears, antennae, whatever
   * sticks out. Given a looser animation than the head itself.
   */
  outside: number[]
}

/** Even-odd ray cast. The polyline is treated as closed by its final edge. */
function pointInPolygon(p: Vec2Cm, poly: Vec2Cm[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y
    const yj = poly[j].y
    // Short-circuits before the divide whenever the edge is horizontal.
    if (yi > p.y !== yj > p.y) {
      const xi = poly[i].x
      const xj = poly[j].x
      if (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function shapeOf(s: Stroke, index: number): StrokeShape {
  const p = s.points
  let minX = p[0].x
  let maxX = p[0].x
  let minY = p[0].y
  let maxY = p[0].y
  let arc = 0
  for (let i = 0; i < p.length; i++) {
    if (p[i].x < minX) minX = p[i].x
    if (p[i].x > maxX) maxX = p[i].x
    if (p[i].y < minY) minY = p[i].y
    if (p[i].y > maxY) maxY = p[i].y
    if (i > 0) {
      const dx = p[i].x - p[i - 1].x
      const dy = p[i].y - p[i - 1].y
      arc += Math.sqrt(dx * dx + dy * dy)
    }
  }
  const gapX = p[p.length - 1].x - p[0].x
  const gapY = p[p.length - 1].y - p[0].y
  const gap = Math.sqrt(gapX * gapX + gapY * gapY)
  return {
    index: index,
    minX: minX,
    maxX: maxX,
    minY: minY,
    maxY: maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
    arcLength: arc,
    closure: arc > EPS ? Math.max(0, 1 - gap / arc) : 0
  }
}

/**
 * Guess which strokes in a band are eyes and a mouth.
 *
 * Deliberately NOT a trained detector. A face model expects photographs; a
 * handful of glowing polylines on nothing is far outside anything it was fitted
 * to. Working from the vector data instead is both cheaper and more honest
 * about what is actually knowable — and this band is prompted "Draw a Head", so
 * the prior is unusually strong.
 *
 * It will misfire, and that is fine. A spiral confidently read as an eye is
 * funnier than a correct answer, and the whole game is built on accidents. The
 * only failure that costs anything is finding nothing, so the caller must have
 * something to fall back on.
 */
export function detectFace(strokes: Stroke[], band: BandRect): FaceParts {
  const none: FaceParts = {eyes: [], mouth: -1, outline: -1, outside: []}
  if (strokes.length === 0) return none

  const bandW = band.maxX - band.minX
  const bandH = band.maxY - band.minY
  const shapes: StrokeShape[] = []
  for (let i = 0; i < strokes.length; i++) {
    if (strokes[i].points.length >= 3) shapes.push(shapeOf(strokes[i], i))
  }

  // Eye candidates: small, closed-ish, not a sliver, in the upper part of the band.
  const cands = shapes.filter((s) => {
    const smallEnough = s.width < bandW * 0.34 && s.height < bandH * 0.34
    const bigEnough = s.width > bandW * 0.015 && s.height > bandH * 0.015
    const aspect = s.height > EPS ? s.width / s.height : 99
    return (
      smallEnough &&
      bigEnough &&
      s.closure > 0.55 &&
      aspect > 0.3 &&
      aspect < 3.2 &&
      s.cy > band.minY + bandH * 0.35
    )
  })

  let eyes: number[] = []
  let best = Number.MAX_VALUE
  let eyeY = 0
  let eyeW = 0
  let eyeSpan = 0
  let eyeMidX = 0
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i]
      const b = cands[j]
      const avgW = (a.width + b.width) / 2
      const avgH = (a.height + b.height) / 2
      const dx = Math.abs(a.cx - b.cx)
      const dy = Math.abs(a.cy - b.cy)
      const areaA = Math.max(EPS, a.width * a.height)
      const areaB = Math.max(EPS, b.width * b.height)
      const areaRatio = Math.max(areaA, areaB) / Math.min(areaA, areaB)

      // Level with each other, similar in size, and set apart by a plausible
      // number of eye-widths.
      if (dy > avgH * 0.8) continue
      if (areaRatio > 3.0) continue
      if (dx < avgW * 0.7 || dx > avgW * 5.0) continue

      // Prefer the most level, most evenly matched pair.
      const score = dy / Math.max(EPS, avgH) + (areaRatio - 1) * 0.5
      if (score < best) {
        best = score
        eyes = [a.index, b.index]
        eyeY = (a.cy + b.cy) / 2
        eyeW = avgW
        eyeSpan = dx
        eyeMidX = (a.cx + b.cx) / 2
      }
    }
  }

  // Mouth. NOT simply the widest flat stroke below the eyes — a big horizontal
  // scribble across the head beats a real mouth on width every time. Score
  // against the eyes instead: a mouth is roughly as wide as they are apart,
  // sits under their midpoint, and is flat.
  let mouth = -1
  let bestMouth = Number.MAX_VALUE
  // Only look for a mouth once there are eyes to anchor it. A lone horizontal
  // stroke pulsing open and shut with no face around it reads as a glitch
  // rather than a joke.
  const span = Math.max(EPS, eyeSpan)
  const midX = eyeMidX

  for (const s of (eyes.length === 2 ? shapes : [])) {
    if (eyes.indexOf(s.index) !== -1) continue
    if (s.cy >= eyeY) continue
    if (s.width < s.height * 1.05) continue
    // A stroke far wider than the eyes are apart is a body line, not a mouth.
    if (s.width < span * 0.35 || s.width > span * 2.6) continue

    const widthErr = Math.abs(s.width - span) / span
    const offCentre = Math.abs(s.cx - midX) / span
    const flatness = s.height / Math.max(EPS, s.width)
    const score = widthErr + offCentre * 1.5 + flatness
    if (score < bestMouth) {
      bestMouth = score
      mouth = s.index
    }
  }

  // Head outline: the biggest closed-ish stroke that is not already spoken for.
  // Whatever falls outside it is most likely hair, and if it is not, a bit of
  // extra movement out there costs nothing.
  let outline = -1
  let outlineArea = 0
  for (const s of shapes) {
    if (eyes.indexOf(s.index) !== -1 || s.index === mouth) continue
    const area = s.width * s.height
    if (s.closure < 0.45) continue
    if (s.width < bandW * 0.18 && s.height < bandH * 0.18) continue
    if (area > outlineArea) {
      outlineArea = area
      outline = s.index
    }
  }

  const outside: number[] = []
  if (outline >= 0) {
    const poly = strokes[outline].points
    for (const s of shapes) {
      if (s.index === outline) continue
      if (eyes.indexOf(s.index) !== -1 || s.index === mouth) continue
      const pts = strokes[s.index].points
      let within = 0
      for (const q of pts) if (pointInPolygon(q, poly)) within++
      // Majority rules, so a strand crossing the edge still counts as hair.
      if (within * 2 < pts.length) outside.push(s.index)
    }
  }

  return {eyes: eyes, mouth: mouth, outline: outline, outside: outside}
}

/** How the finished corpse moves while it is on show. */
export interface LifeParams {
  /** Seconds since the reveal began. */
  time: number

  /** Peak tilt either side of upright, in degrees. */
  tiltDegrees: number
  /** Tilts per second. */
  tiltSpeed: number
  /** Height the tilt pivots about, in canvas-local cm — the foot of the body. */
  pivotY: number

  /** Per-stroke ripple, in centimetres. Zero leaves a band perfectly rigid. */
  rippleCm: number
  /** Centimetres along a stroke for one full ripple. */
  rippleWavelengthCm: number
  /** Ripples per second. */
  rippleSpeed: number
}

/**
 * Animate the finished drawing: a whole-body lean, plus an optional per-stroke
 * ripple on top.
 *
 * The lean is a RIGID ROTATION about a pivot at the foot of the canvas, so the
 * creature tilts as one piece the way a standing body would. An earlier version
 * displaced points sideways in proportion to their height, which sounds similar
 * but shears the drawing instead of turning it — the head slid across while the
 * feet stayed put, and nothing ever actually leaned.
 *
 * Being a rigid transform, it also cannot pull the bands apart at the folds:
 * every point moves under the same rotation.
 *
 * Returns fresh strokes; the committed originals are never touched, so undo and
 * the draw-on both keep working from clean data.
 */
export function animateStrokes(strokes: Stroke[], p: LifeParams): Stroke[] {
  const theta = (p.tiltDegrees * Math.PI) / 180 * Math.sin(p.time * p.tiltSpeed * Math.PI * 2)
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  const out: Stroke[] = []

  for (let s = 0; s < strokes.length; s++) {
    const src = strokes[s].points
    if (src.length < 2) {
      out.push(strokes[s])
      continue
    }
    // Offset each stroke's ripple phase so they do not pulse in lockstep.
    const seed = (s * 2.399963) % (Math.PI * 2)
    const pts: Vec2Cm[] = []
    let arc = 0

    for (let i = 0; i < src.length; i++) {
      if (i > 0) {
        const dx = src[i].x - src[i - 1].x
        const dy = src[i].y - src[i - 1].y
        arc += Math.sqrt(dx * dx + dy * dy)
      }

      // Rotate about (0, pivotY): the foot of the body, on the centre line.
      const rx = src[i].x
      const ry = src[i].y - p.pivotY
      let x = rx * ct - ry * st
      let y = p.pivotY + rx * st + ry * ct

      if (p.rippleCm > EPS) {
        const prev = src[Math.max(0, i - 1)]
        const next = src[Math.min(src.length - 1, i + 1)]
        let tx = next.x - prev.x
        let ty = next.y - prev.y
        const len = Math.sqrt(tx * tx + ty * ty)
        if (len > EPS) {
          tx /= len
          ty /= len
          const phase =
            seed + p.time * p.rippleSpeed * Math.PI * 2 + arc / Math.max(EPS, p.rippleWavelengthCm)
          const d = Math.sin(phase) * p.rippleCm
          x += -ty * d
          y += tx * d
        }
      }

      pts.push({x: x, y: y})
    }
    out.push({playerIndex: strokes[s].playerIndex, points: pts})
  }
  return out
}

/** Scale a stroke vertically about its own centre — used to work the mouth. */
export function scaleStrokeY(s: Stroke, factor: number): Stroke {
  let minY = s.points[0].y
  let maxY = s.points[0].y
  for (const q of s.points) {
    if (q.y < minY) minY = q.y
    if (q.y > maxY) maxY = q.y
  }
  const cy = (minY + maxY) / 2
  const pts: Vec2Cm[] = []
  for (const q of s.points) pts.push({x: q.x, y: cy + (q.y - cy) * factor})
  return {playerIndex: s.playerIndex, points: pts}
}
