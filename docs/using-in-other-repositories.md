# Usando o harness em outros repositórios

O `harness` pode ser executado em qualquer projeto pessoal versionado com Git. Não é necessário copiar o código do agente para cada projeto.

## Uso mais simples: shell interativo

Entre no projeto pelo terminal Fish da IDE e execute apenas:

```fish
cd /caminho/do/seu/projeto
local-agent
```

O shell detecta o Git workspace e mostra `/help` com todos os comandos. Mensagens comuns iniciam turns; `@arquivo` anexa arquivos; Tab completa slash commands. Ele reutiliza um OpenCode saudável ou inicia e encerra uma instância própria usando a configuração local. Portanto, a seção manual abaixo é necessária apenas para quem prefere manter o serviço compartilhado ou usar os comandos não interativos.

Perguntas simples usam uma inferência somente leitura. Use `/ask` para forçar esse caminho, `/ask --web` para ler uma URL explícita com controles de rede, e `/run` para forçar o workflow completo que altera código:

```text
/ask como este projeto está organizado?
/ask explique @README.md
/ask --web resuma https://example.com/documentacao
/fix corrija o erro localizado em @src/service.ts
/run implemente a primeira etapa de @plano.md
```

O `/fix` pode repetir uma falha transitória de inferência local conforme `workflow.inferenceRetries`. O progresso informa a nova tentativa; se o OpenCode não estiver mais saudável, o turno para imediatamente e identifica a fase que falhou.

Inferências longas são submetidas de forma assíncrona e acompanhadas até a sessão terminar; um heartbeat `Still working` aparece a cada 30 segundos sem conteúdo do prompt. Use `/fix` somente para uma alteração pequena e localizada. Tarefas que decompõem um plano grande ou criam muitos arquivos pertencem ao `/run`.

O `/fix` usa agentes próprios com no máximo oito passos e encerra uma inferência focada que não termine em três minutos. Timeout não é repetido automaticamente; falhas transitórias podem receber no máximo uma nova tentativa. Isso impede que uma tarefa pequena ocupe dezenas de minutos sem produzir uma alteração.

O progresso incremental distingue carregamento do modelo, tool calls, arquivos alterados e tokens concluídos por passo. Entradas e conteúdos dos arquivos não são impressos. Durante o run, procure as alterações no `worktree` mostrado na primeira linha; o diretório principal permanece intocado até você integrar manualmente o checkpoint.

Ao iniciar, `local-agent` também consulta o endpoint llama.cpp. Um processo cujo pai já terminou, que corresponda exatamente ao executável, porta e alias locais registrados, é encerrado antes de aceitar prompts. Se o processo ainda tiver um proprietário ativo ou não puder ser identificado sem ambiguidade, o shell falha sem matar nada e pede que a outra sessão seja encerrada.

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

Para anexar arquivos explicitamente ao prompt atual:

```fish
harness run --new 'implemente as etapas de @plano-mestre.md'
harness continue 'compare @src/api.ts e @"docs/decisões técnicas.md"'
```

Use `@@` para um arroba literal. Referências são sempre relativas à raiz Git, têm limites determinísticos e falham antes da inferência quando são inválidas, binárias, sensíveis ou escapam do workspace.

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

O próprio `run`, `continue` ou `resume` mostra imediatamente o `runId`, o worktree e o progresso resumido. Para integrações que exigem saída estruturada, use `--progress jsonl`; para silenciar o acompanhamento, use `--progress off`.

Durante `/fix`, eventos como `tool write pending` indicam que o modelo ainda está montando uma chamada de ferramenta. A escrita é atômica: o arquivo só aparece quando os argumentos terminam de ser gerados e validados, portanto não há arquivo parcial para acompanhar. Cada resposta do coder é limitada a 8.192 tokens e o `/fix` inteiro tem timeout de inferência de 180 segundos; ao excedê-lo, a execução falha sem publicar uma escrita incompleta. Os arquivos concluídos aparecem primeiro no `worktree` mostrado na linha `[run]`, e não no diretório principal do projeto.

O `/fix` permite somente um reparo após a primeira revisão. Em arquivos existentes, esse reparo deve editar apenas os trechos apontados e preservar o restante; se a segunda revisão ainda encontrar um defeito acionável, o run falha fechado e mantém os checkpoints no worktree para inspeção, em vez de iniciar um ciclo indefinido.

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
