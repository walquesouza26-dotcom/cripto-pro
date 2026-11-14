// Bot simulado em segundo plano. Roda no GitHub Actions, usa o mesmo motor de análise do app
// (trecho entre //<core> e //</core> do index.html) e NÃO envia ordens: só simula e grava o estado.
import fs from 'fs';
import path from 'path';
const statePath = process.argv[2] || 'data/state.json';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = html.split('//<core>')[1].split('//</core>')[0];
const { COINS, FEE, analyze, profile, mean } = new Function(core + ';return {COINS,FEE,analyze,profile,mean};')();
const cfg = Object.assign({ ligado: true, percentualPorOperacao: 20, maximoDeMoedas: 5, capitalInicialBRL: 1000 },
  JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')));
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
async function api(path) {
  let err;
  for (const h of HOSTS) {
    try { const r = await fetch(h + path, { signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); err = new Error(h + ' HTTP ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
}
const pct = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d).replace('.', ',') + '%';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let st = null;
try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
const now = Date.now();
const K = {};
for (const c of COINS) {
  try {
    const raw = await api(`/api/v3/klines?symbol=${c.pair}&interval=1d&limit=1000`);
    const closed = raw.filter(k => k[6] < now);
    K[c.sym] = { t: closed.map(k => k[0]), h: closed.map(k => +k[2]), l: closed.map(k => +k[3]), c: closed.map(k => +k[4]), last: +raw[raw.length - 1][4] };
  } catch (e) { console.warn('falhou', c.sym, String(e.message || e)); }
}
if (!Object.keys(K).length) { console.error('Sem dados da Binance; estado mantido.'); process.exit(1); }
let usdbrl = st?.usdbrl || 5.5;
try { usdbrl = +(await api('/api/v3/ticker/price?symbol=USDTBRL')).price; } catch (e) {}

if (!st || !Array.isArray(st.pos)) { const s = cfg.capitalInicialBRL / usdbrl; st = { cash: s, start: s, pos: [], closed: [], log: [], done: {}, runs: 0, since: now }; }
const price = s => K[s]?.last;
const log = (sym, act, why, p, r) => { st.log.push({ t: now, sym, act, why, p, r }); if (st.log.length > 300) st.log = st.log.slice(-300); };
const A = {}, L = {};
for (const c of COINS) {
  const d = K[c.sym]; if (!d) continue;
  const a = analyze(d, 1, 2); if (!a) continue;
  const p = profile(d, null), cl = a.full.trades.filter(t => !t.open), w = cl.filter(t => t.r > 0).map(t => t.r), l = cl.filter(t => t.r <= 0).map(t => -t.r);
  A[c.sym] = a; L[c.sym] = { tp: clamp(w.length >= 2 ? mean(w) : p.vol, 0.005, 0.25), sl: clamp(l.length >= 2 ? mean(l) : p.vol, 0.01, 0.25) };
}
const value = () => st.cash + st.pos.reduce((s, x) => s + x.qty * (price(x.sym) || x.price), 0);
if (cfg.ligado) {
  for (let i = st.pos.length - 1; i >= 0; i--) {
    const x = st.pos[i], p = price(x.sym), a = A[x.sym]; if (!p) continue;
    const r = x.qty * p * (1 - FEE) / x.cost - 1;
    const why = r >= x.tp ? `Alvo de lucro médio atingido (${pct(x.tp)})` : r <= -x.sl ? `Limite de perda média atingido (${pct(-x.sl)})` : (a && (a.sig === 'SELL' || a.sig === 'WAIT')) ? 'A regra da moeda deu saída' : null;
    if (why) { const got = x.qty * p * (1 - FEE); st.cash += got; st.closed.push({ sym: x.sym, tin: x.t, tout: now, pin: x.price, pout: p, pnl: got - x.cost, cost: x.cost }); st.pos.splice(i, 1); log(x.sym, 'VENDA', why, p, got / x.cost - 1); }
  }
  const cand = COINS.map(c => {
    const a = A[c.sym], d = K[c.sym], lim = L[c.sym]; if (!a || !a.valid) return null; const p = d.last;
    if (a.sig !== 'BUY' && !(a.sig === 'HOLD' && p <= d.c[a.k] * (1 + lim.tp / 2))) return null;
    if (st.done[c.sym] === d.t[a.k] || st.pos.some(x => x.sym === c.sym)) return null;
    return { c, a, d, p, lim };
  }).filter(Boolean).sort((x, y) => (y.a.sig === 'BUY') - (x.a.sig === 'BUY') || y.a.week - x.a.week);
  for (const k of cand) {
    if (st.pos.length >= cfg.maximoDeMoedas) break;
    const amt = Math.min(st.cash, value() * cfg.percentualPorOperacao / 100); if (amt < 5) break;
    st.cash -= amt; st.pos.push({ sym: k.c.sym, qty: amt * (1 - FEE) / k.p, price: k.p, cost: amt, t: now, tp: k.lim.tp, sl: k.lim.sl }); st.done[k.c.sym] = k.d.t[k.a.k];
    log(k.c.sym, 'COMPRA', (k.a.sig === 'BUY' ? 'Gatilho de compra validado' : 'Regra comprada e preço ainda perto da entrada') + ' · ' + k.a.best.s.name, k.p, null);
  }
}
if (st.closed.length > 500) st.closed = st.closed.slice(-500);
st.updated = now; st.runs = (st.runs || 0) + 1; st.usdbrl = usdbrl; st.on = !!cfg.ligado;
st.cfg = { frac: cfg.percentualPorOperacao / 100, max: cfg.maximoDeMoedas };
st.marks = Object.fromEntries(Object.keys(K).map(s => [s, K[s].last]));
st.signals = Object.fromEntries(Object.keys(A).map(s => [s, { sig: A[s].sig, valid: A[s].valid, rule: A[s].best.s.name, tp: L[s].tp, sl: L[s].sl }]));
st.value = value();
fs.mkdirSync(path.dirname(path.resolve(statePath)), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(st));
console.log(`ok · ${Object.keys(K).length} moedas · valor ${st.value.toFixed(2)} USD · ${st.pos.length} posições · ${st.log.length} decisões`);
