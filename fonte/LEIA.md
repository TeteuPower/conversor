# Vetorizador — fonte

O entregável é o `vetorizador.html` da pasta acima: **um arquivo, sem dependência externa**.
Abre com duplo clique, e nada sai da máquina — a imagem é processada no próprio navegador.

Estes fontes existem para poder MANTER e TESTAR. O HTML único é gerado a partir deles.

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
