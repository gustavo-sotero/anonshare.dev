# Módulo 1. Fundação do monorepo e plataforma local

## Objetivo

Sair de um workspace vazio para uma base executável, previsível e preparada para crescer sem retrabalho estrutural. Este módulo estabelece a topologia do monorepo, os contratos de execução locais e a disciplina técnica mínima para que os módulos seguintes possam ser implementados com baixo atrito.

## Resultado esperado

- Monorepo Bun-first inicializado com workspaces claros.
- Aplicações de web, API e worker com bootstrap independente.
- Infraestrutura local com PostgreSQL, Redis e storage S3-like via Docker Compose.
- Padrões unificados de TypeScript, configuração, observabilidade e scripts operacionais.
- Documentação mínima para onboarding, bootstrap e troubleshooting local.

## Escopo do módulo

- Estruturação do repositório e definição dos pacotes principais.
- Definição de convenções de nomes, aliases, scripts e variáveis de ambiente.
- Provisionamento local de dependências externas com healthchecks e persistência.
- Base de execução das aplicações e bibliotecas compartilhadas.
- Governança técnica inicial: lint, format, typecheck e validações de ambiente.

## Fora do escopo

- Regras de domínio detalhadas do produto.
- Modelagem final do banco.
- Implementação do fluxo de upload, download, preview ou admin.
- Integrações produtivas com providers remotos.

## Dependências de entrada

- PRD consolidado.
- Plano mestre do projeto.
- Decisão já assumida no PRD de usar Bun workspaces, TanStack Start, Hono, Redis, PostgreSQL, BullMQ e storage S3-compatible.

## Fase 1. Bootstrap do workspace

### Objetivo da fase

Definir a espinha dorsal do monorepo e impedir que decisões básicas de layout, compartilhamento de código e scripts sejam tomadas de forma ad hoc durante a implementação dos módulos seguintes.

### Decisões que devem sair desta fase

- Nome e topologia dos workspaces.
- Estratégia de compartilhamento entre apps e packages.
- Resolução de módulos e aliases TypeScript.
- Convenção de scripts de desenvolvimento, build, teste e migração.
- Padrão de nomenclatura para arquivos, pacotes e variáveis de ambiente.

### Estrutura lógica recomendada

- `apps/web`: TanStack Start para páginas públicas, shell administrativo e rotas SSR quando couber.
- `apps/api`: Hono para endpoints de domínio, ingestão, download, report, admin e internos.
- `apps/worker`: processo BullMQ para expiração, cleanup, reconciliação e rotinas operacionais.
- `packages/domain`: entidades, enums, regras puras, tipos centrais e contratos do domínio.
- `packages/contracts`: schemas de entrada e saída compartilhados entre frontend, API e worker.
- `packages/infrastructure`: banco, Redis, storage, logging, config e utilidades transversais.

### Atividades detalhadas

- Inicializar o repositório com `package.json` raiz usando workspaces Bun.
- Criar `tsconfig` base com references, paths e regras de compilação consistentes.
- Definir fronteiras claras entre apps executáveis e bibliotecas reusáveis.
- Estabelecer padrão de import absoluto para reduzir fragilidade de imports relativos profundos.
- Criar scripts raiz que deleguem tarefas para workspaces específicos sem mascarar falhas.
- Registrar um documento curto de convenções para evitar drift já nos primeiros commits.

### Artefatos esperados

- `package.json` raiz com workspaces e scripts.
- `bunfig.toml` ou configuração equivalente adotada pelo projeto.
- `tsconfig.base.json` e `tsconfig.json` por pacote.
- Estrutura inicial de pastas para apps e packages.
- Documento operacional inicial em `README.md` ou `docs/`.

### Critérios de aceite da fase

- Todos os workspaces resolvem dependências corretamente.
- TypeScript compila referências entre pacotes sem duplicação manual de tipos.
- A organização escolhida acomoda web, API e worker sem sobreposição de responsabilidade.

## Fase 2. Infraestrutura local de desenvolvimento

### Objetivo da fase

Garantir que o desenvolvimento local seja previsível, reproduzível e isolado o suficiente para testes e integração contínua futura.

### Componentes previstos

- PostgreSQL para metadata, relatórios, sessões e estados operacionais.
- Redis para filas, rate limiting, cache e coordenação operacional.
- Storage S3-like, inicialmente MinIO, para compatibilidade com API S3 sem acoplamento prematuro a provider específico.

### Atividades detalhadas

- Criar `docker-compose.yml` com serviços nomeados de forma consistente com a topologia do projeto.
- Configurar volumes persistentes para banco, Redis e storage local.
- Adicionar healthchecks reais, não apenas inicialização de processo, para evitar readiness falsa.
- Aplicar políticas de restart adequadas para o ambiente local.
- Definir arquivos `.env.example` separados por processo, mantendo segredos fora do repositório.
- Validar conexão fim a fim entre aplicações e dependências externas em um ambiente local limpo.
- Documentar como resetar banco, filas e objetos sem deletar material do repositório.

### Decisões importantes

- Os nomes dos containers, portas e variáveis precisam ser estáveis para uso futuro em CI.
- A configuração local deve ser próxima do ambiente produtivo nas interfaces, mas não necessariamente nos providers.
- O storage deve ser tratado como S3-compatible desde o início, e não como implementação MinIO-specific.

### Artefatos esperados

- `docker-compose.yml`.
- Arquivos `.env.example` por aplicação e por infraestrutura.
- Script ou procedimento documentado para bootstrap local.
- Procedimento documentado para reset operacional local.

### Critérios de aceite da fase

- Um desenvolvedor consegue subir a stack local do zero com passos explícitos.
- Web, API e worker conseguem resolver conexões locais usando as variáveis previstas.
- Falhas de readiness são detectáveis cedo, sem falsos positivos no bootstrap.

## Fase 3. Base de execução das aplicações

### Objetivo da fase

Criar processos inicializáveis e independentes, com uma camada compartilhada de configuração e observabilidade, sem deixar a separação entre UI, API e rotinas assíncronas se degradar.

### Atividades detalhadas

- Inicializar a aplicação TanStack Start com roteamento mínimo, layout base e SSR seletivo.
- Criar a aplicação Hono com estrutura de rotas por domínio, não por camada técnica genérica.
- Criar o worker BullMQ com bootstrap explícito, ciclo de vida controlado e shutdown previsível.
- Extrair uma camada compartilhada para configuração, logging e clients de infraestrutura.
- Definir interfaces estáveis entre web e API para impedir acoplamento implícito.

### Fronteiras recomendadas

- A web é responsável por experiência de navegação, SSR, composição de páginas e eventuais server routes de apresentação.
- A API Hono concentra contratos de domínio, regras de segurança de endpoint e integrações de domínio.
- O worker executa lógica assíncrona, reconciliação e lifecycle jobs, sem depender da UI.

### Riscos que esta fase precisa evitar

- Mistura precoce entre rotas de UI e rotas de domínio.
- Duplicação de configuração e clients de infraestrutura entre processos.
- Acoplamento do worker à aplicação web ou ao ciclo HTTP.

### Critérios de aceite da fase

- Cada processo sobe isoladamente com comando próprio.
- Existe uma base comum de configuração, logging e clients reutilizável.
- As responsabilidades entre web, API e worker estão documentadas e tecnicamente refletidas no código.

## Fase 4. Governança técnica inicial

### Objetivo da fase

Evitar que a velocidade inicial do projeto gere dívida estrutural logo na fundação.

### Atividades detalhadas

- Configurar lint, format e typecheck com escopo por workspace e agregação na raiz.
- Impor validação estrita de variáveis de ambiente no boot dos três processos.
- Padronizar logging estruturado com campos mínimos: request id, event type, actor, entity, outcome e timestamp.
- Criar scripts de verificação local que repliquem o futuro pipeline de CI.
- Documentar decisões arquiteturais com alto potencial de retrabalho se deixadas implícitas.

### Controles recomendados

- Bloquear imports cruzados indevidos entre apps.
- Definir política de erros para boot por configuração inválida.
- Garantir que logs sejam legíveis em local e serializáveis para ambientes remotos.
- Evitar ferramentas extras sem ganho claro para um projeto solo.

### Critérios de aceite da fase

- O repositório possui comando único para validação básica local.
- Configuração inválida falha cedo e de forma explícita.
- Regras de import e qualidade impedem acoplamentos indevidos.

## Riscos principais do módulo

- Escolher uma topologia de pacotes confusa e ter de redistribuir responsabilidades no meio do projeto.
- Tratar a infraestrutura local como acessória e descobrir incompatibilidades somente ao integrar fluxo real.
- Subestimar o valor da validação de ambiente e do logging estruturado desde o início.

## Mitigações recomendadas

- Favorecer poucos pacotes com responsabilidade clara, em vez de granularidade prematura.
- Reproduzir localmente as interfaces que existirão em produção, especialmente Redis e S3-like.
- Formalizar decisões estruturais com documentação curta, mas explícita.

## Dependências para módulos seguintes

- Módulo 2 depende diretamente da estrutura de pacotes, TypeScript compartilhado e infraestrutura local funcional.
- Módulos 3 a 9 assumem que web, API e worker já podem iniciar, se conectar e compartilhar contratos.

## Critérios de saída do módulo

- Monorepo inicializado e navegável.
- Infraestrutura local disponível e saudável.
- Processos de web, API e worker sobem com configuração válida.
- Tooling base de qualidade e convenções documentadas.
- O projeto está pronto para iniciar a modelagem de domínio sem retrabalho estrutural.