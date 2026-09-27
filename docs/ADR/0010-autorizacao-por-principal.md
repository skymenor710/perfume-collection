# ADR 0010 — Autorização por Principal (preparo para contas)

- **Status:** aceito
- **Data:** 2026-09-27

## Contexto

Hoje "autorizado" é um booleano (este PC ou aparelho pareado) e o usuário é implícito (`store.me()`).

## Decisão

- `Authorizer(req) → Principal { userId, via } | null`. A v1 recusa com 401 sem Principal e usa `principal.userId` em
  toda rota com dono (jobs de outro dono = 404).
- Implementação atual: loopback ou aparelho pareado → o único usuário.
- **Autenticação não foi implementada.** Better Auth (FASE 6) troca só o Authorizer.

## Consequências

- Testes de 401 e de isolamento por dono já existem.

## Alternativas consideradas

Esperar as contas para introduzir o conceito (espalharia `store.me()` pelas rotas novas).
