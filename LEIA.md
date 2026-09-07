# Conversor

Conversor de arquivos que roda na sua máquina. Nenhum arquivo é enviado para a internet — dá para
conferir desligando a rede: tudo continua funcionando.

A forma vem do [Convertio](https://convertio.co/pt/), que é uma boa forma: solta os arquivos,
escolhe o formato de saída por família, baixa. O que muda é o que está por baixo.

| | Convertio | aqui |
|---|---|---|
| onde o arquivo vai | para o servidor deles | para lugar nenhum |
| destino que não existe | não aparece na lista | aparece em cinza, com o motivo |
| o que cada formato é | você já tem de saber | uma linha explicando, no seletor |
| barra de progresso | anda por conta própria | valor real da engine, em todo instante |
| teto por arquivo | 1 GB (grátis) | 2 GB (o limite é a memória, não o plano) |
| a saída fica | 24 h no servidor deles | 2 h no temporário da sua máquina |

## Começar

Precisa de **Node 20.11 ou mais novo**. Nada além disso: as engines vêm pelo `npm install`.

```
npm install
npm run build
npm start
```

Abre <http://localhost:7666>.

Para desenvolver, `npm run dev` — sobe a compilação de tipos, o servidor e o Vite juntos, com a
saída dos três num terminal só. A interface fica em <http://localhost:7665>, com recarga a quente.

A porta pode ser trocada: `CONVERSOR_PORTA=7667 npm start`.

## O que dá para converter hoje

**Imagem**, entre si — PNG, JPEG, WebP, AVIF, GIF, TIFF — e **imagem para SVG**, pelo vetorizador.
São 48 conversões. A tela inicial lista exatamente quais, lidas da sua instalação, e não de uma
tabela escrita à mão.

O resto das famílias — documento, áudio, vídeo, e-book, compactado, fonte, CAD — está declarado no
seletor, desabilitado, com o marco em que chega. Ver [ARQUITETURA.md](ARQUITETURA.md#os-marcos).

Duas conversões merecem nota:

- **para SVG** é o [vetorizador](vetorizador/fonte/LEIA.md), e ele roda no NAVEGADOR. O arquivo não
  atravessa nem o localhost. Ele traça o contorno a partir do campo de cobertura, ajusta Béziers,
  e escolhe o número de classes de cor pelo resíduo do modelo de pintura — não por opção. Recusa
  imagem fotográfica, e a recusa está certa: o SVG sairia maior que o original e com menos detalhe.
- **para HEIC** não existe, e não é esquecimento: escrever HEIC precisa do codificador HEVC, que
  não vem no pacote binário do sharp por causa de patente. Ler HEIC funciona.

## As duas coisas que este projeto leva a sério

### A barra de progresso não mente

Essa é a regra da casa, e ela custa código. Barra que anda sozinha num timer, chega a 90% e trava
esperando o fim é pior que barra nenhuma: ela mente sobre quanto falta e gasta a confiança do
usuário na próxima vez.

Aqui toda engine declara suas etapas com um peso cada, medido, e informa apenas quanto andou
DENTRO da etapa corrente. Três garantias saem disso:

1. **Não anda para trás.** Relato fora de ordem — acontece com trabalho paralelo — devolve a maior
   fração já vista, não a recém-calculada.
2. **100% quer dizer "pronto para baixar".** A fração fecha em 0,999 pelas etapas; o 1 só aparece
   junto com o arquivo, no mesmo quadro.
3. **O que a interface mostra e o que o leitor de tela anuncia são o mesmo número.**

O movimento é o único enfeite, e ele é honesto: a barra DESLIZA até o valor real em 760 ms, e o
brilho que atravessa não carrega quantidade — ele só diz "estou trabalhando", que é o que uma
fração parada não consegue dizer. A transição atrasa a barra em relação à verdade; nunca a adianta.

Isso é verificado, não prometido: `npm run e2e` amostra a barra a cada 25 ms em conversões reais e
falha se o valor cair uma vez, ou se chegar a 100 antes de o botão de baixar existir.

### Nada sai da máquina, e é conferível

- A página não referencia domínio externo nenhum. Sem CDN, sem fonte da web, sem analytics. O
  teste de ponta a ponta falha se qualquer requisição sair de localhost.
- O servidor escuta só em `127.0.0.1` **e** exige `Host: localhost`. Só a primeira metade não
  bastaria: por religação de DNS, um site aberto noutra aba apontaria um domínio dele para
  127.0.0.1 e conversaria com este servidor pelo seu navegador.
- Metadados (EXIF, GPS, perfil de cor) são removidos por padrão. Quem converte para publicar não
  espera publicar onde a foto foi tirada.
- A entrada e a saída ficam no temporário do sistema e se apagam sozinhas em 2 h, inclusive o que
  sobrou de uma execução interrompida.

## Como o repositório é dividido

```
nucleo/       o contrato entre os dois lados, o catálogo de formatos e o cálculo de progresso
servidor/     HTTP, fila de trabalhos, registro de engines
web/          a interface (React + Vite)
vetorizador/  o vetorizador, e o vetorizador.html de duplo clique que sai dele
e2e/          o teste de ponta a ponta, num navegador de verdade
ferramentas/  o orquestrador do npm run dev
```

O `vetorizador/` é o projeto que veio antes deste e continua entregando o próprio produto: um HTML
único, sem dependência, que abre com duplo clique. A interface nova importa os módulos dele
**direto**, sem cópia — então uma correção no traçado de contorno chega aos dois entregáveis no
mesmo commit. Ver [vetorizador/fonte/LEIA.md](vetorizador/fonte/LEIA.md).

## Comandos

| comando | o que faz |
|---|---|
| `npm run dev` | tipos, servidor e Vite juntos, num terminal |
| `npm run build` | compila tudo |
| `npm start` | sobe o servidor servindo a interface compilada |
| `npm run teste` | os testes de unidade dos três pacotes |
| `npm run e2e` | o teste de ponta a ponta, num navegador (precisa do servidor no ar) |
| `npm run tipos` | só a checagem de tipos |
| `npm run vetorizador` | regera o `vetorizador.html` de duplo clique a partir dos módulos |
| `npm run medir-pesos -w servidor` | recalibra os pesos das etapas nesta máquina |

## Acrescentar uma engine

Um arquivo em `servidor/src/engines/` e uma linha em `todas.ts`. A engine responde três coisas:
se está disponível nesta máquina, quais pares origem→destino ela faz, e como converter relatando
o progresso. O detalhe está em [ARQUITETURA.md](ARQUITETURA.md#acrescentar-uma-engine).

## Licença

MIT.
