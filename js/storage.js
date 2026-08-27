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
    volume: 0.8,      // 0..1
    offset: 0,        // 判定オフセット(ms) プラス = 早押しでジャスト
    guide: false,     // ガイド音
    scores: {}        // { stageId: {score, rank, combo, ts} }
  };

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if (typeof o.volume === 'number') data.volume = clamp(o.volume, 0, 1);
          if (typeof o.offset === 'number') data.offset = clamp(o.offset, -300, 300);
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

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  RT.Store = {
    data: data,
    load: load,
    save: save,
    isAvailable: function () { return available; },

    get: function (k) { return data[k]; },
    set: function (k, v) { data[k] = v; save(); },

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
      data.offset = 0;
      save();
    }
  };

  load();
})(window);
