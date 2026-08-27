/* ===========================================================
   audio.js — Web Audio による音源合成と、リズム用スケジューラ

   【設計の要点】
   1) 音声ファイルを一切使わず、オシレータ＋ノイズで全部作る。
      → 配布時にファイル欠けが起きない / 容量ゼロ / どのPCでも同じ音。
   2) 時計は AudioContext.currentTime（音のハード時計）を唯一の基準にする。
      setInterval / requestAnimationFrame は数十ms平気でズレるので、
      「25msごとに起きて 0.25秒先まで音を"予約"する」先読み方式を使う。
   3) スピーカーまでの遅延(outputLatency)を判定から差し引く。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};

  var ctx = null, master = null, musicBus = null, seBus = null;
  var noiseBuf = null;

  var LOOKAHEAD = 0.25;   // 何秒先まで予約するか
  var TICK_MS = 25;       // スケジューラを起こす間隔

  var song = {
    playing: false,
    bpm: 120,
    spb: 0.5,             // seconds per beat
    startTime: 0,         // この曲のbeat=0にあたる AudioContext 時刻
    step: 0,              // 16分音符カウンタ
    events: [],           // [{beat, fn}] beat昇順
    evIndex: 0,
    onStep: null,
    timer: null
  };

  /* ---------------- 初期化 ---------------- */

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    musicBus = ctx.createGain(); musicBus.gain.value = 0.65; musicBus.connect(master);
    seBus    = ctx.createGain(); seBus.gain.value    = 1.0;  seBus.connect(master);

    // ノイズ（スネア・ハイハット用）は1秒分だけ作って使い回す
    var len = Math.floor(ctx.sampleRate * 1.0);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    return ctx;
  }

  /** ブラウザの自動再生制限を解除する（必ずユーザー操作の中で呼ぶ） */
  function unlock() {
    ensure();
    if (!ctx) return Promise.resolve();
    if (ctx.state === 'suspended') {
      return ctx.resume().catch(function () {});
    }
    return Promise.resolve();
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  /** スピーカーから実際に音が出るまでの遅延(秒) */
  function outputLatency() {
    if (!ctx) return 0;
    var l = (typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0)
      ? ctx.outputLatency
      : (ctx.baseLatency || 0);
    return (l > 0 && l < 0.5) ? l : 0;
  }

  function setVolume(v) { ensure(); if (master) master.gain.value = Math.max(0, Math.min(1, v)); }

  /* ---------------- 音づくりの部品 ---------------- */

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function envGain(bus, t, attack, decay, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(bus);
    return g;
  }

  function osc(type, freq, t, dur, g) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function noise(t, dur, g) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.connect(g);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.03);
    return s;
  }

  /* ---------------- 実際の音たち ---------------- */

  var S = {};

  S.kick = function (t, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var g = envGain(musicBus, t, 0.004, 0.28, 0.9 * vol);
    var o = osc('sine', 160, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
  };

  S.snare = function (t, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    var g = envGain(musicBus, t, 0.003, 0.15, 0.5 * vol);
    f.connect(g);
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true; s.connect(f);
    s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
    var g2 = envGain(musicBus, t, 0.002, 0.09, 0.25 * vol);
    osc('triangle', 190, t, 0.1, g2);
  };

  S.hat = function (t, vol, open) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var dur = open ? 0.22 : 0.045;
    var f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7500;
    var g = envGain(musicBus, t, 0.002, dur, 0.22 * vol);
    f.connect(g);
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true; s.connect(f);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  };

  S.bass = function (t, midi, dur, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var g = envGain(musicBus, t, 0.01, dur, 0.45 * vol);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    f.connect(g);
    var o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(mtof(midi), t);
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  };

  S.chord = function (t, midis, dur, vol, type) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    for (var i = 0; i < midis.length; i++) {
      var g = envGain(musicBus, t, 0.008, dur, (0.13 * vol) / Math.sqrt(midis.length));
      osc(type || 'triangle', mtof(midis[i]), t, dur, g);
    }
  };

  /** 太鼓の「ドン」 */
  S.taiko = function (t, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var g = envGain(seBus, t, 0.003, 0.34, 0.85 * vol);
    var o = osc('sine', 220, t, 0.36, g);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.14);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2600;
    var g2 = envGain(seBus, t, 0.001, 0.06, 0.3 * vol);
    f.connect(g2); noise(t, 0.07, f);
  };

  /** 手拍子 */
  S.clap = function (t, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    for (var i = 0; i < 3; i++) {
      var tt = t + i * 0.012;
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1400 + i * 250; f.Q.value = 2.2;
      var g = envGain(seBus, tt, 0.002, 0.08 + i * 0.03, (0.4 - i * 0.09) * vol);
      f.connect(g); noise(tt, 0.12, f);
    }
  };

  /** 「ぽん」という声っぽい音（コール＆レスポンス用） */
  S.voice = function (t, midi, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol;
    var g = envGain(seBus, t, 0.012, 0.26, 0.5 * vol);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = mtof(midi) * 2.2; f.Q.value = 1.4;
    f.connect(g);
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(midi) * 0.93, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.05);
    o.connect(f); o.start(t); o.stop(t + 0.32);
  };

  /** ロボットのビープ */
  S.beep = function (t, midi, dur, vol) {
    if (!ctx) return; vol = vol == null ? 1 : vol; dur = dur || 0.12;
    var g = envGain(seBus, t, 0.004, dur, 0.32 * vol);
    osc('square', mtof(midi), t, dur, g);
  };

  /** ながおし中のブーン音（stop用の関数を返す） */
  S.holdStart = function (t, midi) {
    if (!ctx) return null;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.connect(seBus);
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(midi), t);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f); f.connect(g); o.start(t);
    return function stop(tt) {
      try {
        var e = Math.max(tt, ctx.currentTime);
        g.gain.cancelScheduledValues(e);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), e);
        g.gain.exponentialRampToValueAtTime(0.0001, e + 0.08);
        o.stop(e + 0.12);
      } catch (err) { /* すでに止まっていた場合 */ }
    };
  };

  /** 判定フィードバック */
  S.just = function (t) {
    if (!ctx) return;
    var g = envGain(seBus, t, 0.003, 0.18, 0.3);
    osc('sine', mtof(96), t, 0.2, g);
    var g2 = envGain(seBus, t + 0.05, 0.003, 0.16, 0.22);
    osc('sine', mtof(103), t + 0.05, 0.18, g2);
  };
  S.miss = function (t) {
    if (!ctx) return;
    var g = envGain(seBus, t, 0.004, 0.22, 0.3);
    var o = osc('square', 200, t, 0.24, g);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
  };
  S.click = function (t, hi) {
    if (!ctx) return;
    var g = envGain(seBus, t, 0.001, hi ? 0.06 : 0.045, hi ? 0.5 : 0.32);
    osc('square', hi ? 1600 : 1100, t, 0.08, g);
  };
  S.ui = function (kind) {
    if (!ensure()) return;
    var t = ctx.currentTime + 0.001;
    if (kind === 'back') { var g = envGain(seBus, t, 0.003, 0.1, 0.22); osc('triangle', mtof(64), t, 0.12, g); }
    else if (kind === 'start') { S.chord(t, [72, 76, 79], 0.4, 1.4, 'triangle'); }
    else { var g2 = envGain(seBus, t, 0.003, 0.09, 0.22); osc('triangle', mtof(79), t, 0.1, g2); }
  };
  S.fanfare = function (t, good) {
    if (!ctx) return;
    var seq = good ? [72, 76, 79, 84] : [72, 71, 67, 64];
    for (var i = 0; i < seq.length; i++) {
      var tt = t + i * 0.13;
      var g = envGain(seBus, tt, 0.006, 0.3, 0.3);
      osc('triangle', mtof(seq[i]), tt, 0.32, g);
    }
  };

  /* ---------------- スケジューラ ---------------- */

  function beatToTime(b) { return song.startTime + b * song.spb; }
  function currentBeat() { return ctx ? (ctx.currentTime - song.startTime) / song.spb : 0; }

  function tick() {
    if (!song.playing || !ctx) return;
    var limit = ctx.currentTime + LOOKAHEAD;

    // 16分音符グリッド（伴奏用）
    while (beatToTime(song.step * 0.25) < limit) {
      if (song.onStep) {
        try { song.onStep(song.step, beatToTime(song.step * 0.25)); } catch (e) {}
      }
      song.step++;
    }

    // 単発イベント（お手本の音など）
    while (song.evIndex < song.events.length &&
           beatToTime(song.events[song.evIndex].beat) < limit) {
      var ev = song.events[song.evIndex++];
      try { ev.fn(beatToTime(ev.beat)); } catch (e2) {}
    }
  }

  /**
   * 曲を開始する。
   * @param {number} bpm
   * @param {function(step,time)} onStep 16分音符ごとに呼ばれる（伴奏を鳴らす）
   * @param {Array} events [{beat, fn(time)}] 昇順である必要がある
   * @param {number} leadIn 何秒後に beat=0 を置くか
   */
  function startSong(bpm, onStep, events, leadIn) {
    ensure();
    if (!ctx) return;
    stopSong();
    song.bpm = bpm;
    song.spb = 60 / bpm;
    song.startTime = ctx.currentTime + (leadIn == null ? 0.3 : leadIn);
    song.step = 0;
    song.evIndex = 0;
    song.events = (events || []).slice().sort(function (a, b) { return a.beat - b.beat; });
    song.onStep = onStep || null;
    song.playing = true;
    tick();
    song.timer = global.setInterval(tick, TICK_MS);
  }

  function stopSong() {
    song.playing = false;
    if (song.timer) { global.clearInterval(song.timer); song.timer = null; }
    song.onStep = null;
    song.events = [];
    song.evIndex = 0;
  }

  RT.Audio = {
    ensure: ensure,
    unlock: unlock,
    now: now,
    outputLatency: outputLatency,
    setVolume: setVolume,
    mtof: mtof,
    S: S,
    startSong: startSong,
    stopSong: stopSong,
    beatToTime: beatToTime,
    currentBeat: currentBeat,
    isPlaying: function () { return song.playing; },
    spb: function () { return song.spb; }
  };
})(window);
