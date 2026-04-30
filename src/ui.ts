import { IMediaInstance, PlayOptions } from '@pixi/sound';
import { AudioTester, LoadedAsset } from './AudioTester';

const DEFAULT_VOLUME = 0.7;
const ACCEPTED_EXT = ['m4a', 'ogg', 'oga', 'opus', 'mp3', 'mpeg', 'wav', 'aiff', 'aac', 'caf', 'flac'];

interface RowState {
  asset: LoadedAsset;
  rowEl: HTMLElement;
  selectEl: HTMLInputElement;
  startEl: HTMLInputElement;
  endEl: HTMLInputElement;
  loopEl: HTMLInputElement;
  volumeEl: HTMLInputElement;
  volumeReadoutEl: HTMLElement;
  /** Live count of pixi-sound IMediaInstances currently playing this asset. */
  liveInstances: Set<IMediaInstance>;
}

interface NowPlayingEntry {
  instance: IMediaInstance;
  itemEl: HTMLElement;
  progressEl: HTMLElement;
  metaEl: HTMLElement;
  startedAt: number;
  duration: number;
  loop: boolean;
  rafId: number | null;
}

export function buildUI(root: HTMLElement, tester: AudioTester): void {
  root.innerHTML = '';

  // ----- Header -----
  const header = document.createElement('div');
  header.innerHTML = `
    <h1>Audio Tester</h1>
    <div class="subtitle">
      Drag audio files to load them, tweak per-asset PlayOptions, and call
      <code>sound.play(name, opts)</code>. Mirrors how
      <code>AudioPlayerGA</code> drives <code>@pixi/sound</code>.
    </div>
  `;
  root.appendChild(header);

  // ----- Drop zone -----
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  dropZone.innerHTML = `
    <div><strong>Drop audio files here</strong> or click to pick</div>
    <div class="hint">Accepts: ${ACCEPTED_EXT.join(', ')}</div>
    <input type="file" multiple accept="audio/*">
  `;
  const fileInput = dropZone.querySelector('input[type="file"]') as HTMLInputElement;
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
    if (!e.dataTransfer) return;
    handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });
  root.appendChild(dropZone);

  // ----- Master controls -----
  const masterPanel = panel('Master');
  const masterRow = document.createElement('div');
  masterRow.className = 'master-row';
  masterRow.innerHTML = `
    <label>Volume <input type="range" id="master-vol" min="0" max="1" step="0.01" value="${DEFAULT_VOLUME}"></label>
    <span class="vol-readout" id="master-vol-readout">${DEFAULT_VOLUME.toFixed(2)}</span>
    <label><input type="checkbox" id="master-mute"> Mute all</label>
    <span class="spacer"></span>
    <button id="stop-all" class="danger">Stop all</button>
  `;
  masterPanel.appendChild(masterRow);
  root.appendChild(masterPanel);

  const masterVolEl = masterRow.querySelector('#master-vol') as HTMLInputElement;
  const masterVolReadoutEl = masterRow.querySelector('#master-vol-readout') as HTMLElement;
  const masterMuteEl = masterRow.querySelector('#master-mute') as HTMLInputElement;
  const stopAllBtn = masterRow.querySelector('#stop-all') as HTMLButtonElement;

  tester.setMasterVolume(parseFloat(masterVolEl.value));
  masterVolEl.addEventListener('input', () => {
    const v = parseFloat(masterVolEl.value);
    tester.setMasterVolume(v);
    masterVolReadoutEl.textContent = v.toFixed(2);
  });
  masterMuteEl.addEventListener('change', () => {
    tester.setMasterMuted(masterMuteEl.checked);
    log(masterMuteEl.checked ? 'master: muted' : 'master: unmuted', 'info');
  });
  stopAllBtn.addEventListener('click', () => {
    tester.stopAll();
    nowPlaying.forEach((entry) => removeNowPlaying(entry));
    log('stopAll()', 'info');
  });

  // ----- Loaded assets -----
  const assetsPanel = panel('Loaded assets');
  const assetsList = document.createElement('div');
  assetsList.className = 'assets';
  const emptyEl = document.createElement('div');
  emptyEl.className = 'empty';
  emptyEl.textContent = 'No files loaded yet.';
  assetsList.appendChild(emptyEl);
  assetsPanel.appendChild(assetsList);

  const batchRow = document.createElement('div');
  batchRow.className = 'batch-row';
  batchRow.style.marginTop = '12px';
  batchRow.innerHTML = `
    <button id="play-selected" class="primary">Play selected</button>
    <button id="stop-selected">Stop selected</button>
    <button id="remove-selected" class="danger">Remove selected</button>
    <span class="spacer"></span>
    <button id="select-all">Select all</button>
    <button id="select-none">Select none</button>
  `;
  assetsPanel.appendChild(batchRow);
  root.appendChild(assetsPanel);

  (batchRow.querySelector('#play-selected') as HTMLButtonElement).addEventListener('click', () => {
    forEachSelected((row) => playRow(row));
  });
  (batchRow.querySelector('#stop-selected') as HTMLButtonElement).addEventListener('click', () => {
    forEachSelected((row) => {
      tester.stop(row.asset.name);
      log(`stop("${row.asset.name}")`, 'info');
    });
  });
  (batchRow.querySelector('#remove-selected') as HTMLButtonElement).addEventListener('click', () => {
    const selected = Array.from(rows.values()).filter((r) => r.selectEl.checked);
    selected.forEach((row) => removeRow(row));
  });
  (batchRow.querySelector('#select-all') as HTMLButtonElement).addEventListener('click', () => {
    rows.forEach((r) => (r.selectEl.checked = true));
  });
  (batchRow.querySelector('#select-none') as HTMLButtonElement).addEventListener('click', () => {
    rows.forEach((r) => (r.selectEl.checked = false));
  });

  // ----- Now playing -----
  const nowPlayingPanel = panel('Now playing');
  const nowPlayingList = document.createElement('div');
  nowPlayingList.className = 'now-playing-list';
  const nowPlayingEmpty = document.createElement('div');
  nowPlayingEmpty.className = 'empty';
  nowPlayingEmpty.textContent = 'Nothing is playing.';
  nowPlayingList.appendChild(nowPlayingEmpty);
  nowPlayingPanel.appendChild(nowPlayingList);
  root.appendChild(nowPlayingPanel);

  // ----- Log -----
  const logPanel = panel('Log');
  const logEl = document.createElement('div');
  logEl.className = 'log';
  logPanel.appendChild(logEl);
  root.appendChild(logPanel);

  // ===== State =====
  const rows = new Map<string, RowState>();
  const nowPlaying = new Map<IMediaInstance, NowPlayingEntry>();

  // ===== Helpers =====
  function panel(title: string): HTMLElement {
    const p = document.createElement('section');
    p.className = 'panel';
    const h = document.createElement('h2');
    h.textContent = title;
    p.appendChild(h);
    return p;
  }

  function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    const ts = new Date();
    const timeStr = `${ts.toLocaleTimeString()}.${ts.getMilliseconds().toString().padStart(3, '0')}`;
    line.innerHTML = `<span class="ts">[${timeStr}]</span><span class="msg"></span>`;
    (line.querySelector('.msg') as HTMLElement).textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function handleFiles(files: File[]): Promise<void> {
    const audio = files.filter((f) => isLikelyAudio(f));
    if (audio.length === 0) {
      log('No supported audio files in drop.', 'warn');
      return;
    }
    for (const file of audio) {
      log(`load "${file.name}" (${formatSize(file.size)})`, 'info');
      try {
        const asset = await tester.add(file);
        addRow(asset);
        log(`loaded "${asset.name}" (${asset.duration.toFixed(3)}s)`, 'info');
      } catch (err) {
        log(`failed "${file.name}": ${(err as Error).message}`, 'error');
      }
    }
  }

  function isLikelyAudio(file: File): boolean {
    if (file.type && file.type.startsWith('audio/')) return true;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return ACCEPTED_EXT.includes(ext);
  }

  function formatSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function addRow(asset: LoadedAsset): void {
    if (emptyEl.parentElement) emptyEl.remove();

    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    rowEl.innerHTML = `
      <div class="row-select"><input type="checkbox" class="select"></div>
      <div class="row-info">
        <span class="name"></span>
        <span class="meta"></span>
      </div>
      <div class="row-buttons">
        <button class="play primary">Play</button>
        <button class="stop">Stop</button>
        <button class="remove danger">Remove</button>
      </div>
      <div class="row-controls">
        <div class="field">
          <label>Start (s)</label>
          <input type="number" class="start" min="0" step="0.01" value="0">
        </div>
        <div class="field">
          <label>End (s) <span class="hint" title="0 = full duration">[0 = full]</span></label>
          <input type="number" class="end" min="0" step="0.01" value="${asset.duration.toFixed(3)}">
        </div>
        <div class="field field-row">
          <label><input type="checkbox" class="loop"> Loop</label>
        </div>
        <div class="field">
          <label>Volume <span class="vol-readout">${DEFAULT_VOLUME.toFixed(2)}</span></label>
          <input type="range" class="volume" min="0" max="1" step="0.01" value="${DEFAULT_VOLUME}">
        </div>
      </div>
    `;
    (rowEl.querySelector('.name') as HTMLElement).textContent = asset.name;
    (rowEl.querySelector('.meta') as HTMLElement).textContent =
      `${asset.format.toUpperCase()} • ${asset.duration.toFixed(3)}s • ${formatSize(asset.size)}`;

    const state: RowState = {
      asset,
      rowEl,
      selectEl: rowEl.querySelector('.select') as HTMLInputElement,
      startEl: rowEl.querySelector('.start') as HTMLInputElement,
      endEl: rowEl.querySelector('.end') as HTMLInputElement,
      loopEl: rowEl.querySelector('.loop') as HTMLInputElement,
      volumeEl: rowEl.querySelector('.volume') as HTMLInputElement,
      volumeReadoutEl: rowEl.querySelector('.vol-readout') as HTMLElement,
      liveInstances: new Set(),
    };

    state.volumeEl.addEventListener('input', () => {
      state.volumeReadoutEl.textContent = parseFloat(state.volumeEl.value).toFixed(2);
    });

    (rowEl.querySelector('.play') as HTMLButtonElement).addEventListener('click', () => playRow(state));
    (rowEl.querySelector('.stop') as HTMLButtonElement).addEventListener('click', () => {
      tester.stop(asset.name);
      log(`stop("${asset.name}")`, 'info');
    });
    (rowEl.querySelector('.remove') as HTMLButtonElement).addEventListener('click', () => removeRow(state));

    rows.set(asset.name, state);
    assetsList.appendChild(rowEl);
  }

  function removeRow(row: RowState): void {
    tester.remove(row.asset.name);
    row.rowEl.remove();
    rows.delete(row.asset.name);
    if (rows.size === 0) assetsList.appendChild(emptyEl);
    log(`remove("${row.asset.name}")`, 'info');
  }

  function forEachSelected(fn: (row: RowState) => void): void {
    let count = 0;
    rows.forEach((row) => {
      if (row.selectEl.checked) {
        fn(row);
        count += 1;
      }
    });
    if (count === 0) log('No assets selected.', 'warn');
  }

  function playRow(row: RowState): void {
    const start = parseFloat(row.startEl.value) || 0;
    const endRaw = parseFloat(row.endEl.value);
    const loop = row.loopEl.checked;
    const volume = parseFloat(row.volumeEl.value);

    const opts: PlayOptions = {
      start,
      loop,
      volume,
      complete: () => {
        log(`complete("${row.asset.name}")`, 'info');
      },
    };
    if (Number.isFinite(endRaw) && endRaw > 0) opts.end = endRaw;

    log(`play("${row.asset.name}", ${describeOpts(opts)})`, 'info');

    let result: ReturnType<AudioTester['play']>;
    try {
      result = tester.play(row.asset.name, opts);
    } catch (err) {
      log(`play failed: ${(err as Error).message}`, 'error');
      return;
    }
    if (!result) return;

    if (result instanceof Promise) {
      result
        .then((inst) => attachInstance(row, inst, opts))
        .catch((err) => log(`play error: ${err.message}`, 'error'));
    } else {
      attachInstance(row, result, opts);
    }
  }

  function attachInstance(row: RowState, instance: IMediaInstance, opts: PlayOptions): void {
    row.liveInstances.add(instance);
    row.rowEl.classList.add('is-playing');

    const duration = (opts.end ?? row.asset.duration) - (opts.start ?? 0);
    addNowPlaying(row, instance, Math.max(0, duration), !!opts.loop);

    instance.once('end', () => detachInstance(row, instance, 'end'));
    instance.once('stop', () => detachInstance(row, instance, 'stop'));
  }

  function detachInstance(row: RowState, instance: IMediaInstance, reason: 'end' | 'stop'): void {
    if (!row.liveInstances.has(instance)) return;
    row.liveInstances.delete(instance);
    if (row.liveInstances.size === 0) row.rowEl.classList.remove('is-playing');
    const entry = nowPlaying.get(instance);
    if (entry) removeNowPlaying(entry);
    log(`${reason}("${row.asset.name}")`, 'info');
  }

  function addNowPlaying(row: RowState, instance: IMediaInstance, duration: number, loop: boolean): void {
    if (nowPlayingEmpty.parentElement) nowPlayingEmpty.remove();

    const itemEl = document.createElement('div');
    itemEl.className = 'now-playing-item';
    itemEl.innerHTML = `
      <span class="name"></span>
      <span class="meta"></span>
      <button class="stop">Stop</button>
      <div class="progress"><div></div></div>
    `;
    (itemEl.querySelector('.name') as HTMLElement).textContent = row.asset.name;
    const metaEl = itemEl.querySelector('.meta') as HTMLElement;
    const progressEl = itemEl.querySelector('.progress > div') as HTMLElement;
    (itemEl.querySelector('.stop') as HTMLButtonElement).addEventListener('click', () => {
      try { instance.stop(); } catch (_) { /* already stopped */ }
    });
    nowPlayingList.appendChild(itemEl);

    const entry: NowPlayingEntry = {
      instance,
      itemEl,
      progressEl,
      metaEl,
      startedAt: performance.now(),
      duration,
      loop,
      rafId: null,
    };
    nowPlaying.set(instance, entry);

    const tick = () => {
      if (!nowPlaying.has(instance)) return;
      const elapsed = (performance.now() - entry.startedAt) / 1000;
      const segDur = entry.duration > 0 ? entry.duration : 1;
      const ratio = entry.loop ? (elapsed % segDur) / segDur : Math.min(1, elapsed / segDur);
      progressEl.style.width = `${(ratio * 100).toFixed(2)}%`;
      const loopCount = entry.loop ? Math.floor(elapsed / segDur) : 0;
      metaEl.textContent = entry.loop
        ? `loop x${loopCount} • ${(elapsed % segDur).toFixed(2)} / ${segDur.toFixed(2)}s`
        : `${Math.min(elapsed, segDur).toFixed(2)} / ${segDur.toFixed(2)}s`;
      entry.rafId = requestAnimationFrame(tick);
    };
    entry.rafId = requestAnimationFrame(tick);
  }

  function removeNowPlaying(entry: NowPlayingEntry): void {
    if (entry.rafId !== null) cancelAnimationFrame(entry.rafId);
    entry.itemEl.remove();
    nowPlaying.delete(entry.instance);
    if (nowPlaying.size === 0) nowPlayingList.appendChild(nowPlayingEmpty);
  }

  function describeOpts(opts: PlayOptions): string {
    const parts: string[] = [];
    if (opts.start !== undefined) parts.push(`start: ${opts.start}`);
    if (opts.end !== undefined) parts.push(`end: ${opts.end}`);
    parts.push(`loop: ${!!opts.loop}`);
    if (opts.volume !== undefined) parts.push(`volume: ${opts.volume}`);
    return `{ ${parts.join(', ')} }`;
  }

  log('Audio Tester ready. Drop files to begin.', 'info');
}
