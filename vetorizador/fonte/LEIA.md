# Vetorizador — fonte

O entregável é o `vetorizador.html` da pasta acima: **um arquivo, sem dependência externa**.
Abre com duplo clique, e nada sai da máquina — a imagem é processada no próprio navegador.

Estes fontes existem para poder MANTER e TESTAR. O HTML único é gerado a partir deles.

## Dois entregáveis, uma fonte

Estes módulos agora alimentam **duas** coisas:

1. o `vetorizador.html` de duplo clique, gerado pelo `montar.py`, exatamente como antes;
2. o conversor de arquivos deste repositório, que os importa DIRETO — sem cópia — como a engine
   de navegador do destino SVG. Ver [ARQUITETURA.md](../../ARQUITETURA.md).

Nada aqui sabe do conversor, e é assim que deve continuar: quem importa é quem se adapta. A única
concessão é `opc.aoAndar`, opcional, descrita abaixo.

### `opc.aoAndar(etapa, dentro, detalhe)`

Opcional. Quando dada, `vetorizar()` a chama com a etapa corrente (`analise`, `classes`, `camadas`,
`montagem`) e quanto dela já andou, de 0 a 1. Sem ela, o código se comporta exatamente como antes —
e é assim que o HTML de duplo clique roda.

Ela existe porque a vetorização leva de 1 a 4 segundos e a barra de progresso do conversor precisa
mostrar valor real, não animação inventada.

`node ferramentas/medir-vetorizador.mjs`, em arte chapada de 900 × 900, mediana de três passadas,
1765 ms no total:

| etapa | tempo | fração |
|---|---:|---:|
| `analise` | 16 ms | 1% |
| `classes` | 1584 ms | 90% |
| `camadas` | 167 ms | 9% |
| `montagem` | ~0 ms | 0% |

E dentro de `classes`, **1388 ms num único `ajustaPreenchimento`** — a tentativa de K=1, que
ajusta o preenchimento sobre a amostra inteira. É um bloco atômico: não há laço por onde relatar
de dentro dele. Quem for mexer em desempenho aqui: é esse o alvo, e ele vale 80% do tempo total.

**`aoAndar` não entra em nenhum tipo compartilhado**, de propósito. As opções de um trabalho de
servidor atravessam JSON, e uma função ali quebraria a serialização.

## Gerar o app

    python3 montar.py . ../vetorizador.html

O `montar.py` tira os `import`/`export`, concatena no mesmo escopo e **falha** se dois módulos
declararem o mesmo nome (o risco real de concatenar módulos).

## Os módulos, na ordem em que o dado atravessa

| arquivo             | responsabilidade |
|---------------------|------------------|
| `contorno.js`       | campo de cobertura → contorno subpixel (marching squares no nível 0,5) |
| `curvas.js`         | polilinha densa → Béziers (detecção de canto + ajuste de Schneider) |
| `preenchimento.js`  | pixels de uma região → cor chapada, gradiente linear ou radial |
| `vetorizar.js`      | orquestra: análise, escolha de K pelo resíduo, paleta, montagem do SVG |
| `extrair.js`        | camada 0: quando o arquivo JÁ é vetor, extrair o elemento em vez de traçar |
| `app-fonte.html`    | interface + medição de fidelidade (rasteriza a saída e compara) |

## Mesas de teste

- `node --input-type=module -e "..."` — testes de unidade geométricos (círculo, quadrado, estrela).
- `lote.html`, `foto.html`, `teste.html` — rodam em Chromium headless; esperam as imagens de
  teste na mesma pasta (`logo.png`, `hive-logo.png`, `logofull_light.png`, `agent-bee.png`, …).
- `e2e.cjs` — dirige o app com Playwright de ponta a ponta:

      LD_LIBRARY_PATH=<libs> APP=<caminho do html> PW=<node_modules com playwright> node e2e.cjs

## Por que as decisões são as que são

Cada escolha não óbvia está comentada NO CÓDIGO, junto ao trecho que ela governa, com o caso
medido que a motivou. As quatro que mais custaram:

1. **Contorno vem de campo contínuo, não de máscara binária** — máscara dá escada de 1px; o
   antisserrilhado da entrada carrega a posição real da borda (erro radial medido: 0,04px).
2. **O número de classes de cor (K) é decidido pelo resíduo do modelo**, não por opção. Antes a
   silhueta inteira recebia UM preenchimento, e uma colmeia preta sobre círculo amarelo virava a
   cor média — desvio de 185/255. Em 7 imagens reais, 5 caíam nisso.
3. **O descarte de pixel de costura é espacial, não por proximidade de cor.** O critério por cor
   descartava a maioria dos pixels de uma ilustração sombreada, e o resíduo saía otimista
   (reportava 3,2 e errava 23).
4. **Dois portões de aceitação: p95 E p99.** Só o p95 aceitava modelo errado — um radial de 10
   paradas "explicando" dois blocos de cor separados, com o erro escondido na cauda.
