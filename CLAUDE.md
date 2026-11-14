# Cripto Pro — regras do projeto

A cada mudança que altere o comportamento ou a interface do app:

1. Suba a versão em `index.html` (`APP_VERSION`) e use o mesmo número no nome do cache em `sw.js` (`cripto-pro-<versão>`), para os aparelhos receberem a atualização.
2. Acrescente a entrada no topo de `CHANGELOG.md` (data e o que mudou, em português simples).
3. Atualize o manual do usuário (doc "Cripto Pro — Manual do usuário", https://claude.ai/artifact/SgT7byRLPinTaZYNtKBmJ4): a seção afetada, o número da versão no topo e a tabela da seção 13.

Outras regras:
- O motor de análise fica entre `//<core>` e `//</core>` em `index.html`; `bot/run.mjs` lê esse trecho, então mantenha-o sem dependência de DOM.
- Os bots são sempre simulados. Ordens reais só pelo fluxo manual da área segura (revisar → testar → confirmar).
- Nunca gravar chaves, senhas ou tokens no repositório (ele é público).
- Textos do app e do manual em português do Brasil, para usuário leigo.
