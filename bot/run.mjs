// Bots simulados em segundo plano. Roda no GitHub Actions, usa o mesmo motor de análise do app
// (trecho entre //<core> e //</core> do index.html) e NÃO envia ordens: só simula e grava o estado.
// Cada bot de bot/config.json tem a sua carteira simulada e o seu preset:
//   periodo: "1d" ou "4h" · alvo/perda: multiplicador da média histórica (0.5, 0.75, 1, 1.5)
//   entrada: "gatilho" (só gatilho novo de compra) ou "ampla" (gatilho novo ou regra ainda perto da entrada)
import fs from 'fs';
import path from 'path';
const statePath = process.argv[2] || 'data/state.json';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = html.split('//<core>')[1].split('//</core>')[0];
const { COINS, FEE, analyze, profile, mean } = new Function(core + ';return {COINS,FEE,analyze,profile,mean};')();
const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const BOTS = (cfg.bots || []).filter(b => /^BG\d{2}$/.test(b.id)).slice(0, 8);
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
async function api(p) {
  let err;
  for (const h of HOSTS) {
    try { const r = await fetch(h + p, { signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); err = new Error(h + ' HTTP ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
}
const pct = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d).replace('.', ',') + '%';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const now = Date.now();

let st = null;
try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
if (!st || st.v !== 2) st = { v: 2, bots: {}, runs: 0, since: now, usdbrl: st?.usdbrl };

async function klines(interval) {
  const K = {};
  for (const c of COINS) {
    try {
      const raw = await api(`/api/v3/klines?symbol=${c.pair}&interval=${interval}&limit=1000`);
      const closed = raw.filter(k => k[6] < now);
      K[c.sym] = { t: closed.map(k => k[0]), h: closed.map(k => +k[2]), l: closed.map(k => +k[3]), c: closed.map(k => +k[4]), last: +raw[raw.length - 1][4] };
    } catch (e) { console.warn('falhou', interval, c.sym, String(e.message || e)); }
  }
  return K;
}
const TFS = [...new Set(['1d', ...BOTS.map(b => b.periodo === '4h' ? '4h' : '1d')])];
const DATA = {};
for (const tf of TFS) DATA[tf] = await klines(tf);
if (!Object.keys(DATA['1d']).length) { console.error('Sem dados da Binance; estado mantido.'); process.exit(1); }
let usdbrl = st.usdbrl || 5.5;
try { usdbrl = +(await api('/api/v3/ticker/price?symbol=USDTBRL')).price; } catch (e) {}
const price = s => DATA['1d'][s]?.last;

// análise por período: sinal de cada moeda + ganho/perda médios da regra escolhida
const AN = {};
for (const tf of TFS) {
  AN[tf] = {};
  for (const c of COINS) {
    const d = DATA[tf][c.sym], day = DATA['1d'][c.sym]; if (!d || !day) continue;
    const a = analyze(d, tf === '1d' ? 1 : 6, tf === '1d' ? 2 : 3); if (!a) continue;
    const vol = profile(day, null).vol, cl = a.full.trades.filter(t => !t.open), w = cl.filter(t => t.r > 0).map(t => t.r), l = cl.filter(t => t.r <= 0).map(t => -t.r);
    AN[tf][c.sym] = { a, d, gain: w.length >= 2 ? mean(w) : vol, loss: l.length >= 2 ? mean(l) : vol };
  }
}

for (const b of BOTS) {
  const tf = b.periodo === '4h' ? '4h' : '1d', tpM = +b.alvo || 1, slM = +b.perda || 1, frac = (+b.percentualPorOperacao || 20) / 100, max = +b.maximoDeMoedas || 5, onlyNew = b.entrada === 'gatilho';
  let s = st.bots[b.id];
  if (!s) { const c0 = (cfg.capitalInicialBRL || 1000) / usdbrl; s = st.bots[b.id] = { cash: c0, start: c0, fx0: usdbrl, pos: [], closed: [], log: [], done: {}, since: now }; }
  const log = (sym, act, why, p, r) => { s.log.push({ t: now, sym, act, why, p, r }); if (s.log.length > 200) s.log = s.log.slice(-200); };
  const value = () => s.cash + s.pos.reduce((v, x) => v + x.qty * (price(x.sym) || x.price), 0);
  const X = AN[tf];
  if (b.ligado) {
    for (let i = s.pos.length - 1; i >= 0; i--) {
      const x = s.pos[i], p = price(x.sym), a = X[x.sym]?.a; if (!p) continue;
      const r = x.qty * p * (1 - FEE) / x.cost - 1;
      const why = r >= x.tp ? `Alvo de lucro atingido (${pct(x.tp)})` : r <= -x.sl ? `Limite de perda atingido (${pct(-x.sl)})` : (a && (a.sig === 'SELL' || a.sig === 'WAIT')) ? 'A regra da moeda deu saída' : null;
      if (why) { const got = x.qty * p * (1 - FEE); s.cash += got; s.closed.push({ sym: x.sym, tin: x.t, tout: now, pin: x.price, pout: p, pnl: got - x.cost, cost: x.cost }); s.pos.splice(i, 1); log(x.sym, 'VENDA', why, p, got / x.cost - 1); }
    }
    const cand = COINS.map(c => {
      const e = X[c.sym]; if (!e || !e.a.valid) return null; const { a, d } = e, p = price(c.sym);
      const tp = clamp(e.gain * tpM, 0.003, 0.3), sl = clamp(e.loss * slM, 0.005, 0.3);
      if (a.sig !== 'BUY' && !(!onlyNew && a.sig === 'HOLD' && p <= d.c[a.k] * (1 + tp / 2))) return null;
      if (s.done[c.sym] === d.t[a.k] || s.pos.some(x => x.sym === c.sym)) return null;
      return { c, a, d, p, tp, sl };
    }).filter(Boolean).sort((x, y) => (y.a.sig === 'BUY') - (x.a.sig === 'BUY') || y.a.week - x.a.week);
    for (const k of cand) {
      if (s.pos.length >= max) break;
      const amt = Math.min(s.cash, value() * frac); if (amt < 5) break;
      s.cash -= amt; s.pos.push({ sym: k.c.sym, qty: amt * (1 - FEE) / k.p, price: k.p, cost: amt, t: now, tp: k.tp, sl: k.sl }); s.done[k.c.sym] = k.d.t[k.a.k];
      log(k.c.sym, 'COMPRA', (k.a.sig === 'BUY' ? 'Gatilho de compra validado' : 'Regra comprada e preço ainda perto da entrada') + ' · ' + k.a.best.s.name, k.p, null);
    }
  }
  if (s.closed.length > 500) s.closed = s.closed.slice(-500);
  s.name = String(b.nome || b.id).slice(0, 40); s.on = !!b.ligado; s.value = value();
  s.cfg = { frac, max, tpM, slM, entry: onlyNew ? 'BUY' : 'ALL', tf };
  s.buyable = COINS.filter(c => X[c.sym]?.a.valid && (X[c.sym].a.sig === 'BUY' || X[c.sym].a.sig === 'HOLD')).map(c => c.sym);
}
for (const id of Object.keys(st.bots)) if (!BOTS.some(b => b.id === id)) st.bots[id].on = false; // bot retirado do config: fica guardado, desligado
st.updated = now; st.runs = (st.runs || 0) + 1; st.usdbrl = usdbrl;
st.marks = Object.fromEntries(Object.keys(DATA['1d']).map(s => [s, DATA['1d'][s].last]));
fs.mkdirSync(path.dirname(path.resolve(statePath)), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(st));
console.log(`ok · ${TFS.join('+')} · ` + BOTS.map(b => `${b.id} ${st.bots[b.id].value.toFixed(2)} USD, ${st.bots[b.id].pos.length} pos`).join(' · '));
