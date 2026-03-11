# Módulo 3. Ingestão de upload e integração com storage

## Objetivo

Implementar a entrada segura do arquivo e garantir consistência entre metadata e objeto armazenado. Este módulo cobre a jornada da criação do upload até a ativação pública do link, incluindo validações, estado intermediário e compensação para falhas parciais.

## Resultado esperado

- Pipeline de upload confiável, observável e compatível com o limite de 256 MB.
- Metadata e objeto mantidos em sincronia, sem publicação prematura.
- Storage tratado por uma interface S3-like provider-agnostic.
- Tokens públicos e object keys gerados com imprevisibilidade e baixa exposição.
- Logs e estados intermediários suficientes para troubleshooting e reconciliação futura.

## Escopo do módulo

- Estratégia inicial de ingestão para v1.
- Validação pré-upload e saneamento de metadados.
- Persistência consistente entre banco e storage.
- Implementação do adapter de storage S3-compatible.
- Tratamento explícito de falhas transitórias e permanentes.

## Fase 1. Estratégia de ingestão

### Objetivo da fase

Escolher o fluxo inicial de upload equilibrando robustez operacional, simplicidade de implementação e compatibilidade com a evolução futura para presigned upload.

### Decisões que precisam sair desta fase

- O v1 será server-mediated, presigned ou híbrido.
- Como o limite de 256 MB será suportado no runtime e na camada HTTP.
- Qual será a convenção de `object_key`.
- Que metadados mínimos serão persistidos junto ao objeto.
- Como preparar a transição futura para presigned uploads sem quebrar contratos.

### Direção recomendada

- Para v1, privilegiar robustez e observabilidade sobre otimização precoce.
- Manter o contrato de domínio independente do mecanismo de upload usado por trás.
- Registrar explicitamente os trade-offs de throughput, custo e simplicidade.

### Atividades detalhadas

- Definir se o upload passa pela API ou por uma rota controlada associada ao backend.
- Configurar limites de body e timeouts coerentes com o teto de 256 MB.
- Estabelecer convenção para object keys sem expor filename nem padrões triviais de timestamp.
- Determinar metadados técnicos necessários para reconciliação, debugging e consumo futuro.
- Documentar a estratégia de evolução para presigned PUT em produção.

### Critérios de aceite da fase

- Existe um fluxo inicial claro e defensável para upload no v1.
- O design não bloqueia evolução futura para upload direto ao storage.

## Fase 2. Validação pré-upload

### Objetivo da fase

Bloquear combinações inválidas e entradas inseguras antes de qualquer persistência definitiva.

### Regras obrigatórias

- Arquivo acima de 256 MB deve ser rejeitado.
- MIME type deve ser validado e normalizado dentro do que o sistema suporta.
- O nome exibido do arquivo deve ser saneado.
- Preview deve ser desabilitado quando one-time download estiver ativo.
- Expiração não pode ultrapassar 30 dias.

### Atividades detalhadas

- Validar tamanho, tipo, nome e opções de compartilhamento.
- Saneiar o filename para exibição pública mantendo utilidade para o usuário.
- Gerar token público imprevisível.
- Gerar object key interno sem acoplamento ao token ou ao filename.
- Calcular `expires_at` quando configurado.
- Rejeitar combinações inválidas com erros específicos e consistentes com os contratos do Módulo 2.

### Critérios de aceite da fase

- Entradas inválidas são rejeitadas antes de qualquer ativação pública.
- O sistema produz token e object key fortes e semanticamente desacoplados.

## Fase 3. Persistência consistente entre banco e storage

### Objetivo da fase

Impedir estados quebrados em que exista metadata ativa sem objeto ou objeto persistido sem trilha confiável no banco.

### Estratégia recomendada

- Introduzir estado `pending_upload` antes de qualquer ativação pública.
- Só promover para `active` quando banco e storage estiverem consistentes.
- Tratar falhas intermediárias com compensação explícita.

### Atividades detalhadas

- Definir ordem segura entre criação de registro e persistência do objeto.
- Registrar upload iniciado com contexto operacional mínimo.
- Salvar metadata inicial em estado não público.
- Persistir o objeto no storage com classification de erro transitório versus permanente.
- Confirmar consistência com `head` ou mecanismo equivalente quando necessário.
- Promover o registro para `active` apenas após confirmação confiável.
- Em falha parcial, limpar objeto órfão ou marcar registro para reconciliação.

### Casos que precisam ser tratados

- Falha antes da gravação do objeto.
- Falha após gravação do objeto e antes da promoção do metadata.
- Timeout de confirmação com estado ambíguo.
- Reenvio acidental do cliente.

### Critérios de aceite da fase

- Não existe caminho normal que publique link antes da consistência storage+banco.
- Casos de falha parcial deixam rastros operacionais claros e reconciliáveis.

## Fase 4. Adapter de storage S3-like

### Objetivo da fase

Abstrair a integração com storage por meio de uma interface pequena, explícita e resiliente, alinhada com a exigência de provider agnostic do projeto.

### Operações mínimas

- `putObject`
- `getObject`
- `headObject`
- `deleteObject`
- `objectExists`
- `createSignedUrl` opcional

### Requisitos do adapter

- Funcionar com MinIO local e providers S3-compatible reais.
- Classificar erros em transitórios, permanentes e de objeto ausente.
- Configurar timeouts e retries de forma centralizada.
- Expor informação suficiente para o reconciler e o dashboard administrativo.

### Atividades detalhadas

- Definir interface de storage no pacote de infraestrutura.
- Implementar adapter inicial compatível com Bun e API S3-like adotada.
- Mapear códigos de erro e exceções do provider para erros internos significativos.
- Isolar configuração de endpoint, credenciais, bucket e política de assinatura.
- Documentar expectativas do adapter para testes locais e deploy futuro.

### Critérios de aceite da fase

- O domínio não depende de detalhes específicos de MinIO, AWS S3 ou Cloudflare R2.
- O adapter torna falhas observáveis e classificáveis sem espalhar lógica de provider no sistema.

## Observabilidade mínima do módulo

Eventos que devem existir desde o início:

- `upload.created`
- `upload.validation_failed`
- `upload.storage_started`
- `upload.storage_succeeded`
- `upload.storage_failed`
- `upload.activated`
- `upload.compensation_triggered`

Campos mínimos sugeridos:

- token ou id interno do arquivo.
- object key.
- mime type.
- tamanho.
- flags de política.
- motivo de falha.
- correlação de request.

## Riscos principais do módulo

- Publicar o link antes da confirmação de consistência.
- Acoplar storage à implementação local e dificultar deploy futuro.
- Tratar falhas de upload como erro simples de request, sem consequência operacional.

## Mitigações recomendadas

- Usar estado intermediário explícito.
- Centralizar integração de storage em adapter pequeno e testável.
- Registrar falhas com contexto suficiente para reconciliação posterior.

## Dependências para módulos seguintes

- Módulo 4 depende diretamente da criação confiável do arquivo ativo.
- Módulo 5 depende dos estados e eventos gerados aqui para expiração e cleanup.
- Módulo 7 depende da qualidade da metadata para o dashboard administrativo.

## Critérios de saída do módulo

- Upload v1 funcional e observável.
- Banco e storage integrados com consistência mínima garantida.
- Adapter S3-like desacoplado de provider específico.
- Falhas parciais tratadas com compensação ou sinalização operacional.
- O sistema está pronto para gerar links compartilháveis com baixo risco estrutural.