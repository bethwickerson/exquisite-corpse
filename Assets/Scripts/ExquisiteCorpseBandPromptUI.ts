// ExquisiteCorpseBandPromptUI.ts
//
// OWNS: the one-line instruction that sits at the bottom of the band you are
// drawing in — "Draw a Head", "Draw a Body", "Draw Legs".
//
// Deliberately has NO Frame or backing plate: it floats inside the canvas area,
// and a plate there would add light across the drawing surface on an additive
// display. That also keeps it clear of the Frame-initialisation ordering that
// the panelled surfaces have to work around.
//
// EXPECTS: @inputs below. Positioned by Main at the active band each turn.
//
// MUST NOT: decide what the prompt says. Main owns the per-band wording.

import {
  THEME_SERIF,
  WHITE,
  WHITE_DIM,
  applyTextRole,
  columnText,
  flexColumn,
  obj
} from "./ExquisiteCorpseUiCommon"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"

@component
export class ExquisiteCorpseBandPromptUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Band Prompt – in-canvas instruction for the active band</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Width the prompt line is allowed to occupy, in centimetres.")
  @widget(new SliderWidget(10, 80, 1))
  widthCm: number = 54

  @input
  @hint("Distance from the viewer in centimetres. Scales the text.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 150

  @input
  @hint("Extra multiplier on the prompt's text size. The prompt uses the Caption role, so this sits it between the small hint labels and a headline.")
  @widget(new SliderWidget(0.5, 2.5, 0.05))
  textScale: number = 0.7

  @input
  @hint("Size of the finished-piece headline relative to the read distance. Bounded by Width Cm — a longer title needs a lower value or a wider cell, or it clips rather than wrapping.")
  @widget(new SliderWidget(0.15, 2.5, 0.05))
  headlineScale: number = 1.0
  @ui.group_end

  private promptText: Text | null = null
  private wantVisible: boolean = false

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")

    // No Frame here, so the flex is created before OnStart and initialises
    // normally — none of the deferred-build dance the panels need.
    const content = obj(this.sceneObject, "Content")
    const col = flexColumn(content, this.widthCm, 5, {
      justify: FlexJustify.Center,
      align: FlexAlign.Stretch
    })
    this.promptText = columnText(
      col,
      "Draw a Body",
      "Caption",
      this.widthCm,
      this.readDistanceCm * this.textScale,
      WHITE_DIM
    )
    this.promptText.text = ""
    this.sceneObject.enabled = false
  }

  /**
   * Switch to the finished-piece title: serif, much larger, full white.
   *
   * The same Text object is reused rather than a second panel — it already sits
   * in the canvas plane with no backing, which is exactly what a title card
   * floating on its own wants to be.
   */
  showHeadline(msg: string): void {
    if (this.promptText) {
      this.promptText.font = THEME_SERIF
      applyTextRole(this.promptText, "Title1", this.readDistanceCm * this.headlineScale)
      this.promptText.textFill.color = WHITE
      this.promptText.text = msg
    }
    this.wantVisible = true
    this.sceneObject.enabled = msg.length > 0
  }

  /** Fade the headline out; 1 is fully lit, 0 invisible. */
  setHeadlineOpacity(a: number): void {
    if (!this.promptText) return
    const k = Math.max(0, Math.min(1, a))
    this.promptText.textFill.color = new vec4(WHITE.r, WHITE.g, WHITE.b, k)
  }

  setText(msg: string): void {
    if (this.promptText) this.promptText.text = msg
    // An empty prompt hides the object entirely rather than leaving a gap.
    this.sceneObject.enabled = this.wantVisible && msg.length > 0
  }

  show(): void {
    this.wantVisible = true
    const has = this.promptText !== null && this.promptText.text.length > 0
    this.sceneObject.enabled = has
  }

  hide(): void {
    this.wantVisible = false
    this.sceneObject.enabled = false
  }
}
