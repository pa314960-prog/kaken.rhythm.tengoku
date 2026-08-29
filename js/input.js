/* ===========================================================
   input.js — キー / マウス / タッチをまとめて「押した・離した」に変換

   【なぜ時刻を計算するのか】
   イベントを受け取った瞬間には、すでにブラウザ内部で数ms〜十数ms
   経っていることがある。event.timeStamp は performance.now() と同じ
   基準なので、「受け取ってから今までの経過」を引き戻すと、
   実際に押された瞬間の AudioContext 時刻が求まる。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};

  var GAME_KEYS = {
    Space: 1, Enter: 1, KeyZ: 1, KeyX: 1, KeyF: 1, KeyJ: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, NumpadEnter: 1
  };

  var handlers = { press: null, release: null };
  var down = {};          // 同時押し・オートリピート対策
  var enabled = false;

  /** イベント発生時刻を AudioContext の時間軸に変換する */
  function eventTime(e) {
    var t = RT.Audio.now();
    if (e && typeof e.timeStamp === 'number' && e.timeStamp > 0 &&
        global.performance && typeof global.performance.now === 'function') {
      var lag = (global.performance.now() - e.timeStamp) / 1000;
      // 異常値（別の時間基準を使うブラウザ等）は無視する
      if (lag >= 0 && lag < 0.2) t -= lag;
    }
    return t;
  }

  function fire(which, e, source) {
    if (!enabled) return;
    var fn = handlers[which];
    if (fn) fn(eventTime(e), source);
  }

  function onKeyDown(e) {
    if (!GAME_KEYS[e.code]) return;
    // メニュー画面ではブラウザ標準の動作（ボタン決定・スクロール）に任せる
    if (!enabled) return;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.repeat) return;          // 押しっぱなしの連打イベントは捨てる
    if (down[e.code]) return;
    down[e.code] = true;
    fire('press', e, 'key');
  }

  function onKeyUp(e) {
    if (!GAME_KEYS[e.code]) return;
    if (!down[e.code]) return;
    delete down[e.code];
    // 他のキーがまだ押されているなら「離した」扱いにしない
    for (var k in down) { if (down.hasOwnProperty(k)) return; }
    fire('release', e, 'key');
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    if (down.__pointer) return;
    down.__pointer = true;
    fire('press', e, 'pointer');
  }

  function onPointerUp(e) {
    if (!down.__pointer) return;
    delete down.__pointer;
    fire('release', e, 'pointer');
  }

  function onBlur() {
    // ウィンドウが切り替わったら押しっぱなし状態を解除する
    var had = false;
    for (var k in down) { if (down.hasOwnProperty(k)) { had = true; delete down[k]; } }
    if (had && enabled && handlers.release) handlers.release(RT.Audio.now(), 'blur');
  }

  /** ゲーム画面のクリック領域を登録する */
  function attachSurface(el) {
    if (!el) return;
    if (global.PointerEvent) {
      el.addEventListener('pointerdown', onPointerDown, { passive: false });
      global.addEventListener('pointerup', onPointerUp);
      global.addEventListener('pointercancel', onPointerUp);
    } else {
      el.addEventListener('mousedown', onPointerDown);
      global.addEventListener('mouseup', onPointerUp);
      el.addEventListener('touchstart', onPointerDown, { passive: false });
      global.addEventListener('touchend', onPointerUp);
    }
  }

  global.addEventListener('keydown', onKeyDown);
  global.addEventListener('keyup', onKeyUp);
  global.addEventListener('blur', onBlur);

  RT.Input = {
    attachSurface: attachSurface,
    /** いま選ばれている入力モード（button | mic | camera） */
    mode: function () { return RT.Store.get('inputMode') || 'button'; },
    /** マイク・カメラ(sensor.js)が検出した「押した」を注入する。
        ボタンと同じハンドラを通るので、判定・調整も同じ経路になる */
    injectPress: function (t) {
      if (enabled && handlers.press) handlers.press(t, 'sensor');
    },
    /** 入力の受け取り先を差し替える（プレイ中・調整中で使い分ける） */
    bind: function (onPress, onRelease) {
      handlers.press = onPress || null;
      handlers.release = onRelease || null;
    },
    enable: function (v) {
      enabled = !!v;
      if (!enabled) { for (var k in down) { if (down.hasOwnProperty(k)) delete down[k]; } }
    },
    isEnabled: function () { return enabled; }
  };
})(window);
