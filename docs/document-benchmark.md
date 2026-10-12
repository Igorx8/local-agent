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

Em 12/10/2026, a execução ao vivo permaneceu bloqueada nesta sessão: o
`harness doctor` não conseguiu acessar o driver NVIDIA e os endpoints locais do
OpenCode e llama.cpp estavam indisponíveis. Nenhum modelo foi iniciado e esse
estado não foi tratado como evidência de benchmark. Quando o runtime estiver
saudável, as duas medições ainda devem partir da mesma fixture e árvore inicial;
o histórico textual de 582 segundos não substitui um snapshot completo.
