# Módulo 4. Fluxo público de compartilhamento, download e preview

## Objetivo

Entregar o fluxo principal do produto para uploader e recipient, cobrindo home de upload, geração do share link, página pública do arquivo, download padrão, consumo one-time e preview controlado.

## Resultado esperado

- Home orientada ao upload, com experiência clara e baixa fricção.
- Página pública por token com metadata essencial e estados específicos de disponibilidade.
- Fluxo de download padrão seguro e econômico.
- Fluxo one-time com consumo atômico via backend controlado.
- Preview disponível apenas quando elegível e explicitamente permitido.

## Escopo do módulo

- UX pública da landing e do resultado do upload.
- Rota pública de share page com metadata do arquivo.
- Download padrão e fluxo one-time.
- Renderização de preview para tipos elegíveis.
- Comunicação clara de indisponibilidade, expiração, ocultação e consumo.

## Fase 1. Home de upload e geração de share link

### Objetivo da fase

Construir a entrada principal do produto com foco em rapidez, previsibilidade e clareza sobre as regras configuradas antes do envio.

### Requisitos de UX

- Upload visível imediatamente ao entrar na home.
- Suporte a drag-and-drop e file picker.
- Controles claros para expiração, one-time e preview.
- Feedback explícito de progresso, validação e falha.
- Resultado final com ações de copiar e abrir o link.

### Atividades detalhadas

- Projetar a landing priorizando ação imediata, sem desviar para onboarding ou conteúdo secundário.
- Implementar componente de seleção de arquivo com estados vazios, hover e erro.
- Exibir impacto das opções escolhidas, especialmente a incompatibilidade entre preview e one-time.
- Prevenir dupla submissão e reenvio acidental.
- Mostrar o share link de forma destacada após sucesso, com affordances claras de uso.

### Critérios de aceite da fase

- Um usuário entende o fluxo de upload sem depender de explicação externa.
- O link gerado pode ser copiado ou aberto em uma ação direta.

## Fase 2. Página pública do arquivo

### Objetivo da fase

Representar o estado público do arquivo com clareza, sem vazar informações do uploader e sem colapsar indisponibilidades diferentes em uma única mensagem genérica.

### Informações que a página deve exibir

- Nome do arquivo sanitizado.
- Tipo e tamanho.
- Data de expiração, quando houver.
- Flags relevantes: preview permitido, one-time, estado atual.
- Ações disponíveis: preview, download e report, conforme elegibilidade.

### Controles técnicos obrigatórios

- `noindex` em share pages.
- Headers compatíveis com segurança e cache do recurso.
- Cache control compatível com atualização de estado sensível.
- SSR ou estratégia híbrida adequada para metadata pública.

### Atividades detalhadas

- Criar rota pública baseada em token com consulta segura ao estado do arquivo.
- Mapear estados `expired`, `hidden`, `deleted`, `consumed` e `missing` para mensagens específicas.
- Garantir que a UI diferencie claramente indisponibilidade permanente, temporária e por política.
- Expor apenas metadata necessária para uso do link.

### Critérios de aceite da fase

- A página informa com precisão o que está disponível e por quê.
- Nenhuma informação de identidade do uploader é exposta.

## Fase 3. Download padrão

### Objetivo da fase

Entregar o arquivo ativo de forma segura, com custo operacional controlado e sem quebrar regras de disponibilidade pública.

### Decisões técnicas da fase

- Se o download será via proxy, redirect curto ou URL assinada efêmera.
- Como registrar `download_started` e `download_completed` em pontos confiáveis.
- Como balancear custo de banda, simplicidade e enforcement.

### Atividades detalhadas

- Implementar autorização de download baseada no estado do arquivo.
- Bloquear acesso a arquivos `expired`, `hidden`, `deleted`, `consumed` e inconsistentes.
- Definir o modo de entrega padrão para arquivos não one-time.
- Registrar eventos de início e conclusão de download com contexto mínimo.
- Ajustar cache e headers para reduzir custo sem abrir brechas de acesso.

### Critérios de aceite da fase

- Apenas arquivos ativos e elegíveis podem ser baixados.
- O fluxo registra telemetria básica confiável para uso posterior no dashboard.

## Fase 4. One-time download com consumo atômico

### Objetivo da fase

Garantir que arquivos one-time sejam consumíveis uma única vez, mesmo sob concorrência, sem depender de blind presigned URL.

### Premissa central

O consumo one-time precisa passar por um caminho controlado pelo backend para que a reserva e a transição para `consumed` sejam atômicas ou equivalentes do ponto de vista de garantia de negócio.

### Atividades detalhadas

- Criar fluxo técnico distinto do download padrão.
- Definir mecanismo de reserva: lock transacional, compare-and-set ou equivalente.
- Impedir sucesso duplo em requisições concorrentes.
- Decidir o momento exato da transição para `consumed` com base no balanço entre atomicidade e risco de falso consumo.
- Registrar eventos específicos de reserva, entrega e consumo.
- Projetar tratamento para estados inconclusivos causados por falha de rede, crash ou timeout.

### Casos críticos que precisam de teste

- Duas requisições simultâneas ao mesmo token.
- Cliente desconecta após reserva, antes de concluir a entrega.
- Retry do cliente após estado ambíguo.
- Processo cai no meio da operação.

### Critérios de aceite da fase

- O sistema impede downloads múltiplos bem-sucedidos do mesmo arquivo one-time.
- Estados ambíguos deixam trilha suficiente para investigação e eventual correção controlada.

## Fase 5. Preview controlado

### Objetivo da fase

Oferecer preview para tipos elegíveis sem comprometer semântica de acesso e sem tratar preview como mero detalhe visual da UI.

### Regras obrigatórias

- Preview só existe quando o uploader habilitou explicitamente.
- Preview só existe para tipos em allowlist explícita.
- Preview é proibido para arquivos one-time.
- Preview é bloqueado para `expired`, `hidden`, `deleted`, `consumed` e `missing`.

### Tipos elegíveis iniciais sugeridos

- Imagens.
- Vídeo.
- Áudio.
- PDF.
- Texto simples.

### Atividades detalhadas

- Centralizar a lógica de elegibilidade fora da camada puramente visual.
- Implementar renderização adequada por grupo de MIME type.
- Degradar graciosamente para download quando preview não for suportado.
- Separar visualmente preview e download para evitar ambiguidade de ação.

### Critérios de aceite da fase

- Preview aparece apenas quando permitido e seguro.
- Tipos não suportados continuam acessíveis por download quando válidos.

## Riscos principais do módulo

- Criar uma home bonita, mas pouco clara sobre regras e estados.
- Colapsar indisponibilidades diferentes em um único 404 genérico.
- Quebrar a semântica de one-time ao tentar reutilizar o fluxo padrão.
- Deixar a elegibilidade de preview espalhada em UI e backend.

## Mitigações recomendadas

- Basear UI pública em contratos e estados do domínio, não em heurística local.
- Implementar one-time como fluxo técnico próprio.
- Manter allowlist de preview como regra centralizada e testável.

## Dependências para módulos seguintes

- Módulo 5 usa os estados e eventos do fluxo público para expiração e cleanup.
- Módulo 6 depende da página pública para acionar reports e bloqueios.
- Módulo 7 consome metadata e eventos produzidos aqui para o dashboard.

## Critérios de saída do módulo

- Upload público, share page, download e preview entregues.
- Indisponibilidades comunicadas com precisão.
- One-time download protegido contra concorrência simples.
- O principal fluxo de valor do produto está operacional e coerente com o PRD.