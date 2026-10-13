# Plano de implementação

## Fase 0 — Preparação (TASK-000)

**Objetivo:** Preparar um ambiente local reproduzível.

**Tarefas principais:**
- TASK-001 Confirmar ferramentas instaladas
- TASK-002 Registrar versões utilizadas
- TASK-003 Criar estrutura inicial
- TASK-004 Definir variáveis locais
- TASK-005 Validar acesso ao repositório
- TASK-006 Documentar pré-requisitos
- TASK-007 Executar verificação inicial
- TASK-008 Preservar evidências

**Passos operacionais:**
1. Execute a verificação inicial e registre o resultado.

**Evidência:** [`fase-0.json`](evidencias/fase-0.json)

**Exemplo:** Entrada: `harness doctor --json`

**Critério de conclusão:** `harness doctor --json` retorna exit code 0.

## Fase 1 — Domínio (TASK-049)

**Objetivo:** Tornar as regras centrais explícitas e verificáveis.

**Tarefas principais:**
- TASK-009 Definir entidades principais
- TASK-010 Registrar invariantes
- TASK-011 Mapear estados válidos
- TASK-012 Descrever transições
- TASK-013 Separar regras de negócio
- TASK-014 Criar exemplos mínimos
- TASK-015 Documentar erros esperados
- TASK-016 Validar o vocabulário

**Passos operacionais:**
1. Revise as invariantes e execute os testes de domínio.

**Evidência:** [`fase-1.json`](evidencias/fase-1.json)

**Exemplo:** Entrada: `npm test -- domain`

**Critério de conclusão:** 100% dos testes de domínio passam.

## Fase 2 — API (TASK-050)

**Objetivo:** Disponibilizar contratos HTTP consistentes.

**Tarefas principais:**
- TASK-017 Definir contratos HTTP
- TASK-018 Mapear códigos de resposta
- TASK-019 Validar entradas
- TASK-020 Padronizar erros
- TASK-021 Implementar endpoint de criação
- TASK-022 Implementar endpoint de consulta
- TASK-023 Registrar exemplos de payload
- TASK-024 Verificar compatibilidade

**Passos operacionais:**
1. Inicie a API e execute os testes de contrato.

**Evidência:** [`fase-2.json`](evidencias/fase-2.json)

**Exemplo:** Entrada: `curl http://127.0.0.1:3000/health`

**Critério de conclusão:** O endpoint de saúde retorna HTTP status 200.

## Fase 3 — Persistência (TASK-051)

**Objetivo:** Persistir dados sem violar invariantes.

**Tarefas principais:**
- TASK-025 Definir esquema inicial
- TASK-026 Criar migrações
- TASK-027 Implementar repositórios
- TASK-028 Tratar concorrência
- TASK-029 Validar índices
- TASK-030 Preparar dados de teste
- TASK-031 Documentar recuperação
- TASK-032 Medir consultas principais

**Passos operacionais:**
1. Aplique as migrações e execute a suíte de persistência.

**Evidência:** [`fase-3.json`](evidencias/fase-3.json)

**Exemplo:** Entrada: `npm test -- persistence`

**Critério de conclusão:** Todos os testes de persistência passam em menos de 60 segundos.

## Fase 4 — Mensageria (TASK-052)

**Objetivo:** Processar eventos de forma recuperável.

**Tarefas principais:**
- TASK-033 Definir eventos publicados
- TASK-034 Definir consumidores
- TASK-035 Configurar retentativas
- TASK-036 Tratar mensagens duplicadas
- TASK-037 Registrar dead letters
- TASK-038 Testar ordenação necessária
- TASK-039 Documentar contratos
- TASK-040 Validar falhas transitórias

**Passos operacionais:**
1. Publique uma mensagem de teste e confirme o consumo.

**Evidência:** [`fase-4.json`](evidencias/fase-4.json)

**Exemplo:** Entrada: `event-test-001`

**Critério de conclusão:** 1 mensagem publicada resulta em 1 processamento confirmado.

## Fase 5 — Observabilidade (TASK-053)

**Objetivo:** Produzir sinais suficientes para diagnóstico local.

**Tarefas principais:**
- TASK-041 Definir logs estruturados
- TASK-042 Adicionar métricas essenciais
- TASK-043 Propagar identificadores de correlação
- TASK-044 Configurar traces locais
- TASK-045 Criar painel mínimo
- TASK-046 Definir alertas iniciais
- TASK-047 Registrar procedimentos de diagnóstico
- TASK-048 Validar ausência de dados sensíveis

**Passos operacionais:**
1. Execute o cenário instrumentado e consulte os três sinais.

**Evidência:** [`fase-5.json`](evidencias/fase-5.json)

**Exemplo:** Entrada: `trace-id-001`

**Critério de conclusão:** Logs, métricas e traces registram o mesmo identificador em 3 verificações.

## Fase 6 — Qualidade

**Objetivo:** Detectar regressões antes da entrega.

**Tarefas principais:**
- Criar testes unitários
- Criar testes de integração
- Definir fixtures estáveis
- Verificar casos de erro
- Executar análise estática
- Medir cobertura relevante
- Registrar limitações conhecidas
- Validar testes de regressão

**Passos operacionais:**
1. Execute todos os gates configurados e arquive o relatório.

**Evidência:** [`fase-6.json`](evidencias/fase-6.json)

**Exemplo:** Entrada: `npm test`

**Critério de conclusão:** `npm test` finaliza com exit code 0 e 0 testes falhando.

## Fase 7 — Operação

**Objetivo:** Tornar entrega e recuperação repetíveis.

**Tarefas principais:**
- Preparar configuração local
- Documentar inicialização
- Documentar encerramento
- Definir procedimento de rollback
- Validar backup e restauração
- Criar checklist de entrega
- Registrar riscos residuais
- Executar ensaio final

**Passos operacionais:**
1. Execute o checklist de entrega e o ensaio de rollback.

**Evidência:** [`fase-7.json`](evidencias/fase-7.json)

**Exemplo:** Entrada: `rollback --dry-run`

**Critério de conclusão:** O ensaio final conclui 8 itens e o rollback retorna exit code 0.
