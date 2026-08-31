// ExquisiteCorpseAudioController.ts
//
// OWNS: every sound the game makes — three one-shot cues and the ambient bed.
//
// Playback modes matter on Specs: interactive cues use LowLatency so DONE and
// UNDO land with the gesture, while the looping bed uses the LowPower default
// where a little latency costs nothing.
//
// EXPECTS: @inputs below. Audio assets are baked via requireAsset, not wired,
// because they are fixed internal assets rather than swappable slots.
//
// MUST NOT: decide when anything happens. Main calls these.

const SFX_DONE = requireAsset("../GeneratedSFX/DoneConfirm.wav") as AudioTrackAsset
const SFX_UNDO = requireAsset("../GeneratedSFX/UndoWhoosh.wav") as AudioTrackAsset
const SFX_REVEAL = requireAsset("../GeneratedSFX/RevealChime.wav") as AudioTrackAsset
const MUSIC_BED = requireAsset("../GeneratedSFX/AmbientBed.wav") as AudioTrackAsset

@component
export class ExquisiteCorpseAudioController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Audio – UI cues and the ambient bed</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Volume of the one-shot interface cues.")
  @widget(new SliderWidget(0, 1, 0.05))
  sfxVolume: number = 0.35

  @input
  @hint("Volume of the looping ambient bed. Set to 0 to play in silence.")
  @widget(new SliderWidget(0, 1, 0.05))
  musicVolume: number = 0.45
  @ui.group_end

  private done: AudioComponent | null = null
  private undo: AudioComponent | null = null
  private reveal: AudioComponent | null = null
  private music: AudioComponent | null = null
  private muted: boolean = false

  onAwake(): void {
    this.done = this.makeCue("SfxDone", SFX_DONE)
    this.undo = this.makeCue("SfxUndo", SFX_UNDO)
    this.reveal = this.makeCue("SfxReveal", SFX_REVEAL)

    // Background bed starts immediately and loops for the whole session.
    const musicObj = global.scene.createSceneObject("MusicBed")
    musicObj.setParent(this.sceneObject)
    const music = musicObj.createComponent("Component.AudioComponent") as AudioComponent
    music.audioTrack = MUSIC_BED
    music.volume = this.musicVolume
    this.music = music
    if (this.musicVolume > 0) music.play(-1)
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

  /** Silences cues and the bed together; returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.music) this.music.volume = this.muted ? 0 : this.musicVolume
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
