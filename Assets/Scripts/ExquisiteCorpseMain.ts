// ExquisiteCorpseMain.ts
//
// OWNS: the phase machine and the wiring between controllers and UI. This file
// should read as an orchestration table, not as the game.
//
// The phase order is the anti-cheat mechanism, and the ordering inside
// finishTurn() is load-bearing: strokes are hidden BEFORE the pass panel is
// built or shown, so there is no frame in which the outgoing player's drawing
// and the pass instruction are on screen together.
//
// EXPECTS: every @input below wired by the bootstrap.
//
// MUST NOT: create text, import UIKit, or build stroke geometry. Those live in
// the *UI.ts modules and the renderer respectively.

import {ExquisiteCorpseAudioController} from "./ExquisiteCorpseAudioController"
import {ExquisiteCorpseBandPromptUI} from "./ExquisiteCorpseBandPromptUI"
import {ExquisiteCorpseCanvasController} from "./ExquisiteCorpseCanvasController"
import {ExquisiteCorpseDrawController} from "./ExquisiteCorpseDrawController"
import {ExquisiteCorpseGazeDwell} from "./ExquisiteCorpseGazeDwell"
import {ExquisiteCorpsePaletteUI} from "./ExquisiteCorpsePaletteUI"
import {ExquisiteCorpsePlacementUI} from "./ExquisiteCorpsePlacementUI"
import {ExquisiteCorpseHudUI} from "./ExquisiteCorpseHudUI"
import {ExquisiteCorpseInfoUI} from "./ExquisiteCorpseInfoUI"
import {ExquisiteCorpsePassUI} from "./ExquisiteCorpsePassUI"
import {ExquisiteCorpseRevealUI} from "./ExquisiteCorpseRevealUI"
import {ExquisiteCorpseSetupUI} from "./ExquisiteCorpseSetupUI"
import {ExquisiteCorpseStrokeRenderer, PALETTE_SIZE} from "./ExquisiteCorpseStrokeRenderer"

/**
 * Distance every panel's text and layout was authored for. Panels are uniformly
 * scaled by (actual distance / this) so a six-player canvas — which sits much
 * further back — still reads at exactly the same apparent size.
 */
const PANEL_REFERENCE_DISTANCE_CM = 150

/** Seconds after the reveal appears before its gaze zone is registered. */
const REVEAL_ZONE_DELAY_S = 0.2

/** Seconds at the start of a turn before gaze dwell will accept anything. */
const DWELL_ARM_DELAY_S = 0.9

/**
 * Gap between the top of the CANVAS and the turn prompt, in centimetres.
 *
 * The prompt is pinned to the canvas top for every player rather than tracking
 * the active band, so it always reads in the same place instead of walking down
 * the sheet as the turns advance.
 */
const PROMPT_GAP_CM = 2.4

/**
 * Per-zone gaze-hold multipliers on the base dwell time.
 *
 * Weighted by how much damage an accidental trigger does. UNDO is cheap (redo
 * the stroke). DONE ends your turn with no way back. NEW GAME destroys the
 * whole drawing — and it lives on the reveal panel, exactly where people are
 * looking around admiring the result, so it needs a deliberate hold.
 */
/** Gap below the canvas to the reveal's row of controls, in centimetres. */
const REVEAL_CONTROL_GAP_CM = 5

const DWELL_SCALE = {
  undo: 0.85,
  done: 1.5,
  playagain: 2.6
}

enum Phase {
  Setup,
  Placing,
  Turn,
  Pass,
  Reveal
}

@component
export class ExquisiteCorpseMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Exquisite Corpse – turn order, pass sequence, reveal</span>')
  @ui.separator
  @ui.group_start("References")
  @input canvasController!: ExquisiteCorpseCanvasController
  @input strokeRenderer!: ExquisiteCorpseStrokeRenderer
  @input drawController!: ExquisiteCorpseDrawController
  @input gazeDwell!: ExquisiteCorpseGazeDwell
  @input audioController!: ExquisiteCorpseAudioController
  @input setupUI!: ExquisiteCorpseSetupUI
  @input hudUI!: ExquisiteCorpseHudUI
  @input passUI!: ExquisiteCorpsePassUI
  @input revealUI!: ExquisiteCorpseRevealUI
  @input bandPromptUI!: ExquisiteCorpseBandPromptUI
  @input paletteUI!: ExquisiteCorpsePaletteUI

  @input placementUI!: ExquisiteCorpsePlacementUI

  @input infoUI!: ExquisiteCorpseInfoUI
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("How many sections the canvas is split into. Three matches the head / body / legs prompts.")
  @widget(new SliderWidget(2, 6, 1))
  sectionCount: number = 3

  @input
  @hint("Comma-separated instruction for each section, top to bottom. Shown at the bottom of the band being drawn. Leave an entry blank to give that player no prompt.")
  bandPrompts: string = "Draw a Head, Draw a Body, Draw Legs"

  @input
  @hint("At the start of each turn, turn the canvas to face whoever is wearing the glasses now. It stays exactly where it was locked; only the facing changes. Off means it keeps the facing player 1 placed it with for the whole game.")
  reaimEachTurn: boolean = true

  @input
  @hint("Title card shown on its own once the last player is done, before the drawing appears.")
  finishedLabel: string = "The Finished Piece"

  @input
  @hint("Clear space between the canvas edge and each side rail, in centimetres. Measured from the rail's drawn plate, not its content box.")
  @widget(new SliderWidget(0, 30, 0.5))
  railGapCm: number = 4

  @input
  @hint("Corrects a UIKit Frame drawing its content off-centre. Measured, not guessed: a rail's drawn subtree spans about -1.1 to +7.2cm around its own origin, so without this the LEFT rail eats into the canvas while the RIGHT one floats too far out. Raise if the palette still touches the canvas.")
  @widget(new SliderWidget(-6, 6, 0.05))
  railContentOffsetCm: number = 2.65

  @input
  @hint("Seconds the title card holds on screen alone before it starts to fade. Nothing else is visible during this beat.")
  @widget(new SliderWidget(0, 6, 0.1))
  titleHoldSeconds: number = 1.6

  @input
  @hint("Seconds the title card takes to fade out.")
  @widget(new SliderWidget(0.1, 4, 0.1))
  titleFadeSeconds: number = 0.9

  @input
  @hint("Seconds the drawing takes to draw itself back on, stroke by stroke, in the order it was made.")
  @widget(new SliderWidget(1, 20, 0.5))
  drawOnSeconds: number = 4.5

  @input
  @hint("Seconds the guide lines take to fade away at the reveal. These lines ARE the paper: an additive display cannot paint an opaque white sheet, so the outline and folds stand in for one, and fading them is the sheet coming away.")
  @widget(new SliderWidget(0, 4, 0.1))
  paperFadeSeconds: number = 0.8

  @input
  @hint("Seconds the drawing takes to come alive after the paper has gone. The pause matters: the first blink should land after the corpse has been registered, so it reads as a reaction rather than an idle loop.")
  @widget(new SliderWidget(0, 4, 0.1))
  lifeDelaySeconds: number = 0.5

  @input
  @hint("How far the finished drawing turns toward whoever is looking, as a fraction of the true angle. Well under 1, or it reads as a billboard following you around.")
  @widget(new SliderWidget(0, 1, 0.05))
  leanStrength: number = 0.35

  @input
  @hint("Hard limit on that turn, in degrees.")
  @widget(new SliderWidget(0, 40, 1))
  leanMaxDegrees: number = 14

  @input
  @hint("Drops both side rails so their DRAWN plate tops sit level with the canvas top. A Frame's plate is offset upward from its content, so without this the rails float above the sheet even at zero lift.")
  @widget(new SliderWidget(0, 12, 0.05))
  railVerticalOffsetCm: number = 4.28

  @input
  @hint("Extra outward push for the RIGHT-hand control rail only, in centimetres. A Frame's content sits about 3cm left of its plate, which carries the left rail safely away from the canvas but drives the right rail's buttons into it — so the two sides cannot share one correction.")
  @widget(new SliderWidget(0, 10, 0.1))
  hudRailNudgeCm: number = 3.5

  @input
  @hint("Seconds after the home screen appears during which it keeps re-facing the viewer. At a cold start the camera pose is not established on the first frame, so a panel placed once ends up somewhere the player is not looking — which is why the lens can open to an empty view until it is refreshed. It stops tracking once this elapses, so the panel stays draggable.")
  @widget(new SliderWidget(0, 6, 0.1))
  setupSettleSeconds: number = 2.0

  @input
  @hint("Log phase transitions to the console.")
  debugPhases: boolean = false
  @ui.group_end

  private phase: Phase = Phase.Setup
  private playerCount: number = 0
  private currentIndex: number = 0


  private refsOk: boolean = false
  private dwellArmEvent: DelayedCallbackEvent | null = null
  private setupElapsed: number = 0
  private revealElapsed: number = 0
  private lifeStarted: boolean = false
  private drawOnStarted: boolean = false
  private revealTotalPoints: number = 0
  private revealZoneEvent: DelayedCallbackEvent | null = null

  onAwake(): void {
    this.refsOk = this.validateRefs()
    if (!this.refsOk) return

    // Cross-component calls wait for OnStart. Script order is hierarchy order,
    // so this root's onAwake runs BEFORE its children's — reaching into a
    // sibling controller here hits it before its own onAwake has run.
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private validateRefs(): boolean {
    const missing: string[] = []
    const absent = (x: unknown): boolean => x === null || x === undefined
    if (absent(this.canvasController)) missing.push("canvasController")
    if (absent(this.strokeRenderer)) missing.push("strokeRenderer")
    if (absent(this.drawController)) missing.push("drawController")
    if (absent(this.gazeDwell)) missing.push("gazeDwell")
    if (absent(this.audioController)) missing.push("audioController")
    if (absent(this.setupUI)) missing.push("setupUI")
    if (absent(this.hudUI)) missing.push("hudUI")
    if (absent(this.passUI)) missing.push("passUI")
    if (absent(this.revealUI)) missing.push("revealUI")
    if (absent(this.bandPromptUI)) missing.push("bandPromptUI")
    if (absent(this.paletteUI)) missing.push("paletteUI")
    if (absent(this.placementUI)) missing.push("placementUI")
    if (absent(this.infoUI)) missing.push("infoUI")
    if (missing.length > 0) {
      print("[ExquisiteCorpse] Missing wired inputs: " + missing.join(", ") + ". Lens will not run.")
      return false
    }
    return true
  }

  private onStart(): void {
    this.strokeRenderer.setCanvas(this.canvasController)
    this.drawController.setContext(this.canvasController, this.strokeRenderer)

    // SIK and UI events must be bound in OnStart, not onAwake.
    this.setupUI.onPlaceRequested.add(() => {
      if (this.phase === Phase.Setup) this.enterPlacing()
    })
    this.placementUI.onLockRequested.add(() => this.lockCanvas())

    this.setupUI.onInfoRequested.add(() => this.showInfo())
    this.infoUI.onPlay.add(() => {
      this.infoUI.hide()
      if (this.phase === Phase.Setup) this.enterPlacing()
    })

    this.hudUI.onUndo.add(() => this.onUndo())
    this.hudUI.onDone.add(() => this.finishTurn())
    this.passUI.onReady.add(() => this.onReady())
      this.revealUI.onPlayAgain.add(() => this.playAgain())
    this.revealUI.onReplay.add(() => this.replayDrawOn())

    this.drawController.onStrokeCommitted.add(() => {
      this.hudUI.setUndoEnabled(this.drawController.canUndo)
    })

    // The palette is built from the renderer's own slots, so the chips can
    // never drift from the colours that actually get drawn.
    const palette: vec4[] = []
    for (let i = 0; i < PALETTE_SIZE; i++) palette.push(this.strokeRenderer.colorFor(i))
    this.paletteUI.setColors(palette)
    this.paletteUI.onColorChosen.add((index: number) => {
      this.drawController.setColorIndex(index)
    })

    this.enterSetup()
  }

  private log(msg: string): void {
    if (this.debugPhases) print("[ExquisiteCorpse] " + msg)
  }

  // ── Phase: Setup ───────────────────────────────────────────────────────────

  private enterSetup(): void {
    this.phase = Phase.Setup
    this.log("Setup")
    this.setupElapsed = 0
    // Section count is fixed configuration now, not a question for the player.
    this.applySectionCount()
    this.gazeDwell.setEnabled(false)
    this.gazeDwell.clearZones()
    this.hudUI.hide()
    this.passUI.hide()
    this.revealUI.hide()
    this.bandPromptUI.hide()
    this.paletteUI.hide()
    this.placementUI.hide()
    this.infoUI.hide()
    this.setupUI.show()
    this.setupUI.setStatus("")
    this.placeSetupPanel()
  }

  /** The setup panel is the one surface placed relative to the head, not the canvas. */
  private placeSetupPanel(): void {
    // Reuse the canvas controller's preview maths to sit the panel in front of
    // the player without committing a canvas placement.
    this.canvasController.previewPose()
    this.applyPose(
      this.setupUI.getSceneObject(),
      this.canvasController.poseInFrontOfViewer(this.setupUI.readDistanceCm),
      1.0
    )
  }

  /** The info card replaces the home screen rather than stacking over it. */
  private showInfo(): void {
    if (this.phase !== Phase.Setup) return
    this.setupUI.hide()
    this.applyPose(
      this.infoUI.getSceneObject(),
      this.canvasController.poseInFrontOfViewer(this.infoUI.readDistanceCm),
      1.0
    )
    this.infoUI.show()
  }

  private applySectionCount(): void {
    const n = Math.max(2, Math.min(6, Math.round(this.sectionCount)))
    this.playerCount = n
    this.canvasController.setPlayerCount(n)
    this.strokeRenderer.configure(n)
    this.log("Sections " + n)
  }

  /** Per-band instruction, or "" when the list has no entry for this band. */
  private promptForBand(index: number): string {
    const parts = this.bandPrompts.split(",")
    if (index < 0 || index >= parts.length) return ""
    return parts[index].trim()
  }

  // ── Phase: Placing ─────────────────────────────────────────────────────────

  /**
   * The home screen is dismissed entirely here. Placement is a look-at-the-
   * canvas step, so the title lockup, logo and backing plate all go, leaving
   * the outline plus one line of instruction and the commit button.
   */
  private enterPlacing(): void {
    if (this.playerCount <= 0) return
    this.phase = Phase.Placing
    this.log("Placing")
    this.setupUI.hide()
    this.infoUI.hide()
    this.canvasController.armPlacementHandle(true)
    this.placementUI.show()
  }

  /** While placing, the canvas follows the drag handle and the chrome follows the canvas. */
  private updatePlacing(): void {
    this.canvasController.syncFromHandle()
    // Show the grid you are about to commit to, so "LOCK HERE" is not a guess.
    this.strokeRenderer.previewOutlines()

    // Centred ON the canvas, not below it. The chrome has no backing, so it
    // reads as floating over the surface rather than covering it, and it keeps
    // the instruction and the commit button inside the same glance as the
    // outline the player is positioning.
    const scale = this.panelScale()
    this.applyPose(this.placementUI.getSceneObject(), this.canvasController.poseAtCanvasCentre(), scale)
  }

  private lockCanvas(): void {
    if (this.phase !== Phase.Placing) return
    this.canvasController.lockPlacement()
    this.strokeRenderer.hideAll()
    this.positionWorldPanels()
    this.placementUI.hide()
    this.setupUI.hide()
    this.audioController.playDone()
    this.beginTurn(0)
  }

  /** Park the three world-locked panels relative to the now-fixed canvas. */
  /** The reveal row is posed when it appears, not here — see showRevealControl. */
  private positionWorldPanels(): void {
    const scale = this.panelScale()
    this.applyPose(this.passUI.getSceneObject(), this.canvasController.poseAtCanvasCentre(), scale)
  }

  /** The status bar hangs above the canvas and stays put for the whole session. */
  /**
   * The control rail runs down the RIGHT of the canvas and the palette down the
   * LEFT, both with their top edge level with the canvas top and with each
   * other. Neither is raised above the sheet. Beside rather
   * than above and below, because the Specs field of view is far tighter
   * vertically than horizontally and stacked bars were pushing the drawing out
   * of view.
   */
  private positionStatusBar(): void {
    const scale = this.panelScale()
    this.applyPose(
      this.hudUI.getSceneObject(),
      this.canvasController.poseBesideCanvas(
        1,
        this.railGapCm,
        this.hudUI.plateWidthCm * scale,
        this.hudUI.panelHeightCm * scale,
        -this.railVerticalOffsetCm * scale,
        (this.railContentOffsetCm - this.hudRailNudgeCm) * scale
      ),
      scale
    )
  }

  private positionPaletteRail(): void {
    const scale = this.panelScale()
    this.applyPose(
      this.paletteUI.getSceneObject(),
      this.canvasController.poseBesideCanvas(
        -1,
        this.railGapCm,
        this.paletteUI.plateWidthCm * scale,
        this.paletteUI.panelHeightCm * scale,
        -this.railVerticalOffsetCm * scale,
        this.railContentOffsetCm * scale
      ),
      scale
    )
  }

  /** Keeps apparent panel size constant however far back the canvas sits. */
  private panelScale(): number {
    return this.canvasController.effectiveDistanceCm / PANEL_REFERENCE_DISTANCE_CM
  }

  private applyPose(so: SceneObject, pose: {pos: vec3; rot: quat}, scale: number): void {
    const tr = so.getTransform()
    tr.setWorldPosition(pose.pos)
    tr.setWorldRotation(pose.rot)
    tr.setWorldScale(new vec3(scale, scale, scale))
  }

  // ── Phase: Turn ────────────────────────────────────────────────────────────

  private beginTurn(index: number): void {
    this.phase = Phase.Turn
    this.currentIndex = index
    this.log("Turn " + (index + 1) + "/" + this.playerCount)

    // Square the canvas up to the player who now has the glasses on. Position
    // is untouched, so it stays the same object in the same spot in the room.
    // Must come FIRST: every pose below, and every band mesh, is derived from
    // the canvas basis this changes.
    if (this.reaimEachTurn) {
      this.canvasController.reaimAtViewer()
      this.strokeRenderer.refreshAllBands()
    }

    this.passUI.hide()
    this.revealUI.hide()

    this.positionStatusBar()
    this.strokeRenderer.showTurn(index)
    this.drawController.beginTurn(index, index)

    const promptScale = this.panelScale()
    this.applyPose(
      this.bandPromptUI.getSceneObject(),
      this.canvasController.poseAboveBand(0, PROMPT_GAP_CM),
      promptScale
    )
    this.bandPromptUI.setText(this.promptForBand(index))
    this.bandPromptUI.show()

    // Each player opens on their own slot, then may change it freely.
    const startingColor = index % PALETTE_SIZE
    this.drawController.setColorIndex(startingColor)
    this.paletteUI.setSelectedIndex(startingColor)
    this.positionPaletteRail()
    this.paletteUI.show()

    this.hudUI.setPlayer(index)
    this.hudUI.setControlsVisible(true)
    this.hudUI.setUndoEnabled(false)
    this.hudUI.show()

    this.gazeDwell.clearZones()
    this.gazeDwell.addZone(
      "undo",
      this.hudUI.getButtonCollider("undo"),
      (t) => this.hudUI.setDwellProgress("undo", t),
      () => this.hudUI.triggerButton("undo"),
      () => this.drawController.canUndo,
      DWELL_SCALE.undo
    )
    this.gazeDwell.addZone(
      "done",
      this.hudUI.getButtonCollider("done"),
      (t) => this.hudUI.setDwellProgress("done", t),
      () => this.hudUI.triggerButton("done"),
      () => true,
      DWELL_SCALE.done
    )
    this.armDwellAfterDelay()
  }

  /**
   * Hold gaze dwell off for a moment at the start of a turn.
   *
   * The restart circle on the reveal screen sits in the SAME slot as DONE, and
   * both are dwell targets — so the gaze that just restarted the game is still
   * resting exactly where DONE reappears, and would run straight through it and
   * skip player 1's turn. The same guard covers a turn entered from READY.
   */
  private armDwellAfterDelay(): void {
    this.gazeDwell.setEnabled(false)
    if (!this.dwellArmEvent) {
      this.dwellArmEvent = this.createEvent("DelayedCallbackEvent")
      this.dwellArmEvent.bind(() => {
        if (this.phase === Phase.Turn) this.gazeDwell.setEnabled(true)
      })
    }
    this.dwellArmEvent.reset(DWELL_ARM_DELAY_S)
  }

  private onUndo(): void {
    if (this.phase !== Phase.Turn) return
    if (this.drawController.undo()) {
      this.audioController.playUndo()
      this.hudUI.setUndoEnabled(this.drawController.canUndo)
    }
  }

  /**
   * DONE. Clearing the canvas is the FIRST thing that happens — before the pass
   * UI is touched — so nothing of the finished turn survives into the hand-over.
   */
  private finishTurn(): void {
    if (this.phase !== Phase.Turn) return

    this.strokeRenderer.hideAll() // 1. canvas cleared from view, immediately
    this.drawController.endTurn()
    this.bandPromptUI.hide()
    this.paletteUI.hide()
    this.hudUI.hide()
    this.gazeDwell.setEnabled(false)
    this.gazeDwell.clearZones()

    this.audioController.playDone()

    const next = this.currentIndex + 1
    if (next >= this.playerCount) {
      this.enterReveal()
    } else {
      this.enterPass(next) // 2. only now does the pass instruction appear
    }
  }

  // ── Phase: Pass ────────────────────────────────────────────────────────────

  private enterPass(nextIndex: number): void {
    this.phase = Phase.Pass
    this.currentIndex = nextIndex
    this.log("Pass to " + (nextIndex + 1))

    this.passUI.setTargetPlayer(nextIndex + 1)
    this.passUI.show()

    // READY is a straight pinch, not a dwell — the pass screen is a deliberate
    // hand-off, and the player picking the glasses up is already reaching.
    this.gazeDwell.clearZones()
    this.gazeDwell.setEnabled(false)
  }

  private onReady(): void {
    if (this.phase !== Phase.Pass) return
    this.gazeDwell.setEnabled(false)
    this.beginTurn(this.currentIndex)
  }

  // ── Phase: Reveal ──────────────────────────────────────────────────────────

  private enterReveal(): void {
    this.phase = Phase.Reveal
    this.log("Reveal")

    this.revealElapsed = 0
    this.lifeStarted = false
    this.drawOnStarted = false
    this.canvasController.clearViewerLean()

    // Beat one is the title card ALONE: no strokes, no guides, no controls.
    this.strokeRenderer.hideAll()
    this.strokeRenderer.setGuideFade(0)
    this.paletteUI.hide()
    this.hudUI.hide()
    this.revealUI.hide()
    this.audioController.playReveal()

    // Centred on the canvas rather than above it, so the words sit alone in the
    // middle of an otherwise empty view.
    this.applyPose(
      this.bandPromptUI.getSceneObject(),
      this.canvasController.poseAtCanvasCentre(),
      this.panelScale()
    )
    this.bandPromptUI.showHeadline(this.finishedLabel)
    this.bandPromptUI.setHeadlineOpacity(1)

    this.gazeDwell.clearZones()
    this.gazeDwell.setEnabled(false)
  }

  /**
   * The reveal in four beats: the title card alone, the title fading, the
   * drawing laying itself down stroke by stroke, then the corpse coming alive.
   */
  private updateReveal(): void {
    const dt = getDeltaTime()
    this.revealElapsed += dt

    const hold = this.titleHoldSeconds
    const fadeEnd = hold + Math.max(0.01, this.titleFadeSeconds)
    const drawEnd = fadeEnd + Math.max(0.1, this.drawOnSeconds)

    if (this.revealElapsed < hold) {
      return
    }

    if (this.revealElapsed < fadeEnd) {
      const t = (this.revealElapsed - hold) / Math.max(0.01, this.titleFadeSeconds)
      this.bandPromptUI.setHeadlineOpacity(1 - t)
      return
    }

    if (!this.drawOnStarted) {
      this.drawOnStarted = true
      this.bandPromptUI.hide()
      this.revealTotalPoints = this.strokeRenderer.replayTotalPoints()
      this.strokeRenderer.showReplayPrefix(0)
    }

    if (this.revealElapsed < drawEnd) {
      // Lay the drawing down in the order it was made, so the corpse assembles
      // head first exactly as the players built it.
      const t = (this.revealElapsed - fadeEnd) / Math.max(0.1, this.drawOnSeconds)
      this.strokeRenderer.showReplayPrefix(Math.ceil(t * this.revealTotalPoints))
      return
    }

    if (!this.lifeStarted) {
      this.lifeStarted = true
      this.strokeRenderer.showAll()
      this.strokeRenderer.beginLife()
      this.log(
        (this.strokeRenderer.faceFound ? "Face found" : "No face found — body only") +
          ", hair strokes: " +
          this.strokeRenderer.hairCount
      )
      this.showRevealControl()
    }

    this.canvasController.updateViewerLean(this.leanStrength, this.leanMaxDegrees, dt * 2.0)
    this.strokeRenderer.updateLife(dt)
  }

  /**
   * Play the drawing back: rewind to the draw-on beat and let it lay itself
   * down again, then come alive.
   *
   * Deliberately skips the title card — that belongs to the moment the last
   * player finishes, not to a replay the viewer asked for. The controls stay up
   * throughout, since the viewer chose this and may well want it again.
   */
  private replayDrawOn(): void {
    if (this.phase !== Phase.Reveal) return
    this.log("Replay drawing")
    this.strokeRenderer.stopLife()
    this.canvasController.clearViewerLean()
    this.bandPromptUI.hide()
    this.lifeStarted = false
    this.drawOnStarted = false
    this.revealElapsed = this.titleHoldSeconds + Math.max(0.01, this.titleFadeSeconds)
  }

  /**
   * The restart circle appears only once the drawing is complete — during the
   * title card and the draw-on there is deliberately nothing else on screen.
   */
  private showRevealControl(): void {
    // Centred under the finished drawing rather than beside it: nothing else is
    // on screen now, so the controls can sit where they read as a caption.
    this.applyPose(
      this.revealUI.getSceneObject(),
      this.canvasController.poseBelowCanvas(
        REVEAL_CONTROL_GAP_CM,
        this.revealUI.panelHeightCm * this.panelScale()
      ),
      this.panelScale()
    )
    this.revealUI.show()

    // Register the gaze zone a beat AFTER show(). This panel has no Frame, so
    // its Button builds its collider in a deferred Element.onStart that cannot
    // run until the object is enabled — asking for the collider in the same
    // tick returns null and the zone is silently dropped.
    if (!this.revealZoneEvent) {
      this.revealZoneEvent = this.createEvent("DelayedCallbackEvent")
      this.revealZoneEvent.bind(() => {
        if (this.phase !== Phase.Reveal) return
        // Clear first: a replay runs this path again, and without it the
        // playagain zone would be registered twice over.
        this.gazeDwell.clearZones()
        this.gazeDwell.addZone(
          "playagain",
          this.revealUI.getButtonCollider("playagain"),
          (t) => this.revealUI.setDwellProgress("playagain", t),
          () => this.revealUI.triggerButton("playagain"),
          () => true,
          DWELL_SCALE.playagain
        )
        this.gazeDwell.setEnabled(true)
      })
    }
    this.revealZoneEvent.reset(REVEAL_ZONE_DELAY_S)
  }

  private playAgain(): void {
    this.strokeRenderer.stopLife()
    this.strokeRenderer.setGuideFade(1)
    this.canvasController.clearViewerLean()
    this.log("Play again")
    this.gazeDwell.setEnabled(false)
    this.gazeDwell.clearZones()
    this.revealUI.hide()
    this.hudUI.hide()
    this.strokeRenderer.resetStrokes()
    this.beginTurn(0)
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────

  private onUpdate(): void {
    if (this.phase === Phase.Setup) this.updateSetup()
    else if (this.phase === Phase.Placing) this.updatePlacing()
    else if (this.phase === Phase.Reveal) this.updateReveal()
  }

  /**
   * Keep the home screen in front of the viewer for the first moments of the
   * session.
   *
   * At a cold start the camera transform is not settled on the frame the panel
   * is first placed, so a single placement can leave it behind the player and
   * the lens appears to open to nothing. Re-placing for a short window rides
   * that out. It deliberately STOPS afterwards rather than tracking forever —
   * the panel is world-locked and draggable, and one that followed the head
   * permanently could never be put down.
   */
  private updateSetup(): void {
    if (this.setupElapsed >= this.setupSettleSeconds) return
    this.setupElapsed += getDeltaTime()
    this.placeSetupPanel()
  }

}
