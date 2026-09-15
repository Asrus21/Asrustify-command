// Exercita a lógica pura do pedido de música. Roda com `node test/fila.test.js`
// — sem Express, sem banco e sem Spotify.
const {
  SPOTIFY_SCOPES,
  consultasDeBusca,
  PEDIDO_MAX,
  interpretaPedido,
  explicaErroDaFila,
  linhaDaFila,
} = require('../api/fila');

let ok = 0;
let falhas = 0;
function eq(nome, a, b) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) { ok++; return; }
  falhas++;
  console.log(`FALHOU ${nome}\n  esperado: ${y}\n  veio    : ${x}`);
}

// ─── Escopos ───────────────────────────────────────────────────────────────
// Sem o de escrita, /v1/me/player/queue responde 403 e nada disso funciona.
eq('escopo de escrita presente', SPOTIFY_SCOPES.includes('user-modify-playback-state'), true);
eq('escopos de leitura preservados',
  SPOTIFY_SCOPES.includes('user-read-currently-playing') &&
  SPOTIFY_SCOPES.includes('user-read-playback-state'), true);

// ─── Link de faixa ganha da busca ──────────────────────────────────────────
const ID = '4cOdK2wGLETKBW3PvgPWqT';
for (const [rotulo, entrada] of [
  ['link simples', `https://open.spotify.com/track/${ID}`],
  ['link com ?si', `https://open.spotify.com/track/${ID}?si=a1b2c3`],
  ['link do celular em PT', `https://open.spotify.com/intl-pt/track/${ID}?si=x`],
  ['link internacional qualquer', `https://open.spotify.com/intl-de/track/${ID}`],
  ['URI do app', `spotify:track:${ID}`],
  ['ID colado sozinho', ID],
  ['link com texto em volta', `toca essa aí https://open.spotify.com/track/${ID} pfv`],
  ['sem https', `open.spotify.com/track/${ID}`],
]) eq(rotulo, interpretaPedido(entrada), { tipo: 'faixa', id: ID });

// ─── Texto vai para a busca ────────────────────────────────────────────────
eq('nome simples', interpretaPedido('bohemian rhapsody'), { tipo: 'busca', termo: 'bohemian rhapsody' });
eq('nome com artista', interpretaPedido('  Queen - Bohemian Rhapsody  '),
  { tipo: 'busca', termo: 'Queen - Bohemian Rhapsody' });
eq('acentos preservados', interpretaPedido('Legião Urbana Tempo Perdido'),
  { tipo: 'busca', termo: 'Legião Urbana Tempo Perdido' });

// ─── Link do Spotify que não é faixa ───────────────────────────────────────
// Cair na busca aqui traria uma música aleatória do texto da URL — pior do que
// dizer que não serve.
for (const [rotulo, entrada] of [
  ['álbum', `https://open.spotify.com/album/${ID}`],
  ['playlist', `https://open.spotify.com/playlist/${ID}`],
  ['artista', `https://open.spotify.com/artist/${ID}`],
  ['episódio de podcast', `spotify:episode:${ID}`],
]) {
  const r = interpretaPedido(entrada);
  eq(`${rotulo} é recusado`, Boolean(r.erro), true);
  eq(`${rotulo} não virou busca`, r.tipo, undefined);
}

// ─── Pedido vazio e longo demais ───────────────────────────────────────────
for (const vazio of [null, undefined, '', '   ']) {
  eq(`vazio ${JSON.stringify(vazio)} é recusado`, Boolean(interpretaPedido(vazio).erro), true);
}
eq('no limite passa', interpretaPedido('a'.repeat(PEDIDO_MAX)).tipo, 'busca');
eq('acima do limite é recusado', Boolean(interpretaPedido('a'.repeat(PEDIDO_MAX + 1)).erro), true);

// ─── Consultas de busca ────────────────────────────────────────────────────
// "zero by lmyk" mandado cru ao Spotify traz outra música: o "by" concorre com
// o resto e o limit=1 não dá segunda chance. Os filtros de campo resolvem, e a
// consulta crua fica de reserva.
eq('"X by Y" vira track + artist',
  consultasDeBusca('zero by lmyk')[0], 'track:"zero" artist:"lmyk"');
eq('"X by Y" mantém a busca crua como reserva',
  consultasDeBusca('zero by lmyk')[1], 'zero by lmyk');
eq('"X por Y" também', consultasDeBusca('Tempo Perdido por Legião Urbana')[0],
  'track:"Tempo Perdido" artist:"Legião Urbana"');
eq('hífen tenta as duas ordens', consultasDeBusca('Queen - Bohemian Rhapsody').slice(0, 2),
  ['track:"Bohemian Rhapsody" artist:"Queen"', 'track:"Queen" artist:"Bohemian Rhapsody"']);
eq('hífen também guarda a crua', consultasDeBusca('Queen - Bohemian Rhapsody')[2],
  'Queen - Bohemian Rhapsody');
eq('sem separador, só a busca crua', consultasDeBusca('bohemian rhapsody'), ['bohemian rhapsody']);
eq('aspas do pedido não escapam para a consulta',
  consultasDeBusca('a "melhor" by alguem')[0], 'track:"a melhor" artist:"alguem"');
eq('vazio não vira consulta', consultasDeBusca('   '), []);

// ─── Tradução dos erros do Spotify ─────────────────────────────────────────
// 403 e 404 do Spotify aqui não são "proibido" nem "não encontrado": são conta
// Free e Spotify fechado. É o que o chat precisa saber.
eq('404 = sem dispositivo',
  explicaErroDaFila(404, 'Player command failed: No active device found').motivo, 'sem_dispositivo');
eq('mensagem de dispositivo mesmo com outro status',
  explicaErroDaFila(502, 'Player command failed: No active device found').motivo, 'sem_dispositivo');
eq('403 = sem premium', explicaErroDaFila(403, 'Player command failed: Premium required').motivo, 'sem_premium');
eq('premium mesmo sem 403', explicaErroDaFila(500, 'PREMIUM_REQUIRED').motivo, 'sem_premium');

// O 403 é ambíguo no Spotify. Tratá-lo como "falta Premium" mandava o streamer
// conferir a assinatura enquanto o defeito era outro — foi o que aconteceu com
// o market=from_token, que devolvia "Insufficient client scope" antes mesmo de
// tentar enfileirar.
eq('403 de escopo não é premium',
  explicaErroDaFila(403, 'Insufficient client scope').motivo, 'sem_escopo');
eq('403 de escopo manda reautorizar',
  explicaErroDaFila(403, 'Insufficient client scope').mensagem.includes('reautorizar'), true);
eq('403 de restrição é restrição',
  explicaErroDaFila(403, 'Player command failed: Restriction violated').motivo, 'restricao');
eq('403 sem texto conhecido não inventa premium',
  explicaErroDaFila(403, 'Something else entirely').motivo, 'erro');
eq('403 desconhecido repassa o texto do Spotify',
  explicaErroDaFila(403, 'Something else entirely').mensagem.includes('Something else entirely'), true);
eq('403 sem mensagem nenhuma diz ao menos o status',
  explicaErroDaFila(403, '').mensagem.includes('403'), true);
eq('401 = autorização', explicaErroDaFila(401, 'The access token expired').motivo, 'autorizacao');
eq('429 = limite', explicaErroDaFila(429, '').motivo, 'limite');
eq('desconhecido cai no genérico', explicaErroDaFila(500, 'boom').motivo, 'erro');
eq('genérico repassa a frase do Spotify',
  explicaErroDaFila(500, 'boom').mensagem.includes('boom'), true);
eq('sem frase nenhuma ainda responde algo',
  explicaErroDaFila(0, '').mensagem.length > 0, true);

// A ordem importa: 404 é checado antes de 403, e a frase antes do status.
eq('sem_dispositivo tem prioridade sobre premium na frase',
  explicaErroDaFila(404, 'No active device found').motivo, 'sem_dispositivo');

// Nenhuma mensagem deve vazar jargão de HTTP para o chat.
for (const s of [404, 403, 401, 429, 500]) {
  const m = explicaErroDaFila(s, 'x').mensagem;
  eq(`mensagem de ${s} não mostra o código`, /\b(40[134]|429|500|HTTP)\b/.test(m), false);
}

// ─── Linha do chat ─────────────────────────────────────────────────────────
eq('linha com artista', linhaDaFila('Tempo Perdido', 'Legião Urbana'),
  '🎵 Na fila: Tempo Perdido — Legião Urbana');
eq('linha sem artista', linhaDaFila('Faixa Solta', ''), '🎵 Na fila: Faixa Solta');

console.log(`\n${ok} asserções passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
