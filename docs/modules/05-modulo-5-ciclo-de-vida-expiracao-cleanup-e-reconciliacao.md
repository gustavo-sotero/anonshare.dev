# Módulo 5. Ciclo de vida, expiração, cleanup e reconciliação

## Objetivo

Garantir correção contínua do sistema após o upload, inclusive quando jobs falham, processos reiniciam ou storage e banco divergem. Este módulo protege a integridade temporal e operacional do produto.

## Resultado esperado

- Expiração aplicada imediatamente no nível de leitura.
- Jobs atrasados de expiração e cleanup funcionando com idempotência.
- Reconciliação periódica detectando e corrigindo divergências seguras.
- Backlog de anomalias operacionais visível para o dashboard administrativo.
- Sistema resiliente a reexecução, falha parcial e indisponibilidade temporária de dependências.

## Escopo do módulo

- Política de expiração e bloqueio imediato de acesso.
- Agendamento de jobs por arquivo.
- Cleanup de objetos e atualização de estado persistido.
- Reconciliação entre banco, filas e storage.
- Estratégias de resiliência operacional do worker.

## Fase 1. Política de expiração e leitura consistente

### Objetivo da fase

Separar claramente indisponibilidade imediata do recurso e limpeza assíncrona posterior, evitando que acesso público dependa do sucesso de um job atrasado.

### Regras obrigatórias

- `expires_at` deve ser persistido explicitamente.
- O acesso público deve ser negado assim que o timestamp de expiração for alcançado.
- Arquivos sem expiração continuam acessíveis até mudança de estado por outro motivo.
- A leitura pública e administrativa precisa interpretar os estados de forma consistente.

### Atividades detalhadas

- Garantir que queries de disponibilidade considerem o timestamp de expiração além do estado persistido.
- Definir se haverá estado `expiring` com valor operacional ou apenas visual.
- Formalizar mensagens de indisponibilidade por expiração.
- Diferenciar claramente bloqueio de acesso e remoção física do objeto.

### Critérios de aceite da fase

- Um arquivo expirado fica indisponível mesmo se o job de cleanup ainda não rodou.
- Não há ambiguidade entre estado lógico e estado operacional pós-expiração.

## Fase 2. Jobs atrasados de expiração e limpeza

### Objetivo da fase

Executar remoção de objeto e atualização persistida de forma segura, idempotente e observável.

### Filas sugeridas

- Fila de expiração.
- Fila de cleanup.
- Fila de reconciliação.
- Filas adicionais de moderação ou manutenção, se necessário.

### Atividades detalhadas

- Agendar job de expiração no momento da criação do arquivo, quando houver `expires_at`.
- Encadear cleanup após mudança de elegibilidade do recurso.
- Configurar retries, backoff e retenção de jobs concluídos ou falhos.
- Implementar handlers idempotentes, tolerantes a reexecução.
- Definir job ids e deduplicação para evitar multiplicidade acidental.

### Critérios de aceite da fase

- Reexecuções não causam estados quebrados ou exclusões indevidas.
- Jobs falhos deixam rastros suficientes para troubleshooting e intervenção.

## Fase 3. Reconciliação periódica

### Objetivo da fase

Criar uma garantia secundária de integridade que não dependa apenas de jobs agendados pontualmente.

### Inconsistências mínimas a detectar

- Metadata ativa sem objeto correspondente.
- Objeto órfão sem metadata correspondente.
- Arquivo expirado ainda não refletido em estado operacional.
- Arquivo consumido ou deletado com objeto ainda presente indevidamente.
- Jobs relevantes ausentes, duplicados ou em atraso anormal.

### Atividades detalhadas

- Criar scheduler recorrente para varrer divergências em lote.
- Separar correções automáticas seguras de casos ambíguos que exigem intervenção humana.
- Registrar anomalias com classificação, severidade, contexto e timestamps.
- Emitir métricas agregadas por tipo de inconsistência.
- Alimentar backlog de anomalias para o painel administrativo.

### Critérios de aceite da fase

- O sistema consegue recuperar automaticamente pelo menos os casos seguros definidos.
- Casos ambíguos não passam silenciosamente; viram anomalias rastreáveis.

## Fase 4. Resiliência operacional

### Objetivo da fase

Garantir que o worker continue útil em condições reais de falha, reinício e indisponibilidade temporária.

### Atividades detalhadas

- Tornar todos os handlers de jobs idempotentes.
- Revisar timeouts, reconexão ao Redis e tratamento de perda temporária de conectividade.
- Revalidar schedulers recorrentes e conexões compartilhadas no startup do worker.
- Medir lag, taxa de falha, tentativas médias e tempo de reconciliação.
- Definir logs e alertas mínimos para falha persistente de jobs críticos.

### Critérios de aceite da fase

- Reinício do worker não deixa o sistema sem schedulers recorrentes.
- Falhas transitórias não corrompem estado nem exigem intervenção imediata em casos triviais.

## Observabilidade mínima do módulo

Eventos recomendados:

- `file.expired`
- `file.cleanup_started`
- `file.cleanup_succeeded`
- `file.cleanup_failed`
- `reconciliation.started`
- `reconciliation.completed`
- `reconciliation.anomaly_detected`

Métricas recomendadas:

- lag por fila.
- jobs falhos por tipo.
- tempo médio de cleanup.
- anomalias abertas por categoria.
- percentual de expirações refletidas corretamente.

## Riscos principais do módulo

- Confiar apenas em delayed jobs para integridade temporal.
- Implementar cleanup destrutivo sem idempotência.
- Detectar inconsistências, mas não expô-las operacionalmente.

## Mitigações recomendadas

- Manter bloqueio de acesso desacoplado de cleanup físico.
- Implementar reconciler recorrente como requisito, não opcional.
- Registrar anomalias como artefato operacional explícito.

## Dependências para módulos seguintes

- Módulo 6 depende de estados consistentes para auto-hide e moderação.
- Módulo 7 depende das métricas, anomalias e saúde das filas.
- Módulo 9 depende deste módulo para readiness operacional real.

## Critérios de saída do módulo

- Expiração aplicada corretamente no nível de acesso.
- Cleanup e reconciliação operacionais e idempotentes.
- Anomalias detectáveis e rastreáveis.
- Worker preparado para falha temporária de dependências.
- O sistema não depende de um único job pontual para manter integridade.