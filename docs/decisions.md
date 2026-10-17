# Decisões

Registo das decisões tomadas, por ordem. Para as decisões em aberto do `SPEC.md` §11, indica-se se foram confirmadas ou se ficou a proposta por omissão.

## Decisões em aberto (SPEC §11) — 2026-10-17

| #   | Decisão                            | Valor                                                        | Estado                                                                                                                      |
| --- | ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| D1  | Alojamento                         | Cloudflare (Workers + D1 + R2)                               | Confirmada. Lógica isolada em `services/` e na porta `Db` (`src/server/repos/db.ts`), para poder trocar para Node + SQLite. |
| D2  | Nome/domínio/identidade            | Placeholder `APP_NAME = 'Mobilização'` (`src/config/app.ts`) | **Por decidir**                                                                                                             |
| D3  | `MODERATION_MODE`                  | `post` (publica logo, com selo "não confirmado")             | Confirmada                                                                                                                  |
| D4  | Provider de email                  | Resend (atrás da interface `Mailer`)                         | Confirmada; implementação na Fase 5                                                                                         |
| D5  | `KEY_DATES`                        | Nenhuma                                                      | Confirmada                                                                                                                  |
| D6  | Concelho vs código postal          | Concelho (select com os 308)                                 | Confirmada                                                                                                                  |
| D7  | Camadas de dados abertos           | Fora da v1                                                   | Confirmada                                                                                                                  |
| D8  | Responsável pelo tratamento (RGPD) | Placeholder `DATA_CONTROLLER` em `src/config/app.ts`         | **Por decidir** antes da Fase 7                                                                                             |

## Datas e filtros

1. **Filtros por dia comparam a data local da ocorrência.** "Hoje", "Amanhã", "Fim de semana" e "Escolher dia" comparam o `local_date` (no `tz` do evento) com os dias civis de `Europe/Lisbon`.
   - Exemplo: um evento nos Açores às 23:30 de sábado aparece no sábado, como diz o cartaz, apesar de serem 00:30 de domingo em Lisboa.
   - "Próximos" e "7 dias" comparam instantes UTC.
   - Em todos os filtros, uma ocorrência só conta se `ends_at > agora`.
   - _Confirmada pelo utilizador._
2. **"7 dias"** vai de agora até agora + 7 dias civis em Lisboa. Não são 168 h: numa semana com mudança de hora termina à mesma hora de relógio.
3. **"Fim de semana":**
   - de segunda a sábado, é o sábado e o domingo seguintes (ou correntes);
   - ao domingo, é só o resto desse domingo (não salta para o fim de semana seguinte).
4. **Intervalos semiabertos** `[starts_at, ends_at)`:
   - "Todo o dia" vai das 00:00 locais às 00:00 locais do dia seguinte.
   - Sem `end_time`, termina no fim do dia local.
5. **Ocorrência que passa a meia-noite:** se `end_time ≤ start_time`, termina no dia seguinte. Conta para os dois dias nos filtros por dia, exceto se terminar exatamente às 00:00. `end_time` igual a `start_time` é rejeitado pelo schema.
6. **Horas inexistentes ou repetidas na mudança de hora:** usa-se a desambiguação `compatible` do Temporal.
   - Em março, uma hora no "buraco" (01:30 em Lisboa) avança uma hora.
   - Em outubro, uma hora repetida (01:30) fica com a primeira ocorrência (horário de verão).
   - Nos Açores, no domingo de março a meia-noite não existe e o dia começa às 01:00.
7. **Biblioteca:** `temporal-polyfill` (~20 KB gzip). Escolhida por implementar a API Temporal standard com desambiguação explícita. As abreviaturas dos dias da semana estão em `src/i18n/pt.ts`, porque o ICU devolve "sábado" para `weekday: 'short'` em pt-PT.

## Geodados

8. **Fonte:** CAOP 2025 (DGT), em GeoPackage. Os ficheiros gerados (`data/geo/municipalities.geo.json`, `municipalities.json`) entram no git; os downloads brutos e os `.pmtiles` não. _Confirmada pelo utilizador._
9. **Sem GDAL:** o `mapshaper` lê o GeoPackage diretamente. A simplificação é feita no CRS projetado de origem, com tolerância de 100 m: 1,2 MB em bruto, ~340 KB gzip, dentro do bundle do Worker.
10. **Distrito nas ilhas:** "Região Autónoma da Madeira" ou "Região Autónoma dos Açores". O nome da ilha vai num campo à parte (`island`). O `tz` vem da região.
11. **Pontos fora dos polígonos** (costa, simplificação) são atribuídos ao concelho mais próximo até 1 km (`GEO_SNAP_METERS`). Para lá disso, a resposta é `404 {"error":"outside_portugal"}`.
12. **PMTiles:** o extrato de Portugal (z0–15, continente + Madeira + Selvagens + Açores) tem ~711 MB. Não entra no repo; o processo está documentado em `data/geo/README.md`.

## Arquitetura

13. **Um só Worker** com Workers Static Assets: o Astro gera `dist/`, o Hono atende `/api/*` (`run_worker_first`). Não se usa o adapter SSR do Astro.
14. **Testes de API:** usam `@cloudflare/vitest-plugin`, sucessor do `@cloudflare/vitest-pool-workers`, que foi descontinuado. Correm com Miniflare e as migrations aplicadas.
15. **Privacidade da API pública:** `src/server/public-routes.ts` lista todos os endpoints públicos com pedidos de exemplo. O teste `tests/worker/public-privacy.test.ts`:
    - falha se uma rota registada no Hono não estiver na lista;
    - procura chaves proibidas (email, telefone, nome de responsável, hashes de tokens, IP) e valores com aspeto de email ou telefone;
    - verifica que não há `Set-Cookie`.
16. **Migration:** segue o SPEC §3, com estes acréscimos:
    - `CHECK` nos enums (`tz`, `status`, `kind`);
    - `REFERENCES … ON DELETE CASCADE` em `event_reports.event_id`;
    - índices em `event_occurrences.event_id`, `events.status` e `signatures(status, created_at)`.
