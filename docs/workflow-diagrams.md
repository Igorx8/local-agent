# Fluxos do Local Agent

Este documento resume o caminho executado por cada modo do `local-agent`. Os
diagramas descrevem o comportamento implementado atualmente.

## Escolha do fluxo

```mermaid
flowchart TD
    A[Entrada no local-agent] --> B{Comando explícito?}
    B -->|/ask| ASK[Consulta somente leitura]
    B -->|/fix| FIX[Correção focada]
    B -->|/run| RUN[Workflow completo]
    B -->|Não| C{Parece uma pergunta?}
    C -->|Sim| ASK
    C -->|Não ou ação ambígua| RUN
```

O roteamento automático nunca escolhe `/fix`. Uma mutação focada exige o
comando explícito; pedidos de ação comuns seguem o caminho mais conservador do
`/run`.

## `/ask`: pergunta rápida

```mermaid
flowchart TD
    A[Receber pergunta] --> B[Resolver referências @arquivo]
    B --> C[Carregar memória recente limitada]
    C --> D{Usou --web?}
    D -->|Sim| E[Validar e obter uma URL explícita]
    D -->|Não| F[Montar prompt]
    E --> F
    F --> G[Gate do runtime e carregar qwen36-main]
    G --> H[Uma inferência somente leitura]
    H --> I[Salvar resposta e memória limitada]
    I --> J[Descarregar modelo]
```

Características:

- não permite `write`, `edit`, `bash`, subtarefas ou web implícita;
- lê arquivos somente quando referenciados por `@`;
- acessa a web somente com `/ask --web` e uma URL explícita;
- não cria workflow de engenharia nem altera o repositório.

## `/fix`: correção pequena e localizada

```mermaid
flowchart TD
    A[Receber tarefa focada] --> B[Preflight e gate do runtime]
    B --> C[Snapshot destacado do estado atual]
    C --> D[Gates do baseline]
    D -->|Falha| X[Falhar sem iniciar implementação]
    D -->|Passa| E[Implementar diretamente na raiz]
    E --> F[Alterações aparecem na IDE]
    F --> G[Checkpoint destacado da implementação]
    G --> H[Validar caminhos e executar gates]
    H -->|Falha| Y[Manter alterações visíveis e falhar]
    H -->|Passa| I[Revisão focada independente]
    I --> J[Validar findings]
    J -->|Sem blocker| S[Sucesso]
    J -->|Blocker alto ou crítico| K{Reparo já utilizado?}
    K -->|Não| L[Executar um reparo mínimo]
    L --> M[Checkpoint do reparo]
    M --> H
    K -->|Sim| Y
    S --> N[Descarregar modelo]
    X --> N
    Y --> N
```

O `/fix` trabalha diretamente na raiz aberta pela IDE. Seus checkpoints usam
um índice Git temporário: não adicionam arquivos ao index do usuário, não movem
`HEAD`, não criam commit na branch atual e não fazem merge automático.

## `/run`: workflow completo e auditado

```mermaid
flowchart TD
    A[Receber tarefa] --> B[Preflight e gate do runtime]
    B --> C[Criar worktree isolado]
    C --> D[Capturar baseline e executar gates]
    D --> E[Gerar e validar critérios de aceitação]
    E --> F[Desenhar e validar testes-oráculo]
    F --> G[Planejar e validar o plano]
    G --> H[Implementar no worktree]
    H --> I[Checkpoint da implementação]
    I --> J[Executar gates determinísticos]
    J --> K[Revisão do repositório]
    K --> L[Revisão dos requisitos]
    L --> M[Unir e validar findings]
    M --> N[Avaliar progresso]
    N -->|Blockers reparáveis| O[Reparar e criar checkpoint]
    O --> P[Revisão incremental]
    P --> J
    N -->|Decisão humana ou estagnação| X[Escalar sem publicar]
    N -->|Gates passam e sem blockers| Q[Verificações avançadas]
    Q --> R[Auditoria final independente]
    R -->|Reprovado| Y[Falhar sem publicar]
    R -->|Aprovado| S[Gerar patch e publicar na raiz]
    S --> T[Alterações aparecem na IDE]
    T --> U[Descarregar modelo]
    X --> U
    Y --> U
```

As verificações avançadas cobrem testes adversariais, property testing,
mutation testing e análise de flakiness. Uma capacidade não configurada é
registrada como `skipped`; nunca é presumida como executada.

## Onde os arquivos são alterados

```mermaid
flowchart LR
    ASK[/ask/] -->|somente leitura| ROOT[Repositório aberto]
    FIX[/fix/] -->|edita imediatamente| ROOT
    RUN[/run/] -->|trabalha primeiro| WT[Worktree isolado]
    WT -->|somente após aprovação final| ROOT
```

| Entrada | Pode alterar arquivos | Local durante a execução | Visibilidade na IDE |
| --- | --- | --- | --- |
| `/ask` | Não | Raiz, somente leitura | Não altera |
| `/fix` | Sim | Raiz atual | Imediata |
| `/run` | Sim | Worktree isolado | Após sucesso e publicação |
| Pergunta em texto comum | Não | Mesmo fluxo de `/ask` | Não altera |
| Ação em texto comum | Sim | Mesmo fluxo de `/run` | Após sucesso e publicação |

## Gate operacional antes de usar a GPU

```mermaid
flowchart TD
    A[Pedido precisa de modelo] --> B{Reboot pendente ou driver mudou?}
    B -->|Sim| X[Bloquear e pedir reboot completo]
    B -->|Não| C{nvidia-smi e driver saudáveis?}
    C -->|Não| X
    C -->|Sim| D{Outro processo CUDA pesado?}
    D -->|Sim| Y[Bloquear por concorrência]
    D -->|Não| E{RAM e VRAM suficientes?}
    E -->|Não| Z[Bloquear por capacidade]
    E -->|Sim| F[Carregar exatamente um modelo]
    F --> G[Executar inferência]
    G --> H[Descarregar e confirmar encerramento]
```

Esse gate representa a mitigação desejada para incidentes como atualização de
kernel ou driver NVIDIA durante uma sessão gráfica. O harness deve falhar antes
de carregar um modelo quando o driver estiver indisponível ou um reboot estiver
pendente. Isso reduz o risco, mas não substitui um desligamento completo após
uma GPU entrar em estado inválido e não impede falhas externas do kernel,
firmware ou hardware.

