/* ===========================================================
   main.js — 起動処理
   ブラウザは「ユーザー操作なしに音を鳴らす」ことを禁止しているので、
   最初のクリック/キー入力で AudioContext を起こす。
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT;
  var doc = global.document;

  function boot() {
    var canvas = doc.getElementById('gameCanvas');
    var tapLayer = doc.getElementById('tapLayer');
    var gate = doc.getElementById('gate');

    if (!(global.AudioContext || global.webkitAudioContext)) {
      gate.innerHTML = '<div class="gate-inner"><p class="gate-title">このブラウザでは音を鳴らせません</p>' +
        '<p class="gate-sub">Chrome / Edge / Firefox の最新版でお試しください</p></div>';
      return;
    }

    RT.Game.init(canvas, tapLayer);
    RT.UI.init();
    RT.Audio.setVolume(RT.Store.get('volume'));

    var opened = false;
    function open() {
      if (opened) return;
      opened = true;
      RT.Audio.unlock().then(function () {
        RT.Audio.setVolume(RT.Store.get('volume'));
        gate.classList.add('hidden');
        RT.Audio.S.ui('ok');
        var b = doc.querySelector('#screen-title .btn-primary');
        if (b) b.focus();
      });
    }
    gate.addEventListener('click', open);
    gate.addEventListener('keydown', open);
    doc.addEventListener('keydown', function (e) {
      if (!opened && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); open(); }
    });

    // タブを離れたら音を止める（戻ってきたときのズレ防止）
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && RT.UI.current() === 'play') {
        RT.Game.quit();
        RT.UI.show('select');
      }
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
