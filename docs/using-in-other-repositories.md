# Usando o harness em outros repositórios

O `harness` pode ser executado em qualquer projeto pessoal versionado com Git. Não é necessário copiar o código do agente para cada projeto.

## Iniciar o serviço local

Inicie somente o OpenCode. O harness inicia e encerra um processo isolado do llama.cpp para cada alias conforme necessário; não inicie o router manualmente quando `modelStrategy: process` estiver configurado.

```fish
set -lx OPENCODE_CONFIG /home/igor/personal/local-agent/config/opencode.local.json
opencode serve --hostname 127.0.0.1 --port 4096
```

Antes de uma tarefa, `harness model status` não deve mostrar um processo llama.cpp residual. O modo `router` continua disponível como opt-in, mas não é recomendado nesta máquina devido à falha de kernel observada durante troca de GGUF.

Valide o ambiente antes de iniciar uma tarefa:

```fish
harness doctor \
  --config /home/igor/personal/local-agent/config/harness.example.yaml \
  --json
```

## Iniciar uma tarefa em outro projeto

Entre no repositório pelo terminal integrado da IDE. O worktree principal deve estar limpo:

```fish
cd /caminho/do/seu/projeto
git status
harness run --new "Analise o projeto e implemente a funcionalidade X"
```

O Git workspace atual é detectado automaticamente. Também é possível informar o caminho explicitamente:

```fish
harness run \
  --new \
  --repo /caminho/do/seu/projeto \
  "Implemente a funcionalidade X com testes"
```

## Continuar a mesma conversa

Por padrão, `continue` seleciona a conversa ativa mais recente do workspace:

```fish
harness continue "Agora adicione testes para os casos de erro"
```

Para selecionar uma conversa explicitamente:

```fish
harness continue \
  --conversation conv-... \
  "Faça a próxima alteração"
```

Cada prompt cria um novo run auditável. A memória da conversa é persistente, limitada e baseada também na cadeia de checkpoints Git; não é uma sessão de modelo mantida indefinidamente.

## Sessão interativa

```fish
harness chat
```

Comandos disponíveis dentro do chat:

```text
/status
/memory
/exit
```

## Acompanhar e recuperar execuções

```fish
harness status
harness logs RUN_ID
harness report RUN_ID
harness resume RUN_ID
harness model status
```

O primeiro `Ctrl+C` solicita uma pausa cooperativa. Depois que o run estiver pausado e o modelo tiver sido descarregado, use `harness resume RUN_ID` para continuar do último estado consistente.

## Arquivos criados no projeto

O harness mantém seu estado dentro do workspace:

```text
.agent-harness/
├── conversations/
├── runs/
└── worktrees/
```

Garanta que `.agent-harness/` esteja no `.gitignore` do projeto. `harness init` pode preparar a configuração local segura:

```fish
harness init .
```

## Revisar o resultado

Ao terminar, a saída informa pelo menos:

```text
conversationId
runId
repositoryPath
```

Abra o `repositoryPath` informado na IDE para revisar o resultado. Cada alteração ocorre em branch e worktree isolados. O harness não faz merge automático na `main` ou em outra branch padrão.

Depois da revisão, integre manualmente o commit ou a branch produzida conforme o fluxo Git do projeto.

## Primeiro teste recomendado

```fish
cd ~/personal/meu-projeto
git status
harness run --new \
  "Leia o projeto, explique brevemente sua estrutura e adicione uma pequena melhoria com testes. Não altere dependências."
```

Comece com uma tarefa pequena e confira o run, os testes, o worktree e o relatório antes de usar o agente em mudanças maiores.
