# Milestone 12: referências explícitas e progresso na IDE

O Milestone 12 adiciona referências locais `@arquivo` e feedback imediato aos comandos longos. Nenhum arquivo é lido implicitamente: somente referências presentes no prompt atual são anexadas.

## Uso no Fish e no terminal da IDE

Execute no Git workspace que será alterado:

```fish
harness run --new 'implemente o plano descrito em @docs/plano.md'
harness continue 'compare @src/config.ts com @"docs/configuração local.md"'
harness chat
```

No `chat`, a mesma sintaxe funciona em cada prompt. Caminhos são relativos à raiz Git selecionada, mesmo quando o comando parte de um subdiretório. Para escrever um `@` literal sem ler arquivo, duplique-o:

```text
documente o identificador @@usuario
```

Use aspas internas para caminhos com espaços. Envolva o prompt inteiro com aspas simples no Fish, como no exemplo, para que as aspas internas cheguem ao harness.

## Validação e segurança

Antes de criar o run ou iniciar inferência, o harness resolve todos os caminhos, canonicaliza symlinks e acumula os erros encontrados. A operação inteira é recusada quando qualquer referência:

- não existe, não é legível ou não é arquivo regular;
- resolve para fora do workspace, inclusive por symlink;
- corresponde a `scope.deniedPaths` ou `security.deniedPathPatterns`;
- é binária ou excede limites configurados.

Os padrões iniciais bloqueiam `.env` e `.ssh`. O conteúdo de um arquivo recusado nunca aparece no erro. Conteúdo aceito é delimitado por caminho, bytes e SHA-256 e tratado como dados, não como comando. Não há expansão de shell ou execução do texto referenciado.

Os limites ficam em `fileReferences`:

```yaml
fileReferences:
  maxFileBytes: 131072
  maxTotalBytes: 262144
  maxEstimatedTokens: 32768
```

Não há truncamento silencioso. O artefato `file-references.json` registra somente caminho, bytes, estimativa de tokens e SHA-256. A memória da conversa guarda essa proveniência limitada, sem copiar novamente o conteúdo.

## Progresso e integração com IDE

`run`, `continue` e `resume` imprimem imediatamente o `runId` e o worktree isolado. Durante a execução, o modo padrão escreve em `stderr` eventos curtos de estágio, papel/modelo, retry, checkpoint, gate, handoff, pausa e término. A resposta final continua em `stdout`.

```fish
harness run --new 'corrija o problema' --progress human
harness continue 'adicione o teste' --progress off
harness resume RUN_ID --progress human
```

`--follow` é um alias explícito e documentativo para o acompanhamento humano, que já é ligado por padrão. Para uma IDE ou script consumir uma linha JSON por evento:

```fish
harness run --new 'corrija o problema' --progress jsonl | jq -c .
```

Nesse modo, `run.created`, `run.progress` e `run.result` são objetos JSONL. O feed usa uma lista fechada de campos e não inclui prompts, respostas nem logs ilimitados do modelo. Os artefatos completos continuam disponíveis em `.agent-harness/runs/<runId>/`.
