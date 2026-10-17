# Especificação — Plataforma de mobilização (Portugal) · v1

> **Lançamento faseado:** o primeiro lançamento inclui só o mapa (1), sem o email de contacto opcional no "Adicionar evento". A assinatura (2), a página `/privacidade` e esse email estão implementados mas desligados (`FEATURES` em `src/config/app.ts`; ver `docs/decisions.md` #63–64).
>
> Âmbito da v1: **(1) mapa de eventos com submissão de novos eventos** e **(2) assinatura de apoio individual / associativo**. Tudo o resto (notícias, visuais, calendário editorial, galeria, Telegram) fica fora.
> Referência analisada: 17octobregiletjaune.net (páginas `/`, `/carte/`, `/appel/`), outubro 2026.

---

## 0. O que o site de referência faz (resumo da análise)

**Mapa (`/carte/`)**
- Fundo OpenStreetMap com rendering Protomaps, **alojado no próprio site** (sem servidores de mapas de terceiros, sem cookies).
- Contadores no topo: total de mobilizações e contagem por tipo (manifestações, rotundas, postos de combustível, refinarias, depósitos, estações, portos, pontes, portagens, assembleias).
- Caixa "Encontrar uma mobilização" (pesquisa por local).
- Botão "+ Adicionar um local" → formulário com **mapa + tipo**; **não pede nome nem morada** de quem submete. Os municípios são encontrados com o geocoder público do IGN.
- Camadas pré-carregadas a partir de dados abertos (postos de combustível, refinarias/depósitos Seveso, câmaras municipais), misturadas com locais submetidos por visitantes.
- Retenção explícita: ações apagadas após uma data fixa (31/12).
- Não tem filtro de datas — está desenhado para **um único dia**. É precisamente isto que a versão portuguesa tem de resolver.

**Assinatura (`/appel/#signer`)**
- Dois separadores: **"Assino"** (individual) e **"Assino por uma organização"**.
- Campos individuais: Nome próprio, Apelido, *ou* Pseudónimo (basta um dos dois), Email, Código postal, Telefone (opcional), Atividade/função/organização (opcional), um campo "Site web" (quase de certeza um *honeypot* anti-spam).
- Duas caixas: aceito que a assinatura seja pública · aceito ser recontactado.
- Lista de "Primeiros signatários" (pessoas, com uma linha de descrição) e "Organizações signatárias".
- RGPD: guarda nome/pseudónimo, cidade e email; email nunca publicado; só usado para recontactar quem aceitou; sem cookies; alojamento Cloudflare.

---

## 1. Princípios

1. **Mobile-first.** A maioria das visitas chega por partilha em redes sociais, no telemóvel, com rede fraca.
2. **Privacidade por defeito.** Sem cookies, sem analytics de terceiros, sem tiles/fontes/scripts de CDNs externos em runtime. Mínimo de dados pessoais.
3. **Rápido e robusto a picos.** Páginas estáticas + API pequena na edge. Dados do mapa servidos como um único GeoJSON em cache.
4. **Simples de moderar.** Uma pessoa com um telemóvel deve conseguir moderar.
5. **PT-PT** em toda a interface. Código e identificadores em inglês.

---

## 2. Stack proposta

| Camada | Escolha | Porquê |
|---|---|---|
| Frontend | **Astro** (páginas estáticas) + ilhas em TypeScript vanilla ou Preact | Pouco JS, ótimo em telemóvel |
| Mapa | **MapLibre GL JS** + **PMTiles** (extrato Protomaps de Portugal) | Igual ao de referência; tiles alojados por nós |
| Clustering | Clustering nativo do MapLibre (GeoJSON source `cluster: true`) | Sem dependências |
| API | **Cloudflare Workers** (Hono) | Edge, barato, aguenta picos |
| BD | **Cloudflare D1** (SQLite) | Suficiente para milhares de eventos/assinaturas |
| Ficheiros | **Cloudflare R2** para o `.pmtiles` | Range requests |
| Anti-spam | **Cloudflare Turnstile** + honeypot + rate limit | Sem cookies de tracking, sem puzzles |
| Email | Provider transacional atrás de uma interface `Mailer` (ex.: Resend, Brevo) | Confirmação de assinatura |
| Geodados PT | CAOP (DGT) simplificada → GeoJSON de concelhos/distritos; lista de 308 municípios (INE) | Saber o concelho de cada ponto, sem serviços externos |
| Pesquisa de local | Photon/Nominatim **via proxy no Worker**, com cache | O browser não fala com terceiros |
| Testes | Vitest (unit/API) + Playwright (e2e, viewport telemóvel) | |

> Alternativa equivalente: Node + SQLite num VPS próprio (ex.: Hetzner) atrás de Caddy. A lógica deve ficar isolada da plataforma (repositórios/serviços puros) para que a troca seja barata. **Decisão em aberto D1.**

---

## 3. Modelo de dados

### 3.1 Eventos (com várias datas)

Um **evento** é um local + o que lá acontece. Um evento tem **1 a N ocorrências** (datas). Nunca guardamos regras de recorrência — só ocorrências explícitas. A UI pode gerar ocorrências ("repetir semanalmente até…"), mas o que se grava é a lista concreta. Isto mantém filtros, cache e moderação triviais.

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,          -- ULID
  type          TEXT NOT NULL,             -- ver §3.3
  title         TEXT NOT NULL,             -- 3–90 chars
  description   TEXT,                      -- ≤ 600 chars, texto simples
  organizer     TEXT,                      -- nome público opcional (coletivo, associação)
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  place_label   TEXT,                      -- "Praça da Liberdade" (opcional, livre)
  municipality  TEXT NOT NULL,             -- derivado (CAOP), não escrito pelo utilizador
  district      TEXT NOT NULL,             -- derivado (distrito ou Região Autónoma)
  tz            TEXT NOT NULL,             -- 'Europe/Lisbon' | 'Atlantic/Madeira' | 'Atlantic/Azores' (derivado)
  status        TEXT NOT NULL,             -- 'pending' | 'published' | 'hidden'
  verified      INTEGER NOT NULL DEFAULT 0,-- confirmado por moderação
  contact_email TEXT,                      -- opcional, nunca público, só para moderação
  edit_token_hash TEXT NOT NULL,           -- link secreto para quem criou editar/cancelar
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE event_occurrences (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,   -- 'YYYY-MM-DD' na tz do evento
  start_time  TEXT,            -- 'HH:MM' (opcional: "todo o dia")
  end_time    TEXT,            -- 'HH:MM' opcional
  starts_at   TEXT NOT NULL,   -- UTC ISO, calculado (para ordenar/filtrar)
  ends_at     TEXT NOT NULL,   -- UTC ISO, calculado (fim do dia se sem end_time)
  note        TEXT,            -- ≤ 120 chars ("concentração às 14h, desfile às 15h")
  cancelled   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_occ_starts ON event_occurrences(starts_at);

CREATE TABLE event_reports (          -- botão "Reportar"
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, reason TEXT NOT NULL,
  detail TEXT, created_at TEXT NOT NULL
);
```

Regras:
- 1 ≤ ocorrências ≤ 30 por evento; todas no futuro no momento da submissão; no máximo 12 meses à frente.
- `tz` vem do ponto (Açores ≠ continente: UTC−1). Mostrar "(hora dos Açores)" quando `tz = Atlantic/Azores`.
- Um evento é **visível** se `status = published` e tiver pelo menos uma ocorrência não cancelada com `ends_at ≥ agora`.
- Retenção: eventos sem ocorrências futuras há mais de 30 dias são apagados (job diário). Valor configurável.

### 3.2 Assinaturas

```sql
CREATE TABLE signatures (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,          -- 'individual' | 'organization'
  -- individual
  first_name    TEXT, last_name TEXT, pseudonym TEXT,
  activity      TEXT,                   -- opcional ("professora, Braga")
  -- organization
  org_name      TEXT, org_type TEXT,    -- ver §5.2
  contact_name  TEXT,                   -- pessoa responsável, nunca pública
  website       TEXT,
  -- comum
  email         TEXT NOT NULL,          -- normalizado (lowercase, trim)
  municipality  TEXT NOT NULL,          -- um dos 308 concelhos
  phone         TEXT,                   -- opcional
  is_public     INTEGER NOT NULL,       -- consentimento para publicar
  can_contact   INTEGER NOT NULL,       -- consentimento para recontacto
  status        TEXT NOT NULL,          -- 'unconfirmed' | 'confirmed' | 'approved' | 'rejected'
  confirm_token_hash TEXT,
  consent_text_version TEXT NOT NULL,   -- versão do texto de consentimento aceite
  created_at    TEXT NOT NULL,
  confirmed_at  TEXT,
  UNIQUE(kind, email)
);
```

- Individuais: contam e (se `is_public`) aparecem após `confirmed`.
- Organizações: contam após `confirmed`, mas **só aparecem na lista pública após `approved`** por moderação (evita "Sindicato X" falsos).
- Não confirmadas apagadas ao fim de 7 dias.

### 3.3 Tipos de evento (configuráveis num único ficheiro `src/config/event-types.ts`)

| key | Rótulo | Pictograma |
|---|---|---|
| `demonstration` | Manifestação | megafone |
| `rally` | Concentração | cartaz erguido |
| `action` | Ação num local (posto, empresa, serviço público…) | bandeira |
| `assembly` | Assembleia Popular | pessoas |
| `camp` | Acampada | tenda |
| `other` | Outro | reticências |

Todos os tipos usam o mesmo pin quadrado preto; o tipo distingue-se pelo pictograma branco (não há código de cores). Pin selecionado: maior e laranja. Data-chave: barra laranja no topo do pin.

---

## 4. Funcionalidade 1 — Mapa

### 4.1 Página principal `/` (mapa)

O mapa é a página de entrada. `/mapa` redireciona (301) para `/`, mantendo os filtros do URL; as fichas continuam em `/mapa/e/<id>`.

Layout telemóvel (de cima para baixo):
0. Introdução: "Mobilização" + uma frase sobre a plataforma (`pt.map.description`) + uma nota a dizer que o site é independente e não tem ligação ao Presidente da Câmara Municipal do Porto nem à Câmara (`pt.map.domainNote`). Esconde-se (só visualmente; o `h1` fica para leitores de ecrã) enquanto o painel de filtros ou a ficha de um evento estão abertos. Abrir os filtros fecha a ficha; escolher um evento fecha os filtros. No desktop fica sempre visível no topo do painel lateral.
1. Barra fixa: **resumo do filtro ativo** ("23 eventos · Este fim de semana") — tocar abre o painel de filtros.
2. Mapa em ecrã inteiro.
3. Botões flutuantes: 📍 *Perto de mim* (geolocalização no browser; nada é enviado ao servidor), 🔍 *Procurar local*, ➕ *Adicionar evento*.
4. Atalhos de enquadramento: **Continente · Madeira · Açores** (os arquipélagos ficam fora do ecrã por defeito).
5. Alternância **Mapa / Lista** (a lista é essencial em telemóvel e para acessibilidade).

Desktop: painel lateral à esquerda com filtros + lista; mapa à direita.

Contadores (como no site de referência): total visível + por tipo, recalculados conforme o filtro.

### 4.2 Filtros de datas — o problema e a solução

**Problema:** eventos podem ter várias datas, mas um filtro com "data de início / data de fim" é péssimo em telemóvel.

**Solução: um único controlo de "Quando", com atalhos, e um seletor de dia que só mostra dias com eventos.**

Chips de escolha única, em scroll horizontal:

```
[ Próximos ✓ ] [ Hoje ] [ Amanhã ] [ Fim de semana ] [ 7 dias ] [ 📅 Escolher dia ]
```

- **Próximos** (por defeito): tudo de agora em diante.
- **Hoje / Amanhã**: dia civil em Europe/Lisbon.
- **Fim de semana**: sábado+domingo seguintes (se hoje for sábado/domingo, o fim de semana corrente).
- **7 dias**: agora → +7 dias.
- **Escolher dia**: abre uma **faixa de dias** (não um calendário), os próximos 60 dias em scroll horizontal; cada dia mostra o nº de eventos; dias sem eventos aparecem esbatidos e não são clicáveis. Um toque = um dia.

```
 sáb 24 │ dom 25 │ seg 26 │ ter 27 │ qua 28 …
   12   │   3    │   ·    │   1    │   ·
```

- **Datas-chave** (opcional, config `KEY_DATES`): se a campanha tiver um "dia D", aparece como primeiro chip destacado ("🟡 25 nov"). Resolve 90% dos casos com um toque.
- O filtro de **Tipo** é um segundo grupo de chips multi-seleção, por baixo. Não há mais filtros na v1.
- **Botão "Limpar"** sempre visível quando há filtro diferente do defeito.
- Estado do filtro no URL (`/?quando=fds&tipo=rally,action` ou `?dia=2026-11-25`) para links partilháveis.

**Semântica:** um evento aparece se **pelo menos uma ocorrência** intersectar o intervalo. No popup/lista:
- Mostra-se a **próxima ocorrência dentro do intervalo** em destaque.
- Por baixo, "+ 4 outras datas" expansível, com as ocorrências fora do intervalo esbatidas.
- Na lista, ordenação pela próxima ocorrência no intervalo; agrupamento por dia ("Sábado, 24 nov").
- Marcador: ícone do tipo; se o filtro abrange vários dias, uma pequena etiqueta com o dia ("24/11") a partir de certo zoom.

**Implementação:** o servidor devolve **todos os eventos visíveis** num único GeoJSON (com as ocorrências futuras dentro de cada feature), em cache na edge 60 s. Todos os filtros correm no browser → instantâneos e sem pedidos extra. Revisitar só se passar de ~5 000 eventos.

### 4.3 Popup / ficha do evento

Título · tipo · local e concelho · data(s) e hora(s) · descrição · organizador (se indicado) · selo **"Confirmado"** se `verified` · botões: *Como chegar* (direções no OpenStreetMap), *Abrir na app de mapas* (Apple Maps no iOS, link `geo:` no Android, escondido no computador), *Ver no OpenStreetMap*, *Partilhar* (Web Share API, fallback copiar link), *Reportar*.
Cada evento tem URL próprio `/mapa/e/<id>` que abre o mapa centrado e a ficha aberta (com meta tags Open Graph para partilha).

### 4.4 Adicionar evento (`➕`)

Fluxo em passos curtos (bottom sheet em telemóvel):

1. **Onde** — o mapa entra em modo "escolher ponto": pin fixo ao centro, a pessoa arrasta o mapa por baixo. Alternativas: "Usar a minha localização" ou pesquisar morada/local. Mostra o concelho detetado ("Porto · Porto"). Opcional: nome do local.
2. **O quê** — tipo (chips), título, descrição (opcional), organizador (opcional).
3. **Quando** — lista de datas:
   - Primeira linha: data + hora de início (opcional "todo o dia") + nota (opcional). Ao criar não se pede hora de fim (o evento conta até ao fim do dia); a página de edição mantém a hora de fim (opcional) dos eventos existentes.
   - **"+ Adicionar outra data"** (copia a hora da linha anterior).
   - Atalho **"Repetir semanalmente até…"** → gera as linhas, que ficam editáveis/removíveis individualmente.
   - Inputs nativos `type="date"` e `type="time"` (são os melhores em telemóvel).
4. **Contacto (opcional)** — email só para a moderação, nunca publicado. Texto: "Se quiseres que te avisemos ou te possamos perguntar algo."
5. **Enviar** — Turnstile invisível + honeypot. Ecrã final com:
   - estado ("Publicado" ou "A aguardar moderação", conforme `MODERATION_MODE`);
   - **link secreto de edição** (para guardar; também enviado por email se foi indicado) que permite editar datas, cancelar uma ocorrência ou o evento inteiro.
     Formato: `/editar/#e=<id>&t=<token>`. O token fica no fragmento do URL (nunca é enviado ao servidor em pedidos de página, nem aparece em logs ou no Referer) e segue só no header `X-Edit-Token`.

Não se pede nome nem morada de quem submete.

### 4.5 Moderação

- `MODERATION_MODE = "pre" | "post"` (config).
  - `pre`: novos eventos ficam `pending` até aprovação.
  - `post`: publicados logo, com aspeto "não confirmado", e entram na fila para verificação.
- Auto-ocultar quando um evento recebe ≥ N reports (config, ex.: 3) até revisão.
- Página `/admin` (ver §6).

---

## 5. Funcionalidade 2 — Assinatura de apoio

### 5.1 Página `/apoio` (ou a homepage)

- Texto do apelo/manifesto em Markdown (`content/apelo.md`), editável sem tocar no código.
- Contador grande: "**4 321** apoios · **87** organizações" (só confirmados).
- Formulário com dois separadores: **Individual** | **Associação / organização**.
- Lista pública: organizações aprovadas (todas) e indivíduos públicos (paginada, mais recentes primeiro, com pesquisa por concelho). Opcional: secção "Primeiros subscritores" gerida à mão em `content/primeiros-subscritores.md`.

### 5.2 Campos

**Individual**
| Campo | Obrigatório | Notas |
|---|---|---|
| Nome próprio | ✱ | ✱ Nome próprio + apelido **ou** pseudónimo: basta um |
| Apelido | ✱ | |
| Pseudónimo | ✱ | |
| Email | sim | Para confirmar; nunca publicado |
| Concelho | sim | Select com pesquisa (308 municípios). Substitui o código postal do site francês: mais simples e dá uma localização pública útil |
| Telefone | não | Nunca publicado |
| Atividade / profissão / organização | não | ≤ 80 chars, aparece na lista se pública |
| ☐ Aceito que o meu nome/pseudónimo, concelho e atividade sejam publicados | não | |
| ☐ Aceito ser recontactado/a pela organização desta campanha | não | |
| ☐ Consentimento explícito para o tratamento destes dados (ver §7) | sim | |
| Honeypot "Website" | — | Escondido |

**Associação / organização**
| Campo | Obrigatório |
|---|---|
| Nome da organização | sim |
| Tipo: associação · sindicato · coletivo · comissão de moradores/trabalhadores · ONG · outro | sim |
| Concelho (sede) | sim |
| Site ou rede social | não |
| Nome da pessoa responsável (não público) | sim |
| Email de contacto (não público) | sim |
| Telefone (não público) | não |
| ☐ Declaro ter legitimidade para assinar em nome desta organização | sim |
| ☐ Publicar o nome da organização | sim (por omissão marcado — é o propósito) |
| ☐ Recontacto | não |

### 5.3 Fluxo

1. Submeter → validação + Turnstile → grava `unconfirmed` → email com link de confirmação (válido 7 dias) e link para retirar.
2. Clique no link → `confirmed` → ecrã de agradecimento com botões de partilha.
3. Organizações → aparecem na fila do `/admin` para `approved`/`rejected`.
4. Email repetido: não cria duplicado; reenvia o link de confirmação (sem revelar se o email já existia — mensagem neutra).
5. Cada email de confirmação inclui link para **retirar a assinatura** (apaga o registo): `/apoio/retirar/#t=<token>`, com o token no fragmento. O mesmo token serve para confirmar e para retirar.
6. Sem JavaScript, o formulário é um POST normal: o servidor redireciona para `/apoio/confirma-email/` ou devolve uma página HTML com os erros. O Turnstile precisa de JavaScript (ver `docs/decisions.md` #38).

O concelho é guardado pelo código DICO da CAOP (há nomes repetidos, como "Lagoa"). O contador mostra assinaturas individuais confirmadas e organizações confirmadas (incluindo as que aguardam moderação).

---

## 6. Admin mínimo (`/admin`)

Necessário para as duas funcionalidades, mantido mínimo:
- Login por **magic link** para emails numa allowlist (`ADMIN_EMAILS`): `/admin/entrar/#t=<token>`, 15 minutos, uso único. Sessão com cookie estritamente necessário: `admin_session`, `Path=/api/admin`, `HttpOnly`, `Secure`, `SameSite=Strict`, 24 horas (ver `docs/decisions.md` #48–50).
- Separador **Eventos**: pendentes, reportados, ocultos, todos; aprovar (descarta as denúncias), ocultar, marcar "confirmado", editar (sem perder o "confirmado").
- Separador **Assinaturas**: organizações por aprovar; pesquisa; apagar a pedido.
- **Exportar CSV** só de quem aceitou recontacto.
- Funciona bem em telemóvel.

---

## 7. Privacidade e RGPD (Portugal)

> Isto não é aconselhamento jurídico — convém validar com alguém da área antes de lançar.

- **Assinar um apelo político revela opinião política** → dado de categoria especial (art. 9.º RGPD). Base legal: **consentimento explícito** (art. 9.º, n.º 2, al. a)) — caixa própria, não pré-marcada, com texto versionado (`consent_text_version`).
- Identificar o **responsável pelo tratamento** (pessoa/associação) e um contacto na página de privacidade.
- Idade de consentimento digital em Portugal: **13 anos** (Lei 58/2019). Incluir declaração "Tenho 13 anos ou mais" ou equivalente.
- Minimização: o mapa não pede dados pessoais; email de contacto opcional e nunca público.
- Retenção: assinaturas não confirmadas 7 dias; eventos 30 dias após a última ocorrência; assinaturas até X meses após o fim da campanha (`CAMPAIGN_END` + `RETENTION.signatureMonthsAfterCampaign` em `src/config/app.ts`) ou até a pessoa retirar. Um Cron Trigger diário aplica estas regras.
- Direitos: retirar assinatura por link; pedidos de acesso/apagamento por email.
- **Sem cookies** no site público; nada de analytics de terceiros. Se forem precisas métricas: contadores agregados no servidor, sem IP.
- IPs: usados só para rate limit, guardados como hash com sal diário, nunca persistidos em BD.
- Página `/privacidade` gerada a partir de `content/privacidade.md`; responsável e contacto vêm de `DATA_CONTROLLER` (`src/config/app.ts`). Ligada a partir do rodapé de todas as páginas e do fim da vista Lista.
- Content-Security-Policy em todas as páginas: só pedidos ao próprio site e ao Turnstile (`challenges.cloudflare.com`).

---

## 8. API (Workers)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/events.geojson` | Todos os eventos visíveis + ocorrências futuras. Cache 60 s na edge (nunca no browser), apagada após cada escrita |
| GET | `/api/events/:id` | Ficha de um evento |
| POST | `/api/events` | Criar evento (Turnstile) → `{id, editUrl, status}` |
| GET | `/api/events/:id/edit` | Dados para edição, com o estado de moderação (header `X-Edit-Token`) |
| PATCH | `/api/events/:id` | Editar (header `X-Edit-Token`): corpo `{…campos, occurrences}` ou `{cancelEvent: true}` |
| POST | `/api/events/:id/report` | Reportar |
| GET | `/api/geo/search?q=` | Proxy de pesquisa de locais (só PT, cache) |
| GET | `/api/geo/reverse?lat&lng` | Concelho/distrito/tz via CAOP local |
| POST | `/api/signatures` | Assinar (Turnstile): JSON → `202 {status:"check_email"}`; formulário HTML → `303` ou página de erro |
| GET | `/api/signatures/confirm?token=` | Confirmar → `303` para `/apoio/obrigado/` ou `/apoio/link-invalido/` |
| POST | `/api/signatures/withdraw` | Retirar: corpo `{token}`; apaga o registo |
| GET | `/api/signatures/stats` | Contadores (cache 30 s) |
| GET | `/api/signatures/public?page&municipality` | Lista pública (cache 30 s): organizações aprovadas (só na página 1) e indivíduos públicos, 50 por página; `municipality` = código DICO |
| POST | `/api/admin/login` | Pedir magic link `{email}` (resposta sempre igual) |
| POST | `/api/admin/session` | Trocar o token do link por sessão `{token}` (define o cookie) |
| POST | `/api/admin/logout` | Terminar sessão |
| GET | `/api/admin/me` | Email da sessão |
| GET | `/api/admin/events?filter&q` | Fila de eventos: `pending`, `reported`, `hidden`, `all` |
| GET/PATCH | `/api/admin/events/:id` | Detalhe (com email de contacto e denúncias) / editar |
| POST | `/api/admin/events/:id/moderate` | `{action: publish \| hide \| verify \| unverify}` |
| GET | `/api/admin/signatures?filter&q` | `orgs_pending`, `organizations`, `individuals`, `unconfirmed` |
| POST | `/api/admin/signatures/:id/moderate` | `{action: approve \| reject}` (organizações confirmadas) |
| DELETE | `/api/admin/signatures/:id` | Apagar a pedido |
| GET | `/api/admin/signatures/export.csv` | CSV de quem aceitou recontacto |

Todas as rotas `/api/admin/*` exceto `login`, `session` e `logout` exigem sessão; as escritas exigem o header `X-Admin-Request: 1`.

Validação partilhada entre cliente e servidor com **Zod** (`src/shared/schemas.ts`). Rate limits: criar evento 5/h/IP; assinar 10/h/IP; report 10/h/IP.

---

## 9. Requisitos não funcionais

- Lighthouse mobile na página do mapa (excluindo o tile download): **vista Lista** (`/?vista=lista`) ≥ 90 em Performance e Acessibilidade; **vista Mapa** ≥ 90 em Acessibilidade e ≥ 50 em Performance (o arranque do MapLibre domina o TBT; ver `docs/decisions.md` #25).
- JS inicial da página do mapa ≤ 250 KB gzip. O motor do mapa (MapLibre, ~300 KB gzip + worker) carrega à parte, depois de o resumo, os filtros e a lista estarem utilizáveis, e só quando o mapa está visível. Nenhuma versão atual do MapLibre cabe sozinha em 250 KB (ver `docs/decisions.md` #25).
- Alvos de toque ≥ 44 px; funciona em ecrã de 360 px de largura; sem scroll horizontal da página.
- WCAG 2.1 AA: contraste, foco visível, lista de eventos como alternativa ao mapa, formulários com labels e erros anunciados.
- Funciona sem geolocalização e com JS lento; o formulário de assinatura funciona sem JS (POST normal) exceto Turnstile.
- Todas as datas mostradas em PT-PT (`Intl.DateTimeFormat('pt-PT')`).
- Pré-visualização de links: Open Graph em todas as páginas públicas, imagem `public/og.png` (1200×630, `npm run og:image`); URLs absolutos com `PUBLIC_SITE_URL` no build. Páginas de erro 404 e 500 em PT-PT.

---

## 10. Fases de entrega

| Fase | Entregável | Critério de aceitação |
|---|---|---|
| 0 | Esqueleto: Astro + Worker + D1 + migrations + CI (lint, typecheck, testes) | `npm run dev` levanta tudo localmente |
| 1 | Geodados: GeoJSON CAOP simplificado, lista de municípios, PMTiles de PT (continente + ilhas) | `/api/geo/reverse` devolve concelho/distrito/tz corretos para pontos de teste (Porto, Funchal, Ponta Delgada, Bragança) |
| 2 | Mapa só de leitura com seed de ~50 eventos multi-data, clustering, popup, lista | Mapa funcional em 360 px |
| 3 | Filtros "Quando" + "Tipo" + URL state + contadores | Testes unitários da lógica de intervalos (incluindo fim de semana, Açores, mudança de hora de outubro/março) |
| 4 | Adicionar/editar evento com várias datas + Turnstile + link de edição | E2E Playwright em viewport de telemóvel |
| 5 | Assinaturas (individual + organização), confirmação por email, contador, lista pública | E2E com mailer fake |
| 6 | Admin + moderação + exportação + jobs de retenção | |
| 7 | Privacidade, acessibilidade, performance, OG tags, páginas de erro | Lighthouse + axe sem erros |

---

## 11. Decisões em aberto

| # | Decisão | Proposta por omissão |
|---|---|---|
| D1 | Alojamento: Cloudflare vs VPS próprio | Cloudflare |
| D2 | Nome/domínio e identidade visual | — |
| D3 | `MODERATION_MODE` | `post` com selo "não confirmado" |
| D4 | Provider de email | Resend |
| D5 | Datas-chave da campanha (`KEY_DATES`) | nenhuma |
| D6 | Concelho (select) vs código postal na assinatura | Concelho |
| D7 | Camadas de dados abertos pré-carregadas (ex.: postos de combustível da DGEG) | Fora da v1 |
| D8 | Responsável pelo tratamento de dados (RGPD) | — |