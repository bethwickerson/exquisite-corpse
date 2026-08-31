// ExquisiteCorpseSetupUI.ts
//
// OWNS: the home screen — the title lockup and the PLACE CANVAS button.
//
// It is dismissed entirely once placement begins; the placement step has its
// own minimal chrome so nothing competes with the canvas outline there. Pinch
// driven, like the other pre-game surfaces; gaze dwell is reserved for the
// in-game commit actions (DONE / READY / UNDO) per the game spec.
//
// EXPECTS: @inputs listed below. Wired by the bootstrap.
//
// MUST NOT: hold game state or decide anything. It reports the chosen player
// count and a place request, and renders whatever status string it is given.

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

const ICON_SOUND_ON = requireAsset("../Icons/volume_up.png") as Texture
const ICON_SOUND_OFF = requireAsset("../Icons/volume_off.png") as Texture
const ICON_HELP = requireAsset("../Icons/question_mark.png") as Texture

import {
  CONTENT_Z,
  NeonButton,
  THEME_SERIF,
  WHITE,
  WHITE_DIM,
  addAdditiveImage,
  addRule,
  SERIF_WIDTH_FACTOR,
  estimateTextWidthCm,
  columnText,
  flexChild,
  flexColumn,
  flexRow,
  obj,
  rowText
} from "./ExquisiteCorpseUiCommon"

@component
export class ExquisiteCorpseSetupUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Setup UI – player count and canvas placement</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Logo mark shown above the title. CorpseLogoAdditive is the luminance-flipped version that reads on an additive display; CorpseLogoOriginal is the artwork as supplied.")
  logoTexture!: Texture
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Diameter of the round mute and info buttons under PLAY, in centimetres.")
  @widget(new SliderWidget(3, 12, 0.5))
  utilityButtonSizeCm: number = 6

  @input
  @hint("Panel width in centimetres.")
  @widget(new SliderWidget(24, 80, 1))
  panelWidthCm: number = 56

  @input
  @hint("Panel height in centimetres.")
  @widget(new SliderWidget(16, 60, 1))
  panelHeightCm: number = 68

  @input
  @hint("First word of the title, set upright in the serif face.")
  titleText: string = "Exquisite"

  @input
  @hint("Size of the Exquisite Corpse lockup only, on top of Text Scale. Raise this to enlarge the headline without touching the strapline or the button.")
  @widget(new SliderWidget(0.5, 3, 0.05))
  titleScale: number = 1.6

  @input
  @hint("Second word of the title, set italic in the accent colour.")
  subtitleWord: string = "Corpse"

  @input
  @hint("Strapline under the title.")
  straplineText: string = "3 PLAYERS \u00B7 ONE PAIR \u00B7 ONE CREATION"


  @input
  @hint("Size of the strapline relative to the rest of the UI. Below 1 takes it under the type scale's smallest role, which is intended here so it sits well beneath the title.")
  @widget(new SliderWidget(0.4, 1.5, 0.05))
  straplineScale: number = 0.7

  @input
  @hint("Gap between the title word and each flanking hairline, in centimetres.")
  @widget(new SliderWidget(0.2, 6, 0.1))
  ruleGapCm: number = 0.6

  @input
  @hint("Vertical space between the two title words, in centimetres. Negative sets them tighter than the line height.")
  @widget(new SliderWidget(-6, 4, 0.1))
  titleLeadingCm: number = -2.2

  @input
  @hint("Thickness of the hairlines flanking the title word, in centimetres. Below about 0.25 they fall under a pixel at panel distance and vanish.")
  @widget(new SliderWidget(0.05, 1.5, 0.05))
  ruleThicknessCm: number = 0.25

  @input
  @hint("Size of the logo mark above the title, in centimetres.")
  @widget(new SliderWidget(4, 30, 0.5))
  logoSizeCm: number = 14

  @input("vec4", "{1.0, 1.0, 1.0, 1.0}")
  @hint("Tint multiplied into the logo. White keeps the artwork's own colours.")
  @widget(new ColorWidget())
  logoTint: vec4 = WHITE

  @input
  @hint("Distance from the viewer in centimetres. Scales all text on this panel.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 130

  @input("vec4", "{0.09, 0.69, 0.77, 1.0}")
  @hint("Accent colour: the italic title word and the capsule outlines. Matches the cyan in the hero art.")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(0.09, 0.69, 0.77, 1)

  @input
  @hint("Opacity of the panel's backing plate. Specs is additive, so a solid plate ADDS light and washes out the text on it. Keep low.")
  @widget(new SliderWidget(0.05, 1.0, 0.05))
  panelOpacity: number = 0.35

  @input
  @hint("Multiplier on EVERY text size on this panel — title, strapline and status together. For the headline alone use Title Scale.")
  @widget(new SliderWidget(0.6, 2.5, 0.05))
  textScale: number = 1.0
  @ui.group_end

  private statusText: Text | null = null
  private placeBtn: NeonButton | null = null
  private muteBtn: NeonButton | null = null
  private infoBtn: NeonButton | null = null
  private wantVisible: boolean = true
  // Set once the Frame has initialised and built its content. Until then a
  // hide() only records intent — disabling the SceneObject before the Frame
  // reaches OnStart stops it initialising at all, leaving an empty panel that
  // can never be shown again.
  private frameReady: boolean = false

  private _onPlaceRequested = new Event<void>()
  private _onMuteToggled = new Event<void>()
  private _onInfoRequested = new Event<void>()

  get onPlaceRequested(): PublicApi<void> {
    return this._onPlaceRequested
  }

  get onMuteToggled(): PublicApi<void> {
    return this._onMuteToggled
  }

  get onInfoRequested(): PublicApi<void> {
    return this._onInfoRequested
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
        gap: 0.8,
        padX: 2.0,
        padY: 2.0,
        justify: FlexJustify.Center,
        align: FlexAlign.Stretch
      })

      // Logo mark, additively blended so it reads as emitted light. Wrapped in
      // a centred ROW: the column stretches its children to full width, which
      // would flatten a square mark into a wide ellipse.
      flexChild(col, {w: W - 4, h: this.logoSizeCm, mb: 0.4}, (c) => {
        const logoRow = flexRow(c, W - 5, this.logoSizeCm, {
          justify: FlexJustify.Center,
          align: FlexAlign.Center
        })
        if (this.logoTexture !== null && this.logoTexture !== undefined) {
          flexChild(logoRow, {w: this.logoSizeCm, h: this.logoSizeCm}, (cell) => {
            addAdditiveImage(cell, this.logoTexture, this.logoSizeCm, this.logoSizeCm, this.logoTint)
          })
        }
      })

      // "Exquisite" — upright serif.
      const titleDist = this.typeDistance * this.titleScale
      flexChild(col, {w: W - 4, h: 7.0 * this.titleScale, mb: this.titleLeadingCm}, (c) => {
        columnText(c, this.titleText, "Title1", W - 5, titleDist, WHITE, {
          font: THEME_SERIF,
          italic: false
        })
      })

      // "Corpse" — italic serif in the accent colour, flanked by hairlines,
      // mirroring the lockup in the supplied hero art.
      flexChild(col, {w: W - 4, h: 8.0 * this.titleScale, mb: 1.8}, (c) => {
        const row = flexRow(c, W - 5, 7.6 * this.titleScale, {
          gap: this.ruleGapCm,
          justify: FlexJustify.Center,
          align: FlexAlign.Center
        })
        flexChild(row, {w: 10, h: 1.2}, (lhs) => {
          addRule(lhs, 10, this.ruleThicknessCm, WHITE_DIM)
        })
        // Size the cell to the WORD, not to a fixed slot. A generous cell
        // leaves dead space inside it that no amount of gap tuning can close,
        // because the gap spaces cells and the glyphs float in the middle.
        // Corrected for the serif: the raw estimate is calibrated on mono caps
        // and would claim the whole row, squeezing out the flanking rules.
        const wordW =
          (estimateTextWidthCm("Title1", this.subtitleWord.length, titleDist) * 1.06) /
          SERIF_WIDTH_FACTOR
        flexChild(row, {w: wordW, h: 7.4 * this.titleScale}, (cell) => {
          rowText(cell, this.subtitleWord, "Title1", wordW, titleDist, this.accentColor, {
            font: THEME_SERIF,
            italic: true
          })
        })
        flexChild(row, {w: 10, h: 1.2}, (rhs) => {
          addRule(rhs, 10, this.ruleThicknessCm, WHITE_DIM)
        })
      })

      flexChild(col, {w: W - 4, h: 3.2, mb: 1.0}, (c) => {
        columnText(
          c,
          this.straplineText,
          "Caption",
          W - 5,
          this.typeDistance * this.straplineScale,
          WHITE_DIM
        )
      })

      flexChild(col, {w: W - 4, h: 6.4}, (c) => {
        this.placeBtn = new NeonButton(c, {
          text: "PLAY",
          widthCm: 28,
          heightCm: 6.0,
          distanceCm: this.readDistanceCm,
          accent: this.accentColor
        })
        this.placeBtn.onTrigger(() => this._onPlaceRequested.invoke())
      })

      // Mute and info, side by side under PLAY. Icon-only circles, matching the
      // in-game controls so the vocabulary stays consistent.
      const D = this.utilityButtonSizeCm
      flexChild(col, {w: W - 4, h: D + 0.6, mt: 1.2}, (c) => {
        const row = flexRow(c, W - 5, D + 0.4, {
          gap: 2.4,
          justify: FlexJustify.Center,
          align: FlexAlign.Center
        })
        flexChild(row, {w: D, h: D}, (cell) => {
          this.muteBtn = new NeonButton(cell, {
            text: "",
            widthCm: D,
            heightCm: D,
            icon: ICON_SOUND_ON,
            accent: this.accentColor,
            cornerRoundness: 0.5
          })
          this.muteBtn.onTrigger(() => this._onMuteToggled.invoke())
        })
        flexChild(row, {w: D, h: D}, (cell) => {
          this.infoBtn = new NeonButton(cell, {
            text: "",
            widthCm: D,
            heightCm: D,
            icon: ICON_HELP,
            accent: this.accentColor,
            cornerRoundness: 0.5
          })
          this.infoBtn.onTrigger(() => this._onInfoRequested.invoke())
        })
      })

      flexChild(col, {w: W - 4, h: 4.0}, (c) => {
        this.statusText = columnText(
          c,
          "Pinch to lock the canvas in place",
          "Subheadline",
          W - 5,
          this.typeDistance,
          WHITE_DIM
        )
        this.statusText.text = ""
      })

      // Start-visibility is resolved here, at the tail of onInitialized, so a
      // hide() that arrived before init does not stop the Frame initialising.
      this.frameReady = true
      this.applyInitialVisibility()
    })
  }

  /** Swap the speaker glyph so the button shows the CURRENT state. */
  setMuted(muted: boolean): void {
    if (this.muteBtn) this.muteBtn.setIcon(muted ? ICON_SOUND_OFF : ICON_SOUND_ON)
  }

  setStatus(msg: string): void {
    if (this.statusText) this.statusText.text = msg
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
