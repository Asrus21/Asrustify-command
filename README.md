# 🎵 Asrustify-command

Comando **"Tocando Agora"** para lives. O streamer autoriza sua conta Spotify
via OAuth e recebe:

1. Uma **URL de texto** para bots de chat (Nightbot / StreamElements) que
   retorna a música atual formatada.
2. Um **widget visual** para OBS Browser Source (capa do álbum, artistas,
   próxima música da fila, barra de progresso e logo do Spotify).

Interface bilíngue PT/EN com páginas de Termos de Uso e Política de Privacidade.

## Arquitetura

- **Vercel serverless functions** (Node runtime) — `api/index.js` exporta um app
  Express (`module.exports = app`, sem `app.listen`).
- **Neon Postgres** via `@neondatabase/serverless`.
- Servido sob **`https://asrus.app/spotify/*`** através do proxy reverso (rewrite)
  do hub `asrus.app`, que remove o prefixo `/spotify` antes de encaminhar.

```
Navegador -> https://asrus.app/spotify/<rota>
          -> (rewrite do hub) -> https://api-spotify-command.vercel.app/<rota>
          -> (rewrite do vercel.json) -> /api/index.js (Express)
```

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Valor |
|----------|-------|
| `SPOTIFY_CLIENT_ID` | Client ID do app no Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do mesmo app |
| `REDIRECT_URI` | `https://asrus.app/spotify/callback` (idêntico ao do Dashboard, sem barra final) |
| `BASE_URL` | `https://asrus.app/spotify` (sem barra final) |
| `DATABASE_URL` | Injetada automaticamente ao conectar o Neon pela aba **Storage** |
| `FILA_SECRET` | Segredo compartilhado com quem chama `POST /api/fila/:commandId`. Sem ele, a rota nega tudo — ela **modifica** o player. |
| `SR_SECRET` | Segredo dos comandos de chat: `!sr` (`GET /sr/:commandId`) e `!volume` (`GET /volume/:commandId`). Separado do `FILA_SECRET` de propósito: este viaja na URL do comando do bot. Sem ele, as rotas negam tudo. |
| `PEDIDOS_USER` / `PEDIDOS_PASS` | Basic Auth da página `/pedidos`. Sem os dois, ela nega tudo — mostra e-mail de quem pediu acesso. |
| `LIMITE_CONTAS` | Quantas contas o Development Mode aceita (padrão 5). Só alimenta o contador do painel — quem manda é o dashboard. |

## Deploy

1. Conectar o repositório como projeto na Vercel (Framework preset: **Other**, sem build command).
2. Conectar o **Neon** pela aba **Storage** (injeta `DATABASE_URL`).
3. Adicionar as demais variáveis de ambiente e fazer **Redeploy**.
4. No **Spotify Dashboard**: conferir o Redirect URI e cadastrar os usuários no
   **User Management**. O teto de contas mudou em fevereiro de 2026 (era 25, virou
   5 para apps novos) e apps antigos podem estar em outra situação — o número que
   vale é o que o SEU dashboard mostra.

Não é necessário criar a tabela manualmente — o app roda
`CREATE TABLE IF NOT EXISTS` sob demanda na primeira requisição (lazy init).

## Pedido de música na fila (`POST /api/fila/:commandId`)

Adiciona uma música à fila de reprodução da conta autorizada. Quem chama é a
automação de resgate de pontos do canal, não o navegador de ninguém.

```
POST /api/fila/<commandId>
X-Fila-Secret: <FILA_SECRET>
Content-Type: application/json

{ "pedido": "Queen Bohemian Rhapsody" }
{ "pedido": "https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=x" }
```

Resposta de sucesso:

```json
{ "ok": true, "nome": "...", "artista": "...", "link": "...", "texto": "🎵 Na fila: ..." }
```

Na falha vem `{ "ok": false, "motivo": ..., "mensagem": ... }`, onde `mensagem`
é a frase pronta para o chat. Os `motivo` possíveis: `sem_autorizacao`,
`conta_nao_encontrada`, `pedido_invalido`, `nao_encontrada`, `sem_dispositivo`,
`sem_premium`, `autorizacao`, `limite`, `erro`.

O `commandId` **não** autoriza sozinho: ele viaja dentro de comandos de chat e é
praticamente público. Um endpoint que modifica o player aberto ao mundo seria
bem pior do que um endpoint fora do ar, então sem `FILA_SECRET` configurado a
rota nega tudo.

### O que o Spotify exige, e que não depende de código

| Exigência | O que acontece sem ela |
|---|---|
| **Spotify Premium** na conta autorizada | `403 Premium required` → `sem_premium` |
| **Dispositivo ativo** (Spotify aberto e tocando) | `404` → `sem_dispositivo` |
| Escopo `user-modify-playback-state` | `403 Insufficient client scope` → `sem_escopo`; exige reautorizar em `/register` |
| Conta cadastrada no *User Management* do app | o OAuth nem completa |

O Spotify usa **o mesmo 403** para todas essas situações — e ainda para
restrição de dispositivo (`Restriction violated`). Por isso `explicaErroDaFila`
decide pela mensagem, não pelo status, e devolve o texto cru do Spotify quando
não reconhece: um 403 traduzido como "falta Premium" manda procurar defeito na
assinatura enquanto o problema é outro.

Pelo mesmo motivo a busca e a leitura da faixa **não passam `market`**:
`market=from_token` exige o escopo `user-read-private`, que este app não pede, e
derrubava o pedido com `Insufficient client scope` antes de chegar à fila. Com
token de usuário, a API já aplica o país da conta sozinha.

O escopo é novo: quem autorizou antes desta versão precisa **reautorizar uma
vez** para o pedido de música funcionar.

## Comando `!sr` (`GET /sr/:commandId`)

A mesma fila do resgate por pontos, pedida pelo chat. Existe porque bot de chat
não manda header nem corpo: ele busca uma URL e publica o texto que voltar.

```
GET /sr/:commandId?q=<pedido>&k=<SR_SECRET>
```

Responde **texto puro** e **sempre 200**, inclusive ao recusar. Bot de chat
engole o corpo de uma resposta com status de erro, e o espectador veria silêncio
no lugar do motivo — que é justamente a parte útil ("não achei essa música", "o
Spotify não está tocando").

O segredo é próprio, e não o `FILA_SECRET`, porque este fica salvo no painel do
bot, aparece em log de proxy e escapa numa gravação de tela editando comandos.
Separados, vazar um não entrega o outro, e dá para trocar só este.

**Quem pode pedir, e de quanto em quanto tempo, é decisão do bot.** O
StreamElements tem cooldown e restrição por cargo; aqui não há como saber quem
mandou, porque a requisição chega do servidor do bot e não do espectador.

Configuração no bot (o `<command_id>` é o mesmo do `/musica`):

- **StreamElements** — resposta do comando `!sr`:
  `${customapi.https://asrus.app/spotify/sr/<command_id>?k=<SR_SECRET>&q=${queryescape ${1:}}}`
- **Nightbot** — resposta do comando `!sr`:
  `$(urlfetch https://asrus.app/spotify/sr/<command_id>?k=<SR_SECRET>&q=$(querystring))`

O `queryescape`/`querystring` é obrigatório: sem ele, um pedido com espaço ou
acento chega cortado.

## Comando `!volume` (`GET /volume/:commandId`)

Ajusta o volume do Spotify pelo chat. Usa o **mesmo `SR_SECRET`** do `!sr`: é a
mesma classe de coisa — comando de chat cujo segredo viaja na URL, salvo no
painel do bot — e a mesma exposição. Um segredo a mais seria mais uma coisa
para configurar e esquecer. A consequência está aqui escrita: quem vazar o link
do `!sr` também mexe no volume.

```
GET /volume/:commandId?k=<SR_SECRET>          → diz o volume atual
GET /volume/:commandId?k=<SR_SECRET>&v=50     → põe em 50
GET /volume/:commandId?k=<SR_SECRET>&v=%2B10  → soma 10 ao atual (+10 na URL)
GET /volume/:commandId?k=<SR_SECRET>&v=-10    → tira 10 do atual
```

Texto puro e sempre 200, pelo mesmo motivo do `!sr`.

| O chat digita | O que acontece |
| --- | --- |
| `!volume` | responde o volume atual |
| `!volume 50` | põe em 50% |
| `!volume +10` / `!volume -10` | mexe a partir do atual |
| `!volume 0` | mudo |
| `!volume 150` | recusa, dizendo que a faixa é 0 a 100 |
| `!volume -20` com o volume em 5 | vira 0, não recusa |

**Absoluto fora da faixa é recusado; relativo é limitado.** Quem digita
`!volume 150` quis dizer um número e errou — aceitar calado como 100 esconde o
erro. Já `-20` com o volume em 5 quer dizer "abaixa tudo": a pessoa não tem como
saber o valor atual antes de pedir, então recusar cobraria dela uma informação
que ela não tinha.

Configuração no bot:

- **StreamElements** — resposta do comando `!volume`:
  `${customapi.https://asrus.app/spotify/volume/<command_id>?k=<SR_SECRET>&v=${queryescape ${1:}}}`
- **Nightbot** — resposta do comando `!volume`:
  `$(urlfetch https://asrus.app/spotify/volume/<command_id>?k=<SR_SECRET>&v=$(querystring))`

### O que o Spotify exige aqui

Além de **Premium** e de um **dispositivo tocando** (os mesmos da fila), este
comando tem uma recusa que a fila não tem: **dispositivo sem controle de
volume**. Vários alto-falantes Connect, a maioria das TVs e o player do
navegador recusam mudar o volume por API mesmo tocando e com Premium — ali o
volume é do aparelho, não da sessão. A resposta diz isso em vez de mandar
conferir a assinatura, que está certa.

O escopo necessário (`user-modify-playback-state`) já é pedido desde a fila,
então quem autorizou para o `!sr` não precisa reautorizar.

## Pedido de acesso (Development Mode)

Em Development Mode o Spotify **barra quem não está no User Management antes de
emitir qualquer token**. Sem token não há `/v1/me`, então não há e-mail nem ID
para capturar automaticamente: é circular por desenho deles. O e-mail só pode
vir digitado pela própria pessoa.

| Rota | O que é |
|---|---|
| `GET /acesso` | formulário público: nome, e-mail, usuário do Spotify (opcional) |
| `POST /acesso` | grava o pedido (validação + teto por IP + um pedido por e-mail) |
| `GET /pedidos` | **sua** página, Basic Auth: cada pendente vira um bloco com os dois campos do *User Management* (`Full Name` e `Email`), prontos para copiar |
| `POST /pedidos/atender` | marca um pedido como adicionado |

Quem é barrado chega ao formulário por dois caminhos, porque nem sempre o
Spotify redireciona de volta: o `/callback` manda para lá quando recebe o erro,
e a página `/register` mostra o link desde o começo para o caso de o Spotify
parar na tela dele.

O IP é guardado como **hash**, não em claro: ele serve só para contar pedidos e
segurar spam, e o hash conta igual.

No bloco de cada pedido, o **`Full Name` recebe o usuário do Spotify** quando a
pessoa informou, e não o nome digitado: é ele que identifica a conta sem
ambiguidade. Sem usuário, cai no nome — e o bloco avisa que pode não bastar.

**O teto de contas do Development Mode continua valendo.** Isto automatiza o
processo de juntar os dados, não o limite.

E não há como escapar dele por cima: desde 15/05/2025 o Spotify só aceita pedido
de *extended quota* de **organização registrada com 250 mil usuários ativos
mensais** — pessoa física não se candidata. Na prática, para um app individual a
lista de liberados é o único caminho, e o teto é o que o seu dashboard disser.

## Testes

```bash
npm test
```

Exercita a lógica pura de `api/fila.js` (interpretação do pedido e tradução dos
erros do Spotify), `api/acesso.js` (validação do formulário e o escape que
protege a página de pedidos) e `api/volume.js` (absoluto x relativo, a faixa e a
tradução das recusas) — sem Express, sem banco e sem rede.

## Rodar localmente

```bash
npm install
cp env.example .env   # preencha as credenciais + DATABASE_URL do Neon
npm run dev           # http://localhost:3000/register
```

## Uso na live

- **Nightbot:** `$(urlfetch https://asrus.app/spotify/musica/<command_id>)`
- **StreamElements:** `${customapi.https://asrus.app/spotify/musica/<command_id>}`
- **OBS Browser Source:** `https://asrus.app/spotify/widget/<command_id>` (largura ~600, altura ~140)
- **Pedir música pelo chat (`!sr`):** ver a seção do comando acima — a URL leva o `SR_SECRET`, então ela fica só no painel do bot

O `<command_id>` é gerado ao autorizar em `https://asrus.app/spotify/register`.
