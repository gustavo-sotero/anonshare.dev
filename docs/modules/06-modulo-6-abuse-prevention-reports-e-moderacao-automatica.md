# Módulo 6. Abuse prevention, reports e moderação automática

## Objetivo

Reduzir risco operacional e abuso sem impor fricção desnecessária ao fluxo anônimo. Este módulo adiciona controles mínimos, reversíveis e observáveis para denúncias públicas, limitação de abuso e ocultação automática.

## Resultado esperado

- Rate limiting funcional para upload, report e acesso repetido a links públicos.
- Fluxo público de report simples e validado.
- Auto-hide acionado por threshold configurável.
- Trilha de moderação coerente com estados públicos do arquivo.
- Base suficiente para triagem e reversão pelo admin.

## Escopo do módulo

- Redis-backed rate limiting.
- Interface pública de denúncia.
- Persistência de reports e contexto operacional mínimo.
- Regras de auto-hide por threshold.
- Modelo de ações de moderação e auditoria mínima.

## Fase 1. Rate limiting e controles básicos

### Objetivo da fase

Criar uma camada mínima de contenção para ações anônimas de maior risco sem reter dado pessoal em excesso.

### Superfícies que precisam de limitação

- Upload.
- Report.
- Acesso repetido a links públicos.

### Estratégia recomendada

- Usar Redis como backend central de contadores e janelas.
- Identificar origem com IP truncado, hash ou estratégia equivalente de baixa retenção.
- Diferenciar limites por ação e criticidade.

### Atividades detalhadas

- Definir chaves, janelas e thresholds iniciais por tipo de ação.
- Implementar middleware ou camada transversal de limitação.
- Padronizar resposta `429` com mensagem útil e segura.
- Garantir expiração dos contadores e evitar retenção excessiva de dados.
- Medir taxa de bloqueios e falsos positivos operacionais.

### Critérios de aceite da fase

- Ações abusivas triviais são bloqueáveis sem afetar seriamente uso legítimo.
- O mecanismo de limitação não vaza IP bruto desnecessariamente na camada de produto.

## Fase 2. Fluxo público de report

### Objetivo da fase

Permitir que qualquer visitante denuncie um arquivo de forma simples, objetiva e auditável.

### Campos mínimos do report

- Categoria do motivo.
- Contexto livre opcional.
- Timestamp.
- Referência ao arquivo.
- Contexto operacional mínimo da origem.

### Atividades detalhadas

- Adicionar ação de report à página pública do arquivo.
- Construir formulário curto, com validação adequada e linguagem neutra.
- Persistir report com status inicial e trilha temporal.
- Impedir spam repetido da mesma origem em janela curta.
- Emitir evento estruturado de criação de report.

### Critérios de aceite da fase

- O fluxo é simples para o usuário e útil para a operação.
- Reports repetidos da mesma origem em curto intervalo são contidos.

## Fase 3. Auto-hide por threshold

### Objetivo da fase

Reduzir exposição pública de arquivos problemáticos rapidamente, sem misturar ocultação automática com remoção definitiva.

### Regras obrigatórias

- O threshold de auto-hide deve ser configurável.
- Ao atingir o limiar, preview e download públicos devem ser bloqueados imediatamente.
- A ocultação automática precisa ser reversível pelo admin.

### Atividades detalhadas

- Recalcular elegibilidade pública do arquivo a cada report relevante.
- Atualizar status público e trilha de moderação quando o threshold for atingido.
- Garantir que a share page reflita imediatamente o novo estado.
- Registrar evento específico de ocultação automática.

### Critérios de aceite da fase

- Arquivos que atingem o threshold deixam de ser publicamente acessíveis sem depender de ação manual.
- O histórico distingue ocultação automática de ação administrativa deliberada.

## Fase 4. Trilha de moderação

### Objetivo da fase

Modelar a moderação como parte explícita do sistema, e não como um conjunto solto de flags sem contexto.

### Atividades detalhadas

- Definir resultado de moderação como estrutura de domínio clara.
- Registrar quem ocultou, restaurou, deletou, resolveu ou dispensou reports.
- Agregar reports por arquivo e por estado para facilitar triagem.
- Expor relação entre report, status público e ação administrativa.
- Manter o desenho simples o suficiente para o contexto de admin único, mas extensível para o futuro.

### Critérios de aceite da fase

- Cada mudança de disponibilidade motivada por moderação é auditável.
- O dashboard consegue apresentar status de risco e histórico mínimo do arquivo.

## Observabilidade mínima do módulo

Eventos recomendados:

- `rate_limit.blocked`
- `report.created`
- `file.auto_hidden`
- `report.resolved`
- `report.dismissed`
- `file.restored`

Métricas recomendadas:

- volume de reports por dia.
- arquivos auto-hidden por janela.
- taxa de bloqueio por rate limiting.
- reports pendentes por status.

## Riscos principais do módulo

- Configurar thresholds agressivos demais e produzir falsos positivos frequentes.
- Persistir reports sem contexto operacional útil.
- Misturar auto-hide, hide manual e delete definitivo em uma mesma semântica fraca.

## Mitigações recomendadas

- Tornar thresholds configuráveis e revisáveis.
- Preservar trilha mínima de origem, tempo e ação.
- Manter estados e motivos de moderação distintos no domínio.

## Dependências para módulos seguintes

- Módulo 7 depende deste módulo para triagem, filtros e gestão operacional no dashboard.
- Módulo 9 depende das métricas e logs de abuso para postura operacional madura.

## Critérios de saída do módulo

- Rate limiting funcional nas superfícies críticas.
- Fluxo público de report operacional.
- Auto-hide por threshold implementado e reversível.
- Trilha de moderação auditável.
- Camada mínima de controle de abuso alinhada ao risco do produto.