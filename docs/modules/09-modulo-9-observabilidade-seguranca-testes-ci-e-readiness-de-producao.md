# Módulo 9. Observabilidade, segurança, testes, CI e readiness de produção

## Objetivo

Encerrar o ciclo com maturidade operacional real. Este módulo consolida logs, segurança transversal, testes críticos, pipeline automatizado, estratégia de deploy e checklist final de readiness.

## Resultado esperado

- Observabilidade coerente entre HTTP, jobs e ações administrativas.
- Postura mínima de segurança para um produto público anônimo.
- Cobertura de testes focada nas regras críticas do PRD.
- Pipeline de CI reprodutível com dependências containerizadas.
- Estratégia de deploy e hardening suficiente para publicação portfolio-grade.

## Escopo do módulo

- Logging estruturado e correlação.
- Segurança transversal de páginas, APIs e dados sensíveis.
- Testes unitários, integração e concorrência.
- CI com validação de schema e dependências locais.
- Deploy, backups, troubleshooting e readiness final.

## Fase 1. Observabilidade e segurança transversal

### Objetivo da fase

Consolidar a capacidade de entender o sistema em produção e reduzir exposição indevida de dados ou superfícies públicas.

### Eventos mínimos obrigatórios

- `upload.created`
- `download.started`
- `download.completed`
- `report.created`
- `file.hidden`
- `file.deleted`

### Controles mínimos obrigatórios

- Correlação entre request HTTP, job assíncrono e ação administrativa.
- `noindex` em share pages.
- Revisão de headers de segurança e cache.
- Revisão de dados sensíveis em logs e respostas.
- Health endpoints para web, API, worker e dependências essenciais.

### Atividades detalhadas

- Padronizar o schema de logs e os campos obrigatórios.
- Garantir que eventos de produto e operação tenham semântica consistente.
- Revisar cache control e exposição de metadata em páginas públicas.
- Definir healthchecks úteis para orquestração e monitoramento.

### Critérios de aceite da fase

- O sistema emite sinais suficientes para diagnosticar falhas e comportamento anômalo.
- Não há exposição desnecessária de dados sensíveis em logs ou interfaces.

## Fase 2. Testes de domínio e integração

### Objetivo da fase

Cobrir com prioridade as garantias que não podem falhar sem comprometer o produto.

### Áreas críticas de teste

- Regras de estado do arquivo.
- Validação de políticas de compartilhamento.
- Upload e criação de share link.
- Acesso público, report e moderação.
- Fluxo one-time sob concorrência.
- Expiração, cleanup e reconciliação com falha parcial.
- Auth admin e autorização de rotas.

### Atividades detalhadas

- Escrever testes unitários para regras puras do domínio.
- Escrever testes de integração para fluxos HTTP principais.
- Cobrir concorrência no one-time com cenários reais de disputa.
- Validar expiração e cleanup em combinação com filas e storage local.
- Garantir que testes usem dependências reproduzíveis e locais.

### Critérios de aceite da fase

- Os fluxos mais sensíveis do produto possuem testes automatizados defensáveis.
- O pipeline consegue detectar regressões em regras críticas de negócio.

## Fase 3. CI e qualidade automatizada

### Objetivo da fase

Reproduzir automaticamente o padrão mínimo de qualidade esperado para merge e publicação.

### Etapas mínimas do pipeline

- Instalação de dependências.
- Lint.
- Typecheck.
- Testes.
- Validação de migrations.
- Subida de serviços containerizados quando necessário.

### Atividades detalhadas

- Montar pipeline com PostgreSQL, Redis e storage S3-compatible em ambiente automatizado.
- Garantir falha do pipeline para drift entre schema, contratos e implementação.
- Otimizar cache e paralelização sem reduzir confiabilidade.
- Documentar critérios de bloqueio versus sinalização informativa.

### Critérios de aceite da fase

- O pipeline reflete com fidelidade o que o projeto considera pronto para merge.
- O ambiente automatizado reproduz dependências relevantes do desenvolvimento local.

## Fase 4. Deploy e hardening

### Objetivo da fase

Definir a topologia de produção e endurecer o sistema contra falhas previsíveis de configuração, conectividade e operação.

### Atividades detalhadas

- Definir topologia de deploy para web, API e worker.
- Externalizar secrets e configuração por ambiente.
- Validar comportamento com provider S3-like real, além do MinIO local.
- Revisar timeouts, retries, reconnect e failover básico de dependências.
- Preparar backup lógico de metadata e procedimento mínimo de recuperação.

### Critérios de aceite da fase

- Existe um caminho claro e documentado para colocar o sistema no ar.
- Dependências indisponíveis temporariamente não quebram o sistema de forma caótica quando há mitigação segura.

## Fase 5. Readiness final

### Objetivo da fase

Consolidar a passagem de um sistema funcional para um sistema publicável e defensável em contexto de portfolio.

### Checklist final sugerido

- Upload bem-sucedido.
- Geração e cópia de share link.
- Abertura de share page.
- Preview elegível.
- Download padrão.
- Consumo one-time sob uso real.
- Expiração refletida corretamente.
- Report e auto-hide.
- Login admin.
- Dashboard com dados operacionais.

### Atividades detalhadas

- Executar checklist manual completo dos fluxos críticos.
- Revisar aderência às métricas técnicas e de produto do PRD.
- Revisar custo operacional esperado e gargalos conhecidos.
- Consolidar documentação de operação, troubleshooting e roadmap pós-v1.
- Separar claramente o que é requisito de go-live do que é melhoria futura.

### Critérios de aceite da fase

- O produto pode ser publicado com entendimento claro de limites, riscos e procedimentos operacionais.
- Existe documentação suficiente para operar, depurar e evoluir o sistema com segurança.

## Riscos principais do módulo

- Tratar observabilidade e testes como polimento tardio, em vez de requisito de confiança.
- Criar CI que valida apenas lint e typecheck, mas ignora dependências reais do sistema.
- Publicar o projeto sem estratégia mínima de recuperação operacional.

## Mitigações recomendadas

- Priorizar testes e logs nas garantias críticas do PRD.
- Incluir PostgreSQL, Redis e storage S3-like também no pipeline automatizado.
- Formalizar backups, troubleshooting e healthchecks antes do go-live.

## Dependências encerradas por este módulo

- Este módulo consolida e valida os módulos 1 a 8.
- A readiness final depende da estabilidade de upload, lifecycle, moderação e admin já implementados.

## Critérios de saída do módulo

- Logs, métricas e healthchecks coerentes.
- Cobertura automatizada dos fluxos críticos.
- Pipeline de CI útil e confiável.
- Estratégia de deploy e recuperação documentada.
- Sistema pronto para publicação com postura operacional compatível com um projeto de portfolio sério.