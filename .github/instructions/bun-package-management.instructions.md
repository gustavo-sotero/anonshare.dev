---
description: BUN PACKAGE MANAGEMENT
applyTo: '**'
---

Gerenciamento de dependencias com Bun

- Ao instalar qualquer dependencia, use sempre `bun add`.
- Para dependencias de desenvolvimento, use sempre `bun add -d`.
- Nunca escreva, edite ou manipule manualmente versoes de dependencias no `package.json`.
- Nunca use a string `latest` em qualquer secao de dependencias do `package.json`.
- Nunca especifique versao ao instalar pacotes. Use `bun add <pacote>` e `bun add -d <pacote>`, nunca `bun add <pacote>@<versao>`.
- Para remover dependencias, use o comando apropriado do Bun em vez de editar manualmente o `package.json`.
- So edite a secao de dependencias do `package.json` manualmente se o usuario pedir isso de forma explicita.