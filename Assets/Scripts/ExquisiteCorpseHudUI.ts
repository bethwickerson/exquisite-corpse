// ExquisiteCorpseHudUI.ts
//
// OWNS: the in-turn control rail — a narrow VERTICAL stack that sits beside the
// canvas rather than above it, so nothing competes with the drawing surface for
// the limited vertical field of view.
//
// Top to bottom: the player indicator, DONE (solid white disc), UNDO, mute.
//
// The two buttons are icon-only circles. DONE is a white disc with the tick
// knocked OUT of its alpha rather than a black tick drawn on white: Specs is an
// additive display, so black is simply absent light and a black glyph painted
// over white would be invisible. The knockout reads as a dark tick because the
// world shows through where the disc does not paint.
//
// EXPECTS: @inputs listed below. Wired by the bootstrap. Positioned by Main at
// the top-right of the canvas, coplanar with it.
//
// MUST NOT: decide when a turn ends, track strokes, or read game state. It
// renders what it is given and emits onUndo / onDone.

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {
  CONTENT_Z,
  NeonButton,
  WHITE,
  addIcon,
  columnText,
  flexChild,
  flexColumn,
  flexRow,
  obj,
  rowText
} from "./ExquisiteCorpseUiCommon"

const ICON_UNDO = requireAsset("../Icons/undo.png") as Texture
const ICON_SOUND_ON = requireAsset("../Icons/volume_up.png") as Texture
const ICON_SOUND_OFF = requireAsset("../Icons/volume_off.png") as Texture
const ICON_CHECK_FILLED = requireAsset("../Icons/check_filled.png") as Texture
const ICON_PLAYER = requireAsset("../Icons/person.png") as Texture

/** Width of the cell holding the player number. One or two digits, no more. */
const PLAYER_NUMBER_CELL_CM = 2.6

/** Seconds after the rail appears before its buttons accept input. */
const RAIL_ARM_DELAY_S = 0.5

@component
export class ExquisiteCorpseHudUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">HUD Rail – vertical DONE / player / UNDO beside the canvas</span>')
  @ui.separator
  @ui.group_start("Settings")

  @input
  @hint("Rail height in centimetres.")
  @widget(new SliderWidget(14, 60, 0.5))
  panelHeightCm: number = 34

  @input
  @hint("Diameter of the round DONE and UNDO buttons, in centimetres. Below about 6cm at this distance they fall under the gaze-dwell target minimum.")
  @widget(new SliderWidget(4, 16, 0.5))
  buttonSizeCm: number = 6

  @input
  @hint("Space added around the controls to make the plate, in centimetres. This is the direct width control: the rail is always the widest control plus this, so it can never end up too narrow to hold its contents. Negative pulls the plate in tighter than the buttons.")
  @widget(new SliderWidget(-2, 8, 0.1))
  extraWidthCm: number = 0.1

  @input
  @hint("Multiplier on the icon inside each button. Above 1 makes the glyph fill more of the circle.")
  @widget(new SliderWidget(0.5, 2.0, 0.05))
  iconScale: number = 1.15

  @input
  @hint("Extra space below the player row, in centimetres. Pushes the buttons down clear of the prompt line.")
  @widget(new SliderWidget(0, 8, 0.1))
  playerGapCm: number = 1.6

  @input
  @hint("Size of the player-count icon in centimetres.")
  @widget(new SliderWidget(2, 10, 0.5))
  playerIconCm: number = 4.0

  @input
  @hint("Size of the player number beside the head icon, relative to the read distance.")
  @widget(new SliderWidget(0.25, 1.5, 0.05))
  playerNumberScale: number = 0.55

  @input
  @hint("Distance from the viewer in centimetres. Scales text on this rail.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 150

  @input("vec4", "{1.0, 1.0, 1.0, 1.0}")
  @hint("Outline colour of the UNDO circle.")
  @widget(new ColorWidget())
  accentColor: vec4 = WHITE

  @input
  @hint("Opacity of the rail's backing plate. Specs is additive, so a solid plate ADDS light. Keep low, or zero for no plate at all.")
  @widget(new SliderWidget(0.0, 1.0, 0.05))
  panelOpacity: number = 0.65
  @ui.group_end

  private undoBtn: NeonButton | null = null
  private muteBtn: NeonButton | null = null
  private muteCell: SceneObject | null = null

  /**
   * Rail width is DERIVED from its widest row, so it hugs the controls instead
   * of being a separate number that has to be kept in step with them.
   */
  get panelWidthCm(): number {
    const playerRow = this.playerIconCm + 0.5 + PLAYER_NUMBER_CELL_CM
    return Math.max(this.buttonSizeCm, playerRow) + this.extraWidthCm
  }

  /**
   * Width of the DRAWN backing plate.
   *
   * Frame sets its visual to innerSize (Frame.ts sets the frame visual size to
   * innerSize directly); `padding` only feeds totalSize, which sizes the
   * collider. So the plate the player sees is innerSize, and spacing the rails
   * off anything wider just pushes them out for no visible reason.
   */
  get plateWidthCm(): number {
    return this.panelWidthCm
  }
  private doneBtn: NeonButton | null = null
  private playerNumber: Text | null = null
  private playerCell: SceneObject | null = null
  private controlsCell: SceneObject | null = null
  private doneCell: SceneObject | null = null
  private wantVisible: boolean = false
  private frameReady: boolean = false
  // The rail refuses input for a moment after it appears. Its DONE circle sits
  // in exactly the slot the reveal screen's restart circle occupies, so the
  // press that restarted the game would otherwise have its release land on
  // DONE and skip straight past player 1's turn. Buttons are pinchable whether
  // or not a dwell zone is registered, so the guard has to live here, not in
  // the dwell controller.
  private armed: boolean = false

  private _onUndo = new Event<void>()
  private _onDone = new Event<void>()
  private _onMuteToggled = new Event<void>()

  get onUndo(): PublicApi<void> {
    return this._onUndo
  }

  get onDone(): PublicApi<void> {
    return this._onDone
  }

  get onMuteToggled(): PublicApi<void> {
    return this._onMuteToggled
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")

    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false
    frame.autoScaleContent = false
    frame.allowScaling = false

    frame.onInitialized.add(() => {
      const W = this.panelWidthCm
      const H = this.panelHeightCm
      frame.innerSize = new vec2(W, H)
      frame.padding = new vec2(0.05, 1.0)
      frame.opacity = this.panelOpacity

      const content = obj(
        frame.contentTransform.getSceneObject(),
        "Content",
        new vec3(0, 0, CONTENT_Z)
      )

      // Packed to the TOP, not centred: the rail is top-aligned with the canvas
      // edge, and centred content would float the first button down by half the
      // rail's slack, breaking that alignment whenever the button size changes.
      const col = flexColumn(content, W, H, {
        gap: 1.6,
        padX: 0.1,
        padY: 1.0,
        justify: FlexJustify.Start,
        align: FlexAlign.Center
      })

      const D = this.buttonSizeCm

      // Player indicator: head glyph plus the current number, no button.
      // FIRST in the stack, and Main lifts the whole rail so this row sits on
      // the same line as the turn prompt above the canvas.
      this.playerCell = flexChild(col, {w: W - 1.4, h: this.playerIconCm, mb: this.playerGapCm}, (cell) => {
        const row = flexRow(cell, W - 1.6, this.playerIconCm, {
          gap: 0.5,
          justify: FlexJustify.Center,
          align: FlexAlign.Center
        })
        flexChild(row, {w: this.playerIconCm, h: this.playerIconCm}, (c) => {
          addIcon(c, ICON_PLAYER, this.playerIconCm)
        })
        flexChild(row, {w: PLAYER_NUMBER_CELL_CM, h: this.playerIconCm}, (c) => {
          this.playerNumber = rowText(
            c,
            "1",
            "Caption",
            PLAYER_NUMBER_CELL_CM,
            this.readDistanceCm * this.playerNumberScale,
            WHITE
          )
        })
      })

      // DONE sits below the player row.
      this.doneCell = flexChild(col, {w: D, h: D}, (cell) => {
        this.doneBtn = new NeonButton(cell, {
          text: "",
          widthCm: D,
          heightCm: D,
          distanceCm: this.readDistanceCm,
          icon: ICON_CHECK_FILLED,
          accent: this.accentColor,
          solidFace: true,
          cornerRoundness: 0.5,
          withDwell: true
        })
        this.doneBtn.onTrigger(() => {
          if (this.armed) this._onDone.invoke()
        })
      })

      this.controlsCell = flexChild(col, {w: D, h: D}, (cell) => {
        this.undoBtn = new NeonButton(cell, {
          text: "",
          widthCm: D,
          heightCm: D,
          distanceCm: this.readDistanceCm,
          icon: ICON_UNDO,
          accent: this.accentColor,
          iconScale: this.iconScale,
          cornerRoundness: 0.5,
          withDwell: true
        })
        this.undoBtn.onTrigger(() => {
          if (this.armed) this._onUndo.invoke()
        })
      })

      this.muteCell = flexChild(col, {w: D, h: D}, (cell) => {
        this.muteBtn = new NeonButton(cell, {
          text: "",
          widthCm: D,
          heightCm: D,
          distanceCm: this.readDistanceCm,
          icon: ICON_SOUND_ON,
          accent: this.accentColor,
          iconScale: this.iconScale,
          cornerRoundness: 0.5
        })
        // Pinch, not dwell: muting is cheap to undo, so it does not warrant the
        // deliberate hold the commit actions get.
        this.muteBtn.onTrigger(() => {
          if (this.armed) this._onMuteToggled.invoke()
        })
      })

      this.frameReady = true
      this.applyInitialVisibility()
    })
  }

  private buttonByName(name: string): NeonButton | null {
    if (name === "undo") return this.undoBtn
    if (name === "done") return this.doneBtn
    return null
  }

  /** Sets the number beside the head glyph. 0-based index in, 1-based shown. */
  setPlayer(index: number): void {
    if (this.playerNumber) this.playerNumber.text = String(index + 1)
  }

  /** Swap the speaker glyph so the button shows the CURRENT state. */
  setMuted(muted: boolean): void {
    if (this.muteBtn) this.muteBtn.setIcon(muted ? ICON_SOUND_OFF : ICON_SOUND_ON)
  }

  setUndoEnabled(on: boolean): void {
    if (this.undoBtn) this.undoBtn.setEnabled(on)
  }

  /** Hides the whole rail's contents — used once the drawing is finished. */
  setControlsVisible(on: boolean): void {
    if (this.controlsCell) this.controlsCell.enabled = on
    if (this.doneCell) this.doneCell.enabled = on
    if (this.playerCell) this.playerCell.enabled = on
    if (this.muteCell) this.muteCell.enabled = on
  }

  setDwellProgress(buttonName: string, t: number): void {
    const b = this.buttonByName(buttonName)
    if (b) b.setProgress(t)
  }

  getButtonCollider(buttonName: string): ColliderComponent | null {
    const b = this.buttonByName(buttonName)
    return b ? b.collider : null
  }

  triggerButton(buttonName: string): void {
    const b = this.buttonByName(buttonName)
    if (!b || !b.isEnabled || !this.armed) return
    if (buttonName === "undo") this._onUndo.invoke()
    else if (buttonName === "done") this._onDone.invoke()
  }

  show(): void {
    this.wantVisible = true
    this.sceneObject.enabled = true
    this.armed = false
    const arm = this.createEvent("DelayedCallbackEvent")
    arm.bind(() => {
      this.armed = true
    })
    arm.reset(RAIL_ARM_DELAY_S)
  }

  hide(): void {
    this.wantVisible = false
    this.armed = false
    this.setDwellProgress("undo", 0)
    this.setDwellProgress("done", 0)
    if (this.frameReady) this.sceneObject.enabled = false
  }

  /**
   * Resolve start-visibility one frame late when the rail starts hidden — a
   * UIKit Button finishes its own setup in a deferred Element.onStart, and
   * disabling the host in the same tick stops that ever running, which would
   * leave getButtonCollider() returning null and kill gaze dwell.
   */
  private applyInitialVisibility(): void {
    if (this.wantVisible) {
      this.sceneObject.enabled = true
      return
    }
    const delayed = this.createEvent("DelayedCallbackEvent")
    delayed.bind(() => {
      if (!this.wantVisible) this.sceneObject.enabled = false
    })
    delayed.reset(0.05)
  }
}
