# Histórico de versões

Formato: MAIOR.MENOR.CORREÇÃO — MAIOR em reformulações grandes, MENOR quando entra função nova, CORREÇÃO em ajustes.

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
