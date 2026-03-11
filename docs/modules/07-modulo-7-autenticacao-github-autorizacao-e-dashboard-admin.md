# Módulo 7. Autenticação GitHub, autorização e dashboard admin

## Objetivo

Dar controle integral ao operador único sem expandir desnecessariamente a superfície de acesso. Este módulo cobre autenticação GitHub allowlisted, proteção de rotas e dashboard administrativo para operação, moderação e investigação básica.

## Resultado esperado

- Login via GitHub com allowlist por identificador estável.
- Sessão administrativa segura e previsível.
- Shell administrativo distinto das páginas públicas.
- Dashboard com visão de arquivos, reports, downloads, storage, filas e anomalias.
- Ações de moderação e investigação disponíveis ao operador.

## Escopo do módulo

- OAuth com GitHub e política de allowlist.
- Sessões administrativas e middleware de autorização.
- Shell e navegação do admin.
- Visão geral operacional.
- Páginas de arquivos, reports, downloads, storage e anomalias.

## Fase 1. Autenticação e sessão administrativa

### Objetivo da fase

Restringir o acesso administrativo a uma única identidade permitida, com semântica clara de autenticação e autorização.

### Regras obrigatórias

- O login usa GitHub OAuth.
- Apenas um identificador GitHub allowlisted pode concluir autenticação com sucesso.
- Rotas protegidas exigem sessão válida.
- Tentativas negadas devem ser registradas com discrição operacional, sem vazamento indevido de informação.

### Atividades detalhadas

- Implementar fluxo OAuth com callback seguro.
- Verificar allowlist por identificador estável do GitHub, não por nome exibido.
- Persistir sessão administrativa com expiração e estratégia de revogação controlável.
- Criar middleware central de autorização para SSR, server routes e API admin.
- Modelar respostas previsíveis para sessão ausente, expirada ou negada.

### Critérios de aceite da fase

- Usuário não allowlisted não consegue acessar o painel mesmo após autenticar no GitHub.
- Toda superfície administrativa crítica está atrás da mesma política de autorização.

## Fase 2. Shell e navegação do admin

### Objetivo da fase

Criar um espaço operacional distinto da experiência pública, com foco em densidade informacional, legibilidade e previsibilidade.

### Seções mínimas sugeridas

- Visão geral.
- Arquivos.
- Reports.
- Downloads.
- Storage.
- Anomalias e jobs.

### Atividades detalhadas

- Criar layout administrativo com navegação persistente.
- Centralizar obtenção de sessão e autorização no boundary de layout ou middleware.
- Garantir redirecionamento ou bloqueio consistente quando a sessão não for válida.
- Preparar a UI para páginas densas sem depender de recarga integral excessiva.

### Critérios de aceite da fase

- O painel é claramente distinto da interface pública.
- A ausência de sessão válida gera comportamento previsível em toda a área admin.

## Fase 3. Visão geral operacional

### Objetivo da fase

Permitir leitura rápida do estado do sistema, separando métricas de produto e métricas operacionais.

### Indicadores mínimos

- Total de arquivos.
- Arquivos ativos, expirados, hidden, deleted e consumed.
- Volume de downloads.
- Uso de storage.
- Reports pendentes.
- Saúde das filas.
- Anomalias abertas.

### Atividades detalhadas

- Definir queries agregadas eficientes para cards e tabelas-resumo.
- Destacar lag de filas, falhas de jobs e backlog de anomalias.
- Separar claramente indicadores de uso do produto e indicadores de risco operacional.
- Padronizar janelas temporais exibidas no dashboard.

### Critérios de aceite da fase

- O operador consegue identificar rapidamente se há problema de produto, moderação ou operação.
- O dashboard não depende de queries ingênuas que degradem cedo com crescimento de volume.

## Fase 4. Gestão de arquivos e moderação

### Objetivo da fase

Permitir que o administrador inspecione o estado de um arquivo e atue imediatamente sobre sua disponibilidade pública.

### Ações mínimas

- Hide.
- Restore.
- Delete.
- Inspeção de metadata, estado de storage e histórico relevante.

### Atividades detalhadas

- Criar listagem com filtros por status, política, data e volume de reports.
- Criar página de detalhe por arquivo com metadata, eventos, reports associados e estado do objeto.
- Implementar ações administrativas com confirmação adequada para operações destrutivas.
- Refletir mudanças de estado no sistema público imediatamente quando aplicável.

### Critérios de aceite da fase

- O admin consegue moderar e investigar um arquivo sem sair do painel.
- Ações destrutivas têm proteção suficiente e deixam trilha auditável.

## Fase 5. Reports, downloads e anomalias

### Objetivo da fase

Transformar o painel em uma superfície de investigação operacional real, e não apenas em um CRUD de arquivos.

### Atividades detalhadas

- Criar listagem de reports com filtros por status, motivo e urgência.
- Permitir dismiss, resolve e navegação rápida até o arquivo associado.
- Exibir contadores e eventos de download úteis para investigação.
- Destacar objetos ausentes, cleanup falho, expiração não refletida e outras anomalias operacionais.
- Expor arquivos que mais consomem storage ou concentram reports.

### Critérios de aceite da fase

- O operador consegue priorizar risco e custo em uma única interface.
- O painel oferece contexto suficiente para decidir ação sem consultas manuais ao banco.

## Observabilidade mínima do módulo

Eventos recomendados:

- `admin.login_succeeded`
- `admin.login_denied`
- `admin.session_revoked`
- `admin.file_hidden`
- `admin.file_restored`
- `admin.file_deleted`
- `admin.report_resolved`

## Riscos principais do módulo

- Implementar autenticação, mas deixar rotas administrativas auxiliares desprotegidas.
- Basear allowlist em identidade instável do GitHub.
- Criar um dashboard vistoso, porém operacionalmente raso.

## Mitigações recomendadas

- Centralizar autorização em middleware e boundaries comuns.
- Persistir identificador estável do GitHub como base de autorização.
- Projetar o painel em torno de decisões operacionais reais: moderar, investigar, corrigir e priorizar.

## Dependências para módulos seguintes

- Módulo 8 deve manter coesão visual sem confundir público e admin.
- Módulo 9 depende do dashboard e da autenticação para readiness, logging e segurança final.

## Critérios de saída do módulo

- Login admin via GitHub com allowlist operacional.
- Painel com navegação, visão geral e áreas de investigação implementadas.
- Ações de moderação e resolução disponíveis.
- Superfície administrativa coerente com o papel de operador único do projeto.