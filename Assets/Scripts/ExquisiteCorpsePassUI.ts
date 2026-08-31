// ExquisiteCorpsePassUI.ts
//
// OWNS: the pass screen — "PASS TO PLAYER N" plus the gaze-dwell READY zone.
// This surface deliberately shows nothing else: no drawing, no seam, no
// thumbnail. The canvas is cleared before this panel is ever shown.
//
// EXPECTS: @inputs listed below. Wired by the bootstrap.
//
// MUST NOT: render any part of the drawing, or decide who is next. It is told
// which player to name and emits onReady.

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {
  CONTENT_Z,
  NeonButton,
  WHITE,
  columnText,
  flexChild,
  flexColumn,
  obj
} from "./ExquisiteCorpseUiCommon"

/** Seconds after the pass screen appears before READY will accept a pinch. */
const READY_ARM_DELAY_S = 0.4

@component
export class ExquisiteCorpsePassUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Pass UI – hand-over screen and READY dwell zone</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Panel width in centimetres.")
  @widget(new SliderWidget(24, 80, 1))
  panelWidthCm: number = 62

  @input
  @hint("Panel height in centimetres.")
  @widget(new SliderWidget(14, 50, 1))
  panelHeightCm: number = 18.5

  @input
  @hint("Distance from the viewer in centimetres. Scales all text on this panel.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 150

  @input("vec4", "{1.0, 1.0, 1.0, 1.0}")
  @hint("Outline colour of the READY capsule.")
  @widget(new ColorWidget())
  accentColor: vec4 = WHITE

  @input
  @hint("Opacity of the panel's backing plate. Specs is additive, so a solid plate ADDS light and washes out the text on it. Keep low.")
  @widget(new SliderWidget(0.05, 1.0, 0.05))
  panelOpacity: number = 0.35

  @input
  @hint("Extra multiplier on this panel's text size, on top of the global type scale. Raise if labels still read small on device.")
  @widget(new SliderWidget(0.6, 2.5, 0.05))
  textScale: number = 1.0

  @input
  @hint("Size of the 'PASS TO PLAYER N' line relative to the read distance. Sits a step above the instructional labels without becoming a poster.")
  @widget(new SliderWidget(0.25, 1.5, 0.05))
  headlineScale: number = 0.7
  @ui.group_end

  private headlineText: Text | null = null
  private readyBtn: NeonButton | null = null
  private wantVisible: boolean = false
  // READY refuses to fire for a moment after the screen appears. DONE completes
  // by gaze dwell, so a hand that happens to be mid-pinch at that instant would
  // otherwise have its release land on READY and skip the hand-off entirely —
  // the one moment in the game that must not be skippable.
  private armed: boolean = false
  // Set once the Frame has initialised and built its content. Until then a
  // hide() only records intent — disabling the SceneObject before the Frame
  // reaches OnStart stops it initialising at all, leaving an empty panel that
  // can never be shown again.
  private frameReady: boolean = false

  private _onReady = new Event<void>()

  get onReady(): PublicApi<void> {
    return this._onReady
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
      frame.padding = new vec2(2.0, 2.0)
      frame.opacity = this.panelOpacity

      const content = obj(frame.contentTransform.getSceneObject(), "Content", new vec3(0, 0, CONTENT_Z))

      const col = flexColumn(content, W, H, {
        gap: 2.0,
        padX: 2.0,
        padY: 2.0,
        justify: FlexJustify.Center,
        align: FlexAlign.Stretch
      })

      flexChild(col, {w: W - 4, h: 6.0}, (c) => {
        this.headlineText = columnText(
          c,
          "PASS TO PLAYER 2",
          "Headline1",
          W - 5,
          this.readDistanceCm * this.headlineScale,
          WHITE
        )
      })

      flexChild(col, {w: W - 4, h: 6.4}, (c) => {
        this.readyBtn = new NeonButton(c, {
          text: "READY",
          widthCm: 26,
          heightCm: 6.0,
          distanceCm: this.readDistanceCm,
          accent: this.accentColor
        })
        this.readyBtn.onTrigger(() => {
          if (this.armed) this._onReady.invoke()
        })
      })

      this.frameReady = true
      this.applyInitialVisibility()
    })
  }

  setTargetPlayer(n: number): void {
    if (this.headlineText) this.headlineText.text = "PASS TO PLAYER " + n
  }

  setDwellProgress(buttonName: string, t: number): void {
    if (buttonName === "ready" && this.readyBtn) this.readyBtn.setProgress(t)
  }

  getButtonCollider(buttonName: string): ColliderComponent | null {
    if (buttonName === "ready" && this.readyBtn) return this.readyBtn.collider
    return null
  }

  triggerButton(buttonName: string): void {
    if (buttonName === "ready" && this.readyBtn && this.readyBtn.isEnabled) {
      this._onReady.invoke()
    }
  }

  show(): void {
    this.wantVisible = true
    this.sceneObject.enabled = true
    this.armed = false
    const arm = this.createEvent("DelayedCallbackEvent")
    arm.bind(() => {
      this.armed = true
    })
    arm.reset(READY_ARM_DELAY_S)
    this.setDwellProgress("ready", 0)
  }

  hide(): void {
    this.wantVisible = false
    this.armed = false
    this.setDwellProgress("ready", 0)
    if (this.frameReady) this.sceneObject.enabled = false
  }


  /**
   * applyTextRole scales by (distance / 110), so multiplying the distance we
   * hand it is exactly equivalent to multiplying the font size — it lets the
   * per-panel textScale knob work without threading a new argument through
   * every text and button call.
   */
  private get typeDistance(): number {
    return this.readDistanceCm * this.textScale
  }

  /**
   * Resolve start-visibility one frame late when the panel starts hidden.
   *
   * A UIKit Button finishes its own setup (collider + Interactable) in its
   * Element.onStart, which is deferred — disabling the panel in the same tick
   * it was built means that never runs, and getButtonCollider() then returns
   * null forever, silently killing gaze dwell on this panel.
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
