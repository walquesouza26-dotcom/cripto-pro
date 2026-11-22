# Histórico de versões

Formato: MAIOR.MENOR.CORREÇÃO — MAIOR em reformulações grandes, MENOR quando entra função nova, CORREÇÃO em ajustes.

## 1.8.0 — 2026-11-22
- A equipe passa a ter dois grupos: 4 bots protegidos (BG01, BG03, BG08, BG09: validação rigorosa e filtro de mercado) e 8 de exploração, que operam mesmo em mercado de baixa
- Novo ajuste por bot: validação “rigorosa”, “simples” (lucro no teste cego) ou “nenhuma” (segue o sinal da melhor regra)
- Novo período de 1 hora, com muito mais sinais (BG02 Micro lucro 1h e BG07 Agressivo 1h)
- Bots novos: BG11 Explorador diário e BG12 Altcoins 4h
- Sinais que aparecem entre uma checagem e outra do GitHub não se perdem mais: a janela de “sinal novo” cobre o tempo desde a última checagem
- Cartão de cada bot mostra se ele é “protegido” ou de “exploração”

## 1.7.0 — 2026-11-19
- As altcoins aprovadas no teste (BG09 e BG10) passam a aparecer no Painel, na aba Moeda e na Base, num grupo separado
- Layout novo: cabeçalho fixo, aba Bot dividida em Equipe, Decisões, Regras e Este aparelho, e cartões por bot no lugar da tabela larga
- Resumo ao vivo mais curto: a equipe aparece resumida (melhor, pior, quantos com compras, parados ou pausados)

## 1.6.0 — 2026-11-19
- Teste com altcoins menores: dois bots novos, BG09 Altcoins cauteloso e BG10 Altcoins caçador (sem filtro de mercado), com R$ 1.000 cada
- As moedas do teste saem de uma lista de 46 candidatas da TradingView e são filtradas a cada checagem: par em USDT na Binance, volume mínimo de US$ 10 milhões em 24 horas e pelo menos 365 dias de histórico
- Custo estimado maior para essas moedas (0,25% por lado)
- A aba Bot mostra as moedas aprovadas, as que têm regra validada e as descartadas, com o motivo

## 1.5.1 — 2026-11-19
- Ranking: a coluna “Em negociação” passa a se chamar “Saldo do bot” e mostra se o dinheiro está todo em caixa ou quanto está aplicado em moedas

## 1.5.0 — 2026-11-19
- Referência: cada bot é comparado com “segurar Bitcoin” desde o dia em que começou
- Selo “Pronto para dinheiro real”: 30 operações encerradas, lucro depois dos custos, ganho maior que segurar Bitcoin e pior queda menor que 5%
- Freio por perda: bot que perde 5% pausa as compras por 7 dias (as vendas continuam)
- Filtro de mercado: com o Bitcoin abaixo da média de 200 dias, os bots não compram (o BG06 Diversificado fica sem filtro, como comparação)
- Validação mais rigorosa: a regra precisa de lucro nos 3 períodos do histórico e de pelo menos 3 operações no teste cego
- Custos realistas: além da taxa de 0,1%, a perda entre preço de compra e de venda (0,05% a 0,15% por lado, conforme a moeda)
- Seleção automática: a cada 7 dias, o pior bot recebe uma variação do preset do melhor e recomeça com R$ 1.000
- Avisos no celular por ntfy ou Telegram (precisam ser ativados pelo usuário) e preparo para checagens a cada 15 minutos via cron-job.org
- O bot do aparelho também passa a usar o filtro de mercado, o freio por perda e os custos realistas

## 1.4.0 — 2026-11-19
- Equipe de 8 bots autônomos em segundo plano, cada um com R$ 1.000 simulados e preset diferente: entram BG04 Caçador 4h, BG05 Concentrado, BG06 Diversificado, BG07 Agressivo e BG08 Corta-perda
- Novo TioPatinhas: recolhe para um cofre o lucro realizado de cada bot quando passa de 1% do capital do bot
- Ranking da equipe na aba Bot (resultado = em negociação + recolhido − capital inicial)
- Correção: o arquivo do modo offline (sw.js) estava vazio desde 13/11; restaurado, e agora o app busca a versão mais nova antes de usar a cópia guardada
- Alvo de lucro e limite de perda passam a ser conferidos hora a hora desde a última checagem, para o teste não depender do intervalo irregular do GitHub

## 1.3.0 — 2026-11-16
- Bots autônomos em segundo plano: agora são vários (BG01 Conservador, BG02 Micro lucro, BG03 Paciente), cada um com preset e carteira simulada próprios, inclusive no período de 4 horas
- Aba Bot, Central de bots e Resumo ao vivo mostram todos eles lado a lado, sem precisar colar relatório
- Agendamento do GitHub movido para minutos menos concorridos (7, 22, 37 e 52 de cada hora)

## 1.2.0 — 2026-11-16
- Novo quadro “Resumo ao vivo” no Painel: explica em frases o que o mercado, cada bot e a carteira estão fazendo agora
- Carteiras simuladas passam a separar o resultado das operações do efeito da variação do dólar (o saldo é guardado em dólar)
- Aviso quando o GitHub roda o bot em segundo plano com intervalo maior que o previsto

## 1.1.0 — 2026-11-13
- Nova aba Logs: registro de tudo o que acontece no aparelho (sistema, sinais, carteira, bot, área segura, ordens reais, central e ajustes), com filtro, busca, exportação e limpeza

## 1.0.0 — 2026-11-13
Primeira versão numerada. Reúne:
- Painel de sinais com teste cego (70% treino / 30% teste) e perfil de comportamento por moeda
- Carteira simulada, com compra e venda pela página da moeda
- App instalável (PWA) com layout de celular
- Área segura com senha de 10+ dígitos, chaves criptografadas, saldos e ordens reais (revisar → testar → confirmar)
- Bot do aparelho (simulado) com alvo de lucro, limite de perda e modo de entrada ajustáveis
- Bot em segundo plano (GitHub Actions, simulado)
- Central de bots: ID de aparelho, presets, chave de ativação e relatórios
