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
12. **PMTiles:** o extrato de Portugal (z0–15, continente + Madeira + Selvagens + Açores) tinha ~711 MB; com a margem da decisão #26 passa a ~1,1 GB. Não entra no repo; o processo está documentado em `data/geo/README.md`.

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

## Fases 2 e 3 — mapa e filtros (2026-10-17)

17. **Dados do mapa:**
    - `GET /api/events.geojson` devolve só eventos `published` com pelo menos uma ocorrência não cancelada e por terminar.
    - Cada evento leva as ocorrências que ainda não terminaram, incluindo as canceladas (com `cancelled: true`), para a ficha as poder mostrar riscadas.
    - Em produção fica 60 s na cache de edge (Cache API, `EDGE_CACHE=on`). No `wrangler dev` e nos testes está desligada, porque a cache local persiste em `.wrangler/` e devolvia dados de seeds antigos.
18. **`GET /api/events/:id`** devolve um evento `published` mesmo que já tenha terminado, para que links partilhados continuem a abrir ("Este evento já terminou"). Os eventos `pending` e `hidden` dão 404.
19. **Página de partilha `/mapa/e/:id`:** é o Worker que a serve. Pega na página estática `/mapa/` e injeta o `<title>` e as tags Open Graph com `HTMLRewriter`; o cliente lê o id a partir do caminho. Em dev, um middleware do Vite reescreve o caminho para `/mapa/`.
20. **Tiles:**
    - `/tiles/:file` serve o `.pmtiles` a partir do R2 (binding `TILES`), com suporte a `Range`.
    - Em dev usa-se `data/geo/dev.pmtiles`, um extrato de Portugal inteiro até z11 com 35 MB, carregado no R2 local com `npm run tiles:dev`. Acima de z11 o MapLibre faz overzoom.
    - Os glyphs (Noto Sans, só os intervalos latinos) e os sprites do Protomaps ficam em `public/map/` (`npm run map:assets`).
    - Etiquetas de Marrocos em árabe ou tifinagh são desenhadas pelo browser (fallback do MapLibre): há pedidos 404 a esses intervalos, sem impacto em Portugal.
21. **Contadores por tipo:** refletem o filtro "Quando" mas ignoram o filtro de tipo. Assim, um tipo não selecionado mostra quantos eventos se ganham ao ativá-lo.
22. **Filtros por dia nos marcadores:** a etiqueta "24/11" aparece a partir do zoom 8 quando o filtro abrange vários dias ("Próximos", "Fim de semana", "7 dias").
23. **Zod fica fora do bundle do cliente.** O cliente confia na nossa própria API, coberta por testes de schema no Worker.
24. **Funcionalidades adiadas para a Fase 4:** os botões "Procurar local" e "Adicionar evento" e a ação "Reportar" da ficha (SPEC §4.1, §4.3), porque precisam de endpoints novos (`/api/geo/search`, `POST /api/events`, `/report`).
25. **Orçamento de JS (SPEC §9) — decidido em 2026-10-17 (opção A).**
    - O JS inicial fica ≤ 250 KB gzip (hoje ~38 KB). O motor do mapa (MapLibre 6) carrega depois, e só quando o mapa está visível: a vista Lista nunca o descarrega.
    - O CSS do MapLibre é injetado quando o motor carrega, para não bloquear a primeira pintura.
    - A página envia no HTML a barra do topo ("A carregar eventos…"), para haver pintura antes do JS.
    - Critério de aceitação: Lighthouse mobile. Resultados a 2026-10-17 (servidor local, GPU, com o script injetado pelo antivírus bloqueado):

      | Página               | Desempenho | Acessibilidade | FCP   | LCP    | TBT        |
      | -------------------- | ---------- | -------------- | ----- | ------ | ---------- |
      | `/mapa/?vista=lista` | **99**     | 100            | 1,4 s | 1,9 s  | 0 ms       |
      | `/mapa/` (mapa)      | **55–57**  | 100            | 1,4 s | ~4,4 s | ~1,8–2,0 s |

    - Na vista Mapa, o TBT vem do arranque do MapLibre na thread principal. Testei um mapa de fundo sem pontos de interesse, edifícios e etiquetas de ruas: não mudou nada.
    - **Meta Lighthouse revista (2026-10-17, decidida pelo utilizador):** a vista Lista tem de ter ≥ 90 em Desempenho e Acessibilidade. A vista Mapa tem de ter ≥ 90 em Acessibilidade e ≥ 50 em Desempenho. O SPEC §9 foi atualizado em conformidade.
    - Nota sobre medições nesta máquina: o antivírus Kaspersky injeta um script de 184 KB em todas as páginas (mesmo em `127.0.0.1`) e interceta o TLS. Medir sempre com `--blocked-url-patterns='*kaspersky-labs.com*'`.
26. **Margens do mapa (2026-10-17):**
    - O fundo do estilo passa de cinzento para a cor da água.
    - O extrato do continente foi alargado para −11° a −5° de longitude e 36° a 43,5° de latitude (`data/geo/pt-region.geojson`): ~1,1 GB em z15 e 51 MB no extrato de dev (z11).
    - O limite de arrastamento (`MAX_BOUNDS`) coincide com as bordas leste e norte do extrato, por isso o corte nunca aparece no ecrã. A oeste e a sul só há mar, exceto a costa de Marrocos, que aparece como mar se se afastar o mapa entre o continente e a Madeira.

## Fase 4 — adicionar e editar eventos (2026-10-17)

27. **Pesquisa de locais:** usa o [Photon](https://photon.komoot.io), um geocodificador baseado no OpenStreetMap, em vez do Nominatim.
    - O Nominatim público limita a 1 pedido por segundo e proíbe uso intensivo atrás de um proxy partilhado.
    - O pedido é feito pelo Worker: só o texto pesquisado sai para o Photon, nunca o IP de quem pesquisa.
    - Os resultados ficam 1 dia em cache e há um limite de 60 pesquisas por hora por pessoa.
    - Deve ser mencionado na página de privacidade (Fase 7).
28. **Link de edição:** tem o formato `/editar/#e=<id>&t=<token>`.
    - O token tem 32 bytes aleatórios; a base de dados guarda só o hash SHA-256.
    - Está no fragmento do URL, por isso nunca vai em pedidos de página, logs nem `Referer`. A API recebe-o pelo header `X-Edit-Token`.
    - Um token errado devolve 404 (não revela se o evento existe).
    - A página `/editar/` tem `noindex` e `no-referrer`.
29. **Datas na submissão:** "todas no futuro" (SPEC §3.1) passa a significar "ainda não terminou". Um evento já a decorrer pode ser adicionado.
    - Máximo de 12 meses à frente, contados no fuso do evento.
    - Não pode haver duas datas com o mesmo dia e a mesma hora de início.
    - As regras estão em `src/shared/occurrence-rules.ts`, usado pelo formulário e pela API.
30. **Edição:**
    - As datas que já passaram não se alteram nem se apagam, mesmo que o pedido as omita ou mude.
    - Mudar texto, tipo ou datas tira o selo "Confirmado" até nova verificação; cancelar datas não.
    - A localização não se pode alterar pelo link.
31. **Reports:**
    - Cada pessoa (IP com hash e sal diário) conta uma vez por evento por dia.
    - À 3.ª denúncia o evento fica `hidden` até revisão (SPEC §4.5).
    - O motivo é escolhido de uma lista fixa (`src/config/reports.ts`).
32. **Honeypot:** se o campo escondido vier preenchido, a resposta é `400 {"error":"rejected"}` e o formulário mostra uma mensagem genérica. Não finge sucesso: um preenchimento automático do browser num caso legítimo tem de ser visível.
33. **Rate limit:**
    - Contadores no KV (`RATE_LIMIT`) por janela fixa de 1 hora. São aproximados sob concorrência, o que chega para travar abusos.
    - A chave é um HMAC do IP com um sal diário, derivado do secret `RATE_LIMIT_SECRET`.
    - Sem esse secret, usa um valor fixo e regista um erro (nunca o IP).
34. **Turnstile:**
    - O script só é carregado quando se envia o formulário, nunca ao abrir a página.
    - Em dev usa as chaves de teste da Cloudflare: site key `1x00000000000000000000BB` e o secret em `.dev.vars`, criado por `npm run setup`.
    - Sem `TURNSTILE_SECRET_KEY`, a verificação falha sempre (fail closed).
35. **Email:**
    - Usa o Resend quando `RESEND_API_KEY` e `MAIL_FROM` estão definidos; caso contrário, os emails são descartados sem registo.
    - Uma falha no envio não impede a criação do evento: o link aparece sempre no ecrã.
36. **Armadilha do runtime Workers:** guardar o `fetch` global numa propriedade e chamá-lo como método (`this.fetchFn(...)`) dá "Illegal invocation". Os adaptadores usam `(input, init) => fetch(input, init)`.

## Fase 5 — Assinaturas

37. **Concelho guardado pelo código DICO** (não pelo nome): há dois concelhos "Lagoa" (Faro e Açores). O formulário usa um `<select>` nativo, agrupado por distrito, com as regiões autónomas no fim; a pesquisa por escrita é a do próprio select. A lista pública mostra o nome, com o distrito só quando há ambiguidade ("Lagoa (Açores)").
38. **Formulário sem JavaScript:** são dois `<form>` normais que fazem POST para `/api/signatures`; a troca Individual/Organização é feita só com CSS (rádios + `:has`).
    - Sem JS, o servidor responde em HTML: sucesso → `303` para `/apoio/confirma-email/`; erros → página que os lista, sem repetir o que foi escrito.
    - O Turnstile precisa de JS, por isso uma assinatura sem JS chega até ao fim da validação e recebe a mensagem "a verificação anti-spam precisa de JavaScript" (é a exceção prevista no SPEC §9).
    - Com JS, o script envia o mesmo formulário com `fetch` e `Accept: application/json`, e mostra os erros junto aos campos.
    - O script do Turnstile carrega quando a pessoa começa a preencher o formulário (`focusin`), não ao abrir a página.
39. **Um só token por assinatura**, para confirmar e para retirar (`confirm_token_hash`; 32 bytes, só o hash).
    - Confirmar: `GET /api/signatures/confirm?token=` (como no SPEC), idempotente, com redirecionamento para `/apoio/obrigado/` ou `/apoio/link-invalido/`. Válido 7 dias desde a assinatura.
    - Retirar: `/apoio/retirar/#t=<token>` (no fragmento, como o link de edição); a página só envia o token quando a pessoa carrega no botão. Apaga o registo.
40. **Email repetido** (SPEC §5.3, passo 4): a resposta é sempre a mesma e nada do que foi escrito substitui os dados existentes.
    - Não confirmada: novo link (o anterior deixa de funcionar) e os 7 dias recomeçam.
    - Confirmada: email com um novo link para retirar.
    - Organização rejeitada: não acontece nada.
    - Máximo de 3 emails por endereço por dia (contador no KV com HMAC do endereço), para o formulário não servir para inundar a caixa de alguém.
41. **Contador:** "apoios" = assinaturas individuais confirmadas (públicas ou não); "organizações" = organizações confirmadas, aprovadas ou à espera de moderação (não as rejeitadas). A lista pública só mostra organizações aprovadas.
42. **Organizações:** a caixa "Publicar o nome da organização" é obrigatória (SPEC §5.2: "sim, por omissão marcado"). Há também uma caixa de consentimento para os dados de contacto, versionada com as restantes.
43. **Consentimento e idade:** a declaração "tenho 13 anos ou mais" vai no texto da caixa de consentimento individual, em vez de numa caixa à parte. A versão dos textos é `CONSENT_TEXT_VERSION` em `src/config/signatures.ts`.
44. **Sem contactos em campos públicos:** nome, apelido, pseudónimo, atividade e nome da organização rejeitam texto com um email ou com 9 ou mais algarismos seguidos (`contact_in_public_field`).
45. **Caixa de correio de dev:** com `DEV_MAILBOX=on` (só em `npm run dev` e nos e2e), os emails ficam no KV durante uma hora e podem ser lidos em `/api/dev/mailbox?to=…`. A rota responde 404 se a variável não estiver ativa ou se o pedido não vier de `localhost`/`127.0.0.1`.
46. **E2E isolados do dev:** o Playwright usa a porta 8788 e estado local próprio (`.wrangler/e2e`, recriado a cada arranque), para nunca reaproveitar nem estragar o `npm run dev` (porta 8787).
47. **Página `/apoio`:** o texto do apelo vem de `content/apelo.md` (por agora um texto de exemplo, assinalado como tal); `content/primeiros-subscritores.md` só aparece se existir. O link para a política de privacidade aponta para `/privacidade/`, que só existe na Fase 7.

## Fase 6 — Admin, moderação, exportação, retenção

48. **Login por magic link:** o pedido em `/admin` dá sempre a mesma resposta; só os endereços em `ADMIN_EMAILS` (variável/secret, separada por vírgulas) recebem email.
    - O link é `/admin/entrar/#t=<token>`, válido 15 minutos e de uso único. O token vai no fragmento e a página troca-o por uma sessão com um POST, para que os scanners de email que abrem links não o gastem.
    - Limites: 10 pedidos por hora por cliente; 5 emails por hora por endereço.
    - Tirar um endereço de `ADMIN_EMAILS` termina logo as suas sessões.
49. **Sessão:** cookie `admin_session` com `Path=/api/admin`, `HttpOnly`, `Secure`, `SameSite=Strict`, durante 24 horas. É o único cookie do site e só existe depois de entrar; as páginas públicas (e a própria página `/admin`, estática) nunca o recebem. Guarda-se só o hash do identificador.
50. **CSRF:** todas as escritas em `/api/admin` exigem o header `X-Admin-Request: 1` (um formulário ou pedido de outro site não o consegue enviar sem um preflight CORS, que nunca autorizamos) e, se vier `Origin`, tem de ser a nossa.
51. **Moderação de eventos:**
    - Filas: Pendentes, Reportados (mais denúncias primeiro), Ocultos, Todos; pesquisa por título ou concelho.
    - "Aprovar" publica e **descarta as denúncias**; sem isso, a denúncia seguinte voltava a ocultar o evento.
    - "Marcar como confirmado" é independente do estado.
    - A edição pela moderação segue as mesmas regras de datas que a do link secreto, mas **não tira** o selo "Confirmado". A localização continua a não se poder alterar.
    - Não há "apagar evento" (o SPEC não o pede): "Ocultar" tira-o do mapa e a retenção apaga-o 30 dias depois da última data.
52. **Moderação de assinaturas:** filas "Organizações por aprovar" (confirmadas por email), "Organizações", "Pessoas" e "Por confirmar"; pesquisa por nome, organização, responsável ou email (para pedidos de apagamento). Só organizações já confirmadas podem ser aprovadas ou rejeitadas. "Apagar" apaga o registo.
53. **CSV:** só quem aceitou recontacto e está confirmado (ou aprovado). Separador `;`, UTF-8 com BOM e CRLF, que é o que o Excel em português abre bem. Células que começam por `=`, `+`, `-`, `@` levam um apóstrofo (injeção de fórmulas).
54. **Retenção (Cron Trigger diário, 03:17 UTC):**
    - assinaturas por confirmar com mais de 7 dias;
    - eventos 30 dias depois da última data (qualquer estado), com datas e denúncias;
    - todas as assinaturas `signatureMonthsAfterCampaign` (6) meses depois de `CAMPAIGN_END`, **que fica `null` até ser decidido** — até lá, as assinaturas ficam até serem retiradas;
    - links de login e sessões expirados.
    - O job regista só contagens.
55. **E2E do admin:** cada projeto do Playwright usa o seu endereço de admin (`admin-<projeto>@exemplo.invalid`), porque correm em paralelo e partilhariam a caixa de correio de dev.

## Fase 7 — Privacidade, acessibilidade, performance, OG, erros

56. **Página `/privacidade`:** texto em `content/privacidade.md`; o responsável pelo tratamento e o contacto vêm de `DATA_CONTROLLER` (`src/config/app.ts`), que continua `[A DEFINIR]` (D8). O texto descreve o que o código faz hoje (dados, prazos, serviços: Cloudflare, Turnstile, Resend, Photon) e **deve ser revisto por alguém da área jurídica** antes do lançamento (SPEC §7). O prazo das assinaturas depois do fim da campanha fica por indicar enquanto `CAMPAIGN_END` for `null`.
57. **Link para a privacidade** em todas as páginas: rodapé do layout base e fim da vista Lista no mapa (a página do mapa não tem rodapé). O layout base ganhou também um link "Saltar para o conteúdo".
58. **OG tags:** componente `src/components/Head.astro`, usado pelo layout base e pelo mapa (título, descrição, `og:*`, `twitter:card`). A imagem `public/og.png` (1200×630) é gerada por `npm run og:image` a partir do nome e da descrição em `pt.ts`; voltar a gerá-la quando o nome for decidido (D2).
    - URLs absolutos (`og:url`, `og:image`) precisam de `PUBLIC_SITE_URL` no build (domínio, D2); sem ele, `og:url` fica de fora e `og:image` é um caminho relativo.
    - `/mapa/e/:id` (Worker) substitui as tags da página do mapa pelas do evento, com `og:image` absoluto a partir do pedido.
    - Páginas de links secretos e de erro não têm tags de pré-visualização.
59. **Páginas de erro:** `404.astro` (servida pelos static assets) e `500.astro`, que o Worker devolve com estado 500 quando uma página que ele próprio gera falha (as rotas `/api` continuam a responder JSON).
60. **Content-Security-Policy:** gerada pelo Astro (`security.csp`) como `<meta>` em todas as páginas, com hashes dos scripts e estilos inline do próprio Astro: `default-src 'self'`; scripts e frames só de nós e de `challenges.cloudflare.com` (Turnstile); `connect-src 'self'`; `img-src 'self' data: blob:`; `form-action 'self'`; sem `'unsafe-inline'` nem `'unsafe-eval'`. Isto torna a regra "nenhum pedido a terceiros exceto Turnstile" verificável pelo browser.
    - Para isso, o CSS do MapLibre passou a ser um ficheiro nosso ligado com `<link>` (antes era um `<style>` inline), o Shiki está desligado e o Zod corre em modo `jitless` (sem sondar `new Function`).
    - `frame-ancestors 'none'` e os restantes cabeçalhos (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) vêm de `public/_headers` para os ficheiros estáticos e de um middleware para as respostas do Worker.
61. **Testes de aceitação da fase:** `tests/e2e/a11y.spec.ts` corre o axe (WCAG 2.1 A/AA) em todas as páginas e nos estados principais (ficha do evento, filtros, passos do "Adicionar", formulário de organização), a 360 px e em desktop, e falha também com qualquer violação da CSP ou pedido a terceiros. Nova dependência de desenvolvimento: `@axe-core/playwright`.
62. **Lighthouse (mobile, local, 17/10/2026):**

    | Página               | Performance | Acessibilidade | Boas práticas | SEO |
    | -------------------- | ----------- | -------------- | ------------- | --- |
    | `/`                  | 100         | 100            | 81            | 100 |
    | `/mapa?vista=lista`  | 91          | 100            | 81            | 100 |
    | `/mapa` (vista Mapa) | 62          | 100            | 81            | 100 |
    | `/apoio/`            | 99          | 100            | 81            | 100 |
    | `/privacidade/`      | 100         | 100            | 81            | 100 |

    As "boas práticas" só perdem pontos por "Does not use HTTPS", que se deve ao servidor local em `http` e ao script injetado pelo antivírus da máquina; em produção, com HTTPS, desaparece. Os alvos do SPEC §9 cumprem-se.

## Lançamento só com o mapa (17/10/2026)

63. **Pedido:** lançar já o mapa; as assinaturas e a página de privacidade ficam para uma fase posterior. Ficam **desligadas, não apagadas**: o código e os testes mantêm-se, para as voltar a ligar sem refazer nada.
    - Interruptor: `FEATURES` em `src/config/app.ts` (`signatures`, `privacyPage`, ambos `false`).
    - Com `signatures: false`: as rotas `/api/signatures/*` nem são registadas; as rotas de assinaturas do admin respondem 404; o separador "Assinaturas" do admin não aparece; não há links para `/apoio`.
    - As páginas estão em `src/pages/_apoio/` e `src/pages/_privacidade.astro`: o Astro não gera páginas cujo nome começa por `_`, por isso `/apoio/*` e `/privacidade/` dão 404.
    - **Para ligar:** pôr a flag a `true` e tirar o `_` do nome das páginas.
    - Testes: os de API das assinaturas ligam a flag explicitamente; o teste de privacidade verifica as rotas com tudo ligado e também que a configuração de lançamento regista exatamente as rotas das funcionalidades ligadas; os e2e das funcionalidades desligadas são saltados, e há um e2e que confirma que essas páginas dão 404 e não têm links.
    - Ficam ligados: submissão e edição de eventos, Turnstile, emails do link de edição, reports, admin (moderação de eventos), retenção, CSP e páginas de erro.
    - Ver #64 sobre o email de contacto dos eventos.
64. **Sem email de contacto no lançamento** (escolha do utilizador, opção 1 de 3): sem página de privacidade, não recolhemos dados pessoais no mapa (RGPD art. 13.º).
    - Flag `FEATURES.eventContactEmail` (`false`): o "Adicionar evento" passa a ter 3 passos (Onde, O quê, Quando) e envia-se no último; o passo "Contacto" só existe com a flag ligada.
    - A API ignora um `contactEmail` enviado diretamente: não é guardado nem usado para enviar email.
    - O link de edição continua a aparecer no ecrã no fim (com "Copiar link"); deixa de ir por email.
    - **Para ligar:** só em conjunto com a página de privacidade (`privacyPage`).

## Deploy (17/10/2026)

65. **D2 — domínio:** `pedroduarte.eu` (Custom Domain do Worker, `[[routes]]` no `wrangler.toml`). O nome do site continua "Mobilização" (`APP_NAME`, por decidir).
66. **Recursos de produção** (conta Cloudflare do utilizador): D1 `mobilizacao-pt` e bucket R2 `mobilizacao-tiles`, ambos na Europa Ocidental (`weur`); KV `RATE_LIMIT`. Mapa base: extrato do build Protomaps `20261017` (zoom 0–15, 1,06 GB), carregado com `rclone`.
67. **Turnstile em modo Managed** (escolha do utilizador): normalmente invisível; mostra uma caixa a confirmar só quando a Cloudflare tem dúvidas. O cliente já usa `appearance: 'interaction-only'`, por isso o widget só aparece nesses casos.
68. **Administração:** para já, um único endereço em `ADMIN_EMAILS` (secret).
69. **Cache do mapa** (erro encontrado em produção: um evento criado e aprovado não aparecia logo).
    - O GeoJSON ficava 60 s em cache no browser e na edge, e o mapa voltava a pedir a lista e recebia a cópia antiga.
    - Agora a cache de 60 s é só na edge. O browser recebe `max-age=0, must-revalidate`; o mesmo vale para `/api/events/:id` e para os contadores e a lista das assinaturas.
    - Criar, editar, reportar ou moderar um evento apaga a cópia da edge no centro de dados de quem fez a alteração, e o mapa pede a lista sem cache depois de criar. Quem muda vê na hora; os outros visitantes, no máximo 60 s depois.
    - `wrangler dev` passa a usar `--local-upstream`: com a rota `pedroduarte.eu` no `wrangler.toml`, os pedidos locais passariam a ter o URL de produção (links de email locais errados e a caixa de correio de dev bloqueada).

## Tema ácido (17/10/2026)

70. **Pins quadrados com pictograma** (direção B do Claude Design, `TEMA-ACIDO-patch.md`): os marcadores deixam de ter cor + forma por tipo.
    - Pin: quadrado preto de 40 px, borda branca de 2 px e contorno preto de 1 px, ponta de 10×6 em baixo (âncora na ponta). Pictograma branco, traço 2,2, 62 % do pin (`src/map/pictograms.ts`, partilhado pelo canvas do mapa e pelo `TypeIcon`).
    - Selecionado: 48 px, fundo laranja, borda e pictograma pretos, desenhado por cima dos vizinhos. Data-chave (`KEY_DATES`): barra laranja de 4 px no topo.
    - Grupos: quadrado branco com borda preta de 2 px (32/40/52 px). Só servimos glifos Noto Sans Medium; a contagem ganha peso com um halo da mesma cor, em vez de descarregar mais um conjunto de glifos.
    - `EVENT_TYPES[*].color` e `shape` foram removidos; `icon` escolhe o pictograma. Nas listas e chips, o `TypeIcon` é o mesmo pin sem ponta.
