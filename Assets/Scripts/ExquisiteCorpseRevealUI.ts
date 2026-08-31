// ExquisiteCorpseRevealUI.ts
//
// OWNS: the two controls on the reveal screen — REPLAY and NEW GAME, as a
// centred row of pills under the finished drawing.
//
// Worded rather than iconographic: unlike the in-game rail, where an icon has to
// be read at a glance mid-turn, nothing is competing for attention here and the
// labels remove any doubt about which one destroys the drawing.
//
// Deliberately nothing else. The finished corpse is the thing worth looking at,
// so there is no colour key, no headline and no backing plate competing with
// it; the "Finished!" line above the canvas is the only other chrome.
//
// EXPECTS: @inputs listed below. Wired by the bootstrap, positioned by Main.
//
// MUST NOT: know the turn order, the strokes, or the player colours. It emits
// onReplay and onPlayAgain.

import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {NeonButton, WHITE, flexChild, flexRow, obj} from "./ExquisiteCorpseUiCommon"


/** Seconds after the reveal appears before the restart circle accepts input. */
const RESTART_ARM_DELAY_S = 0.6

@component
export class ExquisiteCorpseRevealUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Reveal UI – REPLAY and NEW GAME, under the drawing</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Width of each pill in centimetres.")
  @widget(new SliderWidget(8, 40, 0.5))
  buttonWidthCm: number = 20

  @input
  @hint("Height of each pill in centimetres.")
  @widget(new SliderWidget(3, 12, 0.5))
  buttonHeightCm: number = 5.0

  @input
  @hint("Horizontal gap between the two pills, in centimetres.")
  @widget(new SliderWidget(0.5, 10, 0.1))
  buttonGapCm: number = 2.5

  @input
  @hint("Label on the button that plays the drawing back from the start.")
  replayLabel: string = "REPLAY"

  @input
  @hint("Label on the button that clears the drawing and starts over.")
  playAgainLabel: string = "NEW GAME"

  @input
  @hint("Distance from the viewer in centimetres.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 150

  @input("vec4", "{1.0, 1.0, 1.0, 1.0}")
  @hint("Outline colour of the circle.")
  @widget(new ColorWidget())
  accentColor: vec4 = WHITE
  @ui.group_end

  private playAgainBtn: NeonButton | null = null
  private replayBtn: NeonButton | null = null
  private wantVisible: boolean = false
  // The restart circle appears in EXACTLY the slot DONE occupies during a turn,
  // so the pinch that pressed DONE has its release land here and restarts the
  // game the instant the reveal appears. Measured: playAgain fired 179ms after
  // enterReveal off a single press. The circle stays deaf until the hand that
  // opened this screen has certainly let go.
  private armed: boolean = false

  /** Wide enough for both pills side by side, so Main can centre it. */
  get panelWidthCm(): number {
    return this.buttonWidthCm * 2 + this.buttonGapCm + 2
  }

  /** Block height, matched to the button so its top edge lines up with the canvas. */
  get panelHeightCm(): number {
    return this.buttonHeightCm + 2
  }

  private _onPlayAgain = new Event<void>()
  private _onReplay = new Event<void>()

  get onPlayAgain(): PublicApi<void> {
    return this._onPlayAgain
  }

  get onReplay(): PublicApi<void> {
    return this._onReplay
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")

    // No Frame and no backing plate, so the flex builds here in onAwake and
    // needs none of the deferred-initialisation handling the panelled surfaces
    // have to work around.
    const content = obj(this.sceneObject, "Content")
    const W = this.buttonWidthCm
    const H = this.buttonHeightCm
    const row = flexRow(content, this.panelWidthCm, this.panelHeightCm, {
      gap: this.buttonGapCm,
      justify: FlexJustify.Center,
      align: FlexAlign.Center
    })

    // Play the drawing back. A PINCH, not a dwell: replaying costs nothing, so
    // it does not need the deliberate hold that starting over does.
    flexChild(row, {w: W, h: H}, (cell) => {
      this.replayBtn = new NeonButton(cell, {
        text: this.replayLabel,
        widthCm: W,
        heightCm: H,
        distanceCm: this.readDistanceCm,
        accent: this.accentColor,
        cornerRoundness: 0.5
      })
      this.replayBtn.onTrigger(() => this._onReplay.invoke())
    })

    flexChild(row, {w: W, h: H}, (cell) => {
      this.playAgainBtn = new NeonButton(cell, {
        text: this.playAgainLabel,
        widthCm: W,
        heightCm: H,
        distanceCm: this.readDistanceCm,
        accent: this.accentColor,
        cornerRoundness: 0.5,
        withDwell: true
      })
      this.playAgainBtn.onTrigger(() => {
        if (this.armed) this._onPlayAgain.invoke()
      })
    })

    // Hide one frame LATE, not here. A UIKit Button builds its collider in a
    // deferred Element.onStart; disabling the host in the same tick stops that
    // ever running, and getButtonCollider() then returns null forever —
    // which is exactly why the log read "Dwell zone 'playagain' has no
    // collider" and gaze never worked on this button.
    const settle = this.createEvent("DelayedCallbackEvent")
    settle.bind(() => {
      if (!this.wantVisible) this.sceneObject.enabled = false
    })
    settle.reset(0.05)
  }

  setDwellProgress(buttonName: string, t: number): void {
    if (buttonName === "playagain" && this.playAgainBtn) this.playAgainBtn.setProgress(t)
  }

  getButtonCollider(buttonName: string): ColliderComponent | null {
    if (buttonName === "playagain" && this.playAgainBtn) return this.playAgainBtn.collider
    return null
  }

  triggerButton(buttonName: string): void {
    if (buttonName !== "playagain") return
    if (!this.playAgainBtn || !this.playAgainBtn.isEnabled || !this.armed) return
    this._onPlayAgain.invoke()
  }

  show(): void {
    this.wantVisible = true
    this.sceneObject.enabled = true
    this.armed = false
    const arm = this.createEvent("DelayedCallbackEvent")
    arm.bind(() => {
      this.armed = true
    })
    arm.reset(RESTART_ARM_DELAY_S)
  }

  hide(): void {
    this.wantVisible = false
    this.armed = false
    this.setDwellProgress("playagain", 0)
    this.sceneObject.enabled = false
  }
}
