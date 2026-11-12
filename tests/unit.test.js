// Unit testovi: čista logika bodovanja, poretka i unosa (izvučena iz index.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp } = require('./extract');
const FILE = process.env.APP_FILE || path.join(__dirname, '..', 'index.html');

function fresh(teams, results, cfg){
  const app = loadApp(FILE);
  const data = { config:{ numJumps:9, activeSeries:0, ...(cfg||{}) }, teams: teams||[], results: results||{}, rules:'' };
  // globalni `data` u vm kontekstu mora biti isti objekt koji mijenjamo
  app.ctx.data = data;
  require('vm').runInContext('var data = this.data;', app.ctx);
  return { ...app, data: app.ctx.data };
}
const plain = x => JSON.parse(JSON.stringify(x)); // vm objekti imaju drugi prototip pa ih normaliziramo prije usporedbe
const comp = (letter, ime, extra) => ({ letter, ime, alkarski:true, spol:'', ...(extra||{}) });
const row = (p, cm) => ({ points:p, cm, cmAuto: p<3 });
function mkTeam(number, names){ return { number, name:'Tim '+number, country:'HR', competitors:['A','B','C','D','E'].map((l,i)=>comp(l, names[i]||'')) }; }

test('isMissing: prazno ime i razmaci znače prazno mjesto', () => {
  const { api } = fresh();
  assert.equal(api.isMissing({ime:''}), true);
  assert.equal(api.isMissing({ime:'   '}), true);
  assert.equal(api.isMissing({ime:'Ana'}), false);
  assert.equal(api.isMissing(null), true);
});

test('competitorId i jumpLabels', () => {
  const { api } = fresh();
  assert.equal(api.competitorId(12,'C'), '12-C');
  assert.deepEqual(plain(api.jumpLabels(9)), ['I','II','III','IV','V','VI','VII','VIII','IX']);
  assert.deepEqual(plain(api.jumpLabels(3)), ['I','II','III']);
});

test('sanitizeEditionKey: sigurni ključevi dokumenata', () => {
  const { api } = fresh();
  assert.equal(api.sanitizeEditionKey('37.'), '37.');
  assert.equal(api.sanitizeEditionKey(' 37 / 2026 '), '37-2026');
  assert.equal(api.sanitizeEditionKey(''), 'default');
  assert.equal(api.sanitizeEditionKey('...'), 'default');
});

test('normalizeData dopunjuje nedostajuća polja', () => {
  const { api } = fresh();
  const d = api.normalizeData({});
  assert.equal(d.config.numJumps, 9);
  assert.equal(d.config.activeSeries, 0);
  for(const k of ['eventLocation','eventDate','eventContact','eventWeb','eventDirector','eventJudge']) assert.equal(d.config[k], '');
  assert.deepEqual(plain(d.teams), []);
  assert.deepEqual(plain(d.results), {});
});

test('ensureResultsForCompetitor: 0/1/2 boda → cm 16; prazno mjesto → 0 punata 16 cm', () => {
  const { api, data } = fresh([]);
  data.results['1-A'] = [{points:2, cm:5}, {points:3, cm:4}, {points:null, cm:null}];
  const arr = api.ensureResultsForCompetitor('1-A', false, 4);
  assert.equal(arr.length, 4);
  assert.deepEqual([arr[0].cm, arr[0].cmAuto], [16, true]);
  assert.deepEqual([arr[1].points, arr[1].cm], [3, 4]);
  assert.equal(arr[3].points, null);
  const miss = api.ensureResultsForCompetitor('1-D', true, 3);
  assert.deepEqual(plain(miss.map(r=>[r.points,r.cm])), [[0,16],[0,16],[0,16]]);
});

test('ensureResultsForCompetitor skraćuje kad se smanji broj serija', () => {
  const { api, data } = fresh([]);
  data.results['1-A'] = Array.from({length:9}, ()=>row(3,1));
  assert.equal(api.ensureResultsForCompetitor('1-A', false, 5).length, 5);
});

// ---------- poredak ----------
const S = (pts, cms) => ({ totalPoints: pts.reduce((a,b)=>a+b,0), totalCm: cms.reduce((a,b)=>a+b,0), pointsValues: pts, cmValues: cms });

test('compareStandings: više punata je bolje (prvo punti, pa cm)', () => {
  const { api } = fresh();
  const a = S([3,3,3],[10,10,10]);          // 9 p, 30 cm
  const b = S([3,3,2],[0,0,16]);            // 8 p, 16 cm
  assert.ok(api.compareStandings(a,b) < 0, 'A ispred B iako ima više cm');
});

test('compareStandings: isti punti → manje cm je bolje', () => {
  const { api } = fresh();
  assert.ok(api.compareStandings(S([3,3],[4,4]), S([3,3],[3,6])) < 0);
});

test('compareStandings: isti zbroj → countback po najmanjim cm (niz pogodaka)', () => {
  const { api } = fresh();
  const a = S([3,3,3],[0,6,6]);  // 12 cm, najbolji skok 0
  const b = S([3,3,3],[4,4,4]);  // 12 cm
  assert.ok(api.compareStandings(a,b) < 0);
});

test('compareStandings: potpuno jednaki → 0', () => {
  const { api } = fresh();
  assert.equal(api.compareStandings(S([3,2],[4,16]), S([2,3],[16,4])), 0);
});

test('rankList: isti rezultat dijeli mjesto, sljedeće preskače; nepočeli idu posebno', () => {
  const { api } = fresh();
  const mk = (id, pts, cms, entered) => ({ id, ...S(pts,cms), jumpsEntered:entered, missing:false });
  const list = [ mk('a',[3,3],[1,1],2), mk('b',[3,3],[1,1],2), mk('c',[3,2],[1,16],2), mk('d',[0],[16],0) ];
  const { ranked, notStarted } = api.rankList(list);
  assert.deepEqual(plain(ranked.map(r=>[r.id,r.place])), [['a',1],['b',1],['c',3]]);
  assert.deepEqual(plain(notStarted.map(r=>r.id)), ['d']);
});

// ---------- zbrajanje ----------
test('pojedinačno: neskočene serije računaju se kao 0 punata i 16 cm', () => {
  const t = mkTeam(1, ['Ana','','','','']);
  const { api, data } = fresh([t], { '1-A':[row(3,2), row(3,0), ...Array.from({length:7}, ()=>({points:null,cm:null,cmAuto:false}))] });
  const list = api.buildGroupIndividualStandings(0, 8, false, null);
  const ana = list.find(x=>x.letter==='A');
  assert.equal(ana.jumpsEntered, 2);
  assert.equal(ana.totalPoints, 6);
  assert.equal(ana.totalCm, 2 + 0 + 7*16);
});

test('pojedinačno: filtar spola i Bara/Čoja/Alka oznaka', () => {
  const t = mkTeam(1, ['Ana','Ivo','Mia','','']);
  t.competitors[0].spol='Ž'; t.competitors[1].spol='M'; t.competitors[2].spol='Ž'; t.competitors[2].alkarski=false;
  const { api } = fresh([t], {});
  assert.deepEqual(plain(api.buildGroupIndividualStandings(0,8,false,'Ž').map(x=>x.letter)), ['A','C']);
  assert.deepEqual(plain(api.buildGroupIndividualStandings(0,8,false,'M').map(x=>x.letter)), ['B']);
  const sub = api.buildGroupIndividualStandings(0,2,true,null).map(x=>x.letter);
  assert.ok(!sub.includes('C'), 'izvan Bara/Čoja/Alka ne ulazi u podkolo');
  assert.ok(api.buildGroupIndividualStandings(0,8,false,null).some(x=>x.letter==='C'), 'ali ulazi u Ukupno');
});

test('ekipno: zbroj 5 natjecatelja, prazna mjesta i neskočene serije = 0/16', () => {
  const t = mkTeam(2, ['A1','B1','C1','','']);
  const results = {};
  ['A','B','C'].forEach(l=> results['2-'+l] = Array.from({length:9}, ()=>row(3,1)));
  const { api } = fresh([t], results);
  const [team] = api.buildGroupTeamStandings(0, 8, false);
  // 3 natjecatelja × 9 × 3 p = 81; 2 prazna × 9 × 0 = 0
  assert.equal(team.totalPoints, 81);
  assert.equal(team.totalCm, 3*9*1 + 2*9*16);
  assert.equal(team.series.length, 9);
  assert.equal(team.series[0].p, 9);
  assert.equal(team.members.length, 5);
});

test('ekipno: ekipa bez ijednog podobnog natjecatelja u podkolu ne ulazi', () => {
  const t = mkTeam(3, ['A1','','','','']); t.competitors.forEach(c=>c.alkarski = false);
  const { api } = fresh([t], {});
  assert.equal(api.buildGroupTeamStandings(0,2,true).length, 0);
  assert.equal(api.buildGroupTeamStandings(0,8,false).length, 1);
});

// ---------- serije i napredak ----------
function filled(letters, team, seriesCount, rowFn){
  const res = {};
  letters.forEach(l=> res[team+'-'+l] = Array.from({length:9}, (_,i)=> i<seriesCount ? rowFn(i) : {points:null,cm:null,cmAuto:false}));
  return res;
}

test('getSeriesInfo: automatski određuje aktivnu seriju', () => {
  const t = mkTeam(1, ['A1','B1','','','']);
  let { api } = fresh([t], {});
  assert.equal(api.getSeriesInfo().started, false);
  ({ api } = fresh([t], filled(['A','B'],1,3,()=>row(3,1))));
  let si = api.getSeriesInfo();
  assert.equal(si.idx, 3, 'serije 1–3 gotove → aktivna je IV');
  assert.equal(si.label, 'IV');
  assert.equal(si.finished, false);
  ({ api } = fresh([t], filled(['A','B'],1,9,()=>row(3,1))));
  si = api.getSeriesInfo();
  assert.equal(si.idx, 8); assert.equal(si.finished, true);
});

test('getSeriesInfo: ručna serija nadjačava automatiku', () => {
  const t = mkTeam(1, ['A1','','','','']);
  const { api } = fresh([t], filled(['A'],1,9,()=>row(3,1)), { activeSeries: 2 });
  const si = api.getSeriesInfo();
  assert.equal(si.idx, 1); assert.equal(si.finished, false);
});

test('teamSeriesProgress / firstOpenSeries / teamStatus', () => {
  const t = mkTeam(4, ['A1','B1','C1','','']);
  const { api } = fresh([t], filled(['A','B','C'],4,5,()=>row(3,1)));
  const p = api.teamSeriesProgress(t);
  assert.equal(p.need, 3); assert.equal(p.doneCount, 5);
  assert.equal(api.firstOpenSeries(t), 5);
  assert.deepEqual(JSON.parse(JSON.stringify(api.teamStatus(t))), { txt:'5/9 serija', ok:false });
});

test('teamStatus: gotovo kad je svih 9; ekipa bez natjecatelja', () => {
  const t = mkTeam(1, ['A1','','','','']);
  let { api } = fresh([t], filled(['A'],1,9,()=>row(3,1)));
  assert.equal(api.teamStatus(t).ok, true);
  assert.equal(api.firstOpenSeries(t), 8);
  const e = mkTeam(2, []);
  ({ api } = fresh([e], {}));
  assert.equal(api.teamStatus(e).txt, 'nema natjecatelja');
});

test('djelomična serija se ne računa kao gotova', () => {
  const t = mkTeam(1, ['A1','B1','','','']);
  const res = { '1-A':[row(3,1)], '1-B':[{points:null,cm:null,cmAuto:false}] };
  const { api } = fresh([t], res);
  const p = api.teamSeriesProgress(t);
  assert.equal(p.filled[0], 1); assert.equal(p.full[0], false);
});

// ---------- pravila unosa ----------
test('storeResult: 0, 1 i 2 boda automatski postavljaju cm na 16', () => {
  const { api, data } = fresh([]);
  for(const p of [0,1,2]){
    const r = api.storeResult('1-A', 0, 'points', p);
    assert.deepEqual([r.points, r.cm, r.cmAuto], [p, 16, true]);
  }
});

test('storeResult: 3 boda ostavlja cm prazan dok se ne upiše; prelazak 2→3 briše automatski cm', () => {
  const { api } = fresh([]);
  api.storeResult('1-A', 0, 'points', 2);
  const r = api.storeResult('1-A', 0, 'points', 3);
  assert.deepEqual([r.points, r.cm, r.cmAuto], [3, null, false]);
  api.storeResult('1-A', 0, 'cm', 5);
  assert.equal(r.cm, 5);
});

test('storeResult: ručno upisani cm ostaje kad se bodovi promijene s 3 na 3', () => {
  const { api } = fresh([]);
  api.storeResult('1-A', 1, 'points', 3);
  api.storeResult('1-A', 1, 'cm', 7);
  const r = api.storeResult('1-A', 1, 'points', 3);
  assert.equal(r.cm, 7);
});

test('storeResult: vrijednosti izvan raspona se ispravljaju', () => {
  const { api } = fresh([]);
  assert.equal(api.storeResult('1-A', 0, 'points', 7).points, 3);
  assert.equal(api.storeResult('1-A', 0, 'points', -2).points, 0);
  api.storeResult('1-A', 2, 'points', 3);
  assert.equal(api.storeResult('1-A', 2, 'cm', 99).cm, 16);
  assert.equal(api.storeResult('1-A', 2, 'cm', -4).cm, 0);
  assert.equal(api.storeResult('1-A', 2, 'cm', 4.6).cm, 5);
  assert.equal(api.storeResult('1-A', 2, 'cm', null).cm, null);
});

test('storeResult: pokreće spremanje', () => {
  const { api, ctx } = fresh([]);
  const before = ctx.saveCalls;
  api.storeResult('1-A', 0, 'points', 3);
  assert.equal(ctx.saveCalls, before + 1);
});

test('escapeHtml / escapeAttr štite od ubacivanja HTML-a', () => {
  const { api } = fresh();
  assert.equal(api.escapeHtml('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
  assert.equal(api.escapeAttr('a"b'), 'a&quot;b');
});

test('roundsAvailable samo za 9 serija; getRoundGroup granice', () => {
  let { api } = fresh([], {}, { numJumps:9 });
  assert.equal(api.roundsAvailable(), true);
  assert.deepEqual(plain([api.getRoundGroup('bara').startIdx, api.getRoundGroup('bara').endIdx]), [0,2]);
  assert.deepEqual(plain([api.getRoundGroup('coja').startIdx, api.getRoundGroup('coja').endIdx]), [3,5]);
  assert.deepEqual(plain([api.getRoundGroup('alka').startIdx, api.getRoundGroup('alka').endIdx]), [6,8]);
  ({ api } = fresh([], {}, { numJumps:5 }));
  assert.equal(api.roundsAvailable(), false);
  assert.equal(api.getRoundGroup('ukupno').endIdx, 4);
});
