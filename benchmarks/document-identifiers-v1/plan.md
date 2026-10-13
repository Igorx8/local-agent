# Plano de implementação

## Fase 0 — Preparação

**Objetivo:** Preparar um ambiente local reproduzível.

**Tarefas principais:**
- Confirmar ferramentas instaladas
- Registrar versões utilizadas
- Criar estrutura inicial
- Definir variáveis locais
- Validar acesso ao repositório
- Documentar pré-requisitos
- Executar verificação inicial
- Preservar evidências

**Passos operacionais:**
1. Execute a verificação inicial e registre o resultado.

**Evidência:** [`fase-0.json`](evidencias/fase-0.json)

**Exemplo:** Entrada: `harness doctor --json`

**Critério de conclusão:** `harness doctor --json` retorna exit code 0.

## Fase 1 — Domínio

**Objetivo:** Tornar as regras centrais explícitas e verificáveis.

**Tarefas principais:**
- Definir entidades principais
- Registrar invariantes
- Mapear estados válidos
- Descrever transições
- Separar regras de negócio
- Criar exemplos mínimos
- Documentar erros esperados
- Validar o vocabulário

**Passos operacionais:**
1. Revise as invariantes e execute os testes de domínio.

**Evidência:** [`fase-1.json`](evidencias/fase-1.json)

**Exemplo:** Entrada: `npm test -- domain`

**Critério de conclusão:** 100% dos testes de domínio passam.

## Fase 2 — API

**Objetivo:** Disponibilizar contratos HTTP consistentes.

**Tarefas principais:**
- Definir contratos HTTP
- Mapear códigos de resposta
- Validar entradas
- Padronizar erros
- Implementar endpoint de criação
- Implementar endpoint de consulta
- Registrar exemplos de payload
- Verificar compatibilidade

**Passos operacionais:**
1. Inicie a API e execute os testes de contrato.

**Evidência:** [`fase-2.json`](evidencias/fase-2.json)

**Exemplo:** Entrada: `curl http://127.0.0.1:3000/health`

**Critério de conclusão:** O endpoint de saúde retorna HTTP status 200.

## Fase 3 — Persistência

**Objetivo:** Persistir dados sem violar invariantes.

**Tarefas principais:**
- Definir esquema inicial
- Criar migrações
- Implementar repositórios
- Tratar concorrência
- Validar índices
- Preparar dados de teste
- Documentar recuperação
- Medir consultas principais

**Passos operacionais:**
1. Aplique as migrações e execute a suíte de persistência.

**Evidência:** [`fase-3.json`](evidencias/fase-3.json)

**Exemplo:** Entrada: `npm test -- persistence`

**Critério de conclusão:** Todos os testes de persistência passam em menos de 60 segundos.

## Fase 4 — Mensageria

**Objetivo:** Processar eventos de forma recuperável.

**Tarefas principais:**
- Definir eventos publicados
- Definir consumidores
- Configurar retentativas
- Tratar mensagens duplicadas
- Registrar dead letters
- Testar ordenação necessária
- Documentar contratos
- Validar falhas transitórias

**Passos operacionais:**
1. Publique uma mensagem de teste e confirme o consumo.

**Evidência:** [`fase-4.json`](evidencias/fase-4.json)

**Exemplo:** Entrada: `event-test-001`

**Critério de conclusão:** 1 mensagem publicada resulta em 1 processamento confirmado.

## Fase 5 — Observabilidade

**Objetivo:** Produzir sinais suficientes para diagnóstico local.

**Tarefas principais:**
- Definir logs estruturados
- Adicionar métricas essenciais
- Propagar identificadores de correlação
- Configurar traces locais
- Criar painel mínimo
- Definir alertas iniciais
- Registrar procedimentos de diagnóstico
- Validar ausência de dados sensíveis

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
