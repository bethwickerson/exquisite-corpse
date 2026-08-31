// ExquisiteCorpseInfoUI.ts
//
// OWNS: the rules-and-history card reached from the home screen's ? button.
//
// Carries its own PLAY button so a player who opens it to check the rules can
// start from here rather than being sent back to close a panel first.
//
// EXPECTS: @inputs below. Wired by the bootstrap, posed by Main in front of the
// viewer like the home screen.
//
// MUST NOT: own game state. It emits onPlay — the only way off this card,
// since starting the game is the only thing anyone wants from it.

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {
  CONTENT_Z,
  NeonButton,
  THEME_SERIF,
  WHITE,
  WHITE_DIM,
  columnText,
  flexChild,
  flexColumn,
  obj
} from "./ExquisiteCorpseUiCommon"

@component
export class ExquisiteCorpseInfoUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Info UI – rules and history, with its own PLAY</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Panel width in centimetres.")
  @widget(new SliderWidget(30, 90, 1))
  panelWidthCm: number = 62

  @input
  @hint("Panel height in centimetres.")
  @widget(new SliderWidget(20, 80, 1))
  panelHeightCm: number = 56

  @input
  @hint("Heading at the top of the card.")
  titleText: string = "How to Play"

  @input
  @hint("The rules, one step per line. Use | to separate lines.")
  rulesText: string =
    "Each player draws one section of a body.|You see only a sliver of the section above.|Press DONE (\u2713), then hand the glasses on.|The whole creature is revealed at the end."

  @input
  @hint("Heading above the history paragraph.")
  historyTitle: string = "Where it comes from"

  @input
  @hint("The history paragraph. Use | to separate lines.")
  historyText: string =
    "A parlour game invented by the Surrealists|in Paris around 1925. It takes its name from|the first sentence it produced: the exquisite|corpse shall drink the new wine."

  @input
  @hint("Size of the headings relative to the read distance.")
  @widget(new SliderWidget(0.2, 2, 0.05))
  headingScale: number = 0.62

  @input
  @hint("Size of the body lines relative to the read distance.")
  @widget(new SliderWidget(0.2, 2, 0.05))
  bodyScale: number = 0.45

  @input
  @hint("Distance from the viewer in centimetres. Scales all text on this card.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 130

  @input("vec4", "{0.09, 0.69, 0.77, 1.0}")
  @hint("Outline colour of the buttons and the accent heading.")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(0.09, 0.69, 0.77, 1)

  @input
  @hint("Opacity of the panel's backing plate. Specs is additive, so a solid plate ADDS light. Keep low.")
  @widget(new SliderWidget(0.05, 1.0, 0.05))
  panelOpacity: number = 0.6
  @ui.group_end

  private playBtn: NeonButton | null = null
  private wantVisible: boolean = false
  private frameReady: boolean = false

  private _onPlay = new Event<void>()

  get onPlay(): PublicApi<void> {
    return this._onPlay
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
      frame.padding = new vec2(2.0, 1.6)
      frame.opacity = this.panelOpacity

      const content = obj(frame.contentTransform.getSceneObject(), "Content", new vec3(0, 0, CONTENT_Z))
      const col = flexColumn(content, W, H, {
        gap: 0.9,
        padX: 2.0,
        padY: 1.4,
        justify: FlexJustify.Center,
        align: FlexAlign.Stretch
      })

      flexChild(col, {w: W - 4, h: 5.0, mb: 0.8}, (c) => {
        columnText(c, this.titleText, "Title2", W - 5, this.readDistanceCm * this.headingScale, WHITE, {
          font: THEME_SERIF,
          italic: false
        })
      })

      this.addLines(col, W, this.rulesText, WHITE_DIM)

      flexChild(col, {w: W - 4, h: 4.2, mt: 1.6, mb: 0.6}, (c) => {
        columnText(
          c,
          this.historyTitle,
          "Title2",
          W - 5,
          this.readDistanceCm * this.headingScale * 0.82,
          this.accentColor,
          {font: THEME_SERIF, italic: true}
        )
      })

      this.addLines(col, W, this.historyText, WHITE_DIM)

      flexChild(col, {w: W - 4, h: 6.6, mt: 1.8}, (c) => {
        this.playBtn = new NeonButton(c, {
          text: "PLAY",
          widthCm: 26,
          heightCm: 6.0,
          distanceCm: this.readDistanceCm,
          accent: this.accentColor
        })
        this.playBtn.onTrigger(() => this._onPlay.invoke())
      })

      this.frameReady = true
      this.applyInitialVisibility()
    })
  }

  /** One Text per line: pipe-separated so the copy stays editable in the Inspector. */
  private addLines(col: SceneObject, W: number, source: string, color: vec4): void {
    const lines = source.split("|")
    for (const raw of lines) {
      const line = raw.trim()
      if (line.length === 0) continue
      flexChild(col, {w: W - 4, h: 3.0}, (c) => {
        columnText(c, line, "Caption", W - 5, this.readDistanceCm * this.bodyScale, color)
      })
    }
  }

  show(): void {
    this.wantVisible = true
    this.sceneObject.enabled = true
  }

  hide(): void {
    this.wantVisible = false
    if (this.frameReady) this.sceneObject.enabled = false
  }

  /**
   * Resolve start-visibility one frame late when the card starts hidden — a
   * UIKit Button finishes its setup in a deferred Element.onStart, and
   * disabling the host in the same tick stops that ever running.
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
