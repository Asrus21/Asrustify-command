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
| `PEDIDOS_USER` / `PEDIDOS_PASS` | Basic Auth da página `/pedidos`. Sem os dois, ela nega tudo — mostra e-mail de quem pediu acesso. |

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
| **Spotify Premium** na conta autorizada | `403` → `sem_premium` |
| **Dispositivo ativo** (Spotify aberto e tocando) | `404` → `sem_dispositivo` |
| Escopo `user-modify-playback-state` | `403`; exige reautorizar em `/register` |
| Conta cadastrada no *User Management* do app | o OAuth nem completa |

O escopo é novo: quem autorizou antes desta versão precisa **reautorizar uma
vez** para o pedido de música funcionar.

## Pedido de acesso (Development Mode)

Em Development Mode o Spotify **barra quem não está no User Management antes de
emitir qualquer token**. Sem token não há `/v1/me`, então não há e-mail nem ID
para capturar automaticamente: é circular por desenho deles. O e-mail só pode
vir digitado pela própria pessoa.

| Rota | O que é |
|---|---|
| `GET /acesso` | formulário público: nome, e-mail, usuário do Spotify (opcional) |
| `POST /acesso` | grava o pedido (validação + teto por IP + um pedido por e-mail) |
| `GET /pedidos` | **sua** página, Basic Auth: lista os pendentes e os já adicionados |
| `POST /pedidos/atender` | marca um pedido como adicionado |

Quem é barrado chega ao formulário por dois caminhos, porque nem sempre o
Spotify redireciona de volta: o `/callback` manda para lá quando recebe o erro,
e a página `/register` mostra o link desde o começo para o caso de o Spotify
parar na tela dele.

O IP é guardado como **hash**, não em claro: ele serve só para contar pedidos e
segurar spam, e o hash conta igual.

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
erros do Spotify) e de `api/acesso.js` (validação do formulário e o escape que
protege a página de pedidos) — sem Express, sem banco e sem rede.

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

O `<command_id>` é gerado ao autorizar em `https://asrus.app/spotify/register`.
