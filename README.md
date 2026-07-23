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

## Deploy

1. Conectar o repositório como projeto na Vercel (Framework preset: **Other**, sem build command).
2. Conectar o **Neon** pela aba **Storage** (injeta `DATABASE_URL`).
3. Adicionar as demais variáveis de ambiente e fazer **Redeploy**.
4. No **Spotify Dashboard**: conferir o Redirect URI e cadastrar os usuários no
   **User Management** (Development Mode, máx. 25 contas).

Não é necessário criar a tabela manualmente — o app roda
`CREATE TABLE IF NOT EXISTS` sob demanda na primeira requisição (lazy init).

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
