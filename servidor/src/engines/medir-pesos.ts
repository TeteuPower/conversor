/**
 * Mede o custo relativo de cada etapa da engine de imagem.
 *
 *     npm run medir-pesos --workspace=servidor
 *
 * A saída vai para `PESO_CODIFICACAO` em `imagem.ts`. Rodar de novo quando trocar de versão do
 * sharp ou de máquina — os números mudam de máquina para máquina, mas as PROPORÇÕES, que é o que
 * a barra usa, se mantêm.
 *
 * A imagem de prova é sintética de propósito: um degradê com um bloco chapado e um pedaço de
 * ruído. Foto pura enganaria os codificadores sem perda para cima (ruído não comprime) e arte
 * chapada os enganaria para baixo. A mistura fica no meio, que é onde vive o arquivo real.
 */
import sharp from 'sharp';

const L = 1600;
const A = 1200;

async function imagemDeProva(): Promise<Buffer> {
  const px = Buffer.alloc(L * A * 3);
  let semente = 12345;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const i = (y * L + x) * 3;
      if (x > L * 0.6 && y > A * 0.6) {
        // ruído: o pior caso dos codificadores sem perda
        px[i] = px[i + 1] = px[i + 2] = Math.floor(rnd() * 256);
      } else if (x < L * 0.25 && y < A * 0.25) {
        px[i] = 0x2f; // bloco chapado: o melhor caso
        px[i + 1] = 0x6f;
        px[i + 2] = 0xff;
      } else {
        px[i] = Math.floor((x / L) * 255); // degradê
        px[i + 1] = Math.floor((y / A) * 255);
        px[i + 2] = 0x80;
      }
    }
  }
  return sharp(px, { raw: { width: L, height: A, channels: 3 } }).png().toBuffer();
}

const CODIFICADORES: Record<string, (s: sharp.Sharp) => sharp.Sharp> = {
  jpg: (s) => s.jpeg({ quality: 82, mozjpeg: true }),
  tiff: (s) => s.tiff({ compression: 'lzw' }),
  gif: (s) => s.gif(),
  png: (s) => s.png({ compressionLevel: 9, palette: true }),
  webp: (s) => s.webp({ quality: 82, effort: 4 }),
  jp2: (s) => s.jp2({ quality: 82 }),
  jxl: (s) => s.jxl({ quality: 82 }),
  avif: (s) => s.avif({ quality: 82, effort: 4 }),
};

/** Mediana de 3, e não média: um pico de escalonamento do sistema não deve virar o resultado. */
async function mede(f: () => Promise<unknown>, vezes = 3): Promise<number> {
  const t: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const ini = performance.now();
    await f();
    t.push(performance.now() - ini);
  }
  return t.sort((a, b) => a - b)[Math.floor(vezes / 2)]!;
}

async function principal(): Promise<void> {
  console.log(`sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`);
  console.log(`imagem de prova: ${L} × ${A}\n`);
  const prova = await imagemDeProva();

  const decodificar = await mede(() => sharp(prova).raw().toBuffer());
  const transformar = await mede(() =>
    sharp(prova).rotate().resize({ width: 1200, fit: 'inside' }).raw().toBuffer(),
  );

  const custos: Record<string, number> = {};
  for (const [nome, aplica] of Object.entries(CODIFICADORES)) {
    try {
      custos[nome] = await mede(() => aplica(sharp(prova)).toBuffer());
    } catch {
      console.log(`  ${nome.padEnd(5)} — este libvips não escreve`);
    }
  }

  // A unidade é o codificador mais barato disponível: dá números pequenos e legíveis, e o peso
  // fica independente da velocidade absoluta da máquina.
  const base = Math.min(...Object.values(custos));
  const peso = (ms: number) => Math.max(1, Math.round(ms / base));

  console.log('\n--- PESO_CODIFICACAO (cole em imagem.ts) ---');
  const ordenados = Object.entries(custos).sort((a, b) => b[1] - a[1]);
  for (const [nome, ms] of ordenados) {
    console.log(`  ${nome}: ${peso(ms)},`.padEnd(18) + `// ${ms.toFixed(0)} ms`);
  }
  console.log('\n--- as outras etapas ---');
  console.log(`  PESO_DECODIFICACAO = ${peso(decodificar)}`.padEnd(30) + `// ${decodificar.toFixed(0)} ms`);
  console.log(
    `  PESO_TRANSFORMACAO = ${peso(Math.max(1, transformar - decodificar))}`.padEnd(30) +
      `// ${(transformar - decodificar).toFixed(0)} ms além da decodificação`,
  );
  console.log(`\nrazão entre o mais caro e o mais barato: ${peso(ordenados[0]![1])}x`);
  console.log('É por isso que os pesos não podem ser iguais.');
}

await principal();
