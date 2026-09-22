// Lazy-loaded ffmpeg.wasm wrapper. Everything runs locally in the browser
// (single-threaded core — no cross-origin-isolation headers required, so it
// works on plain static hosting like GitHub Pages).

const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm';
const FFMPEG_JS = `${FFMPEG_BASE}/index.js`;
const FFMPEG_UTIL_JS = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

let ffmpegInstance = null;
let loadingPromise = null;
let fetchFileFn = null;
let progressHandler = null;

// worker.js has two same-directory relative imports (./const.js, ./errors.js).
// A naive blob URL for worker.js alone breaks those (blob URLs have no real
// base path to resolve "./x.js" against), so patch them to point at their
// own blob URLs before blobbing the worker itself.
async function buildClassWorkerBlobURL() {
  const [workerSrc, constSrc, errorsSrc] = await Promise.all([
    fetch(`${FFMPEG_BASE}/worker.js`).then((r) => r.text()),
    fetch(`${FFMPEG_BASE}/const.js`).then((r) => r.text()),
    fetch(`${FFMPEG_BASE}/errors.js`).then((r) => r.text()),
  ]);
  const constURL = URL.createObjectURL(new Blob([constSrc], { type: 'text/javascript' }));
  const errorsURL = URL.createObjectURL(new Blob([errorsSrc], { type: 'text/javascript' }));
  const patched = workerSrc
    .replace('from "./const.js"', `from "${constURL}"`)
    .replace('from "./errors.js"', `from "${errorsURL}"`);
  return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
}

function resetFFmpeg() {
  try { ffmpegInstance?.terminate(); } catch { /* ignore */ }
  ffmpegInstance = null;
  loadingPromise = null;
}

/**
 * A failed ffmpeg.exec() call permanently kills the underlying WASM instance
 * (it logs "Aborted()" and never responds again), so any exec must reset the
 * singleton on failure — otherwise every later operation hangs forever.
 */
async function execOrReset(ffmpeg, args) {
  try {
    await ffmpeg.exec(args);
  } catch (err) {
    resetFFmpeg();
    throw err;
  }
}

/** Cheap, ffmpeg-free audio-track probe via the Web Audio API. */
async function hasAudioTrack(file) {
  try {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      const audioBuf = await ctx.decodeAudioData(buf);
      return audioBuf.duration > 0;
    } finally {
      ctx.close();
    }
  } catch {
    return false;
  }
}

export async function getFFmpeg(onProgress) {
  if (onProgress) progressHandler = onProgress;
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
      import(/* webpackIgnore: true */ FFMPEG_JS),
      import(/* webpackIgnore: true */ FFMPEG_UTIL_JS),
    ]);
    fetchFileFn = fetchFile;
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      if (progressHandler) progressHandler(Math.min(100, Math.max(0, Math.round(progress * 100))));
    });
    ffmpeg.on('log', ({ message }) => console.debug('[ffmpeg]', message));
    const [coreURL, wasmURL, classWorkerURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      buildClassWorkerBlobURL(),
    ]);
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

function extOf(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
  if (m) return `.${m[1]}`;
  if (file.type.includes('webm')) return '.webm';
  if (file.type.includes('quicktime')) return '.mov';
  return '.mp4';
}

const PRESET_FILTERS = {
  none: '',
  bw: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0',
  vintage: 'curves=preset=vintage',
  cold: 'colorbalance=rs=-0.12:gs=-0.02:bs=0.18:rm=-0.08:bm=0.12:rh=-0.05:bh=0.1',
  warm: 'colorbalance=rs=0.18:gs=0.02:bs=-0.15:rm=0.12:bm=-0.1:rh=0.1:bh=-0.08',
};

function buildVideoFilterChain({ crop, brightness = 0, contrast = 100, saturate = 100, preset = 'none' }) {
  const parts = [];
  if (crop) {
    parts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }
  if (PRESET_FILTERS[preset]) parts.push(PRESET_FILTERS[preset]);
  if (brightness !== 0 || contrast !== 100) {
    parts.push(`eq=brightness=${(brightness / 100).toFixed(3)}:contrast=${(contrast / 100).toFixed(3)}`);
  }
  if (saturate !== 100) {
    parts.push(`hue=s=${(saturate / 100).toFixed(3)}`);
  }
  return parts;
}

async function cleanup(ffmpeg, names) {
  for (const n of names) {
    try { await ffmpeg.deleteFile(n); } catch { /* ignore */ }
  }
}

/**
 * Trim, crop, filter and annotate a single video.
 * crop: {x,y,w,h} in source pixel coordinates, or null.
 * annotations: [{ blob: PNG Blob at source resolution, start, end }], times relative to the
 *   trimmed clip (0 = trim start) — matches the -ss/-to input seek below, which rebases PTS to 0.
 */
export async function processVideo({ file, start, end, crop, brightness, contrast, saturate, preset, speed = 100, annotations = [], onProgress }) {
  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = `in_${Date.now()}${extOf(file)}`;
  const outputName = `out_${Date.now()}.mp4`;
  const tempFiles = [inputName, outputName];

  await ffmpeg.writeFile(inputName, await fetchFileFn(file));

  const speedFactor = speed / 100;
  const speedChanged = Math.abs(speedFactor - 1) > 0.001;

  // -ss/-to as INPUT options (before -i) do a fast seek and rebase PTS to 0 at the trim
  // point — required so annotation enable='between(t,...)' windows line up correctly.
  const args = [];
  if (start != null) args.push('-ss', start.toFixed(3));
  if (end != null) args.push('-to', end.toFixed(3));
  args.push('-i', inputName);

  if (annotations.length === 0) {
    const chain = buildVideoFilterChain({ crop, brightness, contrast, saturate, preset });
    if (speedChanged) chain.push(`setpts=PTS/${speedFactor.toFixed(3)}`);
    if (chain.length) args.push('-vf', chain.join(','));
    if (speedChanged) args.push('-af', `atempo=${clampAtempo(speedFactor)}`);
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outputName);
  } else {
    // A looped still image is an infinite stream by design. Without an explicit -t, once
    // the (finite) main video ends, overlay's default eof_action="repeat" just keeps
    // freezing its last frame and compositing forever — ffmpeg never stops on its own
    // (confirmed: it ran to 19 real minutes of output for a 1.3s clip). Capping each
    // annotation input at the exact trimmed clip length fixes that at the source.
    const clipDuration = Math.max(0.1, (end ?? 0) - (start ?? 0)).toFixed(3);
    const annotationNames = [];
    for (let i = 0; i < annotations.length; i++) {
      const name = `ann_${Date.now()}_${i}.png`;
      await ffmpeg.writeFile(name, await fetchFileFn(annotations[i].blob));
      annotationNames.push(name);
      args.push('-loop', '1', '-t', clipDuration, '-i', name);
    }
    tempFiles.push(...annotationNames);

    const parts = [];
    let label = '0:v';
    annotations.forEach((ann, i) => {
      const next = `ov${i}`;
      parts.push(`[${label}][${i + 1}:v]overlay=0:0:enable='between(t,${ann.start.toFixed(3)},${ann.end.toFixed(3)})'[${next}]`);
      label = next;
    });
    const colorChain = buildVideoFilterChain({ crop, brightness, contrast, saturate, preset });
    if (speedChanged) colorChain.push(`setpts=PTS/${speedFactor.toFixed(3)}`);
    if (colorChain.length) {
      parts.push(`[${label}]${colorChain.join(',')}[vout]`);
      label = 'vout';
    }
    args.push('-filter_complex', parts.join(';'), '-map', `[${label}]`, '-map', '0:a?');
    if (speedChanged) args.push('-af', `atempo=${clampAtempo(speedFactor)}`);
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', outputName);
  }

  await execOrReset(ffmpeg, args);
  const data = await ffmpeg.readFile(outputName);
  await cleanup(ffmpeg, tempFiles);
  return new Blob([data.buffer], { type: 'video/mp4' });
}

function clampAtempo(f) {
  return Math.min(2, Math.max(0.5, f)).toFixed(3);
}

/**
 * Concatenate multiple videos into one, normalizing to a common resolution.
 */
export async function mergeVideos({ files, width, height, grayscale, onProgress }) {
  const audioFlags = await Promise.all(files.map(hasAudioTrack));
  const allHaveAudio = audioFlags.every(Boolean);

  const ffmpeg = await getFFmpeg(onProgress);
  const names = [];
  for (let i = 0; i < files.length; i++) {
    const name = `m${i}_${Date.now()}${extOf(files[i])}`;
    await ffmpeg.writeFile(name, await fetchFileFn(files[i]));
    names.push(name);
  }

  const inputArgs = [];
  names.forEach((n) => inputArgs.push('-i', n));
  const outputName = `merged_${Date.now()}.mp4`;

  const withAudioFilter = () => {
    const parts = [];
    let concatInputs = '';
    names.forEach((_, i) => {
      let vf = `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      if (grayscale) vf += ',hue=s=0';
      vf += `[v${i}]`;
      parts.push(vf);
      parts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs += `[v${i}][a${i}]`;
    });
    parts.push(`${concatInputs}concat=n=${names.length}:v=1:a=1[outv][outa]`);
    return parts.join(';');
  };

  const videoOnlyFilter = () => {
    const parts = [];
    let concatInputs = '';
    names.forEach((_, i) => {
      let vf = `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      if (grayscale) vf += ',hue=s=0';
      vf += `[v${i}]`;
      parts.push(vf);
      concatInputs += `[v${i}]`;
    });
    parts.push(`${concatInputs}concat=n=${names.length}:v=1:a=0[outv]`);
    return parts.join(';');
  };

  if (allHaveAudio) {
    await execOrReset(ffmpeg, [
      ...inputArgs,
      '-filter_complex', withAudioFilter(),
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', outputName,
    ]);
  } else {
    await execOrReset(ffmpeg, [
      ...inputArgs,
      '-filter_complex', videoOnlyFilter(),
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outputName,
    ]);
  }

  const data = await ffmpeg.readFile(outputName);
  await cleanup(ffmpeg, [...names, outputName]);
  return new Blob([data.buffer], { type: 'video/mp4' });
}
