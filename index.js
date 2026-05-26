require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.urlencoded({ extended: true }));

// ─── Credenciais do Spotify ───────────────────────────────────────────────────
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `${BASE_URL}/callback`;
const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";

// ─── Formato padrao do comando ────────────────────────────────────────────────
const DEFAULT_FORMAT = "Tocando agora: {nome} - {artista} | {link}";

// ─── Traducoes ────────────────────────────────────────────────────────────────
const T = {
  pt: {
    pageTitle: 'Asrustify-command',
    heroTitle: '🎵 Asrustify-command',
    heroSubtitle: "Conecte sua conta do Spotify e use o comando na sua live para mostrar a música que está tocando.",
    step1Title: "Tenha uma conta no Spotify",
    step1Text: "Se você ainda não tem, crie uma conta gratuita no Spotify. Funciona com conta Free ou Premium.",
    step1Link: "➜ Criar conta no Spotify",
    step2Title: "Autorize o acesso",
    step2Text: "Clique no botão abaixo. Você será redirecionado para o Spotify para autorizar este aplicativo a ler somente a música que está tocando agora. Não temos acesso a senhas, playlists, biblioteca ou dados pessoais.",
    step3Title: "Use o link na sua live",
    step3Text: "Após autorizar, você receberá um link único para colocar no seu bot (Nightbot, StreamElements, etc.). O comando vai mostrar em tempo real a música que está tocando.",
    authButton: "✅ Autorizar com Spotify",
    authFooter: "A autorização é segura e segue o padrão OAuth oficial do Spotify.",
    legalAgree: "Ao continuar você aceita os",
    legalTerms: "Termos de Uso",
    legalAnd: "e a",
    legalPrivacy: "Política de Privacidade",
    fmtTitle: "🎵 Escolha o formato do comando",
    fmtAccount: "Conta",
    fmtPresets: "Formatos prontos (clique para usar):",
    fmtCustomField: "Formato personalizado:",
    fmtPlaceholders: "Placeholders disponíveis:",
    fmtSave: "Salvar formato",
    presets: [
      "Tocando agora: {nome} - {artista} | {link}",
      "🎵 {nome} por {artista} 👉 {link}",
      "{artista} - {nome} | Ouça: {link}",
      "{nome} ({artista})",
    ],
    okTitle: "✅ Formato salvo!",
    okPreview: "Seu comando vai aparecer assim:",
    okCmdLink: "Link do comando para o bot:",
    okChangeAgain: "Alterar formato novamente",
    nothingPlaying: "😶 Não está sendo tocado nada agora.",
    invalidId: "ID inválido ou não autorizado.",
    errorFetch: "Erro ao buscar música.",
  },
  en: {
    pageTitle: 'Asrustify-command',
    heroTitle: '🎵 Asrustify-command',
    heroSubtitle: "Connect your Spotify account and use the command on your stream to show the song currently playing.",
    step1Title: "Have a Spotify account",
    step1Text: "If you don't have one yet, create a free Spotify account. It works with Free or Premium accounts.",
    step1Link: "➜ Create a Spotify account",
    step2Title: "Authorize access",
    step2Text: "Click the button below. You will be redirected to Spotify to authorize this application to read only the song that is currently playing. We do not have access to passwords, playlists, library or personal data.",
    step3Title: "Use the link on your stream",
    step3Text: "After authorizing, you will get a unique link to use on your bot (Nightbot, StreamElements, etc.). The command will show the song that is playing in real time.",
    authButton: "✅ Authorize with Spotify",
    authFooter: "Authorization is secure and follows Spotify's official OAuth standard.",
    legalAgree: "By continuing you accept the",
    legalTerms: "Terms of Use",
    legalAnd: "and the",
    legalPrivacy: "Privacy Policy",
    fmtTitle: "🎵 Choose the command format",
    fmtAccount: "Account",
    fmtPresets: "Ready-made formats (click to use):",
    fmtCustomField: "Custom format:",
    fmtPlaceholders: "Available placeholders:",
    fmtSave: "Save format",
    presets: [
      "Now playing: {nome} - {artista} | {link}",
      "🎵 {nome} by {artista} 👉 {link}",
      "{artista} - {nome} | Listen: {link}",
      "{nome} ({artista})",
    ],
    okTitle: "✅ Format saved!",
    okPreview: "Your command will look like this:",
    okCmdLink: "Command link for your bot:",
    okChangeAgain: "Change format again",
    nothingPlaying: "😶 Nothing is playing right now.",
    invalidId: "Invalid ID or not authorized.",
    errorFetch: "Error fetching the song.",
  },
};

function getLang(req) {
  const lang = (req.query.lang || "").toLowerCase();
  return lang === "en" ? "en" : "pt";
}

// ─── Banco de dados PostgreSQL ────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spotify_users (
      spotify_id    TEXT PRIMARY KEY,
      command_id    TEXT UNIQUE NOT NULL,
      access_token  TEXT,
      refresh_token TEXT,
      format        TEXT,
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE spotify_users
    ADD COLUMN IF NOT EXISTS format TEXT
  `).catch(() => {});
  console.log("Banco de dados pronto.");
}

async function getUserBySpotifyId(spotifyId) {
  const res = await pool.query("SELECT * FROM spotify_users WHERE spotify_id = $1", [spotifyId]);
  return res.rows[0] || null;
}

async function getUserByCommandId(commandId) {
  const res = await pool.query("SELECT * FROM spotify_users WHERE command_id = $1", [commandId]);
  return res.rows[0] || null;
}

async function saveUser(spotifyId, commandId, accessToken, refreshToken) {
  await pool.query(`
    INSERT INTO spotify_users (spotify_id, command_id, access_token, refresh_token)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (spotify_id) DO UPDATE
    SET access_token = $3, refresh_token = $4
  `, [spotifyId, commandId, accessToken, refreshToken]);
}

async function updateAccessToken(spotifyId, accessToken) {
  await pool.query("UPDATE spotify_users SET access_token = $1 WHERE spotify_id = $2", [accessToken, spotifyId]);
}

async function saveFormat(commandId, format) {
  await pool.query("UPDATE spotify_users SET format = $1 WHERE command_id = $2", [format, commandId]);
}

// ─── Refresh do token ─────────────────────────────────────────────────────────
async function refreshAccessToken(spotifyId, refreshToken) {
  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  await updateAccessToken(spotifyId, res.data.access_token);
  return res.data.access_token;
}

// ─── Aplica o formato escolhido pelo usuario ──────────────────────────────────
function applyFormat(format, data) {
  return (format || DEFAULT_FORMAT)
    .replace(/{nome}/g, data.nome)
    .replace(/{artista}/g, data.artista)
    .replace(/{link}/g, data.link);
}

// ─── Buscar musica atual no Spotify ───────────────────────────────────────────
async function fetchCurrentTrack(token) {
  const playing = await axios.get(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!playing.data || playing.status === 204 || !playing.data.item || !playing.data.is_playing) {
    return null;
  }

  const item = playing.data.item;

  // Suporte a podcasts
  if (playing.data.currently_playing_type === "episode") {
    return {
      nome: item.name,
      artista: item.show?.name || "",
      link: item.external_urls.spotify,
      albumArt: item.images?.[0]?.url || item.show?.images?.[0]?.url || null,
      albumLink: item.show?.external_urls?.spotify || item.external_urls.spotify,
      progressMs: playing.data.progress_ms || 0,
      durationMs: item.duration_ms || 0,
      type: "episode",
    };
  }

  return {
    nome: item.name,
    artista: item.artists.map((a) => a.name).join(", "),
    link: item.external_urls.spotify,
    albumArt: item.album?.images?.[0]?.url || null,
    albumLink: item.album?.external_urls?.spotify || item.external_urls.spotify,
    progressMs: playing.data.progress_ms || 0,
    durationMs: item.duration_ms || 0,
    type: "track",
  };
}

// ─── Buscar proxima musica na fila ────────────────────────────────────────────
async function fetchQueue(token) {
  try {
    const res = await axios.get("https://api.spotify.com/v1/me/player/queue", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const next = res.data.queue?.[0];
    if (!next) return null;
    if (next.type === "episode") {
      return next.name;
    }
    return next.name;
  } catch {
    return null;
  }
}

// ─── Componente: botao de troca de idioma ─────────────────────────────────────
function langSwitcher(currentPath, lang) {
  const ptActive = lang === "pt";
  const style = (active) =>
    `padding:6px 14px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:bold;` +
    (active ? "background:#1ed760;color:#000;" : "background:#333;color:#fff;");
  return `
    <div style="text-align:right;margin-bottom:10px;">
      <a href="${currentPath}?lang=pt" style="${style(ptActive)}">PT</a>
      <a href="${currentPath}?lang=en" style="${style(!ptActive)}">EN</a>
    </div>
  `;
}

// ─── ROTA 1: Pagina de registro ───────────────────────────────────────────────
app.get("/register", (req, res) => {
  const lang = getLang(req);
  const t = T[lang];

  // O state carrega o idioma para preservar no callback
  const state = encodeURIComponent(JSON.stringify({ lang, nonce: uuidv4().slice(0, 8) }));

  const authUrl =
    `https://accounts.spotify.com/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
    `&state=${state}` +
    `&show_dialog=true`;

  res.send(`
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${t.pageTitle}</title>
      </head>
      <body style="font-family:sans-serif;background:#191414;color:#fff;margin:0;padding:40px 20px;">
        <div style="max-width:560px;margin:0 auto;">

          ${langSwitcher(`${BASE_URL}/register`, lang)}

          <h1 style="text-align:center;font-size:24px;">${t.heroTitle}</h1>
          <p style="color:#aaa;text-align:center;margin-bottom:36px;">${t.heroSubtitle}</p>

          <div style="background:#282828;border-radius:12px;padding:20px;margin-bottom:16px;">
            <h3 style="margin:0 0 8px;">
              <span style="background:#1ed760;border-radius:50%;padding:2px 10px;margin-right:8px;color:#000;">1</span>
              ${t.step1Title}
            </h3>
            <p style="color:#bbb;font-size:14px;margin:8px 0;">${t.step1Text}</p>
            <a href="https://www.spotify.com/signup" target="_blank"
              style="color:#1ed760;font-size:14px;font-weight:bold;text-decoration:none;">${t.step1Link}</a>
          </div>

          <div style="background:#282828;border-radius:12px;padding:20px;margin-bottom:16px;">
            <h3 style="margin:0 0 8px;">
              <span style="background:#1ed760;border-radius:50%;padding:2px 10px;margin-right:8px;color:#000;">2</span>
              ${t.step2Title}
            </h3>
            <p style="color:#bbb;font-size:14px;margin:8px 0;">${t.step2Text}</p>
          </div>

          <div style="background:#282828;border-radius:12px;padding:20px;margin-bottom:28px;">
            <h3 style="margin:0 0 8px;">
              <span style="background:#1ed760;border-radius:50%;padding:2px 10px;margin-right:8px;color:#000;">3</span>
              ${t.step3Title}
            </h3>
            <p style="color:#bbb;font-size:14px;margin:8px 0;">${t.step3Text}</p>
          </div>

          <div style="text-align:center;">
            <a href="${authUrl}"
              style="background:#1ed760;color:#000;padding:16px 36px;border-radius:30px;text-decoration:none;font-weight:bold;font-size:17px;display:inline-block;">
              ${t.authButton}
            </a>
          </div>

          <p style="color:#777;font-size:12px;text-align:center;margin-top:24px;">${t.authFooter}</p>

          <p style="color:#666;font-size:11px;text-align:center;margin-top:30px;">
            ${t.legalAgree}
            <a href="${BASE_URL}/terms?lang=${lang}" style="color:#999;text-decoration:underline;">${t.legalTerms}</a>
            ${t.legalAnd}
            <a href="${BASE_URL}/privacy?lang=${lang}" style="color:#999;text-decoration:underline;">${t.legalPrivacy}</a>.
          </p>

        </div>
      </body>
    </html>
  `);
});

// ─── ROTA 2: Callback do Spotify ──────────────────────────────────────────────
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  // Tenta recuperar o idioma do state
  let lang = "pt";
  try {
    const parsed = JSON.parse(decodeURIComponent(state || ""));
    if (parsed.lang === "en") lang = "en";
  } catch {}

  if (!code) return res.send("Autorização negada.");

  try {
    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;

    // Pega o ID real do usuario para nao gerar tokens duplicados
    const profileRes = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const spotifyId = profileRes.data.id;

    const existing = await getUserBySpotifyId(spotifyId);
    const commandId = existing ? existing.command_id : uuidv4().replace(/-/g, "").slice(0, 12);

    await saveUser(spotifyId, commandId, accessToken, refreshToken);

    res.redirect(`${BASE_URL}/formato/${commandId}?lang=${lang}`);
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("Erro no callback:", JSON.stringify(detail));
    res.send(`Erro ao obter token: ${JSON.stringify(detail)}`);
  }
});

// ─── ROTA 3: Pagina de escolha de formato ─────────────────────────────────────
app.get("/formato/:commandId", async (req, res) => {
  const lang = getLang(req);
  const t = T[lang];
  const { commandId } = req.params;
  const user = await getUserByCommandId(commandId);

  if (!user) return res.send(t.invalidId);

  const currentFormat = user.format || DEFAULT_FORMAT;

  res.send(`
    <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;padding:50px 20px;background:#191414;color:#fff;">
        <div style="max-width:600px;margin:0 auto;">

          ${langSwitcher(`${BASE_URL}/formato/${commandId}`, lang)}

          <h2 style="text-align:center;">${t.fmtTitle}</h2>
          <p style="color:#aaa;text-align:center;">${t.fmtAccount}: <strong>${user.spotify_id}</strong></p>

          <form method="POST" action="${BASE_URL}/formato/${commandId}?lang=${lang}">
            <p style="color:#aaa;font-size:14px;margin-top:30px;">${t.fmtPresets}</p>

            ${t.presets.map((preset) => {
              const exemplo = applyFormat(preset, {
                nome: "Blinding Lights",
                artista: "The Weeknd",
                link: "link",
              });
              const safePreset = preset.replace(/"/g, "&quot;");
              return `
            <div class="preset-option" data-format="${safePreset}"
              style="background:#282828;padding:14px;border-radius:8px;margin:8px 0;cursor:pointer;font-size:14px;">
              ${exemplo}
            </div>`;
            }).join("")}

            <p style="color:#aaa;font-size:14px;margin-top:24px;">${t.fmtCustomField}</p>
            <input type="text" id="customFormat" name="custom_format" value="${currentFormat.replace(/"/g, "&quot;")}"
              style="width:100%;padding:12px;border-radius:8px;border:none;font-size:14px;box-sizing:border-box;">
            <p style="color:#777;font-size:12px;">
              ${t.fmtPlaceholders} <code>{nome}</code> <code>{artista}</code> <code>{link}</code>
            </p>

            <button type="submit" style="background:#1ed760;color:#000;padding:14px 28px;border:none;border-radius:30px;font-weight:bold;font-size:15px;cursor:pointer;margin-top:20px;width:100%;">
              ${t.fmtSave}
            </button>
          </form>

          <script>
            document.querySelectorAll(".preset-option").forEach(function (el) {
              el.addEventListener("click", function () {
                document.getElementById("customFormat").value = el.getAttribute("data-format");
                document.querySelectorAll(".preset-option").forEach(function (o) {
                  o.style.outline = "none";
                });
                el.style.outline = "2px solid #1ed760";
              });
            });
          </script>

        </div>
      </body>
    </html>
  `);
});

// ─── ROTA 4: Salvar o formato escolhido ───────────────────────────────────────
app.post("/formato/:commandId", async (req, res) => {
  const lang = getLang(req);
  const t = T[lang];
  const { commandId } = req.params;
  const user = await getUserByCommandId(commandId);

  if (!user) return res.send(t.invalidId);

  const format = (req.body.custom_format || "").trim() || DEFAULT_FORMAT;

  await saveFormat(commandId, format);

  const preview = applyFormat(format, {
    nome: "Blinding Lights",
    artista: "The Weeknd",
    link: "https://open.spotify.com/track/...",
  });

  res.send(`
    <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#191414;color:#fff;">
        <div style="max-width:600px;margin:0 auto;">
          <h2>${t.okTitle}</h2>
          <p style="color:#aaa;">${t.okPreview}</p>
          <code style="background:#333;padding:12px 24px;border-radius:6px;display:inline-block;margin:16px 0;">
            ${preview}
          </code>
          <p style="color:#aaa;margin-top:24px;">${t.okCmdLink}</p>
          <code style="background:#333;padding:12px 24px;border-radius:6px;display:inline-block;margin:16px 0;font-size:15px;">
            ${BASE_URL}/musica/${commandId}
          </code>
          <br><br>
          <p style="color:#aaa;font-size:13px;">Nightbot:</p>
          <code style="background:#222;padding:8px 16px;border-radius:6px;display:inline-block;">$(urlfetch ${BASE_URL}/musica/${commandId})</code>
          <br><br>
          <p style="color:#aaa;font-size:13px;">StreamElements:</p>
          <code style="background:#222;padding:8px 16px;border-radius:6px;display:inline-block;">${"${customapi." + BASE_URL + "/musica/" + commandId + "}"}</code>
          <br><br>
          <hr style="border:none;border-top:1px solid #333;margin:20px 0;">
          <p style="color:#aaa;font-size:13px;">${lang === "pt" ? "Widget visual para o OBS (Browser Source):" : "Visual widget for OBS (Browser Source):"}</p>
          <code style="background:#222;padding:8px 16px;border-radius:6px;display:inline-block;font-size:13px;">${BASE_URL}/widget/${commandId}</code>
          <br>
          <a href="${BASE_URL}/widget/${commandId}" target="_blank" style="color:#1ed760;font-size:12px;display:inline-block;margin-top:8px;">${lang === "pt" ? "Abrir widget em nova aba" : "Open widget in new tab"}</a>
          <br><br>
          <a href="${BASE_URL}/formato/${commandId}?lang=${lang}" style="color:#1ed760;font-size:13px;">${t.okChangeAgain}</a>
        </div>
      </body>
    </html>
  `);
});

// ─── ROTA 5: Musica atual ─────────────────────────────────────────────────────
app.get("/musica/:commandId", async (req, res) => {
  const lang = getLang(req);
  const t = T[lang];
  const { commandId } = req.params;
  const user = await getUserByCommandId(commandId);

  if (!user || !user.access_token) {
    return res.send(t.invalidId);
  }

  async function tryFetch(token) {
    const data = await fetchCurrentTrack(token);
    if (!data) return null;
    return applyFormat(user.format, data);
  }

  try {
    const result = await tryFetch(user.access_token);
    if (!result) return res.send(t.nothingPlaying);
    res.send(result);
  } catch (err) {
    if (err.response?.status === 401) {
      try {
        const newToken = await refreshAccessToken(user.spotify_id, user.refresh_token);
        const result = await tryFetch(newToken);
        if (!result) return res.send(t.nothingPlaying);
        return res.send(result);
      } catch (refreshErr) {
        console.error("Erro ao renovar token:", refreshErr.message);
        return res.send(t.errorFetch);
      }
    }
    console.error(err.response?.data || err.message);
    res.send(t.errorFetch);
  }
});

// ─── ROTA: API JSON para o widget ─────────────────────────────────────────────
// Retorna a musica atual + proxima em JSON, usado pelo widget visual.
async function getCurrentTrackData(user) {
  async function attempt(token) {
    const current = await fetchCurrentTrack(token);
    if (!current) return null;
    const next = await fetchQueue(token);
    return { ...current, next };
  }

  try {
    return await attempt(user.access_token);
  } catch (err) {
    if (err.response?.status === 401) {
      const newToken = await refreshAccessToken(user.spotify_id, user.refresh_token);
      return await attempt(newToken);
    }
    throw err;
  }
}

app.get("/api/now/:commandId", async (req, res) => {
  const { commandId } = req.params;
  const user = await getUserByCommandId(commandId);

  if (!user || !user.access_token) {
    return res.status(404).json({ playing: false, error: "invalid_id" });
  }

  try {
    const data = await getCurrentTrackData(user);
    if (!data) return res.json({ playing: false });
    res.json({ playing: true, ...data });
  } catch (err) {
    console.error("Erro na API now:", err.response?.data || err.message);
    res.status(500).json({ playing: false, error: "fetch_failed" });
  }
});

// ─── ROTA: Widget visual (para usar como Browser Source no OBS) ───────────────
app.get("/widget/:commandId", async (req, res) => {
  const { commandId } = req.params;
  const user = await getUserByCommandId(commandId);

  if (!user) {
    return res.send(`<html><body style="background:transparent;color:#fff;font-family:sans-serif;padding:20px;">Invalid command_id</body></html>`);
  }

  // Logo oficial do Spotify (Spotify green icon como SVG inline, seguindo guidelines)
  const spotifyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 168" width="36" height="36">
    <path fill="#1ed760" d="M83.996.277C37.747.277.253 37.77.253 84.019c0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738l.001-.004zm38.404 120.78a5.217 5.217 0 01-7.18 1.73c-19.662-12.01-44.414-14.73-73.564-8.07a5.222 5.222 0 01-6.249-3.93 5.213 5.213 0 013.926-6.25c31.9-7.291 59.263-4.15 81.337 9.34 2.46 1.51 3.24 4.72 1.73 7.18zm10.25-22.805c-1.89 3.075-5.91 4.045-8.98 2.155-22.51-13.839-56.823-17.846-83.448-9.764-3.453 1.043-7.1-.903-8.148-4.35a6.538 6.538 0 014.354-8.143c30.413-9.228 68.222-4.758 94.072 11.127 3.07 1.89 4.04 5.91 2.15 8.976v-.001zm.88-23.744c-26.99-16.031-71.52-17.505-97.289-9.684-4.138 1.255-8.514-1.081-9.768-5.219a7.835 7.835 0 015.221-9.771c29.581-8.98 78.756-7.245 109.83 11.202a7.823 7.823 0 012.74 10.733c-2.2 3.722-7.02 4.949-10.73 2.739z"/>
  </svg>`;

  // Pagina HTML do widget. Atualiza via fetch a cada 3s.
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Asrustify-command Widget</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #fff;
      overflow: hidden;
    }
    .widget {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: #191414;
      border-radius: 16px;
      max-width: 560px;
      transition: opacity 0.3s;
    }
    .widget.hidden { opacity: 0.4; }
    .album-link {
      flex-shrink: 0;
      display: block;
      line-height: 0;
    }
    .album-art {
      width: 96px;
      height: 96px;
      border-radius: 8px;
      object-fit: cover;
      display: block;
    }
    .album-art-placeholder {
      width: 96px;
      height: 96px;
      border-radius: 8px;
      background: #282828;
    }
    .info {
      flex: 1;
      min-width: 0;
    }
    .track-name {
      font-size: 22px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .artist {
      font-size: 16px;
      color: #e0e0e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 6px;
    }
    .next-song {
      font-size: 13px;
      color: #aaa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 10px;
    }
    .progress-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: #aaa;
    }
    .progress-bar {
      flex: 1;
      height: 6px;
      background: #404040;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #1ed760;
      width: 0%;
      transition: width 1s linear;
    }
    .spotify-logo {
      flex-shrink: 0;
      align-self: flex-start;
      line-height: 0;
    }
    .error-box {
      background: #4a1f1f;
      color: #ffcccc;
      padding: 16px;
      border-radius: 12px;
      font-size: 13px;
      max-width: 560px;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="widget hidden">
      <div class="album-art-placeholder"></div>
      <div class="info">
        <div class="track-name">Loading…</div>
        <div class="artist">Spotify</div>
      </div>
      <div class="spotify-logo">${spotifyIconSvg}</div>
    </div>
  </div>

  <script>
    const COMMAND_ID = ${JSON.stringify(commandId)};
    const API_URL = ${JSON.stringify(BASE_URL)} + "/api/now/" + COMMAND_ID;
    const SPOTIFY_ICON = ${JSON.stringify(spotifyIconSvg)};

    let lastProgress = 0;
    let lastDuration = 0;
    let lastUpdate = Date.now();

    function fmtTime(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function showError(msg) {
      document.getElementById("root").innerHTML =
        '<div class="error-box">Widget error: ' + escapeHtml(msg) + '</div>';
    }

    function render(data) {
      const root = document.getElementById("root");

      if (!data || !data.playing) {
        root.innerHTML = '<div class="widget hidden">' +
          '<div class="album-art-placeholder"></div>' +
          '<div class="info">' +
            '<div class="track-name">—</div>' +
            '<div class="artist">Nothing playing</div>' +
          '</div>' +
          '<div class="spotify-logo">' + SPOTIFY_ICON + '</div>' +
        '</div>';
        return;
      }

      lastProgress = data.progressMs || 0;
      lastDuration = data.durationMs || 0;
      lastUpdate = Date.now();

      const albumImg = data.albumArt
        ? '<img class="album-art" src="' + escapeHtml(data.albumArt) + '" alt="Album art">'
        : '<div class="album-art-placeholder"></div>';

      const nextSongHtml = data.next
        ? '<div class="next-song">Next: ' + escapeHtml(data.next) + '</div>'
        : '';

      const pct = lastDuration ? (lastProgress / lastDuration * 100) : 0;

      root.innerHTML =
        '<div class="widget">' +
          '<a class="album-link" href="' + escapeHtml(data.albumLink || data.link) + '" target="_blank">' +
            albumImg +
          '</a>' +
          '<div class="info">' +
            '<div class="track-name">' + escapeHtml(data.nome) + '</div>' +
            '<div class="artist">' + escapeHtml(data.artista) + '</div>' +
            nextSongHtml +
            '<div class="progress-row">' +
              '<span id="progress-time">' + fmtTime(lastProgress) + '</span>' +
              '<div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:' + pct + '%"></div></div>' +
              '<span>' + fmtTime(lastDuration) + '</span>' +
            '</div>' +
          '</div>' +
          '<a class="spotify-logo" href="' + escapeHtml(data.link) + '" target="_blank">' + SPOTIFY_ICON + '</a>' +
        '</div>';
    }

    function tickProgress() {
      const fill = document.getElementById("progress-fill");
      const label = document.getElementById("progress-time");
      if (!fill || !label || !lastDuration) return;
      const elapsed = lastProgress + (Date.now() - lastUpdate);
      const pct = Math.min(100, (elapsed / lastDuration) * 100);
      fill.style.width = pct + "%";
      label.textContent = fmtTime(elapsed);
    }

    async function refresh() {
      try {
        const res = await fetch(API_URL, { cache: "no-store" });
        if (!res.ok) {
          showError("HTTP " + res.status + " — " + API_URL);
          return;
        }
        const data = await res.json();
        render(data);
      } catch (e) {
        showError(e.message + " — " + API_URL);
      }
    }

    // Captura erros globais para nao deixar tela em branco
    window.addEventListener("error", function (e) {
      showError("JS error: " + (e.message || "unknown"));
    });

    refresh();
    setInterval(refresh, 3000);
    setInterval(tickProgress, 500);
  </script>
</body>
</html>`);
});

// ─── Documentos legais ────────────────────────────────────────────────────────
const LEGAL = {
  terms: {
    pt: {
      title: "Termos de Uso",
      updated: "Última atualização: 26 de maio de 2026",
      sections: [
        { h: "1. Sobre este serviço", p: "Este site oferece um comando para lives chamado <strong>Asrustify-command</strong>, que exibe a música que o streamer está ouvindo no Spotify. Ao usar este site você concorda com estes Termos de Uso. Se não concordar, não utilize o serviço." },
        { h: "2. Como funciona", p: "Você autoriza este site a ler apenas a música que está tocando agora na sua conta Spotify (escopos <code>user-read-currently-playing</code> e <code>user-read-playback-state</code>). Não temos acesso a senhas, playlists, biblioteca, e-mail ou dados financeiros." },
        { h: "3. Uso permitido", p: "É permitido o uso pessoal e não comercial. Você não pode revender, redistribuir, fazer engenharia reversa ou tentar contornar mecanismos de segurança do site." },
        { h: "4. Serviços de terceiros", p: "Este site usa a API do <strong>Spotify</strong>. Não somos donos nem controlamos o Spotify. Indisponibilidades, mudanças ou limitações impostas pelo Spotify estão fora do nosso controle e não somos responsáveis por elas." },
        { h: "5. Limitação de responsabilidade", p: "O serviço é oferecido <em>\"como está\"</em>, sem garantias de qualquer tipo. Não nos responsabilizamos por perdas, danos ou interrupções decorrentes do uso do site ou dos serviços de terceiros." },
        { h: "6. Encerramento", p: "Podemos suspender ou encerrar seu acesso ao serviço se você violar estes Termos. Você pode encerrar seu uso a qualquer momento revogando a autorização do app em <a href=\"https://www.spotify.com/account/apps\" target=\"_blank\" style=\"color:#1ed760;\">spotify.com/account/apps</a>." },
        { h: "7. Termos específicos do Spotify", p: `Se você usa este site, você reconhece e concorda com o seguinte:
          <ul style="color:#bbb;font-size:14px;line-height:1.7;margin:10px 0;padding-left:20px;">
            <li>Não fazemos garantias em nome do Spotify e renunciamos expressamente a todas as garantias implícitas relativas à Plataforma, Serviço e Conteúdo do Spotify, incluindo comerciabilidade, adequação a um propósito específico e não violação.</li>
            <li>É proibido modificar ou criar trabalhos derivados da Plataforma, Serviço ou Conteúdo do Spotify.</li>
            <li>É proibido descompilar, fazer engenharia reversa ou reduzir o Spotify a forma legível por humanos, na máxima extensão permitida por lei.</li>
            <li>Você é exclusivamente responsável pelo uso do site. O Spotify não é responsável por nada decorrente do seu uso deste site.</li>
            <li>O Spotify é <strong>beneficiário terceiro</strong> destes Termos e da nossa Política de Privacidade, com direito a executar esses termos diretamente contra você.</li>
            <li>Você consente com a coleta e uso dos seus dados do Spotify (tokens de autenticação) para as finalidades de integração descritas neste site. Esses tokens são armazenados de forma segura e usados apenas para habilitar as funcionalidades aqui descritas.</li>
            <li>O uso de funcionalidades integradas ao Spotify também é regido pelos <a href="https://developer.spotify.com/terms" target="_blank" style="color:#1ed760;">Developer Terms of Service</a> do Spotify, que você deve revisar e cumprir.</li>
          </ul>` },
        { h: "8. Alterações", p: "Podemos atualizar estes Termos a qualquer momento. O uso continuado após a atualização significa que você aceita as novas condições." },
        { h: "9. Contato", p: 'Dúvidas? Entre em contato em <a href="https://github.com/Asrus21/Asrustify-command" target="_blank" style="color:#1ed760;">github.com/Asrus21/Asrustify-command</a>.' },
      ],
    },
    en: {
      title: "Terms of Use",
      updated: "Last updated: May 26, 2026",
      sections: [
        { h: "1. About this service", p: "This website provides a stream command called <strong>Asrustify-command</strong>, which displays the song the streamer is listening to on Spotify. By using this site, you agree to these Terms of Use. If you do not agree, do not use the service." },
        { h: "2. How it works", p: "You authorize this site to read only the song currently playing on your Spotify account (scopes <code>user-read-currently-playing</code> and <code>user-read-playback-state</code>). We do not have access to passwords, playlists, library, e-mail or financial data." },
        { h: "3. Permitted use", p: "Personal, non-commercial use only. You may not resell, redistribute, reverse-engineer or attempt to bypass any security measures of this site." },
        { h: "4. Third-party services", p: "This site uses the <strong>Spotify</strong> API. We do not own or control Spotify. Any downtime, changes or limitations imposed by Spotify are outside our control and we are not liable for them." },
        { h: "5. Limitation of liability", p: "The service is provided <em>\"as is\"</em>, without warranties of any kind. We are not liable for losses, damages or disruptions arising from the use of this site or third-party services." },
        { h: "6. Termination", p: "We may suspend or end your access to the service if you violate these Terms. You can stop using the service at any time by revoking the app's authorization at <a href=\"https://www.spotify.com/account/apps\" target=\"_blank\" style=\"color:#1ed760;\">spotify.com/account/apps</a>." },
        { h: "7. Spotify-specific terms", p: `By using this site, you acknowledge and agree to the following:
          <ul style="color:#bbb;font-size:14px;line-height:1.7;margin:10px 0;padding-left:20px;">
            <li>We make no warranties on behalf of Spotify and expressly disclaim all implied warranties regarding the Spotify Platform, Service and Content, including merchantability, fitness for a particular purpose and non-infringement.</li>
            <li>You may not modify or create derivative works of the Spotify Platform, Service or Content.</li>
            <li>You may not decompile, reverse-engineer or reduce Spotify to human-readable form, to the fullest extent permitted by law.</li>
            <li>You are solely responsible for your use of this site. Spotify is not liable for anything arising from your use of this site.</li>
            <li>Spotify is a <strong>third-party beneficiary</strong> of these Terms and of our Privacy Policy, with the right to enforce these terms directly against you.</li>
            <li>You consent to the collection and use of your Spotify data (authentication tokens) for the integration purposes described on this site. These tokens are stored securely and only used to enable the features described here.</li>
            <li>The use of Spotify-integrated features is also governed by Spotify's <a href="https://developer.spotify.com/terms" target="_blank" style="color:#1ed760;">Developer Terms of Service</a>, which you must review and comply with.</li>
          </ul>` },
        { h: "8. Changes", p: "We may update these Terms at any time. Continued use after an update means you accept the new conditions." },
        { h: "9. Contact", p: 'Questions? Contact us at <a href="https://github.com/Asrus21/Asrustify-command" target="_blank" style="color:#1ed760;">github.com/Asrus21/Asrustify-command</a>.' },
      ],
    },
  },
  privacy: {
    pt: {
      title: "Política de Privacidade",
      updated: "Última atualização: 26 de maio de 2026",
      sections: [
        { h: "1. Resumo", p: "Levamos sua privacidade a sério. Coletamos apenas o mínimo necessário para o comando funcionar. Não vendemos seus dados, não rastreamos você para anúncios e não compartilhamos suas informações com terceiros." },
        { h: "2. O que coletamos", p: `Quando você autoriza o serviço, guardamos no nosso banco de dados:
          <ul style="color:#bbb;font-size:14px;line-height:1.7;margin:10px 0;padding-left:20px;">
            <li><strong>Seu ID de usuário do Spotify</strong> — identificador público da sua conta.</li>
            <li><strong>access_token e refresh_token</strong> — usados para consultar a música atual via API do Spotify.</li>
            <li><strong>Um identificador aleatório (command_id)</strong> — usado na URL do seu comando.</li>
            <li><strong>O formato escolhido</strong> — texto que define como o comando aparece na sua live.</li>
          </ul>
          Não coletamos seu e-mail, senha, dados financeiros nem qualquer informação pessoal além do necessário.` },
        { h: "3. O que NÃO coletamos", p: "Não acessamos suas playlists, biblioteca, histórico de músicas, dados de cartão, e-mail ou contatos. Os escopos solicitados ao Spotify se limitam a <code>user-read-currently-playing</code> e <code>user-read-playback-state</code> — apenas a música atualmente tocando." },
        { h: "4. Como usamos seus dados", p: "Os dados coletados são usados exclusivamente para fazer o comando funcionar. Não usamos para análises, propaganda, perfilamento ou qualquer outra finalidade." },
        { h: "5. Compartilhamento", p: "Não vendemos nem compartilhamos seus dados com terceiros. As únicas exceções são: (a) consultas necessárias à API do Spotify para o funcionamento do comando; (b) obrigações legais, como ordem judicial." },
        { h: "6. Retenção", p: "Mantemos seus dados enquanto você usar o serviço. Quando solicitada a exclusão, removemos todos os seus dados do nosso banco em até 7 dias." },
        { h: "7. Exclusão de conta", p: 'Para excluir seus dados, entre em contato em <a href="https://github.com/Asrus21/Asrustify-command" target="_blank" style="color:#1ed760;">github.com/Asrus21/Asrustify-command</a> informando seu command_id. Você também pode <strong>revogar a autorização diretamente no Spotify</strong> em <a href="https://www.spotify.com/account/apps" target="_blank" style="color:#1ed760;">spotify.com/account/apps</a> — após isso, mesmo que nosso banco ainda tenha o token, ele não funcionará mais.' },
        { h: "8. Segurança", p: "Seus dados ficam armazenados em um banco de dados PostgreSQL hospedado em servidores seguros (Railway). Adotamos práticas padrão da indústria para proteger contra acesso não autorizado, perda ou alteração." },
        { h: "9. Spotify como beneficiário", p: "Você reconhece que o Spotify é beneficiário terceiro desta Política de Privacidade, com direito a executar diretamente contra você os termos relativos ao uso de dados do Spotify." },
        { h: "10. Alterações", p: "Podemos atualizar esta política. Mudanças significativas serão anunciadas nesta página. O uso continuado após uma atualização significa que você aceita os novos termos." },
      ],
    },
    en: {
      title: "Privacy Policy",
      updated: "Last updated: May 26, 2026",
      sections: [
        { h: "1. Summary", p: "We take your privacy seriously. We collect only the minimum needed for the command to work. We do not sell your data, we do not track you for ads, and we do not share your information with third parties." },
        { h: "2. What we collect", p: `When you authorize the service, we store in our database:
          <ul style="color:#bbb;font-size:14px;line-height:1.7;margin:10px 0;padding-left:20px;">
            <li><strong>Your Spotify user ID</strong> — public identifier of your account.</li>
            <li><strong>access_token and refresh_token</strong> — used to query the currently playing song via the Spotify API.</li>
            <li><strong>A random identifier (command_id)</strong> — used in your command URL.</li>
            <li><strong>The format you chose</strong> — text that defines how the command appears in your stream.</li>
          </ul>
          We do not collect your email, password, financial data or any other personal information.` },
        { h: "3. What we do NOT collect", p: "We do not access your playlists, library, listening history, card data, email or contacts. The scopes requested from Spotify are limited to <code>user-read-currently-playing</code> and <code>user-read-playback-state</code> — only the song currently playing." },
        { h: "4. How we use your data", p: "The collected data is used exclusively to make the command work. We do not use it for analytics, advertising, profiling or any other purpose." },
        { h: "5. Sharing", p: "We do not sell or share your data with third parties. The only exceptions are: (a) necessary requests to the Spotify API for the command to work; (b) legal obligations, such as a court order." },
        { h: "6. Retention", p: "We keep your data for as long as you use the service. When deletion is requested, we remove all your data from our database within 7 days." },
        { h: "7. Account deletion", p: 'To delete your data, contact us at <a href="https://github.com/Asrus21/Asrustify-command" target="_blank" style="color:#1ed760;">github.com/Asrus21/Asrustify-command</a> with your command_id. You can also <strong>revoke authorization directly on Spotify</strong> at <a href="https://www.spotify.com/account/apps" target="_blank" style="color:#1ed760;">spotify.com/account/apps</a> — after that, even if our database still has the token, it will no longer work.' },
        { h: "8. Security", p: "Your data is stored in a PostgreSQL database hosted on secure servers (Railway). We use industry-standard practices to protect against unauthorized access, loss or alteration." },
        { h: "9. Spotify as beneficiary", p: "You acknowledge that Spotify is a third-party beneficiary of this Privacy Policy, with the right to enforce directly against you the terms related to the use of Spotify data." },
        { h: "10. Changes", p: "We may update this policy. Significant changes will be announced on this page. Continued use after an update means you accept the new terms." },
      ],
    },
  },
};

function renderLegalPage(docKey, lang) {
  const doc = LEGAL[docKey][lang];
  const baseRoute = docKey === "terms" ? "/terms" : "/privacy";
  const back = lang === "pt" ? "← Voltar ao registro" : "← Back to register";

  const body = doc.sections.map(s => `
    <h3 style="margin-top:28px;font-size:17px;">${s.h}</h3>
    <div style="color:#bbb;font-size:14px;line-height:1.7;">${s.p}</div>
  `).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${doc.title} | Asrustify-command</title>
      </head>
      <body style="font-family:sans-serif;background:#191414;color:#fff;margin:0;padding:40px 20px;">
        <div style="max-width:720px;margin:0 auto;">
          ${langSwitcher(`${BASE_URL}${baseRoute}`, lang)}
          <h1 style="font-size:26px;">${doc.title}</h1>
          <p style="color:#777;font-size:13px;">${doc.updated}</p>
          ${body}
          <p style="margin-top:40px;">
            <a href="${BASE_URL}/register?lang=${lang}" style="color:#1ed760;text-decoration:none;font-size:14px;">${back}</a>
          </p>
        </div>
      </body>
    </html>
  `;
}

app.get("/terms", (req, res) => {
  res.send(renderLegalPage("terms", getLang(req)));
});

app.get("/privacy", (req, res) => {
  res.send(renderLegalPage("privacy", getLang(req)));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Registrar: ${BASE_URL}/register`);
});

initDB().catch((err) => {
  console.error("Erro ao conectar ao banco:", err.message);
});
