/* ===========================================================
   storage.js — 設定とハイスコアの保存
   localStorage はブラウザやモードによっては使えない（プライベート
   ウィンドウ等）ので、必ず失敗してもゲームが動くようにする。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};

  var KEY = 'rhythmica.v1';
  var available = true;

  var data = {
    volume: 0.8,
    // 判定オフセット(ms)。機材の遅れが入力方法ごとに違うので別々に持つ
    offsets: { button: 0, mic: 0, camera: 0 },
    inputMode: 'button',   // button | mic | camera
    sensitivity: 5,        // マイク・カメラの感度 1(にぶい)..10(びんかん)
    guide: false,          // ガイド音
    scores: {}             // { stageId: {score, rank, combo, ts} }
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if (typeof o.volume === 'number') data.volume = clamp(o.volume, 0, 1);
          if (o.offsets && typeof o.offsets === 'object') {
            ['button', 'mic', 'camera'].forEach(function (k) {
              if (typeof o.offsets[k] === 'number') data.offsets[k] = clamp(o.offsets[k], -300, 300);
            });
          } else if (typeof o.offset === 'number') {
            data.offsets.button = clamp(o.offset, -300, 300); // 旧形式からの引き継ぎ
          }
          if (o.inputMode === 'button' || o.inputMode === 'mic' || o.inputMode === 'camera') {
            data.inputMode = o.inputMode;
          }
          if (typeof o.sensitivity === 'number') data.sensitivity = clamp(Math.round(o.sensitivity), 1, 10);
          if (typeof o.guide === 'boolean') data.guide = o.guide;
          if (o.scores && typeof o.scores === 'object') data.scores = o.scores;
        }
      }
    } catch (e) {
      available = false; // 読めなくても既定値で続行
    }
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      available = false;
    }
  }

  RT.Store = {
    data: data,
    load: load,
    save: save,
    isAvailable: function () { return available; },

    get: function (k) { return data[k]; },
    set: function (k, v) { data[k] = v; save(); },

    /** いま選ばれている入力モードの判定オフセット(ms) */
    offset: function () { return data.offsets[data.inputMode] || 0; },
    setOffset: function (ms) {
      data.offsets[data.inputMode] = clamp(Math.round(ms), -300, 300);
      save();
    },

    /** ハイスコアなら更新して true を返す */
    submitScore: function (stageId, rec) {
      var cur = data.scores[stageId];
      if (!cur || rec.score > cur.score) {
        data.scores[stageId] = rec;
        save();
        return true;
      }
      return false;
    },
    bestOf: function (stageId) { return data.scores[stageId] || null; },

    clearAll: function () {
      data.scores = {};
      data.offsets = { button: 0, mic: 0, camera: 0 };
      save();
    }
  };

  load();
})(window);
