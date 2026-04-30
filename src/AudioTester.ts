import { sound, Sound, IMediaInstance, PlayOptions } from '@pixi/sound';

/** Metadata about a loaded asset, displayed in the UI. */
export interface LoadedAsset {
  /** Unique key used with `sound.add(name, ...)`. */
  name: string;
  /** Original filename (may differ from `name` when duplicates were renamed). */
  fileName: string;
  /** Lowercased extension, e.g. `m4a`, `ogg`, `mp3`. */
  format: string;
  /** Decoded duration in seconds. */
  duration: number;
  /** Source size in bytes. */
  size: number;
  /** Object URL backing the Sound (revoked on remove). */
  url: string;
}

/**
 * Thin wrapper around `@pixi/sound`'s singleton. Mirrors the load + play
 * surface used by `AudioPlayerGA` (sources/slot/sys/Audio/AudioPlayerGA.ts)
 * but intentionally omits the slot-specific machinery (mute groups, ducking,
 * fades, music vs sfx distinction). Goal is to exercise `sound.play(name,
 * PlayOptions)` directly so the effect of each PlayOptions field can be
 * observed without other logic interfering.
 */
export class AudioTester {
  private readonly _assets = new Map<string, LoadedAsset>();
  private readonly _sounds = new Map<string, Sound>();

  /**
   * Load a `File` (typically from drag-and-drop or a file picker) into
   * `@pixi/sound`. Resolves once the audio is decoded into an AudioBuffer.
   */
  add(file: File): Promise<LoadedAsset> {
    return new Promise<LoadedAsset>((resolve, reject) => {
      const name = this.uniqueName(file.name);
      const url = URL.createObjectURL(file);
      const ext = (file.name.split('.').pop() || '').toLowerCase();

      let added: Sound;
      try {
        added = sound.add(name, {
          url,
          preload: true,
          loaded: (err: Error, snd: Sound) => {
            if (err) {
              URL.revokeObjectURL(url);
              try { sound.remove(name); } catch (_) { /* may not exist yet */ }
              reject(err);
              return;
            }
            const asset: LoadedAsset = {
              name,
              fileName: file.name,
              format: ext,
              duration: snd.duration,
              size: file.size,
              url,
            };
            this._assets.set(name, asset);
            this._sounds.set(name, snd);
            resolve(asset);
          },
        });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err as Error);
        return;
      }

      // pixi-sound's `add` returns the Sound synchronously even though the
      // buffer isn't decoded yet; track it so we can remove it on error.
      void added;
    });
  }

  /**
   * Play `name` with the given `PlayOptions`. Returns the IMediaInstance (or
   * a Promise resolving to one when the sound was still loading).
   */
  play(name: string, opts: PlayOptions): IMediaInstance | Promise<IMediaInstance> | undefined {
    const snd = this._sounds.get(name);
    if (!snd) return undefined;
    return snd.play(opts);
  }

  /** Stop every instance of `name`. */
  stop(name: string): void {
    const snd = this._sounds.get(name);
    if (snd && snd.isPlaying) snd.stop();
  }

  /** Stop every instance of every loaded asset. */
  stopAll(): void {
    sound.stopAll();
  }

  /** Remove an asset entirely (stops it, releases the buffer + object URL). */
  remove(name: string): void {
    this.stop(name);
    const asset = this._assets.get(name);
    if (asset) URL.revokeObjectURL(asset.url);
    try { sound.remove(name); } catch (_) { /* already gone */ }
    this._assets.delete(name);
    this._sounds.delete(name);
  }

  /** Snapshot of all currently loaded assets. */
  list(): LoadedAsset[] {
    return Array.from(this._assets.values());
  }

  /** True if `sound.find(name)` reports it as currently playing. */
  isPlaying(name: string): boolean {
    const snd = this._sounds.get(name);
    return !!snd && !!snd.isPlaying;
  }

  /** Set master volume (0..1). */
  setMasterVolume(v: number): void {
    sound.volumeAll = Math.max(0, Math.min(1, v));
  }

  /** Toggle master mute. */
  setMasterMuted(muted: boolean): void {
    if (muted) sound.muteAll();
    else sound.unmuteAll();
  }

  private uniqueName(fileName: string): string {
    if (!this._sounds.has(fileName)) return fileName;
    let n = 2;
    let candidate = `${fileName} (${n})`;
    while (this._sounds.has(candidate)) {
      n += 1;
      candidate = `${fileName} (${n})`;
    }
    return candidate;
  }
}
