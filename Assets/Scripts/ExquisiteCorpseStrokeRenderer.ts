// ExquisiteCorpseStrokeRenderer.ts
//
// OWNS: every visible stroke. Holds the committed stroke data per band, the
// per-player colours, the additive neon material, and the mesh objects.
//
// Design note: one merged mesh per band (plus one for the live stroke and one
// for the seam) rather than one per stroke. A three-player drawing is then
// ~5 draw calls no matter how many strokes were made, and show/hide of a whole
// band is a single `enabled` flip.
//
// The seam mesh is built from CLIPPED polylines, not from the full band with a
// mask over it. Nothing but the seam ever exists in that mesh.
//
// EXPECTS: @inputs below, plus setCanvas() from Main before first use.
//
// MUST NOT: read input, run the turn order, or decide what should be visible.
// It is told which band is active and what to show.

import {
  RIBBON_LAYOUT,
  RibbonStyle,
  Stroke,
  Vec2Cm,
  FaceParts,
  LifeParams,
  animateStrokes,
  clipPolyline,
  clipStrokes,
  dashPolyline,
  detectFace,
  scaleStrokeY,
  rebuildRibbonMesh,
  takePointPrefix,
  totalPoints
} from "./ExquisiteCorpseGeometry"
import {ExquisiteCorpseCanvasController} from "./ExquisiteCorpseCanvasController"

/** Number of palette slots. Matches the paletteColor inputs below. */
export const PALETTE_SIZE = 6

const NEON_MATERIAL_ID = "70d03593-c7b4-410a-ae5c-75cb82ee32dc" // vertexBaseColorMaterial

interface BandMesh {
  root: SceneObject
  rmv: RenderMeshVisual
  builder: MeshBuilder
}

@component
export class ExquisiteCorpseStrokeRenderer extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Stroke Renderer – neon ribbons, one mesh per band</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Additive vertex-colour material used for every stroke. From the SimpleVertexBaseColor package.")
  neonMaterial!: Material
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Width of the bright core of a stroke, in centimetres. Keep thin for detail.")
  @widget(new SliderWidget(0.1, 3.0, 0.05))
  strokeWidthCm: number = 0.45

  @input
  @hint("How far the soft glow extends beyond the core, as a multiple of the core width.")
  @widget(new SliderWidget(1.2, 10.0, 0.1))
  glowSpread: number = 4.2

  @input
  @hint("Overall emissive brightness of the strokes. The material is additive, so this is literally how much light each stroke throws.")
  @widget(new SliderWidget(0.2, 4.0, 0.05))
  glowIntensity: number = 1.7

  @input
  @hint("Draw the canvas guides: one solid outline around the whole canvas, plus a thin dashed line at each fold.")
  showCanvasGuides: boolean = true

  @input
  @hint("Thickness of the solid outline around the whole canvas, in centimetres.")
  @widget(new SliderWidget(0.05, 1.5, 0.01))
  canvasOutlineWidthCm: number = 0.42

  @input
  @hint("Thickness of the dashed fold lines, in centimetres. Kept thin so they read as creases, not as drawing.")
  @widget(new SliderWidget(0.03, 0.8, 0.01))
  foldLineWidthCm: number = 0.12

  @input
  @hint("Dash length of the fold lines in centimetres. The gap is half this.")
  @widget(new SliderWidget(0.5, 12, 0.5))
  foldDashCm: number = 2.5

  @input
  @hint("Brightness of the canvas guides. Keep low so they never compete with the drawing.")
  @widget(new SliderWidget(0.05, 2.0, 0.05))
  guideBrightness: number = 0.7

  @input
  @hint("Length of each leg of the corner brackets marking the ACTIVE band, in centimetres. Clamped so opposite arms can never join into a full box.")
  @widget(new SliderWidget(1, 20, 0.5))
  activeCornerArmCm: number = 6

  @input
  @hint("Line weight of the active-band corner brackets, in centimetres.")
  @widget(new SliderWidget(0.05, 1.5, 0.02))
  activeCornerWidthCm: number = 0.34

  @input
  @hint("How far OUTSIDE the band edge the corner brackets sit, in centimetres. For brackets that just touch the canvas line without overlapping it, use half of each line's width added together — (Canvas Outline Width + Active Corner Width) / 2. Keep above zero: band 0 shares three edges with the canvas outline, so at zero its brackets are drawn underneath it and vanish.")
  @widget(new SliderWidget(0, 8, 0.02))
  activeCornerOutsetCm: number = 0.38

  @input("vec4", "{0.0, 0.85, 1.0, 0.75}")
  @hint("Colour of the active-band corner brackets. Specs is additive, so the alpha channel cannot make them see-through the way it would on an opaque display — it is folded into brightness instead, which is what reads as semi-transparent here.")
  @widget(new ColorWidget())
  activeCornerColor: vec4 = new vec4(0.0, 0.85, 1.0, 0.75)

  @ui.separator
  @input
  @hint("Peak lean either side of upright, in degrees. The whole drawing rotates about its FOOT, so it tips like a standing body — the head travels furthest, the feet stay planted. Bias it larger than looks right up close; it reads as subtle from across a room.")
  @widget(new SliderWidget(0, 8, 0.1))
  tiltDegrees: number = 1.2

  @input
  @hint("Leans per second. One full back-and-forth is a whole cycle, so low values read as slow breathing.")
  @widget(new SliderWidget(0.02, 1, 0.01))
  tiltSpeed: number = 0.16

  @input
  @hint("Seconds the movement takes to ease up from a standstill. Without this the drawing jumps on its first animated frame, since the lean is mid-swing at time zero.")
  @widget(new SliderWidget(0, 5, 0.1))
  lifeRampSeconds: number = 1.6

  @ui.separator
  @input
  @hint("Base per-stroke ripple, in centimetres. The three multipliers below scale it per body part.")
  @widget(new SliderWidget(0, 3, 0.05))
  breathAmplitudeCm: number = 0.7

  @input
  @hint("Ripple on the HEAD, as a multiple of the base. Zero by default: the head reads best swaying as one rigid piece, so the face holds together.")
  @widget(new SliderWidget(0, 2, 0.05))
  headRipple: number = 0

  @input
  @hint("Ripple on anything OUTSIDE the head's outline — most likely hair, ears or antennae. Highest of the lot, since loose strands are what should move most.")
  @widget(new SliderWidget(0, 3, 0.05))
  hairRipple: number = 1.6

  @input
  @hint("Ripple on the TORSO (any middle band), as a multiple of the base.")
  @widget(new SliderWidget(0, 2, 0.05))
  torsoRipple: number = 0.55

  @input
  @hint("Ripple on the LEGS (the bottom band), as a multiple of the base.")
  @widget(new SliderWidget(0, 2, 0.05))
  legsRipple: number = 1.0

  @input
  @hint("Centimetres along a stroke for one full ripple. Smaller makes a line shimmer; larger makes it undulate.")
  @widget(new SliderWidget(2, 60, 1))
  breathWavelengthCm: number = 26

  @input
  @hint("Ripples per second.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  breathSpeed: number = 0.28

  @input
  @hint("How far the mouth opens and closes, as a fraction of its own height.")
  @widget(new SliderWidget(0, 2, 0.05))
  mouthOpenAmount: number = 0.7

  @input
  @hint("Mouth movements per second.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  mouthSpeed: number = 0.22

  @input
  @hint("How long an eye stays shut, in seconds.")
  @widget(new SliderWidget(0.04, 0.5, 0.01))
  blinkHoldSeconds: number = 0.14

  @input
  @hint("Average seconds between blinks. Actual gaps vary either side of this so it never feels metronomic.")
  @widget(new SliderWidget(0.5, 12, 0.25))
  blinkIntervalSeconds: number = 3.2

  @ui.separator
  @input
  @hint("Brightness of the active-band corner brackets. Above the other guides, since these are what say 'draw here'.")
  @widget(new SliderWidget(0.05, 3.0, 0.05))
  activeCornerBrightness: number = 1.25

  @ui.group_end

  @ui.separator
  @ui.group_start("Palette")
  @input("vec4", "{0.0, 0.9, 1.0, 1.0}")
  @hint("Palette slot 1. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor1: vec4 = new vec4(0.0, 0.9, 1.0, 1)

  @input("vec4", "{1.0, 0.18, 0.6, 1.0}")
  @hint("Palette slot 2. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor2: vec4 = new vec4(1.0, 0.18, 0.6, 1)

  @input("vec4", "{0.7, 1.0, 0.1, 1.0}")
  @hint("Palette slot 3. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor3: vec4 = new vec4(0.7, 1.0, 0.1, 1)

  @input("vec4", "{1.0, 0.62, 0.1, 1.0}")
  @hint("Palette slot 4. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor4: vec4 = new vec4(1.0, 0.62, 0.1, 1)

  @input("vec4", "{0.62, 0.4, 1.0, 1.0}")
  @hint("Palette slot 5. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor5: vec4 = new vec4(0.62, 0.4, 1.0, 1)

  @input("vec4", "{1.0, 0.95, 0.35, 1.0}")
  @hint("Palette slot 6. Any player can pick any slot at any time.")
  @widget(new ColorWidget())
  paletteColor6: vec4 = new vec4(1.0, 0.95, 0.35, 1)
  @ui.group_end

  private canvas: ExquisiteCorpseCanvasController | null = null
  private material: Material | null = null

  private bands: BandMesh[] = []
  private live: BandMesh | null = null
  private seam: BandMesh | null = null
  private outlines: BandMesh | null = null
  private frame: BandMesh | null = null
  private corners: BandMesh | null = null
  private eyeMeshes: BandMesh[] = []
  private mouthMesh: BandMesh | null = null
  private hairMesh: BandMesh | null = null
  private face: FaceParts = {eyes: [], mouth: -1, outline: -1, outside: []}
  /** Band 0 minus the face and minus anything outside the outline. */
  private faceRest: Stroke[] = []
  /** Band 0 strokes outside the head outline — hair, and hair-like things. */
  private hairStrokes: Stroke[] = []
  /** 1 = guides at full strength, 0 = gone. The reveal fades this to zero. */
  private guideFade: number = 1
  private alive: boolean = false
  private lifeTime: number = 0
  private nextBlinkAt: number = 0
  private blinkUntil: number = 0
  /** Band the corner brackets currently mark; -1 while none is active. */
  private activeBand: number = -1

  /** Committed strokes, indexed by band. */
  private bandStrokes: Stroke[][] = []

  onAwake(): void {
    if (this.neonMaterial === null || this.neonMaterial === undefined) {
      print(
        "[ExquisiteCorpse] neonMaterial input is not wired (expected vertexBaseColorMaterial, " +
          NEON_MATERIAL_ID +
          "). Strokes will not render."
      )
      return
    }
    this.material = this.neonMaterial.clone()
    const pass = this.material.mainPass
    pass.blendMode = BlendMode.Add // emitted light, not ink
    pass.depthWrite = false
    pass.twoSided = true // readable from behind when players walk around it
    pass.depthTest = true
  }

  setCanvas(canvas: ExquisiteCorpseCanvasController): void {
    this.canvas = canvas
  }

  /** Palette lookup. The index is a chosen colour slot, not a player. */
  colorFor(colorIndex: number): vec4 {
    switch (colorIndex) {
      case 0:
        return this.paletteColor1
      case 1:
        return this.paletteColor2
      case 2:
        return this.paletteColor3
      case 3:
        return this.paletteColor4
      case 4:
        return this.paletteColor5
      default:
        return colorIndex === 5 ? this.paletteColor6 : this.paletteColor1
    }
  }

  private get style(): RibbonStyle {
    const core = this.strokeWidthCm / 2
    return {
      coreHalfCm: core,
      glowHalfCm: core * this.glowSpread,
      intensity: this.glowIntensity,
      // Hotter core: real neon burns toward white at the centre and keeps its
      // hue in the halo, which is what sells it as emitted light.
      coreWhiteness: 0.68
    }
  }

  private makeMesh(name: string): BandMesh {
    const root = global.scene.createSceneObject(name)
    root.setParent(this.sceneObject)
    const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    const builder = new MeshBuilder(RIBBON_LAYOUT)
    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16
    builder.updateMesh()
    rmv.mesh = builder.getMesh()
    if (this.material) rmv.mainMaterial = this.material
    root.enabled = false
    return {root: root, rmv: rmv, builder: builder}
  }

  /** Build one mesh per band plus the live and seam meshes. Clears any prior run. */
  configure(bandCount: number): void {
    this.clearAll()
    this.bands = []
    this.bandStrokes = []
    for (let i = 0; i < bandCount; i++) {
      this.bands.push(this.makeMesh("Band_" + i))
      this.bandStrokes.push([])
    }
    if (!this.live) this.live = this.makeMesh("LiveStroke")
    if (!this.seam) this.seam = this.makeMesh("Seam")
    if (!this.outlines) this.outlines = this.makeMesh("BandOutlines")
    if (!this.frame) this.frame = this.makeMesh("CanvasFrame")
    if (!this.corners) this.corners = this.makeMesh("ActiveCorners")
    if (this.eyeMeshes.length === 0) {
      this.eyeMeshes.push(this.makeMesh("FaceEyeA"))
      this.eyeMeshes.push(this.makeMesh("FaceEyeB"))
    }
    if (!this.mouthMesh) this.mouthMesh = this.makeMesh("FaceMouth")
    if (!this.hairMesh) this.hairMesh = this.makeMesh("HeadHair")
  }

  // ── Band outlines ──────────────────────────────────────────────────────────

  /**
   * Draw the canvas guides: a thin dashed line at each fold, and one solid
   * outline around the whole canvas.
   *
   * The folds are drawn once per internal seam, exactly on the shared clip
   * edge. Drawing a rect per band instead would put two parallel lines either
   * side of every seam, and that gutter reads as a gap interrupting the
   * drawing where one player hands off to the next.
   */
  private rebuildOutlines(): void {
    if (!this.outlines || !this.frame || !this.canvas) return
    if (!this.showCanvasGuides || this.guideFade <= 0.001) {
      this.outlines.root.enabled = false
      this.frame.root.enabled = false
      if (this.corners) this.corners.root.enabled = false
      return
    }

    const guide = (width: number): RibbonStyle => ({
      coreHalfCm: width / 2,
      glowHalfCm: width * 1.5,
      intensity: this.guideBrightness * this.guideFade,
      coreWhiteness: 1.0
    })
    const white = (): vec4 => new vec4(1, 1, 1, 1)

    const dash = this.foldDashCm
    const folds: Stroke[] = []
    for (let i = 1; i < this.bands.length; i++) {
      for (const run of dashPolyline(this.canvas.bandDivider(i), dash, dash * 0.5)) {
        folds.push({playerIndex: 0, points: run})
      }
    }
    rebuildRibbonMesh(
      this.outlines.builder,
      folds,
      guide(this.foldLineWidthCm),
      white,
      (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.outlines.root.enabled = folds.length > 0

    rebuildRibbonMesh(
      this.frame.builder,
      [{playerIndex: 0, points: this.canvas.canvasOutline()}],
      guide(this.canvasOutlineWidthCm),
      white,
      (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.frame.root.enabled = true

    this.rebuildActiveCorners()
  }

  /**
   * Corner brackets around the band being drawn in. Rebuilt with the rest of
   * the guides so they follow the canvas if it is re-placed.
   */
  private rebuildActiveCorners(): void {
    if (!this.corners || !this.canvas) return
    if (!this.showCanvasGuides || this.activeBand < 0 || this.activeBand >= this.bands.length) {
      this.corners.root.enabled = false
      return
    }

    // Negative inset = outside the band edge.
    const legs = this.canvas.bandCorners(
      this.activeBand,
      this.activeCornerArmCm,
      -this.activeCornerOutsetCm
    )
    const strokes: Stroke[] = legs.map((points) => ({playerIndex: 0, points: points}))
    rebuildRibbonMesh(
      this.corners.builder,
      strokes,
      {
        coreHalfCm: this.activeCornerWidthCm / 2,
        glowHalfCm: this.activeCornerWidthCm * 1.5,
        // Alpha folded into brightness: additive rendering has no notion of
        // see-through, so a lower alpha simply emits less light.
        intensity: this.activeCornerBrightness * this.activeCornerColor.a * this.guideFade,
        // Low, unlike the white guides. A high whiteness washes the core toward
        // white and the cyan would only survive in the glow either side of it.
        coreWhiteness: 0.2
      },
      () => this.activeCornerColor,
      (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.corners.root.enabled = true
  }

  /** Tear down the per-band meshes so a new player count starts clean. */
  private clearAll(): void {
    for (const b of this.bands) b.root.destroy()
    this.bands = []
    this.bandStrokes = []
    this.clearLiveStroke()
    if (this.seam) this.seam.root.enabled = false
    if (this.outlines) this.outlines.root.enabled = false
    if (this.frame) this.frame.root.enabled = false
    if (this.corners) this.corners.root.enabled = false
    this.activeBand = -1
  }

  // ── Live stroke ────────────────────────────────────────────────────────────

  /** Redraw the in-progress stroke. Points are already clipped to the band. */
  setLiveStroke(playerIndex: number, runs: Vec2Cm[][]): void {
    if (!this.live) return
    const strokes: Stroke[] = runs.map((r) => ({playerIndex: playerIndex, points: r}))
    rebuildRibbonMesh(
      this.live.builder,
      strokes,
      this.style,
      (p) => this.colorFor(p),
      (pt: Vec2Cm) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.live.root.enabled = strokes.length > 0
  }

  clearLiveStroke(): void {
    if (!this.live) return
    rebuildRibbonMesh(this.live.builder, [], this.style, (p) => this.colorFor(p), (pt) =>
      (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.live.root.enabled = false
  }

  // ── Committed strokes ──────────────────────────────────────────────────────

  commitStroke(bandIndex: number, playerIndex: number, runs: Vec2Cm[][]): void {
    if (bandIndex < 0 || bandIndex >= this.bandStrokes.length) return
    for (const r of runs) {
      if (r.length > 0) this.bandStrokes[bandIndex].push({playerIndex: playerIndex, points: r})
    }
    this.clearLiveStroke()
    this.refreshBand(bandIndex)
  }

  /**
   * Undo the most recent gesture in a band. A gesture that was clipped into
   * several runs is removed as one unit — otherwise a single UNDO would only
   * remove the last fragment, which is not what the player did.
   */
  undoLast(bandIndex: number, runsInLastGesture: number): boolean {
    if (bandIndex < 0 || bandIndex >= this.bandStrokes.length) return false
    const list = this.bandStrokes[bandIndex]
    if (list.length === 0) return false
    const remove = Math.max(1, Math.min(runsInLastGesture, list.length))
    list.splice(list.length - remove, remove)
    this.refreshBand(bandIndex)
    return true
  }

  private refreshBand(bandIndex: number): void {
    const mesh = this.bands[bandIndex]
    if (!mesh || !this.canvas) return
    rebuildRibbonMesh(
      mesh.builder,
      this.bandStrokes[bandIndex],
      this.style,
      (p) => this.colorFor(p),
      (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
  }

  /**
   * Re-project every band mesh through the canvas's CURRENT basis.
   *
   * Band geometry is baked into world space at commit time, so a canvas that
   * re-aims between turns would leave earlier bands pointing the old way and
   * the reveal would show a fractured figure. The strokes themselves are stored
   * in canvas-local cm, so a rebuild is all it takes. Call this whenever the
   * canvas pose changes after any stroke exists.
   */
  refreshAllBands(): void {
    for (let i = 0; i < this.bands.length; i++) this.refreshBand(i)
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  /**
   * Turn state: show ONLY the active band and the seam strip above it.
   * Every other band is hidden, and the seam mesh contains nothing but the
   * clipped seam geometry.
   */
  showTurn(bandIndex: number): void {
    if (!this.canvas) return
    // Set BEFORE the guides rebuild — rebuildOutlines() draws the corner
    // brackets off this value.
    this.activeBand = bandIndex
    this.rebuildOutlines()
    for (let i = 0; i < this.bands.length; i++) {
      this.bands[i].root.enabled = i === bandIndex
    }
    const seamRect = this.canvas.seamRect(bandIndex)
    if (this.seam) {
      if (seamRect && bandIndex > 0) {
        const clipped = clipStrokes(this.bandStrokes[bandIndex - 1], seamRect)
        rebuildRibbonMesh(
          this.seam.builder,
          clipped,
          this.style,
          (p) => this.colorFor(p),
          (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
        )
        this.seam.root.enabled = clipped.length > 0
      } else {
        rebuildRibbonMesh(this.seam.builder, [], this.style, (p) => this.colorFor(p), (pt) =>
          (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
        )
        this.seam.root.enabled = false
      }
    }
  }

  /**
   * Placement preview: just the empty grid, redrawn as the canvas pose tracks
   * the player's head. Lets them see the footprint they are about to lock in
   * instead of committing blind.
   */
  previewOutlines(): void {
    this.activeBand = -1
    for (const b of this.bands) b.root.enabled = false
    if (this.seam) this.seam.root.enabled = false
    if (this.live) this.live.root.enabled = false
    this.rebuildOutlines()
  }

  /** Hide every stroke immediately. Called the instant DONE fires. */
  hideAll(): void {
    if (this.corners) this.corners.root.enabled = false
    for (const b of this.bands) b.root.enabled = false
    if (this.seam) this.seam.root.enabled = false
    if (this.live) this.live.root.enabled = false
    if (this.outlines) this.outlines.root.enabled = false
    if (this.frame) this.frame.root.enabled = false
  }

  /** The reveal: every band at once, no seam, no chrome. */
  /**
   * The reveal: every band at once. The inner band divisions are dropped so
   * nothing cuts across the finished drawing — only the outer frame stays, to
   * hold the composition together.
   */
  showAll(): void {
    this.activeBand = -1
    this.alive = false
    this.rebuildOutlines()
    if (this.outlines) this.outlines.root.enabled = false
    for (const b of this.bands) b.root.enabled = true
    if (this.seam) this.seam.root.enabled = false
    if (this.live) this.live.root.enabled = false
    this.hideFaceMeshes()
  }

  /**
   * Fade the canvas guides. These lines stand in for the paper — an additive
   * display cannot paint an opaque sheet — so taking them to zero is the sheet
   * coming away and leaving the drawing hanging in the air.
   */
  setGuideFade(f: number): void {
    const next = Math.max(0, Math.min(1, f))
    if (next === this.guideFade) return
    this.guideFade = next
    this.rebuildOutlines()
  }

  // ── Bringing the corpse to life ─────────────────────────────────────────────

  /**
   * Start the idle animation on the finished drawing.
   *
   * Splits any detected face out of band 0 into its own meshes so eyes and
   * mouth can move independently of the rest of the body.
   */
  beginLife(): void {
    if (!this.canvas) return
    this.alive = true
    this.lifeTime = 0
    this.blinkUntil = 0
    this.nextBlinkAt = this.blinkIntervalSeconds

    this.face = {eyes: [], mouth: -1, outline: -1, outside: []}
    this.faceRest = []
    this.hairStrokes = []
    if (this.bandStrokes.length > 0) {
      const head = this.bandStrokes[0]
      this.face = detectFace(head, this.canvas.bandRect(0))
      for (let i = 0; i < head.length; i++) {
        if (this.face.eyes.indexOf(i) !== -1 || this.face.mouth === i) continue
        if (this.face.outside.indexOf(i) !== -1) this.hairStrokes.push(head[i])
        else this.faceRest.push(head[i])
      }
    }
    this.updateLife(0)
  }

  stopLife(): void {
    this.alive = false
    this.hideFaceMeshes()
  }

  private hideFaceMeshes(): void {
    for (const m of this.eyeMeshes) m.root.enabled = false
    if (this.mouthMesh) this.mouthMesh.root.enabled = false
    if (this.hairMesh) this.hairMesh.root.enabled = false
  }

  /**
   * One frame of the idle animation. Rebuilds the stroke meshes with a sideways
   * wave, works the mouth, and blinks.
   *
   * Rebuilding every frame is affordable only because nothing else is happening
   * at the reveal — during a turn this would compete with live drawing.
   */
  updateLife(dt: number): void {
    if (!this.alive || !this.canvas) return
    this.lifeTime += dt

    const place = (pt: Vec2Cm): vec3 => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)

    // One rotation shared by every band — it is a single creature leaning, and
    // a rigid transform cannot tear the bands apart at the folds.
    const halfH = this.canvas.canvasHeightCm / 2

    // Ease up from a standstill so the drawing does not snap into its first
    // pose. Smoothstep rather than linear: it leaves rest with zero velocity,
    // so there is no kick at the start either.
    const r = Math.max(0, Math.min(1, this.lifeTime / Math.max(0.001, this.lifeRampSeconds)))
    const ramp = r * r * (3 - 2 * r)

    const life = (rippleScale: number): LifeParams => ({
      time: this.lifeTime,
      tiltDegrees: this.tiltDegrees * ramp,
      tiltSpeed: this.tiltSpeed,
      // Pivot at the foot of the whole canvas, so the body leans from the
      // ground rather than bending about its middle.
      pivotY: -halfH,
      rippleCm: this.breathAmplitudeCm * rippleScale * ramp,
      rippleWavelengthCm: this.breathWavelengthCm,
      rippleSpeed: this.breathSpeed
    })

    // Head sways as one rigid piece; the body gets progressively looser.
    const rippleFor = (band: number): number => {
      if (band === 0) return this.headRipple
      if (band === this.bands.length - 1) return this.legsRipple
      return this.torsoRipple
    }
    const headLife = life(rippleFor(0))

    for (let b = 0; b < this.bands.length; b++) {
      const splitHead =
        b === 0 &&
        (this.face.eyes.length > 0 || this.face.mouth >= 0 || this.face.outside.length > 0)
      const source = splitHead ? this.faceRest : this.bandStrokes[b]
      rebuildRibbonMesh(
        this.bands[b].builder,
        animateStrokes(source, life(rippleFor(b))),
        this.style,
        (p) => this.colorFor(p),
        place
      )
      this.bands[b].root.enabled = true
    }

    if (this.hairMesh) {
      if (this.hairStrokes.length === 0) {
        this.hairMesh.root.enabled = false
      } else {
        rebuildRibbonMesh(
          this.hairMesh.builder,
          animateStrokes(this.hairStrokes, life(this.hairRipple)),
          this.style,
          (p) => this.colorFor(p),
          place
        )
        this.hairMesh.root.enabled = true
      }
    }

    // Blink: both eyes shut together, on an irregular beat so it never ticks.
    if (this.lifeTime >= this.nextBlinkAt && this.blinkUntil < this.lifeTime) {
      this.blinkUntil = this.lifeTime + this.blinkHoldSeconds
      const jitter = 0.45 + ((Math.sin(this.lifeTime * 12.9898) * 43758.5453) % 1.1)
      this.nextBlinkAt = this.lifeTime + this.blinkIntervalSeconds * Math.abs(jitter)
    }
    const blinking = this.lifeTime < this.blinkUntil

    const head = this.bandStrokes.length > 0 ? this.bandStrokes[0] : []
    for (let e = 0; e < this.eyeMeshes.length; e++) {
      const idx = e < this.face.eyes.length ? this.face.eyes[e] : -1
      const mesh = this.eyeMeshes[e]
      if (idx < 0 || blinking) {
        mesh.root.enabled = false
        continue
      }
      rebuildRibbonMesh(
        mesh.builder,
        animateStrokes([head[idx]], headLife),
        this.style,
        (p) => this.colorFor(p),
        place
      )
      mesh.root.enabled = true
    }

    if (this.mouthMesh) {
      if (this.face.mouth < 0) {
        this.mouthMesh.root.enabled = false
      } else {
        const open = 1 + Math.sin(this.lifeTime * this.mouthSpeed * Math.PI * 2) * this.mouthOpenAmount * ramp
        const worked = scaleStrokeY(head[this.face.mouth], Math.max(0.05, open))
        rebuildRibbonMesh(
          this.mouthMesh.builder,
          animateStrokes([worked], headLife),
          this.style,
          (p) => this.colorFor(p),
          place
        )
        this.mouthMesh.root.enabled = true
      }
    }
  }

  /** True when a face was actually found, so Main can report it. */
  get faceFound(): boolean {
    return this.face.eyes.length === 2 || this.face.mouth >= 0
  }

  /** How many head strokes were taken to be hair, for logging. */
  get hairCount(): number {
    return this.hairStrokes.length
  }

  // ── Replay ─────────────────────────────────────────────────────────────────

  /**
   * Colour of the first stroke in a band, for the reveal's key. Falls back to
   * the band's default slot when nothing was drawn there.
   */
  firstColorInBand(bandIndex: number): vec4 {
    const band = this.bandStrokes[bandIndex]
    if (band && band.length > 0) return this.colorFor(band[0].playerIndex)
    return this.colorFor(bandIndex % PALETTE_SIZE)
  }

  /** All committed strokes flattened in turn order, for the replay animation. */
  orderedStrokes(): Stroke[] {
    const out: Stroke[] = []
    for (const band of this.bandStrokes) {
      for (const s of band) out.push(s)
    }
    return out
  }

  replayTotalPoints(): number {
    return totalPoints(this.orderedStrokes())
  }

  /**
   * Render the first `pointBudget` points of the whole drawing into the live
   * mesh, with every band mesh hidden. Driving the replay through one mesh
   * keeps the animation to a single rebuild per frame.
   */
  showReplayPrefix(pointBudget: number): void {
    if (!this.live || !this.canvas) return
    this.rebuildOutlines()
    for (const b of this.bands) b.root.enabled = false
    if (this.seam) this.seam.root.enabled = false
    const prefix = takePointPrefix(this.orderedStrokes(), pointBudget)
    rebuildRibbonMesh(
      this.live.builder,
      prefix,
      this.style,
      (p) => this.colorFor(p),
      (pt) => (this.canvas as ExquisiteCorpseCanvasController).toWorld(pt)
    )
    this.live.root.enabled = prefix.length > 0
  }

  /** Wipe every stroke for a fresh round, keeping the canvas placement. */
  resetStrokes(): void {
    for (let i = 0; i < this.bandStrokes.length; i++) {
      this.bandStrokes[i] = []
      this.refreshBand(i)
      this.bands[i].root.enabled = false
    }
    this.clearLiveStroke()
    if (this.seam) this.seam.root.enabled = false
  }

  /** Clip a raw gesture to a band. Exposed so the draw controller stays thin. */
  clipToBand(points: Vec2Cm[], bandIndex: number): Vec2Cm[][] {
    if (!this.canvas) return []
    return clipPolyline(points, this.canvas.bandRect(bandIndex))
  }
}
