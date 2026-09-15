// Pedido de acesso: a lógica pura.
//
// Por que este formulário existe: em Development Mode o Spotify barra quem não
// está no User Management ANTES de emitir qualquer token. Sem token não há
// /v1/me, então não há e-mail nem ID para capturar — é circular por desenho
// deles. O e-mail só pode vir digitado pela própria pessoa.
//
// Em arquivo próprio, sem import nenhum: dá para exercitar sem Express, sem
// banco e sem rede.

const NOME_MAX = 80;
const EMAIL_MAX = 254; // o máximo de um endereço, pela RFC 5321
const USUARIO_MAX = 60;

/** Quantos pedidos um mesmo IP pode mandar na janela abaixo. */
const LIMITE_POR_IP = 3;
const JANELA_MINUTOS = 60;

/**
 * Escapa para HTML.
 *
 * Nome e e-mail vêm de formulário PÚBLICO e são renderizados na página de
 * pedidos, que é a sua. Sem isto, qualquer pessoa na internet escreveria script
 * dentro do nome e ele rodaria no seu navegador, logado, na página protegida —
 * a página administrativa é justamente o pior lugar para isso acontecer.
 */
function escapaHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizaNome(bruto) {
  const limpo = String(bruto ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return { erro: 'Escreva seu nome.' };
  if (limpo.length > NOME_MAX) return { erro: `Nome muito longo (máximo ${NOME_MAX}).` };
  return { valor: limpo };
}

/**
 * Validação deliberadamente simples.
 *
 * Um regex "completo" de e-mail é famoso por recusar endereços válidos, e aqui
 * recusar um endereço bom é pior do que aceitar um ruim: o endereço ruim só
 * gasta uma linha da sua lista, enquanto o bom deixa alguém de fora sem
 * entender por quê. Quem confere de verdade é o Spotify, na hora de adicionar.
 */
function normalizaEmail(bruto) {
  const limpo = String(bruto ?? '').trim().toLowerCase();
  if (!limpo) return { erro: 'Escreva o e-mail da sua conta do Spotify.' };
  if (limpo.length > EMAIL_MAX) return { erro: 'E-mail muito longo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
    return { erro: 'Esse e-mail não parece válido. Confira e tente de novo.' };
  }
  return { valor: limpo };
}

/**
 * O usuário do Spotify é OPCIONAL: o dashboard pede nome e e-mail, não o ID.
 * Fica aqui só porque ajuda você a reconhecer a pessoa quando o nome digitado
 * não bate com o da conta.
 */
function normalizaUsuario(bruto) {
  const limpo = String(bruto ?? '')
    .trim()
    .replace(/^.*open\.spotify\.com\/(?:intl-[a-z-]+\/)?user\//i, '')
    .replace(/^spotify:user:/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (!limpo) return { valor: null };
  if (limpo.length > USUARIO_MAX) return { erro: 'Usuário do Spotify muito longo.' };
  return { valor: limpo };
}

/** Valida o formulário inteiro, devolvendo o primeiro erro que aparecer. */
function validaPedido(corpo) {
  const nome = normalizaNome(corpo?.nome);
  if (nome.erro) return { erro: nome.erro };

  const email = normalizaEmail(corpo?.email);
  if (email.erro) return { erro: email.erro };

  const usuario = normalizaUsuario(corpo?.usuario);
  if (usuario.erro) return { erro: usuario.erro };

  return { nome: nome.valor, email: email.valor, usuario: usuario.valor };
}

/**
 * Formulário público escreve no seu banco, então precisa de teto.
 *
 * O limite é por IP e por janela, não global: um teto global deixaria uma pessoa
 * chata bloquear o acesso de todo mundo, o que é pior do que a bagunça que ela
 * causaria mandando três pedidos.
 */
function podePedir(pedidosRecentesDoIp) {
  return Number(pedidosRecentesDoIp ?? 0) < LIMITE_POR_IP;
}

module.exports = {
  NOME_MAX,
  EMAIL_MAX,
  USUARIO_MAX,
  LIMITE_POR_IP,
  JANELA_MINUTOS,
  escapaHtml,
  normalizaNome,
  normalizaEmail,
  normalizaUsuario,
  validaPedido,
  podePedir,
};
