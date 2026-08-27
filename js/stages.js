/* ===========================================================
   stages.js — ステージ定義（譜面・伴奏・絵）

   【譜面の書き方】
   1小節 = 16文字（16分音符）。
     x : プレイヤーが押すノート
     H : ながおし開始（続く - の数だけ伸びる）
     - : ながおしの継続
     o : お手本（自動で鳴る。押さない）
     . : 休み
   =========================================================== */
(function (global) {
  'use strict';
  var RT = global.RT = global.RT || {};
  var S = RT.Audio.S; // 音源（audio.js が先に読み込まれている前提）

  /* ---------- 譜面パーサ ---------- */
  function parse(startBeat, bars) {
    var s = bars.join(''), notes = [], i, ch, b;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      b = startBeat + i * 0.25;
      if (ch === 'x') {
        notes.push({ b: b, t: 'tap' });
      } else if (ch === 'o') {
        notes.push({ b: b, t: 'cue' });
      } else if (ch === 'H') {
        var len = 0, j = i + 1;
        while (j < s.length && s.charAt(j) === '-') { len++; j++; }
        notes.push({ b: b, t: 'hold', len: Math.max(len * 0.25, 0.5) });
      }
    }
    return notes;
  }

  /* ---------- 伴奏の部品 ---------- */
  function chordAt(prog, bar) { return prog[bar % prog.length]; }

  function groove(step, t, prog, opt) {
    var bar = Math.floor(step / 16), s = step % 16;
    var ch = chordAt(prog, bar);
    var intro = bar < 2;
    var vol = intro ? 0.6 : 1;

    if (s === 0 || s === 8) S.kick(t, 0.95 * vol);
    if (opt.extraKick && s === 14 && !intro) S.kick(t, 0.6);
    if (s === 4 || s === 12) S.snare(t, 0.55 * vol);
    if (s % (opt.hat16 ? 1 : 2) === 0) S.hat(t, (s % 4 === 0 ? 0.26 : 0.15) * vol, s === 14);

    if (s === 0) S.bass(t, ch[0], 0.42, vol);
    if (s === 6) S.bass(t, ch[0] + 12, 0.18, 0.7 * vol);
    if (s === 10) S.bass(t, ch[0], 0.24, 0.8 * vol);

    if (!intro && (s === 2 || s === 6 || s === 10 || s === 14)) {
      S.chord(t, ch.slice(1), 0.17, vol, opt.pad || 'triangle');
    }
  }

  /* ---------- 絵の部品 ---------- */
  var D = {
    roundRect: function (c, x, y, w, h, r) {
      var rr = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + rr, y);
      c.arcTo(x + w, y, x + w, y + h, rr);
      c.arcTo(x + w, y + h, x, y + h, rr);
      c.arcTo(x, y + h, x, y, rr);
      c.arcTo(x, y, x + w, y, rr);
      c.closePath();
    },
    circle: function (c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.closePath(); },

    /** ぷにっとしたキャラクター */
    blob: function (c, x, y, r, color, squash, look) {
      squash = squash || 0;
      c.save();
      c.translate(x, y);
      c.scale(1 + squash * 0.28, 1 - squash * 0.28);
      // 影（床に落ちる薄い楕円）
      c.save();
      c.globalAlpha = 0.20; c.fillStyle = '#000';
      c.translate(0, r * 1.02); c.scale(1, 0.22);
      D.circle(c, 0, 0, r * 0.88); c.fill();
      c.restore();
      // 体
      c.fillStyle = color;
      D.circle(c, 0, 0, r); c.fill();
      c.fillStyle = 'rgba(255,255,255,.28)';
      D.circle(c, -r * 0.32, -r * 0.34, r * 0.28); c.fill();
      // 目
      var ex = r * 0.34, ey = -r * 0.1, dx = (look || 0) * r * 0.1;
      c.fillStyle = '#1b1b2b';
      D.circle(c, -ex + dx, ey, r * 0.13); c.fill();
      D.circle(c, ex + dx, ey, r * 0.13); c.fill();
      // 口
      c.strokeStyle = '#1b1b2b'; c.lineWidth = Math.max(2, r * 0.07); c.lineCap = 'round';
      c.beginPath();
      c.arc(dx * 0.5, r * 0.22, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
      c.restore();
    },

    star: function (c, x, y, r, color) {
      c.save(); c.translate(x, y); c.fillStyle = color; c.beginPath();
      for (var i = 0; i < 10; i++) {
        var rr = (i % 2 === 0) ? r : r * 0.45, a = -Math.PI / 2 + i * Math.PI / 5;
        c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath(); c.fill(); c.restore();
    }
  };

  /** 拍に合わせて上下する量（0..1のバウンス） */
  function bounce(beat) {
    var p = beat - Math.floor(beat);
    return Math.abs(Math.sin(p * Math.PI)) * (1 - p * 0.25);
  }

  /* =========================================================
     ステージ1 : タイコ道場
     ========================================================= */
  var stage1 = {
    id: 'taiko',
    name: 'タイコ道場',
    icon: '🥁',
    color: '#ff5d8f',
    color2: '#7a2b4a',
    desc: 'まずは基本。流れてくる玉がマトに重なったら押す。表拍だけのやさしい譜面。',
    level: '★☆☆',
    bpm: 118,
    prog: [[48, 60, 64, 67], [45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62]],
    grooveOpt: { hat16: false },
    build: function () {
      return parse(8, [
        'x...x...x...x...',
        'x...x...x...x...',
        'x...x..x..x.....',
        'x...x...x.x.x...',
        'x.x.x.x.x.......',
        'x...x...x...x...',
        'x..x..x...x..x..',
        'x...x.x.x...x.x.',
        'x.......x.x.x.x.',
        'x...x...x...x...',
        'x.x.x.x.x.x.x.x.',
        'x...............'
      ]);
    },
    hit: function (t, kind) {
      if (kind === 'miss') S.taiko(t, 0.35); else S.taiko(t, 1);
    },
    cue: function (t) { S.taiko(t, 0.5); },

    drawBack: function (c, st) {
      // 道場の壁と床
      var g = c.createLinearGradient(0, 0, 0, st.H);
      g.addColorStop(0, '#3a1e35'); g.addColorStop(1, '#1a1020');
      c.fillStyle = g; c.fillRect(0, 0, st.W, st.H);
      // 日の丸
      c.globalAlpha = 0.15; c.fillStyle = '#ff5d8f';
      D.circle(c, st.W * 0.64, 150, 118 + bounce(st.beat) * 8); c.fill();
      c.globalAlpha = 1;
      // 床
      c.fillStyle = '#2a1626'; c.fillRect(0, st.laneY + 96, st.W, st.H);
      c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 2;
      for (var i = 0; i < 14; i++) {
        c.beginPath(); c.moveTo(i * 80 - 30, st.laneY + 96); c.lineTo(i * 80 - 120, st.H); c.stroke();
      }
    },

    drawActor: function (c, st) {
      var bx = st.targetX, by = st.laneY;
      var hit = st.hitAnim;
      // 太鼓
      c.save();
      c.translate(bx, by);
      c.scale(1 + hit * 0.10, 1 - hit * 0.08);
      c.fillStyle = '#8b3a1f';
      D.roundRect(c, -70, -66, 140, 132, 26); c.fill();
      c.fillStyle = '#f6e7cf';
      D.circle(c, 0, 0, 56); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 4;
      D.circle(c, 0, 0, 56); c.stroke();
      c.fillStyle = 'rgba(255,93,143,' + (0.25 + hit * 0.6) + ')';
      D.circle(c, 0, 0, 40 + hit * 14); c.fill();
      c.restore();

      // 叩く人
      var px = bx - 148, py = by + 6;
      D.blob(c, px, py - bounce(st.beat) * 10, 44, '#ffd23f', hit * 0.5, 1);
      // ばち
      c.save();
      c.translate(px + 34, py - 6);
      c.rotate(-0.9 + hit * 1.5);
      c.strokeStyle = '#e8d5b5'; c.lineWidth = 9; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(74, -6); c.stroke();
      c.restore();
    }
  };

  /* =========================================================
     ステージ2 : コール＆レスポンス
     ========================================================= */
  var PHRASES = [
    'x...x...x...x...',
    'x.x.....x.x.....',
    'x..x..x.........',
    'x...x.x.x.......',
    'x..x..x..x......',
    'xx..xx..x.x.x.x.'
  ];

  var stage2 = {
    id: 'call',
    name: 'コール＆レスポンス',
    icon: '📣',
    color: '#4fd6e8',
    color2: '#12405a',
    desc: '先生が1小節ぶん歌う → 同じリズムでまねっこ。青い音符はお手本、押すのは黄色だけ。',
    level: '★★☆',
    bpm: 126,
    prog: [[41, 53, 57, 60], [43, 55, 59, 62], [40, 52, 55, 59], [45, 57, 60, 64]],
    grooveOpt: { hat16: true },
    build: function () {
      var bars = [], i;
      for (i = 0; i < PHRASES.length; i++) {
        bars.push(PHRASES[i].replace(/x/g, 'o')); // 先生のコール
        bars.push(PHRASES[i]);                    // プレイヤーのレスポンス
      }
      return parse(8, bars);
    },
    hit: function (t, kind) {
      if (kind === 'miss') S.voice(t, 60, 0.4); else { S.voice(t, 74, 1); S.clap(t, 0.6); }
    },
    cue: function (t) { S.voice(t, 67, 0.85); },

    drawBack: function (c, st) {
      var g = c.createLinearGradient(0, 0, 0, st.H);
      g.addColorStop(0, '#0f3a4d'); g.addColorStop(1, '#0a1a2c');
      c.fillStyle = g; c.fillRect(0, 0, st.W, st.H);
      // 音の輪
      var b = Math.floor(st.beat), f = st.beat - b;
      c.strokeStyle = 'rgba(79,214,232,' + (0.30 * (1 - f)) + ')';
      c.lineWidth = 6;
      D.circle(c, st.W - 130, st.laneY - 40, 40 + f * 120); c.stroke();
      // 床
      c.fillStyle = '#0c2a3a'; c.fillRect(0, st.laneY + 96, st.W, st.H);
      c.fillStyle = 'rgba(255,255,255,.04)';
      for (var i = 0; i < 8; i++) c.fillRect(0, st.laneY + 110 + i * 26, st.W, 8);
    },

    drawActor: function (c, st) {
      // 先生（右上）＝お手本のとき動く。ノートの通り道より上に置く
      var tx = st.W - 110, ty = st.laneY - 108;
      D.blob(c, tx, ty - bounce(st.beat + 0.5) * 8, 46, '#4fd6e8', st.cueAnim * 0.5, -1);
      // ふきだし
      c.fillStyle = 'rgba(255,255,255,' + (0.12 + st.cueAnim * 0.55) + ')';
      D.roundRect(c, tx - 128, ty - 34, 68, 40, 12); c.fill();
      c.beginPath();
      c.moveTo(tx - 60, ty - 6); c.lineTo(tx - 46, ty + 2); c.lineTo(tx - 62, ty + 6);
      c.closePath(); c.fill();
      c.fillStyle = '#0a1a2c'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center';
      c.fillText('♪', tx - 94, ty - 6);

      // 生徒（左）＝プレイヤー
      var px = st.targetX - 128, py = st.laneY + 6;
      D.blob(c, px, py - bounce(st.beat) * 12, 48, '#ffd23f', st.hitAnim * 0.6, 1);
      if (st.hitAnim > 0.02) {
        c.globalAlpha = st.hitAnim;
        D.star(c, px + 66, py - 62, 16 + st.hitAnim * 10, '#ffd23f');
        c.globalAlpha = 1;
      }
      // マト
      c.strokeStyle = 'rgba(255,255,255,' + (0.35 + st.hitAnim * 0.5) + ')';
      c.lineWidth = 5;
      D.circle(c, st.targetX, st.laneY, 40 + st.hitAnim * 12); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2;
      D.circle(c, st.targetX, st.laneY, 54); c.stroke();
    }
  };

  /* =========================================================
     ステージ3 : ウラビート工場
     ========================================================= */
  var stage3 = {
    id: 'ura',
    name: 'ウラビート工場',
    icon: '⚙️',
    color: '#5be584',
    color2: '#123a2a',
    desc: 'ウラ拍中心＋ながおし。帯のノートは押しっぱなしにして、終わりでパッと離す。',
    level: '★★★',
    bpm: 138,
    prog: [[45, 57, 60, 64], [41, 53, 57, 60], [48, 60, 64, 67], [43, 55, 59, 62]],
    grooveOpt: { hat16: true, extraKick: true, pad: 'square' },
    build: function () {
      return parse(8, [
        '..x...x...x...x.',
        '..x...x...x.x.x.',
        'H-------..x...x.',
        '..x..x..x...x...',
        '..x...x.H-----..',
        'x.x...x...x...x.',
        'H---..x.H---..x.',
        '..x...x...x...x.',
        'x..x..x..x..x...',
        'H-------H-------',
        '..x.x.x...x.x.x.',
        'x...............'
      ]);
    },
    hit: function (t, kind) {
      if (kind === 'miss') S.beep(t, 55, 0.2, 0.6);
      else { S.beep(t, 79, 0.1, 1); S.beep(t + 0.045, 86, 0.08, 0.7); }
    },
    cue: function (t) { S.beep(t, 72, 0.1, 0.7); },
    holdMidi: 67,

    drawBack: function (c, st) {
      var g = c.createLinearGradient(0, 0, 0, st.H);
      g.addColorStop(0, '#10352a'); g.addColorStop(1, '#08161a');
      c.fillStyle = g; c.fillRect(0, 0, st.W, st.H);
      // 歯車
      var rot = st.beat * 0.5;
      [[780, 130, 70], [880, 210, 46]].forEach(function (p, k) {
        c.save(); c.translate(p[0], p[1]); c.rotate(k ? -rot : rot);
        c.fillStyle = 'rgba(91,229,132,.12)';
        for (var i = 0; i < 8; i++) {
          c.rotate(Math.PI / 4);
          D.roundRect(c, -8, -p[2] - 10, 16, 22, 4); c.fill();
        }
        D.circle(c, 0, 0, p[2]); c.fill();
        c.fillStyle = 'rgba(0,0,0,.35)'; D.circle(c, 0, 0, p[2] * 0.35); c.fill();
        c.restore();
      });
      // ベルトコンベア
      c.fillStyle = '#0b2b22'; c.fillRect(0, st.laneY + 58, st.W, 34);
      c.fillStyle = 'rgba(91,229,132,.18)';
      var off = (st.beat * 60) % 40;
      for (var x = -40; x < st.W + 40; x += 40) c.fillRect(x - off, st.laneY + 66, 20, 18);
      c.fillStyle = '#061a15'; c.fillRect(0, st.laneY + 92, st.W, st.H);
    },

    drawActor: function (c, st) {
      var px = st.targetX - 132, py = st.laneY;
      var press = st.holding ? 1 : st.hitAnim;
      // ロボット
      c.save();
      c.translate(px, py - bounce(st.beat) * 6);
      c.fillStyle = '#2f6b57';
      D.roundRect(c, -46, -46, 92, 92, 18); c.fill();
      c.fillStyle = '#0b2b22'; D.roundRect(c, -32, -30, 64, 34, 10); c.fill();
      c.fillStyle = '#5be584';
      D.circle(c, -14, -13, 7 + press * 3); c.fill();
      D.circle(c, 14, -13, 7 + press * 3); c.fill();
      c.fillStyle = 'rgba(255,255,255,' + (0.3 + press * 0.6) + ')';
      D.roundRect(c, -20, 14, 40, 12, 6); c.fill();
      // アンテナ
      c.strokeStyle = '#5be584'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(0, -46); c.lineTo(0, -68); c.stroke();
      c.fillStyle = press > 0.1 ? '#ffd23f' : '#2f6b57';
      D.circle(c, 0, -74, 8); c.fill();
      c.restore();
      // プレス機（マト）
      c.save();
      c.translate(st.targetX, st.laneY);
      // 支柱
      c.fillStyle = 'rgba(255,255,255,.05)';
      c.fillRect(-34, -st.laneY, 68, st.laneY - 74);
      c.fillStyle = 'rgba(255,255,255,.08)';
      c.fillRect(-44, -st.laneY, 8, st.laneY - 74);
      c.fillRect(36, -st.laneY, 8, st.laneY - 74);
      // プレスヘッド
      c.fillStyle = 'rgba(91,229,132,' + (0.25 + press * 0.5) + ')';
      D.roundRect(c, -50, -78 + press * 10, 100, 42, 10); c.fill();
      c.strokeStyle = 'rgba(255,255,255,' + (0.4 + press * 0.5) + ')';
      c.lineWidth = 5;
      D.circle(c, 0, 0, 40 + press * 10); c.stroke();
      c.restore();
    }
  };

  var list = [stage1, stage2, stage3];

  RT.Stages = {
    D: D,
    bounce: bounce,
    list: list,
    byId: function (id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    /** ステージから譜面と伴奏関数を組み立てる */
    prepare: function (stage) {
      S = RT.Audio.S;
      var notes = stage.build();
      var last = 8;
      for (var i = 0; i < notes.length; i++) {
        var e = notes[i].b + (notes[i].len || 0);
        if (e > last) last = e;
      }
      return {
        notes: notes,
        endBeat: Math.ceil((last + 4) / 4) * 4,
        backing: function (step, t) { groove(step, t, stage.prog, stage.grooveOpt || {}); }
      };
    }
  };
})(window);
