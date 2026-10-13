# Benchmark documental controlado

O benchmark do Milestone 19 compara duas execuções somente quando ambas usam o
mesmo prompt, fixture, árvore Git inicial, runtime e artefatos de modelo. Uma
diferença em qualquer identidade produz `blocked`, nunca um resultado aproximado.

Cada snapshot JSON deve conter:

- hashes SHA-256 da fixture e do prompt;
- hash da árvore Git inicial;
- fingerprints do runtime e dos modelos;
- as cinco dimensões de qualidade, sem nota agregada;
- duração, tokens, ferramentas, trocas de modelo, retries e reparos.

Compare os snapshots depois de compilar o projeto:

```fish
harness benchmark document-compare before.json after.json
```

O veredito padrão exige todas as dimensões obrigatórias aprovadas, nenhuma
falha de invenção não suportada e redução mínima de 20% nos tokens de saída. O
limite pode ser alterado explicitamente, sem alterar os gates de qualidade:

```fish
harness benchmark document-compare before.json after.json --minimum-reduction 0.3
```

Em 12/10/2026, a primeira verificação isolada não enxergou o driver NVIDIA nem
os endpoints locais e foi corretamente mantida como bloqueada. Depois que o
usuário iniciou o `local-agent`, `harness doctor --live --json` validou os dois
modelos em sequência, contagem exata de tokens, tool-call, troca e
descarregamento, terminando com aproximadamente 301 MiB de VRAM em uso e sem
servidor llama.cpp residual. Isso resolve o bloqueio de runtime, mas não
substitui os dois snapshots do benchmark. As medições ainda devem partir da
mesma fixture e árvore inicial; o histórico textual de 582 segundos não é um
snapshot completo comparável.

## Resultado controlado de 12/10/2026

A fixture `benchmarks/document-identifiers-v1` contém oito fases e 64 tarefas.
Objetivos, passos, evidências, exemplos e critérios mensuráveis já estão
corretos; somente os identificadores estruturados estão ausentes. A baseline é
a revisão `19e2b80`, anterior ao transformador, e a candidata é a revisão atual.

| Métrica | Baseline | Candidata | Delta |
| --- | ---: | ---: | ---: |
| Status do workflow | falhou após 1 reparo | sucesso | melhora |
| Duração | 294.425 ms | 244.770 ms | −49.655 ms |
| Tokens de entrada | 68.607 | 21.709 | −46.898 |
| Tokens de saída | 11.269 | 4.870 | −6.399 (−56,8%) |
| Tool calls | 18 | 6 | −12 |
| Reparos | 1 | 0 | −1 |

A baseline inseriu identificadores sem o delimitador contratual e alterou
títulos, falhando em rastreabilidade e preservação. A candidata passou
completude, especificidade, rastreabilidade, verificação e ausência de invenção,
preservando todos os bytes fora dos IDs. Fixture, prompt, árvore Git inicial,
runtime e modelos tiveram fingerprints idênticos; o veredito persistido em
`benchmarks/results/verdict.json` é `passed`.

## Incremento de contexto do Milestone 20

O harness agora persiste um manifesto de contexto sem conteúdo, com hash da
instrução, proveniência das fontes, alvos, contrato, intervalos alterados e a
evidência necessária por papel. A inferência do implementador só é omitida
quando o usuário exige preservação do restante do conteúdo, não pede outra
mutação semântica, todos os alvos recebem a transformação determinística e os
gates de Markdown passam. A revisão independente e os gates do repositório
continuam obrigatórios.

Uma repetição comparável da mesma fixture terminou com sucesso em 64.554 ms,
11.577 tokens de entrada, 3.745 de saída e 2 tool calls, sem retry ou reparo.
Contra a candidata anterior, isso reduz 180.216 ms, 10.132 tokens de entrada,
1.125 tokens de saída (23,1%) e 4 ferramentas. As cinco dimensões continuaram
aprovadas e todos os bytes fora dos IDs foram preservados. Os snapshots são
`document-m20-context.json` e `document-m20-context.json.md`; o comparador
persistido em `document-m20-context-verdict.json` retornou `passed`.
