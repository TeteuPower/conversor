#!/usr/bin/env python3
"""Monta o app de arquivo unico a partir dos modulos.

Os modulos existem para poder TESTAR (mesa em Node e no navegador headless); o entregavel e um
HTML unico que abre com duplo clique, sem servidor, sem npm, sem CDN. Este script e a ponte:
tira `import`/`export` e concatena tudo dentro do mesmo escopo de modulo.
"""
import re, sys, pathlib

base = pathlib.Path(sys.argv[1])
saida = pathlib.Path(sys.argv[2])
ORDEM = ['contorno.js', 'curvas.js', 'preenchimento.js', 'vetorizar.js', 'extrair.js']

def limpa(txt):
    txt = re.sub(r'^\s*import\s+[^;]*?;\s*$', '', txt, flags=re.M)   # imports entre modulos
    txt = re.sub(r'^export\s+', '', txt, flags=re.M)                  # export function/const
    return txt.strip()

nucleo = []
for nome in ORDEM:
    corpo = limpa((base / nome).read_text(encoding='utf-8'))
    nucleo.append(f'/* ==================== {nome} ==================== */\n{corpo}')
nucleo = '\n\n'.join(nucleo)

html = (base / 'app-fonte.html').read_text(encoding='utf-8')
# troca as duas linhas de import do app pelo nucleo inteiro
alvo = ("import { vetorizar, analisa } from './vetorizar.js';\n"
        "import { carregaSvg, candidatos, extrai } from './extrair.js';")
assert alvo in html, 'nao achei os imports do app'
html = html.replace(alvo, nucleo)

# checa colisao de nomes no escopo unico (o risco real de concatenar modulos)
decls = {}
for m in re.finditer(r'^(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)', html, flags=re.M):
    decls.setdefault(m.group(1), 0)
    decls[m.group(1)] += 1
dup = {k: v for k, v in decls.items() if v > 1}
if dup:
    print('COLISAO DE NOMES no escopo unico:', dup, file=sys.stderr)
    sys.exit(1)

cab = ('<!-- Vetorizador — arquivo unico, sem dependencia externa.\n'
       '     Gerado por montar.py a partir dos modulos: ' + ', '.join(ORDEM) + ' + app-fonte.html.\n'
       '     Abra com duplo clique. Nada sai desta maquina: a imagem e processada no proprio navegador. -->\n')
# `newline` fixo em LF, e nao o padrao da plataforma.
#
# Sem isto, no Windows o Python traduz cada \n em \r\n na gravacao, e o arquivo
# sai com CRLF enquanto o .gitattributes manda o repositorio guardar LF. O conteudo fica
# identico — o `git diff` normaliza e a CI aprova —, mas o `git status` marca o entregavel
# como modificado depois de todo `npm run vetorizador`, sem que nada tenha mudado. Arquivo
# sujo por engano ensina a ignorar a sujeira, e um dia a de verdade passa junto.
saida.write_text(cab + html, encoding='utf-8', newline='\n')
print(f'{saida.name}: {saida.stat().st_size} bytes, {len(html.splitlines())} linhas')
print('nomes no escopo unico:', len(decls), '| colisoes: 0')
