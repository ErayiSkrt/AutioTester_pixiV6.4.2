import { IMediaInstance, PlayOptions } from '@pixi/sound';
import { AudioTester, LoadedAsset } from './AudioTester';

const DEFAULT_VOLUME = 0.4;
const ACCEPTED_EXT = ['m4a', 'ogg', 'oga', 'opus', 'mp3', 'mpeg', 'wav', 'aiff', 'aac', 'caf', 'flac'];

interface RowState {
  asset: LoadedAsset;
  rowEl: HTMLElement;
  selectEl: HTMLInputElement;
  activeLayerEl: HTMLInputElement;
  startEl: HTMLInputElement;
  endEl: HTMLInputElement;
  loopEl: HTMLInputElement;
  volumeEl: HTMLInputElement;
  volumeReadoutEl: HTMLElement;
  /** Live count of pixi-sound IMediaInstances currently playing this asset. */
  liveInstances: Set<IMediaInstance>;
}

interface NowPlayingEntry {
  assetName: string;
  instance: IMediaInstance;
  itemEl: HTMLElement;
  progressEl: HTMLElement;
  metaEl: HTMLElement;
  volumeEl: HTMLInputElement;
  volumeReadoutEl: HTMLElement;
  muteEl: HTMLInputElement;
  layerSwitchEl: HTMLInputElement;
  startedAt: number;
  duration: number;
  loop: boolean;
  rafId: number | null;
  disposeControls: () => void;
}

interface LayeredSession {
  instances: Map<string, IMediaInstance>;
  activeLayerName: string;
  fadeRafId: number | null;
  isSwapping: boolean;
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
    <label>Fade duration (s) <input type="number" id="fade-duration" min="0" step="0.05" value="1.00"></label>
    <span class="spacer"></span>
    <button id="stop-all" class="danger">Stop all</button>
  `;
  masterPanel.appendChild(masterRow);
  root.appendChild(masterPanel);

  const masterVolEl = masterRow.querySelector('#master-vol') as HTMLInputElement;
  const masterVolReadoutEl = masterRow.querySelector('#master-vol-readout') as HTMLElement;
  const masterMuteEl = masterRow.querySelector('#master-mute') as HTMLInputElement;
  const fadeDurationEl = masterRow.querySelector('#fade-duration') as HTMLInputElement;
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
  fadeDurationEl.addEventListener('change', () => {
    fadeDurationEl.value = getFadeDuration().toFixed(2);
  });
  stopAllBtn.addEventListener('click', () => {
    stopLayeredSession('layered: stop all layers');
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
    <button id="play-layered" class="primary">Play layered</button>
    <button id="swap-layer">Swap to selected</button>
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
  (batchRow.querySelector('#play-layered') as HTMLButtonElement).addEventListener('click', () => {
    void playLayered();
  });
  (batchRow.querySelector('#swap-layer') as HTMLButtonElement).addEventListener('click', () => {
    swapLayered();
  });
  (batchRow.querySelector('#stop-selected') as HTMLButtonElement).addEventListener('click', () => {
    if (layeredSession) {
      stopLayeredSession('layered: stop all layers');
      return;
    }
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
  let layeredSession: LayeredSession | null = null;

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
        <div class="field field-row layer-targets">
          <label><input type="radio" class="active-layer" name="active-layer"> Active</label>
        </div>
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
      activeLayerEl: rowEl.querySelector('.active-layer') as HTMLInputElement,
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
    rowEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Keep existing control interactions intact; only row background toggles selection.
      if (target.closest('button, input, label, a')) return;
      state.selectEl.checked = !state.selectEl.checked;
    });
    state.activeLayerEl.addEventListener('change', () => {
      if (!state.activeLayerEl.checked) return;
      if (layeredSession) performLayerSwap(state.asset.name);
    });

    (rowEl.querySelector('.play') as HTMLButtonElement).addEventListener('click', () => playRow(state));
    (rowEl.querySelector('.stop') as HTMLButtonElement).addEventListener('click', () => {
      tester.stop(asset.name);
      log(`stop("${asset.name}")`, 'info');
    });
    (rowEl.querySelector('.remove') as HTMLButtonElement).addEventListener('click', () => removeRow(state));

    rows.set(asset.name, state);
    if (rows.size === 1) {
      state.activeLayerEl.checked = true;
    }
    assetsList.appendChild(rowEl);
  }

  function removeRow(row: RowState): void {
    const wasActiveSelection = row.activeLayerEl.checked;
    tester.remove(row.asset.name);
    row.rowEl.remove();
    rows.delete(row.asset.name);
    if (layeredSession && layeredSession.instances.has(row.asset.name)) {
      layeredSession.instances.delete(row.asset.name);
      if (layeredSession.activeLayerName === row.asset.name) layeredSession.activeLayerName = '';
      if (layeredSession.instances.size === 0) layeredSession = null;
    }
    if (wasActiveSelection) {
      const fallback = Array.from(rows.values())[0];
      if (fallback) fallback.activeLayerEl.checked = true;
    }
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

  function getFadeDuration(): number {
    const raw = parseFloat(fadeDurationEl.value);
    if (!Number.isFinite(raw) || raw < 0) return 1;
    return raw;
  }

  function getLayeredActiveVolume(): number {
    const raw = parseFloat(masterVolEl.value);
    if (!Number.isFinite(raw)) return DEFAULT_VOLUME;
    return clamp01(raw);
  }

  function getSelectedRows(): RowState[] {
    return Array.from(rows.values()).filter((row) => row.selectEl.checked);
  }

  function getSelectedActiveRow(selectedRows: RowState[]): RowState | undefined {
    return selectedRows.find((row) => row.activeLayerEl.checked);
  }

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  function syncNowPlayingLayerSwitches(): void {
    nowPlaying.forEach((entry) => {
      if (!layeredSession) {
        entry.layerSwitchEl.checked = false;
        entry.layerSwitchEl.disabled = true;
        return;
      }
      const trackedInst = layeredSession.instances.get(entry.assetName);
      const inLayeredSession = trackedInst === entry.instance;
      entry.layerSwitchEl.disabled = !inLayeredSession;
      entry.layerSwitchEl.checked = inLayeredSession && layeredSession.activeLayerName === entry.assetName;
    });
  }

  function performLayerSwap(nextName: string): void {
    if (!layeredSession) {
      log('layered: nothing running. Use Play layered first.', 'warn');
      return;
    }
    if (layeredSession.isSwapping) {
      log('layered: swap already in progress.', 'warn');
      return;
    }
    const activeName = layeredSession.activeLayerName;
    if (!activeName) {
      log('layered: no active layer is set.', 'warn');
      return;
    }
    if (nextName === activeName) {
      syncNowPlayingLayerSwitches();
      return;
    }

    const fromInst = layeredSession.instances.get(activeName);
    const toInst = layeredSession.instances.get(nextName);
    if (!fromInst || !toInst) {
      log('layered: active or next instance is not running.', 'warn');
      syncNowPlayingLayerSwitches();
      return;
    }

    const durationSec = getFadeDuration();
    const prevActiveName = activeName;
    const startFrom = clamp01(fromInst.volume);
    const startTo = clamp01(toInst.volume);
    const targetTo = getLayeredActiveVolume();

    const completeSwap = () => {
      if (!layeredSession) return;
      layeredSession.activeLayerName = nextName;
      fromInst.volume = 0;
      toInst.volume = targetTo;
      const activeState = rows.get(nextName);
      if (activeState) activeState.activeLayerEl.checked = true;
      syncNowPlayingLayerSwitches();
      log(`layered: swapped "${prevActiveName}" -> "${nextName}" (${durationSec.toFixed(2)}s)`, 'info');
    };

    if (durationSec <= 0) {
      completeSwap();
      return;
    }

    layeredSession.isSwapping = true;
    const startedAt = performance.now();
    const tick = () => {
      if (!layeredSession) return;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const t = clamp01(elapsedSec / durationSec);
      fromInst.volume = clamp01(startFrom * (1 - t));
      toInst.volume = clamp01(startTo + (targetTo - startTo) * t);
      if (t >= 1) {
        if (layeredSession) {
          layeredSession.fadeRafId = null;
          layeredSession.isSwapping = false;
        }
        completeSwap();
        return;
      }
      if (layeredSession) layeredSession.fadeRafId = requestAnimationFrame(tick);
    };
    layeredSession.fadeRafId = requestAnimationFrame(tick);
  }

  function stopLayeredSession(logMessage?: string): void {
    if (!layeredSession) return;
    const session = layeredSession;
    layeredSession = null;
    if (session.fadeRafId !== null) cancelAnimationFrame(session.fadeRafId);
    session.instances.forEach((instance) => {
      try { instance.stop(); } catch (_) { /* already stopped */ }
    });
    syncNowPlayingLayerSwitches();
    if (logMessage) log(logMessage, 'info');
  }

  async function playLayered(): Promise<void> {
    const selectedRows = getSelectedRows();
    if (selectedRows.length < 2) {
      log('layered: select at least 2 rows.', 'warn');
      return;
    }
    const activeRow = getSelectedActiveRow(selectedRows);
    if (!activeRow) {
      log('layered: choose one Active row among selected.', 'warn');
      return;
    }

    stopLayeredSession();

    const instances = new Map<string, IMediaInstance>();
    for (const row of selectedRows) {
      const start = parseFloat(row.startEl.value) || 0;
      const endRaw = parseFloat(row.endEl.value);
      const opts: PlayOptions = {
        start,
        loop: row.loopEl.checked,
        volume: 0,
        complete: () => {
          log(`complete("${row.asset.name}")`, 'info');
        },
      };
      if (Number.isFinite(endRaw) && endRaw > 0) opts.end = endRaw;

      let result: ReturnType<AudioTester['play']>;
      try {
        result = tester.play(row.asset.name, opts);
      } catch (err) {
        log(`layered: play failed for "${row.asset.name}": ${(err as Error).message}`, 'error');
        instances.forEach((instance) => {
          try { instance.stop(); } catch (_) { /* already stopped */ }
        });
        return;
      }
      if (!result) {
        log(`layered: no instance for "${row.asset.name}"`, 'error');
        instances.forEach((instance) => {
          try { instance.stop(); } catch (_) { /* already stopped */ }
        });
        return;
      }
      const instance = result instanceof Promise ? await result : result;
      attachInstance(row, instance, opts);
      instance.muted = false;
      instance.volume = 0;
      instances.set(row.asset.name, instance);
    }

    const activeInstance = instances.get(activeRow.asset.name);
    if (!activeInstance) {
      log('layered: active layer did not start.', 'error');
      instances.forEach((instance) => {
        try { instance.stop(); } catch (_) { /* already stopped */ }
      });
      return;
    }
    activeInstance.volume = getLayeredActiveVolume();

    layeredSession = {
      instances,
      activeLayerName: activeRow.asset.name,
      fadeRafId: null,
      isSwapping: false,
    };
    syncNowPlayingLayerSwitches();
    log(
      `layered: playing ${selectedRows.length} layers, active="${activeRow.asset.name}", fade=${getFadeDuration().toFixed(2)}s`,
      'info',
    );
  }

  function swapLayered(): void {
    if (!layeredSession) {
      log('layered: nothing running. Use Play layered first.', 'warn');
      return;
    }
    if (layeredSession.isSwapping) {
      log('layered: swap already in progress.', 'warn');
      return;
    }

    const targets = getSelectedRows().filter((row) => row.asset.name !== layeredSession.activeLayerName);
    if (targets.length === 0) {
      log('layered: select a target row different from active.', 'warn');
      return;
    }
    performLayerSwap(targets[0].asset.name);
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
    addNowPlaying(row, instance, Math.max(0, duration), !!opts.loop, opts.volume);

    instance.once('end', () => detachInstance(row, instance, 'end'));
    instance.once('stop', () => detachInstance(row, instance, 'stop'));
  }

  function detachInstance(row: RowState, instance: IMediaInstance, reason: 'end' | 'stop'): void {
    if (!row.liveInstances.has(instance)) return;
    row.liveInstances.delete(instance);
    if (row.liveInstances.size === 0) row.rowEl.classList.remove('is-playing');
    if (layeredSession) {
      const tracked = layeredSession.instances.get(row.asset.name);
      if (tracked === instance) {
        layeredSession.instances.delete(row.asset.name);
        if (layeredSession.activeLayerName === row.asset.name) {
          layeredSession.activeLayerName = '';
        }
        if (layeredSession.instances.size === 0) layeredSession = null;
      }
    }
    const entry = nowPlaying.get(instance);
    if (entry) removeNowPlaying(entry);
    log(`${reason}("${row.asset.name}")`, 'info');
  }

  function addNowPlaying(
    row: RowState,
    instance: IMediaInstance,
    duration: number,
    loop: boolean,
    initialVolumeRaw: number | undefined,
  ): void {
    if (nowPlayingEmpty.parentElement) nowPlayingEmpty.remove();

    const initialVolume = Math.max(0, Math.min(1, initialVolumeRaw ?? DEFAULT_VOLUME));

    const itemEl = document.createElement('div');
    itemEl.className = 'now-playing-item';
    itemEl.innerHTML = `
      <span class="name"></span>
      <span class="meta"></span>
      <button class="stop">Stop</button>
      <div class="controls">
        <label>Volume <span class="vol-readout">${initialVolume.toFixed(2)}</span></label>
        <input type="range" class="volume" min="0" max="1" step="0.01" value="${initialVolume}">
        <label class="mute-toggle"><input type="checkbox" class="mute"> Mute</label>
        <label class="activate-layer-toggle"><input type="radio" class="activate-layer" name="now-playing-active-layer"> Activate layer</label>
      </div>
      <div class="progress"><div></div></div>
    `;
    (itemEl.querySelector('.name') as HTMLElement).textContent = row.asset.name;
    const metaEl = itemEl.querySelector('.meta') as HTMLElement;
    const progressEl = itemEl.querySelector('.progress > div') as HTMLElement;
    const volumeEl = itemEl.querySelector('.volume') as HTMLInputElement;
    const volumeReadoutEl = itemEl.querySelector('.vol-readout') as HTMLElement;
    const muteEl = itemEl.querySelector('.mute') as HTMLInputElement;
    const layerSwitchEl = itemEl.querySelector('.activate-layer') as HTMLInputElement;
    (itemEl.querySelector('.stop') as HTMLButtonElement).addEventListener('click', () => {
      try { instance.stop(); } catch (_) { /* already stopped */ }
    });
    nowPlayingList.appendChild(itemEl);

    instance.volume = initialVolume;
    instance.muted = false;

    const onVolumeInput = () => {
      const volume = Math.max(0, Math.min(1, parseFloat(volumeEl.value) || 0));
      volumeReadoutEl.textContent = volume.toFixed(2);
      instance.volume = volume;
    };
    const onMuteChange = () => {
      instance.muted = muteEl.checked;
    };
    const onLayerSwitchChange = () => {
      if (!layerSwitchEl.checked) return;
      performLayerSwap(row.asset.name);
    };
    volumeEl.addEventListener('input', onVolumeInput);
    muteEl.addEventListener('change', onMuteChange);
    layerSwitchEl.addEventListener('change', onLayerSwitchChange);

    const entry: NowPlayingEntry = {
      assetName: row.asset.name,
      instance,
      itemEl,
      progressEl,
      metaEl,
      volumeEl,
      volumeReadoutEl,
      muteEl,
      layerSwitchEl,
      startedAt: performance.now(),
      duration,
      loop,
      rafId: null,
      disposeControls: () => {
        volumeEl.removeEventListener('input', onVolumeInput);
        muteEl.removeEventListener('change', onMuteChange);
        layerSwitchEl.removeEventListener('change', onLayerSwitchChange);
      },
    };
    nowPlaying.set(instance, entry);
    syncNowPlayingLayerSwitches();

    const tick = () => {
      if (!nowPlaying.has(instance)) return;
      // Keep the meter in sync when volume is changed programmatically (e.g. layered crossfades).
      const liveVolume = clamp01(instance.volume);
      volumeEl.value = liveVolume.toFixed(2);
      volumeReadoutEl.textContent = liveVolume.toFixed(2);
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
    entry.disposeControls();
    entry.itemEl.remove();
    nowPlaying.delete(entry.instance);
    syncNowPlayingLayerSwitches();
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
