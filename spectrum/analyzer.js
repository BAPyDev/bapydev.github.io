(() => {
"use strict";
const frequencies = Array.from({ length: 61 }, (_, i) => 20 * 1000 ** (i / 60));

function sweep(rate, seconds, low, high, level) {
  const samples = new Float32Array(Math.round(rate * seconds));
  const ratio = Math.log(high / low);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const phase = 2 * Math.PI * low * seconds / ratio * Math.expm1(t * ratio / seconds);
    const fade = Math.min(1, t / .02, (seconds - t) / .02);
    samples[i] = level * fade * Math.sin(phase);
  }
  return samples;
}

function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      const r = real[i], im = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = r;
      imag[j] = im;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wr = 1;
      let wi = 0;
      for (let k = start; k < start + half; k++) {
        const r = wr * real[k + half] - wi * imag[k + half];
        const im = wr * imag[k + half] + wi * real[k + half];
        real[k + half] = real[k] - r;
        imag[k + half] = imag[k] - im;
        real[k] += r;
        imag[k] += im;
        const next = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR;
        wr = next;
      }
    }
  }
}

function findMarker(recording, marker, rate, earliest = 0) {
  recording = recording.subarray(earliest, earliest + Math.round(rate * 1.8));
  const length = recording.length;
  if (length < marker.length) return -1;
  const n = 2 ** Math.ceil(Math.log2(length + marker.length));
  const r = new Float64Array(n), ri = new Float64Array(n);
  const m = new Float64Array(n), mi = new Float64Array(n);
  r.set(recording.subarray(0, length));
  m.set(marker);
  fft(r, ri);
  fft(m, mi);
  for (let i = 0; i < n; i++) {
    const product = r[i] * m[i] + ri[i] * mi[i];
    ri[i] = ri[i] * m[i] - r[i] * mi[i];
    r[i] = product;
  }
  fft(r, ri, true);
  let energy = 0;
  let referenceEnergy = 0;
  for (let i = 0; i < marker.length; i++) {
    energy += recording[i] ** 2;
    referenceEnergy += marker[i] ** 2;
  }
  let best = 0, index = -1;
  for (let i = 0; i <= length - marker.length; i++) {
    const value = Math.abs(r[i]) / n / Math.sqrt(Math.max(energy, 1e-12) * referenceEnergy);
    if (value > best) { best = value; index = i; }
    if (i < length - marker.length) energy += recording[i + marker.length] ** 2 - recording[i] ** 2;
  }
  return best >= .12 ? index + earliest : -1;
}

function accumulate(real, imag, power) {
  fft(real, imag);
  for (let i = 0; i < power.length; i++) power[i] += real[i] ** 2 + imag[i] ** 2;
}

function bands(power, rate) {
  const binWidth = rate / (power.length * 2);
  const halfBand = 2 ** (1 / 12);
  return frequencies.map(hz => {
    if (hz * halfBand >= rate / 2) return null;
    const low = Math.max(1, Math.round(hz / halfBand / binWidth));
    const high = Math.max(low, Math.round(hz * halfBand / binWidth));
    let sum = 0;
    for (let i = low; i <= high; i++) sum += power[i];
    return sum / (high - low + 1);
  });
}

function spectrum(samples, n, rate) {
  const real = new Float64Array(n);
  real.set(samples.subarray(0, n));
  const power = new Float64Array(n / 2);
  accumulate(real, new Float64Array(n), power);
  return bands(power, rate);
}

function welch(channels, rate) {
  const n = 8192;
  const real = new Float64Array(n), imag = new Float64Array(n);
  const power = new Float64Array(n / 2);
  const window = Float64Array.from({ length: n }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / n));
  let frames = 0;
  for (const samples of channels) {
    for (let offset = 0; offset + n <= samples.length; offset += n / 2) {
      for (let i = 0; i < n; i++) real[i] = samples[offset + i] * window[i];
      imag.fill(0);
      accumulate(real, imag, power);
      frames++;
    }
  }
  return bands(power, rate).map(value => value === null ? null : value / frames);
}

function relativeResponse(reference, captured, usable, minimumMidBands, anchor = [300, 2500]) {
  const response = frequencies.map((hz, i) => ({
    hz,
    db: usable(i) ? 10 * Math.log10(captured[i] / reference[i]) : null
  }));
  const mid = response.filter(p => p.hz >= anchor[0] && p.hz <= anchor[1] && p.db !== null)
    .map(p => p.db).sort((a, b) => a - b);
  if (mid.length < minimumMidBands) throw new Error('Too little signal in the reference range. Check playback and repeat the measurement.');
  const median = mid[Math.floor(mid.length / 2)];
  return response.map(p => ({ hz: p.hz, db: p.db === null ? null : p.db - median }));
}

function sweepResponse(signal, recording, quiet, rate) {
  const n = 2 ** Math.ceil(Math.log2(recording.length));
  const reference = spectrum(signal, n, rate);
  const captured = spectrum(recording, n, rate);
  const noise = spectrum(quiet, n, rate).map(value => value * recording.length / quiet.length);
  return filteredResponse(reference, captured, noise, 0, 5);
}

function trackResponse(channels, recording, quiet, rate, anchor) {
  const reference = welch(channels, rate);
  const captured = welch([recording], rate);
  const noise = welch([quiet], rate);
  return filteredResponse(reference, captured, noise, Math.max(...reference) * .0001, 2, anchor);
}

function subtractNoise(captured, noise, minimumRatio) {
  if (captured === null || captured <= Math.max(1e-14, noise * minimumRatio)) return null;
  return captured - noise;
}

function filteredResponse(reference, captured, noise, referenceFloor, minimumMidBands, anchor) {
  const clean = captured.map((value, i) => subtractNoise(value, noise[i], 10));
  return relativeResponse(reference, clean, i => reference[i] > referenceFloor && clean[i] !== null, minimumMidBands, anchor);
}

function eqSettings(response, centers) {
  return centers.map((hz, index) => {
    const left = index ? Math.sqrt(hz * centers[index - 1]) : hz / Math.sqrt(2);
    const right = index < centers.length - 1 ? Math.sqrt(hz * centers[index + 1]) : hz * Math.sqrt(2);
    const points = response.filter(p => p.hz >= left && p.hz <= right);
    const levels = points.filter(p => p.db !== null).map(p => p.db).sort((a, b) => a - b);
    if (levels.length < Math.max(2, Math.ceil(points.length * .65))) return { hz, gain: null };
    const median = levels[Math.floor(levels.length / 2)];
    const broadDip = levels.filter(db => db <= -2).length / levels.length >= .75;
    const gain = Math.round(Math.max(-6, Math.min(broadDip ? 2 : 0, -median)));
    return { hz, gain: Math.abs(median) < 1.5 ? 0 : gain };
  });
}


const $ = id => document.getElementById(id);
const status = $('status');
const accent = '#78adff';
const beforeColor = '#ff818b';
const noiseColor = '#f39d72';
const referenceColor = '#a6acff';
const rawColor = '#93a4ae';
const noiseEnd = 2.1;
const noiseStart = .24;
const filterEnd = 2.85;
let current, before, track, active;

function updateButtons() {
  $('measure').disabled = Boolean(active);
  $('compare').disabled = Boolean(active) || !$('track').files.length;
  $('track').disabled = $('offset').disabled = Boolean(active);
  $('offset-up').disabled = $('offset-down').disabled = Boolean(active);
  $('stop').hidden = !active;
  $('instrument').disabled = $('instrument-play').disabled = $('instrument-measure').disabled = Boolean(active);
}

async function capture(file, offset, signal, instrument) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    throw new Error('Open the analyzer over HTTPS or localhost in a browser with microphone access.');
  }
  const comparing = Boolean(file || instrument);
  const context = new AudioContext({ latencyHint: 'interactive' });
  let stream, input, worklet, source, stopVisual;
  try {
    await context.resume();
    signal.throwIfAborted();
    status.textContent = 'Waiting for microphone access…';
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    });
    signal.throwIfAborted();
    const settings = stream.getAudioTracks()[0].getSettings();
    if ([settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl].includes(true)) {
      throw new Error('Microphone processing is still enabled. Try another browser or microphone.');
    }
    const processingVerified = [settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl]
      .every(setting => setting === false);
    const rate = context.sampleRate;
    if (rate < 32000 || (settings.sampleRate && settings.sampleRate < 32000)) {
      throw new Error('The microphone sample rate is too low. Check whether Bluetooth switched to headset mode.');
    }
    const marker = sweep(rate, .14, 650, 3900, .19);
    const testSweep = comparing ? null : sweep(rate, 4, 20, Math.min(20000, rate * .47), .22);
    let originals = [testSweep];
    if (comparing) {
      status.textContent = instrument ? 'Preparing reference…' : 'Opening track…';
      const decoded = instrument ? referenceBuffer(context, instrument) : await context.decodeAudioData(await file.arrayBuffer());
      const start = Math.round(offset * rate);
      const end = Math.min(decoded.length, start + 12 * rate);
      if (end - start < rate) throw new Error('Choose a start time with at least one second of audio remaining.');
      originals = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => {
        const samples = decoded.getChannelData(i).slice(start, end);
        const fade = Math.round(rate * .025);
        for (let j = 0; j < fade; j++) {
          samples[j] *= j / fade;
          samples[samples.length - 1 - j] *= j / fade;
        }
        return samples;
      });
    }
    const markerAt = Math.round(rate * filterEnd);
    const contentAt = markerAt + Math.round(rate * .5);
    const contentLength = originals[0].length;
    const playback = context.createBuffer(originals.length, contentAt + contentLength + Math.round(rate * 1.55), rate);
    originals.forEach((samples, i) => {
      playback.getChannelData(i).set(marker, markerAt);
      playback.getChannelData(i).set(samples, contentAt);
    });
    await loadCaptureProcessor(context);
    signal.throwIfAborted();
    input = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'capture-pcm');
    const muted = context.createGain();
    muted.gain.value = 0;
    input.connect(worklet).connect(muted).connect(context.destination);
    source = context.createBufferSource();
    source.buffer = playback;
    const output = context.createGain();
    output.gain.value = comparing ? .4 : 1;
    source.connect(output).connect(context.destination);
    const micSpectrum = makeAnalyser(context, input);
    const sourceSpectrum = makeAnalyser(context, output, originals.length);
    const recorded = new Float32Array(playback.length + rate);
    let cursor = 0, previewMarker = -1;
    const earliest = Math.round(rate * (filterEnd - .18));
    const quiet = recorded.subarray(Math.round(rate * (noiseStart + .07)), Math.round(rate * noiseEnd));
    const previewTrack = () => {
      if (previewMarker < 0) previewMarker = findMarker(recorded.subarray(0, cursor), marker, rate, earliest);
      if (previewMarker < 0) return null;
      const start = previewMarker + contentAt - markerAt;
      const length = Math.min(contentLength, cursor - start);
      if (length < rate * .6) return null;
      try {
        return trackResponse(originals.map(samples => samples.subarray(0, length)),
          recorded.subarray(start, start + length), quiet, rate, instrument?.range);
      } catch {
        return null;
      }
    };
    const begins = context.currentTime + .07;
    stopVisual = showCapture({
      context, begins, micSpectrum, sourceSpectrum, file: comparing, instrument,
      contentStart: contentAt / rate, duration: contentLength / rate, previewTrack
    });
    await new Promise((resolve, reject) => {
      const cancel = () => finish(signal.reason);
      const timer = setTimeout(() => finish(new Error('Recording was interrupted. Keep this tab open and try again.')), (playback.duration + 4) * 1000);
      function finish(error) {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve();
      }
      signal.addEventListener('abort', cancel, { once: true });
      worklet.port.onmessage = ({ data: message }) => {
        const samples = message.samples.subarray(0, recorded.length - cursor);
        recorded.set(samples, cursor);
        cursor += samples.length;
        if (message.done) finish();
      };
      source.onended = () => worklet.port.postMessage('flush');
      source.start(begins);
    });
    const markerIndex = findMarker(recorded.subarray(0, cursor), marker, rate, earliest);
    if (markerIndex < 0) throw new Error('Sync signal not detected. Check that the head unit plays the test signal during recording.');
    const start = markerIndex + contentAt - markerAt;
    const end = start + contentLength + (comparing ? 0 : Math.round(rate * .23));
    if (end > cursor) throw new Error('Recording ended before the test signal. Run the measurement again.');
    const sample = recorded.subarray(start, end);
    let clipped = 0;
    for (const value of sample) if (Math.abs(value) >= .995) clipped++;
    if (clipped > 6) throw new Error('The microphone clipped. Lower the volume and repeat the measurement.');
    const response = comparing ? trackResponse(originals, sample, quiet, rate, instrument?.range)
      : sweepResponse(testSweep, sample, quiet, rate);
    return { response, processingVerified };
  } finally {
    stopVisual?.();
    if (source) { source.onended = null; source.disconnect(); }
    worklet?.port.close();
    input?.disconnect();
    stream?.getTracks().forEach(mic => mic.stop());
    await context.close();
  }
}

function draw(canvas, series, spectrum = false, focusRange) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const left = 38, top = 12, right = width - 14, bottom = height - 30;
  const x = hz => left + Math.log10(hz / 20) / 3 * (right - left);
  const extent = Math.max(12, ...series.flatMap(line => line.points.map(point => Math.abs(point.db ?? 0))));
  const step = spectrum ? 15 : 3 * Math.ceil(extent / 12);
  const max = spectrum ? -15 : step * 4;
  const min = spectrum ? -105 : -max;
  const y = db => top + (max - Math.max(min, Math.min(max, db))) / (max - min) * (bottom - top);
  if (focusRange) {
    ctx.fillStyle = 'rgba(120, 173, 255, .13)';
    ctx.fillRect(x(focusRange[0]), top, x(focusRange[1]) - x(focusRange[0]), bottom - top);
  }
  ctx.font = '11px monospace';
  ctx.fillStyle = '#aec2bf';
  ctx.textBaseline = 'middle';
  for (let db = min; db <= max; db += step) {
    ctx.strokeStyle = db === 0 ? '#718382' : '#303b49';
    ctx.beginPath(); ctx.moveTo(left, y(db)); ctx.lineTo(right, y(db)); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(db), left - 5, y(db));
  }
  for (const hz of [20, 100, 1000, 10000, 20000]) {
    ctx.strokeStyle = '#303b49';
    ctx.beginPath(); ctx.moveTo(x(hz), top); ctx.lineTo(x(hz), bottom); ctx.stroke();
    ctx.textAlign = hz === 20000 ? 'right' : 'center';
    ctx.fillText(hz < 1000 ? String(hz) : `${hz / 1000}k`, x(hz), bottom + 13);
  }
  for (const line of series) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let connected = false;
    for (const point of line.points) {
      if (point.db === null) { connected = false; continue; }
      if (connected) ctx.lineTo(x(point.hz), y(point.db));
      else ctx.moveTo(x(point.hz), y(point.db));
      connected = true;
    }
    ctx.stroke();
  }
}

function makeAnalyser(context, input, channels = 1) {
  const splitter = context.createChannelSplitter(channels);
  input.connect(splitter);
  const analysers = Array.from({ length: channels }, (_, channel) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel);
    return analyser;
  });
  const frame = new Float32Array(analysers[0].frequencyBinCount);
  const power = new Float64Array(frame.length);
  return () => {
    power.fill(0);
    for (const analyser of analysers) {
      analyser.getFloatFrequencyData(frame);
      for (let i = 0; i < frame.length; i++) power[i] += 10 ** (frame[i] / 10) / channels;
    }
    return bands(power, context.sampleRate);
  };
}

function showCapture({ context, begins, micSpectrum, sourceSpectrum, file, instrument, contentStart, duration, previewTrack }) {
  const panel = $('live');
  const legend = $('live-legend');
  const delta = $('live-delta');
  const deltaLabel = $('live-delta-label');
  const progress = $('live-progress');
  const noise = frequencies.map(() => 0);
  const trace = (values, color) => ({
    color, points: frequencies.map((hz, i) => ({
      hz, db: values[i] === null ? null : Math.max(-105, 10 * Math.log10(values[i]))
    }))
  });
  let count = 0, phase, frame, lastFrame = -1, lastPreview = 0;
  delta.hidden = deltaLabel.hidden = true;
  $('live-title').textContent = instrument ? instrument.name + ' · cabin measurement' : file ? 'Track capture' : 'Sweep measurement';
  progress.value = 0;
  panel.hidden = false;
  panel.scrollIntoView({ block: 'start' });

  function setPhase(next, text, entries) {
    if (phase === next) return;
    phase = next;
    $('live-phase').textContent = text;
    legend.replaceChildren(...entries.map(([label, color]) => {
      const item = document.createElement('span');
      item.style.setProperty('--trace', color);
      item.textContent = label;
      return item;
    }));
  }

  function update() {
    frame = requestAnimationFrame(update);
    const elapsed = context.currentTime - begins;
    if (elapsed - lastFrame < .065) return;
    lastFrame = elapsed;
    const raw = micSpectrum();
    const filtered = raw.map((value, i) => value === null ? null : subtractNoise(value, noise[i], 10) ?? 0);
    progress.value = Math.min(1, Math.max(0, elapsed / (contentStart + duration)));
    if (elapsed < noiseEnd) {
      setPhase('noise', 'Measuring the cabin noise floor. Keep the cabin quiet.', [['Microphone', rawColor], ['Noise floor', noiseColor]]);
      if (elapsed >= noiseStart) {
        count++;
        raw.forEach((value, i) => { noise[i] += ((value ?? 0) - noise[i]) / count; });
      }
      draw($('live-chart'), [trace(raw, rawColor), trace(noise, noiseColor)], true);
    } else if (elapsed < filterEnd) {
      setPhase('filter', 'Noise floor captured. Attenuating noise-dominated bands.', [['Noise floor', noiseColor], ['Filtered', accent]]);
      draw($('live-chart'), [trace(noise, noiseColor), trace(filtered, accent)], true);
    } else if (elapsed < contentStart) {
      setPhase('sync', 'Playing the synchronization signal.', [['Reference', referenceColor], ['Microphone', rawColor], ['Filtered', accent]]);
      draw($('live-chart'), [trace(sourceSpectrum(), referenceColor), trace(raw, rawColor), trace(filtered, accent)], true);
    } else if (elapsed <= contentStart + duration + .45) {
      setPhase('playing', file ? 'Comparing playback with the microphone signal.' : 'Sweeping from low to high frequencies.',
        [['Reference', referenceColor], ['Microphone', rawColor], ['Filtered', accent]]);
      draw($('live-chart'), [trace(sourceSpectrum(), referenceColor), trace(raw, rawColor), trace(filtered, accent)], true);
      if (file && elapsed - contentStart >= .8 && elapsed - lastPreview > 1.05) {
        lastPreview = elapsed;
        const estimate = previewTrack();
        if (estimate) {
          delta.hidden = deltaLabel.hidden = false;
          draw(delta, [{ points: estimate, color: accent }]);
        }
      }
    } else {
      setPhase('finishing', 'Finishing capture and calculating deviations.',
        [['Reference', referenceColor], ['Microphone', rawColor], ['Filtered', accent]]);
    }
  }
  status.textContent = '';
  frame = requestAnimationFrame(update);
  return () => { cancelAnimationFrame(frame); panel.hidden = true; };
}

const signed = db => `${db > 0 ? '+' : ''}${db} dB`;

function renderEQ() {
  if (current) renderBandGains(current.response, $("gains"), $("eq-note"));
  if (instrumentResponse) renderBandGains(instrumentResponse, $("instrument-gains"), $("instrument-note"));
}

function renderBandGains(response, list, note) {
  const raw = $('bands').value.trim();
  const centers = [...new Set(raw.split(/[\s,;]+/).map(Number))].sort((a, b) => a - b);
  list.replaceChildren();
  if (!raw || centers.length > 32 || centers.some(hz => !Number.isInteger(hz) || hz < 20 || hz > 20000)) {
    note.textContent = 'Enter up to 32 whole-number frequencies from 20 to 20,000 Hz, separated by commas or spaces.';
    return;
  }
  note.textContent = 'Adjustments target a flat relative response and are rounded to the nearest decibel.';
  for (const { hz, gain } of eqSettings(response, centers)) {
    const item = document.createElement('li');
    const value = document.createElement('strong');
    item.textContent = `${hz} Hz`;
    value.textContent = gain === null ? 'Low signal' : signed(gain);
    item.append(value);
    list.append(item);
  }
}

function renderCharts() {
  if (current) draw($('chart'), [
    ...(before ? [{ points: before.response, color: beforeColor }] : []),
    { points: current.response, color: accent }
  ]);
  if (track) draw($('track-chart'), [{ points: track.response, color: accent }]);
}

function renderMeasure() {
  $('result').hidden = false;
  $('legend').textContent = before ? 'Blue: current · Red: baseline · dB / Hz' : 'Current measurement · dB / Hz';
  $('quality').textContent = [
    current.response.some(p => p.db === null) ? 'Gaps indicate low signal or frequencies outside the recorded range.' : '',
    !current.processingVerified ? 'The browser could not verify that all microphone processing was disabled.' : '',
    'The response includes the effect of the phone microphone.'
  ].filter(Boolean).join(' ');
  renderCharts();
  renderEQ();
}

async function run(file, instrument = null) {
  if (active) return;
  stopPreview();
  const offset = instrument ? 0 : $('offset').valueAsNumber;
  if (file && (!Number.isFinite(offset) || offset < 0)) {
    status.textContent = 'Enter a valid start time in seconds.';
    return;
  }
  active = new AbortController();
  updateButtons();
  status.textContent = 'Preparing capture…';
  try {
    const result = await capture(file, offset, active.signal, instrument);
    if (instrument) {
      instrumentResponse = result.response;
      $('instrument-result').hidden = false;
      renderEQ();
    } else if (file) {
      track = result;
      $('track-result').hidden = false;
      const valid = result.response.filter(p => p.db !== null);
      const high = valid.reduce((a, b) => a.db > b.db ? a : b);
      const low = valid.reduce((a, b) => a.db < b.db ? a : b);
      $('track-summary').textContent = `Peak: ${Math.round(high.hz)} Hz · ${signed(Math.round(high.db))}. Dip: ${Math.round(low.hz)} Hz · ${signed(Math.round(low.db))}.`
        + ' Gaps indicate insufficient signal.'
        + (result.processingVerified ? '' : ' The browser could not verify that all microphone processing was disabled.');
      renderCharts();
    } else {
      current = result;
      renderMeasure();
    }
    status.textContent = '';
    $(instrument ? 'instrument-result' : file ? 'track-result' : 'result').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) {
    status.textContent = active.signal.aborted ? 'Recording stopped.'
      : error.name === 'NotAllowedError' ? 'Allow microphone access in the site settings.'
      : error.name === 'EncodingError' ? 'This audio file could not be decoded. Try MP3 or WAV.'
      : error.message;
  } finally {
    active = null;
    updateButtons();
  }
}

$('measure').onclick = () => run(null);
$('baseline').onclick = () => {
  before = current;
  renderMeasure();
  status.textContent = 'Baseline saved in this tab. Adjust the head unit and run another sweep.';
};
$('track').onchange = () => {
  track = null;
  $('track-name').textContent = $('track').files[0]?.name || 'Choose audio file';
  $('track-result').hidden = true;
  updateButtons();
};
$('offset-down').onclick = () => $('offset').stepDown();
$('offset-up').onclick = () => $('offset').stepUp();
$('compare').onclick = () => run($('track').files[0]);
$('stop').onclick = () => active?.abort();
$('bands').oninput = renderEQ;
window.addEventListener('resize', renderCharts);

const instruments = [
  { name: 'Kick · punch', type: 'kick', range: [55, 145], feature: 'Body and punch', pitch: 62, beat: .52, decay: 9 },
  { name: 'Snare drum', type: 'drum', range: [150, 280], feature: 'Drum body', pitch: 195, beat: .55, decay: 12 },
  { name: 'Floor tom', type: 'drum', range: [75, 160], feature: 'Shell resonance', pitch: 105, beat: .65, decay: 6 },
  { name: 'Bass guitar', type: 'string', range: [45, 155], feature: 'Fundamental notes', pitch: 73.4, beat: .62, decay: 3.8 },
  { name: 'Low voice', type: 'voice', range: [95, 155], feature: 'Fundamental pitch', pitch: 112, beat: .86, decay: 1.2 },
  { name: 'High voice', type: 'voice', range: [210, 330], feature: 'Fundamental pitch', pitch: 247, beat: .86, decay: 1.2 },
  { name: 'Picked guitar', type: 'string', range: [700, 3200], feature: 'Pick and upper harmonics', pitch: 220, beat: .48, decay: 5 },
  { name: 'Closed hi-hat', type: 'hat', range: [5500, 15000], feature: 'Metallic sizzle', pitch: 6200, beat: .30, decay: 25 }
];
let preview, referenceTrace, instrumentResponse;
const picker = $('instrument');
picker.replaceChildren(...instruments.map((item, i) => new Option(item.name, i)));

function referenceSamples(item, rate) {
  const samples = new Float32Array(Math.round(rate * item.beat * 8));
  const table = new Float32Array(2048);
  // Harmonic weights shape the string body or the two vowel formants.
  for (let h = 1; h <= 36 && h * item.pitch * 1.27 < rate * .46; h++) {
    const hz = h * item.pitch;
    const formant = (center, width) => Math.exp(-.5 * ((hz - center) / width) ** 2);
    const weight = item.type === 'voice'
      ? (.15 + 1.7 * formant(680, 150) + 1.2 * formant(1320, 230) + .55 * formant(2600, 340)) / h
      : Math.sin(h * .37) / h ** 1.3;
    for (let j = 0; j < table.length; j++) table[j] += weight * Math.sin(2 * Math.PI * h * j / table.length);
  }
  let phase = 0, seed = 17, lowNoise = 0, previousNoise = 0, peak = .001;
  const lowpass = 1 - Math.exp(-2 * Math.PI * 2800 / rate);
  const notes = [1, 1.12246, 1, 1.25992];
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate, beat = Math.floor(time / item.beat), t = time - beat * item.beat;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    lowNoise += lowpass * (noise - lowNoise);
    const body = Math.sin(2 * Math.PI * (item.pitch * t + 1.75 * (1 - Math.exp(-36 * t))));
    let value;
    if (item.type === 'kick') value = body + .22 * lowNoise * Math.exp(-85 * t);
    else if (item.type === 'drum') value = body + (item.pitch > 150 ? 1.4 : .25) * lowNoise + .28 * Math.sin(2 * Math.PI * item.pitch * 1.59 * t);
    else if (item.type === 'hat') value = (noise - previousNoise) * .8 + .15 * Math.sin(2 * Math.PI * item.pitch * t);
    else {
      phase = (phase + item.pitch * notes[beat % 4] * (1 + .006 * Math.sin(33 * t)) / rate) % 1;
      value = table[Math.floor(phase * table.length)] + (item.type === 'string' ? .18 * lowNoise * Math.exp(-40 * t) : 0);
    }
    previousNoise = noise;
    const attack = Math.min(1, t / (item.type === 'voice' ? .075 : .004));
    samples[i] = value * attack * Math.exp(-item.decay * t) * Math.min(1, (item.beat - t) * 50);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return samples.map(v => v * .42 / peak);
}

function referenceBuffer(context, item) {
  const samples = referenceSamples(item, context.sampleRate);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

function referencePoints(power, scale = 1) {
  return frequencies.map((hz, i) => ({ hz, db: power[i] === null ? null : 10 * Math.log10(Math.max(1e-12, power[i] * scale)) }));
}

function drawReference(points = referenceTrace) {
  if (!analyzer.hidden && points) draw($('instrument-chart'), [{ points, color: accent }], true, instruments[picker.value].range);
}

function refreshReference() {
  const item = instruments[picker.value];
  $('instrument-range').textContent = item.feature + ' · ' + item.range.join('–') + ' Hz';
  $('instrument-caption').textContent = 'Reference spectrum · dBFS / Hz';
  const samples = referenceSamples(item, 44100);
  referenceTrace = referencePoints(welch([samples.subarray(0, Math.round(44100 * item.beat * 2))], 44100), 4 / 4096 ** 2);
  drawReference();
}

function stopPreview() {
  if (!preview) return;
  const { context, source, frame } = preview;
  preview = null;
  cancelAnimationFrame(frame);
  source.stop();
  context.close();
  $('instrument-play').textContent = 'Play reference';
  $('instrument-play').setAttribute('aria-pressed', 'false');
  $('instrument-caption').textContent = 'Reference spectrum · dBFS / Hz';
  drawReference();
}

$('instrument-play').onclick = async () => {
  if (preview) return stopPreview();
  if (active) return;
  const context = new AudioContext();
  const source = context.createBufferSource();
  const session = { context, source, frame: 0 };
  source.buffer = referenceBuffer(context, instruments[picker.value]);
  source.loop = true;
  const output = context.createGain();
  output.gain.value = .4;
  source.connect(output).connect(context.destination);
  const read = makeAnalyser(context, output);
  source.start();
  preview = session;
  $('instrument-play').textContent = 'Stop reference';
  $('instrument-play').setAttribute('aria-pressed', 'true');
  try { await context.resume(); } catch (error) {
    if (preview === session) { stopPreview(); status.textContent = error.message; }
    return;
  }
  if (preview !== session) return;
  $('instrument-caption').textContent = 'Live reference · dBFS / Hz';
  let last = -100;
  function frame(now) {
    if (preview !== session) return;
    if (now - last >= 65) { drawReference(referencePoints(read())); last = now; }
    session.frame = requestAnimationFrame(frame);
  }
  frame(performance.now());
};

picker.onchange = () => {
  stopPreview();
  instrumentResponse = null;
  $('instrument-result').hidden = true;
  refreshReference();
};
$('instrument-measure').onclick = () => {
  const item = instruments[picker.value];
  run(null, item);
};
window.addEventListener('pagehide', stopPreview);
window.addEventListener('resize', () => { if (!preview) drawReference(); });

const analyzer = $('spectrum');
const erp = $('workspace');
const projectLinks = document.querySelectorAll(".project-links a");

function selectProject() {
  const audio = location.hash === '#spectrum' || location.hash === '#spectrum-profile';
  const changed = analyzer.hidden === audio;
  analyzer.hidden = !audio;
  erp.hidden = audio;
  document.querySelector('.top > a').href = audio ? '#spectrum-profile' : '#profile';
  for (const link of projectLinks) {
    if ((link.hash === '#spectrum') === audio) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (!audio) { stopPreview(); active?.abort(); }
  if (changed) {
    positionShiftOverview();
    document.title = audio ? 'Spectrum analyzer — Artem Borisenko' : 'Artem Borisenko — Manufacturing ERP';
    if (audio) { renderCharts(); if (referenceTrace) drawReference(); else refreshReference(); }
    window.scrollTo(0, 0);
  }
  if (location.hash === '#spectrum-profile') $('profile').scrollIntoView();
}
window.addEventListener('hashchange', selectProject);
selectProject();
})();
