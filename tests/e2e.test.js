// Testovi modula i sustava u pravom pregledniku (Playwright) s Firebase mockom u memoriji.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const MOCK = require('./mock');
const FILE = process.env.APP_FILE || path.join(__dirname, '..', 'index.html');
const URL = 'file://' + FILE;

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

// ---------- fixture ----------
const L = ['A','B','C','D','E'];
const rowOf = (p, cm) => ({ points:p, cm: p<3 ? 16 : cm, cmAuto: p<3 });
const blank = () => ({ points:null, cm:null, cmAuto:false });
function series(n, filledFn){ return Array.from({length:9}, (_, i) => i < n ? filledFn(i) : blank()); }
function fixture(){
  const comps = (names) => L.map((l,i)=>({ letter:l, ime:names[i]||'', alkarski:true, spol:'' }));
  const teams = [
    { number:1, name:'Alfa', country:'HR', competitors: comps(['Ana Anić','Boris Bać','Cvita Cvitić','Dino Dinić','']) },
    { number:2, name:'Beta', country:'BA', competitors: comps(['Eva Erić','Fran Franić','','','']) }
  ];
  teams[1].competitors[1].alkarski = false; // samo Kup
  const results = {
    '1-A': series(9, ()=>rowOf(3,0)),                                  // 27 p, 0 cm
    '1-B': series(9, ()=>rowOf(3,1)),                                  // 27 p, 9 cm
    '1-C': series(9, i=> i===8 ? rowOf(2,16) : rowOf(3,1)),            // 26 p, 8+16=24 cm
    '1-D': series(9, i=> i===8 ? rowOf(2,16) : rowOf(3,0)),            // 26 p, 16 cm
    '2-A': series(5, ()=>rowOf(3,2)),                                  // 15 p, 10 cm (+4 neskočene = 64 cm)
    '2-B': series(3, ()=>rowOf(3,2))
  };
  return { config:{ numJumps:9, eventName:'Alkarski Padobranski Kup', eventEdition:'37.', eventLocation:'Aerodrom Sinj', eventDate:'22.–23.8.2026.',
                   eventDirector:'Ivo Direktor', eventJudge:'Jure Sudac', eventContact:'info@example.hr', eventWeb:'example.hr', activeSeries:0 },
           teams, results, rules:'Pravila testa' };
}

async function open(o = {}) {
  const { w = 1280, h = 900, user = 'admin', query = '', seed = fixture(), touch = false, fail = false, dialogs = [] } = o;
  const ctx = await browser.newContext({ viewport:{ width:w, height:h }, isMobile: touch && w < 800, hasTouch: touch });
  const page = await ctx.newPage();
  const errors = [], dialogLog = [];
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  page.on('console', m => { if(m.type()==='error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0,200)); });
  page.on('dialog', async d => { dialogLog.push({ type:d.type(), msg:d.message() }); const a = dialogs.shift(); if(a === false) await d.dismiss(); else await d.accept(); });
  await page.route(/firebase.*\.js/, r => r.fulfill({ body:'', contentType:'text/javascript' }));
  await page.route(/fonts\.g/, r => r.abort());
  await page.addInitScript(`window.__PARAMS={user:${JSON.stringify(user)},failLoad:${fail}}`);
  await page.addInitScript(MOCK);
  if(seed) await page.addInitScript(`window.__SEED=${JSON.stringify(seed)};const iv=setInterval(()=>{if(window.__store){window.__store.docs['natjecanja/37.']=window.__SEED;clearInterval(iv)}},0);`);
  await page.goto(URL + query);
  await page.waitForTimeout(900);
  return { page, ctx, errors, dialogLog };
}
const tab = async (page, name) => { await page.click(`.tab-btn[data-tab="${name}"]`); await page.waitForTimeout(250); };
const doc = (page, key='37.') => page.evaluate(k => JSON.parse(JSON.stringify(window.__store.docs['natjecanja/'+k])), key);
const settle = (page, ms=1400) => page.waitForTimeout(ms); // debounce spremanja (700 ms) + zapis
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// =====================================================================
// SUSTAV: prijava, zaključavanje, javni prikaz
// =====================================================================
test('sustav: administrator vidi i može uređivati sve', async () => {
  const { page, ctx, errors } = await open({ user:'admin' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('locked')), false);
  assert.match(await page.textContent('#authBarText'), /administrator/i);
  const tabs = await page.$$eval('.tab-btn', bs => bs.filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.tab));
  assert.deepEqual(tabs, ['ekipe','rezultati','rang','pravila','ispis','arhiva']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('sustav: prijavljen račun koji nije administrator je zaključan', async () => {
  const { page, ctx } = await open({ user:'other' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('locked')), true);
  assert.equal(await page.isVisible('#lockedCard'), true);
  assert.equal(await page.isVisible('#tab-ekipe'), false);
  await ctx.close();
});

test('sustav: odjavljen korisnik je zaključan, prijava otključava', async () => {
  const { page, ctx } = await open({ user:'none' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('locked')), true);
  assert.match(await page.textContent('#authBtn'), /Prijava/);
  await page.click('#authBtn'); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.body.classList.contains('locked')), false);
  assert.equal(await page.isVisible('#tab-ekipe'), true);
  await ctx.close();
});

for (const q of ['?rezultati', '?public=1']) {
  test(`sustav: javni prikaz (${q}) je samo za čitanje`, async () => {
    const { page, ctx, errors } = await open({ user:'none', query:q });
    const tabs = await page.$$eval('.tab-btn', bs => bs.filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.tab));
    assert.deepEqual(tabs, ['rang','pravila','info']);
    assert.equal(await page.isVisible('#publicLinkCard'), false);
    assert.equal(await page.isVisible('#lockedCard'), false);
    assert.match(await page.textContent('#headerSub'), /uživo/);
    assert.equal(await page.isVisible('#tab-rang'), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('sustav: javni prikaz ne sadrži polja za uređivanje', async () => {
  const { page, ctx } = await open({ user:'none', query:'?rezultati' });
  const editable = await page.$$eval('.tab-content.active input:not([readonly]):not([type=hidden]):not([disabled]), .tab-content.active textarea', els => els.filter(e => e.offsetParent !== null).length);
  assert.equal(editable, 0);
  await ctx.close();
});

test('sustav: javni info prikaz pokazuje direktora, suca, kontakt i web', async () => {
  const { page, ctx } = await open({ user:'none', query:'?rezultati' });
  await tab(page, 'info');
  const t = await page.textContent('#tab-info');
  for (const s of ['Ivo Direktor','Jure Sudac','info@example.hr','example.hr','Aerodrom Sinj','22.–23.8.2026.']) assert.ok(t.includes(s), 'nedostaje: '+s);
  await ctx.close();
});

test('sustav: neuspjelo učitavanje baze ne ruši aplikaciju', async () => {
  const { page, ctx, errors } = await open({ fail:true });
  assert.ok(await page.isVisible('#syncPill'));
  assert.deepEqual(errors.filter(e => /PAGEERR/.test(e)), []);
  await ctx.close();
});

// =====================================================================
// MODUL: Ekipe i postavke
// =====================================================================
async function fillTeam(page, { number, name, country='HR', names=[] }) {
  if (number !== undefined) await page.fill('#teamNumber', String(number));
  await page.fill('#teamName', name);
  await page.fill('#teamCountry', country);
  for (let i = 0; i < names.length; i++) await page.fill(`.member-input[data-letter="${L[i]}"]`, names[i]);
}

test('ekipe: nova ekipa se sprema u bazu i prikazuje u popisu s brojačem', async () => {
  const { page, ctx, errors } = await open();
  await fillTeam(page, { number:3, name:'Gama', names:['Gabi Gal','Hrvoje H'] });
  await page.click('#saveTeamBtn'); await settle(page);
  const d = await doc(page);
  const t = d.teams.find(x => x.number === 3);
  assert.ok(t, 'ekipa spremljena u bazu');
  assert.equal(t.name, 'Gama');
  assert.equal(t.competitors.length, 5);
  assert.equal(t.competitors[0].ime, 'Gabi Gal');
  assert.match(await page.textContent('#teamsCount'), /3 ekipe · 8 natjecatelja/);
  assert.ok(Array.isArray(d.results['3-A']) && d.results['3-A'].length === 9, 'rezultati ekipe inicijalizirani');
  assert.deepEqual(d.results['3-E'].map(r => [r.points, r.cm]), Array(9).fill([0,16]), 'prazno mjesto = 0/16');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ekipe: validacija (naziv, broj, natjecatelj, duplikat)', async () => {
  const { page, ctx, dialogLog } = await open();
  await page.fill('#teamName', ''); await page.click('#saveTeamBtn');
  assert.match(dialogLog.at(-1).msg, /naziv ekipe/i);
  await fillTeam(page, { name:'X' }); await page.click('#saveTeamBtn');
  assert.match(dialogLog.at(-1).msg, /barem jednog/i);
  await fillTeam(page, { number:1, name:'Dupla', names:['Neko Netko'] }); await page.click('#saveTeamBtn');
  assert.match(dialogLog.at(-1).msg, /već postoji/i);
  await page.fill('#teamNumber', '0'); await page.click('#saveTeamBtn');
  assert.match(dialogLog.at(-1).msg, /ispravan broj/i);
  assert.equal((await doc(page)).teams.length, 2);
  await ctx.close();
});

test('ekipe: uređivanje učitava podatke i sprema izmjene', async () => {
  const { page, ctx } = await open();
  await page.click('.team-card:first-child .edit-team');
  assert.match(await page.textContent('#teamSheetTitle'), /Uredi ekipu 1/);
  assert.equal(await page.inputValue('#teamName'), 'Alfa');
  assert.equal(await page.inputValue('.member-input[data-letter="B"]'), 'Boris Bać');
  await page.fill('#teamName', 'Alfa Nova'); await page.click('#saveTeamBtn'); await settle(page);
  assert.equal((await doc(page)).teams.find(t => t.number === 1).name, 'Alfa Nova');
  assert.match(await page.textContent('#teamSheetTitle'), /Nova ekipa/);
  await ctx.close();
});

test('ekipe: brisanje traži potvrdu i briše rezultate', async () => {
  let r = await open({ dialogs:[false] });
  await r.page.click('.team-card:nth-child(2) .delete-team'); await settle(r.page);
  assert.equal((await doc(r.page)).teams.length, 2, 'odbijena potvrda ne briše');
  await r.ctx.close();
  r = await open({ dialogs:[true] });
  await r.page.click('.team-card:nth-child(2) .delete-team'); await settle(r.page);
  const d = await doc(r.page);
  assert.equal(d.teams.length, 1);
  assert.ok(!d.results['2-A'], 'rezultati obrisane ekipe uklonjeni');
  assert.match(r.dialogLog[0].msg, /Beta/);
  await r.ctx.close();
});

test('ekipe: oznaka "samo Kup" prikazana za natjecatelja izvan Bara/Čoja/Alka', async () => {
  const { page, ctx } = await open();
  const t = await page.textContent('#teamsList');
  assert.ok(t.includes('samo Kup'));
  await ctx.close();
});

test('postavke: naziv i redni broj mijenjaju zaglavlje, sažetak i bazu', async () => {
  const { page, ctx } = await open({ w:1280 });
  await page.fill('#eventNameInput', 'Novi Kup');
  await settle(page);
  assert.match(await page.textContent('#headerTitle'), /Novi Kup/);
  assert.match(await page.textContent('#settingsSummary'), /Novi Kup/);
  assert.equal((await doc(page)).config.eventName, 'Novi Kup');
  await page.fill('#eventDirectorInput', 'Marko M');
  await settle(page);
  assert.equal((await doc(page)).config.eventDirector, 'Marko M');
  await ctx.close();
});

test('postavke: sklopive; zatvorene na mobitelu, otvorene na laptopu', async () => {
  let r = await open({ w:360, h:800, touch:true });
  assert.equal(await r.page.evaluate(() => document.getElementById('settingsCard').classList.contains('open')), false);
  assert.equal(await r.page.isVisible('#eventNameInput'), false);
  await r.page.click('#settingsToggle');
  assert.equal(await r.page.isVisible('#eventNameInput'), true);
  assert.equal(await r.page.getAttribute('#settingsToggle', 'aria-expanded'), 'true');
  await r.ctx.close();
  r = await open({ w:1280 });
  assert.equal(await r.page.evaluate(() => document.getElementById('settingsCard').classList.contains('open')), true);
  await r.ctx.close();
});

test('postavke: smanjenje broja serija traži potvrdu i briše višak rezultata', async () => {
  const { page, ctx, dialogLog } = await open({ dialogs:[true] });
  await page.selectOption('#numJumpsSelect', '5'); await settle(page);
  assert.match(dialogLog[0].msg, /trajno obrisani/);
  const d = await doc(page);
  assert.equal(d.config.numJumps, 5);
  assert.equal(d.results['1-A'].length, 5);
  await ctx.close();
});

test('ekipe (mobitel): obrazac je donji list s očuvanjem nacrta', async () => {
  const { page, ctx } = await open({ w:360, h:800, touch:true });
  const vis = () => page.evaluate(() => getComputedStyle(document.getElementById('teamFormCard')).visibility);
  assert.equal(await vis(), 'hidden');
  await page.click('#newTeamBtn'); await page.waitForTimeout(350);
  assert.equal(await vis(), 'visible');
  await page.fill('#teamName', 'Nacrt');
  await page.click('#teamSheetClose'); await page.waitForTimeout(350);
  assert.equal(await vis(), 'hidden');
  await page.click('#newTeamBtn'); await page.waitForTimeout(350);
  assert.equal(await page.inputValue('#teamName'), 'Nacrt', 'nacrt se čuva nakon zatvaranja');
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  assert.equal(await vis(), 'hidden');
  await page.click('#newTeamBtn'); await page.click('#cancelEditBtn'); await page.waitForTimeout(350);
  assert.equal(await vis(), 'hidden');
  await page.click('#newTeamBtn'); await page.waitForTimeout(350);
  assert.equal(await page.inputValue('#teamName'), '', 'Odustani briše nacrt');
  assert.equal(await overflow(page), 0);
  await ctx.close();
});

test('ekipe (laptop): obrazac je uvijek vidljiv, gumb Nova ekipa skriven', async () => {
  const { page, ctx } = await open({ w:1280 });
  assert.equal(await page.isVisible('#teamFormCard'), true);
  assert.equal(await page.isVisible('#newTeamBtn'), false);
  await ctx.close();
});

// =====================================================================
// MODUL: Unos rezultata
// =====================================================================
async function openEntry(o = {}) {
  const r = await open(o);
  await tab(r.page, 'rezultati');
  return r;
}
const cell = (id, jump, field) => `input[data-id="${id}"][data-jump="${jump}"][data-field="${field}"]`;

test('unos (tablica): 0/1/2 boda automatski daje cm 16 i zaključava polje', async () => {
  const { page, ctx } = await openEntry();
  await page.click('button[data-res-view="all"]');
  await page.click('button[data-res-team="2"]');
  await page.fill(cell('2-A', 6, 'points'), '1'); await page.waitForTimeout(300);
  assert.equal(await page.inputValue(cell('2-A', 6, 'cm')), '16');
  assert.equal(await page.isDisabled(cell('2-A', 6, 'cm')), true);
  await page.fill(cell('2-A', 7, 'points'), '3'); await page.waitForTimeout(300);
  assert.equal(await page.isDisabled(cell('2-A', 7, 'cm')), false);
  await settle(page);
  const r = (await doc(page)).results['2-A'];
  assert.deepEqual([r[6].points, r[6].cm], [1, 16]);
  await ctx.close();
});

test('unos (tablica): vrijednosti izvan raspona se ispravljaju', async () => {
  const { page, ctx } = await openEntry();
  await page.click('button[data-res-view="all"]');
  await page.click('button[data-res-team="2"]');
  await page.fill(cell('2-A', 5, 'points'), '9'); await page.waitForTimeout(300);
  assert.equal(await page.inputValue(cell('2-A', 5, 'points')), '3');
  await page.fill(cell('2-A', 5, 'cm'), '40'); await page.waitForTimeout(800);
  assert.equal(await page.inputValue(cell('2-A', 5, 'cm')), '16');
  await ctx.close();
});

test('unos (tablica): nakon boda fokus ide na cm, Enter potvrđuje', async () => {
  const { page, ctx } = await openEntry();
  await page.click('button[data-res-view="all"]');
  await page.click('button[data-res-team="2"]');
  await page.fill(cell('2-A', 5, 'points'), ''); 
  await page.type(cell('2-A', 5, 'points'), '3'); await page.waitForTimeout(200);
  const f = await page.evaluate(() => document.activeElement.dataset.field + ':' + document.activeElement.dataset.jump);
  assert.equal(f, 'cm:5');
  await page.keyboard.type('4'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const g = await page.evaluate(() => document.activeElement.dataset.field + ':' + document.activeElement.dataset.jump);
  assert.equal(g, 'points:6');
  await settle(page);
  const r = (await doc(page)).results['2-A'][5];
  assert.deepEqual([r.points, r.cm], [3, 4]);
  await ctx.close();
});

test('unos (po seriji): bodovi i cm tipkama, granice cm 0–16', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  await page.click('button[data-res-view="series"]');
  assert.match(await page.textContent('.rs-stp h3'), /Serija IV/i, 'automatski prva neotvorena serija');
  const card = i => `.rs-comp:nth-child(${i})`;
  await page.click(`${card(2)} button[data-res-pts="3"]`);
  assert.equal(await page.inputValue(`${card(2)} .rs-cm input`), '');
  await page.click(`${card(2)} button[data-res-cmd="-1"]`);
  assert.equal(await page.inputValue(`${card(2)} .rs-cm input`), '0', 'minus na praznom = 0');
  await page.click(`${card(2)} button[data-res-cmd="-1"]`);
  assert.equal(await page.inputValue(`${card(2)} .rs-cm input`), '0', 'ne ide ispod 0');
  for (let i = 0; i < 20; i++) await page.click(`${card(2)} button[data-res-cmd="1"]`);
  assert.equal(await page.inputValue(`${card(2)} .rs-cm input`), '16', 'ne ide iznad 16');
  await page.click(`${card(1)} button[data-res-pts="2"]`);
  assert.equal(await page.inputValue(`${card(1)} .rs-cm input`), '16');
  assert.equal(await page.isDisabled(`${card(1)} .rs-cm input`), true);
  await settle(page);
  const d = await doc(page);
  assert.deepEqual([d.results['2-B'][3].points, d.results['2-B'][3].cm], [3, 16]);
  assert.deepEqual([d.results['2-A'][3].points, d.results['2-A'][3].cm], [2, 16]);
  await ctx.close();
});

test('unos (po seriji): cm se može upisati i tipkovnicom', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  await page.click('button[data-res-view="series"]');
  await page.click('.rs-comp:nth-child(1) button[data-res-pts="3"]');
  await page.fill('.rs-comp:nth-child(1) .rs-cm input', '7'); await page.dispatchEvent('.rs-comp:nth-child(1) .rs-cm input', 'change'); await page.waitForTimeout(200);
  assert.equal(await page.inputValue('.rs-comp:nth-child(1) .rs-cm input'), '7');
  await page.fill('.rs-comp:nth-child(1) .rs-cm input', '99'); await page.dispatchEvent('.rs-comp:nth-child(1) .rs-cm input', 'change'); await page.waitForTimeout(200);
  assert.equal(await page.inputValue('.rs-comp:nth-child(1) .rs-cm input'), '16');
  await ctx.close();
});

test('unos: upis u kartici vidi se u tablici i obrnuto', async () => {
  const { page, ctx } = await openEntry({ w:1280 });
  await page.click('button[data-res-team="2"]');
  await page.click('button[data-res-view="series"]');
  await page.click('.rs-comp:nth-child(2) button[data-res-pts="3"]');
  await page.click('.rs-comp:nth-child(2) button[data-res-cmd="1"]');
  await page.click('button[data-res-view="all"]');
  assert.equal(await page.inputValue(cell('2-B', 3, 'points')), '3');
  assert.equal(await page.inputValue(cell('2-B', 3, 'cm')), '1');
  await page.fill(cell('2-A', 3, 'points'), '0'); await page.waitForTimeout(300);
  await page.click('button[data-res-view="series"]');
  assert.equal(await page.inputValue('.rs-comp:nth-child(1) .rs-cm input'), '16');
  await ctx.close();
});

test('unos: odabir ekipe po nazivu, pretraga, strelice i status', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  assert.match(await page.textContent('.rs-cur .nm'), /Beta|Alfa/);
  await page.click('#resPickBtn');
  await page.fill('#resPickQ', 'bet');
  assert.equal(await page.$$eval('#resPickList .rs-item', e => e.length), 1);
  await page.fill('#resPickQ', 'zzz');
  assert.match(await page.textContent('#resPickList'), /Nema ekipe/);
  await page.fill('#resPickQ', '');
  await page.click('#resPickList .rs-item:first-child'); await page.waitForTimeout(200);
  assert.match(await page.textContent('.rs-cur .nm'), /Alfa/);
  assert.match(await page.textContent('.rs-cur .sub'), /gotovo/);
  await page.click('button[data-res-tn="1"]');
  assert.match(await page.textContent('.rs-cur .nm'), /Beta/);
  assert.equal(await page.isDisabled('button[data-res-tn="1"]'), true, 'strelica na zadnjoj ekipi je onemogućena');
  await ctx.close();
});

test('unos: aplikacija sama bira prvu ekipu koja nije gotova i prvu otvorenu seriju', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  assert.match(await page.textContent('.rs-cur .nm'), /Beta/, 'Alfa je gotova pa se bira Beta');
  assert.match(await page.textContent('.rs-stp h3'), /Serija IV/i, 'Eva ima 5, Fran 3 serije → prva nepotpuna je IV');
  await ctx.close();
});

test('unos: traka napretka bojom pokazuje gotove i djelomične serije', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  const cls = await page.$$eval('.rs-strip button', bs => bs.map(b => b.className));
  assert.ok(cls[0].includes('full') && cls[1].includes('full') && cls[2].includes('full'));
  assert.ok(cls[3].includes('part') && cls[4].includes('part'), 'serije koje ima samo Eva su djelomične');
  assert.ok(!cls[8].includes('full') && !cls[8].includes('part'));
  await ctx.close();
});

test('unos: strelice i traka mijenjaju seriju; granice su onemogućene', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  await page.click('.rs-strip button:first-child');
  assert.match(await page.textContent('.rs-stp h3'), /Serija I /i);
  assert.equal(await page.isDisabled('.rs-stp button[data-res-sd="-1"]'), true);
  await page.click('.rs-stp button[data-res-sd="1"]');
  assert.match(await page.textContent('.rs-stp h3'), /Serija II/i);
  await page.click('.rs-strip button:last-child');
  assert.equal(await page.isDisabled('.rs-stp button[data-res-sd="1"]'), true);
  await ctx.close();
});

test('unos: odabir prikaza se pamti nakon ponovnog učitavanja', async () => {
  const r = await openEntry({ w:1280 });
  assert.equal(await r.page.getAttribute('button[data-res-view="all"]', 'aria-pressed'), 'true', 'zadano na laptopu');
  await r.page.click('button[data-res-view="series"]');
  await r.page.reload(); await r.page.waitForTimeout(900); await tab(r.page, 'rezultati');
  assert.equal(await r.page.getAttribute('button[data-res-view="series"]', 'aria-pressed'), 'true');
  await r.ctx.close();
  const m = await openEntry({ w:360, h:800, touch:true });
  assert.equal(await m.page.getAttribute('button[data-res-view="series"]', 'aria-pressed'), 'true', 'zadano na uspravnom mobitelu');
  await m.ctx.close();
});

test('unos: široki ekran ima popis ekipa sa strane bez trake za odabir', async () => {
  const { page, ctx } = await openEntry({ w:1280 });
  assert.equal(await page.isVisible('#resSide'), true);
  assert.equal(await page.isVisible('#teamPickerWrap'), false);
  await page.click('#resSide button[data-res-team="1"]');
  assert.equal(await page.$eval('#resSide .rs-item.on .nm', e => e.textContent.includes('Alfa')), true);
  await ctx.close();
});

test('unos: tablica sa svim serijama stane bez vodoravnog skrolanja na tabletu i laptopu', async () => {
  for (const [w, h] of [[768, 1024], [1024, 768], [1280, 900], [740, 360]]) {
    const { page, ctx } = await openEntry({ w, h, touch:w < 1200 });
    await page.click('button[data-res-view="all"]');
    const [sw, cw] = await page.$eval('.results-table-wrap', e => [e.scrollWidth, e.clientWidth]);
    assert.ok(sw <= cw + 1, `${w}px: tablica ${sw} > ${cw}`);
    assert.equal(await overflow(page), 0, `${w}px: stranica se prelijeva`);
    await ctx.close();
  }
});

test('unos: prazno mjesto u ekipi nema kartice i navedeno je kao prazno', async () => {
  const { page, ctx } = await openEntry({ w:360, h:800, touch:true });
  await page.click('button[data-res-view="series"]');
  assert.equal(await page.$$eval('.rs-comp', e => e.length), 2);
  assert.match(await page.textContent('.rs-missing'), /C, D, E.*0 punata i 16 cm/);
  await ctx.close();
});

// =====================================================================
// MODUL: Rang lista
// =====================================================================
async function rangRows(page, mode) {
  await page.selectOption('#rangRoundSelect', mode); await page.waitForTimeout(250);
  return page.$$eval('#rangContent table tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
}

test('rang: pojedinačni poredak — punti, pa cm, pa countback', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'rang');
  const rows = await rangRows(page, 'ind');
  const order = rows.map(r => (r.match(/(Ana|Boris|Dino|Cvita|Eva|Fran)/) || [])[1]);
  assert.deepEqual(order.slice(0, 4), ['Ana','Boris','Dino','Cvita']);
  await ctx.close();
});

test('rang: ekipni poredak s ispravnim zbrojevima', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'rang');
  const rows = await rangRows(page, 'tim');
  const alfa = rows.find(r => /Alfa/.test(r)), beta = rows.find(r => /Beta/.test(r));
  assert.ok(/106/.test(alfa), 'Alfa: 27+27+26+26 = 106 punata → '+alfa);
  assert.ok(/49 cm/.test(alfa), 'Alfa cm: 0+9+24+16 = 49');
  // Beta: Eva 15 p, Fran 9 p = 24 punata
  assert.ok(/24/.test(beta));
  assert.ok(rows.findIndex(r => /Alfa/.test(r)) < rows.findIndex(r => /Beta/.test(r)));
  await ctx.close();
});

test('rang: neskočene serije se računaju kao 0 punata i 16 cm', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'rang');
  const rows = await rangRows(page, 'ind');
  const eva = rows.find(r => /Eva/.test(r));
  // Eva: 5 × 3 p (cm 2) + 4 neskočene (16 cm) = 15 p, 10 + 64 = 74 cm
  assert.ok(/15\s*PUNATA/i.test(eva) && /74 cm/.test(eva), eva);
  await ctx.close();
});

test('rang: žuti okvir mijenja tekst kad je natjecanje završeno', async () => {
  let r = await open({ w:1280 });
  await tab(r.page, 'rang');
  assert.match(await r.page.textContent('.incomplete-banner'), /mijenja se uživo/);
  assert.match(await r.page.textContent('.series-banner'), /Serija/);
  await r.ctx.close();
  const seed = fixture();
  ['2-A','2-B'].forEach(id => seed.results[id] = series(9, () => rowOf(3,1)));
  r = await open({ w:1280, seed });
  await tab(r.page, 'rang');
  assert.match(await r.page.textContent('.incomplete-banner'), /Natjecanje je završeno/);
  assert.match(await r.page.textContent('.series-banner'), /završeno/i);
  await r.ctx.close();
});

test('rang: Bara/Čoja/Alka nude se samo uz 9 serija i prikazuju samo označene natjecatelje', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'rang');
  const opts = await page.$$eval('#rangRoundSelect option', o => o.map(x => x.value));
  assert.ok(['bara','coja','alka'].every(k => opts.includes(k)));
  const rows = await rangRows(page, 'bara');
  assert.ok(!rows.some(r => /Fran/.test(r)), 'Fran je "samo Kup" pa nije u Bari');
  assert.ok(rows.some(r => /Eva/.test(r)));
  await ctx.close();
  const seed = fixture(); seed.config.numJumps = 5;
  Object.keys(seed.results).forEach(k => seed.results[k] = seed.results[k].slice(0,5));
  const r5 = await open({ w:1280, seed });
  await tab(r5.page, 'rang');
  const opts5 = await r5.page.$$eval('#rangRoundSelect option', o => o.map(x => x.value));
  assert.ok(!opts5.includes('bara'));
  await r5.ctx.close();
});

test('rang: klik na ekipu otvara samo tu ekipu', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'rang');
  await page.selectOption('#rangRoundSelect', 'tim'); await page.waitForTimeout(200);
  const before = await page.$$eval('tr.team-row', r => r.length);
  await page.click('tr.team-row:nth-child(1)'); await page.waitForTimeout(200);
  const shown = await page.$$eval('#rangContent', e => e[0].innerText);
  assert.ok(/Ana Anić/.test(shown));
  assert.ok(!/Eva Erić/.test(shown), 'druga ekipa ostaje zatvorena');
  assert.equal(before, 2);
  await ctx.close();
});

test('rang: kartica javnog pregleda sklopiva i s ispravnom poveznicom', async () => {
  let r = await open({ w:360, h:800, touch:true });
  await tab(r.page, 'rang');
  assert.equal(await r.page.evaluate(() => document.getElementById('publicLinkCard').open), false);
  await r.page.click('#publicLinkCard summary');
  assert.match(await r.page.inputValue('#publicLinkInput'), /\?rezultati$/);
  await r.ctx.close();
  r = await open({ w:1280 });
  await tab(r.page, 'rang');
  assert.equal(await r.page.evaluate(() => document.getElementById('publicLinkCard').open), true);
  await r.ctx.close();
});

// =====================================================================
// MODUL: Ispis, Pravila, Arhiva
// =====================================================================
test('ispis: svaka vrsta ispisa ima potpis glavnog suca', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'ispis');
  for (const v of ['rang','radni','pojedinacni','pravila']) {
    await page.selectOption('#reportTypeSelect', v); await page.waitForTimeout(250);
    assert.match(await page.textContent('#reportPreview'), /Glavni sudac/, 'bez potpisa: '+v);
  }
  await ctx.close();
});

test('ispis: izbor naslova vidljiv samo za rang listu', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'ispis');
  await page.selectOption('#reportTypeSelect', 'rang');
  assert.equal(await page.$eval('#rangPrintRoundField', e => getComputedStyle(e).visibility), 'visible');
  await page.selectOption('#reportTypeSelect', 'radni');
  assert.equal(await page.$eval('#rangPrintRoundField', e => getComputedStyle(e).visibility), 'hidden');
  await ctx.close();
});

test('ispis: kontrole su fiksne širine (gumb se ne miče pri promjeni vrste)', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'ispis');
  const xs = [];
  for (const v of ['rang','radni','pojedinacni','pravila']) {
    await page.selectOption('#reportTypeSelect', v); await page.waitForTimeout(200);
    xs.push(Math.round((await page.$eval('#printBtn', e => e.getBoundingClientRect().left))));
  }
  assert.equal(new Set(xs).size, 1, 'gumb Ispiši se pomiče: ' + xs);
  await ctx.close();
});

test('ispis: pregled se skrola unutar okvira, ne širi stranicu na mobitelu', async () => {
  const { page, ctx } = await open({ w:360, h:800, touch:true });
  await tab(page, 'ispis');
  assert.equal(await overflow(page), 0);
  await ctx.close();
});

test('ispis: u print načinu kontrole i tabovi se ne ispisuju', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'ispis');
  await page.emulateMedia({ media:'print' });
  assert.equal(await page.isVisible('.print-controls'), false);
  assert.equal(await page.isVisible('#mainTabs'), false);
  assert.equal(await page.isVisible('#reportPreview'), true);
  await ctx.close();
});

test('pravila: tekst se sprema u bazu', async () => {
  const { page, ctx } = await open({ w:1280 });
  await tab(page, 'pravila');
  await page.fill('#rulesTextarea', 'Novi tekst pravila'); await settle(page);
  assert.equal((await doc(page)).rules, 'Novi tekst pravila');
  await ctx.close();
});

test('arhiva: izmjena broja izdanja pokreće novo izdanje, staro ostaje', async () => {
  const { page, ctx } = await open({ w:1280, dialogs:[true, true, true] });
  await page.fill('#eventEditionInput', '38.'); await page.dispatchEvent('#eventEditionInput', 'change'); await settle(page, 2000);
  const docs = await page.evaluate(() => Object.keys(window.__store.docs));
  assert.ok(docs.includes('natjecanja/38.'), 'novo izdanje stvoreno: ' + docs);
  assert.ok(docs.includes('natjecanja/37.'), 'staro izdanje zadržano');
  const old = await doc(page, '37.');
  assert.equal(old.teams.length, 2);
  const meta = await page.evaluate(() => window.__store.docs['natjecanja/_meta']);
  assert.equal(meta.currentEdition, '38.');
  await ctx.close();
});

// =====================================================================
// PRISTUPAČNOST I ROBUSNOST
// =====================================================================
const TABS_ADMIN = ['ekipe','rezultati','rang','pravila','ispis','arhiva'];
for (const [w, h, touch] of [[360, 800, true], [740, 360, true], [768, 1024, true], [1024, 768, true], [1280, 900, false]]) {
  test(`robusnost ${w}px: nema grešaka ni vodoravnog prelijevanja ni jednog taba`, async () => {
    const { page, ctx, errors } = await open({ w, h, touch });
    for (const t of TABS_ADMIN) {
      await tab(page, t);
      assert.equal(await overflow(page), 0, `${w}px / ${t}: prelijevanje`);
    }
    const pub = await open({ w, h, touch, user:'none', query:'?rezultati' });
    for (const t of ['rang','pravila','info']) {
      await tab(pub.page, t);
      assert.equal(await overflow(pub.page), 0, `${w}px javni / ${t}: prelijevanje`);
    }
    assert.deepEqual(errors.concat(pub.errors), []);
    await ctx.close(); await pub.ctx.close();
  });
}

test('pristupačnost: sva vidljiva polja imaju oznaku (label, aria-label ili placeholder)', async () => {
  const { page, ctx } = await open({ w:1280 });
  for (const t of TABS_ADMIN) {
    await tab(page, t);
    const bad = await page.$$eval('.tab-content.active input:not([type=hidden]), .tab-content.active select, .tab-content.active textarea', els =>
      els.filter(e => e.offsetParent !== null && !(e.getAttribute('aria-label') || e.title || e.placeholder ||
        (e.id && document.querySelector('label[for="'+e.id+'"]')) || e.closest('label') ||
        (e.closest('.field') && e.closest('.field').querySelector('label')))).map(e => e.id || e.className));
    assert.deepEqual(bad, [], `${t}: polja bez oznake`);
  }
  await ctx.close();
});

test('dodirni ekrani: gumbi i polja su dovoljno veliki (≥ 40 px)', async () => {
  const { page, ctx } = await open({ w:360, h:800, touch:true });
  for (const t of ['ekipe','rezultati','rang']) {
    await tab(page, t);
    const small = await page.$$eval('.tab-content.active button, .tab-content.active select, .tab-content.active input[type=text]', els =>
      els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 38 && !e.closest('table') && !e.closest('.rs-strip') && !e.closest('#teamFormCard') && e.type !== 'checkbox'; })
         .map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)));
    assert.deepEqual(small, [], `${t}: premali dodirni elementi`);
  }
  await ctx.close();
});

test('sigurnost: imena s HTML oznakama se ne izvršavaju', async () => {
  const seed = fixture();
  seed.teams[0].name = '<img src=x onerror="window.__xss=1">';
  seed.teams[0].competitors[0].ime = '"><script>window.__xss=1</script>';
  const { page, ctx } = await open({ w:1280, seed });
  for (const t of ['ekipe','rezultati','rang','ispis']) await tab(page, t);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});
