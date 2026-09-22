// Lógica pura do comando de volume: interpretar o que foi digitado e traduzir
// a recusa do Spotify.
//
// Separada do index.js pelo mesmo motivo da fila: é a parte com decisão de
// verdade, e aqui dá para exercitá-la sem Express, sem banco e sem Spotify.

const VOLUME_MIN = 0;
const VOLUME_MAX = 100;

/**
 * Lê o que veio depois do comando.
 *
 * Três formas, e a diferença entre elas não é cosmética:
 *
 *   50    absoluto  — "ponha em 50"
 *   +10   relativo  — "aumente 10"
 *   -10   relativo  — "diminua 10"
 *
 * Fora da faixa, absoluto e relativo são tratados DIFERENTE, de propósito:
 *
 *   - Absoluto fora de 0–100 é recusado. Quem digitou "!volume 150" quis dizer
 *     um número e errou; aceitar calado como 100 esconde o erro.
 *   - Relativo é limitado à faixa. "-20" com o volume em 5 quer dizer "abaixa
 *     tudo", não "erro": a pessoa não tem como saber o valor atual antes de
 *     pedir, então recusar seria cobrar dela uma informação que ela não tinha.
 *
 * `atual` só é necessário no relativo. Sem ele, o relativo não dá para
 * resolver e a recusa diz isso em vez de chutar um valor.
 */
function interpretaVolume(bruto, atual) {
  const cru = String(bruto ?? '').trim();
  if (!cru) return { erro: 'vazio' };

  // "50%" e "49,6" são formas normais de escrever.
  const limpo = cru.replace(',', '.').replace(/%$/, '');
  if (!limpo) return { erro: 'vazio' };

  const relativo = /^[+-]/.test(limpo);
  const n = Number(limpo);

  // O que NÃO É NÚMERO vira "me diga o volume atual", e não uma recusa.
  //
  // Isto começou como tentativa de reconhecer o placeholder do bot para
  // distinguir "não escreveram nada" de "escreveram errado". Custou três
  // rodadas em produção: primeiro veio "$(1)", depois "(1)" sem o cifrão, e
  // depois uma terceira forma que eu não consegui identificar. É o parser do
  // StreamElements que decide, não nós, e não dá para enumerar o que ele faz.
  //
  // Então a regra deixa de depender disso. Num texto que não é número não há o
  // que fazer de qualquer jeito, e a resposta do volume atual já carrega a
  // sintaxe — "Volume atual: 32%. Use !volume 50 para mudar." — então nem a
  // pessoa que digitou errado fica sem a correção. Nenhuma forma nova de
  // placeholder volta a quebrar isto.
  //
  // Número fora da faixa continua sendo RECUSADO (ver abaixo): ali a pessoa
  // disse um número, e o que ela precisa ouvir é que ele não serve.
  if (!Number.isFinite(n)) return { erro: 'vazio' };

  // O Spotify só aceita inteiro.
  const passo = Math.round(n);

  if (!relativo) {
    if (passo < VOLUME_MIN || passo > VOLUME_MAX) {
      return {
        erro: 'faixa',
        mensagem: `O volume vai de ${VOLUME_MIN} a ${VOLUME_MAX}. Você pediu ${passo}.`,
      };
    }
    return { alvo: passo, relativo: false };
  }

  // `typeof` e não Number(): Number(null) é 0, e null é justamente o que o
  // leVolumeAtual devolve quando o Spotify está fechado. Sem esta distinção,
  // "não consegui ler o volume" virava "o volume é 0", e um !volume +10 com o
  // Spotify fechado pedia 10% em vez de explicar.
  if (typeof atual !== 'number' || !Number.isFinite(atual)) {
    return {
      erro: 'sem_atual',
      mensagem:
        'Não consegui saber o volume atual para somar. Use um número direto, ' +
        'como !volume 50.',
    };
  }

  const antes = Math.round(atual);
  const alvo = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, antes + passo));
  return { alvo, relativo: true, antes };
}

/**
 * Traduz a recusa do Spotify.
 *
 * Mesma regra da fila: o 404 é Spotify fechado, e o 403 é AMBÍGUO — conta Free,
 * token sem escopo e dispositivo que não aceita o comando usam o mesmo código.
 * Quem decide é a mensagem, e o que não for reconhecido volta com o texto do
 * Spotify em vez de um palpite.
 *
 * O caso que a fila não tem: dispositivo SEM controle de volume. Vários
 * alto-falantes Connect, a maioria das TVs e o Spotify em navegador recusam
 * mudar o volume por API mesmo tocando e com Premium — o volume ali é do
 * aparelho, não da sessão. Sem essa frase, o streamer vai conferir a
 * assinatura e o escopo, que estão certos.
 */
function explicaErroDoVolume(status, mensagemDoSpotify) {
  const msg = String(mensagemDoSpotify ?? '');
  const baixa = msg.toLowerCase();

  if (status === 404 || baixa.includes('no active device')) {
    return {
      motivo: 'sem_dispositivo',
      mensagem:
        'O Spotify do streamer não está tocando em nenhum lugar. Abra o Spotify ' +
        'e dê play em qualquer coisa — depois o volume volta a funcionar.',
    };
  }
  if (baixa.includes('premium')) {
    return {
      motivo: 'sem_premium',
      mensagem: 'Mexer no volume exige Spotify Premium na conta do streamer.',
    };
  }
  if (baixa.includes('scope')) {
    return {
      motivo: 'sem_escopo',
      mensagem:
        'Falta uma permissão na autorização do Spotify. O streamer precisa ' +
        'reautorizar em asrus.app/spotify.',
    };
  }
  // Os códigos do Spotify, não a palavra "volume" solta: com ela, um
  // "Invalid volume" — que é erro de argumento NOSSO — era traduzido como
  // "este dispositivo não aceita mudar o volume", mandando o streamer trocar
  // de aparelho por causa de um número errado na URL.
  //
  // "cannot control" é a frase que ele manda de verdade, vista em produção:
  // "Player command failed: Cannot control device volume". Sem ela, a recusa
  // caía no repasse genérico — correto, mas sem dizer o que fazer.
  if (
    baixa.includes('cannot control') ||
    baixa.includes('volume_control_disallow') ||
    baixa.includes('not supported') ||
    baixa.includes('restriction')
  ) {
    return {
      motivo: 'sem_controle_de_volume',
      mensagem:
        'Este dispositivo não aceita mudar o volume pelo Spotify — costuma ser ' +
        'TV, alto-falante ou o player do navegador, onde o volume é do aparelho. ' +
        'Toque pelo app do celular ou do computador.',
    };
  }
  if (status === 401) {
    return {
      motivo: 'autorizacao',
      mensagem:
        'A autorização do Spotify expirou. O streamer precisa reautorizar em ' +
        'asrus.app/spotify.',
    };
  }
  if (status === 429) {
    return { motivo: 'limite', mensagem: 'Muitos pedidos em pouco tempo. Espere um pouco.' };
  }
  return {
    motivo: 'erro',
    mensagem: msg
      ? `O Spotify recusou: ${msg}`
      : `O Spotify recusou o pedido${status ? ` (HTTP ${status})` : ''}.`,
  };
}

/**
 * A linha que vai ao chat quando dá certo.
 *
 * SEM emoji, e isso não é gosto. Toda mensagem que chegou ao chat nos testes
 * era ASCII puro (as recusas); toda mensagem que começaria com emoji não
 * apareceu — resposta vazia no chat, com a rota devolvendo o texto completo,
 * 200 e text/plain. Emoji é fora do BMP (4 bytes em UTF-8, par substituto em
 * UTF-16), e alguma coisa no caminho até o chat não aguenta. Não custa nada
 * escrever sem, e custa o comando inteiro insistir.
 */
function linhaDoVolume(alvo, antes) {
  if (alvo === VOLUME_MIN) return 'Volume no mudo (0%).';
  // Mostrar o "de → para" só quando o pedido foi relativo: em "!volume 50" a
  // pessoa já sabe o alvo, e repetir de onde veio gasta linha de chat.
  const de = typeof antes === 'number' && Number.isFinite(antes) ? `${Math.round(antes)}% → ` : '';
  return `Volume: ${de}${alvo}%`;
}

/** A linha de quando ninguém pediu valor: só informar. */
function linhaDoVolumeAtual(atual) {
  if (typeof atual !== 'number' || !Number.isFinite(atual)) {
    return 'Não consegui ler o volume atual. Abra o Spotify e dê play em algo.';
  }
  const n = Math.round(atual);
  return n === VOLUME_MIN
    ? 'O volume está no mudo. Use !volume 50 para mudar.'
    : `Volume atual: ${n}%. Use !volume 50 para mudar.`;
}

module.exports = {
  VOLUME_MIN,
  VOLUME_MAX,
  interpretaVolume,
  explicaErroDoVolume,
  linhaDoVolume,
  linhaDoVolumeAtual,
};
