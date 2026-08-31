// ExquisiteCorpsePaletteUI.ts
//
// OWNS: the colour picker — one emissive chip per palette slot, available for
// the whole of a player's turn.
//
// Input choice: these are PINCH, not gaze dwell. Dwell is reserved for the
// commit actions (DONE / READY / UNDO) where a slow, deliberate hold is a
// feature; picking a colour wants to be instant, and the hand is already free
// between strokes. The draw controller ignores pinches aimed at an
// Interactable, so choosing a colour never lays down a stroke.
//
// EXPECTS: @inputs below, plus setColors() from Main once the palette is known.
//
// MUST NOT: know which colour is "correct", or hold drawing state. It reports
// the slot the player picked.

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {CONTENT_Z, NeonButton, WHITE, flexChild, flexColumn, obj} from "./ExquisiteCorpseUiCommon"

@component
export class ExquisiteCorpsePaletteUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Palette – pick a drawing colour at any time</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Size of the DRAWN colour chip in centimetres. The rail sizes itself around this, so it is the width control. The hit area stays at Min Touch Size, so shrinking this does not make the chips harder to pinch.")
  @widget(new SliderWidget(1.5, 14, 0.25))
  swatchSizeCm: number = 4

  @input
  @hint("Smallest the invisible hit area may be, in centimetres. A chip's own outline is not drawn, so this can exceed the visible chip freely. Below about 6cm at the default placement distance the chips fall under the reliable-pinch minimum.")
  @widget(new SliderWidget(2, 12, 0.5))
  minTouchSizeCm: number = 6

  @input
  @hint("Space added around the chips to make the plate, in centimetres. This is the direct width control: the rail is always the chip plus its ring plus this, so it can never end up too narrow to hold them. Negative pulls the plate in tighter than the chips.")
  @widget(new SliderWidget(-2, 8, 0.1))
  extraWidthCm: number = 0.1

  @input
  @hint("Vertical gap between chips in centimetres.")
  @widget(new SliderWidget(0, 6, 0.1))
  chipGapCm: number = 1.0

  @input
  @hint("How far the selection outline stands proud of the chip, in centimetres. Keep it small so the line hugs the chip; a wide value turns the outline into a block sitting around it.")
  @widget(new SliderWidget(0.2, 4, 0.1))
  selectionRingBleedCm: number = 0.8

  @input
  @hint("Opacity of the panel's backing plate.")
  @widget(new SliderWidget(0.05, 1.0, 0.05))
  panelOpacity: number = 0.3
  @ui.group_end

  private swatches: NeonButton[] = []

  /**
   * Rail size is DERIVED from the chips, not set alongside them.
   *
   * These were @inputs, and keeping three numbers in sync by hand was the
   * reason raising the chip size appeared to do nothing: the chips did grow,
   * then overflowed a rail still sized for the old ones.
   */
  get panelWidthCm(): number {
    // The ring is centred on the chip, so it only reaches half its bleed
    // past each edge — counting the whole bleed padded the rail for nothing.
    return this.swatchSizeCm + this.selectionRingBleedCm * 0.5 + this.extraWidthCm
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

  /** The hit area, never smaller than a comfortable pinch target. */
  private get touchSizeCm(): number {
    return Math.max(this.swatchSizeCm, this.minTouchSizeCm)
  }

  /**
   * Spacing between chip CENTRES has to clear the hit area, or neighbouring
   * colliders overlap and a pinch lands on whichever is found first.
   */
  private get effectiveGapCm(): number {
    return Math.max(this.chipGapCm, this.touchSizeCm - this.swatchSizeCm)
  }

  get panelHeightCm(): number {
    const n = Math.max(1, this.pendingColors.length)
    return (
      n * this.swatchSizeCm +
      (n - 1) * this.effectiveGapCm +
      this.selectionRingBleedCm +
      1.6
    )
  }
  private pendingColors: vec4[] = []
  private selected: number = 0
  private wantVisible: boolean = false
  private frameReady: boolean = false

  private _onColorChosen = new Event<number>()

  get onColorChosen(): PublicApi<number> {
    return this._onColorChosen
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
      frame.padding = new vec2(0.05, 0.8)
      frame.opacity = this.panelOpacity

      const content = obj(
        frame.contentTransform.getSceneObject(),
        "Content",
        new vec3(0, 0, CONTENT_Z)
      )
      // A vertical stack, so the chips run down the side of the canvas instead
      // of across the bottom of the field of view.
      // Packed to the TOP so the first chip lines up with the canvas edge and
      // with the DONE button on the opposite rail.
      const row = flexColumn(content, W, H, {
        gap: this.effectiveGapCm,
        padX: 0.1,
        padY: 0.8,
        justify: FlexJustify.Start,
        align: FlexAlign.Center
      })

      // Built from whatever palette Main hands over, so the chips can never
      // disagree with the colours the renderer actually draws.
      for (let i = 0; i < this.pendingColors.length; i++) {
        const color = this.pendingColors[i]
        const index = i
        flexChild(row, {w: this.swatchSizeCm, h: this.swatchSizeCm}, (cell) => {
          const chip = new NeonButton(cell, {
            text: "",
            widthCm: this.touchSizeCm,
            heightCm: this.touchSizeCm,
            swatchVisualCm: this.swatchSizeCm,
            accent: WHITE,
            swatch: color,
            selectionRingBleedCm: this.selectionRingBleedCm,
            // Rounded square, so the outline matches the square colour fill
            // instead of ringing it with a circle.
            cornerRoundness: 0.28
          })
          chip.onTrigger(() => this.choose(index))
          this.swatches.push(chip)
        })
      }

      this.applySelection()
      this.frameReady = true
      this.applyInitialVisibility()
    })
  }

  /** Hand over the palette before the panel builds; Main calls this at start. */
  setColors(colors: vec4[]): void {
    this.pendingColors = colors
  }

  private choose(index: number): void {
    this.selected = index
    this.applySelection()
    this._onColorChosen.invoke(index)
  }

  private applySelection(): void {
    for (let i = 0; i < this.swatches.length; i++) {
      this.swatches[i].setSelected(i === this.selected)
    }
  }

  /** Used when a turn starts on a given slot without the player picking it. */
  setSelectedIndex(index: number): void {
    this.selected = index
    this.applySelection()
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
   * Resolve start-visibility one frame late when the panel starts hidden — a
   * UIKit Button finishes its own setup in a deferred Element.onStart, and
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
