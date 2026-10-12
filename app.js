/* 军理背诵 — memorization-first SPA */
(function () {
  'use strict';
  var D = window.DATA;
  if (!D) { document.getElementById('view').innerHTML = '<p class="empty">数据未加载</p>'; return; }

  var KEY = 'junli_beishu_v1';
  var INTERVALS = [0, 1, 3, 7, 14]; // Leitner days
  var CH_TITLE = {};
  (D.chs || []).forEach(function (c) { CH_TITLE[c.id] = c.title; });

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayStart(ts) {
    var d = new Date(ts || Date.now());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function addDays(ts, n) { return dayStart(ts) + n * 86400000; }

  function load() {
    var d;
    try { d = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { d = {}; }
    return {
      theme: d.theme || 'auto',
      focus: !!d.focus,
      cards: d.cards || {},   // id -> {box, due, status, seen}
      cloze: d.cloze || {},
      timeline: d.timeline || {}, // key gi_j -> {ok, status}
      pref: Object.assign({ cardCh: 'all', shuffle: false, tlMode: 'hideDate', tlGroup: 'all', clozeCh: 'all', outlineCh: null }, d.pref || {}),
      stats: Object.assign({ know: 0, fuzzy: 0, again: 0, days: {} }, d.stats || {}),
      last: d.last || todayStr()
    };
  }
  var S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('本地存储失败'); }
  }

  function applyTheme() {
    var t = S.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  function applyFocus() {
    document.body.classList.toggle('focus', !!S.focus);
  }
  applyTheme();
  applyFocus();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  function ensureItem(map, id) {
    if (!map[id]) map[id] = { box: 0, due: dayStart(), status: 'new', seen: 0 };
    return map[id];
  }

  function gradeItem(map, id, result) {
    // result: 'know' | 'fuzzy' | 'again'
    var it = ensureItem(map, id);
    var now = dayStart();
    it.seen = (it.seen || 0) + 1;
    it.status = result;
    if (result === 'know') {
      it.box = Math.min(INTERVALS.length - 1, (it.box || 0) + 1);
      it.due = addDays(now, INTERVALS[it.box] || 14);
      S.stats.know = (S.stats.know || 0) + 1;
    } else if (result === 'fuzzy') {
      it.box = Math.max(0, Math.min(it.box || 0, 1));
      it.due = addDays(now, 1);
      S.stats.fuzzy = (S.stats.fuzzy || 0) + 1;
    } else {
      it.box = 0;
      it.due = now;
      S.stats.again = (S.stats.again || 0) + 1;
    }
    var day = todayStr();
    if (!S.stats.days[day]) S.stats.days[day] = { know: 0, fuzzy: 0, again: 0 };
    S.stats.days[day][result === 'know' ? 'know' : result === 'fuzzy' ? 'fuzzy' : 'again']++;
    S.last = day;
    save();
  }

  function dueCount(map, ids) {
    var now = dayStart();
    var n = 0;
    ids.forEach(function (id) {
      var it = map[id];
      if (!it) { n++; return; }
      if ((it.due || 0) <= now || it.status === 'again' || it.status === 'fuzzy') n++;
    });
    return n;
  }

  function pickQueue(map, items, getId, limit) {
    var now = dayStart();
    var due = [], weak = [], rest = [];
    items.forEach(function (item) {
      var id = getId(item);
      var it = map[id];
      if (!it || (it.due || 0) <= now) due.push(item);
      else if (it.status === 'again' || it.status === 'fuzzy') weak.push(item);
      else rest.push(item);
    });
    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    shuffle(due); shuffle(weak);
    var q = due.concat(weak);
    if (q.length < limit) {
      shuffle(rest);
      q = q.concat(rest.slice(0, limit - q.length));
    }
    return q.slice(0, limit);
  }

  function chLabel(id) {
    if (!id || id === 'all') return '全部';
    var t = CH_TITLE[id] || id;
    return t.replace(/^第[一二三四五六七八九十]+章\s*/, '第' + ({ ch1: '一', ch2: '二', ch3: '三', ch4: '四', ch5: '五' }[id] || '') + '章');
  }

  function shortCh(id) {
    return ({ ch0: '时间', ch1: '国防', ch2: '国安', ch3: '思想', ch4: '战争', ch5: '装备' })[id] || id;
  }

  // ---------- Router ----------
  var view = document.getElementById('view');
  var R = {};
  var state = { cardI: 0, cardList: null, cardFlipped: false, tlI: 0, tlList: null, tlRevealed: false, clozeI: 0, clozeList: null, clozeShow: false };

  function route() {
    var hash = (location.hash || '#/today').replace(/^#/, '');
    var parts = hash.split('/').filter(Boolean);
    var page = parts[0] || 'today';
    var tab = { today: 'today', cards: 'cards', timeline: 'timeline', cloze: 'cloze', outline: 'outline', settings: 'today' }[page] || 'today';
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-tab') === tab);
    });
    applyFocus();
    if (R[page]) R[page](parts);
    else R.today();
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function topBar(title, sub, extraBtns) {
    var themeIco = S.theme === 'dark' ? 'moon' : S.theme === 'light' ? 'sun' : 'auto';
    return '<div class="top">' +
      '<div style="flex:1;min-width:0"><h1>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1></div>' +
      (extraBtns || '') +
      '<button class="iconbtn" data-act="focus" title="专注模式" aria-label="专注">' + ico(S.focus ? 'eye-off' : 'eye') + '</button>' +
      '<button class="iconbtn" data-act="theme" title="主题" aria-label="主题">' + ico(themeIco) + '</button>' +
      '</div>';
  }

  function ico(name) {
    var paths = {
      moon: '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" opacity=".25"/>',
      eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
      'eye-off': '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a21 21 0 0 1 5.1-5.1M9.9 4.2A10.6 10.6 0 0 1 12 4c7 0 11 8 11 8a21.5 21.5 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
      shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>'
    };
    return '<svg viewBox="0 0 24 24">' + (paths[name] || paths.settings) + '</svg>';
  }

  document.body.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'theme') {
      S.theme = { auto: 'dark', dark: 'light', light: 'auto' }[S.theme];
      save(); applyTheme();
      toast({ auto: '跟随系统', dark: '深色模式', light: '浅色模式' }[S.theme]);
      route();
    } else if (act === 'focus') {
      S.focus = !S.focus; save(); applyFocus();
      toast(S.focus ? '专注模式：已隐藏底栏' : '已退出专注模式');
      route();
    } else if (act === 'go') {
      location.hash = t.getAttribute('data-to');
    }
  });

  // ---------- Today ----------
  R.today = function () {
    var cardIds = D.cards.map(function (c) { return c.id; });
    var clozeIds = D.clozes.map(function (c) { return c.id; });
    var dueCards = dueCount(S.cards, cardIds);
    var dueCloze = dueCount(S.cloze, clozeIds);
    var knownCards = D.cards.filter(function (c) { return (S.cards[c.id] || {}).status === 'know'; }).length;
    var knownCloze = D.clozes.filter(function (c) { return (S.cloze[c.id] || {}).status === 'know'; }).length;
    var day = S.stats.days[todayStr()] || { know: 0, fuzzy: 0, again: 0 };
    var exam = D.meta && D.meta.exam;
    var daysLeft = '';
    if (exam) {
      var left = Math.ceil((new Date(exam + 'T00:00:00').getTime() - dayStart()) / 86400000);
      daysLeft = left >= 0 ? ('距考试 ' + left + ' 天') : '考试日已过';
    }
    var pct = Math.round(((knownCards + knownCloze) / Math.max(1, D.cards.length + D.clozes.length)) * 100);

    view.innerHTML = topBar('今日背诵', daysLeft) +
      '<div class="hero">' +
      '<div class="lbl">今日待复习</div>' +
      '<div class="big">' + (dueCards + dueCloze) + '<small>项</small></div>' +
      '<div class="meta">卡片 ' + dueCards + ' · 挖空 ' + dueCloze + ' · 时间点 ' + D.timeline.reduce(function (a, g) { return a + g.items.length; }, 0) + '</div>' +
      '<div class="fmt"><span>掌握约 ' + pct + '%</span><span>今日 会' + day.know + ' / 模糊' + day.fuzzy + ' / 不会' + day.again + '</span></div>' +
      '</div>' +
      '<div class="grid3 mt">' +
      '<div class="stat"><div class="n">' + knownCards + '<small>/' + D.cards.length + '</small></div><div class="t">卡片会了</div></div>' +
      '<div class="stat"><div class="n">' + knownCloze + '<small>/' + D.clozes.length + '</small></div><div class="t">挖空会了</div></div>' +
      '<div class="stat"><div class="n">' + D.outlines.reduce(function (a, c) { return a + c.sections.reduce(function (b, s) { return b + s.points.length; }, 0); }, 0) + '</div><div class="t">提纲要点</div></div>' +
      '</div>' +
      '<div class="bar mt"><i style="width:' + pct + '%"></i></div>' +
      '<div class="tiles">' +
      tile('📇', '背诵卡复习', dueCards + ' 张到期', '#/cards?due=1') +
      tile('🕳', '挖空复习', dueCloze + ' 题到期', '#/cloze?due=1') +
      tile('🗓️', '时间轴默写', '34 个时间点', '#/timeline') +
      tile('📋', '章节提纲', '口头串讲', '#/outline') +
      '</div>' +
      '<button class="btn block" data-act="go" data-to="#/cards?due=1">开始今日背诵</button>' +
      '<div class="card mt"><h3>说明</h3>' +
      '<p class="small">本站专注背诵：会 / 不会 / 模糊 会进入 Leitner 复习盒（间隔 0 / 1 / 3 / 7 / 14 天）。无刷题、无计时模考。</p>' +
      (D.meta.notes || []).map(function (n) { return '<div class="note">' + esc(n) + '</div>'; }).join('') +
      '<div class="row mt"><button class="btn ghost" data-act="go" data-to="#/settings">设置与进度</button></div>' +
      '</div>';
  };

  function tile(ico, title, sub, to) {
    return '<button class="tile" data-act="go" data-to="' + to + '"><div class="ico">' + ico + '</div><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></button>';
  }

  // ---------- Cards ----------
  function cardPool(dueOnly) {
    var ch = S.pref.cardCh || 'all';
    var list = D.cards.filter(function (c) { return ch === 'all' || c.c === ch; });
    if (dueOnly) {
      var now = dayStart();
      list = list.filter(function (c) {
        var it = S.cards[c.id];
        return !it || (it.due || 0) <= now || it.status === 'again' || it.status === 'fuzzy';
      });
      if (!list.length) list = D.cards.filter(function (c) { return ch === 'all' || c.c === ch; });
    }
    if (S.pref.shuffle) {
      list = list.slice();
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
    }
    return list;
  }

  R.cards = function (parts) {
    var dueOnly = /due=1/.test(location.hash);
    if (!state.cardList || state._cardKey !== (S.pref.cardCh + '|' + S.pref.shuffle + '|' + dueOnly)) {
      state.cardList = cardPool(dueOnly);
      state.cardI = 0;
      state.cardFlipped = false;
      state._cardKey = S.pref.cardCh + '|' + S.pref.shuffle + '|' + dueOnly;
    }
    var list = state.cardList;
    if (!list.length) {
      view.innerHTML = topBar('背诵卡') + '<div class="empty"><b>暂无卡片</b>换个章节试试</div>';
      renderCardChips();
      return;
    }
    if (state.cardI >= list.length) state.cardI = 0;
    var c = list[state.cardI];
    var st = S.cards[c.id] || {};
    var chips = chChips('cardCh', function () { state.cardList = null; R.cards(); });

    view.innerHTML = topBar('背诵卡', (dueOnly ? '今日队列 · ' : '') + (state.cardI + 1) + '/' + list.length,
      '<button class="iconbtn' + (S.pref.shuffle ? ' on' : '') + '" id="btnShuffle" title="洗牌">' + ico('shuffle') + '</button>') +
      '<div class="chips" id="chChips"></div>' +
      '<div class="prog">章节筛选 · ' + esc(chLabel(S.pref.cardCh)) + (st.status ? ' · 上次：' + ({ know: '会', fuzzy: '模糊', again: '不会', new: '新' }[st.status] || st.status) : '') + '</div>' +
      '<div class="flip-wrap"><div class="flip' + (state.cardFlipped ? ' back' : '') + '" id="flip">' +
      '<div class="tag">' + esc(shortCh(c.c)) + '</div>' +
      '<div class="side">' + (state.cardFlipped ? '背面 · 再点收回' : '正面 · 点按翻转') + '</div>' +
      (state.cardFlipped
        ? '<div class="a">' + esc(c.b) + '</div>'
        : '<div class="q">' + esc(c.f) + '</div><div class="hint">想不起来就翻面</div>') +
      '</div></div>' +
      (state.cardFlipped
        ? '<div class="grade">' +
          '<button class="btn bad" data-g="again">不会<small>再来</small></button>' +
          '<button class="btn fuzzy" data-g="fuzzy">模糊<small>明天</small></button>' +
          '<button class="btn ok" data-g="know">会了<small>推后</small></button>' +
          '</div>'
        : '<div class="row mt"><button class="btn ghost" id="prev">上一张</button><button class="btn soft" id="flipBtn">翻转</button><button class="btn ghost" id="next">下一张</button></div>') +
      '<div class="row mt"><button class="btn ghost block" id="resetQueue">重新洗入队列</button></div>';

    document.getElementById('chChips').innerHTML = chips;
    bindChChips('cardCh', function () { state.cardList = null; route(); });

    var flip = function () { state.cardFlipped = !state.cardFlipped; R.cards(); };
    document.getElementById('flip').onclick = flip;
    var fb = document.getElementById('flipBtn'); if (fb) fb.onclick = flip;
    var prev = document.getElementById('prev');
    if (prev) prev.onclick = function () { state.cardI = (state.cardI - 1 + list.length) % list.length; state.cardFlipped = false; R.cards(); };
    var next = document.getElementById('next');
    if (next) next.onclick = function () { state.cardI = (state.cardI + 1) % list.length; state.cardFlipped = false; R.cards(); };
    document.getElementById('btnShuffle').onclick = function () {
      S.pref.shuffle = !S.pref.shuffle; save(); state.cardList = null; toast(S.pref.shuffle ? '已开启洗牌' : '已关闭洗牌'); route();
    };
    document.getElementById('resetQueue').onclick = function () { state.cardList = null; state.cardI = 0; state.cardFlipped = false; toast('队列已刷新'); route(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-g]'), function (btn) {
      btn.onclick = function () {
        gradeItem(S.cards, c.id, btn.getAttribute('data-g'));
        state.cardFlipped = false;
        state.cardI++;
        if (state.cardI >= list.length) {
          toast('本轮完成');
          state.cardList = null;
          location.hash = '#/today';
          return;
        }
        R.cards();
      };
    });
  };

  function chChips(prefKey) {
    var ids = ['all'].concat((D.chs || []).map(function (c) { return c.id; }));
    return ids.map(function (id) {
      var on = (S.pref[prefKey] || 'all') === id ? ' on' : '';
      var label = id === 'all' ? '全部' : shortCh(id);
      return '<button class="chip' + on + '" data-ch="' + id + '">' + esc(label) + '</button>';
    }).join('');
  }
  function bindChChips(prefKey, cb) {
    Array.prototype.forEach.call(document.querySelectorAll('#chChips [data-ch]'), function (el) {
      el.onclick = function () {
        S.pref[prefKey] = el.getAttribute('data-ch');
        save();
        cb && cb();
      };
    });
  }
  function renderCardChips() { /* placeholder */ }

  // ---------- Timeline ----------
  function tlFlat(group) {
    var out = [];
    D.timeline.forEach(function (g, gi) {
      if (group && group !== 'all' && g.g !== group) return;
      g.items.forEach(function (it, j) {
        out.push({ gi: gi, j: j, g: g.g, date: it[0], event: it[1], key: gi + '_' + j });
      });
    });
    return out;
  }

  R.timeline = function () {
    var mode = S.pref.tlMode || 'hideDate'; // hideDate | hideEvent | browse
    var group = S.pref.tlGroup || 'all';
    if (!state.tlList || state._tlKey !== (mode + '|' + group)) {
      state.tlList = tlFlat(group);
      state.tlI = 0;
      state.tlRevealed = false;
      state._tlKey = mode + '|' + group;
    }
    var list = state.tlList;
    var groups = D.timeline.map(function (g) { return g.g; });

    var groupChips = '<button class="chip' + (group === 'all' ? ' on' : '') + '" data-tg="all">全部</button>' +
      groups.map(function (g) {
        return '<button class="chip' + (group === g ? ' on' : '') + '" data-tg="' + esc(g) + '">' + esc(g) + '</button>';
      }).join('');

    var modeBar = '<div class="tl-mode">' +
      '<button class="chip' + (mode === 'hideDate' ? ' on' : '') + '" data-tm="hideDate">默写日期</button>' +
      '<button class="chip' + (mode === 'hideEvent' ? ' on' : '') + '" data-tm="hideEvent">默写事件</button>' +
      '<button class="chip' + (mode === 'browse' ? ' on' : '') + '" data-tm="browse">总览</button>' +
      '</div>';

    if (mode === 'browse') {
      var html = D.timeline.filter(function (g) { return group === 'all' || g.g === group; }).map(function (g) {
        return '<div class="tl-g">' + esc(g.g) + '</div>' + g.items.map(function (it) {
          return '<div class="tl-i"><div class="d">' + esc(it[0]) + '</div><div class="e">' + esc(it[1]) + '</div></div>';
        }).join('');
      }).join('');
      view.innerHTML = topBar('时间轴', '课本时间整理 · ' + list.length + ' 点') + modeBar +
        '<div class="chips" id="tgChips">' + groupChips + '</div>' + html;
    } else {
      if (!list.length) {
        view.innerHTML = topBar('时间轴') + modeBar + '<div class="empty"><b>无条目</b></div>';
      } else {
        if (state.tlI >= list.length) state.tlI = 0;
        var it = list[state.tlI];
        var prompt = mode === 'hideDate' ? it.event : it.date;
        var answer = mode === 'hideDate' ? it.date : it.event;
        var ask = mode === 'hideDate' ? '这件事发生在？' : '这一天发生了？';
        view.innerHTML = topBar('时间轴默写', (state.tlI + 1) + '/' + list.length + ' · ' + it.g) + modeBar +
          '<div class="chips" id="tgChips">' + groupChips + '</div>' +
          '<div class="tl-card">' +
          '<div class="small">' + esc(ask) + '</div>' +
          '<div class="prompt">' + esc(prompt) + '</div>' +
          (state.tlRevealed
            ? '<div class="ans">' + esc(answer) + '</div><div id="checkMsg"></div>'
            : '<input id="tlInput" placeholder="输入后核对，或点揭示" autocomplete="off" autocapitalize="off">') +
          '</div>' +
          '<div class="row">' +
          '<button class="btn ghost" id="tlPrev">上一条</button>' +
          (state.tlRevealed
            ? '<button class="btn soft" id="tlNext">下一条</button>'
            : '<button class="btn" id="tlReveal">揭示</button><button class="btn soft" id="tlCheck">核对</button>') +
          '</div>' +
          (state.tlRevealed ? '<div class="grade mt"><button class="btn bad" data-tg2="again">不会</button><button class="btn fuzzy" data-tg2="fuzzy">模糊</button><button class="btn ok" data-tg2="know">会了</button></div>' : '');
      }
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-tm]'), function (el) {
      el.onclick = function () { S.pref.tlMode = el.getAttribute('data-tm'); save(); state.tlList = null; route(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tgChips [data-tg]'), function (el) {
      el.onclick = function () { S.pref.tlGroup = el.getAttribute('data-tg'); save(); state.tlList = null; route(); };
    });

    var tlPrev = document.getElementById('tlPrev');
    if (tlPrev) tlPrev.onclick = function () { state.tlI = (state.tlI - 1 + list.length) % list.length; state.tlRevealed = false; R.timeline(); };
    var tlNext = document.getElementById('tlNext');
    if (tlNext) tlNext.onclick = function () { state.tlI = (state.tlI + 1) % list.length; state.tlRevealed = false; R.timeline(); };
    var tlReveal = document.getElementById('tlReveal');
    if (tlReveal) tlReveal.onclick = function () { state.tlRevealed = true; R.timeline(); };
    var tlCheck = document.getElementById('tlCheck');
    if (tlCheck) tlCheck.onclick = function () {
      var inp = document.getElementById('tlInput');
      var val = (inp && inp.value || '').trim();
      state.tlRevealed = true;
      R.timeline();
      var msg = document.getElementById('checkMsg');
      if (!msg) return;
      var it2 = list[state.tlI];
      var ans = (S.pref.tlMode === 'hideDate' ? it2.date : it2.event);
      var ok = val && (ans.indexOf(val) >= 0 || val.indexOf(ans) >= 0 || norm(val) === norm(ans));
      msg.innerHTML = ok ? '<div class="okmsg">接近正确 ✓</div>' : (val ? '<div class="badmsg">再对照一下</div>' : '');
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-tg2]'), function (btn) {
      btn.onclick = function () {
        var it3 = list[state.tlI];
        S.timeline[it3.key] = { status: btn.getAttribute('data-tg2'), t: Date.now() };
        save();
        state.tlRevealed = false;
        state.tlI++;
        if (state.tlI >= list.length) { toast('本组完成'); state.tlI = 0; }
        R.timeline();
      };
    });
    var inp = document.getElementById('tlInput');
    if (inp) { inp.focus(); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('tlCheck').click(); }); }
  };

  function norm(s) {
    return String(s).replace(/\s+/g, '').replace(/[年月日./-]/g, function (c) {
      return ({ '年': '', '月': '', '日': '', '.': '', '/': '', '-': '' })[c] || '';
    });
  }

  // ---------- Cloze ----------
  function clozePool(dueOnly) {
    var ch = S.pref.clozeCh || 'all';
    var list = D.clozes.filter(function (c) { return ch === 'all' || c.c === ch; });
    if (dueOnly) {
      var now = dayStart();
      var filtered = list.filter(function (c) {
        var it = S.cloze[c.id];
        return !it || (it.due || 0) <= now || it.status === 'again' || it.status === 'fuzzy';
      });
      if (filtered.length) list = filtered;
    }
    // Prefer ku first in initial order, then shuffle lightly within
    list = list.slice().sort(function (a, b) {
      var wa = a.kind === 'ku' ? 0 : a.kind === 'mix' ? 1 : 2;
      var wb = b.kind === 'ku' ? 0 : b.kind === 'mix' ? 1 : 2;
      return wa - wb;
    });
    if (S.pref.shuffle) {
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
    }
    return list;
  }

  R.cloze = function () {
    var dueOnly = /due=1/.test(location.hash);
    if (!state.clozeList || state._clozeKey !== (S.pref.clozeCh + '|' + S.pref.shuffle + '|' + dueOnly)) {
      state.clozeList = clozePool(dueOnly);
      state.clozeI = 0;
      state.clozeShow = false;
      state._clozeKey = S.pref.clozeCh + '|' + S.pref.shuffle + '|' + dueOnly;
    }
    var list = state.clozeList;
    if (!list.length) {
      view.innerHTML = topBar('挖空背诵') + '<div class="empty"><b>暂无挖空</b></div>';
      return;
    }
    if (state.clozeI >= list.length) state.clozeI = 0;
    var z = list[state.clozeI];
    var promptHtml = esc(z.p).replace(/【(\d+)】/g, function (_, n) {
      var ans = z.a[+n - 1] || '';
      if (state.clozeShow) return '<span class="blank on">' + esc(ans) + '</span>';
      return '<span class="blank">（' + n + '）</span>';
    });

    view.innerHTML = topBar('挖空背诵', (dueOnly ? '今日 · ' : '') + (state.clozeI + 1) + '/' + list.length,
      '<button class="iconbtn' + (S.pref.shuffle ? ' on' : '') + '" id="btnShuffle">' + ico('shuffle') + '</button>') +
      '<div class="chips" id="chChips"></div>' +
      '<div class="cloze-card" id="clozeCard">' +
      '<div class="meta">' + esc(shortCh(z.c)) + ' · ' + esc(z.sec) + ' · ' + ({ ku: '重点', kb: '加粗', mix: '综合' }[z.kind] || '') + '</div>' +
      '<div class="prompt">' + promptHtml + '</div>' +
      (state.clozeShow ? '<div class="full">' + esc(z.full) + '</div>' : '') +
      (!state.clozeShow ? '<div class="check"><input id="clozeInp" placeholder="可选：先默写再揭示" autocomplete="off"></div>' : '') +
      '</div>' +
      '<div class="row">' +
      '<button class="btn ghost" id="czPrev">上一条</button>' +
      (state.clozeShow
        ? '<button class="btn soft" id="czNext">下一条</button>'
        : '<button class="btn" id="czReveal">揭示答案</button>') +
      '</div>' +
      (state.clozeShow
        ? '<div class="grade mt"><button class="btn bad" data-g="again">不会</button><button class="btn fuzzy" data-g="fuzzy">模糊</button><button class="btn ok" data-g="know">会了</button></div>'
        : '') +
      '<div class="swipe-hint">提示：在卡片上左右滑可切换</div>';

    document.getElementById('chChips').innerHTML = chChips('clozeCh');
    bindChChips('clozeCh', function () { state.clozeList = null; route(); });

    document.getElementById('btnShuffle').onclick = function () {
      S.pref.shuffle = !S.pref.shuffle; save(); state.clozeList = null; toast(S.pref.shuffle ? '已洗牌' : '按重点优先'); route();
    };
    document.getElementById('czPrev').onclick = function () {
      state.clozeI = (state.clozeI - 1 + list.length) % list.length; state.clozeShow = false; R.cloze();
    };
    var next = document.getElementById('czNext');
    if (next) next.onclick = function () { state.clozeI = (state.clozeI + 1) % list.length; state.clozeShow = false; R.cloze(); };
    var rev = document.getElementById('czReveal');
    if (rev) rev.onclick = function () { state.clozeShow = true; R.cloze(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-g]'), function (btn) {
      btn.onclick = function () {
        gradeItem(S.cloze, z.id, btn.getAttribute('data-g'));
        state.clozeShow = false;
        state.clozeI++;
        if (state.clozeI >= list.length) { toast('本轮完成'); state.clozeList = null; location.hash = '#/today'; return; }
        R.cloze();
      };
    });

    // swipe
    var card = document.getElementById('clozeCard');
    var sx = 0, sy = 0;
    card.addEventListener('touchstart', function (e) { sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
    card.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) { state.clozeI = (state.clozeI + 1) % list.length; state.clozeShow = false; R.cloze(); }
      else { state.clozeI = (state.clozeI - 1 + list.length) % list.length; state.clozeShow = false; R.cloze(); }
    }, { passive: true });
  };

  // ---------- Outline ----------
  R.outline = function () {
    var openCh = S.pref.outlineCh;
    var html = topBar('章节提纲', '点开要点看全文 · 适合口头串讲');
    html += D.outlines.map(function (ch) {
      var open = openCh === ch.id;
      var pts = ch.sections.reduce(function (a, s) { return a + s.points.length; }, 0);
      var body = '';
      if (open) {
        body = ch.sections.map(function (sec) {
          return '<div class="ol-sec"><div class="st">' + esc(sec.title) + '</div>' +
            sec.points.map(function (p, i) {
              return '<button class="ol-p k-' + esc(p.k) + '" data-ol="' + esc(ch.id) + '_' + esc(sec.title) + '_' + i + '">' +
                '<span class="lab">' + esc(p.t) + '</span>' +
                '<span class="full">' + esc(p.full) + '</span></button>';
            }).join('') + '</div>';
        }).join('');
      }
      return '<div class="ol-ch' + (open ? ' open' : '') + '">' +
        '<button data-och="' + esc(ch.id) + '"><span>' + esc(ch.title) + '</span><span class="small" style="font-weight:500;color:var(--muted)">' + pts + ' 点</span><span class="arr">›</span></button>' +
        body + '</div>';
    }).join('');
    view.innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('[data-och]'), function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-och');
        S.pref.outlineCh = S.pref.outlineCh === id ? null : id;
        save(); R.outline();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ol-p'), function (btn) {
      btn.onclick = function () { btn.classList.toggle('open'); };
    });
  };

  // ---------- Settings ----------
  R.settings = function () {
    view.innerHTML = topBar('设置与进度') +
      '<div class="card"><h3>主题</h3><div class="row">' +
      '<button class="btn ghost" data-th="auto">跟随系统</button>' +
      '<button class="btn ghost" data-th="light">浅色</button>' +
      '<button class="btn ghost" data-th="dark">深色</button></div></div>' +
      '<div class="card"><h3>数据</h3><p class="small">进度仅存本机浏览器 localStorage。换机或清缓存会丢失。</p>' +
      '<div class="row"><button class="btn ghost" id="exp">导出进度</button><button class="btn ghost" id="imp">导入进度</button></div>' +
      '<div class="row mt"><button class="btn bad" id="reset">清空全部进度</button></div></div>' +
      '<div class="card"><h3>内容量</h3><p class="small">背诵卡 ' + D.cards.length + ' · 挖空 ' + D.clozes.length +
      ' · 时间点 ' + D.timeline.reduce(function (a, g) { return a + g.items.length; }, 0) +
      ' · 提纲要点 ' + D.outlines.reduce(function (a, c) { return a + c.sections.reduce(function (b, s) { return b + s.points.length; }, 0); }, 0) +
      '</p><p class="small">考试日：' + esc(D.meta.exam || '') + ' · 构建 ' + esc(D.meta.built || '') + '</p></div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-th]'), function (b) {
      b.onclick = function () { S.theme = b.getAttribute('data-th'); save(); applyTheme(); toast('已切换'); route(); };
    });
    document.getElementById('exp').onclick = function () {
      var ta = document.createElement('textarea');
      ta.value = JSON.stringify(S);
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { prompt('复制以下内容', ta.value); }
      document.body.removeChild(ta);
    };
    document.getElementById('imp').onclick = function () {
      var t = prompt('粘贴之前导出的进度 JSON：');
      if (!t) return;
      try {
        var d = JSON.parse(t);
        if (typeof d !== 'object' || !d.cards) throw 0;
        localStorage.setItem(KEY, JSON.stringify(d));
        S = load(); applyTheme(); toast('导入成功'); route();
      } catch (e) { toast('格式不正确'); }
    };
    document.getElementById('reset').onclick = function () {
      if (confirm('确定清空所有背诵进度？不可恢复。')) {
        localStorage.removeItem(KEY);
        S = load();
        state = { cardI: 0, cardList: null, cardFlipped: false, tlI: 0, tlList: null, tlRevealed: false, clozeI: 0, clozeList: null, clozeShow: false };
        toast('已清空'); route();
      }
    };
  };

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/today';
  else route();
})();
