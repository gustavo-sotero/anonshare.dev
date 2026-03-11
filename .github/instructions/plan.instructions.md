---
description: PLAN
applyTo: '**'
---

Plano Mestre

Este plano assume cobertura integral do PRD em uma sequência única, com stack Bun-first, storage compatível com API S3 e sem acoplamento a um provider específico. A decomposição abaixo segue a dependência real do sistema descrito no PRD: primeiro fundação e modelo de domínio, depois fluxo público, depois consistência operacional, moderação, admin e por fim hardening, testes e deploy.

Estrutura lógica recomendada do monorepo:
- pacote da aplicação web pública + admin em TanStack Start
- pacote da API em Hono
- pacote do worker para BullMQ
- pacote compartilhado de domínio, schemas e contratos
- pacote compartilhado de infraestrutura para banco, Redis, storage e observabilidade

Plano Por Módulos

Módulo 1. Fundação do monorepo e plataforma local
Objetivo: sair de um workspace vazio para uma base executável, previsível e preparada para evoluir sem retrabalho.

Fase 1. Bootstrap do workspace.
Etapas:
- inicializar Bun workspaces e definir a topologia de pacotes, separando claramente aplicação web, API, worker e bibliotecas compartilhadas
- definir TypeScript base, project references, aliases, resolução de módulos e estratégia de compartilhamento de tipos entre pacotes
- estabelecer convenções de nomes para apps, libs, variáveis de ambiente, scripts e arquivos de configuração
- definir política de versionamento interno dos pacotes e compatibilidade entre contratos compartilhados e implementações
- documentar comandos mínimos de desenvolvimento, build, teste e migração para reduzir atrito operacional desde o primeiro commit

Fase 2. Infraestrutura local de desenvolvimento.
Etapas:
- subir PostgreSQL, Redis e storage S3-like via Docker Compose com volumes persistentes e isolamento claro de serviços
- adicionar healthchecks, políticas de restart e readiness para evitar falsos positivos durante o bootstrap local
- definir arquivos de ambiente de exemplo para web, API, worker, banco, Redis e storage, com separação entre segredo e configuração pública
- validar conectividade fim a fim entre aplicações e dependências externas em ambiente local
- documentar procedimento de recuperação local para resetar banco, filas e objetos sem impactar artefatos do repositório

Fase 3. Base de execução das aplicações.
Etapas:
- criar a aplicação TanStack Start com rotas públicas, shell administrativo e suporte a SSR seletivo
- criar a aplicação ou pacote Hono com roteamento base para upload, download, report, admin e endpoints internos
- criar o worker BullMQ com bootstrap independente, conexão compartilhada ao Redis e ciclo de vida previsível
- isolar uma camada compartilhada de configuração e observabilidade para evitar divergência entre processos
- definir fronteiras de responsabilidade entre TanStack Start e Hono para impedir mistura caótica entre UI, server routes e API de domínio

Fase 4. Governança técnica inicial.
Etapas:
- configurar lint, format, typecheck e validação de imports cruzados entre pacotes
- configurar validação estrita de variáveis de ambiente no boot para web, API e worker
- padronizar logging estruturado desde o início com campos de correlação, tipo de evento e contexto mínimo por request
- adicionar scripts de verificação local que reproduzam o pipeline esperado de CI
- documentar decisões arquiteturais iniciais que tenham alto potencial de gerar retrabalho se ficarem implícitas

Saída esperada:
- monorepo funcional com dependências locais saudáveis, processos inicializáveis e base técnica estável para os módulos seguintes

Módulo 2. Domínio, contratos e modelo de dados
Objetivo: transformar o PRD em um núcleo de domínio explícito, com estados, regras e persistência coerentes.

Fase 1. Modelagem conceitual do domínio.
Etapas:
- definir entidades centrais: arquivo, política de compartilhamento, evento de download, report, sessão admin, configuração operacional e job de sistema
- formalizar máquina de estados do arquivo com estados como active, expiring, expired, hidden, deleted e consumed
- definir transições válidas, transições inválidas e ações automáticas versus manuais
- consolidar invariantes de negócio, como preview incompatível com one-time, expiração máxima de 30 dias e anonimato do uploader
- separar regras de negócio puras de regras dependentes de infraestrutura, para facilitar testes e evolução

Fase 2. Desenho do banco de dados.
Etapas:
- modelar tabelas, colunas, relacionamentos, enums, chaves e índices principais
- definir estratégia de token de compartilhamento com unicidade forte e lookup eficiente
- modelar armazenamento de eventos de download com granularidade suficiente para analytics e enforcement de one-time
- modelar reports com motivo, mensagem opcional, status, resolução e trilha de moderação
- modelar sessões administrativas, configuração operacional e registro de anomalias do reconciler

Fase 3. Contratos de entrada, saída e erro.
Etapas:
- definir schemas de validação para upload, consulta de share page, download, preview, report, login admin e ações de moderação
- padronizar respostas de sucesso e erro, com semântica consistente para 400, 401, 403, 404, 409, 410, 413 e 429
- definir payloads mínimos para eventos e jobs internos, reduzindo acoplamento entre módulos
- formalizar mensagens de estado indisponível para expired, hidden, deleted, missing e consumed
- garantir que todos os contratos possam ser compartilhados entre frontend, API e worker sem duplicação manual

Fase 4. Migrações e bootstrap inicial.
Etapas:
- criar migrations iniciais em Drizzle com constraints e índices coerentes com o padrão de acesso previsto
- preparar seeds técnicas mínimas para configuração operacional e thresholds padrão
- validar o processo de evolução do schema sem perda de compatibilidade entre ambientes locais e futuros ambientes remotos
- documentar como novas migrations deverão ser adicionadas para evitar drift de práticas no repositório
- testar criação de banco do zero e atualização incremental em banco existente

Saída esperada:
- modelo de domínio estabilizado, banco desenhado para consultas críticas e contratos compartilháveis entre todos os processos

Módulo 3. Ingestão de upload e integração com storage
Objetivo: implementar a entrada segura do arquivo e garantir consistência entre metadata e objeto armazenado.

Fase 1. Estratégia de ingestão.
Etapas:
- definir abordagem inicial de upload para v1 com ênfase em robustez, observabilidade e simplicidade operacional
- desenhar a evolução futura para presigned upload sem comprometer as garantias do v1
- definir limites de request body e alinhar runtime Bun, Hono e infraestrutura reversa para suportar o teto de 256 MB
- decidir formato de armazenamento do objeto, nomes internos, particionamento lógico e metadados mínimos associados ao object key
- registrar explicitamente os trade-offs de custo, throughput e simplicidade da escolha inicial

Fase 2. Validação pré-upload.
Etapas:
- validar tamanho de arquivo, MIME type, nome de arquivo e combinações de opções antes de qualquer persistência definitiva
- sanitizar filename para exibição pública sem perder uma referência útil ao nome original
- gerar token de share não previsível e object key desacoplado de filename e de timestamp simples
- calcular expiration timestamp quando houver retenção configurada, respeitando o teto de 30 dias
- negar combinações inválidas como preview habilitado em arquivo one-time

Fase 3. Persistência consistente entre banco e storage.
Etapas:
- definir ordem segura entre criação de metadata e envio do objeto ao storage
- introduzir estado intermediário de pending upload ou equivalente para impedir publicação prematura
- confirmar promoção para estado ativo apenas quando banco e storage estiverem consistentes
- implementar compensação para falhas parciais, limpando objetos órfãos ou registros incompletos
- registrar eventos estruturados de início, sucesso e falha de upload com contexto suficiente para depuração operacional

Fase 4. Adapter de storage S3-like.
Etapas:
- criar interface de storage com operações explícitas de put, get, head, delete, exists e URL assinada opcional
- garantir compatibilidade com MinIO local e providers S3-like sem codificar regras específicas de um vendor na camada de domínio
- padronizar timeouts, retries, classificação de erros e mapeamento de falhas transitórias versus permanentes
- expor erros de objeto ausente de forma útil para o reconciler e para o dashboard administrativo
- documentar contratos de storage necessários para testes locais e futuros ambientes produtivos

Saída esperada:
- pipeline de upload confiável, consistente e pronto para gerar links compartilháveis sem criar dívida estrutural

Módulo 4. Fluxo público de compartilhamento, download e preview
Objetivo: entregar o fluxo principal do produto com experiência clara para uploader e recipient.

Fase 1. Home de upload e geração de share link.
Etapas:
- construir a landing principal centrada no upload com UX direta e sem ruído de onboarding
- implementar seleção por drag-and-drop e file picker com feedback claro de progresso e validação
- expor controles de expiration, one-time download e preview com linguagem objetiva e consequências visíveis
- enviar upload com tratamento explícito de erro, retry orientado por causa e prevenção de duplicação acidental de submissão
- exibir link final com ações de copiar e abrir imediatamente após sucesso

Fase 2. Página pública do arquivo.
Etapas:
- criar rota pública baseada em token com carregamento SSR ou híbrido adequado para metadata
- exibir filename, tipo, tamanho, data de expiração, flags comportamentais e estado atual do arquivo
- aplicar noindex, headers apropriados e cache control compatível com segurança do recurso
- mapear estados indisponíveis para mensagens específicas, sem reduzir tudo a um erro genérico
- garantir que nenhuma informação sobre o uploader seja exposta em qualquer condição

Fase 3. Download padrão.
Etapas:
- implementar caminho de download para arquivos ativos não consumíveis em one-time
- decidir se a entrega será proxy, redirect curto ou URL assinada efêmera por caso de uso
- registrar download started e download completed em pontos confiáveis do fluxo
- proteger o endpoint contra acesso a arquivos expired, hidden, deleted ou inconsistentes
- alinhar estratégia de cache e bandwidth com o objetivo de reduzir custo operacional sem quebrar regras de acesso

Fase 4. One-time download com consumo atômico.
Etapas:
- tratar one-time como fluxo técnico distinto do download padrão
- usar lock transacional, compare-and-set ou mecanismo equivalente para reservar o consumo antes da entrega do conteúdo
- impedir sucesso duplo em requisições concorrentes ao mesmo token
- definir momento exato da transição para consumed, equilibrando atomicidade e risco de falso consumo em falhas de rede
- registrar eventos e métricas específicas para auditoria e depuração desse fluxo sensível
- projetar fallback para reprocessar estados inconclusivos sem reabrir janela de acesso indevido

Fase 5. Preview controlado.
Etapas:
- definir allowlist explícita de tipos elegíveis para preview e manter a lógica fora da UI pura
- renderizar previews de imagem, vídeo, áudio, PDF e texto simples quando permitido
- bloquear preview para arquivos one-time e para arquivos ocultos, expirados, deletados ou inconsistentes
- manter separação clara entre ações de preview e download para evitar ambiguidade ao usuário
- tratar tipos não suportados com degradação elegante, mantendo download disponível quando válido

Saída esperada:
- fluxo público completo para upload, abertura do link, download e preview dentro das regras do PRD

Módulo 5. Ciclo de vida, expiração, cleanup e reconciliação
Objetivo: garantir correção contínua do sistema após o upload, inclusive diante de falhas de jobs ou inconsistências externas.

Fase 1. Política de expiração e leitura consistente.
Etapas:
- persistir expiration timestamp explícito e nunca inferi-lo apenas a partir de data de criação
- bloquear imediatamente o acesso em nível de aplicação no momento em que o arquivo expira
- definir comportamento de arquivos sem expiração e de estados intermediários como expiring
- garantir que consultas públicas e administrativas interpretem estados de forma consistente
- separar regras de indisponibilidade imediata de regras de cleanup assíncrono

Fase 2. Jobs atrasados de expiração e limpeza.
Etapas:
- agendar jobs BullMQ por arquivo no momento da criação quando houver expiração configurada
- criar jobs de cleanup para remoção do objeto e atualização do estado persistido
- definir retries, backoff, deduplicação e retenção de jobs concluídos ou falhos
- separar filas por categoria funcional para isolar impacto entre expiração, reconciliação e moderação
- padronizar idempotência dos handlers para permitir reexecução segura

Fase 3. Reconciliação periódica.
Etapas:
- criar scheduler recorrente para varrer divergências entre banco, filas e storage
- detectar metadata ativa sem objeto, objeto órfão sem metadata e expiração não refletida no estado
- corrigir automaticamente casos seguros e registrar casos ambíguos como anomalias operacionais
- emitir logs e métricas de reconciliação com contagem por tipo de inconsistência
- alimentar o dashboard com backlog de anomalias pendentes de intervenção humana

Fase 4. Resiliência operacional.
Etapas:
- tornar handlers de jobs totalmente idempotentes e tolerantes a reexecução após crash
- aplicar deduplicação quando múltiplos gatilhos puderem gerar o mesmo trabalho
- revisar timeouts, cancelamento, reconexão ao Redis e recuperação após indisponibilidade temporária
- criar estratégia de startup do worker que revalide schedulers recorrentes e conexões compartilhadas
- medir lag, taxa de falha, tentativas médias e tempo de reconciliação para verificação contra metas técnicas

Saída esperada:
- sistema capaz de manter correção de estado ao longo do tempo, sem depender de um único job pontual para integridade

Módulo 6. Abuse prevention, reports e moderação automática
Objetivo: reduzir risco operacional e abuso sem aumentar fricção desnecessária no fluxo anônimo.

Fase 1. Rate limiting e controles básicos.
Etapas:
- aplicar limites distintos para upload, report e acesso repetido a links públicos
- usar Redis como backend central de contadores e janelas de limitação
- definir chaves de limitação com IP truncado ou hash, evitando retenção excessiva de dado pessoal
- calibrar limites iniciais para reduzir abuso sem prejudicar uso legítimo do produto
- expor motivo de bloqueio com mensagens úteis e seguras para o usuário final

Fase 2. Fluxo público de report.
Etapas:
- adicionar ação de report na página pública do arquivo com acesso simples e pouco invasivo
- coletar categoria de motivo e contexto livre opcional com validação adequada
- impedir spam repetido da mesma origem em curtos intervalos
- persistir report com trilha temporal e contexto operacional mínimo
- registrar evento estruturado de criação de report para fins de observabilidade

Fase 3. Auto-hide por threshold.
Etapas:
- definir threshold configurável para ocultação automática
- recalcular elegibilidade pública do arquivo a cada novo report relevante
- ocultar imediatamente preview e download quando o limiar for atingido
- manter separação entre ocultação automática e remoção definitiva
- permitir reversão administrativa simples e auditável em casos de falso positivo

Fase 4. Trilha de moderação.
Etapas:
- modelar resultado de moderação como parte explícita do domínio, não como nota solta
- registrar quem ocultou, restaurou, deletou ou resolveu reports, mesmo em contexto de admin único
- agregar reports por arquivo e por estado para facilitar triagem no dashboard
- expor relação entre reports, status público e histórico de ações administrativas
- preparar base para futura expansão sem acoplar o desenho atual a múltiplos administradores

Saída esperada:
- camada mínima de moderação funcional, reversível e observável, alinhada aos riscos declarados no PRD

Módulo 7. Autenticação GitHub, autorização e dashboard admin
Objetivo: dar controle integral ao operador único sem expandir desnecessariamente a superfície de acesso.

Fase 1. Autenticação e sessão administrativa.
Etapas:
- implementar login via GitHub OAuth com verificação por identificador estável allowlisted
- negar autenticação e sessão para identidades não permitidas com resposta segura e clara
- persistir sessão administrativa em armazenamento confiável com expiração e revogação controláveis
- proteger rotas SSR, server routes e endpoints de API ligados ao admin por middleware centralizado
- registrar tentativas relevantes de login e negações sem vazar informação sensível

Fase 2. Shell e navegação do admin.
Etapas:
- criar layout administrativo distinto das páginas públicas, com foco em legibilidade operacional
- organizar navegação por visão geral, arquivos, reports, downloads, storage e anomalias
- centralizar obtenção de sessão e autorização no boundary de layout ou middleware apropriado
- garantir que ausência de sessão válida redirecione ou bloqueie acesso de forma previsível
- preparar a base para futuras páginas densas sem comprometer performance inicial do painel

Fase 3. Visão geral operacional.
Etapas:
- exibir total de arquivos, ativos, expirados, hidden, deleted e consumed
- mostrar volume de downloads, uso de storage, reports pendentes e saúde das filas
- destacar jobs falhos, lag anormal e inconsistências detectadas pelo reconciler
- definir queries agregadas eficientes para evitar degradação do dashboard conforme o volume cresce
- separar métricas de produto de métricas operacionais para leitura rápida do operador

Fase 4. Gestão de arquivos e moderação.
Etapas:
- listar arquivos com filtros por status, regras aplicadas, volume de reports e data de criação
- permitir abertura de detalhe com metadata, histórico, eventos relevantes e estado do objeto no storage
- permitir hide, restore e delete com efeitos imediatos sobre disponibilidade pública quando cabível
- garantir confirmação adequada em ações destrutivas e auditoria mínima das mudanças de estado
- sincronizar a interface com estados recalculados sem exigir recarga manual excessiva

Fase 5. Reports, downloads e anomalias.
Etapas:
- listar reports com filtros por status, motivo e urgência operacional
- permitir dismiss, resolve e navegação rápida até o arquivo associado
- exibir download counts e eventos por arquivo quando útil para investigação
- destacar objetos ausentes, cleanup falho, expiração não refletida e outras anomalias operacionais
- permitir ao admin identificar rapidamente os arquivos que mais consomem storage ou concentram risco

Saída esperada:
- dashboard administrativo completo para autenticação, visão operacional, moderação e investigação básica

Módulo 8. Página About e narrativa de portfolio
Objetivo: transformar o produto em um artefato de portfolio forte, não apenas em uma aplicação funcional.

Fase 1. Arquitetura de conteúdo.
Etapas:
- estruturar a narrativa em problema, público, objetivos, não objetivos, arquitetura, decisões, trade-offs e próximos passos
- traduzir os pontos técnicos do PRD para uma linguagem compreensível por público técnico e não técnico
- destacar claramente o caráter não comercial, experimental e orientado a portfolio
- planejar seções que expliquem o fluxo do upload ao cleanup, incluindo moderação e observabilidade
- decidir quais limitações do v1 serão apresentadas como escolhas conscientes e não como lacunas acidentais

Fase 2. Implementação da página.
Etapas:
- criar rota pública dedicada no TanStack Start com SSR e metadados de SEO adequados
- apresentar stack, arquitetura e decisões com blocos visuais e texto técnico objetivo
- conectar a narrativa do About com o comportamento real do sistema, evitando marketing desconectado da implementação
- manter identidade visual coesa com a home e com o shell administrativo, sem parecer documentação improvisada
- garantir legibilidade móvel e clareza de informação para revisão rápida em contexto de entrevista

Fase 3. Transparência técnica e trade-offs.
Etapas:
- explicar por que Bun, TanStack Start, Hono, Drizzle, Redis, BullMQ e storage S3-like foram escolhidos
- explicar o trade-off entre custo, simplicidade e garantias de consistência, especialmente no tema de one-time download
- listar explicitamente o que ficou fora do v1, alinhado com os non-goals do PRD
- documentar limitações conhecidas, hipóteses operacionais e possíveis evoluções futuras
- revisar o texto com foco em credibilidade técnica e clareza de raciocínio de produto

Saída esperada:
- página pública capaz de sustentar discussão técnica de arquitetura e produto em contexto de portfolio

Módulo 9. Observabilidade, segurança, testes, CI e readiness de produção
Objetivo: encerrar o ciclo com maturidade operacional real e não apenas funcionalidade aparente.

Fase 1. Observabilidade e segurança transversal.
Etapas:
- consolidar logs estruturados para upload created, download started, download completed, report created, file hidden e file deleted
- adicionar correlação entre requests HTTP, jobs assíncronos e ações administrativas
- aplicar noindex às share pages e revisar headers de segurança, cache e exposição indevida de metadados
- revisar tratamento de dados sensíveis em logs, erros e interfaces administrativas
- definir health endpoints e sinais mínimos para monitoramento de web, API, worker, banco, Redis e storage

Fase 2. Testes de domínio e integração.
Etapas:
- escrever testes unitários para regras de estado, validação de políticas e transições de arquivo
- escrever testes de integração para upload, criação de share link, acesso público, report, auth admin e ações de moderação
- escrever testes específicos para concorrência do fluxo one-time download
- escrever testes para expiração, cleanup e reconciliação com cenários de falha parcial
- garantir que os testes usem dependências locais reproduzíveis e não dependam de serviços externos proprietários

Fase 3. CI e qualidade automatizada.
Etapas:
- montar pipeline com instalação, lint, typecheck, testes e validação de migrations
- adicionar etapa com serviços containerizados para banco, Redis e storage compatível em ambientes automatizados
- falhar pipeline quando houver incompatibilidade entre schema, contratos compartilhados e implementação
- otimizar cache de dependências e paralelização sem sacrificar confiabilidade do feedback
- documentar claramente o que bloqueia merge e o que é apenas sinalização informativa

Fase 4. Deploy e hardening.
Etapas:
- definir topologia de produção para web, API e worker, mantendo provider agnostic no storage
- externalizar secrets e configuração por ambiente de maneira segura e previsível
- validar comportamento com provider S3-like real e não apenas com MinIO local
- revisar timeouts, retries, políticas de reconnect e failover básico para dependências indisponíveis temporariamente
- preparar estratégia de backup lógico de metadata e procedimentos mínimos de recuperação operacional

Fase 5. Readiness final.
Etapas:
- executar checklist manual de fluxos críticos: upload, share, preview, download, one-time, expiration, report, auto-hide e login admin
- validar aderência às métricas técnicas e de produto definidas no PRD
- revisar custo operacional esperado, limites de throughput e gargalos conhecidos para contexto hobby
- consolidar documentação de operação, troubleshooting e roadmap pós-v1
- congelar backlog de melhorias futuras separando claramente o que é requisito de go-live do que é evolução opcional

Saída esperada:
- sistema pronto para publicação com testes, pipeline, observabilidade e postura operacional compatíveis com um projeto de portfolio sério

Sequência Recomendada

1. Módulo 1
2. Módulo 2
3. Módulo 3
4. Módulo 4
5. Módulo 5
6. Módulo 6
7. Módulo 7
8. Módulo 8
9. Módulo 9

Dependências críticas:
- Módulo 2 precisa estabilizar antes de Módulos 3, 4, 5, 6 e 7
- Módulo 4 depende de Módulo 3 e parcialmente de Módulo 5
- Módulo 7 depende de Módulos 2, 5 e 6 para ter dados úteis no dashboard
- Módulo 9 começa cedo em instrumentação básica, mas fecha só no fim

Decisões-chave embutidas no plano:
- one-time download não deve depender apenas de presigned URL; deve existir um caminho controlado pelo backend para consumo atômico
- o storage deve ser tratado como S3-like provider agnostic, evitando acoplamento prematuro a AWS ou outro vendor
- TanStack Start deve servir como shell unificada de páginas públicas, admin e server routes quando apropriado, enquanto Hono permanece a superfície de API de domínio
- BullMQ deve ser usado não apenas para expiração, mas também para cleanup, reconciliação e outras rotinas de consistência operacional

Observação final:
- este documento é exclusivamente um plano técnico detalhado para refinamento posterior; não implica início de implementação nem seleção final de providers de infraestrutura
