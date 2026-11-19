// Bots simulados em segundo plano. Roda no GitHub Actions, usa o mesmo motor de análise do app
// (trecho entre //<core> e //</core> do index.html) e NÃO envia ordens: só simula e grava o estado.
//
// Cada bot de bot/config.json tem a sua carteira simulada e o seu preset:
//   periodo: "1d" ou "4h" · alvo/perda: multiplicador da média histórica (0.5, 0.75, 1, 1.5)
//   entrada: "gatilho" (só gatilho novo de compra) ou "ampla" (gatilho novo ou regra ainda perto da entrada)
//   filtroMercado (opcional): false para o bot ignorar o filtro de mercado
// TioPatinhas: quando o lucro realizado de um bot (ainda não recolhido) chega a gatilhoPercentual% do capital
//   inicial desse bot, ele recolhe esse lucro para o cofre. Perdas ficam com o bot.
// Proteções: filtro de mercado (não compra com o Bitcoin abaixo da média de 200 dias) e freio por perda
//   (pausa as compras de um bot que perdeu freioPerdaPercentual% e retoma após pausaDoFreioDias).
// Pronto para real: selo calculado com mínimo de operações, lucro, ganho acima de segurar Bitcoin e queda máxima.
// Seleção automática: de tempos em tempos, o pior bot (com operações suficientes) recebe uma variação do preset
//   do melhor e recomeça com R$ 1.000; o histórico anterior fica arquivado.
// Custos: taxa de 0,1% + perda estimada entre compra e venda, por moeda (COST no motor).
// Alvo e limite de perda são conferidos vela a vela de 1 hora desde a última checagem.
// Avisos: se existirem os segredos NTFY_TOPIC e/ou TELEGRAM_TOKEN + TELEGRAM_CHAT_ID, envia as decisões ao celular.
import fs from 'fs';
import path from 'path';
const statePath = process.argv[2] || 'data/state.json';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = html.split('//<core>')[1].split('//</core>')[0];
const { COINS, COST, analyze, profile, mean, btcRegime } = new Function(core + ';return {COINS,COST,analyze,profile,mean,btcRegime};')();
const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const BOTS = (cfg.bots || []).filter(b => /^BG\d{2}$/.test(b.id)).slice(0, 8);
const PROT = Object.assign({ filtroMercado: true, freioPerdaPercentual: 5, pausaDoFreioDias: 7 }, cfg.protecoes || {});
const READY = Object.assign({ minimoOperacoes: 30, quedaMaximaPercentual: 5 }, cfg.prontoParaReal || {});
const EVO = Object.assign({ ligado: true, minimoOperacoes: 20, intervaloDias: 7, diferencaMinimaPercentual: 2 }, cfg.selecaoAutomatica || {});
const NOTE = Object.assign({ resumoDiarioHora: 9 }, cfg.avisos || {});
const TIO = Object.assign({ ligado: true, gatilhoPercentual: 1 }, cfg.tioPatinhas || {});
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
const now = Date.now(), DAY = 864e5;
const fmtH = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let st = null;
try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
if (!st || st.v !== 2) st = { v: 2, bots: {}, runs: 0, since: now, usdbrl: st?.usdbrl };
if (!st.tio) st.tio = { vault: 0, sweeps: [], since: now };
if (!st.evo) st.evo = { last: now, gen: 0, overrides: {}, history: [] };

// preset efetivo = config + ajuste da seleção automática (se houver)
const presetOf = b => Object.assign({ periodo: '1d', percentualPorOperacao: 20, maximoDeMoedas: 5, alvo: 1, perda: 1, entrada: 'ampla' },
  b, st.evo.overrides[b.id] || {});

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
const TFS = [...new Set(['1d', '4h', ...BOTS.map(b => presetOf(b).periodo === '4h' ? '4h' : '1d')])];
const DATA = {};
for (const tf of TFS) DATA[tf] = await klines(tf);
if (!Object.keys(DATA['1d']).length || !DATA['1d'].BTC) { console.error('Sem dados da Binance; estado mantido.'); process.exit(1); }
let usdbrl = st.usdbrl || 5.5;
try { usdbrl = +(await api('/api/v3/ticker/price?symbol=USDTBRL')).price; } catch (e) {}
const price = s => DATA['1d'][s]?.last;
const BTC = DATA['1d'].BTC;
const btcAt = t => { let i = BTC.t.length - 1; while (i > 0 && BTC.t[i] > t) i--; return BTC.c[i]; };

// filtro de mercado
const regime = btcRegime(BTC.c.concat([BTC.last]));
st.market = { ok: regime.ok, price: regime.price, ma: regime.ma, t: now };

// análise por período: sinal de cada moeda + ganho/perda médios da regra escolhida (já com custos)
const AN = {};
for (const tf of TFS) {
  AN[tf] = {};
  for (const c of COINS) {
    const d = DATA[tf][c.sym], day = DATA['1d'][c.sym]; if (!d || !day) continue;
    const a = analyze(d, tf === '1d' ? 1 : 6, tf === '1d' ? 2 : 3, COST(c.sym)); if (!a) continue;
    const vol = profile(day, null).vol, cl = a.full.trades.filter(t => !t.open), w = cl.filter(t => t.r > 0).map(t => t.r), l = cl.filter(t => t.r <= 0).map(t => -t.r);
    AN[tf][c.sym] = { a, d, gain: w.length >= 2 ? mean(w) : vol, loss: l.length >= 2 ? mean(l) : vol };
  }
}
st.validated = Object.fromEntries(TFS.map(tf => [tf, COINS.filter(c => AN[tf][c.sym]?.a.valid).map(c => c.sym)]));

// velas de 1 hora das moedas com posição aberta, para conferir alvo e perda desde a última checagem
const H = {};
for (const sym of [...new Set(Object.values(st.bots).flatMap(s => s.pos.map(x => x.sym)))]) {
  try {
    const raw = await api(`/api/v3/klines?symbol=${sym}USDT&interval=1h&limit=500`);
    H[sym] = raw.filter(k => k[6] < now).map(k => ({ t: k[0], end: k[6], o: +k[1], h: +k[2], l: +k[3] }));
  } catch (e) { console.warn('falhou 1h', sym, String(e.message || e)); }
}

const events = []; // para os avisos no celular
const brl = usd => 'R$ ' + (usd * usdbrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const total = s => (s.value ?? s.cash) + (s.swept || 0);
const result = s => total(s) / s.start - 1;

function newWallet() { const c0 = (cfg.capitalInicialBRL || 1000) / usdbrl; return { cash: c0, start: c0, fx0: usdbrl, pos: [], closed: [], log: [], done: {}, since: now, swept: 0, peak: c0, maxDD: 0, brakeBase: c0, bench: { btc0: BTC.last } }; }

for (const b of BOTS) {
  const P = presetOf(b);
  const tf = P.periodo === '4h' ? '4h' : '1d', tpM = +P.alvo || 1, slM = +P.perda || 1, frac = (+P.percentualPorOperacao || 20) / 100, max = +P.maximoDeMoedas || 5, onlyNew = P.entrada === 'gatilho';
  const useFilter = PROT.filtroMercado && b.filtroMercado !== false;
  let s = st.bots[b.id];
  if (!s) s = st.bots[b.id] = newWallet();
  s.swept = s.swept || 0;
  if (!s.bench) s.bench = { btc0: btcAt(s.since) };
  if (s.peak == null) { s.peak = s.start; s.maxDD = 0; }
  if (s.brakeBase == null) s.brakeBase = s.start;
  const log = (sym, act, why, p, r, t = now) => { s.log.push({ t, sym, act, why, p, r }); if (s.log.length > 200) s.log = s.log.slice(-200); events.push({ t, bot: b.id, name: P.nome || b.id, sym, act, why, p, r }); };
  const sell = (i, p, why, t = now) => { const x = s.pos[i], got = x.qty * p * (1 - COST(x.sym)); s.cash += got; s.closed.push({ sym: x.sym, tin: x.t, tout: t, pin: x.price, pout: p, pnl: got - x.cost, cost: x.cost }); s.pos.splice(i, 1); log(x.sym, 'VENDA', why, p, got / x.cost - 1, t); };
  const value = () => s.cash + s.pos.reduce((v, x) => v + x.qty * (price(x.sym) || x.price), 0);
  const X = AN[tf];
  s.blocked = null;
  if (b.ligado) {
    // 1) alvo/perda hora a hora desde a última checagem (na mesma hora, a perda conta primeiro: mais conservador)
    for (let i = s.pos.length - 1; i >= 0; i--) {
      const x = s.pos[i], hs = H[x.sym]; if (!hs) continue;
      const k1 = 1 - COST(x.sym), pTp = (1 + x.tp) * x.cost / (x.qty * k1), pSl = (1 - x.sl) * x.cost / (x.qty * k1);
      for (const k of hs) {
        if (k.t < (x.chk || x.t)) continue;
        if (k.l <= pSl) { sell(i, Math.min(pSl, k.o), `Limite de perda atingido (${pct(-x.sl)}) às ${fmtH(k.t)}`, k.end); break; }
        if (k.h >= pTp) { sell(i, Math.max(pTp, k.o), `Alvo de lucro atingido (${pct(x.tp)}) às ${fmtH(k.t)}`, k.end); break; }
      }
    }
    // 2) alvo/perda pelo preço de agora e saída pela regra
    for (let i = s.pos.length - 1; i >= 0; i--) {
      const x = s.pos[i], p = price(x.sym), a = X[x.sym]?.a; if (!p) continue;
      const r = x.qty * p * (1 - COST(x.sym)) / x.cost - 1;
      const why = r >= x.tp ? `Alvo de lucro atingido (${pct(x.tp)})` : r <= -x.sl ? `Limite de perda atingido (${pct(-x.sl)})` : (a && (a.sig === 'SELL' || a.sig === 'WAIT')) ? 'A regra da moeda deu saída' : null;
      if (why) sell(i, p, why); else x.chk = now;
    }
    // 3) TioPatinhas recolhe o lucro realizado quando chega ao gatilho
    const pend = s.closed.reduce((v, x) => v + x.pnl, 0) + (s.trimmedPnl || 0) - s.swept;
    if (TIO.ligado && pend >= s.start * TIO.gatilhoPercentual / 100 && s.cash > 0) {
      const amt = Math.min(pend, s.cash);
      s.cash -= amt; s.swept += amt; st.tio.vault += amt;
      st.tio.sweeps.push({ t: now, bot: b.id, amt });
      if (st.tio.sweeps.length > 500) st.tio.sweeps = st.tio.sweeps.slice(-500);
      log('—', 'RECOLHE', `TioPatinhas recolheu o lucro realizado (passou de ${TIO.gatilhoPercentual}% do capital)`, amt, null);
    }
    // 4) freio por perda: pausa as compras; as vendas continuam normalmente
    s.value = value();
    if (s.paused && now >= s.paused.until) {
      s.brakeBase = total(s); s.paused = null;
      log('—', 'RETOMA', `Fim da pausa de ${PROT.pausaDoFreioDias} dias; o freio passa a contar a partir do valor atual`, null, null);
    }
    if (!s.paused && PROT.freioPerdaPercentual > 0 && total(s) <= s.brakeBase * (1 - PROT.freioPerdaPercentual / 100)) {
      s.paused = { t: now, until: now + PROT.pausaDoFreioDias * DAY };
      log('—', 'PAUSA', `Freio acionado: perdeu ${PROT.freioPerdaPercentual}% ou mais; compras pausadas por ${PROT.pausaDoFreioDias} dias`, null, total(s) / s.brakeBase - 1);
    }
    // 5) novas compras com o que sobrou em caixa
    if (s.paused) s.blocked = `Freio por perda: compras pausadas até ${fmtH(s.paused.until)}`;
    else if (useFilter && !regime.ok) s.blocked = 'Filtro de mercado: Bitcoin abaixo da média de 200 dias';
    else {
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
        s.cash -= amt; s.pos.push({ sym: k.c.sym, qty: amt * (1 - COST(k.c.sym)) / k.p, price: k.p, cost: amt, t: now, tp: k.tp, sl: k.sl }); s.done[k.c.sym] = k.d.t[k.a.k];
        log(k.c.sym, 'COMPRA', (k.a.sig === 'BUY' ? 'Gatilho de compra validado' : 'Regra comprada e preço ainda perto da entrada') + ' · ' + k.a.best.s.name, k.p, null);
      }
    }
  }
  if (s.closed.length > 500) { s.trimmedPnl = (s.trimmedPnl || 0) + s.closed.slice(0, -500).reduce((v, x) => v + x.pnl, 0); s.closed = s.closed.slice(-500); }
  s.value = value();
  // pior queda desde o início (sobre o total: em negociação + recolhido)
  s.peak = Math.max(s.peak, total(s)); s.maxDD = Math.max(s.maxDD, 1 - total(s) / s.peak);
  // referência: quanto teria rendido segurar Bitcoin no mesmo período
  s.bench.ret = BTC.last / s.bench.btc0 - 1;
  // selo "pronto para real"
  const res = result(s), n = s.closed.length;
  const checks = [
    { ok: n >= READY.minimoOperacoes, txt: `${n} de ${READY.minimoOperacoes} operações encerradas` },
    { ok: res > 0, txt: `resultado ${pct(res, 2)} depois dos custos` },
    { ok: res > s.bench.ret, txt: `segurar Bitcoin no mesmo período: ${pct(s.bench.ret, 2)}` },
    { ok: s.maxDD < READY.quedaMaximaPercentual / 100, txt: `pior queda ${s.maxDD > 0.00005 ? '−' + (s.maxDD * 100).toFixed(2).replace('.', ',') + '%' : 'nenhuma até agora'} (limite ${READY.quedaMaximaPercentual}%)` },
  ];
  s.ready = { ok: checks.every(c => c.ok), checks };
  s.name = String(P.nome || b.id).slice(0, 40); s.on = !!b.ligado; s.filter = useFilter;
  s.cfg = { frac, max, tpM, slM, entry: onlyNew ? 'BUY' : 'ALL', tf };
  s.evolved = !!st.evo.overrides[b.id];
  s.buyable = COINS.filter(c => X[c.sym]?.a.valid && (X[c.sym].a.sig === 'BUY' || X[c.sym].a.sig === 'HOLD')).map(c => c.sym);
}
for (const id of Object.keys(st.bots)) if (!BOTS.some(b => b.id === id)) st.bots[id].on = false; // bot retirado do config: fica guardado, desligado

// seleção automática: troca o preset do pior bot por uma variação do melhor
if (EVO.ligado && now - st.evo.last >= EVO.intervaloDias * DAY) {
  st.evo.last = now;
  const elig = BOTS.filter(b => b.ligado && st.bots[b.id].closed.length >= EVO.minimoOperacoes).map(b => ({ b, s: st.bots[b.id], r: result(st.bots[b.id]) })).sort((x, y) => y.r - x.r);
  if (elig.length >= 2 && (elig[0].r - elig[elig.length - 1].r) * 100 >= EVO.diferencaMinimaPercentual) {
    const best = elig[0], worst = elig[elig.length - 1], bp = presetOf(best.b);
    const STEPS = { alvo: [0.5, 0.75, 1, 1.5], perda: [0.5, 0.75, 1, 1.5], percentualPorOperacao: [10, 20, 25, 33, 50], maximoDeMoedas: [1, 2, 3, 4, 5, 6, 8], periodo: ['1d', '4h'], entrada: ['gatilho', 'ampla'] };
    const keys = Object.keys(STEPS), key = keys[(st.evo.gen + Math.floor(now / DAY)) % keys.length], list = STEPS[key];
    const i = Math.max(0, list.indexOf(bp[key])), j = i + 1 < list.length ? i + 1 : i - 1;
    const np = { periodo: bp.periodo, percentualPorOperacao: bp.percentualPorOperacao, maximoDeMoedas: bp.maximoDeMoedas, alvo: bp.alvo, perda: bp.perda, entrada: bp.entrada, [key]: list[j] };
    const ws = worst.s;
    for (let k = ws.pos.length - 1; k >= 0; k--) { const x = ws.pos[k], p = price(x.sym) || x.price, got = x.qty * p * (1 - COST(x.sym)); ws.cash += got; ws.closed.push({ sym: x.sym, tin: x.t, tout: now, pin: x.price, pout: p, pnl: got - x.cost, cost: x.cost }); ws.pos.splice(k, 1); }
    ws.value = ws.cash;
    const { id: _i, nome: _n, ligado: _l, filtroMercado: _f, ...wp } = presetOf(worst.b);
    const arch = { t: now, preset: wp, result: result(ws), n: ws.closed.length, swept: ws.swept };
    const fresh = newWallet(); fresh.archive = (ws.archive || []).concat([arch]).slice(-20);
    fresh.log = ws.log; st.bots[worst.b.id] = fresh;
    st.evo.overrides[worst.b.id] = np; st.evo.gen++;
    const txt = `Seleção automática: ${worst.b.id} (${pct(worst.r, 2)}) recebeu uma variação do preset do ${best.b.id} (${pct(best.r, 2)}): ${key} = ${list[j]}. Carteira reiniciada com R$ 1.000.`;
    st.evo.history.push({ t: now, worst: worst.b.id, best: best.b.id, key, value: list[j], worstRes: worst.r, bestRes: best.r });
    st.evo.history = st.evo.history.slice(-50);
    fresh.log.push({ t: now, sym: '—', act: 'EVOLUI', why: txt, p: null, r: null });
    events.push({ t: now, bot: worst.b.id, name: worst.b.nome, sym: '—', act: 'EVOLUI', why: txt });
    Object.assign(fresh, { name: worst.b.nome, on: true, filter: worst.s.filter, evolved: true, buyable: [], ready: { ok: false, checks: [] },
      cfg: { frac: np.percentualPorOperacao / 100, max: np.maximoDeMoedas, tpM: np.alvo, slM: np.perda, entry: np.entrada === 'gatilho' ? 'BUY' : 'ALL', tf: np.periodo } });
    fresh.bench.ret = 0;
  }
}

st.tio.on = !!TIO.ligado; st.tio.pct = TIO.gatilhoPercentual;
st.protect = { filter: PROT.filtroMercado, brakePct: PROT.freioPerdaPercentual, pauseDays: PROT.pausaDoFreioDias };
st.readyRule = READY; st.evoRule = EVO;
st.updated = now; st.runs = (st.runs || 0) + 1; st.usdbrl = usdbrl;
st.marks = Object.fromEntries(Object.keys(DATA['1d']).map(s => [s, DATA['1d'][s].last]));

// ---- avisos no celular (ntfy e/ou Telegram) ----
const NTFY = process.env.NTFY_TOPIC, TG = process.env.TELEGRAM_TOKEN, TGC = process.env.TELEGRAM_CHAT_ID;
st.notify = { ntfy: !!NTFY, telegram: !!(TG && TGC) };
async function send(title, text) {
  const out = [];
  if (NTFY) out.push(fetch('https://ntfy.sh/' + encodeURIComponent(NTFY), { method: 'POST', headers: { Title: title.normalize('NFD').replace(/[̀-ͯ]/g, '') }, body: text, signal: AbortSignal.timeout(15000) }).catch(e => console.warn('ntfy', e.message)));
  if (TG && TGC) out.push(fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TGC, text: title + '\n\n' + text }), signal: AbortSignal.timeout(15000) }).catch(e => console.warn('telegram', e.message)));
  await Promise.all(out);
}
const ICON = { COMPRA: '🟢', VENDA: '🔴', RECOLHE: '💰', PAUSA: '⛔', RETOMA: '▶️', EVOLUI: '🧬' };
if (events.length && (NTFY || TG)) {
  const lines = events.sort((x, y) => x.t - y.t).map(e => {
    if (e.act === 'COMPRA') return `${ICON.COMPRA} ${e.bot} comprou ${e.sym} a US$ ${e.p}`;
    if (e.act === 'VENDA') return `${ICON.VENDA} ${e.bot} vendeu ${e.sym} (${pct(e.r, 2)}) · ${e.why}`;
    if (e.act === 'RECOLHE') return `${ICON.RECOLHE} TioPatinhas recolheu ${brl(e.p)} do ${e.bot}`;
    return `${ICON[e.act] || '•'} ${e.bot}: ${e.why}`;
  });
  await send(`Cripto Pro: ${events.length} decisão(ões) dos bots`, lines.join('\n') + `\n\nCofre do TioPatinhas: ${brl(st.tio.vault)}. Tudo simulado.`);
}
const spNow = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const today = spNow.toISOString().slice(0, 10);
if ((NTFY || TG) && spNow.getHours() >= NOTE.resumoDiarioHora && st.lastDaily !== today) {
  st.lastDaily = today;
  const rank = BOTS.map(b => ({ id: b.id, s: st.bots[b.id] })).sort((x, y) => result(y.s) - result(x.s));
  const body = `Mercado: ${regime.ok ? 'Bitcoin acima da média de 200 dias (compras liberadas)' : 'Bitcoin abaixo da média de 200 dias (filtro segura as compras)'}.\n` +
    rank.map((x, i) => `${i + 1}º ${x.id} ${x.s.name}: ${pct(result(x.s), 2)} · ${x.s.closed.length} operação(ões)${x.s.paused ? ' · PAUSADO' : ''}${x.s.ready.ok ? ' · PRONTO' : ''}`).join('\n') +
    `\n\nCofre do TioPatinhas: ${brl(st.tio.vault)}. Segurar Bitcoin desde 16/11: ${pct(BTC.last / btcAt(st.since) - 1, 2)}. Tudo simulado.`;
  await send('Cripto Pro: resumo do dia', body);
}

fs.mkdirSync(path.dirname(path.resolve(statePath)), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(st));
console.log(`ok · ${TFS.join('+')} · mercado ${regime.ok ? 'liberado' : 'filtro ativo'} · validadas 1d=${st.validated['1d'].length} 4h=${(st.validated['4h'] || []).length} · ` +
  BOTS.map(b => `${b.id} ${pct(result(st.bots[b.id]), 2)} ${st.bots[b.id].pos.length}p${st.bots[b.id].paused ? ' PAUSA' : ''}`).join(' · ') + ` · cofre ${st.tio.vault.toFixed(2)} USD · ${events.length} eventos`);
