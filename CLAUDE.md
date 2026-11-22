# Cripto Pro — regras do projeto

A cada mudança que altere o comportamento ou a interface do app:

1. Suba a versão em `index.html` (`APP_VERSION`) e use o mesmo número no nome do cache em `sw.js` (`cripto-pro-<versão>`), para os aparelhos receberem a atualização. Ao trocar o número, leia o arquivo antes de reabri-lo para escrita (abrir para escrita primeiro apaga o conteúdo) e confira depois com `node --check sw.js` que ele não ficou vazio.
2. Acrescente a entrada no topo de `CHANGELOG.md` (data e o que mudou, em português simples).
3. Atualize o manual do usuário (doc "Cripto Pro — Manual do usuário", https://claude.ai/artifact/SgT7byRLPinTaZYNtKBmJ4): a seção afetada, o número da versão no topo e a tabela da seção 13.

Outras regras:
- O motor de análise fica entre `//<core>` e `//</core>` em `index.html`; `bot/run.mjs` lê esse trecho, então mantenha-o sem dependência de DOM.
- `bot/config.json` lista os bots em segundo plano (ids `BG01`…`BG12`; `universo: "altcoins"` usa a lista `universos.altcoins.candidatas`, filtrada na Binance a cada checagem, com custo `custoPorLado`); cada um tem carteira simulada própria no ramo `bot-data` (`state.json`, formato v2). Retirar um bot do config só o desliga; o histórico fica guardado.
- Por bot: `validacao` (`rigorosa` padrão, `simples`, `nenhuma`) e `periodo` (`1d`, `4h`, `1h`, `15m`). Grupo “protegido” = rigorosa + filtro; os demais são “exploração”.
- TioPatinhas (`tioPatinhas` no config, estado em `state.tio`): recolhe o lucro realizado de cada bot ao atingir `gatilhoPercentual`% do capital; `swept` de cada bot guarda o total recolhido. Resultado de um bot = valor + swept − start.
- Proteções e critérios ficam em `bot/config.json` (`protecoes`, `prontoParaReal`, `selecaoAutomatica`, `avisos`). A seleção automática grava presets ajustados em `state.evo.overrides` (o config continua sendo a base).
- Custos por moeda: `COST(sym)` no motor (taxa + perda entre compra e venda). Toda conta de dinheiro simulado usa `COST`, não `FEE`.
- Avisos usam os segredos do repositório `NTFY_TOPIC`, `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` (nunca no código).
- Os bots são sempre simulados. Ordens reais só pelo fluxo manual da área segura (revisar → testar → confirmar).
- Nunca gravar chaves, senhas ou tokens no repositório (ele é público).
- Textos do app e do manual em português do Brasil, para usuário leigo.
