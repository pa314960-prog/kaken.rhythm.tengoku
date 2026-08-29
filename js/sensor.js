/* ===========================================================
   sensor.js — マイク(手拍子)・カメラ(モーション)を「ボタン」に変える

   【しくみ】
   マイク : 音量(RMS)を16msごとに測り、周囲の平均よりも大きく
            跳ね上がった瞬間を「1押し」にする。手拍子でも声でもよい。
   カメラ : 縮小した映像(64x48)と前フレームの差分を33msごとに測り、
            動きが大きく跳ね上がった瞬間を「1押し」にする（手を振る等）。

   【プライバシー】
   映像・音声はこのファイル内で数値(音量・差分)に変換してその場で捨てる。
   保存も送信も一切しない。

   検出した「押した」は RT.Input.injectPress() へ流すので、
   判定もタイミング調整もボタンとまったく同じ経路を通る。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};
  var doc = global.document;

  // 機材そのものの遅れの見込み(秒)。残りの個人差はタイミング調整で吸収する
  var LATENCY = { mic: 0.035, camera: 0.09 };

  var st = {
    mode: null, stream: null, timer: null,
    analyser: null, buf: null,                 // マイク用
    video: null, cv: null, cx: null, prev: null, // カメラ用
    noise: 0,          // 周囲の平均レベル（ゆっくり追従する基準値）
    lastFire: 0,       // 直前に発火した時刻（連打防止）
    warmupUntil: 0,    // 起動直後は基準値が安定するまで発火しない
    onLevel: null      // レベルメーター用コールバック
  };

  function sens() {
    var v = Number(RT.Store.get('sensitivity')) || 5;
    return v < 1 ? 1 : (v > 10 ? 10 : v);
  }

  function level(lv) {
    if (st.onLevel) { try { st.onLevel(lv); } catch (e) {} }
  }

  function fire(mode) {
    st.lastFire = RT.Audio.now();
    RT.Input.injectPress(RT.Audio.now() - LATENCY[mode]);
  }

  /* ---------------- マイク（手拍子） ---------------- */

  function startMic() {
    var ctx = RT.Audio.ensure();
    if (!ctx) {
      var e = new Error('no-audio'); e.name = 'NotSupportedError';
      return Promise.reject(e);
    }
    return global.navigator.mediaDevices.getUserMedia({
      // 手拍子の「パン」を潰されないよう、加工系は全部オフ
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      st.stream = stream;
      var src = ctx.createMediaStreamSource(stream);
      st.analyser = ctx.createAnalyser();
      st.analyser.fftSize = 1024;
      st.analyser.smoothingTimeConstant = 0;
      src.connect(st.analyser); // destination には繋がない＝マイク音は鳴らない
      st.buf = new Float32Array(st.analyser.fftSize);
      st.noise = 0.008;
      st.warmupUntil = RT.Audio.now() + 0.4;
      st.timer = global.setInterval(micTick, 16);
    });
  }

  function micTick() {
    if (!st.analyser) return;
    st.analyser.getFloatTimeDomainData(st.buf);
    var sum = 0, i;
    for (i = 0; i < st.buf.length; i++) sum += st.buf[i] * st.buf[i];
    var rms = Math.sqrt(sum / st.buf.length);

    var s = sens();
    // 感度が高いほど「基準値の何倍で発火するか」と最低音量が下がる
    var thr = Math.max(st.noise * (5.5 - s * 0.35), 0.015 + (10 - s) * 0.006);
    level(rms / thr);

    var now = RT.Audio.now();
    if (now < st.warmupUntil) { st.noise = st.noise * 0.9 + rms * 0.1; return; }
    if (rms > thr && now - st.lastFire > 0.16) {
      fire('mic');
    } else {
      st.noise = st.noise * 0.97 + rms * 0.03;
    }
  }

  /* ---------------- カメラ（モーション） ---------------- */

  function startCamera() {
    return global.navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }
    }).then(function (stream) {
      st.stream = stream;
      var v = doc.createElement('video');
      v.muted = true;
      v.setAttribute('playsinline', '');
      v.srcObject = stream;
      st.video = v;
      return v.play();
    }).then(function () {
      st.cv = doc.createElement('canvas');
      st.cv.width = 64; st.cv.height = 48;
      st.cx = st.cv.getContext('2d', { willReadFrequently: true });
      st.prev = null;
      st.noise = 2;
      st.warmupUntil = RT.Audio.now() + 0.8; // 露出が安定するまで待つ
      st.timer = global.setInterval(camTick, 33);
    });
  }

  function camTick() {
    if (!st.cx || !st.video || st.video.readyState < 2) return;
    st.cx.drawImage(st.video, 0, 0, 64, 48);
    var d;
    try { d = st.cx.getImageData(0, 0, 64, 48).data; } catch (e) { return; }

    var n = 64 * 48, lum = new Float32Array(n), diff = 0, i, p;
    for (i = 0; i < n; i++) {
      p = i * 4;
      lum[i] = d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11;
    }
    if (st.prev) {
      for (i = 0; i < n; i++) diff += Math.abs(lum[i] - st.prev[i]);
      diff /= n;
    }
    st.prev = lum;

    var s = sens();
    var thr = Math.max(st.noise * (6.0 - s * 0.45), 3 + (10 - s) * 1.2);
    level(diff / thr);

    var now = RT.Audio.now();
    if (now < st.warmupUntil) { st.noise = st.noise * 0.8 + diff * 0.2; return; }
    if (diff > thr && now - st.lastFire > 0.25) {
      fire('camera');
    } else {
      st.noise = st.noise * 0.95 + diff * 0.05;
    }
  }

  /* ---------------- 公開API ---------------- */

  function stop() {
    if (st.timer) { global.clearInterval(st.timer); st.timer = null; }
    if (st.stream) {
      try { st.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      st.stream = null;
    }
    if (st.video) { try { st.video.srcObject = null; } catch (e2) {} st.video = null; }
    st.analyser = null; st.buf = null;
    st.cv = null; st.cx = null; st.prev = null;
    st.mode = null;
    level(0);
  }

  /** mode: 'mic' | 'camera'。権限の許可待ちを含むので Promise を返す */
  function start(mode) {
    if (st.mode === mode) return Promise.resolve();
    stop();
    if (!(global.navigator.mediaDevices && global.navigator.mediaDevices.getUserMedia)) {
      // http://192.168.x.x のような「安全でない接続」では使えない
      var err = new Error('unsupported'); err.name = 'NotSupportedError';
      return Promise.reject(err);
    }
    var p = (mode === 'mic') ? startMic() : startCamera();
    return p.then(
      function () { st.mode = mode; },
      function (err) { stop(); throw err; }
    );
  }

  RT.Sensor = {
    start: start,
    stop: stop,
    active: function () { return st.mode; },
    setLevelCallback: function (fn) { st.onLevel = fn || null; }
  };
})(window);
