# Arquitetura

Este documento explica as decisões que o código não consegue explicar sozinho — as que dependem de
um "por que não do outro jeito". As decisões locais estão comentadas no próprio código, junto ao
trecho que elas governam, e é lá que devem continuar.

## O caminho de um arquivo

```
   solta o arquivo
        │
        ▼
   formatoDoNome()  ──►  Grafo.destinoSugerido()  ──►  cartão na fila
        │                                                   │
        │                                          ┌─────────┴─────────┐
        │                                          │                   │
        ▼                                    engine no             engine no
   (nada sai daqui)                          NAVEGADOR              SERVIDOR
                                                  │                   │
                                            worker do            POST /trabalhos
                                            vetorizador          PUT  /entrada  (bytes, progresso de envio real)
                                                  │              GET  /eventos  (SSE, progresso da conversão)
                                                  │                   │
                                                  └─────────┬─────────┘
                                                            ▼
                                                   Progresso (núcleo)
                                                   fração global monotônica
                                                            ▼
                                                   redutor da fila  ──►  barra
```

## Por que existe um servidor

O escopo é o do Convertio: mais de cem formatos, dez famílias. Isso não cabe no navegador.

Uma versão só com WASM foi considerada e recusada: ffmpeg.wasm são dezenas de megabytes de
download, vídeo grande fica de três a dez vezes mais lento, e famílias inteiras ficariam de fora —
`docx → pdf` precisa do LibreOffice, e não existe LibreOffice em WASM que preste. Um servidor em
`localhost` mantém a promessa que importa (o arquivo não sai da máquina) e abre a porta para
engine nativa.

O que é bom no navegador continua no navegador. Ver [a divisão](#a-divisão-entre-navegador-e-servidor).

## A barra de progresso

É o eixo do projeto, e o que mais decidiu forma de código. A regra: **a barra não mente.**

### O cálculo

`Progresso`, em `nucleo/src/progresso.ts`. Cada engine declara etapas com peso, e relata só quanto
andou dentro da etapa corrente. Duas garantias que o tipo não dá:

- **Monotonia.** Um relato fora de ordem devolve a maior fração já vista. Barra que anda para trás
  parece defeito mesmo quando o número está certo.
- **O 1 é do fim, não do progresso.** As etapas fecham em 0,999; o 1 só sai de `conclui()`. Assim a
  interface pode confiar que 100% significa "pronto para baixar", e não "a última etapa acabou e
  ainda falta gravar em disco".

### Os pesos são medidos

Pesos iguais fariam a barra correr até 75% e ficar parada os 1,6 s do AVIF: tecnicamente correta,
péssima de olhar. Então eles saem de medição, e a medição está no repositório.

`npm run medir-pesos -w servidor`, nesta máquina (sharp 0.33.5 / libvips 8.15.3, imagem de prova
1600 × 1200):

| destino | tempo | peso |
|---|---:|---:|
| AVIF | 1609 ms | 57 |
| GIF | 900 ms | 32 |
| PNG | 703 ms | 25 |
| JPEG | 140 ms | 5 |
| WebP | 129 ms | 5 |
| TIFF | 28 ms | 1 |

Duas coisas que o palpite errava: a razão entre extremos é 57x, e GIF e PNG são caros por causa da
**quantização de cor**, não da compressão. Eu tinha estimado 4 e 5 para eles.

O vetorizador tem a mesa própria, `node ferramentas/medir-vetorizador.mjs`. Em arte chapada de
900 × 900, mediana de três passadas, 1765 ms no total:

| etapa | tempo | fração |
|---|---:|---:|
| análise | 16 ms | 1% |
| escolha de classes | 1584 ms | 90% |
| camadas | 167 ms | 9% |
| montagem | ~0 ms | 0% |

A proporção muda com o tamanho — `classes` vai de 94% em 400 × 400 a 73% em 1800 × 1800 —, e os
pesos no worker puxam para a imagem GRANDE, não para a média: com `camadas` subvalorizado, a barra
de uma imagem grande salta de 92% a 100% no fim, e é justamente nela que a espera é longa.

Dentro da escolha de classes, **1388 ms num único `ajustaPreenchimento`** — a tentativa de K=1,
que ajusta o preenchimento sobre a amostra inteira. É um bloco atômico, sem laço por onde relatar
de dentro. É por isso que a barra fica parada ali por mais de um segundo, com o brilho de
atividade cobrindo a espera, e não por descuido. Quem for otimizar o vetorizador: é esse o alvo,
e vale 80% do tempo total.

### O movimento

Em `web/src/estilo/movimento.css`. A transição de 760 ms desliza até o valor real; ela atrasa a
barra em relação à verdade, nunca a adianta — a barra pode mostrar 60% quando o real já é 98%, e
nunca o contrário. `transform: scaleX` e não `width`, para a escala rodar na composição sem refluir
o cartão a cada evento.

### O que já quebrou

Três bugs de honestidade, todos pegos pelo teste de ponta a ponta e nenhum por teste de unidade:

1. `aoAndar` chamava `conclui()` antes de a saída existir. São dois commits do React, e o de trás
   mostrava 100% sem botão de baixar. Hoje quem fecha em 1 é a ação `conclui` do redutor, que grava
   fração e saída juntas.
2. `aria-valuenow` usava `Math.round`, que leva 0,999 a 100. Quem lia a tela via 99% e quem usava
   leitor de tela ouvia 100%. Hoje os dois saem de `percentualInteiro`.
3. A fila do servidor emitia `{fracao: 1, etapa: 'fim'}` antes do evento `concluido`. O cliente
   aparava por conta própria, mas consertar no consumidor um contrato torto na origem é remendo.

## O grafo de conversões

`nucleo/src/grafo.ts`. Três perguntas: quais destinos existem para esta origem, este destino está
disponível, e se não está, por quê.

### Catálogo e grafo são coisas diferentes

O **catálogo** (`formatos.ts`) diz o que um formato É — mais de cem formatos, dez famílias,
inclusive o que nenhuma engine converte ainda. O **grafo** (as arestas) diz o que dá para fazer
agora, e é montado no servidor a partir do que cada engine declara suportar E do que a detecção
confirmou existir na máquina.

São perguntas diferentes, e separá-las é o que permite mostrar o destino desabilitado com o motivo.

### Um salto só, de propósito

Não há busca de caminho com mais de um salto. `heic → png → svg` parece atraente no papel, mas cada
salto perde alguma coisa, e o usuário levaria a culpa por uma escolha que a aplicação fez
escondida. Quando uma cadeia dessas valer a pena, ela entra como aresta explícita, com nome e
diagnóstico próprios.

### Destino indisponível aparece

Quem chega procurando MP4 → MP3 precisa de uma resposta. "Chega no marco 3" é uma resposta; uma
aba de áudio ausente faz a pessoa concluir que a aplicação não serve e fechar. `MotivoAusencia`
carrega essa informação até a tela, com o comando de instalação quando é o caso.

O que NÃO aparece é família sem nenhuma aresta: de um PNG, o seletor mostra Imagem, Vetor e
Documento, e nada mais. Uma aba de áudio ali seria ruído — não existe PNG para MP3, nem aqui nem
no Convertio.

## A divisão entre navegador e servidor

`Onde = 'navegador' | 'servidor'`, no contrato.

O vetorizador é a única engine de navegador hoje, e por três motivos:

1. É JavaScript puro sobre um array de pixels, sem biblioteca nativa. Não há o que instalar.
2. O arquivo não atravessa nem o localhost, e o resultado aparece sem ida e volta pela rede.
3. É o mesmo código do `vetorizador.html` de duplo clique. Uma fonte de verdade só — os módulos são
   importados direto de `vetorizador/fonte/` por apelido do Vite, sem cópia.

Ele **precisa** de um worker: 1,8 s de laço apertado sem ponto de espera na thread principal
congelaria a interface justamente durante a espera, que é quando a suavidade mais importa. E
cancelar é `terminate()`, não uma bandeira que o laço consulte — o laço não volta ao laço de
eventos para lê-la.

## Detecção de engine

A engine **pergunta** o que a máquina tem, em vez de assumir. Isto não é preciosismo: o pacote
binário do sharp muda de suporte entre versões e plataformas. Nesta instalação, o libvips **não lê
BMP** e **não escreve** jp2, jxl nem ppm. Uma lista fixa daria ao usuário um destino que falha
depois de ele escolher e esperar — o pior dos dois mundos.

E a sonda tem uma armadilha conhecida: AVIF e HEIC dividem o carregador `heif`, então
`sharp.format.heif.output` responde `true` para os dois, mas escrever HEIC responde
`heifsave: Unsupported compression`. Daí a lista `SEM_ESCRITA` em `imagem.ts`.

Do lado do navegador, a sonda decodifica uma amostra de 1 × 1 de cada formato antes de oferecê-lo.
Ela tem um **canário**: se a amostra de PNG não decodificar, o defeito está na sonda e não no
navegador, e aí ela aceita tudo em vez de recusar tudo. Isso existe porque o contrário aconteceu —
amostras base64 malformadas fizeram a sonda remover três conversões que funcionavam, em silêncio.

A detecção roda **uma vez**, ao subir o servidor. Instalar o LibreOffice com o servidor no ar não é
notado até reiniciar; é o preço certo, e a tela de engines diz que a detecção é do momento em que o
servidor subiu.

## O protocolo

```
GET    /api/capacidades              formatos, engines, arestas, limites
GET    /api/saude                    ocupação da fila
POST   /api/trabalhos                {nome, tamanho, de, para, opcoes} → {id}
PUT    /api/trabalhos/:id/entrada    os bytes
GET    /api/trabalhos/:id/eventos    SSE: etapas, progresso, aviso, concluido, falhou
GET    /api/trabalhos/:id/saida      o arquivo convertido
DELETE /api/trabalhos/:id            cancela e apaga
```

**Por que o `POST` não recebe o arquivo junto.** Ter o id antes de os bytes subirem é o que permite
abrir o canal de eventos já durante o envio. Se o id só chegasse depois, a barra não teria o que
mostrar na parte demorada de um arquivo grande.

**Por que SSE e não WebSocket.** O fluxo é de mão única, reconecta sozinho e passa por qualquer
intermediário sem negociação. WebSocket traria um protocolo a mais para não usar a volta.

**Por que a interface lê o SSE com `fetch` e não com `EventSource`.** `EventSource` reconecta
sozinho quando o servidor fecha a conexão — e o servidor fecha de propósito ao concluir. Seria uma
reconexão por trabalho terminado, cada uma reproduzindo o histórico inteiro. Também não há como
cancelá-lo por `AbortSignal`.

**Por que o envio é XHR e não `fetch`.** `fetch` não relata progresso de envio. `ReadableStream`
como corpo existe, mas exige HTTP/2 e não é aceito em todo navegador. `XMLHttpRequest` tem
`upload.onprogress` desde sempre.

## A fila

`servidor/src/fila.ts`.

**Os eventos ficam guardados, não só transmitidos.** A interface cria o trabalho, manda os bytes e
só então abre o canal — e uma conversão rápida termina nesse intervalo. Quem se inscreve recebe o
histórico primeiro, e **sincronamente**: assíncrono deixaria um evento ao vivo furar a fila e
chegar antes das etapas. É também o que faz o F5 no meio de uma conversão funcionar.

**Cancelar cancela.** O `AbortSignal` chega à engine. Sem isso, cancelar só esconderia o cartão
enquanto a máquina segue queimando CPU.

**Paralelismo de núcleos − 1, com teto de 4.** O "menos um" é porque o usuário está usando esta
máquina para outra coisa também: ocupar todos os núcleos faria a conversão terminar um pouco antes
e o resto do computador engasgar enquanto isso. O teto de 4 é por memória.

No navegador o limite é **2** vetorizações: com quatro workers girando, a thread principal disputa
núcleo com eles e a animação da barra começa a pular.

## Segurança

O modelo de ameaça de uma aplicação local não é o de um servidor exposto, mas não é vazio.

**Religação de DNS.** Escutar em `127.0.0.1` é tratado como suficiente e não é: um site aberto
noutra aba pode apontar um domínio dele para 127.0.0.1 e conversar com este servidor pelo navegador
do usuário — com acesso aos arquivos que ele estiver convertendo. O que barra é exigir
`Host: localhost`; o domínio do atacante chega no `Host` como o domínio dele.

**Travessia de caminho.** Nenhum caminho vem de fora. O id da URL é validado como UUID antes de
encostar num caminho, com checagem de contenção como segunda tranca. O nome que o usuário mandou só
batiza o download — em disco, o arquivo se chama pelo id do trabalho. Então `../../.ssh/id_rsa` não
tem por onde virar caminho.

**Injeção de cabeçalho.** `nomeSeguro` tira controle e DEL do nome antes de ele ir para o
`Content-Disposition`, e troca os reservados do Windows. Acento é preservado, com `filename*` em
UTF-8 e um `filename` ASCII de reserva.

**Aresta reconferida no servidor.** A interface é a nossa, mas a API é acessível e uma versão dela
em cache pode oferecer um par que já não existe.

## Os marcos

O marco 1 está entregue: imagem e o vetorizador, ponta a ponta — interface, fila, engine,
progresso, download, testes.

| marco | o que entra | engine |
|---|---|---|
| 2 | documento, planilha, apresentação, PDF | LibreOffice, Ghostscript, pdfium |
| 3 | áudio e vídeo | ffmpeg |
| 4 | e-book, compactado, fonte | Calibre, 7-Zip, fontTools |
| 5 | CAD e 3D, OCR | Open Design, assimp, Tesseract |

Estão declarados em `servidor/src/engines/porVir.ts`, e é de lá que sai o "chega no marco N" que o
seletor mostra. Quando uma engine de verdade entra, ela sai daquele arquivo e passa a ser listada
em `todas.ts`; as arestas reais têm precedência sobre as declaradas.

O ffmpeg é o que vai fazer a barra brilhar: ele relata quadro por quadro, então lá o progresso fica
fino de verdade.

## Acrescentar uma engine

Um arquivo em `servidor/src/engines/` exportando um `Engine`, e uma linha em `ENGINES` em
`todas.ts`. A interface do contrato está em `registro.ts` e pede três coisas:

```ts
detecta()            // estou disponível nesta máquina? roda uma vez, ao subir
arestas(deteccao)    // que pares origem→destino eu faço, DADO o que a detecção achou
converte(t, relata)  // faça, relatando o progresso
```

O que costuma dar errado, e vale ler antes:

- **`arestas` recebe a detecção de propósito.** Não basta o ffmpeg existir; ele precisa ter sido
  compilado com o codec. Engine presente mas sem suporte devolve a aresta com `disponivel: false` e
  o motivo, em vez de omiti-la.
- **`relata.etapas()` vem primeiro, uma vez.** Depois, `relata.andou(etapa, dentro)` só diz quanto
  andou dentro da etapa corrente. A fração global é calculada fora, e é lá que ficam as garantias.
- **Os pesos precisam ser medidos.** Copie o padrão de `medir-pesos.ts`.
- **Escute o `sinal`.** Toda engine que chama processo externo ou faz laço longo tem obrigação de
  escutar o `AbortSignal`, ou cancelar na interface só esconde o trabalho em vez de pará-lo.
- **`ErroDeEntrada` quando a culpa é do arquivo ou da opção.** A mensagem dele vai direto para o
  usuário. Qualquer outra exceção é tratada como bug nosso, e a mensagem diz isso — "arquivo
  inválido" quando o defeito é do nosso código manda o usuário procurar problema onde não tem.

## Testes

| onde | o que cobre |
|---|---|
| `nucleo/src/*.teste.ts` | monotonia do progresso, catálogo, formatação |
| `servidor/src/*.teste.ts` | fila, cancelamento, travessia de caminho, nome de arquivo |
| `web/src/**/*.teste.ts` | o redutor da fila: relato atrasado, reabertura, média ponderada |
| `e2e/fluxo.mjs` | o fluxo inteiro num navegador de verdade |

O teste de ponta a ponta é o que prova o que nenhum teste de unidade prova: a fração atravessa três
fronteiras — engine, SSE, redutor — antes de virar pixel, e é em qualquer uma delas que a ordem se
perde. Ele amostra a barra a cada 25 ms e falha se o valor cair uma vez, ou se chegar a 100 antes
de o arquivo estar pronto. Também falha se qualquer requisição sair de localhost.

Os três bugs de honestidade listados acima foram pegos por ele, e um deles de forma intermitente —
que é o modo mais fácil de um bug desses passar por revisão.

O vetorizador tem as mesas de teste próprias dele, anteriores a este projeto:
[vetorizador/fonte/LEIA.md](vetorizador/fonte/LEIA.md).
