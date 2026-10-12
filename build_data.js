#!/usr/bin/env node
/** Build memorization data.js from junli-kaoshi/data.js */
const fs = require('fs');
const SRC = process.argv[2] || '/workspace/junli-kaoshi/data.js';
const OUT = process.argv[3] || __dirname + '/data.js';
const src = fs.readFileSync(SRC, 'utf8');
const DATA = Function('return (' + src.replace(/^window\.DATA=/, '').replace(/;?\s*$/, '') + ')')();

function strip(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function blankHtml(html, re) {
  const answers = [];
  let n = 0;
  const promptHtml = html.replace(re, (match, inner) => {
    const t = strip(inner);
    if (!t || t.length < 2) return match;
    answers.push(t);
    n++;
    return `【${n}】`;
  });
  if (!answers.length) return null;
  let prompt = strip(promptHtml.replace(/【(\d+)】/g, '§§$1§§')).replace(/§§(\d+)§§/g, '【$1】');
  // Pure-blank prompts (whole sentence marked): add scaffolding
  if (/^(【\d+】\s*)+$/.test(prompt)) {
    prompt = '默写完整表述：' + prompt;
  }
  return { prompt, answers };
}

const clozes = [];
const seen = new Set();
let cid = 1;

function add(ch, sec, kind, prompt, answers, full) {
  if (!answers || !answers.length || !prompt) return;
  if (full.length > 360) return;
  if (answers.join('').length < 2) return;
  if (!/【\d+】/.test(prompt)) return;
  const key = ch + '|' + prompt + '|' + answers.join('|');
  if (seen.has(key)) return;
  seen.add(key);
  clozes.push({ id: 'z' + cid++, c: ch, sec, kind, p: prompt, a: answers, full });
}

for (const ch of DATA.chapters) {
  for (const sec of ch.sections) {
    for (const b of sec.blocks || []) {
      if (!b.h || (b.t !== 'p' && b.t !== 'li')) continue;
      const full = strip(b.h);
      if (full.length < 6) continue;
      const hasKu = /class="ku"/.test(b.h);
      const hasKb = /class="kb"/.test(b.h);
      if (!hasKu && !hasKb) continue;

      if (hasKu) {
        const r = blankHtml(b.h, /<b class="ku">([\s\S]*?)<\/b>/g);
        if (r) add(ch.id, sec.title, 'ku', r.prompt, r.answers, full);
      } else {
        const r = blankHtml(b.h, /<b class="kb">([\s\S]*?)<\/b>/g);
        if (r) add(ch.id, sec.title, 'kb', r.prompt, r.answers, full);
      }

      if (hasKu && hasKb) {
        const r = blankHtml(b.h, /<b class="k[ub]">([\s\S]*?)<\/b>/g);
        if (r && r.answers.length >= 2) add(ch.id, sec.title, 'mix', r.prompt, r.answers, full);
      }
    }
  }
}

const outlines = DATA.chapters.map(ch => {
  const sections = ch.sections.map(sec => {
    const points = [];
    let currentH3 = null;
    for (const b of sec.blocks || []) {
      if (b.t === 'h3') {
        currentH3 = strip(b.h);
        points.push({ t: currentH3, k: 'h', full: currentH3 });
        continue;
      }
      if (!b.h) continue;
      const hasMark = /class="k[ub]"/.test(b.h);
      if (!hasMark && (b.k || 0) < 1) continue;
      const full = strip(b.h);
      if (!full || full.length < 4) continue;
      let short = full;
      if (full.length > 36) {
        const m = b.h.match(/<b class="k[ub]">([\s\S]*?)<\/b>/);
        if (m) {
          const s = strip(m[1]);
          short = (s.length >= 2 && s.length <= 40) ? s : full.slice(0, 34) + '…';
        } else short = full.slice(0, 34) + '…';
      }
      if (currentH3 && short === currentH3) continue;
      points.push({ t: short, k: /class="ku"/.test(b.h) ? 'u' : (hasMark ? 'b' : 'n'), full });
    }
    return { title: sec.title, points: points.slice(0, 48) };
  }).filter(s => s.points.length);
  return { id: ch.id, title: ch.title, sections };
});

const out = {
  meta: {
    title: '军理背诵',
    exam: '2026-10-17',
    built: new Date().toISOString().slice(0, 10),
    notes: DATA.notes
  },
  chs: DATA.chs,
  chapters: DATA.chapters,
  cards: DATA.cards,
  timeline: DATA.timeline,
  clozes,
  outlines
};

fs.writeFileSync(OUT, 'window.DATA=' + JSON.stringify(out) + ';');
console.log(JSON.stringify({
  cards: out.cards.length,
  timelineGroups: out.timeline.length,
  timelineItems: out.timeline.reduce((a, g) => a + g.items.length, 0),
  clozes: out.clozes.length,
  byKind: out.clozes.reduce((a, c) => { a[c.kind] = (a[c.kind] || 0) + 1; return a; }, {}),
  outlinePoints: out.outlines.reduce((a, c) => a + c.sections.reduce((b, s) => b + s.points.length, 0), 0),
  bytes: fs.statSync(OUT).size
}, null, 2));
