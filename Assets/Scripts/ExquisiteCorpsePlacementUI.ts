// ExquisiteCorpsePlacementUI.ts
//
// OWNS: the chrome for the placement step — one instruction line and the
// LOCK HERE button, sitting just below the canvas.
//
// Deliberately has NO Frame and NO backing plate. The whole point of this step
// is to look at the canvas and nothing else, so the title lockup, the logo and
// the panel that carry the home screen are all gone by the time this appears.
// A backing here would also add light straight across the surface the player is
// trying to judge the position of.
//
// EXPECTS: @inputs below. Positioned by Main under the canvas each frame while
// the player drags it.
//
// MUST NOT: move the canvas or decide when placement is done. Dragging belongs
// to the canvas controller's handle; this reports that LOCK HERE was pressed.

import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {NeonButton, WHITE_DIM, columnText, flexChild, flexColumn, obj} from "./ExquisiteCorpseUiCommon"

@component
export class ExquisiteCorpsePlacementUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Placement UI – drag prompt and LOCK HERE, no backing</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Width the chrome is allowed to occupy, in centimetres.")
  @widget(new SliderWidget(20, 90, 1))
  widthCm: number = 56

  @input
  @hint("Height of the chrome block, in centimetres. Used by Main to sit it clear of the canvas edge.")
  @widget(new SliderWidget(6, 30, 0.5))
  panelHeightCm: number = 14

  @input
  @hint("Instruction shown above the button. Uppercase to match the rest of the UI.")
  instructionText: string = "PINCH AND DRAG TO POSITION"

  @input
  @hint("Label on the commit button.")
  lockLabel: string = "LOCK HERE"

  @input
  @hint("Size of the instruction line relative to the type scale. Kept below 1 so it reads as a hint, not a headline.")
  @widget(new SliderWidget(0.3, 1.5, 0.05))
  instructionScale: number = 0.55


  @input
  @hint("Distance from the viewer in centimetres. Scales the text.")
  @widget(new SliderWidget(50, 250, 5))
  readDistanceCm: number = 150

  @input("vec4", "{0.09, 0.69, 0.77, 1.0}")
  @hint("Outline colour of the LOCK HERE button.")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(0.09, 0.69, 0.77, 1)
  @ui.group_end

  private lockBtn: NeonButton | null = null

  private _onLockRequested = new Event<void>()

  get onLockRequested(): PublicApi<void> {
    return this._onLockRequested
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")

    // With no Frame, the flex is built in onAwake and initialises normally —
    // none of the deferred-build ordering the panelled surfaces have to work
    // around applies here.
    const content = obj(this.sceneObject, "Content")
    const W = this.widthCm
    const col = flexColumn(content, W, this.panelHeightCm, {
      gap: 1.4,
      justify: FlexJustify.Center,
      align: FlexAlign.Stretch
    })

    flexChild(col, {w: W - 2, h: 3.0}, (c) => {
      columnText(
        c,
        this.instructionText,
        "Caption",
        W - 3,
        this.readDistanceCm * this.instructionScale,
        WHITE_DIM
      )
    })

    flexChild(col, {w: W - 2, h: 6.4}, (c) => {
      this.lockBtn = new NeonButton(c, {
        text: this.lockLabel,
        widthCm: 26,
        heightCm: 6.0,
        distanceCm: this.readDistanceCm,
        accent: this.accentColor
      })
      this.lockBtn.onTrigger(() => this._onLockRequested.invoke())
    })

    this.sceneObject.enabled = false
  }

  show(): void {
    this.sceneObject.enabled = true
    if (this.lockBtn) this.lockBtn.setEnabled(true)
  }

  hide(): void {
    this.sceneObject.enabled = false
  }
}
