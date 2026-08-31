// ExquisiteCorpseCanvasController.ts
//
// OWNS: the canvas as a piece of geometry — where it sits in the world, its
// orthonormal basis, the horizontal band split, and the seam rect. It is the
// single source of truth for "where is canvas point (x, y) in the world".
//
// The canvas plane itself is NEVER rendered. Nothing here creates a visual for
// it; the bands are pure maths used for clipping and layout. On an additive
// display there is no convincing opaque sheet to draw anyway, so the drawing
// reads as emitted light hanging in space.
//
// EXPECTS: @inputs below. Wired by the bootstrap.
//
// MUST NOT: own strokes, turns, or input. It answers geometry questions.

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

import {BandRect, Vec2Cm} from "./ExquisiteCorpseGeometry"

/** Thickness of the invisible grab box. Deep enough to catch a pinch ray. */
const HANDLE_DEPTH_CM = 4

@component
export class ExquisiteCorpseCanvasController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Canvas Controller – invisible plane, band maths, placement</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Canvas width in centimetres. Sized to fit the Specs display: the usable area is about 53x77cm at 110cm, so at the default 150cm placement roughly 72cm wide fits edge to edge.")
  @widget(new SliderWidget(30, 100, 1))
  canvasWidthCm: number = 56

  @input
  @hint("Height of ONE player's band in centimetres. Total canvas height is this times the player count. Three bands at 32cm fit the display with margin to spare.")
  @widget(new SliderWidget(15, 60, 1))
  bandHeightCm: number = 28

  @input
  @hint("How much of the band above is visible as the seam, in centimetres. A narrow splice is the whole point of the game — the less you see, the funnier the reveal.")
  @widget(new SliderWidget(0.5, 25, 0.5))
  seamCm: number = 3.5

  @input
  @hint("Closest the canvas will ever be placed, in centimetres.")
  @widget(new SliderWidget(60, 400, 5))
  placementDistanceCm: number = 150

  @input
  @hint("Distance is set so ONE band is comfortable to draw in, as a multiple of band height. The whole canvas need not fit in view.")
  @widget(new SliderWidget(2.0, 8.0, 0.1))
  bandViewingRatio: number = 4.0

  @input
  @hint("How far the TOP of the canvas sits above eye level, in centimetres. At the default a three-band canvas centres on the eye line and fits the display; taller canvases anchor their top here instead of towering overhead.")
  @widget(new SliderWidget(0, 120, 2))
  topAboveEyeCm: number = 48
  @ui.group_end

  /** Hard ceiling on players. Six 34cm bands already make a 2m-tall canvas. */
  static readonly MAX_PLAYERS = 6

  private camera = WorldCameraFinderProvider.getInstance()

  private centre: vec3 = vec3.zero()
  private rightAxis: vec3 = vec3.right()
  private upAxis: vec3 = vec3.up()
  private normalAxis: vec3 = vec3.forward()
  private placed: boolean = false
  private playerCount: number = 3

  private leanYaw: number = 0
  private leanPitch: number = 0

  private handle: SceneObject | null = null
  private handleShape: BoxShape | null = null

  onAwake(): void {
    // The plane itself is deliberately invisible. The only thing built here is
    // the placement handle, and it has no visual either.
    this.buildHandle()
  }

  setPlayerCount(n: number): void {
    this.playerCount = Math.max(1, Math.min(ExquisiteCorpseCanvasController.MAX_PLAYERS, n))
  }

  get isPlaced(): boolean {
    return this.placed
  }

  /**
   * The canvas grows with the player count rather than subdividing a fixed
   * height — at six players a fixed canvas would give each person a 20cm strip,
   * which is too cramped to draw a body section in.
   */
  get canvasHeightCm(): number {
    return this.bandHeightCm * this.playerCount
  }

  /**
   * Distance is driven by BAND height, not total canvas height.
   *
   * Pushing the canvas back far enough to fit all six bands in the Specs field
   * of view would shrink each band to a few degrees — too small to draw in. The
   * band you are working on is what needs to be comfortable; seeing the whole
   * corpse at once is the reveal's job, and the spec already wants players to
   * walk around for that.
   */
  get effectiveDistanceCm(): number {
    return Math.max(this.placementDistanceCm, this.bandHeightCm * this.bandViewingRatio)
  }

  /**
   * Preview pose while the player is aiming: the canvas tracks head yaw at a
   * fixed distance, kept vertical so the drawing surface never tilts.
   */
  previewPose(): void {
    this.computePose()
  }

  /**
   * Lock the canvas exactly where it currently sits.
   *
   * Deliberately does NOT recompute the pose: by this point the player has
   * dragged the canvas somewhere specific, and re-aiming from the head would
   * throw that away and snap it back in front of them.
   */
  lockPlacement(): void {
    this.placed = true
    if (this.handle) this.handle.enabled = false
  }

  /**
   * Re-aim the canvas at the viewer WITHOUT moving it.
   *
   * The canvas is world-locked, so the facing it was placed with belongs to
   * whoever placed it. By player three that can be well off to one side and
   * close to edge-on. Turning about its own anchor at the start of each turn
   * keeps it a fixed object in the room while still presenting square-on to
   * whoever is wearing the glasses now.
   *
   * Position is untouched: poseAt re-derives the basis from the same centre.
   */
  reaimAtViewer(): void {
    if (!this.placed) return
    this.poseAt(this.centre)
  }

  // ── Placement by drag ──────────────────────────────────────────────────────

  /**
   * An invisible box the size of the canvas, carrying the collider and SIK
   * manipulation that make the canvas grabbable.
   *
   * The grab surface IS the canvas rather than a separate widget, because at
   * the placement step the canvas outline is the only thing on screen — a drag
   * puck floating beside it would be one more object to explain.
   */
  private buildHandle(): void {
    if (this.handle) return

    const so = global.scene.createSceneObject("CanvasDragHandle")
    so.setParent(this.sceneObject)

    const collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(this.canvasWidthCm, this.canvasHeightCm, HANDLE_DEPTH_CM)
    collider.shape = shape
    collider.debugDrawEnabled = false
    this.handleShape = shape

    so.createComponent(Interactable.getTypeName()) as Interactable

    const manip = so.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    // Translation only. A canvas the player could tilt or resize by accident
    // would break the band maths, which assumes a vertical plane of known size.
    manip.setCanTranslate(true)
    manip.setCanRotate(false)
    manip.setCanScale(false)

    so.enabled = false
    this.handle = so
  }

  /**
   * Turn the drag handle on for the placement step, seeding it from the
   * head-aimed pose so the canvas starts in front of the player and is then
   * theirs to move.
   */
  armPlacementHandle(on: boolean): void {
    if (!this.handle) return
    if (on) {
      this.computePose()
      if (this.handleShape) {
        this.handleShape.size = new vec3(this.canvasWidthCm, this.canvasHeightCm, HANDLE_DEPTH_CM)
      }
      const tr = this.handle.getTransform()
      tr.setWorldPosition(this.centre)
      tr.setWorldRotation(this.faceViewerRotation())
    }
    this.handle.enabled = on
  }

  /**
   * Re-derive the canvas pose from wherever the player has dragged the handle.
   * Called every frame while placing.
   */
  syncFromHandle(): void {
    if (!this.handle || !this.handle.enabled) return
    const anchor = this.handle.getTransform().getWorldPosition()
    this.poseAt(anchor)
    // Keep the grab box aligned with the plane it represents as the canvas
    // turns to face the player from its new position.
    this.handle.getTransform().setWorldRotation(this.faceViewerRotation())
  }

  /**
   * Centre the canvas on a world point, square to the player.
   *
   * Facing is taken from the canvas-to-viewer direction rather than from head
   * forward, so a canvas dragged off to one side still turns to face you
   * instead of sitting edge-on.
   */
  private poseAt(anchor: vec3): void {
    const camPos = this.camera.getComponent().getTransform().getWorldPosition()
    let flat = new vec3(anchor.x - camPos.x, 0, anchor.z - camPos.z)
    if (flat.length < 1e-3) flat = new vec3(0, 0, -1)
    flat = flat.normalize()

    this.centre = anchor
    this.upAxis = vec3.up()
    this.normalAxis = flat.uniformScale(-1)
    this.rightAxis = this.upAxis.cross(this.normalAxis).normalize()
  }

  private computePose(): void {
    const camTransform = this.camera.getComponent().getTransform()
    const camPos = camTransform.getWorldPosition()
    const camForward = camTransform.forward.uniformScale(-1) // LS objects face -Z

    // Flatten to horizontal so the canvas is always vertical, however the
    // player's head is tilted when they place it.
    let flat = new vec3(camForward.x, 0, camForward.z)
    if (flat.length < 1e-3) flat = new vec3(0, 0, -1)
    flat = flat.normalize()

    // Anchor the TOP of the canvas near eye level rather than centring it. A
    // six-player canvas is over 2m tall; centred on the eye it would tower
    // overhead and put band 0 at a steep upward angle. Short canvases are
    // unaffected — the min() keeps them centred.
    const centreDrop = Math.min(0, this.topAboveEyeCm - this.canvasHeightCm / 2)
    this.centre = camPos
      .add(flat.uniformScale(this.effectiveDistanceCm))
      .add(new vec3(0, centreDrop, 0))
    this.upAxis = vec3.up()
    this.normalAxis = flat.uniformScale(-1) // faces back at the player
    this.rightAxis = this.upAxis.cross(this.normalAxis).normalize()
  }

  /** Canvas-local centimetres to world space. */
  toWorld(p: Vec2Cm): vec3 {
    const flat = this.centre
      .add(this.rightAxis.uniformScale(p.x))
      .add(this.upAxis.uniformScale(p.y))
    if (this.leanYaw === 0 && this.leanPitch === 0) return flat

    // Lean is applied HERE rather than by rotating a parent, because stroke
    // geometry is baked in world space with an identity transform — rotating
    // the object would swing it about the world origin, not the canvas.
    const local = flat.sub(this.centre)
    const x = local.dot(this.rightAxis)
    const y = local.dot(this.upAxis)
    const cy = Math.cos(this.leanYaw)
    const sy = Math.sin(this.leanYaw)
    const cp = Math.cos(this.leanPitch)
    const sp = Math.sin(this.leanPitch)
    // Yaw about up, then pitch about right. Small angles, so order barely shows.
    const nx = x * cy
    const nz = -x * sy
    const ny = y * cp
    const nz2 = nz - y * sp
    return this.centre
      .add(this.rightAxis.uniformScale(nx))
      .add(this.upAxis.uniformScale(ny))
      .add(this.normalAxis.uniformScale(nz2))
  }

  /**
   * Turn the canvas a little toward whoever is looking at it.
   *
   * Only a FRACTION of the true angle, and clamped: a drawing that tracked the
   * viewer exactly would read as a billboard following you around, whereas a
   * partial lean reads as something noticing you. Smoothed so it drifts rather
   * than snaps.
   */
  updateViewerLean(strength: number, maxDegrees: number, smoothing: number): void {
    const camPos = this.camera.getComponent().getTransform().getWorldPosition()
    const toCam = camPos.sub(this.centre)

    const along = toCam.dot(this.normalAxis)
    const side = toCam.dot(this.rightAxis)
    const up = toCam.dot(this.upAxis)
    const depth = Math.max(1, Math.abs(along))

    const limit = (maxDegrees * Math.PI) / 180
    const wantYaw = Math.max(-limit, Math.min(limit, Math.atan2(side, depth) * strength))
    const wantPitch = Math.max(-limit, Math.min(limit, Math.atan2(up, depth) * strength))

    const k = Math.max(0, Math.min(1, smoothing))
    this.leanYaw += (wantYaw - this.leanYaw) * k
    this.leanPitch += (wantPitch - this.leanPitch) * k
  }

  /** Drop the lean back to square, for phases that are not the reveal. */
  clearViewerLean(): void {
    this.leanYaw = 0
    this.leanPitch = 0
  }

  /** Project a world point onto the canvas plane and return canvas-local cm. */
  toCanvas(world: vec3): Vec2Cm {
    const d = world.sub(this.centre)
    return {x: d.dot(this.rightAxis), y: d.dot(this.upAxis)}
  }

  /**
   * Intersect the ray from `origin` through `through` with the canvas plane.
   *
   * This is how pinch-drawing maps to the canvas: the ray runs from the head
   * through the pinch point, so the mark lands where the player sees their
   * fingers against the canvas. A plain perpendicular projection would cap the
   * reachable area at arm span and make the far corners unreachable.
   *
   * Returns null when the ray is parallel to the plane or points away from it.
   */
  rayToCanvas(origin: vec3, through: vec3): Vec2Cm | null {
    const dir = through.sub(origin)
    const denom = dir.dot(this.normalAxis)
    if (Math.abs(denom) < 1e-5) return null
    const t = this.centre.sub(origin).dot(this.normalAxis) / denom
    if (t <= 0) return null
    const hit = origin.add(dir.uniformScale(t))
    return this.toCanvas(hit)
  }

  /** The editable region for a given band index, 0 = top. */
  bandRect(bandIndex: number): BandRect {
    const h = this.bandHeightCm
    const halfW = this.canvasWidthCm / 2
    const top = this.canvasHeightCm / 2 - bandIndex * h
    return {minX: -halfW, maxX: halfW, minY: top - h, maxY: top}
  }

  /**
   * The seam strip for a given band: the bottom `seamCm` of the band ABOVE it.
   * Band 0 has no seam — the first player starts from nothing.
   */
  seamRect(bandIndex: number): BandRect | null {
    if (bandIndex <= 0) return null
    const above = this.bandRect(bandIndex - 1)
    const halfW = this.canvasWidthCm / 2
    return {
      minX: -halfW,
      maxX: halfW,
      minY: above.minY,
      maxY: Math.min(above.maxY, above.minY + this.seamCm)
    }
  }

  /**
   * The horizontal divider at the TOP of a band, as a two-point line.
   *
   * Drawn once per internal boundary rather than as a rect per band: adjacent
   * band rects would put two parallel lines either side of every seam, and that
   * gutter reads as a gap interrupting the drawing. Sits exactly on the shared
   * clip edge, which is also where one player's strokes end and the next
   * player's begin, so the line marks the join instead of straddling it.
   */
  bandDivider(bandIndex: number): Vec2Cm[] {
    const y = this.bandRect(bandIndex).maxY
    const halfW = this.canvasWidthCm / 2
    return [
      {x: -halfW, y: y},
      {x: halfW, y: y}
    ]
  }

  /** A band's boundary as a closed polyline, drawn exactly on the clip edge. */
  bandOutline(bandIndex: number, insetCm: number = 0): Vec2Cm[] {
    const r = this.bandRect(bandIndex)
    const l = r.minX + insetCm
    const rt = r.maxX - insetCm
    const b = r.minY + insetCm
    const t = r.maxY - insetCm
    return [
      {x: l, y: t},
      {x: rt, y: t},
      {x: rt, y: b},
      {x: l, y: b},
      {x: l, y: t}
    ]
  }

  /** The whole canvas boundary as a closed polyline, for the outer frame. */
  canvasOutline(insetCm: number = 0): Vec2Cm[] {
    const halfW = this.canvasWidthCm / 2 - insetCm
    const halfH = this.canvasHeightCm / 2 - insetCm
    return [
      {x: -halfW, y: halfH},
      {x: halfW, y: halfH},
      {x: halfW, y: -halfH},
      {x: -halfW, y: -halfH},
      {x: -halfW, y: halfH}
    ]
  }

  /**
   * The four corner brackets of a band, as four separate L-shaped polylines.
   *
   * Marks which band is live without drawing a box around it: a closed
   * rectangle competes with the canvas outline and the fold lines and starts to
   * read as a second sheet, whereas brackets sit in the periphery and leave the
   * drawing area clear.
   *
   * `armCm` is the length of each leg, clamped so opposite arms can never meet
   * and quietly turn the brackets back into the full outline they exist to
   * avoid.
   */
  bandCorners(bandIndex: number, armCm: number, insetCm: number = 0): Vec2Cm[][] {
    const b = this.bandRect(bandIndex)
    const minX = b.minX + insetCm
    const maxX = b.maxX - insetCm
    const minY = b.minY + insetCm
    const maxY = b.maxY - insetCm

    const arm = Math.max(
      0.5,
      Math.min(armCm, (maxX - minX) * 0.45, (maxY - minY) * 0.45)
    )

    return [
      [{x: minX, y: maxY - arm}, {x: minX, y: maxY}, {x: minX + arm, y: maxY}],
      [{x: maxX - arm, y: maxY}, {x: maxX, y: maxY}, {x: maxX, y: maxY - arm}],
      [{x: maxX, y: minY + arm}, {x: maxX, y: minY}, {x: maxX - arm, y: minY}],
      [{x: minX + arm, y: minY}, {x: minX, y: minY}, {x: minX, y: minY + arm}]
    ]
  }

  /**
   * World pose just ABOVE the top edge of a band, for the turn prompt.
   *
   * Band 0's top edge is the top of the canvas, so player 1 reads the prompt
   * above the whole sheet; every later player reads it just above the fold they
   * are drawing down from. One rule covers all three cases.
   */
  poseAboveBand(bandIndex: number, gapCm: number): {pos: vec3; rot: quat} {
    const band = this.bandRect(bandIndex)
    // Clear the seam. The seam strip occupies exactly the space just above the
    // fold, so a prompt placed at a bare gap would print over the sliver of the
    // previous player's drawing — the one thing the current player needs to see
    // in order to continue it. Band 0 has no seam and needs no clearance.
    const seam = bandIndex > 0 ? this.seamCm : 0
    const pos = this.toWorld({x: 0, y: band.maxY + seam + gapCm}).add(
      this.normalAxis.uniformScale(2)
    )
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /** World pose just inside the bottom edge of a band, for the in-canvas prompt. */
  poseAtBandBottom(bandIndex: number, insetCm: number): {pos: vec3; rot: quat} {
    const band = this.bandRect(bandIndex)
    const pos = this.toWorld({x: 0, y: band.minY + insetCm}).add(this.normalAxis.uniformScale(1.5))
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /** World pose for a bar sitting just above the top of the canvas. */
  poseAboveCanvas(gapCm: number, panelHeightCm: number): {pos: vec3; rot: quat} {
    const y = this.canvasHeightCm / 2 + gapCm + panelHeightCm / 2
    const pos = this.toWorld({x: 0, y: y}).add(this.normalAxis.uniformScale(2))
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /**
   * World pose for a narrow rail running down one side of the canvas, with its
   * TOP edge level with the top of the canvas.
   *
   * `side` is -1 for the left of the canvas, +1 for the right. Top-aligned
   * rather than centred so the two rails line up with each other and with the
   * canvas edge, which is what makes them read as attached to it.
   */
  poseBesideCanvas(
    side: number,
    gapCm: number,
    panelWidthCm: number,
    panelHeightCm: number,
    topOffsetCm: number = 0,
    contentOffsetCm: number = 0
  ): {pos: vec3; rot: quat} {
    // contentOffsetCm compensates for a Frame drawing its content off-centre:
    // the shift is the same direction in world space on both sides, so it eats
    // the left rail's clearance and pads the right rail's.
    const x = side * (this.canvasWidthCm / 2 + gapCm + panelWidthCm / 2) - contentOffsetCm
    const y = this.canvasHeightCm / 2 - panelHeightCm / 2 + topOffsetCm
    const pos = this.toWorld({x: x, y: y}).add(this.normalAxis.uniformScale(2))
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /** World pose for a panel hung below the whole canvas, facing the viewer. */
  poseBelowCanvas(gapCm: number, panelHeightCm: number): {pos: vec3; rot: quat} {
    const y = -this.canvasHeightCm / 2 - gapCm - panelHeightCm / 2
    const pos = this.toWorld({x: 0, y: y}).add(this.normalAxis.uniformScale(2))
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /**
   * World pose for a menu panel straight in front of the viewer at eye level.
   *
   * Menus must NOT inherit the canvas's vertical drop: a six-player canvas is
   * centred a long way below the eye line, and a setup panel pinned to it would
   * sit near the floor.
   */
  poseInFrontOfViewer(distanceCm: number): {pos: vec3; rot: quat} {
    const camTransform = this.camera.getComponent().getTransform()
    const camPos = camTransform.getWorldPosition()
    const fwd = camTransform.forward.uniformScale(-1)
    let flat = new vec3(fwd.x, 0, fwd.z)
    if (flat.length < 1e-3) flat = new vec3(0, 0, -1)
    flat = flat.normalize()
    return {
      pos: camPos.add(flat.uniformScale(distanceCm)),
      rot: quat.lookAt(flat.uniformScale(-1), vec3.up())
    }
  }

  /** World pose for a panel sitting at the canvas centre, facing the viewer. */
  poseAtCanvasCentre(): {pos: vec3; rot: quat} {
    const pos = this.centre.add(this.normalAxis.uniformScale(3))
    return {pos: pos, rot: this.faceViewerRotation()}
  }

  /**
   * Rotation that turns a panel to face along the canvas normal, back toward
   * the player who placed it. Uses the canvas normal rather than the live head
   * position so world-locked gaze targets stay put while players walk around.
   *
   * quat.lookAt aligns the object's LOCAL +Z with the vector it is given (not
   * -Z), so the normal is passed as-is. Getting this backwards points the panel
   * away AND pushes its +Z content lift behind the backing plate, which reads
   * as an empty frame.
   */
  faceViewerRotation(): quat {
    return quat.lookAt(this.normalAxis, vec3.up())
  }
}
