// ExquisiteCorpseGazeDwell.ts
//
// OWNS: gaze dwell on UI zones. Casts a ray along head-forward each frame,
// finds which registered zone it hits, accumulates dwell time on that zone,
// reports progress, and fires once the dwell completes.
//
// Why gaze here and pinch for drawing: the player's hands are busy making
// marks, so a pinch-activated DONE would collide with the last stroke. Dwell
// is reserved for exactly the three UI zones the spec names — DONE, READY,
// UNDO — and never for drawing.
//
// This is why the dwell-driven panels are world-locked rather than head-locked:
// a head-locked button sits at a fixed spot in the display, so head-gaze could
// never point at anything except dead centre.
//
// EXPECTS: zones registered via addZone(). Cleared with clearZones().
//
// MUST NOT: know what any zone means. It reports "zone <id> completed".

import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

interface Zone {
  id: string
  collider: ColliderComponent
  onProgress: (t: number) => void
  onComplete: () => void
  isEnabled: () => boolean
  /** Multiplier on dwellSeconds. >1 makes a zone deliberately harder to trigger. */
  dwellScale: number
}

@component
export class ExquisiteCorpseGazeDwell extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Gaze Dwell – head-gaze activation for UI zones only</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Base gaze-hold time in seconds. Individual zones scale this — destructive actions ask for longer.")
  @widget(new SliderWidget(0.4, 5.0, 0.1))
  dwellSeconds: number = 1.4

  @input
  @hint("How quickly dwell progress drains after the gaze leaves a zone, as a multiple of fill speed.")
  @widget(new SliderWidget(0.5, 6.0, 0.25))
  decayRate: number = 2.5

  @input
  @hint("How far the gaze ray reaches, in centimetres.")
  @widget(new SliderWidget(100, 800, 10))
  rayLengthCm: number = 500

  @input
  @hint("Pause after a zone fires before any zone can fire again, in seconds.")
  @widget(new SliderWidget(0, 2.0, 0.1))
  retriggerDelay: number = 0.6
  @ui.group_end

  private camera = WorldCameraFinderProvider.getInstance()
  private probe: Probe | null = null

  private zones: Zone[] = []
  private progress: Record<string, number> = {}
  private hitId: string | null = null
  private pendingHitId: string | null = null
  private cooldown: number = 0
  private enabledFlag: boolean = false

  private _onZoneCompleted = new Event<string>()

  get onZoneCompleted(): PublicApi<string> {
    return this._onZoneCompleted
  }

  onAwake(): void {
    this.probe = Physics.createGlobalProbe()
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  setEnabled(on: boolean): void {
    this.enabledFlag = on
    if (!on) this.resetAll()
  }

  clearZones(): void {
    this.resetAll()
    this.zones = []
  }

  addZone(
    id: string,
    collider: ColliderComponent | null,
    onProgress: (t: number) => void,
    onComplete: () => void,
    isEnabled: () => boolean = () => true,
    dwellScale: number = 1
  ): void {
    if (!collider) {
      print("[ExquisiteCorpse] Dwell zone '" + id + "' has no collider — it cannot be gazed at.")
      return
    }
    this.zones.push({
      id: id,
      collider: collider,
      onProgress: onProgress,
      onComplete: onComplete,
      isEnabled: isEnabled,
      dwellScale: Math.max(0.1, dwellScale)
    })
    this.progress[id] = 0
  }

  private resetAll(): void {
    for (const z of this.zones) {
      this.progress[z.id] = 0
      z.onProgress(0)
    }
    this.hitId = null
    this.pendingHitId = null
  }

  private onUpdate(): void {
    const dt = getDeltaTime()

    if (this.cooldown > 0) {
      this.cooldown -= dt
      if (this.cooldown > 0) {
        this.drainAll(dt)
        return
      }
    }

    if (!this.enabledFlag || this.zones.length === 0 || !this.probe) {
      return
    }

    this.hitId = this.castGaze()

    for (const z of this.zones) {
      const active = this.hitId === z.id && z.isEnabled()
      const hold = Math.max(0.05, this.dwellSeconds * z.dwellScale)
      let p = this.progress[z.id] ?? 0
      if (active) {
        p += dt / hold
      } else {
        p -= (dt / hold) * this.decayRate
      }
      p = Math.max(0, Math.min(1, p))
      this.progress[z.id] = p
      z.onProgress(p)

      if (p >= 1 && active) {
        this.progress[z.id] = 0
        z.onProgress(0)
        this.cooldown = this.retriggerDelay
        this.hitId = null
        this.pendingHitId = null
        z.onComplete()
        this._onZoneCompleted.invoke(z.id)
        return
      }
    }
  }

  private drainAll(dt: number): void {
    for (const z of this.zones) {
      let p = this.progress[z.id] ?? 0
      if (p <= 0) continue
      const hold = Math.max(0.05, this.dwellSeconds * z.dwellScale)
      p = Math.max(0, p - (dt / hold) * this.decayRate)
      this.progress[z.id] = p
      z.onProgress(p)
    }
  }

  /**
   * Ray from the head along its forward axis, resolved synchronously so dwell
   * progress reacts on the same frame the gaze lands.
   *
   * Uses rayCastAllSync rather than the nearest-hit form: a dwell zone can sit
   * behind another collider (the panel's own backing, a stroke mesh), and only
   * taking the closest hit would make the button unreachable.
   */
  private castGaze(): string | null {
    const tr = this.camera.getComponent().getTransform()
    const origin = tr.getWorldPosition()
    const dir = tr.forward.uniformScale(-1) // LS objects face -Z
    const end = origin.add(dir.uniformScale(this.rayLengthCm))

    const probe = this.probe as Probe
    const hits = probe.rayCastAllSync(origin, end)
    if (!hits || hits.length === 0) return null

    for (const hit of hits) {
      if (!hit || !hit.collider) continue
      for (const z of this.zones) {
        if (z.collider.isSame(hit.collider)) return z.id
      }
    }
    return null
  }
}
