// ExquisiteCorpseUiCommon.ts
//
// OWNS: the shared UIKit composition helpers used by all four ExquisiteCorpse*UI
// modules — the type scale, SceneObject/flex helpers, the neon "white outline on
// transparent" capsule button, and the gaze-dwell progress chip.
//
// EXPECTS: nothing. This is a plain TypeScript module, not a @component. It is
// imported by the UI modules only.
//
// MUST NOT: hold game state, make game decisions, or be imported by
// ExquisiteCorpseMain.ts or any controller. UIKit lives in *UI.ts modules only.

import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexDirection,
  FlexJustify
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ProgressBar} from "SpectaclesUIKit.lspkg/Scripts/Components/ProgressBar/ProgressBar"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {GradientParameters} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ── Typography ───────────────────────────────────────────────────────────────
// Text.size is the glyph EM-SQUARE height (em cm = size / 43.886), calibrated
// for the SnapOS system font at z = -110 cm. Pick a role, never a raw number.
// Bumped well above the 1.0 SnapOS baseline: at the distances this game places
// its panels (150cm+, vs the 110cm the scale is calibrated for) the stock sizes
// read as too small on an additive display. Per-panel `textScale` multiplies on
// top of this.
export const FONT_SIZE_SCALE = 2.4

/**
 * One label size for every button in the game, as a fraction of the owning
 * panel's read distance. Panels are world-scaled by their distance, so the same
 * fraction lands at the same APPARENT size on every surface.
 */
export const BUTTON_LABEL_SCALE = 0.65

/**
 * How much narrower Instrument Serif runs than estimateTextWidthCm predicts.
 *
 * That estimate was measured on bold monospaced caps, which are about the widest
 * thing in the UI. Applying it to the display serif overstates a word by roughly
 * this factor — enough that the title lockup's word cell was sized for 31cm of
 * "Corpse" when the glyphs occupy nearer 9, leaving the flanking rules no room
 * and making the gap control between them look broken.
 */
export const SERIF_WIDTH_FACTOR = 3.54



export type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500}
}

export function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

export function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

/**
 * Half-height in cm for a text cell at this role, from the em-square relation
 * `em cm = size / 43.886`. Fixed rect heights would clip or crowd a label the
 * moment the type scale goes up, so the cell tracks the glyph.
 */
/**
 * Rough width of a string at a role, in cm. 0.0166 cm per character per unit of
 * font size was MEASURED off a render of bold caps — the 0.0128 figure in the
 * UIKit notes is for mixed-case body text and underestimates headlines by ~30%,
 * which is enough to run a label straight through its neighbour.
 */
export function estimateTextWidthCm(role: TextRole, chars: number, distanceCm: number = 110): number {
  return roleSize(role, distanceCm) * 0.0166 * chars
}

export function roleHalfHeightCm(role: TextRole, distanceCm: number = 110): number {
  return Math.max(1.3, (roleSize(role, distanceCm) / 43.886) * 0.85)
}

// ── Z lifts ──────────────────────────────────────────────────────────────────
export const CONTENT_Z = 0.6 // content child above a Frame/BackPlate face
export const LAYOUT_Z_LIFT = 0.02 // nested flex containers
export const BUTTON_FACE_Z = 0.08 // label/icon drawn on a Button face
export const DWELL_Z = 0.12 // dwell chip above the button face

// ── Palette (additive display: black reads as transparent) ───────────────────
export const WHITE = new vec4(1, 1, 1, 1)
export const WHITE_DIM = new vec4(1, 1, 1, 0.82)
export const WHITE_FAINT = new vec4(1, 1, 1, 0.45)

/**
 * Colour a dwell-driven control charges toward while the gaze is held on it.
 * Change here to retint every dwell affordance at once.
 */
export const DWELL_TINT = new vec4(0.25, 1.0, 0.72, 1)

function lerpColor(a: vec4, b: vec4, t: number): vec4 {
  const k = Math.max(0, Math.min(1, t))
  return new vec4(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    a.a + (b.a - a.a) * k
  )
}

// ── SceneObject helpers ──────────────────────────────────────────────────────
export function obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  if (position) so.getTransform().setLocalPosition(position)
  return so
}

export function liftInZ(so: SceneObject, zOffset: number): void {
  const tr = so.getTransform()
  const p = tr.getLocalPosition()
  tr.setLocalPosition(new vec3(p.x, p.y, p.z + zOffset))
}

// ── Flex helpers ─────────────────────────────────────────────────────────────
export interface FlexOpts {
  gap?: number
  padX?: number
  padY?: number
  justify?: FlexJustify
  align?: FlexAlign
}

export function makeFlex(
  parent: SceneObject,
  direction: FlexDirection,
  width: number,
  height: number,
  opts?: FlexOpts
): SceneObject {
  const container = obj(parent, "Flex")
  liftInZ(container, LAYOUT_Z_LIFT)
  const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
  // These panels are built inside frame.onInitialized, which runs AFTER start —
  // by then auto-discovery has already looked for children and found none. Turn
  // it off and register every child explicitly via addItems.
  flex.autoDiscoverItemsOnStart = false
  const item = container.createComponent(FlexItem.getTypeName()) as FlexItem
  if (width > 0) item.overrideWidth = width
  if (height > 0) item.overrideHeight = height

  flex.onInitialized.add(() => {
    flex.width = width
    flex.height = height
    flex.direction = direction
    if (direction === FlexDirection.Row) {
      flex.columnGap = opts?.gap ?? 0
    } else {
      flex.rowGap = opts?.gap ?? 0
    }
    flex.paddingTop = opts?.padY ?? 0
    flex.paddingBottom = opts?.padY ?? 0
    flex.paddingLeft = opts?.padX ?? 0
    flex.paddingRight = opts?.padX ?? 0
    flex.justifyContent = opts?.justify ?? FlexJustify.Start
    flex.alignItems = opts?.align ?? FlexAlign.Stretch
  })
  return container
}

export function flexColumn(
  parent: SceneObject,
  width: number,
  height: number,
  opts?: FlexOpts
): SceneObject {
  return makeFlex(parent, FlexDirection.Column, width, height, opts)
}

export function flexRow(
  parent: SceneObject,
  width: number,
  height: number,
  opts?: FlexOpts
): SceneObject {
  return makeFlex(parent, FlexDirection.Row, width, height, opts)
}

export function flexChild(
  parent: SceneObject,
  size: {w?: number; h?: number; grow?: number; mt?: number; mb?: number},
  builder: (child: SceneObject) => void
): SceneObject {
  const child = obj(parent, "Item")
  liftInZ(child, LAYOUT_Z_LIFT)
  const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
  if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w
  if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h
  item.flexGrow = size.grow ?? 0
  item.flexShrink = 0
  // Per-item margins let one pair of rows tighten without collapsing the
  // container's gap for every other row. Negative values are allowed and are
  // how display type gets set solid.
  if (size.mt !== undefined) item.marginTop = size.mt
  if (size.mb !== undefined) item.marginBottom = size.mb

  builder(child)

  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return child
}

// ── Text ─────────────────────────────────────────────────────────────────────

/**
 * Raw Text sized for a COLUMN-direction parent. Uses the 1x1 placeholder rect +
 * alignSelf=Stretch trick, which only works when the cross-axis is horizontal.
 */
export function columnText(
  parent: SceneObject,
  text: string,
  role: TextRole,
  widthCm: number,
  distanceCm: number,
  color: vec4 = WHITE,
  style?: {font?: Font; italic?: boolean}
): Text {
  const so = obj(parent, "Text")
  const t = so.createComponent("Component.Text") as Text
  t.text = text
  t.depthTest = true
  applyTextRole(t, role, distanceCm)
  t.textFill.color = color
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  // Mono is the default for UI; callers pass THEME_SERIF for display type.
  t.font = style?.font ?? THEME_MONO
  // Render the string exactly as authored. Without pinning this, text picks up
  // a capitalisation override from elsewhere and silently uppercases.
  t.capitilizationOverride = CapitilizationOverride.None
  if (style?.italic !== undefined) t.italic = style.italic
  const halfH = roleHalfHeightCm(role, distanceCm)
  t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -halfH, halfH)
  so.createComponent(FlexItem.getTypeName())
  return t
}

/**
 * Raw Text sized for a ROW-direction parent. The rect IS the cell size here, so
 * it must be budgeted against the longest expected string — a 1x1 placeholder
 * would collapse the cell and let siblings render over the glyphs.
 */
export function rowText(
  parent: SceneObject,
  text: string,
  role: TextRole,
  widthCm: number,
  distanceCm: number,
  color: vec4 = WHITE,
  style?: {font?: Font; italic?: boolean}
): Text {
  const so = obj(parent, "RowText")
  const t = so.createComponent("Component.Text") as Text
  t.text = text
  t.depthTest = true
  applyTextRole(t, role, distanceCm)
  t.textFill.color = color
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  // Mono is the default for UI; callers pass THEME_SERIF for display type.
  t.font = style?.font ?? THEME_MONO
  // Render the string exactly as authored. Without pinning this, text picks up
  // a capitalisation override from elsewhere and silently uppercases.
  t.capitilizationOverride = CapitilizationOverride.None
  if (style?.italic !== undefined) t.italic = style.italic
  const halfH = roleHalfHeightCm(role, distanceCm)
  t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -halfH, halfH)
  so.createComponent(FlexItem.getTypeName())
  return t
}

// ── Icons ────────────────────────────────────────────────────────────────────
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

/**
 * Display face for the title block. Applied per-Text via `t.font`, so it
 * overrides anything the Inspector may have set on the same component.
 */
export const THEME_SERIF = requireAsset("../Fonts/Instrument Serif.ttf") as Font

/**
 * Working face for everything that is not the title: buttons, status lines and
 * instructions. Monospace keeps counters like "PLAYER 2 OF 3" from reflowing as
 * the digits change, and its neutral technical tone sits back from the serif
 * rather than competing with it.
 */
export const THEME_MONO = requireAsset("../Fonts/Azeret Mono.ttf") as Font

/**
 * Plain white swatch. A Component.Image with a null baseTex is culled by Lens
 * Studio — the SceneObject reports enabled:false and nothing draws — so any
 * solid-colour rectangle needs a real texture to tint.
 */
const WHITE_SWATCH = requireAsset("../Textures/WhitePixel.png") as Texture
/** Rounded-square fill for palette chips, so the colour matches the button's corners. */
const SWATCH_ROUNDED = requireAsset("../Textures/SwatchRounded.png") as Texture
/** Rounded-square ring used as the selection marker on palette chips. */
const SWATCH_RING = requireAsset("../Textures/SwatchRing.png") as Texture

/**
 * A picture that ADDS its light to the scene rather than compositing over it.
 *
 * Only the bright pixels of the source survive — black areas contribute
 * nothing and read as transparent, which is what makes artwork sit correctly
 * in an additive display instead of looking like a pasted-on card.
 */
export function addAdditiveImage(
  parent: SceneObject,
  texture: Texture,
  widthCm: number,
  heightCm: number,
  tint: vec4 = WHITE
): Image {
  const so = obj(parent, "AdditiveImage")
  const img = so.createComponent("Component.Image") as Image
  const mat = imageMaterial.clone()
  mat.mainPass.baseTex = texture
  mat.mainPass.baseColor = tint
  mat.mainPass.blendMode = BlendMode.Add
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  img.clearMaterials()
  img.addMaterial(mat)
  so.getTransform().setLocalScale(new vec3(widthCm, heightCm, 1))
  so.createComponent(FlexItem.getTypeName())
  return img
}

/**
 * A horizontal rule, for flanking a title.
 *
 * Thickness is in centimetres and needs to clear roughly 0.25cm at panel
 * distance to survive rasterisation — a hairline specified in the abstract
 * lands under a pixel and effectively disappears.
 */
export function addRule(
  parent: SceneObject,
  widthCm: number,
  thicknessCm: number = 0.35,
  color: vec4 = WHITE_DIM
): void {
  const so = obj(parent, "Rule")
  const img = so.createComponent("Component.Image") as Image
  const mat = imageMaterial.clone()
  mat.mainPass.baseTex = WHITE_SWATCH
  mat.mainPass.baseColor = color
  mat.mainPass.blendMode = BlendMode.Add
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  img.clearMaterials()
  img.addMaterial(mat)
  so.getTransform().setLocalScale(new vec3(widthCm, thicknessCm, 1))
  so.createComponent(FlexItem.getTypeName())
}

export function addIcon(parent: SceneObject, texture: Texture, sizeCm: number): Image {
  const so = obj(parent, "Icon")
  const img = so.createComponent("Component.Image") as Image
  const mat = imageMaterial.clone()
  mat.mainPass.baseTex = texture
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  img.clearMaterials()
  img.addMaterial(mat)
  so.getTransform().setLocalScale(new vec3(sizeCm, sizeCm, 1))
  so.createComponent(FlexItem.getTypeName())
  return img
}

// ── Neon capsule button ──────────────────────────────────────────────────────

/** A gradient that is one flat colour end to end — used to force a solid outline. */
function solidGradient(c: vec4): GradientParameters {
  return {
    type: "Linear",
    start: new vec2(-0.8, 1),
    end: new vec2(0.8, -1),
    stop0: {percent: 0, color: c},
    stop1: {percent: 1, color: c}
  }
}

/**
 * A rounded capsule with a white outline, white label and transparent interior,
 * plus an optional gaze-dwell progress chip along its lower edge.
 *
 * The Button is a real UIKit Button, so it stays pinch/mouse-tappable (that is
 * the editor-preview path). The dwell controller drives `setProgress` and then
 * calls the same `onTrigger` the pinch path fires.
 */
export class NeonButton {
  readonly root: SceneObject
  readonly button: Button
  private label: Text | null = null
  private swatchImage: Image | null = null
  private swatchColor: vec4 | null = null
  private selectionRing: Image | null = null
  private iconImage: Image | null = null
  private dwell: ProgressBar | null = null
  private enabledFlag = true
  private solid = false
  private baseColor: vec4

  constructor(
    parent: SceneObject,
    opts: {
      text: string
      widthCm: number
      heightCm: number
      /** Only used to size a text label; omit on icon-only or swatch buttons. */
      distanceCm?: number
      icon?: Texture
      accent?: vec4
      withDwell?: boolean
      labelRole?: TextRole
      /** Multiplies the label's size only. Below 1 shrinks the text in the capsule. */
      labelScale?: number
      /** 0.5 = fully round ends; 0 = square. Fraction of the shorter side. */
      cornerRoundness?: number
      /** Fills the face with an additive colour chip — used for palette swatches. */
      swatch?: vec4
      /** How far the selection ring extends past the chip, in centimetres. */
      selectionRingBleedCm?: number
      /**
       * Size of the DRAWN chip, when it should be smaller than the button.
       *
       * A swatch's own outline is invisible, so the button can stay large
       * enough to pinch reliably while the colour reads much smaller. Without
       * this, shrinking a chip shrinks its hit target with it.
       */
      swatchVisualCm?: number
      /** Multiplies the icon size. >1 for icon-only buttons where the glyph IS the button. */
      iconScale?: number
      /**
       * Draws `icon` full-bleed across the face instead of as a small glyph in
       * a row, and suppresses the outline. Used for the solid white DONE disc:
       * additive display cannot paint black, so a "black tick on white" has to
       * be a white disc with the tick knocked OUT of its alpha.
       */
      solidFace?: boolean
    }
  ) {
    this.baseColor = opts.accent ?? WHITE
    this.root = obj(parent, "Btn_" + opts.text)

    const btn = this.root.createComponent(Button.getTypeName()) as Button
    this.button = btn
    // size BEFORE init — the visual does not refresh on a post-init resize.
    btn.size = new vec3(opts.widthCm, opts.heightCm, 1)
    btn.setVariant({shape: "Capsule", style: "Ghost"})

    btn.onInitialized.add(() => {
      btn.size = new vec3(opts.widthCm, opts.heightCm, 1)

      // A swatch draws itself entirely from its own additive images, so the
      // Button's plate must be switched off at the mesh — not merely painted
      // transparent. The visual re-applies its per-state border on hover and
      // press, so any colour set from outside comes back. It also matters more
      // than it used to: the hit area is deliberately larger than the drawn
      // chip, so that border reads as a second outline around everything.
      if (opts.swatch) {
        const plate = this.root.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null
        if (plate) plate.enabled = false
      }
      // setVariant({shape:"Capsule"}) does not round the corners on this theme,
      // so drive the visual's radius directly. Fraction of the shorter side, so
      // 0.5 gives true capsule ends at any button size.
      const visual = btn.visual as RoundedRectangleVisual | null
      if (visual) {
        const shorter = Math.min(opts.widthCm, opts.heightCm)
        visual.cornerRadius = shorter * (opts.cornerRoundness ?? 0.5)
      }
      this.paintOutline(this.baseColor)
    })

    // Face: icon + label in a centred row, lifted off the button face so the
    // leading glyph is not occluded by the button's own front plane.
    const face = obj(this.root, "Face", new vec3(0, 0, BUTTON_FACE_Z))

    // A swatch fills the face with its own emitted light, so the chip reads as
    // the colour it will draw in rather than as a label describing it.
    if (opts.swatch) {
      this.swatchColor = opts.swatch
      const drawn = opts.swatchVisualCm ?? Math.min(opts.widthCm, opts.heightCm) - 1.0
      this.swatchImage = addAdditiveImage(face, SWATCH_ROUNDED, drawn, drawn, opts.swatch)

      // Selection ring drawn as our own image rather than the button's border:
      // RoundedRectangleVisual keeps borderSize private, and even reaching it
      // would not hold — the visual re-applies its per-state border on every
      // hover and press, wiping any thickness set from outside.
      const bleed = opts.selectionRingBleedCm ?? 0.9
      const ringW = drawn + bleed
      const ringH = drawn + bleed
      this.selectionRing = addAdditiveImage(face, SWATCH_RING, ringW, ringH, WHITE)
      this.selectionRing.getSceneObject().enabled = false
    }
    // Solid face: one full-bleed image and no label row. DONE still needs its
    // dwell bar, so this branches the FACE only, not the rest of the build.
    if (opts.solidFace && opts.icon) {
      this.solid = true
      const d = Math.min(opts.widthCm, opts.heightCm)
      addAdditiveImage(face, opts.icon, d, d, WHITE)
    }

    const row = flexRow(face, opts.widthCm - 1.0, opts.heightCm - 0.6, {
      gap: 0.6,
      justify: FlexJustify.Center,
      align: FlexAlign.Center
    })

    // With no label the glyph IS the button, so it is sized off the face rather
    // than capped at the small in-line glyph size.
    const iconOnly = opts.text.length === 0 && opts.icon !== undefined
    const iconCm = iconOnly
      ? Math.min(opts.widthCm, opts.heightCm) * 0.55 * (opts.iconScale ?? 1)
      : Math.min(3.2, opts.heightCm * 0.5) * (opts.iconScale ?? 1)

    if (opts.icon && !this.solid) {
      flexChild(row, {w: iconCm, h: iconCm}, (c) => {
        this.iconImage = addIcon(c, opts.icon as Texture, iconCm)
      })
    }
    if (!iconOnly && !this.solid) {
      const labelW = opts.widthCm - 1.4 - (opts.icon ? iconCm + 0.6 : 0)
      flexChild(row, {w: labelW, h: opts.heightCm - 0.8}, (c) => {
        this.label = rowText(
          c,
          opts.text,
          opts.labelRole ?? "Headline2",
          labelW,
          (opts.distanceCm ?? 110) * (opts.labelScale ?? BUTTON_LABEL_SCALE),
          WHITE
        )
      })
    }

    if (opts.withDwell) {
      const dwellW = opts.widthCm - 2.0
      const chip = obj(
        this.root,
        "Dwell",
        new vec3(0, -opts.heightCm / 2 + 0.75, DWELL_Z)
      )
      const bar = chip.createComponent(ProgressBar.getTypeName()) as ProgressBar
      bar.size = new vec3(dwellW, 0.6, 1)
      bar.onInitialized.add(() => {
        bar.size = new vec3(dwellW, 0.6, 1)
        bar.currentValue = 0
      })
      this.dwell = bar
      chip.enabled = false
    }

    this.root.createComponent(FlexItem.getTypeName())
  }

  /** Collider the gaze ray tests against. */
  get collider(): ColliderComponent | null {
    return this.button ? this.button.collider : null
  }

  /** Fired by both the pinch path and the dwell controller. */
  onTrigger(cb: () => void): void {
    this.button.onTriggerUp.add(() => {
      if (this.enabledFlag) cb()
    })
  }

  /**
   * t is 0..1. Drives three cues at once: the fill chip, the label colour and
   * the outline colour. Colour is the one you notice in peripheral vision — a
   * thin progress bar alone is easy to miss, and missing it is how you trigger
   * something by accident.
   */
  setProgress(t: number): void {
    const clamped = Math.max(0, Math.min(1, t))

    if (this.dwell) {
      const chip = this.dwell.getSceneObject()
      chip.enabled = clamped > 0.001 && this.enabledFlag
      this.dwell.currentValue = clamped
    }

    if (!this.enabledFlag) return
    // Ease so the shift is visible early rather than only near completion.
    const eased = Math.sqrt(clamped)
    if (this.label) this.label.textFill.color = lerpColor(WHITE, DWELL_TINT, eased)
    this.paintOutline(lerpColor(this.baseColor, DWELL_TINT, eased))
  }

  setEnabled(on: boolean): void {
    this.enabledFlag = on
    this.paintOutline(on ? this.baseColor : WHITE_FAINT)
    if (this.label) this.label.textFill.color = on ? WHITE : WHITE_FAINT
    if (!on) this.setProgress(0)
  }

  /**
   * Marks a swatch as the active choice.
   *
   * The signal is carried almost entirely by the outline — a bright ring on the
   * chosen chip, none on the rest. Deliberately NOT by dimming: every colour is
   * meant to glow, and on an additive display a dimmed swatch stops reading as
   * emissive at all. The unselected chips get only a token knock-back so the
   * selected one still wins the eye.
   */
  setSelected(on: boolean): void {
    // The ring carries the whole signal, so the button's own thin outline stays
    // off on swatches — two concentric outlines read as a rendering mistake.
    this.paintOutline(new vec4(1, 1, 1, 0))
    if (this.selectionRing) this.selectionRing.getSceneObject().enabled = on
    if (this.swatchImage && this.swatchColor) {
      const c = this.swatchColor
      const k = on ? 1.0 : 0.82
      this.swatchImage.mainMaterial.mainPass.baseColor = new vec4(
        c.r * k,
        c.g * k,
        c.b * k,
        c.a
      )
    }
  }

  /** Swap the glyph in place — used by toggles that show their current state. */
  setIcon(texture: Texture): void {
    if (this.iconImage) this.iconImage.mainMaterial.mainPass.baseTex = texture
  }

  setAccent(color: vec4): void {
    this.baseColor = color
    if (this.enabledFlag) this.paintOutline(color)
  }

  setLabel(text: string): void {
    if (this.label) this.label.text = text
  }

  get isEnabled(): boolean {
    return this.enabledFlag
  }

  /**
   * Paint the capsule's outline.
   *
   * The Ghost style draws its border from a GRADIENT whose stops are both
   * Transparent, so it has no visible outline at rest and `borderColor` is
   * ignored entirely while borderType is "Gradient". Writing a solid-colour
   * gradient is the only way to get a real white stroke. borderColor is set
   * too, in case a theme is swapped to a "Color" border later.
   */
  /** A solid-face button has no outline to tint, so the paint is a no-op there. */
  private paintOutline(color: vec4): void {
    if (this.solid) return
    this.paintOutlineInner(color)
  }

  private paintOutlineInner(color: vec4): void {
    const v = this.button.visual as RoundedRectangleVisual | null
    if (!v) return
    const inactive = new vec4(color.r, color.g, color.b, color.a * 0.3)

    v.borderDefaultColor = color
    v.borderHoveredColor = color
    v.borderTriggeredColor = color
    v.borderInactiveColor = inactive

    v.borderDefaultGradient = solidGradient(color)
    v.borderHoveredGradient = solidGradient(color)
    v.borderTriggeredGradient = solidGradient(color)
    v.borderInactiveGradient = solidGradient(inactive)
  }
}
