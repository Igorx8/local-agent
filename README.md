# Local Agent

Agente de programação local para uso no terminal integrado da IDE. Ele combina
OpenCode e modelos executados pelo llama.cpp, mantém contexto entre prompts e
oferece uma interface interativa semelhante às CLIs do Claude e do Codex.

Todo processamento de modelo é local. O agente não configura provedores de
modelos em nuvem e nunca faz merge ou commit automático na branch do projeto.

## Objetivo do projeto

O projeto nasceu para oferecer um harness de engenharia seguro e operacional
que rode inteiramente na máquina do usuário. A proposta é proporcionar uma
experiência prática próxima à de agentes como Claude Code e Codex, preservando
controle sobre os modelos, o código e os recursos do computador.

O harness coordena planejamento, implementação, testes e revisões com modelos
locais, mantém evidências auditáveis e aplica limites explícitos de escopo,
tempo e recursos. Em máquinas com VRAM limitada, somente um modelo grande pode
ficar carregado por vez; uma troca só ocorre depois que o modelo anterior foi
encerrado e seus recursos foram liberados.

As proteções operacionais existem para evitar alterações fora do repositório,
execução insegura de comandos, perda de trabalho, publicação automática na
branch atual e sobrecarga previsível de RAM ou GPU. Quando uma condição não pode
ser comprovada com segurança, o comportamento esperado é interromper a operação
e informar o bloqueio, em vez de presumir que o ambiente está saudável.

## Requisitos

- Ubuntu ou outra distribuição Linux compatível;
- Git;
- Node.js 22 ou superior;
- OpenCode 1.18.25 ou versão compatível;
- llama.cpp com o executável `llama-server`;
- GPU NVIDIA compatível e driver CUDA funcional;
- espaço em RAM e VRAM suficiente para manter um modelo por vez;
- os modelos locais registrados como `qwen36-main` e `qwen3-coder-impl`;
- variável persistente `LLAMA_API_KEY` configurada no shell.

O computador usado no desenvolvimento possui uma RTX 5060 Ti de 16 GB. Outras
configurações precisam respeitar os limites de memória definidos na configuração
local.

Depois de atualizar kernel ou driver NVIDIA, reinicie o computador antes de
usar o agente. Confirme primeiro que `nvidia-smi` funciona normalmente.

## Preparação inicial

Dentro deste repositório:

```fish
npm install
npm run build
npm link
npm run dev -- model prepare
```

`model prepare` localiza e registra modelos que já existem no cache local. Ele
não baixa modelos nem escolhe substitutos automaticamente.

Valide a instalação:

```fish
harness doctor --json
```

Avisos sobre adaptadores opcionais são esperados. Itens `blocked` relacionados
ao modelo ou à GPU devem ser resolvidos antes de iniciar uma tarefa que use
inferência.

## Uso diário

Abra o terminal da IDE no repositório em que deseja trabalhar e execute:

```fish
cd /caminho/do/projeto
local-agent
```

O comando encontra a raiz Git, verifica o ambiente, inicia ou reutiliza o
OpenCode local e gerencia o carregamento e descarregamento dos modelos. Não é
necessário iniciar o llama.cpp manualmente.

Dentro da sessão, escreva normalmente:

```text
you> como este projeto está organizado?
you> /ask explique @README.md
you> /fix corrija o erro em @src/service.ts
you> /run implemente a primeira etapa de @docs/plano.md
```

Referências aceitas:

- `@arquivo` inclui um arquivo no prompt;
- `@"caminho com espaços.md"` inclui um caminho com espaços;
- `@@` representa um `@` literal.

## Modos principais

| Entrada | Uso | Escrita |
| --- | --- | --- |
| Pergunta comum ou `/ask` | resposta rápida e leitura de arquivos | não altera arquivos |
| `/ask --web URL` | leitura controlada de uma URL explícita | não altera arquivos |
| `/fix` | mudança pequena e localizada, com gates e revisão | edita diretamente o repositório aberto |
| Pedido de ação comum ou `/run` | workflow completo e auditado | publica na raiz somente após aprovação |

Use `/help` dentro da sessão para ver todos os comandos. Os mais úteis são:

```text
/help
/status
/ask <pergunta>
/fix <tarefa pequena>
/run <tarefa completa>
/pause
/resume
/new
/exit
```

`Ctrl+D` ou `/exit` encerra a sessão. O `local-agent` também encerra os serviços
e modelos que ele próprio iniciou.

## Arquivos gerados no projeto

O agente armazena memória limitada, relatórios, checkpoints e evidências em:

```text
.agent-harness/
```

Esses artefatos permitem acompanhar, retomar e auditar operações. O agente não
cria commits na branch atual nem faz merge automático.

## Documentação

- [Fluxos e diagramas](docs/workflow-diagrams.md)
- [Uso em outros repositórios](docs/using-in-other-repositories.md)
- [Compatibilidade do ambiente](docs/compatibility-report.md)
- [Especificação completa](SPEC-local-multi-agent-harness.md)
