# Roadmap de estabilização do Local Agent

O objetivo é tornar o `local-agent` fluido e previsível para trabalho pessoal,
priorizando qualidade, evidência e segurança acima de velocidade. A limitação de
hardware pode aumentar a latência, mas não deve justificar resultados genéricos,
mudanças fora de escopo ou falsos sucessos.

## Estado atual

O fluxo documental já opera diretamente no repositório, aceita referências com
`@arquivo`, cria checkpoints, executa gates determinísticos e usa revisão
independente. O benchmark de referência terminou corretamente, mas consumiu 582
segundos, 46.499 tokens de entrada observados, 10.153 tokens de saída e 23
chamadas de ferramenta para alterar um único Markdown.

Isso comprova viabilidade, mas ainda não consistência geral. O uso com código
continua experimental até passar pela escada de validação descrita abaixo.

## Princípios inegociáveis

- Uma otimização nunca pode remover um gate necessário ou converter incerteza
  em sucesso.
- Evidência determinística prevalece sobre opinião de modelo.
- Transformações automáticas só são permitidas quando o resultado é único,
  verificável, limitado a intervalos conhecidos e reversível por checkpoint.
- Conteúdo não relacionado não deve ser enviado aos modelos.
- Edições devem preservar bytes fora do escopo sempre que possível.
- Qualidade é multidimensional; tempo baixo não compensa requisito ausente.
- Capacidades só são declaradas estáveis depois de execuções repetidas, não por
  um único caso bem-sucedido.

## Sequência planejada

### 1. Performance medida

- Gerar `performance.json` por execução.
- Remover releituras de referências já anexadas.
- Reduzir reescritas integrais e trocas evitáveis de modelo.
- Comparar sempre o mesmo prompt, fixture e estado inicial.

### 2. Transformações determinísticas

- Começar por IDs estruturados ausentes em listas explicitamente reconhecidas.
- Recusar estruturas ambíguas ou numeração não derivável.
- Provar preservação do conteúdo fora das linhas modificadas.
- Manter checkpoint, gates e revisão independente.

### 3. Qualidade menos genérica

- Medir completude, especificidade, rastreabilidade, verificabilidade e
  invenções não suportadas separadamente.
- Exigir critérios mensuráveis somente quando o prompt pedir esse nível de
  detalhe.
- Entregar ao reviewer o contrato explícito e a evidência relevante, não o
  repositório inteiro sem seleção.

### 4. Contexto e budgets adaptativos

- Montar um manifesto mínimo de contexto para cada papel.
- Aplicar limites proporcionais ao tipo de tarefa, arquivos e risco.
- Estender limites apenas quando houver progresso objetivo.
- Mostrar rota, contrato, alterações e verificações restantes no terminal.

### 5. Escada de validação com código

1. Inspeção somente leitura.
2. Alteração de uma linha em um arquivo.
3. Correção localizada acompanhada por teste de regressão.
4. Mudança coordenada em poucos arquivos.
5. Refatoração com comportamento preservado.
6. Workflow arquitetural completo.

Uma falha em um nível impede promover o próximo, mas não invalida capacidades
de menor risco já comprovadas.

### 6. Estabilização operacional

- Medir repetibilidade, falso sucesso, falso bloqueio, retries e reparos.
- Validar interrupção, recuperação, limpeza de modelos e continuidade da sessão.
- Publicar uma matriz com capacidades comprovadas, experimentais, bloqueadas e
  não suportadas no hardware instalado.

## Métricas de decisão

Cada benchmark deve registrar:

- cobertura dos requisitos;
- correção e resultado dos gates;
- mudanças não solicitadas;
- concordância entre gates e reviewer;
- falso sucesso e falso bloqueio;
- duração total e tempo até o primeiro progresso visível;
- tokens, chamadas de ferramenta e trocas de modelo;
- retries, reparos e handoffs;
- arquivos e linhas realmente modificados.

O detalhamento normativo e os critérios de aceite ficam em
`SPEC-local-multi-agent-harness.md`, nos Milestones 18 a 22 e AC-120 a AC-140.
