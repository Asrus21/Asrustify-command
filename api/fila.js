// Lógica pura do pedido de música: interpretar o que o espectador escreveu e
// traduzir a recusa do Spotify.
//
// Fica separada do index.js porque é a única parte com decisão de verdade, e
// aqui dá para exercitá-la sem Express, sem banco e sem Spotify.

/** Escopos que o app precisa. `user-modify-playback-state` é o que põe na fila. */
const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

/**
 * ID de faixa do Spotify: 22 caracteres base62.
 *
 * O `intl-pt/` no meio do caminho é o que o app do Spotify cola hoje ao
 * compartilhar em português — sem prever isso, todo link copiado do celular
 * cairia na busca por texto e traria a música errada.
 */
const LINK_DE_FAIXA =
  /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/i;

/** Um token isolado de 22 base62 é ID colado sem o resto da URL. */
const ID_SOLTO = /^[A-Za-z0-9]{22}$/;

const PEDIDO_MAX = 200;

/**
 * Decide se o pedido é um link/ID de faixa ou texto para buscar.
 *
 * Link ganha da busca sempre que existe: quem colou o link já escolheu a faixa,
 * e buscar pelo texto em volta dele acharia outra coisa.
 */
function interpretaPedido(bruto) {
  const limpo = String(bruto ?? '').trim();
  if (!limpo) {
    return { erro: 'Você precisa dizer o nome da música ou colar o link do Spotify.' };
  }
  if (limpo.length > PEDIDO_MAX) {
    return { erro: `Pedido muito longo (máximo ${PEDIDO_MAX} caracteres).` };
  }

  const achado = limpo.match(LINK_DE_FAIXA);
  if (achado) return { tipo: 'faixa', id: achado[1] };

  if (ID_SOLTO.test(limpo)) return { tipo: 'faixa', id: limpo };

  // Link do Spotify que NÃO é faixa (álbum, playlist, artista, episódio).
  // Cair na busca aqui devolveria uma música aleatória do texto da URL, o que é
  // pior do que dizer que não serve.
  if (/open\.spotify\.com|spotify:/i.test(limpo)) {
    return {
      erro:
        'Esse link do Spotify não é de uma música. Cole o link de uma faixa ' +
        '(Compartilhar → Copiar link da música).',
    };
  }

  return { tipo: 'busca', termo: limpo };
}

/**
 * Traduz a recusa do Spotify em algo que resolve o problema de quem está lendo
 * o chat.
 *
 * O Spotify responde 403 e 404 para situações que não têm nada de "proibido" nem
 * de "não encontrado": 403 é conta Free, 404 é Spotify fechado. Repassar cru
 * faria o streamer procurar defeito na configuração.
 */
function explicaErroDaFila(status, mensagemDoSpotify) {
  const msg = String(mensagemDoSpotify ?? '');
  const baixa = msg.toLowerCase();

  if (status === 404 || baixa.includes('no active device')) {
    return {
      motivo: 'sem_dispositivo',
      mensagem:
        'O Spotify do streamer não está tocando em nenhum lugar. Abra o Spotify ' +
        'e dê play em qualquer coisa — depois a fila volta a funcionar.',
    };
  }
  if (status === 403 || baixa.includes('premium')) {
    return {
      motivo: 'sem_premium',
      mensagem: 'Pôr música na fila exige Spotify Premium na conta do streamer.',
    };
  }
  if (status === 401) {
    return {
      motivo: 'autorizacao',
      mensagem: 'A autorização do Spotify expirou. O streamer precisa reautorizar em asrus.app/spotify.',
    };
  }
  if (status === 429) {
    return { motivo: 'limite', mensagem: 'Muitos pedidos em pouco tempo. Espere um pouco.' };
  }
  return {
    motivo: 'erro',
    mensagem: msg ? `O Spotify recusou: ${msg}` : 'Não deu para pôr na fila.',
  };
}

/** A linha que vai ao chat quando dá certo. */
function linhaDaFila(nome, artista) {
  const quem = artista ? ` — ${artista}` : '';
  return `🎵 Na fila: ${nome}${quem}`;
}

module.exports = {
  SPOTIFY_SCOPES,
  PEDIDO_MAX,
  interpretaPedido,
  explicaErroDaFila,
  linhaDaFila,
};
