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

O benchmark também mostrou uma oportunidade posterior: mesmo depois de a
transformação determinística satisfazer o contrato, o implementador ainda foi
invocado e tentou reeditar o arquivo. Eliminar essa inferência redundante exige
um critério geral de completude e pertence ao contexto/budget do Milestone 20;
não foi usado para alterar o gate deste benchmark.
