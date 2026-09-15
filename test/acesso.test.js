// Exercita a validação do pedido de acesso e o escape que protege a página de
// pedidos. Sem Express, sem banco e sem rede.
const {
  NOME_MAX,
  EMAIL_MAX,
  LIMITE_POR_IP,
  escapaHtml,
  normalizaNome,
  normalizaEmail,
  normalizaUsuario,
  validaPedido,
  podePedir,
} = require('../api/acesso');

let ok = 0;
let falhas = 0;
function eq(nome, a, b) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) { ok++; return; }
  falhas++;
  console.log(`FALHOU ${nome}\n  esperado: ${y}\n  veio    : ${x}`);
}

// ─── Escape: o formulário é público, a página de pedidos é sua ─────────────
// Sem isto, qualquer pessoa na internet escreve script dentro do nome e ele roda
// no SEU navegador, logado, na página protegida.
eq('script no nome é neutralizado',
  escapaHtml('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;/script&gt;');
eq('atributo com aspas é neutralizado',
  escapaHtml('" onerror="alert(1)'),
  '&quot; onerror=&quot;alert(1)');
eq('aspa simples também', escapaHtml("' onload='x"), '&#39; onload=&#39;x');
// O & vem primeiro, senão as próprias entidades seriam re-escapadas.
eq('e-comercial não vira entidade dupla', escapaHtml('a & <b'), 'a &amp; &lt;b');
eq('texto normal passa intacto', escapaHtml('João da Silva'), 'João da Silva');
for (const v of [null, undefined]) eq(`escape de ${v} não quebra`, escapaHtml(v), '');

// ─── Nome ──────────────────────────────────────────────────────────────────
eq('nome com espaços sobrando', normalizaNome('  João   da  Silva '), { valor: 'João da Silva' });
eq('nome vazio é recusado', Boolean(normalizaNome('   ').erro), true);
eq('nome no limite passa', normalizaNome('a'.repeat(NOME_MAX)).valor.length, NOME_MAX);
eq('nome acima do limite é recusado', Boolean(normalizaNome('a'.repeat(NOME_MAX + 1)).erro), true);

// ─── E-mail ────────────────────────────────────────────────────────────────
eq('e-mail é normalizado para minúsculas', normalizaEmail('  Joao@Gmail.COM '), { valor: 'joao@gmail.com' });
eq('subdomínio serve', normalizaEmail('a@b.co.uk').valor, 'a@b.co.uk');
eq('com + serve', normalizaEmail('joao+spotify@gmail.com').valor, 'joao+spotify@gmail.com');
for (const ruim of ['', '   ', 'joao', 'joao@', '@gmail.com', 'joao gmail.com', 'joao@gmail', 'a@b.c']) {
  eq(`"${ruim}" é recusado`, Boolean(normalizaEmail(ruim).erro), true);
}
eq('e-mail longo demais é recusado',
  Boolean(normalizaEmail('a'.repeat(EMAIL_MAX) + '@b.com').erro), true);

// ─── Usuário do Spotify (opcional) ─────────────────────────────────────────
const U = 'abc123xyz';
eq('vazio vira nulo, não erro', normalizaUsuario(''), { valor: null });
eq('só o usuário', normalizaUsuario(U), { valor: U });
eq('link de perfil', normalizaUsuario(`https://open.spotify.com/user/${U}`), { valor: U });
eq('link de perfil com idioma', normalizaUsuario(`https://open.spotify.com/intl-pt/user/${U}?si=x`), { valor: U });
eq('URI do app', normalizaUsuario(`spotify:user:${U}`), { valor: U });
eq('barra no fim', normalizaUsuario(`https://open.spotify.com/user/${U}/`), { valor: U });

// ─── Formulário inteiro ────────────────────────────────────────────────────
eq('pedido completo',
  validaPedido({ nome: ' Ana ', email: 'ANA@x.com', usuario: `spotify:user:${U}` }),
  { nome: 'Ana', email: 'ana@x.com', usuario: U });
eq('pedido sem usuário ainda vale',
  validaPedido({ nome: 'Ana', email: 'ana@x.com' }),
  { nome: 'Ana', email: 'ana@x.com', usuario: null });
// O nome é checado antes do e-mail: quem errou os dois conserta de cima para baixo.
eq('erro de nome vem antes do de e-mail',
  validaPedido({ nome: '', email: 'ruim' }).erro, normalizaNome('').erro);
eq('corpo ausente é recusado sem explodir', Boolean(validaPedido(undefined).erro), true);

// ─── Teto por IP ───────────────────────────────────────────────────────────
// Por IP e não global: um teto global deixaria uma pessoa chata bloquear todo
// mundo, o que é pior que a bagunça de três pedidos.
for (let n = 0; n < LIMITE_POR_IP; n++) eq(`${n} pedidos ainda cabe`, podePedir(n), true);
eq('no limite, para', podePedir(LIMITE_POR_IP), false);
eq('acima do limite, para', podePedir(LIMITE_POR_IP + 5), false);
eq('contagem ausente é tratada como zero', podePedir(undefined), true);

console.log(`\n${ok} asserções passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
