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
let microphoneTrace, preliminaryResponse;
let mode = 'sweep', monitor, monitorTicket = 0, micPending = false;
function micUI() {
  const on = Boolean(monitor || active);
  $('monitor').setAttribute('aria-pressed', String(on));
  $('monitor').disabled = Boolean(active);
  $('mic-state').textContent = active ? 'Measurement' : micPending ? 'Connecting…' : on ? 'Live' : 'Off';
  $('noise-cut').disabled = !monitor || Boolean(active);
}
function stopMonitor() {
  microphoneTrace = null;
  monitorTicket++;
  micPending = false;
  if (monitor) {
    cancelAnimationFrame(monitor.frame);
    monitor.stream.getTracks().forEach(t => t.stop());
    monitor.context.close();
    monitor = null;
  }
  $('noise-state').textContent = '';
  $('noise-cut').textContent = 'Filter noise';
  micUI();
  draw($('live-chart'), [], true);
}
async function startMonitor() {
  if (active || monitor) return;
  const ticket = ++monitorTicket;
  micPending = true; micUI();
  let stream, context;
  try {
    context = new AudioContext();
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if (ticket !== monitorTicket) { stream.getTracks().forEach(t=>t.stop()); await context.close(); return; }
    const read = makeAnalyser(context,context.createMediaStreamSource(stream));
    const m = {context,stream,frame:0, floor:null, samples:0, until:0};
    monitor = m; micPending = false; micUI();
    status.textContent = '';
    let last = -100;
    function tick(now) {
      if (monitor !== m) return;
      m.frame = requestAnimationFrame(tick);
      if (now-last < 90) return;
      last = now;
      let power = read();
      if (m.until) {
        m.samples++;
        power.forEach((v,i)=>{m.floor[i] += ((v || 0)-m.floor[i])/m.samples});
        if (now >= m.until) {m.until=0; $('noise-state').textContent='Noise floor applied'; $('noise-cut').textContent='Reset filter';}
      } else if (m.floor) power = power.map((v,i)=>v===null ? null : Math.max(0,v-m.floor[i]));
      microphoneTrace=referencePoints(power);
      draw($('live-chart'),[{color:accent,points:microphoneTrace}],true);
      if(mode==='instrument' && !preview)drawReference();
    }
    tick(performance.now());
  } catch(error) {
    stream?.getTracks().forEach(t=>t.stop());
    if(context && context.state !== 'closed') await context.close();
    if(ticket===monitorTicket){stopMonitor();status.textContent=error.name==='NotAllowedError'?'Allow microphone access in the site settings.':error.message;}
  }
}
$('monitor').onclick = () => monitor || micPending ? stopMonitor() : startMonitor();
$('noise-cut').onclick = () => {
  if (!monitor || monitor.until) return;
  if(monitor.floor){monitor.floor=null;$('noise-state').textContent='';$('noise-cut').textContent='Filter noise';return;}
  monitor.floor=frequencies.map(()=>0);monitor.samples=0;monitor.until=performance.now()+1600;
  $('noise-state').textContent='Measuring noise floor · keep quiet';
};
window.addEventListener('pagehide',stopMonitor);


function updateButtons() {
  $('measure').disabled = Boolean(active);
  $('compare').disabled = Boolean(active) || !$('track').files.length;
  $('track').disabled = Boolean(active);
  $('offset').disabled = Boolean(active) || !$('track').files.length || Number($('offset').max) <= 0;

  $('stop').hidden = !active;
  document.querySelectorAll('[data-tab]').forEach(tab=>tab.disabled=Boolean(active));
  for (const option of picker.children) option.disabled = Boolean(active);
  $('instrument-play').disabled = $('instrument-measure').disabled = Boolean(active);
}

// Seek over RIFF chunks using their headers; the PCM payload stays on disk until capture.
const wavInfo = new WeakMap();
async function readWavInfo(file) {
  if (!/\.wav$/i.test(file.name)) return null;
  const id = bytes => String.fromCharCode(...bytes);
  const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
  if(id(head.slice(0,4))!=='RIFF'||id(head.slice(8,12))!=='WAVE')return null;
  let format;
  for(let pos=12, chunks=0;pos+8<=file.size && chunks++<256;){
    const bytes=new Uint8Array(await file.slice(pos,pos+8).arrayBuffer());
    const size=new DataView(bytes.buffer).getUint32(4,true), key=id(bytes.slice(0,4));
    pos+=8;
    if(size>file.size-pos)return null;
    if(key==='fmt ' && size>=16 && size<=128){
      format=new Uint8Array(await file.slice(pos,pos+size).arrayBuffer());
    } else if(key==='data' && format){
      const v=new DataView(format.buffer), codec=v.getUint16(0,true), rate=v.getUint32(4,true), block=v.getUint16(12,true);
      if(![1,3,65534].includes(codec)||!rate||!block)return null;
      return {format,rate,block,pos,size,duration:Math.floor(size/block)/rate};
    }
    pos+=size+(size%2);
  }
  return null;
}
async function decodeExcerpt(context,file,offset){
  const info=wavInfo.get(file) || await readWavInfo(file);
  if(!info)return {buffer:await context.decodeAudioData(await file.arrayBuffer()),offset};
  const {format,rate,block,pos,size}=info;
  const start=Math.min(size,Math.floor(offset*rate)*block);
  const length=Math.min(size-start,rate*12*block);
  if(length<rate*block)throw Error('Choose a start time with at least one second remaining.');
  const header=new ArrayBuffer(28+format.length),v=new DataView(header),bytes=new Uint8Array(header);
  const tag=(i,text)=>bytes.set([...text].map(c=>c.charCodeAt(0)),i);
  tag(0,'RIFF');v.setUint32(4,header.byteLength+length-8,true);tag(8,'WAVE');tag(12,'fmt ');
  v.setUint32(16,format.length,true);bytes.set(format,20);tag(20+format.length,'data');v.setUint32(24+format.length,length,true);
  return {buffer:await context.decodeAudioData(await new Blob([header,file.slice(pos+start,pos+start+length)]).arrayBuffer()),offset:0};
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
      const excerpt = instrument ? {buffer: referenceBuffer(context, instrument),offset:0} : await decodeExcerpt(context,file,offset);
      const decoded=excerpt.buffer;
      const start = Math.round(excerpt.offset * rate);
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
  if (canvas.width !== Math.round(width*scale)) canvas.width = Math.round(width*scale);
  if (canvas.height !== Math.round(height*scale)) canvas.height = Math.round(height*scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.clearRect(0,0,width,height);
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
  const progress = $('live-progress');
  const noise = frequencies.map(()=>0);
  let samples=0, frame, last=-1, lastPreview=0;
  function update() {
    frame=requestAnimationFrame(update);
    const elapsed=context.currentTime-begins;
    if(elapsed-last<.085)return;
    last=elapsed;
    const raw=micSpectrum(), source=referencePoints(sourceSpectrum());
    if(elapsed>=noiseStart && elapsed<noiseEnd){
      samples++;
      raw.forEach((v,i)=>{noise[i]+=((v||0)-noise[i])/samples;});
    }
    microphoneTrace=referencePoints(elapsed<filterEnd ? raw : raw.map((v,i)=>v===null?null:Math.max(0,v-noise[i])));
    const lines=[{color:referenceColor,points:source},{color:accent,points:microphoneTrace}];
    draw($('live-chart'),lines,true);
    if(instrument)drawReference(source);
    progress.value=Math.min(1,Math.max(0,elapsed/(contentStart+duration)));
    $('live-phase').textContent=elapsed<noiseEnd?'Measuring noise floor':elapsed<contentStart?'Synchronizing':elapsed<=contentStart+duration?'Recording · microphone and reference':'Finishing measurement';
    if(file && elapsed-contentStart>=.8 && elapsed-lastPreview>1.05){
      lastPreview=elapsed;
      const estimate=previewTrack();
      if(estimate){preliminaryResponse=estimate;renderEQ();}
    }
  }
  frame=requestAnimationFrame(update);
  return ()=>{
    cancelAnimationFrame(frame);microphoneTrace=null;preliminaryResponse=null;
    $('live-phase').textContent='Input spectrum · dBFS';progress.value=0;
    if(instrument)drawReference();
    renderEQ();
  };
}

const signed = db => `${db > 0 ? '+' : ''}${db} dB`;

function renderEQ() {
  $('baseline').hidden = mode !== 'sweep' || !current;
  const response = preliminaryResponse || (mode === 'sweep' ? current?.response : mode === 'track' ? track?.response : instrumentResponse);
  const raw = $('bands').value.trim();
  const centers = [...new Set(raw.split(/[\s,;]+/).map(Number))].sort((a,b)=>a-b);
  const valid = raw && centers.length <= 32 && centers.every(h=>Number.isInteger(h)&&h>=20&&h<=20000);
  const gains = valid ? eqSettings(response || [], centers) : [];
  $('gains').replaceChildren(...gains.map(({hz,gain})=>{
    const li=document.createElement('li'), value=document.createElement('strong');
    li.textContent=hz+' Hz';value.textContent=gain===null?(response?'Low signal':'—'):signed(gain);
    value.className=gain<0?'cut':gain>0?'boost':'neutral';li.append(value);return li;
  }));
  $('eq-note').textContent=valid ? (response?'Adjustments rounded to 1 dB.':'Run a measurement to calculate adjustments.') : 'Enter up to 32 whole-number frequencies from 20 to 20,000 Hz.';
  $('legend').textContent=mode.toUpperCase()+' · '+(response?'Recommended gain (dB)':'Awaiting measurement');
  const series=[];
  if(mode==='sweep' && before && valid) series.push({color:beforeColor,points:eqSettings(before.response,centers).map(v=>({hz:v.hz,db:v.gain}))});
  if(response) series.push({color:accent,points:gains.map(v=>({hz:v.hz,db:v.gain}))});
  draw($('chart'),series);
  $('quality').textContent=mode==='sweep' && before?'Blue: current · Red: saved baseline':'';
}
function renderCharts(){renderEQ();}
function renderMeasure(){renderEQ();}
for(const tab of document.querySelectorAll('[data-tab]')) tab.onclick=()=>{
  if(active)return;
  stopPreview();mode=tab.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===tab)));
  document.querySelectorAll('[data-mode]').forEach(p=>p.hidden=p.dataset.mode!==mode);
  if(mode==='instrument'){if(referenceTrace)drawReference();else refreshReference();}
  renderEQ();
};
async function run(file, instrument = null) {
  if (active) return;
  const resumeMonitor = Boolean(monitor);
  stopMonitor();
  stopPreview();
  const offset = instrument ? 0 : $('offset').valueAsNumber;
  if (file && (!Number.isFinite(offset) || offset < 0)) {
    status.textContent = 'Enter a valid start time in seconds.';
    return;
  }
  active = new AbortController();
  micUI();
  updateButtons();
  status.textContent = 'Preparing capture…';
  try {
    const result = await capture(file, offset, active.signal, instrument);
    if (instrument) {
      instrumentResponse = result.response;

      renderEQ();
    } else if (file) {
      track = result;

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
    renderEQ();
  } catch (error) {
    status.textContent = active.signal.aborted ? 'Recording stopped.'
      : error.name === 'NotAllowedError' ? 'Allow microphone access in the site settings.'
      : error.name === 'EncodingError' ? 'This audio file could not be decoded. Try MP3 or WAV.'
      : error.message;
  } finally {
    active = null;
    micUI();
    draw($('live-chart'), [], true);
    if(resumeMonitor && !analyzer.hidden) startMonitor();
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
  loadDuration();
  $('track-name').textContent = $('track').files[0]?.name || 'Choose audio file';
  $('track-summary').textContent = '';
  renderEQ();
  updateButtons();
};
let duration = 0;
function updateExcerpt() {
  const start = Number($('offset').value);
  const time = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  $('excerpt').textContent = duration ? time(start) + ' – ' + time(Math.min(duration, start + 12)) : 'Choose a track';
}
let releaseMetadata;
async function loadDuration() {
  releaseMetadata?.();
  const file = $('track').files[0];
  duration = 0;
  $('offset').value = $('offset').max = 0;
  updateExcerpt();
  if (!file) return;
  const info = await readWavInfo(file).catch(()=>null);
  if ($('track').files[0] !== file) return;
  if (info) {
    wavInfo.set(file,info);duration=info.duration;
    $('offset').max=Math.max(0,Math.floor((duration-1)*10)/10);
    updateExcerpt();updateButtons();return;
  }
  const audio = new Audio();
  const url = URL.createObjectURL(file);
  audio.preload = 'metadata';
  releaseMetadata = () => {
    audio.onloadedmetadata = audio.onerror = null;
    audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); releaseMetadata = null;
  };
  audio.onloadedmetadata = audio.onerror = () => {
    if ($('track').files[0] === file && Number.isFinite(audio.duration)) {
      duration = audio.duration;
      $('offset').max = Math.max(0, Math.floor((duration - 1) * 10) / 10);
      updateExcerpt();
      updateButtons();
    }
    if (!duration) $('excerpt').textContent='Duration unavailable · starts at 0:00';
    releaseMetadata();
  };
  audio.src = url;
}
$('offset').oninput = updateExcerpt;
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
let selectedInstrument = 0;
instruments.forEach((item, i) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = item.name;
  button.setAttribute('aria-pressed', String(i === 0));
  button.onclick = () => {
    if (active) return;
    selectedInstrument = i;
    for (const option of picker.children) option.setAttribute('aria-pressed', String(option === button));
    changeInstrument();
  };
  picker.append(button);
});

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
  if (analyzer.hidden || mode !== 'instrument' || !points) return;
  const series=[{points,color:referenceColor}];
  if(microphoneTrace) series.push({points:microphoneTrace,color:accent});
  draw($('instrument-chart'),series,true,instruments[selectedInstrument].range);
}

function refreshReference() {
  const item = instruments[selectedInstrument];
  $('instrument-range').textContent = item.feature + ' · ' + item.range.join('–') + ' Hz';
  $('instrument-caption').textContent = 'Reference · enable microphone for live overlay';
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
  $('instrument-caption').textContent = 'Reference · enable microphone for live overlay';
  drawReference();
}

$('instrument-play').onclick = async () => {
  if (preview) return stopPreview();
  if (active) return;
  const context = new AudioContext();
  const source = context.createBufferSource();
  const session = { context, source, frame: 0 };
  source.buffer = referenceBuffer(context, instruments[selectedInstrument]);
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
  $('instrument-caption').textContent = 'Reference (violet) · microphone (blue)';
  let last = -100;
  function frame(now) {
    if (preview !== session) return;
    if (now - last >= 65) { drawReference(referencePoints(read())); last = now; }
    session.frame = requestAnimationFrame(frame);
  }
  frame(performance.now());
};

function changeInstrument() {
  stopPreview();
  instrumentResponse = null;
  renderEQ();
  refreshReference();
};
$('instrument-measure').onclick = () => {
  const item = instruments[selectedInstrument];
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
  if (!audio) { stopPreview(); stopMonitor(); active?.abort(); }
  if (changed) {
    positionShiftOverview();
    document.title = audio ? 'Spectrum analyzer — Artem Borisenko' : 'Artem Borisenko — Manufacturing ERP';
    if (audio) { renderEQ(); draw($('live-chart'),[],true); if(mode==='instrument') refreshReference(); }
    window.scrollTo(0, 0);
  }
  if (location.hash === '#spectrum-profile') $('profile').scrollIntoView();
}
window.addEventListener('hashchange', selectProject);
selectProject();
})();
