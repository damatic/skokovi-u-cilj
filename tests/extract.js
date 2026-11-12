// Izvlači čiste funkcije iz index.html i učitava ih u vm kontekst za unit testove.
// Aplikacija je jedna IIFE bez exporta, pa se funkcije vade iz izvornog teksta (bez izmjene aplikacije).
const fs = require('fs');
const vm = require('vm');

function lastScript(html){
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return m[m.length-1][1];
}
function extractFunction(src, name){
  // Funkcije u IIFE-u su uvučene s 2 razmaka i završavaju retkom "  }".
  const re = new RegExp('^  (?:async\\s+)?function\\s+'+name+'\\s*\\(', 'm');
  const m = re.exec(src);
  if(!m) throw new Error('Funkcija nije pronađena: '+name);
  const lineEnd = src.indexOf('\n', m.index);
  const first = src.slice(m.index, lineEnd);
  if(/\}\s*$/.test(first) && (first.match(/\{/g)||[]).length === (first.match(/\}/g)||[]).length) return first; // jednoredna
  const end = src.indexOf('\n  }\n', m.index);
  if(end < 0) throw new Error('Nezatvorena funkcija: '+name);
  return src.slice(m.index, end + 4);
}
function extractConst(src, name){
  const re = new RegExp('^  const\\s+'+name+'\\s*=', 'm');
  const m = re.exec(src);
  if(!m) throw new Error('Const nije pronađen: '+name);
  const lineEnd = src.indexOf('\n', m.index);
  const first = src.slice(m.index, lineEnd);
  if(/;\s*$/.test(first)) return first;
  const end = src.indexOf('\n  };', m.index);
  return src.slice(m.index, end + 5);
}
function loadApp(file){
  const src = lastScript(fs.readFileSync(file,'utf8'));
  const funcs = ['deepCopy','isMissing','emptyResultRow','competitorId','ensureResultsForCompetitor','syncAllResultsShape',
    'sanitizeEditionKey','normalizeData','jumpLabels','competitorEligible','sliceJumps','compareStandings','rankList',
    'buildGroupIndividualStandings','buildGroupTeamStandings','roundsAvailable','getRoundGroup','getSeriesInfo',
    'teamSeriesProgress','firstOpenSeries','teamStatus','storeResult','escapeHtml','escapeAttr'];
  const consts = ['LETTERS','ROUND_GROUPS'];
  const code = consts.map(c=>extractConst(src,c)).join('\n') + '\n' + funcs.map(f=>extractFunction(src,f)).join('\n') +
    '\nthis.api = {' + funcs.concat(consts).join(',') + '};';
  const ctx = { data:null, saveCalls:0, saveDataDebounced(){ ctx.saveCalls++; }, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { api: ctx.api, ctx, setData(d){ ctx.data = d; vm.runInContext('data = this.data', ctx); } };
}
module.exports = { loadApp, extractFunction, lastScript };
