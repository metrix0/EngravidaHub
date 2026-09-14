# Análises de unidades

Cada execução prepara **uma unidade**. A preparação chama, em sequência, os agregados existentes de agenda, análise de conversas e financeiro. Lê até oito resumos de abandono de conversation_analysis, sem mensagens/transcrições. Não há fila global, leases, after(), varredura de jobs, paralelismo entre unidades nem repetição automática.

## Teste imediato (sem Batch)

No terminal, na raiz do projeto com as dependências instaladas e o .env.local existente:

```powershell
node --env-file=.env.local --import tsx scripts/run-unit-analysis.ts test --unit "Bauru" --type weekly --period-end 2026-09-13
```

Troque Bauru pelo nome exato ou UUID da unidade; omita --period-end para usar a data atual no Brasil. A data final é **exclusiva**: o exemplo cobre 06/09 até 12/09. Monthly usa o recorte mensal já existente (dia 30 / último dia de fevereiro).

O comando imprime JSON com report, cards, métricas, tokens de entrada/cache/saída, estimated_cost_usd e tempos por agregado e total. Faz uma chamada normal Responses, com retry desabilitado e timeout de 120 segundos. Não cria arquivos Batch e **não grava o teste no histórico**. Requer OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já configuradas.

Também existe POST autenticado /api/unidades/analises com:
```json
{"mode":"test","unit":"Bauru","type":"weekly","period_end":"2026-09-13"}
```
Mantém a permissão de acesso geral a Dashboard + Assistente.

## Batch e cron externo

Nenhum cron é instalado por esta alteração. O endpoint não usa segredo de cron nem header de autorização.

Para todas as unidades ativas, omita `unit`. No `submit`, omitir `period_end` usa a data atual no Brasil, resolvida uma vez e aplicada a todas as unidades da execução. As unidades são processadas em sequência.

```text
/api/cron/unit-analyses?action=submit&type=weekly
/api/cron/unit-analyses?action=submit&type=monthly
```

Para coletar, também é possível omitir `unit`. Sem `period_end`, o endpoint busca todas as análises Batch ainda em `processing` daquele tipo e usa o período já salvo em cada análise; assim a coleta continua correta mesmo se o lote atravessar a meia-noite.

```text
/api/cron/unit-analyses?action=collect&type=weekly
/api/cron/unit-analyses?action=collect&type=monthly
```

Para executar uma única unidade, informe `unit`; `period_end` continua opcional:

```text
/api/cron/unit-analyses?action=submit&unit=Bauru&type=weekly&period_end=2026-09-13
/api/cron/unit-analyses?action=collect&unit=Bauru&type=weekly&period_end=2026-09-13
```

Se ainda estiver processando, `collect` só devolve o status; não refaz agregados nem submete outro lote. Agende outra coleta externamente.

Alternativa para agendador que executa comandos:
```powershell
node --env-file=.env.local --import tsx scripts/run-unit-analysis.ts submit --unit "Bauru" --type weekly --period-end 2026-09-13
node --env-file=.env.local --import tsx scripts/run-unit-analysis.ts collect --unit "Bauru" --type weekly --period-end 2026-09-13
```

Batch necessariamente usa arquivo de entrada, ID de lote e coleta posterior. Esses IDs ficam no context da análise, sem camada de queue/lease. A chave única de unidade/tipo/período impede preparação duplicada do mesmo período. Jobs existentes (inclusive os exemplos fake) são retornados, nunca sobrescritos por submit. Falhas ficam explícitas; não há retry automático. Se o processo morrer entre criar um lote e salvar seu ID, reconcilie pelo analysis_id nos metadados da OpenAI antes de tentar reenviar. Não há promessa de exactly-once entre provedores.

## Cobertura e evidências

Esta geração é deliberadamente um snapshot de **três agregados**, não um agente com todas as ferramentas do Assistente. O overview de conversas é de WhatsApp; Instagram/Facebook, mídia paga e todas as mensagens não estão incluídos. Os limites/caps dos agregados seguem informados nas métricas. Não calcular conversão entre totais que representem coortes distintas.

O histórico inclui até seis análises anteriores e a última mensal; relatórios históricos têm limite de 12 mil caracteres com indicação de truncamento. Os 20 exemplos marcados model=fake-ui-preview são excluídos do contexto histórico.

O modelo seleciona IDs de análises e conversas. O código valida a correspondência e usa verifiedEvidence() com o texto original armazenado para confirmar a origem; a saída não depende de o modelo copiar o texto literalmente. Isso verifica correspondência com a classificação anterior, **não prova causalidade nem verifica uma fala do cliente**. Evidência inválida ou resposta incompleta não é salva como relatório concluído. Cards usam os resumos existentes, e as conversas podem ser aprofundadas pelo Assistente.

A UI, o mapa e a leitura do histórico permanecem como estavam. Coordenadas das dez unidades estavam nulas na verificação; nenhuma localização foi inventada.

## Custos e validação

Estimativa de tokens para gpt-5.6-luna, taxas consultadas em 13/09/2026: entrada US$0,20/M, cache US$0,02/M, saída US$1,20/M; Batch aplica fator 0,5. Não é recibo de faturamento e não inclui Supabase/servidor. Não soma reasoning_tokens novamente: já integram output_tokens.

Fontes: [modelo](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Batch](https://developers.openai.com/api/docs/guides/batch).

```text
node --import tsx scripts/test-unit-macro.ts
node scripts/test-unit-macro-pipeline.cjs
```
