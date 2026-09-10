# Milestone 15: workflow focado `/fix`

Use `/fix` para uma alteração pequena e localizada:

```text
/fix corrija o null check em @src/service.ts
```

O fluxo cria branch e worktree isolados, captura e exige baseline saudável, executa o implementador, valida o escopo antes do commit, cria checkpoint, roda todos os gates obrigatórios e inicia um reviewer novo e somente leitura. Se houver achados, permite exatamente um reparo, repete gates e revisão e falha fechado se o problema persistir.

Ele preserva política de comandos argv, caminhos permitidos/proibidos, redação, residência de um modelo, descarregamento final, branch padrão protegida e ausência de merge automático.

O `/fix` não executa critérios de aceite amplos, testes-oráculo prévios, planejamento extenso, dupla revisão, verificação avançada ou auditoria final. Para mudanças arquiteturais, funcionalidades ou refatorações maiores, use `/run`. Para somente verificar código, use `/ask`.

| Comando | Escrita | Validação |
|---|---:|---|
| `/ask` | não | uma resposta somente leitura |
| `/fix` | sim | baseline, gates, revisão e um reparo |
| `/run` | sim | workflow completo auditável |
