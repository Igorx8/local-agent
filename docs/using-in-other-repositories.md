# Usando o harness em outros repositórios

O `harness` pode ser executado em qualquer projeto pessoal versionado com Git. Não é necessário copiar o código do agente para cada projeto.

Para uma visão rápida das fases, decisões e locais de escrita, consulte
[Fluxos do Local Agent](workflow-diagrams.md).

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
/apply fix-20260918181332-7912e5fc
```

O `/fix` pode repetir uma falha transitória de inferência local conforme `workflow.inferenceRetries`. O progresso informa a nova tentativa; se o OpenCode não estiver mais saudável, o turno para imediatamente e identifica a fase que falhou.

Se um agente concluir seu trabalho mas responder em prosa ou com JSON incompatível, o harness solicita uma única correção de formato na mesma sessão, com ferramentas de escrita desabilitadas. A implementação e seu checkpoint não são repetidos. Uma segunda resposta inválida falha de forma fechada.

Inferências longas são submetidas de forma assíncrona e acompanhadas até a sessão terminar; um heartbeat `Still working` aparece a cada 30 segundos sem conteúdo do prompt. Use `/fix` somente para uma alteração pequena e localizada. Tarefas que decompõem um plano grande ou criam muitos arquivos pertencem ao `/run`.

O `/fix` usa agentes próprios com no máximo oito passos e encerra uma inferência focada que não termine em três minutos. Timeout não é repetido automaticamente; falhas transitórias podem receber no máximo uma nova tentativa. Isso impede que uma tarefa pequena ocupe dezenas de minutos sem produzir uma alteração.

O progresso incremental distingue carregamento do modelo, tool calls, arquivos alterados e tokens concluídos por passo. Entradas e conteúdos dos arquivos não são impressos. O `/fix` lê e edita diretamente o repositório aberto na IDE; arquivos aparecem na raiz assim que a ferramenta de escrita termina e permanecem visíveis mesmo se uma revisão posterior falhar. Para auditoria, o harness cria snapshots Git destacados com um índice temporário, sem adicionar arquivos ao index do usuário, mover `HEAD`, criar commit na branch ou fazer merge. O `/run` completo continua isolado internamente e publica o resultado aprovado na raiz ao final.

Ao iniciar, `local-agent` também consulta o endpoint llama.cpp. Um processo cujo pai já terminou, que corresponda exatamente ao executável, porta e alias locais registrados, é encerrado antes de aceitar prompts. Se o processo ainda tiver um proprietário ativo ou não puder ser identificado sem ambiguidade, o shell falha sem matar nada e pede que a outra sessão seja encerrada.

O gate de GPU permite clientes gráficos conhecidos do desktop (`ptyxis`, GNOME Shell, Xwayland e Xorg), que continuam contabilizados no limite agregado de VRAM. Processos computacionais como Python/ComfyUI, Blender ou workers desconhecidos continuam bloqueando o carregamento para evitar pressão concorrente.

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

Uma raiz modificada pelo próprio harness pode ser usada diretamente pelo próximo `/fix`: o agente reconhece o commit e os blobs exatos do checkpoint anterior, cria o novo worktree a partir deles e atualiza a raiz ao concluir o próximo checkpoint. `working tree is dirty` permanece reservado para conteúdo que não corresponda exatamente a um checkpoint conhecido, evitando que alterações manuais sejam confundidas com saída do agente.

Se o implementer concluir que o conteúdo herdado já atende ao pedido e produzir bytes idênticos, o harness registra `checkpoint.reused` e continua a validação usando o checkpoint anterior. Ele não tenta criar um commit vazio. Sem checkpoint herdado, ausência total de mudanças continua sendo erro, pois `/fix` recebeu autorização explícita para modificar algo.

Se um run terminal falhar depois de já criar um checkpoint aproveitável, use `/apply [run-id]` no `local-agent` — sem ID, o comando escolhe o run mais recente. Ele recupera o último checkpoint como alterações não commitadas na raiz, sem carregar modelos novamente. Em runs que não tiveram sucesso, esse comando é a aprovação explícita do usuário para ignorar o veredito automático; a origem, o commit e os arquivos aplicados ficam registrados em `manual-publication.json`. Runs ativos ou pausados e raízes alteradas concorrentemente são recusados.

Durante `/fix`, eventos como `tool write pending` indicam que o modelo ainda está montando uma chamada de ferramenta. Quando o OpenCode publica argumentos parciais, eventos `input is streaming` mostram somente a quantidade gerada em bytes. Como algumas versões do OpenCode mantêm esses argumentos bufferizados, o harness também consulta os slots ativos do llama.cpp e acompanha `next_token.n_decoded`; eventos `model generation is progressing` mostram esse progresso em blocos de 128 tokens. Nenhum desses eventos expõe conteúdo. A escrita permanece atômica: o arquivo aparece diretamente na raiz quando os argumentos terminam. Cada resposta do coder é limitada a 8.192 tokens. Uma inferência focada pode durar no máximo 600 segundos, mas é cancelada antes se passar 100 segundos sem progresso em nenhuma das fontes.

O `/fix` permite somente um reparo após a primeira revisão. Em arquivos existentes, esse reparo deve editar apenas os trechos apontados e preservar o restante; se a segunda revisão ainda encontrar um defeito acionável, o run falha fechado e mantém os checkpoints no worktree para inspeção, em vez de iniciar um ciclo indefinido.

Antes desse reparo, um validator independente classifica todos os findings do reviewer. Apenas defeitos confirmados de severidade alta ou crítica bloqueiam o `/fix`; requisitos inventados, preferências de estilo e itens fora de escopo são rejeitados. Se o repair atingir seu limite sem alterar arquivos, o erro informa os blockers declarados antes de tentar criar um checkpoint vazio.

Para defeitos de unicidade, numeração, links ou referências, “reparo localizado” limita a edição, mas não a verificação: o agente deve inspecionar o namespace completo do arquivo antes e depois da mudança. Isso evita corrigir uma colisão criando outra em uma faixa diferente.

## Gate de recursos antes de carregar modelos

Antes de qualquer carga ou troca, o harness confirma que há recursos seguros no host. Por padrão, ele exige RAM disponível igual ao tamanho exato do GGUF mais 2 GiB, no máximo 1 GiB de swap já utilizado, no máximo 2 GiB de VRAM ocupada e nenhum processo CUDA externo. Isso também vale para `harness model start` e `harness model switch`.

Quando alguma condição falhar, nenhum novo modelo é iniciado. A mensagem `model admission blocked` informa as medições que bloquearam a operação. Encerre downloads, descompactações, ComfyUI ou outras cargas pesadas e tente novamente. O harness não encerra processos externos automaticamente. Os limites podem ser ajustados explicitamente em `runtime`, mas reduzi-los enfraquece a proteção:

```yaml
runtime:
  modelAdmissionRamReserveMiB: 2048
  modelAdmissionMaxSwapUsedMiB: 1024
  modelAdmissionMaxVramUsedMiB: 2048
  modelAdmissionBlockForeignCuda: true
```

Os limites do watchdog focado também podem ser ajustados explicitamente:

```yaml
workflow:
  focusedInferenceTimeoutMs: 600000
  focusedInferenceIdleTimeoutMs: 100000
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
