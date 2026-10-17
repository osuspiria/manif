# CLAUDE.md

Plataforma web portuguesa de mobilização com duas funcionalidades na v1:
1. **Mapa de eventos** com submissão pública de novos eventos (cada evento pode ter várias datas).
2. **Assinatura de apoio** a um apelo, individual ou em nome de uma associação/organização.

A especificação completa está em `SPEC.md`. **Lê-a antes de qualquer tarefa não trivial.** Se algo neste ficheiro contradisser o SPEC, o SPEC ganha — e avisa.

## Stack

- **Frontend:** Astro (estático) + TypeScript; ilhas em Preact só onde há interatividade.
- **Mapa:** MapLibre GL JS + PMTiles (extrato Protomaps de Portugal, servido por nós a partir de R2).
- **API:** Cloudflare Workers com Hono.
- **BD:** Cloudflare D1 (SQLite), migrations SQL em `migrations/`.
- **Validação:** Zod, schemas partilhados em `src/shared/schemas.ts` (cliente e servidor usam os mesmos).
- **Anti-spam:** Cloudflare Turnstile + honeypot + rate limit.
- **Email:** interface `Mailer` em `src/server/mailer/`; implementação real + `FakeMailer` para dev/testes.
- **Testes:** Vitest (unit + API com Miniflare) e Playwright (e2e, sempre também em viewport 360×740).

## Comandos

```bash
npm run setup        # cria .dev.vars a partir de .dev.vars.example (chaves de teste do Turnstile)
npm run dev          # Astro + Worker + D1 local
npm run test         # Vitest
npm run test:e2e     # Playwright
npm run lint         # ESLint + Prettier check
npm run typecheck    # tsc --noEmit + astro check
npm run db:migrate   # aplica migrations ao D1 local
npm run db:seed      # ~50 eventos de exemplo com várias datas, continente + ilhas
npm run geo:build    # regenera data/geo/municipalities.* a partir da CAOP
npm run tiles:dev    # carrega data/geo/dev.pmtiles no R2 local (ver data/geo/README.md)
npm run map:assets   # (re)descarrega glyphs/sprites do Protomaps para public/map/
npm run ci           # lint + typecheck + test
```
Se algum destes comandos ainda não existir, cria-o quando criares a peça correspondente.

## Estrutura

```
src/
  pages/            # rotas Astro: /, /mapa, /mapa/e/[id], /apoio, /privacidade, /admin
  components/       # UI (Preact/Astro)
  map/              # setup MapLibre, camadas, clustering, popup
  shared/
    schemas.ts      # Zod
    dates.ts        # TODA a lógica de datas/intervalos/fusos (ver abaixo)
    event-filter.ts # filtro puro: (eventos, filtro, agora) -> eventos visíveis
  config/
    event-types.ts  # tipos de evento, rótulos, cores, ícones
    app.ts          # MODERATION_MODE, KEY_DATES, limites, retenção
  i18n/
    pt.ts           # todos os textos de UI (PT-PT)
  server/           # Worker Hono: routes/, repos/, services/, mailer/
content/            # apelo.md, privacidade.md, primeiros-subscritores.md
data/geo/           # CAOP simplificada, municípios, scripts de geração (ver data/geo/README.md)
migrations/
tests/
```

## Regras do projeto

### Idioma
- Toda a interface em **português de Portugal** (não brasileiro): "telemóvel", "ecrã", "registo", "concelho", "apelido", tu/você conforme o tom definido em `content/`. Sem gerundismos brasileiros.
- Código, nomes de variáveis, commits e comentários técnicos em inglês.
- Textos de UI centralizados em `src/i18n/pt.ts` — nada de strings soltas nos componentes.

### Datas e fusos (crítico)
- Toda a lógica de datas vive em `src/shared/dates.ts` e `src/shared/event-filter.ts`, como **funções puras** que recebem `now` como argumento. Nunca chamar `new Date()` dentro da lógica de filtro.
- Portugal tem **dois fusos horários** e três identificadores IANA: `Europe/Lisbon` (continente), `Atlantic/Madeira` (mesma hora que Lisboa) e `Atlantic/Azores` (uma hora a menos). O `tz` de um evento é derivado do ponto, nunca escolhido pelo utilizador.
- Ocorrências guardam `local_date` + `start_time`/`end_time` locais **e** `starts_at`/`ends_at` em UTC calculados no servidor.
- Os filtros "Hoje/Amanhã/Fim de semana" são calculados em `Europe/Lisbon`.
- Testes obrigatórios para: mudança de hora (último domingo de março e de outubro), evento nos Açores perto da meia-noite, evento "todo o dia", ocorrência cancelada, evento com uma ocorrência passada e outra futura.
- Usar `Intl` / `Temporal` polyfill ou `date-fns-tz`; não escrever aritmética de fusos à mão.

### Privacidade
- **Zero cookies no site público.** O único cookie permitido é a sessão do `/admin`.
- Nenhum pedido do browser a domínios de terceiros em runtime, exceto Turnstile. Tiles, fontes, ícones e scripts são servidos por nós.
- Emails, telefones e nomes de responsáveis de organizações **nunca** saem da API pública. Há um teste que garante isto para cada endpoint público.
- IPs só como hash com sal diário, em memória/KV para rate limit; nunca em D1 nem em logs.
- Não adicionar analytics, pixels ou SDKs externos.

### Mobile-first e acessibilidade
- Desenhar primeiro para 360 px de largura. Alvos de toque ≥ 44 px.
- Inputs de data/hora: usar os nativos (`type="date"`, `type="time"`).
- O mapa tem sempre a **vista Lista** como alternativa equivalente.
- Cores dos tipos de evento nunca são a única distinção (ícone/forma também).
- Formulários: labels visíveis, erros associados com `aria-describedby`, foco no primeiro erro.

### Código
- TypeScript `strict`. Sem `any` sem comentário a justificar.
- Lógica de negócio fora dos handlers: `routes/` → `services/` → `repos/`. Os services não conhecem Hono nem D1 diretamente (facilita trocar para Node + SQLite).
- IDs com ULID. Tokens (edição, confirmação) com 32 bytes aleatórios; guardar só o hash SHA-256.
- Todo o input validado com o schema Zod partilhado, no servidor, mesmo que já validado no cliente.
- Dependências novas: só se pouparem trabalho real; justificar no commit.

## Como trabalhar neste repo

- Trabalha **por fases** (ver `SPEC.md` §10). No fim de cada fase: testes a passar, `lint` e `typecheck` limpos, e um resumo curto do que ficou feito e do que falta.
- Antes de decidir algo listado em `SPEC.md` §11 (Decisões em aberto), **pergunta**. Se tiveres de avançar, usa a proposta por omissão e regista-a em `docs/decisions.md`.
- Quando mexeres em datas ou filtros, escreve primeiro os testes.
- Verifica visualmente as alterações de UI em viewport de telemóvel (Playwright screenshot) antes de dar uma tarefa por concluída.
- Não inventes dados reais (eventos, organizações, signatários). O seed usa nomes claramente fictícios.

## Definição de "feito"

- [ ] Testes unitários e e2e relevantes escritos e a passar
- [ ] `npm run lint` e `npm run typecheck` limpos
- [ ] Funciona em 360 px e em desktop
- [ ] Sem novos pedidos a terceiros nem cookies
- [ ] Textos em PT-PT no ficheiro de i18n
- [ ] `SPEC.md` atualizado se o comportamento mudou