# Módulo 2. Domínio, contratos e modelo de dados

## Objetivo

Transformar o PRD em um núcleo de domínio explícito, com estados, regras, persistência e contratos coerentes. Este módulo deve reduzir ambiguidade antes da implementação dos fluxos e impedir que decisões críticas de negócio fiquem espalhadas em handlers, componentes ou jobs.

## Resultado esperado

- Entidades centrais e invariantes de negócio formalizados.
- Máquina de estados do arquivo documentada e refletida em tipos do sistema.
- Esquema relacional inicial desenhado para lookup por token, lifecycle e moderação.
- Contratos de entrada, saída e erro compartilháveis entre web, API e worker.
- Migrations iniciais preparadas para bootstrap e evolução incremental.

## Escopo do módulo

- Modelagem conceitual do domínio.
- Definição de estados, transições e invariantes.
- Desenho do banco de dados e índices principais.
- Definição de schemas de validação e envelopes de resposta.
- Criação de migrations iniciais e seeds técnicas mínimas.

## Entidades centrais

- Arquivo compartilhado.
- Política de compartilhamento.
- Evento de download.
- Report.
- Sessão administrativa.
- Configuração operacional.
- Anomalia operacional e jobs de sistema.

## Fase 1. Modelagem conceitual do domínio

### Objetivo da fase

Definir o vocabulário oficial do sistema e impedir divergências entre produto, backend, frontend e jobs operacionais.

### Máquina de estados do arquivo

Estados mínimos previstos:

- `pending_upload`: metadata criada, mas sem garantia de objeto consistente.
- `active`: arquivo publicamente acessível dentro das regras configuradas.
- `expiring`: estado opcional de transição para fins operacionais ou visuais.
- `expired`: indisponível por regra temporal.
- `hidden`: indisponível por moderação automática ou manual.
- `deleted`: removido por ação administrativa ou cleanup definitivo.
- `consumed`: arquivo one-time já consumido.
- `missing`: estado técnico opcional para inconsistência detectada pelo reconciler.

### Invariantes obrigatórios

- Preview não pode coexistir com one-time download.
- Expiração máxima é de 30 dias.
- A identidade do uploader não é armazenada como dado de produto.
- O token público precisa ser imprevisível e único.
- Um arquivo expirado, hidden, deleted, consumed ou missing nunca é publicamente acessível.

### Atividades detalhadas

- Descrever entidades e seus campos essenciais em termos de domínio, antes do banco.
- Diferenciar regras puras de negócio de regras dependentes de infraestrutura.
- Definir transições válidas e inválidas por evento.
- Mapear quais transições são automáticas, manuais ou derivadas de reconciliação.
- Consolidar mensagens de indisponibilidade por estado para uso consistente em UI e API.

### Critérios de aceite da fase

- O time consegue responder, sem ambiguidade, qual estado um arquivo pode assumir e por quê.
- Toda regra do PRD relevante para disponibilidade pública está representada no domínio.

## Fase 2. Desenho do banco de dados

### Objetivo da fase

Projetar uma estrutura relacional que suporte os acessos críticos do produto e da operação desde o v1, sem inflar o schema com abstrações desnecessárias.

### Tabelas principais sugeridas

- `files`: metadata central do arquivo.
- `file_policies` ou colunas embutidas em `files`, conforme simplicidade desejada.
- `download_events`: trilha de início, sucesso, falha e contexto operacional.
- `reports`: denúncias públicas.
- `report_actions` ou campos de resolução, caso o histórico precise ser explícito.
- `admin_sessions`: sessões administrativas autenticadas.
- `system_settings`: thresholds e parâmetros operacionais.
- `operational_anomalies`: inconsistências detectadas pelo reconciler.

### Campos críticos para `files`

- `id` interno.
- `token` público único.
- `object_key` interno desacoplado do nome do arquivo.
- `original_filename` e `sanitized_filename`.
- `mime_type`.
- `size_bytes`.
- `status`.
- `allow_preview`.
- `one_time_download`.
- `expires_at`.
- `uploaded_at`, `activated_at`, `consumed_at`, `deleted_at`.
- `report_count` e metadados operacionais derivados, quando fizer sentido.

### Índices prioritários

- Lookup por `token`.
- Filtros por `status`.
- Consultas por `expires_at`.
- Ordenação de arquivos recentes no dashboard.
- Filtros por volume de reports.
- Consultas por `object_key` para reconciliação e diagnóstico.

### Atividades detalhadas

- Definir enums persistidos coerentes com o modelo de domínio.
- Escolher entre colunas embutidas e tabelas auxiliares com base na complexidade real do v1.
- Modelar granularidade dos eventos de download para analytics e enforcement de one-time.
- Modelar reports com motivo, mensagem opcional, status e resultado de moderação.
- Preparar o schema para auditoria mínima de ações administrativas.

### Critérios de aceite da fase

- O schema suporta as queries críticas sem depender de joins ou scans desnecessários.
- O modelo consegue representar lifecycle, moderação, dashboard e reconciliação sem gambiarras semânticas.

## Fase 3. Contratos de entrada, saída e erro

### Objetivo da fase

Padronizar a fronteira entre consumidores e produtores de dados para impedir drift entre frontend, API e worker.

### Contratos que precisam existir

- Upload: metadados do arquivo e opções de compartilhamento.
- Share page: resposta de metadata pública e estado de disponibilidade.
- Download e preview: respostas de autorização/entrega e estados de bloqueio.
- Report: entrada e confirmação de criação.
- Auth admin: login, callback, sessão e negação de acesso.
- Ações de moderação: hide, restore, delete, dismiss, resolve.
- Jobs internos: expiração, cleanup, reconciliação e auto-hide.

### Semântica de erro recomendada

- `400`: payload inválido.
- `401`: autenticação ausente.
- `403`: autenticado, mas não autorizado.
- `404`: recurso inexistente ou não revelável.
- `409`: conflito de estado, especialmente em one-time ou transições inválidas.
- `410`: recurso anteriormente válido, agora indisponível por expiração ou consumo.
- `413`: arquivo acima do limite.
- `429`: limite excedido.

### Atividades detalhadas

- Definir schemas com biblioteca única de validação compartilhável.
- Padronizar envelopes de sucesso e erro, incluindo códigos semânticos internos quando necessário.
- Formalizar payloads mínimos para jobs, evitando acoplamento com modelos de banco completos.
- Garantir que mensagens de estado indisponível sejam específicas e consistentes.
- Evitar duplicação de tipos entre UI, API e worker.

### Critérios de aceite da fase

- Um único pacote de contratos atende frontend, API e worker.
- Erros de domínio e de validação são previsíveis e têm semântica clara.

## Fase 4. Migrações e bootstrap inicial

### Objetivo da fase

Materializar o modelo em migrations confiáveis e garantir que o projeto possa subir um banco do zero ou evoluir incrementalmente sem drift.

### Atividades detalhadas

- Criar migrations iniciais no Drizzle com constraints e índices principais.
- Preparar seeds técnicas mínimas para thresholds operacionais e configuração padrão.
- Testar criação do banco em ambiente limpo.
- Testar aplicação incremental em banco já existente.
- Documentar o fluxo oficial para adicionar migrations futuras.

### Cuidados obrigatórios

- Não depender de ajustes manuais pós-migration.
- Garantir reprodutibilidade em local e CI.
- Evitar nomes ambíguos de enums, índices e constraints.

### Critérios de aceite da fase

- O banco sobe do zero com migrations oficiais.
- Alterações incrementais seguem um fluxo documentado e reproduzível.
- Seeds técnicas não mascaram configuração necessária de produção.

## Riscos principais do módulo

- Modelar o estado do arquivo de forma simplista demais e empurrar exceções para handlers distribuídos.
- Tratar o schema apenas como persistência, sem refletir de verdade o domínio.
- Duplicar contratos e permitir divergência silenciosa entre frontend e backend.

## Mitigações recomendadas

- Documentar a máquina de estados antes de implementar o fluxo público.
- Projetar o banco a partir dos acessos críticos reais do PRD.
- Usar um pacote único de contratos e validação compartilhada.

## Dependências para módulos seguintes

- Módulos 3, 4, 5, 6 e 7 dependem diretamente deste módulo.
- O worker de lifecycle e o dashboard admin exigem estados e transições estabilizados aqui.

## Critérios de saída do módulo

- Domínio central formalizado.
- Schema inicial desenhado e migrável.
- Contratos compartilháveis prontos para uso.
- Estados, transições e mensagens de indisponibilidade definidos.
- Base pronta para implementar upload, acesso público, moderação e operação sem reinterpretação contínua do PRD.