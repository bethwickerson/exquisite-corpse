// ExquisiteCorpseDrawController.ts
//
// OWNS: pinch-to-draw. Watches SIK interactors for a free-space trigger, maps
// the trigger point onto the canvas, accumulates a polyline, clips it to the
// active band, and pushes it to the renderer. Also owns the undo stack.
//
// Input choice: the spec reserves gaze dwell for UI zones only, so drawing is
// pinch. This subscribes to the INTERACTOR's own trigger rather than an
// Interactable's, because the player pinches in free space with no object
// under the cursor. That also gets editor support for free — MouseInteractor
// fires the same trigger and exposes a moving startPoint.
//
// EXPECTS: @inputs below, plus setContext() from Main.
//
// MUST NOT: decide when a turn ends, render anything itself, or touch UI.

import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {Interactor, InteractorInputType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {Vec2Cm} from "./ExquisiteCorpseGeometry"
import {ExquisiteCorpseCanvasController} from "./ExquisiteCorpseCanvasController"
import {ExquisiteCorpseStrokeRenderer} from "./ExquisiteCorpseStrokeRenderer"

/** One completed gesture, kept so UNDO can remove it as a single unit. */
interface UndoEntry {
  runCount: number
}

@component
export class ExquisiteCorpseDrawController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Draw Controller – pinch to draw, clipped to your band</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Minimum travel on the canvas before a new point is recorded, in centimetres.")
  @widget(new SliderWidget(0.05, 3.0, 0.05))
  minPointSpacingCm: number = 0.6

  @input
  @hint("Smoothing on the drawn point. 0 is raw and jittery, 0.9 is very smooth but laggy.")
  @widget(new SliderWidget(0, 0.95, 0.05))
  smoothing: number = 0.55

  @input
  @hint("How many gestures a player can undo within their own turn.")
  @widget(new SliderWidget(5, 60, 1))
  maxUndoLevels: number = 24
  @ui.group_end

  private camera = WorldCameraFinderProvider.getInstance()
  private canvas: ExquisiteCorpseCanvasController | null = null
  private renderer: ExquisiteCorpseStrokeRenderer | null = null

  private active: boolean = false
  private bandIndex: number = 0
  /** Palette slot new strokes are drawn in. Changeable mid-turn. */
  private colorIndex: number = 0

  private drawing: boolean = false
  private raw: Vec2Cm[] = []
  private smoothed: Vec2Cm | null = null
  private undoStack: UndoEntry[] = []

  private subscribed: Interactor[] = []
  private triggering: Interactor | null = null

  private _onStrokeCommitted = new Event<void>()
  private _onPinchStarted = new Event<void>()

  get onStrokeCommitted(): PublicApi<void> {
    return this._onStrokeCommitted
  }

  /**
   * Fires on any free-space pinch, whether or not drawing is active. Main uses
   * it for canvas placement so interactor subscription lives in exactly one
   * place.
   */
  get onPinchStarted(): PublicApi<void> {
    return this._onPinchStarted
  }

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /**
   * Subscribe to every interactor's OWN trigger events. The Interactor fires
   * these whether or not it has a target (BaseInteractor: "regardless of if
   * there is a target or not"), which is what free-space drawing needs — there
   * is no Interactable under the pinch. Polling `isTriggering` instead misses
   * target-less pinches entirely.
   *
   * Re-scanned each frame because interactors register after this component
   * starts, and the set changes when a hand is lost or a phone connects.
   */
  private ensureSubscriptions(): void {
    const interactors = SIK.InteractionManager.getInteractorsByType(InteractorInputType.All)
    for (const i of interactors) {
      if (this.subscribed.indexOf(i) !== -1) continue
      this.subscribed.push(i)
      i.onTriggerStart.add(() => {
        this.triggering = i
        this._onPinchStarted.invoke()
      })
      const clear = (): void => {
        if (this.triggering === i) this.triggering = null
      }
      i.onTriggerEnd.add(clear)
      i.onTriggerCanceled.add(clear)
    }
  }

  setContext(
    canvas: ExquisiteCorpseCanvasController,
    renderer: ExquisiteCorpseStrokeRenderer
  ): void {
    this.canvas = canvas
    this.renderer = renderer
  }

  /** Enable drawing for one player's turn. */
  beginTurn(bandIndex: number, colorIndex: number): void {
    this.bandIndex = bandIndex
    this.colorIndex = colorIndex
    this.undoStack = []
    this.raw = []
    this.smoothed = null
    this.drawing = false
    this.active = true
  }

  endTurn(): void {
    this.active = false
    this.drawing = false
    this.raw = []
    this.smoothed = null
    if (this.renderer) this.renderer.clearLiveStroke()
  }

  /** Switch the colour of subsequent strokes. Committed strokes keep theirs. */
  setColorIndex(index: number): void {
    this.colorIndex = index
  }

  get activeColorIndex(): number {
    return this.colorIndex
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  undo(): boolean {
    if (!this.renderer || this.undoStack.length === 0) return false
    const entry = this.undoStack.pop() as UndoEntry
    return this.renderer.undoLast(this.bandIndex, entry.runCount)
  }

  private onUpdate(): void {
    this.ensureSubscriptions()

    if (!this.active || !this.canvas || !this.renderer) return
    if (!this.canvas.isPlaced) return

    const interactor = this.triggering

    // A pinch aimed at a button is a UI action, not a mark. Without this the
    // palette (and any other pinchable control) would lay down a stroke every
    // time it was used.
    if (interactor && interactor.currentInteractable) {
      if (this.drawing) this.finishStroke()
      return
    }

    if (interactor && interactor.startPoint) {
      const camPos = this.camera.getComponent().getTransform().getWorldPosition()
      const hit = this.canvas.rayToCanvas(camPos, interactor.startPoint)
      if (hit) {
        if (!this.drawing) this.startStroke(hit)
        else this.extendStroke(hit)
      }
      return
    }

    if (this.drawing) this.finishStroke()
  }

  private startStroke(p: Vec2Cm): void {
    this.drawing = true
    this.smoothed = {x: p.x, y: p.y}
    this.raw = [{x: p.x, y: p.y}]
    this.pushLive()
  }

  private extendStroke(p: Vec2Cm): void {
    const a = this.smoothing
    const s = this.smoothed as Vec2Cm
    const next = {x: s.x + (p.x - s.x) * (1 - a), y: s.y + (p.y - s.y) * (1 - a)}
    this.smoothed = next

    const last = this.raw[this.raw.length - 1]
    const dx = next.x - last.x
    const dy = next.y - last.y
    if (dx * dx + dy * dy < this.minPointSpacingCm * this.minPointSpacingCm) return

    this.raw.push({x: next.x, y: next.y})
    this.pushLive()
  }

  /**
   * The live preview is clipped exactly as the committed stroke will be, so a
   * player sees their line stop at the band edge while they are still drawing
   * rather than being surprised when it is trimmed on release.
   */
  private pushLive(): void {
    if (!this.renderer) return
    const runs = this.renderer.clipToBand(this.raw, this.bandIndex)
    this.renderer.setLiveStroke(this.colorIndex, runs)
  }

  private finishStroke(): void {
    this.drawing = false
    if (!this.renderer || this.raw.length === 0) {
      this.raw = []
      return
    }
    const runs = this.renderer.clipToBand(this.raw, this.bandIndex)
    const kept = runs.filter((r) => r.length > 0)
    if (kept.length > 0) {
      this.renderer.commitStroke(this.bandIndex, this.colorIndex, kept)
      this.undoStack.push({runCount: kept.length})
      while (this.undoStack.length > this.maxUndoLevels) this.undoStack.shift()
      this._onStrokeCommitted.invoke()
    } else {
      this.renderer.clearLiveStroke()
    }
    this.raw = []
    this.smoothed = null
  }
}
