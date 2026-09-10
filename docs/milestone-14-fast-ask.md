# Milestone 14: perguntas rápidas e roteamento explícito

O shell separa conversa somente leitura de tarefas de engenharia.

## `/ask`: uma resposta rápida

```text
/ask você consegue gerar links?
/ask explique @README.md
/ask compare @src/api.ts com @"docs/contrato antigo.md"
```

`/ask` carrega somente `qwen36-main`, cria uma sessão OpenCode sem ferramentas de escrita, shell, delegação ou web, retorna texto e descarrega o modelo. Ele não cria run, worktree, branch, gates, revisores, reparos ou auditoria. Referências locais passam pelos controles do Milestone 12.

Perguntas evidentes sem slash command também usam esse modo. O roteamento é determinístico: pontuação interrogativa e prefixos interrogativos conhecidos selecionam `ask`; demais mensagens continuam no fluxo completo por segurança. Use `/ask` ou `/run` para eliminar ambiguidade.

A memória recente de perguntas e respostas respeita `conversation.maxRecentTurns` e `conversation.maxMemoryBytes`. Artefatos ficam em `.agent-harness/asks/<ask-id>/`; referências guardam somente proveniência.

## `/ask --web`: URL explícita

```text
/ask --web resuma https://example.com/documentacao
```

Exatamente uma URL é aceita. O adaptador permite somente HTTP(S) sem credenciais, resolve e bloqueia destinos locais/privados/link-local, revalida redirects, aceita conteúdo textual, limita tempo e 512 KiB, não envia cookies ou autorização e registra URL final, tipo, bytes e SHA-256. O conteúdo é delimitado como dado não confiável e nunca vira comando.

## `/run`: workflow completo

```text
/run implemente autenticação e adicione testes
```

`/run` força baseline Git, worktree/branch isolados, critérios de aceite, testes-oráculo, planejamento, implementação, checkpoints, gates, revisões independentes, validação, reparos, verificações avançadas e auditoria final. Use-o para modificar o projeto.

`Ctrl+C` durante `/ask` cancela a sessão OpenCode e descarrega o modelo. Durante `/run`, continua valendo a pausa cooperativa e recuperação por `/resume`.
