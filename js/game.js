/* ===========================================================
   game.js — ゲーム本体（描画・判定・スコア）

   【判定の考え方】
     押した時刻(生) − スピーカー遅延 − 個人補正 ＝ 判定に使う時刻
   これを「ノートの本来の時刻」と比べるだけ。基準は常に AudioContext。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};
  var D = null;

  /* ---------- 定数 ---------- */
  var W = 960, H = 540;
  var TARGET_X = 250;      // マトの位置
  var LANE_Y = 318;        // ノートが流れる高さ
  var APPROACH = 3;        // 何拍先から見えるか

  var JUST = 0.055;        // ジャスト判定(秒)
  var NICE = 0.115;        // ナイス判定(秒)
  var LATE = 0.165;        // これを過ぎたら見逃しミス
  var R_JUST = 0.075;      // ながおしを離す判定は少し甘め
  var R_NICE = 0.150;
  var R_LATE = 0.200;

  var canvas = null, c2d = null, scale = 1;
  var st = null, raf = null, lastT = 0, onEnd = null;

  /* ---------- 初期化 ---------- */
  function init(canvasEl, surfaceEl) {
    canvas = canvasEl;
    c2d = canvas.getContext('2d');
    D = RT.Stages.D;
    resize();
    global.addEventListener('resize', resize);
    RT.Input.attachSurface(surfaceEl || canvas);
    RT.Input.bind(onPress, onRelease);
  }

  function resize() {
    if (!canvas) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = dpr;
  }

  /* ---------- 補正 ---------- */
  function offsetSec() { return (RT.Store.get('offset') || 0) / 1000; }
  function adjust(rawTime) { return rawTime - RT.Audio.outputLatency() - offsetSec(); }
  function adjustedNow() { return adjust(RT.Audio.now()); }

  /* ---------- 開始 ---------- */
  function start(stage, endCallback) {
    var prep = RT.Stages.prepare(stage);
    onEnd = endCallback;

    var notes = prep.notes.map(function (n) {
      return {
        b: n.b, t: n.t, len: n.len || 0,
        pressDone: false, pressResult: null,
        relDone: (n.t !== 'hold'), relResult: null,
        active: false, gone: false
      };
    });

    var units = 0;
    notes.forEach(function (n) {
      if (n.t === 'tap') units += 1;
      else if (n.t === 'hold') units += 2;
    });

    st = {
      stage: stage, prep: prep, notes: notes,
      W: W, H: H, targetX: TARGET_X, laneY: LANE_Y,
      beat: 0, endBeat: prep.endBeat,
      points: 0, maxPoints: units * 2,
      counts: { just: 0, nice: 0, miss: 0 },
      combo: 0, maxCombo: 0, meter: 55,
      hitAnim: 0, cueAnim: 0, missAnim: 0, shake: 0,
      holding: null, holdStop: null,
      effects: [], phase: 'intro', finished: false
    };

    // お手本(cue)は音として予約しておく
    var events = [];
    notes.forEach(function (n) {
      if (n.t === 'cue') {
        events.push({
          beat: n.b,
          fn: function (t) { stage.cue(t); }
        });
      }
    });
    // カウントイン
    for (var i = 4; i < 8; i++) {
      events.push({ beat: i, fn: (function (k) { return function (t) { RT.Audio.S.click(t, k === 7); }; })(i) });
    }
    if (RT.Store.get('guide')) {
      for (var g = 8; g < prep.endBeat; g++) {
        events.push({ beat: g, fn: (function (k) { return function (t) { RT.Audio.S.click(t, k % 4 === 0); }; })(g) });
      }
    }

    RT.Audio.startSong(stage.bpm, prep.backing, events, 0.6);
    RT.Input.enable(true);
    lastT = 0;
    if (raf) global.cancelAnimationFrame(raf);
    raf = global.requestAnimationFrame(loop);
  }

  function stop() {
    RT.Input.enable(false);
    RT.Audio.stopSong();
    if (st && st.holdStop) { st.holdStop(RT.Audio.now()); st.holdStop = null; }
    if (raf) { global.cancelAnimationFrame(raf); raf = null; }
  }

  function quit() {
    stop();
    onEnd = null;   // 終了演出の途中で中断されたときリザルトを出さない
    st = null;
  }

  /* ---------- 判定 ---------- */
  function noteTime(n) { return RT.Audio.beatToTime(n.b); }
  function endTime(n) { return RT.Audio.beatToTime(n.b + n.len); }

  function grade(diff, just, nice) {
    var a = Math.abs(diff);
    if (a <= just) return 'just';
    if (a <= nice) return 'nice';
    return 'miss';
  }

  function applyResult(result, x) {
    if (result === 'just') { st.points += 2; st.counts.just++; st.combo++; st.meter += 5; }
    else if (result === 'nice') { st.points += 1; st.counts.nice++; st.combo++; st.meter += 2.5; }
    else { st.counts.miss++; st.combo = 0; st.meter -= 10; st.missAnim = 1; st.shake = 1; }
    if (st.combo > st.maxCombo) st.maxCombo = st.combo;
    st.meter = Math.max(0, Math.min(100, st.meter));
    popText(result, x);
  }

  function popText(result, x) {
    var conf = {
      just: { s: 'ジャスト!', c: '#ffd23f' },
      nice: { s: 'ナイス', c: '#4fd6e8' },
      miss: { s: 'ミス...', c: '#ff7a7a' }
    }[result];
    var stack = 0;
    for (var i = 0; i < st.effects.length; i++) if (st.effects[i].kind === 'text') stack++;
    st.effects.push({
      kind: 'text', text: conf.s, color: conf.c,
      x: (x || TARGET_X) + stack * 16, y: LANE_Y - 86 - stack * 26,
      life: 0.8, ttl: 0.8
    });
    if (result !== 'miss') {
      st.effects.push({ kind: 'ring', x: TARGET_X, y: LANE_Y, color: conf.c, life: 0.4, ttl: 0.4 });
    }
  }

  function findNote(t) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < st.notes.length; i++) {
      var n = st.notes[i];
      if (n.t === 'cue' || n.pressDone) continue;
      var d = Math.abs(t - noteTime(n));
      if (d <= LATE && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function onPress(rawTime) {
    if (!st || st.finished) return;
    var t = adjust(rawTime), sndT = RT.Audio.now();
    var n = findNote(t);

    if (!n) {
      // 何もないところで押した（空打ち）: ノリだけ少し下がる
      st.stage.hit(sndT, 'whiff');
      st.meter = Math.max(0, st.meter - 4);
      st.hitAnim = 0.6;
      return;
    }

    var r = grade(t - noteTime(n), JUST, NICE);
    n.pressDone = true;
    n.pressResult = r;
    st.stage.hit(sndT, r === 'miss' ? 'miss' : 'hit');
    if (r === 'just') RT.Audio.S.just(sndT);
    if (r === 'miss') RT.Audio.S.miss(sndT);
    applyResult(r, TARGET_X);
    st.hitAnim = 1;

    if (n.t === 'hold') {
      n.active = true;
      st.holding = n;
      if (st.holdStop) st.holdStop(sndT);
      st.holdStop = RT.Audio.S.holdStart(sndT, st.stage.holdMidi || 67);
    } else {
      n.gone = true;
    }
  }

  function onRelease(rawTime) {
    if (!st || st.finished) return;
    var n = st.holding;
    if (!n) return;
    var t = adjust(rawTime), sndT = RT.Audio.now();
    var r = grade(t - endTime(n), R_JUST, R_NICE);
    finishHold(n, r, sndT);
  }

  function finishHold(n, r, sndT) {
    n.relDone = true;
    n.relResult = r;
    n.active = false;
    n.gone = true;
    st.holding = null;
    if (st.holdStop) { st.holdStop(sndT); st.holdStop = null; }
    if (r !== 'miss') st.stage.hit(sndT, 'hit');
    else RT.Audio.S.miss(sndT);
    applyResult(r, TARGET_X);
    st.hitAnim = 1;
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    st.beat = RT.Audio.currentBeat();
    var an = adjustedNow();

    if (st.phase === 'intro' && st.beat >= 8) st.phase = 'play';

    for (var i = 0; i < st.notes.length; i++) {
      var n = st.notes[i];
      if (n.t === 'cue') {
        if (!n.gone && an >= noteTime(n)) { n.gone = true; st.cueAnim = 1; }
        continue;
      }
      // 押し忘れ
      if (!n.pressDone && an > noteTime(n) + LATE) {
        n.pressDone = true; n.pressResult = 'miss';
        applyResult('miss', TARGET_X);
        if (n.t === 'hold') { n.relDone = true; n.relResult = 'miss'; applyResult('miss', TARGET_X); }
        n.gone = true;
      }
      // 離し忘れ（押しっぱなし）
      if (n.active && an > endTime(n) + R_LATE) {
        finishHold(n, 'miss', RT.Audio.now());
      }
    }

    // アニメーション減衰
    st.hitAnim = Math.max(0, st.hitAnim - dt * 5);
    st.cueAnim = Math.max(0, st.cueAnim - dt * 4);
    st.missAnim = Math.max(0, st.missAnim - dt * 3);
    st.shake = Math.max(0, st.shake - dt * 4);

    for (var e = st.effects.length - 1; e >= 0; e--) {
      st.effects[e].life -= dt;
      if (st.effects[e].life <= 0) st.effects.splice(e, 1);
    }

    if (!st.finished && st.beat >= st.endBeat) finish();
  }

  function finish() {
    st.finished = true;
    var pct = st.maxPoints > 0 ? Math.round((st.points / st.maxPoints) * 100) : 0;
    var full = (st.counts.miss === 0);
    var rank;
    if (pct >= 98 && full) rank = 'パーフェクト!!';
    else if (pct >= 85) rank = 'ハイレベル';
    else if (pct >= 65) rank = 'なかなか';
    else rank = 'もうすこし';

    RT.Audio.S.fanfare(RT.Audio.now() + 0.15, pct >= 65);

    var result = {
      stageId: st.stage.id, stageName: st.stage.name,
      score: pct, rank: rank, full: full,
      just: st.counts.just, nice: st.counts.nice, miss: st.counts.miss,
      combo: st.maxCombo
    };
    st.effects.push({ kind: 'text', text: 'FINISH!', color: '#fff', x: W / 2, y: 150, life: 1.4, ttl: 1.4 });

    global.setTimeout(function () {
      stop();
      var cb = onEnd; onEnd = null;
      if (cb) cb(result);
    }, 1100);
  }

  /* ---------- 描画 ---------- */
  function noteX(dbeat) {
    return TARGET_X + (dbeat / APPROACH) * (W + 70 - TARGET_X);
  }

  function drawNote(c, n) {
    var db = n.b - st.beat;
    if (db > APPROACH + 0.4) return;
    if (n.gone && !n.active) return;
    if (db < -0.8 && n.t !== 'hold') return;

    var x = noteX(db);
    var hop = Math.max(0, Math.sin(Math.max(db, 0) * Math.PI * 0.5)) * 18;
    var y = st.laneY - hop;

    if (n.t === 'hold') {
      var x2 = noteX(n.b + n.len - st.beat);
      var left = n.active ? TARGET_X : x;
      c.fillStyle = n.active ? 'rgba(91,229,132,.85)' : 'rgba(91,229,132,.45)';
      D.roundRect(c, Math.min(left, x2), st.laneY - 17, Math.max(x2 - left, 8), 34, 17);
      c.fill();
      c.strokeStyle = '#5be584'; c.lineWidth = 3;
      D.roundRect(c, Math.min(left, x2), st.laneY - 17, Math.max(x2 - left, 8), 34, 17);
      c.stroke();
      if (!n.pressDone) {
        c.fillStyle = '#5be584'; D.circle(c, x, st.laneY, 20); c.fill();
      }
      // 終わりの印
      c.fillStyle = '#eafff0';
      D.roundRect(c, x2 - 4, st.laneY - 22, 8, 44, 4); c.fill();
      return;
    }

    var isCue = (n.t === 'cue');
    var col = isCue ? (st.stage.color || '#4fd6e8') : '#ffd23f';
    c.save();
    c.shadowColor = col; c.shadowBlur = 14;
    c.fillStyle = col;
    D.circle(c, x, y, isCue ? 15 : 20); c.fill();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,.55)';
    D.circle(c, x - 6, y - 7, isCue ? 4 : 6); c.fill();
    if (isCue) {
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2;
      D.circle(c, x, y, 22); c.stroke();
    }
  }

  function drawHUD(c) {
    // ステージ名
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.font = 'bold 15px sans-serif';
    c.fillText(st.stage.name, 26, 36);

    // スコア
    c.textAlign = 'right';
    var pct = st.maxPoints > 0 ? Math.round((st.points / st.maxPoints) * 100) : 0;
    c.fillStyle = '#fff'; c.font = 'bold 30px sans-serif';
    c.fillText(pct + '%', W - 78, 40);
    c.fillStyle = 'rgba(255,255,255,.45)'; c.font = 'bold 13px sans-serif';
    c.fillText('SCORE', W - 26, 36);

    // コンボ
    if (st.combo >= 3) {
      c.textAlign = 'left';
      c.fillStyle = '#5be584'; c.font = 'bold 34px sans-serif';
      c.fillText(st.combo, 26, 82);
      c.fillStyle = 'rgba(91,229,132,.7)'; c.font = 'bold 13px sans-serif';
      c.fillText('COMBO', 26 + String(st.combo).length * 21, 80);
    }

    // ノリメーター
    var bw = 300, bx = (W - bw) / 2, by = H - 40;
    c.fillStyle = 'rgba(0,0,0,.45)';
    D.roundRect(c, bx - 3, by - 3, bw + 6, 20, 10); c.fill();
    var col = st.meter > 70 ? '#5be584' : (st.meter > 35 ? '#ffd23f' : '#ff7a7a');
    c.fillStyle = col;
    D.roundRect(c, bx, by, Math.max(bw * st.meter / 100, 4), 14, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
    c.fillText('ノリメーター', W / 2, by - 10);

    // カウントイン
    if (st.phase === 'intro') {
      var n = Math.floor(st.beat);
      c.textAlign = 'center';
      if (st.beat < 4) {
        c.fillStyle = 'rgba(255,255,255,.8)'; c.font = 'bold 40px sans-serif';
        c.fillText('READY?', W / 2, 150);
      } else if (n >= 4 && n < 8) {
        var f = st.beat - n;
        c.globalAlpha = 1 - f * 0.6;
        c.fillStyle = '#ffd23f'; c.font = 'bold ' + (90 - f * 20) + 'px sans-serif';
        c.fillText(String(8 - n), W / 2, 170);
        c.globalAlpha = 1;
      }
    }
  }

  function drawEffects(c) {
    for (var i = 0; i < st.effects.length; i++) {
      var e = st.effects[i], k = e.life / e.ttl;
      c.save();
      if (e.kind === 'text') {
        c.globalAlpha = Math.min(1, k * 1.6);
        c.fillStyle = e.color;
        c.font = 'bold ' + (e.text === 'FINISH!' ? 64 : 30) + 'px sans-serif';
        c.textAlign = 'center';
        c.fillText(e.text, e.x, e.y - (1 - k) * 34);
      } else {
        c.globalAlpha = k * 0.8;
        c.strokeStyle = e.color; c.lineWidth = 5;
        D.circle(c, e.x, e.y, 30 + (1 - k) * 70); c.stroke();
      }
      c.restore();
    }
  }

  function draw() {
    var c = c2d;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, W, H);

    c.save();
    if (st.shake > 0) c.translate((Math.random() - 0.5) * st.shake * 9, (Math.random() - 0.5) * st.shake * 9);

    st.stage.drawBack(c, st);

    // レーンのガイド線
    c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 2;
    c.setLineDash([10, 12]);
    c.beginPath(); c.moveTo(TARGET_X, st.laneY); c.lineTo(W, st.laneY); c.stroke();
    c.setLineDash([]);

    st.holding = st.holding; // 明示（drawActor が参照）
    st.stage.drawActor(c, st);

    for (var i = 0; i < st.notes.length; i++) drawNote(c, st.notes[i]);

    drawEffects(c);
    c.restore();

    drawHUD(c);

    if (st.missAnim > 0) {
      c.fillStyle = 'rgba(255,60,60,' + (st.missAnim * 0.18) + ')';
      c.fillRect(0, 0, W, H);
    }
  }

  function loop(ts) {
    if (!st) return;
    raf = global.requestAnimationFrame(loop);
    var dt = lastT ? Math.min((ts - lastT) / 1000, 0.05) : 0.016;
    lastT = ts;
    if (!st.finished) update(dt); else st.beat = RT.Audio.currentBeat();
    // finish 後もエフェクトだけ動かす
    if (st.finished) {
      for (var e = st.effects.length - 1; e >= 0; e--) {
        st.effects[e].life -= dt;
        if (st.effects[e].life <= 0) st.effects.splice(e, 1);
      }
      st.hitAnim = Math.max(0, st.hitAnim - dt * 5);
    }
    draw();
  }

  RT.Game = {
    init: init,
    /** 他の画面が入力を横取りしたあと、ゲーム用に戻すため */
    rebind: function () { RT.Input.bind(onPress, onRelease); },
    /** 譜面調整・動作確認用（プレイ中の内部状態を覗く） */
    debugState: function () { return st; },
    start: start,
    quit: quit,
    isPlaying: function () { return !!st; }
  };
})(window);
