/* extrair.js — CAMADA 0: quando o vetor JA EXISTE, extrair vence tracar.
 *
 * Esta e a operacao que produziu o melhor resultado da historia deste projeto: o icone do Hive
 * nao foi convertido de PNG nenhum — o path ja estava dentro de um SVG de logo completo, e o
 * trabalho foi localiza-lo, embutir os transforms dos ancestrais e recortar o viewBox na caixa
 * exata. Fidelidade absoluta, nao aproximada. Tracar um raster e o plano B.
 *
 * O que este modulo faz, dado um SVG e um elemento escolhido:
 *  - compoe a matriz do PAI ate a raiz (para nao perder posicao/escala do grupo em que ele vive);
 *  - copia so os <defs> alcancaveis por url(#...), transitivamente;
 *  - mede a caixa REAL com getBBox() no DOM (autoridade, nao estimativa) e recorta o viewBox;
 *  - denuncia dependencia de fonte: <text> nao e curva, e renderiza errado em quem nao tem a fonte.
 */

const DESENHAVEIS = 'path,rect,circle,ellipse,line,polyline,polygon,text,image,use,g';

export function carregaSvg(texto) {
  const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
  const erro = doc.querySelector('parsererror');
  if (erro) throw new Error('SVG invalido: ' + erro.textContent.slice(0, 200));
  const raiz = doc.documentElement;
  if (raiz.tagName.toLowerCase() !== 'svg') throw new Error('A raiz nao e <svg>.');
  return raiz;
}

/* Conteudo destes elementos NAO se desenha: e material de referencia. Um exportador do Office
 * enche o arquivo de <clipPath><rect/></clipPath>, e sem este filtro a lista oferecia os
 * retangulos de recorte como se fossem o desenho (medido: 4 dos 12 candidatos de um logo real). */
const NAO_DESENHA = 'defs,clipPath,mask,pattern,marker,symbol';

/** Elementos candidatos, com uma etiqueta legivel. Grupos entram porque a marca costuma ser
 *  um <g>; paths soltos tambem, porque as vezes ela e um path unico (foi o caso do Hive). */
export function candidatos(raizViva) {
  const out = [];
  raizViva.querySelectorAll(DESENHAVEIS).forEach((el, i) => {
    if (el.closest(NAO_DESENHA)) return;
    // cadeia de <g> de embrulho: um grupo de filho unico nao acrescenta escolha nenhuma,
    // so repete a mesma caixa varias vezes na lista
    if (el.tagName.toLowerCase() === 'g' && el.children.length === 1) return;
    let caixa = null;
    try { caixa = el.getBBox(); } catch { /* elemento sem geometria renderizada */ }
    if (!caixa || caixa.width <= 0 || caixa.height <= 0) return;
    const tag = el.tagName.toLowerCase();
    const filhos = el.querySelectorAll(DESENHAVEIS).length;
    out.push({
      el, i, tag, filhos, caixa,
      rotulo: tag + (el.id ? '#' + el.id : '') + (filhos ? ' (' + filhos + ' dentro)' : ''),
      dim: caixa.width.toFixed(1) + ' x ' + caixa.height.toFixed(1),
      area: caixa.width * caixa.height,
      texto: tag === 'text' || el.querySelector('text') != null,
    });
  });
  return out.sort((a, b) => b.area - a.area);
}

const fmt = (v, c = 4) => { const s = (+v).toFixed(c); return s.replace(/\.?0+$/, '') || '0'; };

function matrizAte(el, raiz) {
  // matriz que leva o espaco do usuario de `el` ate o da raiz
  const a = raiz.getScreenCTM(), b = el.getScreenCTM();
  if (!a || !b) return null;
  return a.inverse().multiply(b);
}

/** Ids alcancaveis a partir de um trecho de markup, seguindo url(#..)/href transitivamente. */
function defsNecessarias(raiz, markupInicial) {
  const vistos = new Set();
  let fila = [...markupInicial.matchAll(/url\(#([^)"']+)\)|(?:xlink:)?href\s*=\s*["']#([^"']+)["']/g)]
    .map((m) => m[1] || m[2]).filter(Boolean);
  while (fila.length) {
    const id = fila.pop();
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const alvo = raiz.querySelector('[id="' + CSS.escape(id) + '"]');
    if (!alvo) continue;
    fila.push(...[...alvo.outerHTML.matchAll(/url\(#([^)"']+)\)|(?:xlink:)?href\s*=\s*["']#([^"']+)["']/g)]
      .map((m) => m[1] || m[2]).filter(Boolean));
  }
  return vistos;
}

/** Extrai `alvo` como SVG independente, com viewBox recortado na caixa real. */
export function extrai(raizViva, alvo, opc = {}) {
  const { margem = 0, casas = 4, titulo = '' } = opc;
  const avisos = [];

  const pai = alvo.parentNode;
  const M = (pai && pai.getScreenCTM) ? matrizAte(pai, raizViva) : null;
  const tm = M ? `matrix(${fmt(M.a,6)} ${fmt(M.b,6)} ${fmt(M.c,6)} ${fmt(M.d,6)} ${fmt(M.e,6)} ${fmt(M.f,6)})` : null;

  const ids = defsNecessarias(raizViva, alvo.outerHTML);
  const defs = [...ids].map((id) => {
    const n = raizViva.querySelector('[id="' + CSS.escape(id) + '"]');
    return n ? n.outerHTML : '';
  }).filter(Boolean).join('');

  // mede no DOM: monta o SVG de saida de verdade, le a caixa, so depois fixa o viewBox
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tmp.setAttribute('style', 'position:absolute;left:-99999px;width:10px;height:10px');
  tmp.innerHTML = (defs ? '<defs>' + defs + '</defs>' : '') +
                  '<g id="__medir">' + (tm ? '<g transform="' + tm + '">' : '') +
                  alvo.outerHTML + (tm ? '</g>' : '') + '</g>';
  document.body.appendChild(tmp);
  const g = tmp.querySelector('#__medir');
  let cx;
  try { cx = g.getBBox(); } finally { /* remove abaixo */ }
  const caixa = { x: cx.x - margem, y: cx.y - margem, w: cx.width + margem * 2, h: cx.height + margem * 2 };
  document.body.removeChild(tmp);

  if (caixa.w <= 0 || caixa.h <= 0) throw new Error('O elemento escolhido nao tem area.');

  if (alvo.querySelector('text') || alvo.tagName.toLowerCase() === 'text') {
    const fontes = new Set();
    (alvo.tagName.toLowerCase() === 'text' ? [alvo] : [...alvo.querySelectorAll('text')])
      .forEach((t) => { const f = t.getAttribute('font-family'); if (f) fontes.add(f.split(',')[0].trim()); });
    avisos.push('Contem <text>, que NAO e curva: em qualquer maquina sem a fonte ' +
      (fontes.size ? '(' + [...fontes].join(', ') + ') ' : '') + 'o desenho renderiza com outro tipo. ' +
      'Para um asset de marca, converta o texto em contorno na origem.');
  }
  if (/<image\b/i.test(alvo.outerHTML)) {
    avisos.push('Contem <image>: ha raster embutido ou referenciado dentro deste SVG. ' +
      'A parte raster nao escala como vetor.');
  }
  const externos = [...alvo.outerHTML.matchAll(/url\((?!#)([^)]*)\)/g)].map((m) => m[1]);
  if (externos.length) avisos.push('Referencia recurso EXTERNO: ' + externos.slice(0, 3).join(', '));

  const corpo = (tm ? '<g transform="' + tm + '">' : '') + alvo.outerHTML + (tm ? '</g>' : '');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
    [fmt(caixa.x, casas), fmt(caixa.y, casas), fmt(caixa.w, casas), fmt(caixa.h, casas)].join(' ') +
    '" width="' + fmt(caixa.w, casas) + '" height="' + fmt(caixa.h, casas) + '"' +
    (titulo ? ' role="img" aria-label="' + titulo.replace(/"/g, '&quot;') + '"' : '') + '>' +
    (titulo ? '<title>' + titulo.replace(/</g, '&lt;') + '</title>' : '') +
    (defs ? '<defs>' + defs + '</defs>' : '') + corpo + '</svg>';

  return { svg, caixa, avisos, nDefs: ids.size };
}
