/* ===========================================================
   ui.js — 画面遷移・ステージ一覧・設定・タイミング調整・リザルト
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};
  var doc = global.document;

  var current = 'title';
  var lastStage = null;

  var MODE_LABEL = { button: 'ボタン', mic: 'マイク', camera: 'カメラ' };

  function $(id) { return doc.getElementById(id); }
  function $$(sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }

  /* ---------- 画面切り替え ---------- */
  var SCREENS = {
    title: 'screen-title', select: 'screen-select', help: 'screen-help',
    settings: 'screen-settings', calib: 'screen-calib',
    play: 'screen-play', result: 'screen-result'
  };

  function show(name) {
    if (current === 'calib' && name !== 'calib') stopCalib();
    if (current === 'play' && name !== 'play') RT.Game.quit();
    $$('.screen').forEach(function (el) { el.classList.remove('is-active'); });
    var el = $(SCREENS[name]);
    if (el) el.classList.add('is-active');
    current = name;
    if (name === 'select') buildStageList();
    if (name === 'settings') refreshSettingsUI(true);
    if (name === 'title') RT.Sensor.stop(); // タイトルに戻ったらカメラ・マイクを離す
    // 最初のフォーカスをボタンに置く（キーボードだけでも遊べるように）
    if (name !== 'play') {
      var b = el && el.querySelector('.btn, .stage-card');
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
    }
  }

  /* ---------- センサー補助 ---------- */
  function sensorErrorText(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
      return '使用が許可されませんでした。アドレス欄のカメラ/マイクのアイコンから許可できます';
    }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
      return 'マイク / カメラが見つかりませんでした';
    }
    if (n === 'NotReadableError') return '他のアプリが使用中のようです';
    if (n === 'NotSupportedError') {
      return 'この開き方では使えません（別PCから http://IPアドレス で開いている場合は、そのPC上で直接開いてください）';
    }
    return '起動できませんでした（' + (n || err) + '）';
  }

  function setSensorStatus(t) {
    var el = $('sensorStatus');
    if (el) el.textContent = t || '';
  }

  /** 選択中モードのセンサーを起動。失敗したらボタン操作に戻して続行する */
  function ensureSensor(showStatus) {
    var m = RT.Store.get('inputMode') || 'button';
    if (m === 'button') { RT.Sensor.stop(); return Promise.resolve(true); }
    return RT.Sensor.start(m).then(function () {
      if (showStatus) {
        setSensorStatus(m === 'mic'
          ? '🎤 マイクを聞いています。手拍子でバーが伸びればOK'
          : '📷 カメラを見ています。手を振ってバーが伸びればOK');
      }
      return true;
    }, function (err) {
      RT.Store.set('inputMode', 'button');
      RT.Sensor.stop();
      setSensorStatus('⚠ ' + sensorErrorText(err) + '。ボタン操作に戻しました');
      refreshSettingsUI(false);
      return false;
    });
  }

  /* ---------- ステージ一覧 ---------- */
  function buildStageList() {
    var wrap = $('stageList');
    wrap.innerHTML = '';
    RT.Stages.list.forEach(function (s) {
      var best = RT.Store.bestOf(s.id);
      var card = doc.createElement('button');
      card.className = 'stage-card';
      card.type = 'button';

      var icon = doc.createElement('div');
      icon.className = 'stage-icon';
      icon.style.background = s.color2 || '#333';
      icon.style.boxShadow = 'inset 0 0 0 2px ' + s.color;
      icon.textContent = s.icon;

      var body = doc.createElement('div');
      body.className = 'stage-body';
      var nm = doc.createElement('div'); nm.className = 'stage-name'; nm.textContent = s.name;
      var ds = doc.createElement('div'); ds.className = 'stage-desc'; ds.textContent = s.desc;
      var mt = doc.createElement('div'); mt.className = 'stage-meta';
      mt.textContent = 'むずかしさ ' + s.level + '　/　' + s.bpm + ' BPM';
      body.appendChild(nm); body.appendChild(ds); body.appendChild(mt);

      var bs = doc.createElement('div');
      bs.className = 'stage-best';
      bs.innerHTML = best
        ? 'ベスト<b>' + best.score + '</b>' + best.rank
        : '<span style="opacity:.5">未プレイ</span>';

      card.appendChild(icon); card.appendChild(body); card.appendChild(bs);
      card.addEventListener('click', function () { playStage(s); });
      wrap.appendChild(card);
    });
  }

  /* ---------- プレイ ---------- */
  function playStage(stage) {
    lastStage = stage;
    RT.Audio.unlock()
      .then(function () { return ensureSensor(false); })
      .then(function () {
        show('play');
        RT.Audio.S.ui('start');
        RT.Game.start(stage, showResult);
      });
  }

  /* ---------- リザルト ---------- */
  function showResult(r) {
    var isBest = RT.Store.submitScore(r.stageId, {
      score: r.score, rank: r.rank, combo: r.combo, ts: Date.now()
    });
    $('resultStage').textContent = r.stageName;
    $('resultRank').textContent = r.rank;
    $('resultScore').textContent = r.score;
    $('cJust').textContent = r.just;
    $('cNice').textContent = r.nice;
    $('cMiss').textContent = r.miss;
    $('cCombo').textContent = r.combo;
    $('resultBest').textContent = isBest ? '★ ハイスコア更新！' : '';

    var msg;
    if (r.full && r.score >= 98) msg = '完璧なノリ。もう何も言うことはありません。';
    else if (r.full) msg = 'ノーミス！ あとはジャストを増やすだけ。';
    else if (r.score >= 85) msg = 'かなりノれています。あと少しでパーフェクト。';
    else if (r.score >= 65) msg = '悪くないノリ。音をよく聴くともっと合います。';
    else msg = '目で追わず、音のノリに体を乗せてみましょう。';
    if (r.miss > 0 && r.score < 85) msg += '\nズレを感じるなら「タイミング調整」もどうぞ。';
    $('resultComment').textContent = msg;

    show('result');
  }

  /* ---------- 設定 ---------- */
  function refreshSettingsUI(tryStartSensor) {
    var m = RT.Store.get('inputMode') || 'button';
    $$('input[name=inputMode]').forEach(function (r) {
      r.checked = (r.value === m);
      r.parentNode.classList.toggle('is-on', r.checked);
    });
    $('sensRow').hidden = (m === 'button');
    $('sensRange').value = RT.Store.get('sensitivity');
    $('sensVal').textContent = RT.Store.get('sensitivity');
    $('offMode').textContent = MODE_LABEL[m];
    $('offRange').value = RT.Store.offset();
    $('offVal').textContent = RT.Store.offset();
    if (m === 'button') setSensorStatus('');
    if (tryStartSensor && m !== 'button') {
      setSensorStatus('起動しています…');
      ensureSensor(true);
    }
  }

  function bindSettings() {
    var vol = $('volRange'), volVal = $('volVal');
    vol.value = Math.round(RT.Store.get('volume') * 100);
    volVal.textContent = vol.value;
    vol.addEventListener('input', function () {
      var v = Number(vol.value) / 100;
      volVal.textContent = vol.value;
      RT.Store.set('volume', v);
      RT.Audio.setVolume(v);
    });

    // 入力モード
    $$('input[name=inputMode]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        RT.Store.set('inputMode', r.value);
        refreshSettingsUI(false);
        if (r.value === 'button') {
          RT.Sensor.stop();
          setSensorStatus('');
        } else {
          setSensorStatus('起動しています…');
          ensureSensor(true);
        }
        RT.Audio.S.ui('ok');
      });
    });

    // 感度
    var sens = $('sensRange'), sensVal = $('sensVal');
    sens.addEventListener('input', function () {
      sensVal.textContent = sens.value;
      RT.Store.set('sensitivity', Number(sens.value));
    });

    // レベルメーター（バーが右端に届いた瞬間＝1押し）
    var fill = $('levelFill');
    RT.Sensor.setLevelCallback(function (lv) {
      if (current !== 'settings' || !fill) return;
      fill.style.width = Math.round(Math.min(1, lv) * 100) + '%';
      fill.classList.toggle('hot', lv >= 1);
    });

    // 判定オフセット（入力モードごとに別保存）
    var off = $('offRange'), offVal = $('offVal');
    off.addEventListener('input', function () {
      offVal.textContent = off.value;
      RT.Store.setOffset(Number(off.value));
    });

    var guide = $('guideChk');
    guide.checked = !!RT.Store.get('guide');
    guide.addEventListener('change', function () {
      RT.Store.set('guide', guide.checked);
    });

    $('resetData').addEventListener('click', function () {
      if (global.confirm('ハイスコアと補正値をすべて消します。よろしいですか？')) {
        RT.Store.clearAll();
        refreshSettingsUI(false);
        RT.Audio.S.ui('back');
      }
    });
  }

  /* ---------- タイミング調整 ---------- */
  var calib = { running: false, samples: [], raf: null, result: null };

  function startCalib() {
    RT.Audio.unlock()
      .then(function () { return ensureSensor(false); })
      .then(function () {
        calib.samples = [];
        calib.result = null;
        calib.running = true;
        $('calibCount').textContent = '0';
        $('calibResult').textContent = '音に合わせて入力してください…（いまのモード: ' +
          MODE_LABEL[RT.Store.get('inputMode') || 'button'] + '）';
        $('calibApply').disabled = true;

        RT.Audio.startSong(100, function (step, t) {
          if (step % 4 === 0) RT.Audio.S.click(t, (step / 4) % 4 === 0);
        }, [], 0.5);

        RT.Input.bind(onCalibPress, null);
        RT.Input.enable(true);
        loopCalib();
      });
  }

  function onCalibPress(rawTime) {
    if (!calib.running) return;
    var spb = RT.Audio.spb();
    var t = rawTime - RT.Audio.outputLatency();
    var beat = (t - RT.Audio.beatToTime(0)) / spb;
    if (beat < 1) return;                       // 鳴り始めの1拍は捨てる
    var err = (beat - Math.round(beat)) * spb;  // ＋なら遅押し
    if (Math.abs(err) > spb * 0.45) return;     // 明らかに外れたものは無視

    calib.samples.push(err);
    $('calibCount').textContent = String(calib.samples.length);

    if (calib.samples.length >= 8) {
      var s = calib.samples.slice().sort(function (a, b) { return a - b; });
      var mid = s.length >> 1;
      var med = (s.length % 2) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      var ms = Math.round(med * 1000);
      ms = Math.max(-200, Math.min(200, ms));
      calib.result = ms;
      $('calibResult').textContent =
        '計測できました：あなたの平均ズレ ' + (ms > 0 ? '+' : '') + ms + ' ms（' +
        (ms > 0 ? '遅押しぎみ' : (ms < 0 ? '早押しぎみ' : 'ぴったり')) + '）';
      $('calibApply').disabled = false;
      stopCalib();
    }
  }

  function loopCalib() {
    if (!calib.running) return;
    calib.raf = global.requestAnimationFrame(loopCalib);
    var b = RT.Audio.currentBeat();
    var f = b - Math.floor(b);
    var dot = $('calibDot');
    if (b > 0 && f < 0.16) dot.classList.add('beat'); else dot.classList.remove('beat');
  }

  function stopCalib() {
    calib.running = false;
    RT.Audio.stopSong();
    RT.Input.enable(false);
    RT.Input.bind(null, null);
    if (calib.raf) { global.cancelAnimationFrame(calib.raf); calib.raf = null; }
    var dot = $('calibDot'); if (dot) dot.classList.remove('beat');
    // ゲーム用の入力に戻す
    RT.Game.rebind();
  }

  function bindCalib() {
    $('calibStart').addEventListener('click', startCalib);
    $('calibZero').addEventListener('click', function () {
      RT.Store.setOffset(0);
      $('calibResult').textContent = MODE_LABEL[RT.Store.get('inputMode') || 'button'] +
        '用の補正値を 0 ms にもどしました';
      RT.Audio.S.ui('back');
    });
    $('calibApply').addEventListener('click', function () {
      if (calib.result == null) return;
      RT.Store.setOffset(calib.result);
      $('calibResult').textContent = '補正値 ' + calib.result + ' ms を保存しました！（' +
        MODE_LABEL[RT.Store.get('inputMode') || 'button'] + '用）';
      $('calibApply').disabled = true;
      RT.Audio.S.ui('ok');
    });
  }

  /* ---------- 共通イベント ---------- */
  function bindNav() {
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-go');
        RT.Audio.S.ui(to === 'title' || to === 'select' ? 'back' : 'ok');
        show(to);
      });
    });
    $('retryBtn').addEventListener('click', function () {
      if (lastStage) playStage(lastStage);
    });
    $('quitBtn').addEventListener('click', function () {
      RT.Game.quit(); RT.Audio.S.ui('back'); show('select');
    });
    global.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') {
        if (current === 'play') { RT.Game.quit(); show('select'); }
        else if (current !== 'title') show('title');
      }
    });
  }

  RT.UI = {
    show: show,
    init: function () {
      bindNav();
      bindSettings();
      bindCalib();
      buildStageList();
      refreshSettingsUI(false);
      show('title');
    },
    current: function () { return current; }
  };
})(window);
