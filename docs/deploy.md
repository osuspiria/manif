# Deploy na Cloudflare

Lançamento só com o mapa (`FEATURES` em `src/config/app.ts`; `docs/decisions.md` #63–64).
Os comandos são para PowerShell; com `npx`, corre-os na raiz do projeto.

## 0. Antes de começar

- **Domínio (D2)** na Cloudflare: `manifesta.pt` (`docs/decisions.md` #75). É preciso para o Resend (emails de
  entrada no admin) e para os URLs absolutos das pré-visualizações de links. O `*.workers.dev`
  chega para testar.
- **Plano Workers Paid (5 USD/mês), recomendado.** No plano gratuito:
  - o KV aceita só 1 000 escritas por dia, e o rate limit escreve a cada pesquisa de local,
    submissão e report;
  - o CPU fica limitado a 10 ms por pedido.
- Contas: Cloudflare, Resend.

## 1. Login

```powershell
npx wrangler login
npx wrangler whoami            # anota o Account ID
```

## 2. Recursos

```powershell
npx wrangler d1 create mobilizacao-pt               # database_id → wrangler.toml
npx wrangler kv namespace create RATE_LIMIT         # id → wrangler.toml
npx wrangler r2 bucket create mobilizacao-tiles
```

Para o domínio próprio, descomenta o bloco `[[routes]]` no `wrangler.toml`.

**Nunca corras `npm run db:seed` contra produção** (são eventos de exemplo; o script só escreve na
base local).

## 3. Mapa base

Gera `data/geo/pt.pmtiles` (~1,1 GB) e carrega-o no R2 com `rclone`. Os passos estão em
`data/geo/README.md`; o `wrangler r2 object put` não aceita ficheiros deste tamanho.

## 4. Turnstile

No painel, em Turnstile → Add widget, cria um widget no modo "Invisible" ou "Managed", com o
domínio e o `*.workers.dev` como hostnames. Precisas da **site key** (vai no build) e do **secret**.

## 5. Resend

Adiciona e verifica o domínio (registos DNS de SPF e DKIM) e cria uma API key. Nesta fase, o
email só serve para os links de entrada no admin.

## 6. Secrets

```powershell
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put RATE_LIMIT_SECRET   # node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM           # ex.: Manifesta <nao-responder@manifesta.pt>
npx wrangler secret put ADMIN_EMAILS        # ex.: pessoa1@exemplo.pt,pessoa2@exemplo.pt
npx wrangler secret put ANTHROPIC_API_KEY   # importação no /admin (opcional; sem ela, só à mão)
```

O `MODERATION_MODE` e o `EDGE_CACHE` estão em `[vars]`. **Não** definas `DEV_MAILBOX`.

## 7. Deploy

O `PUBLIC_TURNSTILE_SITE_KEY` e o `PUBLIC_SITE_URL` vêm do `.env.production` (lido pelo build
do Astro e pelo `deploy:check`). Variáveis definidas na shell têm precedência sobre o ficheiro:

```powershell
# .env.production
# PUBLIC_TURNSTILE_SITE_KEY=<site key do widget>
# PUBLIC_SITE_URL=https://manifesta.pt
npm run og:image        # se o nome do site mudou (D2)
npm run deploy
```

O `npm run deploy` faz, por ordem:

1. `deploy:check`: recusa o deploy se faltar a site key, se for uma chave de teste, se faltar o
   `PUBLIC_SITE_URL`, se os ids no `wrangler.toml` ainda forem os de exemplo ou se o
   `DEV_MAILBOX` estiver definido;
2. `ci`;
3. `build`;
4. migrações remotas da D1;
5. `wrangler deploy`, que também ativa o cron de retenção (03:17 UTC).

## 8. Verificação

- [ ] `/` (mapa) no telemóvel e no desktop: os tiles carregam, também na Madeira e nos Açores.
- [ ] Criar um evento (o Turnstile passa), abrir o link de edição, cancelar uma data e reportar.
- [ ] `/admin`: o email de entrada chega e dá para moderar e ocultar o evento de teste.
- [ ] `/apoio/` e `/privacidade/` dão 404.
- [ ] Ferramentas de programador: sem cookies; só há pedidos a `challenges.cloudflare.com` quando
      se envia um formulário; os cabeçalhos de segurança e a CSP estão presentes.
- [ ] O Cron Trigger aparece no painel do Worker.
- [ ] Lighthouse em produção, já com HTTPS.

## 9. Domínios antigos e `www`

Redirecionam por Redirect Rules no painel da Cloudflare (não passam pelo Worker):

- Zona `pedroduarte.eu`: Single Redirect, hostname igual a `pedroduarte.eu`, URL dinâmico
  `concat("https://manifesta.pt", http.request.uri.path)`, 301, manter a query string. Se a zona
  não tiver nenhum registo DNS com proxy (o Custom Domain antigo deixou de existir), cria
  `AAAA @ 100::` com proxy para a regra disparar.
- Zona `manifesta.pt`: registo `AAAA www 100::` com proxy e a mesma regra para
  `www.manifesta.pt`.
- Verificar: `curl -sI https://pedroduarte.eu/mapa/e/<id>?x=1` dá `301` com
  `location: https://manifesta.pt/mapa/e/<id>?x=1`.

## 10. Operação

| Para…                                   | Comando                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Ver logs ao vivo                        | `npx wrangler tail`                                                    |
| Voltar à versão anterior                | `npx wrangler rollback`                                                |
| Restaurar a base de dados (até 30 dias) | `npx wrangler d1 time-travel restore mobilizacao-pt --timestamp=<ISO>` |
| Novo deploy                             | passo 7                                                                |
