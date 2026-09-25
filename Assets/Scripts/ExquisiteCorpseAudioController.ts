// ExquisiteCorpseAudioController.ts
//
// OWNS: every sound the game makes — three one-shot cues. There is no music
// bed; the Lens plays against ambient room sound.
//
// Playback mode matters on Specs: interactive cues use LowLatency so DONE and
// UNDO land with the gesture.
//
// EXPECTS: @inputs below. Audio assets are baked via requireAsset, not wired,
// because they are fixed internal assets rather than swappable slots.
//
// MUST NOT: decide when anything happens. Main calls these.

const SFX_DONE = requireAsset("../GeneratedSFX/DoneConfirm.wav") as AudioTrackAsset
const SFX_UNDO = requireAsset("../GeneratedSFX/UndoWhoosh.wav") as AudioTrackAsset
const SFX_REVEAL = requireAsset("../GeneratedSFX/RevealChime.wav") as AudioTrackAsset

@component
export class ExquisiteCorpseAudioController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Audio – UI cues</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Volume of the one-shot interface cues.")
  @widget(new SliderWidget(0, 1, 0.05))
  sfxVolume: number = 0.2
  @ui.group_end

  private done: AudioComponent | null = null
  private undo: AudioComponent | null = null
  private reveal: AudioComponent | null = null
  private muted: boolean = false

  onAwake(): void {
    this.done = this.makeCue("SfxDone", SFX_DONE)
    this.undo = this.makeCue("SfxUndo", SFX_UNDO)
    this.reveal = this.makeCue("SfxReveal", SFX_REVEAL)
  }

  private makeCue(name: string, track: AudioTrackAsset): AudioComponent {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.sceneObject)
    const audio = so.createComponent("Component.AudioComponent") as AudioComponent
    audio.audioTrack = track
    audio.volume = this.sfxVolume
    // Interactive cue: latency is audible against the gesture that caused it.
    audio.playbackMode = Audio.PlaybackMode.LowLatency
    return audio
  }

  /** True when sound is off. Read by the UI to pick the speaker icon. */
  get isMuted(): boolean {
    return this.muted
  }

  /** Silences the cues; returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted
    return this.muted
  }

  private fire(a: AudioComponent | null): void {
    if (!a || this.muted) return
    a.volume = this.sfxVolume
    a.stop(false)
    a.play(1)
  }

  playDone(): void {
    this.fire(this.done)
  }

  playUndo(): void {
    this.fire(this.undo)
  }

  playReveal(): void {
    this.fire(this.reveal)
  }
}
