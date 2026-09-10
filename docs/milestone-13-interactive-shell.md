# Milestone 13: shell interativo `local-agent`

O comando `local-agent` oferece uma sessão semelhante às CLIs interativas de agentes, mantendo as garantias auditáveis do harness.

## Início direto no projeto

No terminal Fish integrado à IDE, entre em qualquer diretório do Git workspace e execute:

```fish
local-agent
```

O comando detecta a raiz Git, carrega a configuração, reutiliza o OpenCode quando o endpoint configurado está saudável ou inicia uma instância própria pela API oficial do SDK. Uma instância iniciada pelo shell usa `runtime.opencodeConfig`, espera ficar saudável e é encerrada ao sair. Um serviço que já existia nunca é encerrado pelo shell.

Texto comum inicia um novo turn da conversa persistente mais recente:

```text
you> leia @README.md e implemente uma pequena melhoria
```

Cada mensagem continua sendo um run isolado e auditável. O terminal mostra `runId`, worktree, estágio, papel/modelo, retries, gates, checkpoints, handoffs e término. O modelo é descarregado ao final de cada run.

## Slash commands

Digite `/help` para consultar a lista dentro do próprio shell.

```text
/help                 ajuda e sintaxe
/status               conversa e último run
/memory               memória resumida, sem prompts
/files                caminho, tamanho e hash das referências
/worktree             worktree, branch, commit e estado Git
/model                processo de modelo e aliases anunciados
/doctor               diagnóstico do runtime local
/report [run-id]      relatório do run informado ou mais recente
/new                  nova conversa no próximo prompt
/resume [run-id]      retoma um run recuperável
/pause [run-id]       solicita pausa cooperativa
/handoff [run-id]     solicita handoff seguro
/clear                limpa somente a apresentação do terminal
/exit                 encerra com limpeza segura
```

Argumentos são analisados como dados, nunca interpolados em shell. Um comando desconhecido ou malformado é recusado antes de inferência. Tab completa nomes iniciados por `/`.

O histórico local fica em `.agent-harness/shell-history`, com permissão privada, no máximo 100 entradas e 16 KiB. Segredos conhecidos pela configuração de redação são removidos antes da persistência. As setas recuperam entradas durante a sessão.

## Encerramento e recuperação

Durante uma inferência, o progresso ocupa o shell até o turn terminar. Use `Ctrl+C` uma vez para solicitar pausa cooperativa; o run persiste seu estado e descarrega o modelo. Depois, use `/resume`.

`/exit` não abandona um run marcado como ativo. Ele pede que o operador solicite a pausa e aguarde a limpeza. Na saída normal ou excepcional, o shell tenta parar qualquer modelo gerenciado e encerra somente o OpenCode que ele próprio iniciou.

`harness chat` abre a mesma interface. Os comandos não interativos anteriores permanecem disponíveis para scripts e integrações JSONL.
