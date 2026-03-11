# Módulo 8. Página About e narrativa de portfolio

## Objetivo

Transformar o produto em um artefato de portfolio forte, explicando problema, público, arquitetura, decisões e trade-offs de forma crível para públicos técnicos e não técnicos.

## Resultado esperado

- Página pública dedicada ao projeto, não confundida com documentação improvisada.
- Narrativa clara sobre problema, objetivos, limites e escolhas técnicas.
- Explicação honesta dos trade-offs do v1, especialmente em torno de one-time download, moderação e operação.
- Conteúdo coerente com o sistema real implementado.

## Escopo do módulo

- Arquitetura de conteúdo da página About.
- Implementação da rota pública em TanStack Start.
- Tradução do PRD e do plano técnico para narrativa de portfolio.
- Revisão editorial com foco em credibilidade técnica.

## Fase 1. Arquitetura de conteúdo

### Objetivo da fase

Organizar a narrativa antes da implementação visual, para evitar uma página bonita, porém vazia ou desconectada do produto.

### Seções sugeridas

- Problema e proposta do produto.
- Público-alvo e contexto não comercial.
- Objetivos e non-goals.
- Fluxo do sistema, do upload ao cleanup.
- Stack e justificativas.
- Decisões arquiteturais e trade-offs.
- Limitações conhecidas e próximos passos.

### Atividades detalhadas

- Traduzir pontos do PRD para linguagem compreensível por quem não conhece a stack.
- Destacar claramente o caráter experimental, solo e orientado a portfolio.
- Explicar o que foi deliberadamente deixado fora do v1.
- Planejar como mostrar moderação, observabilidade e lifecycle sem transformar a página em documentação densa demais.

### Critérios de aceite da fase

- A estrutura da narrativa sustenta uma conversa de produto e arquitetura sem depender de contexto externo.
- As limitações aparecem como decisões conscientes, não como lacunas acidentais.

## Fase 2. Implementação da página

### Objetivo da fase

Materializar a narrativa em uma rota pública consistente com a identidade visual do produto, mantendo clareza, legibilidade e boa leitura em contexto de entrevista ou revisão rápida.

### Requisitos de implementação

- Rota pública dedicada em TanStack Start.
- SSR e metadados de SEO adequados.
- Estrutura visual coerente com a home e com o admin, sem parecer igual a nenhuma das duas.
- Boa legibilidade móvel e desktop.

### Atividades detalhadas

- Construir layout editorial com blocos visuais para stack, arquitetura e decisões.
- Mostrar o fluxo do sistema de forma resumida, mas tecnicamente fiel.
- Evitar copy de marketing genérica; priorizar explicação objetiva.
- Destacar principais decisões: Bun-first, TanStack Start, Hono, Drizzle, Redis, BullMQ e storage S3-like.

### Critérios de aceite da fase

- A página é navegável, clara e visualmente intencional.
- Um revisor entende rapidamente o que o produto faz e por que a arquitetura foi escolhida.

## Fase 3. Transparência técnica e trade-offs

### Objetivo da fase

Dar credibilidade à narrativa, explicitando compromissos, limites e escolhas de v1 sem prometer mais do que o sistema entrega.

### Pontos que precisam aparecer

- Por que Bun, TanStack Start, Hono, Drizzle, Redis, BullMQ e S3-like storage foram escolhidos.
- Como o projeto equilibra custo, simplicidade e consistência.
- Por que one-time download requer caminho controlado pelo backend.
- O que ficou fora do v1: billing, multi-admin, E2E encryption, malware scanning, password-protected shares e afins.
- Próximas evoluções possíveis e seus impactos.

### Atividades detalhadas

- Revisar o texto contra o comportamento real do sistema para evitar inconsistência narrativa.
- Explicar limitações como parte da estratégia de escopo, não como omissão casual.
- Garantir que a página seja útil tanto para recrutadores quanto para engenheiros.

### Critérios de aceite da fase

- O conteúdo sustenta discussão técnica sem parecer autopromoção vazia.
- A narrativa está alinhada ao que o produto realmente implementa.

## Riscos principais do módulo

- Produzir uma página genérica, intercambiável com qualquer projeto full-stack.
- Descrever uma arquitetura idealizada que não corresponde ao sistema real.
- Tornar o conteúdo técnico demais para revisão rápida ou raso demais para discussão séria.

## Mitigações recomendadas

- Escrever a partir do sistema construído, não de aspiração futura.
- Tratar trade-offs como ponto central da narrativa.
- Balancear clareza executiva e profundidade técnica por seção.

## Dependências para módulos seguintes

- Módulo 9 deve garantir SEO técnico, segurança e readiness da rota About junto às demais páginas públicas.

## Critérios de saída do módulo

- Página About publicada e alinhada ao produto real.
- Narrativa clara de problema, solução, arquitetura e trade-offs.
- Projeto fortalecido como artefato de portfolio, não apenas como aplicação funcional.