# Audio Tester

Standalone browser app for exercising `@pixi/sound`'s `sound.play(name, PlayOptions)` directly. Mirrors the load + play path used by `AudioPlayerGA` (`sources/slot/sys/Audio/AudioPlayerGA.ts`) without the slot's mute / duck / fade machinery, so you can isolate the effect of each `PlayOptions` field on a real audio file.

Useful for reproducing browser-specific playback quirks (e.g. the AAC priming-sample loop gap on Safari and iOS).

## Setup

The folder is fully isolated from the parent project. It has its own `node_modules` and webpack config.

```sh
cd AudioTester
npm install
npm start
```

`npm start` runs `webpack-dev-server` on <http://localhost:9000> and opens it in your default browser. To test on a phone or another device on your LAN, hit `http://<your-LAN-IP>:9000` (the dev server binds `0.0.0.0`).

To produce a static bundle:

```sh
npm run build       # outputs to dist/
```

You can then host `dist/` from any static server (e.g. `npx http-server dist`) — handy when you want to run the tester on a Mac / iOS device without running webpack-dev-server there.

## Using it

1. **Load files**: drag audio files onto the drop zone (or click it). Multiple files at once is fine. Accepted: `m4a, ogg, oga, opus, mp3, mpeg, wav, aiff, aac, caf, flac` (whatever your browser can decode).
2. **Tweak per-asset PlayOptions** in each row:
   - **Start** (seconds, default `0`)
   - **End** (seconds, default = the decoded duration; set to `0` to omit and let pixi-sound use the full file)
   - **Loop** (default off)
   - **Volume** (slider 0–1, default `0.7`)
3. **Play** a single row with its `Play` button, or check several rows and click **Play selected**. Each press calls `sound.play(name, opts)` — opening multiple instances if pressed repeatedly, exactly like `AudioPlayerGA.play`.
4. **Master row** at the top binds to `sound.volumeAll`, `sound.muteAll/unmuteAll` and `sound.stopAll`.
5. **Now playing** panel tracks each `IMediaInstance` and shows a progress bar / loop counter.
6. **Log** at the bottom shows every play / stop / complete event with timestamps.

The created tester is also exposed on `window.audioTester` so you can drive it from DevTools, e.g.:

```js
audioTester.play('base_music1.m4a', { loop: true, volume: 0.7 });
audioTester.stop('base_music1.m4a');
```

## Reproducing the Safari / iOS loop gap

1. Drop the same music file twice — once `.m4a` and once `.ogg` (or any non-AAC format).
2. Set both rows to `loop: true`, `start: 0`, `end: 0`, `volume: 0.7`.
3. Press **Play** on each in turn. On Mac/iOS Safari, the `.m4a` row will exhibit an audible gap at every loop wrap (AAC encoder priming silence that Safari does not trim); the `.ogg` row will loop seamlessly. On Chrome both will be seamless.
