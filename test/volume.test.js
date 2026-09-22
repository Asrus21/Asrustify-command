// Asserções do comando de volume. Sem Express, sem banco, sem Spotify: só a
// parte que decide o que fazer com o que foi digitado e o que dizer no chat.

const assert = require('node:assert/strict');
const {
  VOLUME_MIN,
  VOLUME_MAX,
  interpretaVolume,
  explicaErroDoVolume,
  linhaDoVolume,
  linhaDoVolumeAtual,
} = require('../api/volume');

let n = 0;
const ok = (nome, f) => { f(); n++; console.log('  ok', nome); };

console.log('volume absoluto');
ok('número simples', () => assert.deepEqual(interpretaVolume('50', 30), { alvo: 50, relativo: false }));
ok('com espaço e %', () => assert.deepEqual(interpretaVolume('  70% ', 30), { alvo: 70, relativo: false }));
ok('decimal é arredondado (o Spotify só aceita inteiro)', () => {
  assert.equal(interpretaVolume('49.6', 30).alvo, 50);
  assert.equal(interpretaVolume('49,4', 30).alvo, 49);
});
ok('0 é mudo, não "nada escrito"', () => assert.deepEqual(interpretaVolume('0', 30), { alvo: 0, relativo: false }));
ok('100 vale', () => assert.equal(interpretaVolume('100', 30).alvo, 100));

console.log('absoluto fora da faixa é RECUSADO');
for (const v of ['101', '150', '-1000', '999']) {
  ok(`recusa ${v}`, () => {
    const r = interpretaVolume(v, 30);
    if (v.startsWith('-')) return; // esse é relativo, testado abaixo
    assert.equal(r.erro, 'faixa');
    assert.match(r.mensagem, /de 0 a 100/);
  });
}

console.log('volume relativo');
ok('+10 soma ao atual', () => assert.deepEqual(interpretaVolume('+10', 30), { alvo: 40, relativo: true, antes: 30 }));
ok('-10 subtrai', () => assert.deepEqual(interpretaVolume('-10', 30), { alvo: 20, relativo: true, antes: 30 }));
ok('relativo é LIMITADO à faixa, não recusado', () => {
  assert.equal(interpretaVolume('-20', 5).alvo, 0, 'abaixar mais do que dá = mudo');
  assert.equal(interpretaVolume('+50', 80).alvo, 100, 'subir mais do que dá = máximo');
  assert.equal(interpretaVolume('-999', 50).alvo, 0);
  assert.equal(interpretaVolume('+999', 50).alvo, 100);
});
ok('relativo sem saber o atual explica em vez de chutar', () => {
  for (const atual of [null, undefined, NaN, 'abc']) {
    const r = interpretaVolume('+10', atual);
    assert.equal(r.erro, 'sem_atual');
    assert.match(r.mensagem, /!volume 50/);
  }
});
ok('+0 e -0 não mudam nada', () => {
  assert.equal(interpretaVolume('+0', 42).alvo, 42);
  assert.equal(interpretaVolume('-0', 42).alvo, 42);
});

console.log('nada escrito e lixo');
ok('vazio pede para informar, não é erro', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(interpretaVolume(v, 30).erro, 'vazio');
});
ok('só o % vira "nada escrito" (o % é removido antes de ler o número)', () =>
  assert.equal(interpretaVolume('%', 30).erro, 'vazio'));
ok('texto não numérico ensina o uso', () => {
  for (const v of ['alto', 'abc', '++', '--', 'mais', '+', '-']) {
    const r = interpretaVolume(v, 30);
    assert.equal(r.erro, 'invalido', `${v} deveria ser inválido`);
    assert.match(r.mensagem, /!volume 50/);
  }
});
ok('placeholder do bot não substituído não vira volume', () => {
  for (const v of ['$(1)', '${1:}', '$(querystring)']) assert.equal(interpretaVolume(v, 30).erro, 'invalido');
});

console.log('a linha do chat');
ok('absoluto não mostra de onde veio', () => assert.equal(linhaDoVolume(50), '🔊 Volume: 50%'));
ok('relativo mostra o de → para', () => assert.equal(linhaDoVolume(40, 30), '🔊 Volume: 30% → 40%'));
ok('zero é mudo', () => {
  assert.equal(linhaDoVolume(0), '🔇 Volume no mudo.');
  assert.equal(linhaDoVolume(0, 30), '🔇 Volume no mudo.');
});
ok('só informar', () => {
  assert.equal(linhaDoVolumeAtual(55), '🔊 Volume atual: 55%. Use !volume 50 para mudar.');
  assert.match(linhaDoVolumeAtual(0), /mudo/);
  assert.match(linhaDoVolumeAtual(null), /Abra o Spotify/);
});

console.log('traduzir a recusa do Spotify');
ok('404 / sem dispositivo', () => {
  assert.equal(explicaErroDoVolume(404, '').motivo, 'sem_dispositivo');
  assert.equal(explicaErroDoVolume(403, 'No active device found').motivo, 'sem_dispositivo');
});
ok('403 é decidido pela MENSAGEM, nunca pelo status', () => {
  assert.equal(explicaErroDoVolume(403, 'Player command failed: Premium required').motivo, 'sem_premium');
  assert.equal(explicaErroDoVolume(403, 'Insufficient client scope').motivo, 'sem_escopo');
  assert.equal(explicaErroDoVolume(403, 'VOLUME_CONTROL_DISALLOW').motivo, 'sem_controle_de_volume');
  assert.equal(explicaErroDoVolume(403, 'Player command failed: Restriction violated').motivo, 'sem_controle_de_volume');
});
ok('dispositivo sem controle de volume tem frase própria', () =>
  assert.match(explicaErroDoVolume(403, 'VOLUME_CONTROL_DISALLOW').mensagem, /TV, alto-falante|navegador/));
ok('401 e 429', () => {
  assert.equal(explicaErroDoVolume(401, 'The access token expired').motivo, 'autorizacao');
  assert.equal(explicaErroDoVolume(429, '').motivo, 'limite');
});
ok('recusa desconhecida repassa o texto do Spotify', () => {
  const r = explicaErroDoVolume(400, 'Invalid volume');
  assert.equal(r.motivo, 'erro');
  assert.match(r.mensagem, /Invalid volume/);
});
ok('sem mensagem, ao menos o status', () =>
  assert.match(explicaErroDoVolume(500, '').mensagem, /HTTP 500/));

console.log(`\n${n} asserções passaram.`);
