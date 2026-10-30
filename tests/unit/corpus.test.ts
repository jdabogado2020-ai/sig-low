// T-CO-01 a T-CO-05 y T-GO-01 · corpus de documentos ficticios y su anotación gold (10.1, 10.2).
// Las pruebas públicas leen los archivos ya generados (corpus/docs, corpus/gold, corpus/MANIFIESTO.json) y no ejecutan el generador,
// que es privado. Los validadores de abajo son copias independientes de la especificación (7.2.2): el gold no depende de src/core/rules.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_TYPES, FLAG_TYPES, ROLES } from '../../src/core/types.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = join(RAIZ, 'corpus');
const FICCION = 'Documento ficticio para pruebas de Sig-Low.';
const ANIO_ACTUAL = 2026;

// ---------- Tipos locales del gold (10.2.1) ----------
interface GoldAnn {
  id: string; docId: string; parte: { kind: string; index: number; page?: number }; start: number; end: number; texto: string;
  tipo: string; rol?: string; entidad: string; debe_generalizarse: boolean; generalizacion?: string; es_negativo_esperado: boolean;
  bandera_esperada?: string; estructura: string; enLista: boolean; claseVariante?: string; rotulado: boolean; contenidaEn?: string; caracteristicas: string[];
}
interface GoldEnt { id: string; tipo: string; rol?: string; canonico: string; mismoTitular: string[]; enLista: boolean }
interface Gold {
  formato: string; v: number; docId: string; tipoDocumento: string; fuente: string; archivo: string; conjunto: string; semilla: string;
  esperado: { partes: Array<{ kind: string; index: number; page?: number; longitud: number; sha256: string }>; advertencias: string[]; metadatos: string[]; error?: string };
  listaDelCaso: Array<{ name: string; role: string }>; entidades: GoldEnt[]; anotaciones: GoldAnn[];
  revision: { estado: string; discrepancias: number; cambios: string[] };
}
interface TextoJson {
  formato: string; v: number; docId: string;
  partes: Array<{ kind: string; index: number; page?: number; texto: string }>;
  estructura?: Array<{ parte: { kind: string; index: number }; bloques: Array<{ tipo: string; variante?: string; instr?: string; start: number; end: number }> }>;
  pdf?: { dosColumnas: boolean };
  paginasEscaneadas?: Array<{ page: number; lineas: string[] }>;
}

const sha = (d: string | Uint8Array): string => createHash('sha256').update(d).digest('hex');
const leerJson = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, 'utf8')) as T;

const IDS = existsSync(join(CORPUS, 'gold'))
  ? readdirSync(join(CORPUS, 'gold')).filter((f) => /^C\d\d\.json$/.test(f)).map((f) => f.slice(0, 3)).sort()
  : [];
const golds = new Map<string, Gold>(IDS.map((id) => [id, leerJson<Gold>(join(CORPUS, 'gold', `${id}.json`))]));
const textos = new Map<string, TextoJson>(IDS.map((id) => [id, leerJson<TextoJson>(join(CORPUS, 'gold', `${id}.texto.json`))]));
const todos = [...golds.values()];
const anns = todos.flatMap((g) => g.anotaciones);
const positivas = anns.filter((a) => !a.es_negativo_esperado);
const COMPLETO = IDS.length >= 30;
const ORG = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'];

const F = (id: string): GoldAnn[] => anns.filter((a) => a.caracteristicas.includes(id));
const docsCon = (id: string): number => new Set(F(id).map((a) => a.docId)).size;
const digitos = (s: string): string => s.replace(/\D/g, '');

// ---------- Validadores independientes (7.2.2) ----------
const PESOS_NIT = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
function dvNit(base: string): number {
  let s = 0;
  for (let i = 0; i < base.length; i++) s += Number(base[base.length - 1 - i]) * (PESOS_NIT[i] as number);
  const r = s % 11;
  return r <= 1 ? r : 11 - r;
}
function luhn(d: string): boolean {
  let s = 0; let alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return s % 10 === 0;
}
// Códigos DANE de municipios (DIVIPOLA del DANE, corte 2024-12-30; geografía pública).
const DANE = new Set(`
05001 05002 05004 05021 05030 05031 05034 05036 05038 05040 05042 05044 05045 05051 05055 05059 05079 05086
05088 05091 05093 05101 05107 05113 05120 05125 05129 05134 05138 05142 05145 05147 05148 05150 05154 05172
05190 05197 05206 05209 05212 05234 05237 05240 05250 05264 05266 05282 05284 05306 05308 05310 05313 05315
05318 05321 05347 05353 05360 05361 05364 05368 05376 05380 05390 05400 05411 05425 05440 05467 05475 05480
05483 05490 05495 05501 05541 05543 05576 05579 05585 05591 05604 05607 05615 05628 05631 05642 05647 05649
05652 05656 05658 05659 05660 05664 05665 05667 05670 05674 05679 05686 05690 05697 05736 05756 05761 05789
05790 05792 05809 05819 05837 05842 05847 05854 05856 05858 05861 05873 05885 05887 05890 05893 05895 08001
08078 08137 08141 08296 08372 08421 08433 08436 08520 08549 08558 08560 08573 08606 08634 08638 08675 08685
08758 08770 08832 08849 11001 13001 13006 13030 13042 13052 13062 13074 13140 13160 13188 13212 13222 13244
13248 13268 13300 13430 13433 13440 13442 13458 13468 13473 13490 13549 13580 13600 13620 13647 13650 13654
13655 13657 13667 13670 13673 13683 13688 13744 13760 13780 13810 13836 13838 13873 13894 15001 15022 15047
15051 15087 15090 15092 15097 15104 15106 15109 15114 15131 15135 15162 15172 15176 15180 15183 15185 15187
15189 15204 15212 15215 15218 15223 15224 15226 15232 15236 15238 15244 15248 15272 15276 15293 15296 15299
15317 15322 15325 15332 15362 15367 15368 15377 15380 15401 15403 15407 15425 15442 15455 15464 15466 15469
15476 15480 15491 15494 15500 15507 15511 15514 15516 15518 15522 15531 15533 15537 15542 15550 15572 15580
15599 15600 15621 15632 15638 15646 15660 15664 15667 15673 15676 15681 15686 15690 15693 15696 15720 15723
15740 15753 15755 15757 15759 15761 15762 15763 15764 15774 15776 15778 15790 15798 15804 15806 15808 15810
15814 15816 15820 15822 15832 15835 15837 15839 15842 15861 15879 15897 17001 17013 17042 17050 17088 17174
17272 17380 17388 17433 17442 17444 17446 17486 17495 17513 17524 17541 17614 17616 17653 17662 17665 17777
17867 17873 17877 18001 18029 18094 18150 18205 18247 18256 18410 18460 18479 18592 18610 18753 18756 18785
18860 19001 19022 19050 19075 19100 19110 19130 19137 19142 19212 19256 19290 19300 19318 19355 19364 19392
19397 19418 19450 19455 19473 19513 19517 19532 19533 19548 19573 19585 19622 19693 19698 19701 19743 19760
19780 19785 19807 19809 19821 19824 19845 20001 20011 20013 20032 20045 20060 20175 20178 20228 20238 20250
20295 20310 20383 20400 20443 20517 20550 20570 20614 20621 20710 20750 20770 20787 23001 23068 23079 23090
23162 23168 23182 23189 23300 23350 23417 23419 23464 23466 23500 23555 23570 23574 23580 23586 23660 23670
23672 23675 23678 23682 23686 23807 23815 23855 25001 25019 25035 25040 25053 25086 25095 25099 25120 25123
25126 25148 25151 25154 25168 25175 25178 25181 25183 25200 25214 25224 25245 25258 25260 25269 25279 25281
25286 25288 25290 25293 25295 25297 25299 25307 25312 25317 25320 25322 25324 25326 25328 25335 25339 25368
25372 25377 25386 25394 25398 25402 25407 25426 25430 25436 25438 25473 25483 25486 25488 25489 25491 25506
25513 25518 25524 25530 25535 25572 25580 25592 25594 25596 25599 25612 25645 25649 25653 25658 25662 25718
25736 25740 25743 25745 25754 25758 25769 25772 25777 25779 25781 25785 25793 25797 25799 25805 25807 25815
25817 25823 25839 25841 25843 25845 25851 25862 25867 25871 25873 25875 25878 25885 25898 25899 27001 27006
27025 27050 27073 27075 27077 27099 27135 27150 27160 27205 27245 27250 27361 27372 27413 27425 27430 27450
27491 27493 27495 27580 27600 27615 27660 27745 27787 27800 27810 41001 41006 41013 41016 41020 41026 41078
41132 41206 41244 41298 41306 41319 41349 41357 41359 41378 41396 41483 41503 41518 41524 41530 41548 41551
41615 41660 41668 41676 41770 41791 41797 41799 41801 41807 41872 41885 44001 44035 44078 44090 44098 44110
44279 44378 44420 44430 44560 44650 44847 44855 44874 47001 47030 47053 47058 47161 47170 47189 47205 47245
47258 47268 47288 47318 47460 47541 47545 47551 47555 47570 47605 47660 47675 47692 47703 47707 47720 47745
47798 47960 47980 50001 50006 50110 50124 50150 50223 50226 50245 50251 50270 50287 50313 50318 50325 50330
50350 50370 50400 50450 50568 50573 50577 50590 50606 50680 50683 50686 50689 50711 52001 52019 52022 52036
52051 52079 52083 52110 52203 52207 52210 52215 52224 52227 52233 52240 52250 52254 52256 52258 52260 52287
52317 52320 52323 52352 52354 52356 52378 52381 52385 52390 52399 52405 52411 52418 52427 52435 52473 52480
52490 52506 52520 52540 52560 52565 52573 52585 52612 52621 52678 52683 52685 52687 52693 52694 52696 52699
52720 52786 52788 52835 52838 52885 54001 54003 54051 54099 54109 54125 54128 54172 54174 54206 54223 54239
54245 54250 54261 54313 54344 54347 54377 54385 54398 54405 54418 54480 54498 54518 54520 54553 54599 54660
54670 54673 54680 54720 54743 54800 54810 54820 54871 54874 63001 63111 63130 63190 63212 63272 63302 63401
63470 63548 63594 63690 66001 66045 66075 66088 66170 66318 66383 66400 66440 66456 66572 66594 66682 66687
68001 68013 68020 68051 68077 68079 68081 68092 68101 68121 68132 68147 68152 68160 68162 68167 68169 68176
68179 68190 68207 68209 68211 68217 68229 68235 68245 68250 68255 68264 68266 68271 68276 68296 68298 68307
68318 68320 68322 68324 68327 68344 68368 68370 68377 68385 68397 68406 68418 68425 68432 68444 68464 68468
68498 68500 68502 68522 68524 68533 68547 68549 68572 68573 68575 68615 68655 68669 68673 68679 68682 68684
68686 68689 68705 68720 68745 68755 68770 68773 68780 68820 68855 68861 68867 68872 68895 70001 70110 70124
70204 70215 70221 70230 70233 70235 70265 70400 70418 70429 70473 70508 70523 70670 70678 70702 70708 70713
70717 70742 70771 70820 70823 73001 73024 73026 73030 73043 73055 73067 73124 73148 73152 73168 73200 73217
73226 73236 73268 73270 73275 73283 73319 73347 73349 73352 73408 73411 73443 73449 73461 73483 73504 73520
73547 73555 73563 73585 73616 73622 73624 73671 73675 73678 73686 73770 73854 73861 73870 73873 76001 76020
76036 76041 76054 76100 76109 76111 76113 76122 76126 76130 76147 76233 76243 76246 76248 76250 76275 76306
76318 76364 76377 76400 76403 76497 76520 76563 76606 76616 76622 76670 76736 76823 76828 76834 76845 76863
76869 76890 76892 76895 81001 81065 81220 81300 81591 81736 81794 85001 85010 85015 85125 85136 85139 85162
85225 85230 85250 85263 85279 85300 85315 85325 85400 85410 85430 85440 86001 86219 86320 86568 86569 86571
86573 86749 86755 86757 86760 86865 86885 88001 88564 91001 91263 91405 91407 91430 91460 91530 91536 91540
91669 91798 94001 94343 94883 94884 94885 94886 94887 94888 95001 95015 95025 95200 97001 97161 97511 97666
97777 97889 99001 99524 99624 99773
`.split(/\s+/).filter(Boolean));
const DEPS = new Set([...DANE].map((c) => c.slice(0, 2)));
function radicadoOk(d: string): boolean {
  let x = d;
  if (x.length === 22) x = '0' + x;               // DANE sin el 0 inicial (Excel)
  if (x.length !== 21 && x.length !== 23) return false;
  const dane = x.slice(0, 5);
  const daneOk = DANE.has(dane) || (dane.endsWith('000') && DEPS.has(dane.slice(0, 2)));
  const anio = Number(x.slice(12, 16));
  return daneOk && anio >= 1990 && anio <= ANIO_ACTUAL;
}
function telOk(d10: string): boolean {
  if (d10.startsWith('3')) return /^3[0-5]\d\d{7}$/.test(d10);
  return /^60[124-8]\d{7}$/.test(d10);
}

// ---------- T-CO-01 ----------
describe('corpus · T-CO-01 estructura', () => {
  it('T-CO-01 hay 20 (desarrollo) o 30 documentos con su gold y su texto esperado', () => {
    expect([20, 30]).toContain(IDS.length);
    for (const id of IDS) {
      expect(golds.get(id)?.docId).toBe(id);
      expect(textos.get(id)?.docId).toBe(id);
      expect(golds.get(id)?.formato).toBe('sig-low/gold');
    }
  });

  it('T-CO-01 proporciones por tipo y por formato (10.1.1)', () => {
    const tipos: Record<string, number> = {};
    const formatos: Record<string, number> = {};
    for (const g of todos) { tipos[g.tipoDocumento] = (tipos[g.tipoDocumento] ?? 0) + 1; formatos[g.fuente] = (formatos[g.fuente] ?? 0) + 1; }
    if (COMPLETO) {
      expect(tipos).toEqual({ tutela_salud: 9, derecho_peticion: 6, contrato: 6, correo_cliente: 5, acta: 4 });
      expect(formatos).toEqual({ txt: 12, docx: 12, pdf: 6 });
    } else {
      expect(tipos).toEqual({ tutela_salud: 6, derecho_peticion: 4, contrato: 4, correo_cliente: 3, acta: 3 });
      expect(formatos).toEqual({ txt: 8, docx: 9, pdf: 3 });
    }
    for (const g of todos) expect(g.archivo).toBe(`corpus/docs/${g.docId}.${g.fuente}`);
  });

  it('T-CO-01 todos los documentos terminan con el pie de ficción', () => {
    for (const id of IDS) {
      const t = textos.get(id) as TextoJson;
      const ultimo = id === 'C04'
        ? (t.paginasEscaneadas ?? []).slice(-1)[0]?.lineas.join('\n') ?? ''
        : (t.partes.filter((p) => p.kind === 'cuerpo' || p.kind === 'pagina_pdf').slice(-1)[0]?.texto ?? '');
      // en PDF el ajuste de línea parte la frase: se compara sin diferencias de espacio en blanco
      expect(ultimo.replace(/\s+/g, ' ').endsWith(FICCION), `${id} termina con el pie de ficción`).toBe(true);
    }
  });

  it('T-CO-01 la suma sha256 de cada archivo coincide con MANIFIESTO.json (determinismo verificable)', () => {
    const man = leerJson<{ archivos: Array<{ ruta: string; sha256: string; bytes: number }>; semillas: Record<string, string>; versionGenerador: string }>(join(CORPUS, 'MANIFIESTO.json'));
    expect(man.semillas['desarrollo']).toBe('SIGLOW-CORPUS-A');
    expect(man.versionGenerador).toMatch(/^\d+\.\d+\.\d+$/);
    const rutas = new Set(man.archivos.map((a) => a.ruta));
    for (const id of IDS) {
      expect(rutas.has(`corpus/gold/${id}.json`), `${id}.json en el manifiesto`).toBe(true);
      expect(rutas.has(`corpus/gold/${id}.texto.json`), `${id}.texto.json en el manifiesto`).toBe(true);
      if (golds.get(id)?.fuente === 'txt') expect(rutas.has(`corpus/docs/${id}.txt`), `${id}.txt en el manifiesto`).toBe(true);
    }
    for (const a of man.archivos) {
      const ruta = join(RAIZ, a.ruta);
      expect(existsSync(ruta), `${a.ruta} existe`).toBe(true);
      const b = readFileSync(ruta);
      expect(b.length).toBe(a.bytes);
      expect(sha(b), `${a.ruta} sha256`).toBe(a.sha256);
    }
    // todo archivo de gold y docs está en el manifiesto
    for (const sub of ['gold', 'docs']) {
      const d = join(CORPUS, sub);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d)) if (statSync(join(d, f)).isFile()) expect(rutas.has(`corpus/${sub}/${f}`), `${sub}/${f} figura en el manifiesto`).toBe(true);
    }
  });

  it('T-CO-01 los .txt tienen la codificación prevista y su texto canónico coincide con texto.json', () => {
    const esperado: Record<string, string> = { C05: 'windows-1252', C10: 'utf-8-bom', C11: 'utf-16le-bom', C12: 'utf-8' };
    for (const id of IDS) {
      const g = golds.get(id) as Gold;
      if (g.fuente !== 'txt') continue;
      const b = readFileSync(join(CORPUS, 'docs', `${id}.txt`));
      let texto: string; let enc: string;
      if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { texto = new TextDecoder('utf-8').decode(b.subarray(3)); enc = 'utf-8-bom'; }
      else if (b[0] === 0xff && b[1] === 0xfe) { texto = new TextDecoder('utf-16le').decode(b.subarray(2)); enc = 'utf-16le-bom'; }
      else {
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(b); enc = 'utf-8'; } catch { texto = new TextDecoder('windows-1252').decode(b); enc = 'windows-1252'; }
      }
      texto = texto.replace(/\r\n?/g, '\n').normalize('NFC');
      const esp = esperado[id]; if (esp) expect(enc, `${id} codificación`).toBe(esp);
      expect(texto, `${id} texto canónico`).toBe((textos.get(id) as TextoJson).partes[0]?.texto);
      if (id === 'C05') expect(b.includes(0x0d), 'C05 usa CRLF').toBe(true);
    }
  });

  it('T-CO-01 esperado.partes (longitud y sha256) coincide con el texto esperado de cada parte', () => {
    for (const id of IDS) {
      const g = golds.get(id) as Gold; const t = textos.get(id) as TextoJson;
      if (id === 'C04') { expect(g.esperado.partes).toEqual([]); continue; }
      expect(g.esperado.partes.length).toBe(t.partes.length);
      g.esperado.partes.forEach((p, i) => {
        const tp = t.partes[i] as TextoJson['partes'][number];
        expect(p.kind).toBe(tp.kind); expect(p.index).toBe(tp.index); expect(p.page).toBe(tp.page);
        expect(p.longitud, `${id} ${p.kind} ${p.index} longitud`).toBe(tp.texto.length);
        expect(p.sha256, `${id} ${p.kind} ${p.index} sha256`).toBe(sha(tp.texto));
        expect(tp.texto.normalize('NFC')).toBe(tp.texto);
        expect(tp.texto.includes('\r')).toBe(false);
      });
    }
  });
});

// ---------- T-CO-02 ----------
describe('corpus · T-CO-02 cobertura de características y de tipos de dato', () => {
  const nitNatural = (a: GoldAnn): boolean => !/^[89]\d{8}$/.test(digitos(a.texto.replace(/-\d$/, '')));
  const ccFs = (): GoldAnn[] => F('F06');
  // [nombre, obtenido, mínimo]
  const filas = (): Array<[string, number, number]> => {
    const f9 = F('F09');
    const f20 = F('F20');
    const T = (tipos: string[], p: (a: GoldAnn) => boolean = () => true): number => positivas.filter((a) => tipos.includes(a.tipo) && p(a)).length;
    return [
      ['F01 menciones', F('F01').length, 25], ['F01 documentos', docsCon('F01'), 8], ['F02', F('F02').length, 30], ['F03', F('F03').length, 40],
      ['F04 documentos', docsCon('F04'), 6], ['F05', F('F05').length, 10],
      ['F06 CC', ccFs().length, 60], ['F06 antiguas', ccFs().filter((a) => digitos(a.texto).length <= 7).length, 15],
      ['F06 NUIP de 10 con prefijo 1', ccFs().filter((a) => /^1\d{9}$/.test(digitos(a.texto))).length, 15],
      ['F06 con prefijo 2', ccFs().filter((a) => /^2\d{9}$/.test(digitos(a.texto))).length, 3],
      ['F06 sin puntos ni rótulo', ccFs().filter((a) => !/[.']/.test(a.texto) && !a.rotulado).length, 10],
      ['F07 NIT', F('F07').length, 30], ['F07 DV inválido', F('F07').filter((a) => a.estructura === 'invalida').length, 5],
      ['F07 persona natural', F('F07').filter(nitNatural).length, 5],
      ['F08', F('F08').length, 6], ['F09', f9.length, 12],
      ['F09 PPT', f9.filter((a) => a.tipo === 'PPT').length, 2], ['F09 PEP', f9.filter((a) => a.tipo === 'PEP').length, 2],
      ['F09 CE', f9.filter((a) => a.tipo === 'CE').length, 2], ['F09 pasaporte', f9.filter((a) => a.tipo === 'PASAPORTE').length, 2],
      ['F09 registro civil', f9.filter((a) => a.tipo === 'DOCUMENTO' && !/^CD/.test(a.texto)).length, 2],
      ['F09 carné diplomático', f9.filter((a) => /^CD/.test(a.texto)).length, 2],
      ['F10', F('F10').length, 18], ['F10 antiguos de 7 dígitos', F('F10').filter((a) => /^\d{3} \d{4}$/.test(a.texto)).length, 3],
      ['F11', F('F11').length, 30], ['F11 con prefijo', F('F11').filter((a) => /^(\+57|\(\+57\)|0057)/.test(a.texto)).length, 10],
      ['F12', F('F12').length, 40], ['F13', F('F13').length, 32], ['F14', F('F14').length, 8], ['F15', F('F15').length, 12],
      ['F16', F('F16').length, 12], ['F16 de moto', F('F16').filter((a) => /[A-Z]$/.test(a.texto)).length, 3],
      ['F17', F('F17').length, 10], ['F18', F('F18').length, 15], ['F19', F('F19').length, 15],
      ['F20 cuentas y llaves', f20.filter((a) => a.tipo === 'CUENTA').length, 15], ['F20 tarjetas', f20.filter((a) => a.tipo === 'TARJETA').length, 5],
      ['F20 tarjetas con Luhn inválido', f20.filter((a) => a.tipo === 'TARJETA' && a.estructura === 'invalida').length, 2],
      ['F21', F('F21').length, 40], ['F22', F('F22').length, 60], ['F23', F('F23').length, 20],
      ['F24', F('F24').length, 18], ['F24 SMMLV', F('F24').filter((a) => /SMMLV|salarios m/.test(a.texto)).length, 8],
      ['F25', F('F25').length, 10], ['F26', F('F26').length, 4], ['F27', F('F27').length, 15],
      ['F28', F('F28').length, 12], ['F28 con CIE-10', F('F28').filter((a) => /^[A-Z]\d\d(\.\d)?$/.test(a.texto)).length, 6],
      ['F29', F('F29').length, 8], ['F30', F('F30').length, 60], ['F31', F('F31').length, 25], ['F32', F('F32').length, 6],
      // Características de estructura: el mínimo de 10.1.3 aplica al conjunto de 30; en el de desarrollo, el que permite su parte del catálogo (10.1.2).
      ['F33 documentos', docsCon('F33'), 5], ['F34 documentos', docsCon('F34'), 6], ['F35 documentos', docsCon('F35'), 4],
      ['F36 documentos', docsCon('F36'), 4], ['F37 documentos', docsCon('F37'), 2], ['F38 documentos', docsCon('F38'), 3], ['F39 documentos', docsCon('F39'), 2],
      ['F40 documentos', docsCon('F40'), COMPLETO ? 5 : 2],
      ['F41 documentos', todos.filter((g) => g.esperado.error === 'PDF_SIN_CAPA_TEXTO').length, 1],
      ['F42 documentos', docsCon('F42'), COMPLETO ? 2 : 1],
      ['F43', F('F43').length, 10], ['F44', F('F44').length, 25],
      ['F45', F('F45').length, 8], ['F46', F('F46').length, 8], ['F47', F('F47').length, 10], ['F50', F('F50').length, 8],
      ['F51 PER', F('F51').filter((a) => a.tipo === 'PERSONA').length, 100], ['F51 ORG', F('F51').filter((a) => ORG.includes(a.tipo)).length, 50],
      ['F52', F('F52').length, 8], ['F53', F('F53').length, 20], ['F54', F('F54').filter((a) => ORG.includes(a.tipo)).length, 12],
      ...(COMPLETO ? [['F49 (texto oculto y marca de agua)', docsCon('F49'), 1] as [string, number, number]] : []),
      // 10.1.4
      ['PERSONA en la lista', T(['PERSONA'], (a) => a.enLista), 250], ['PERSONA fuera de la lista', T(['PERSONA'], (a) => !a.enLista), 100],
      ['Organizaciones en la lista', T(ORG, (a) => a.enLista && a.contenidaEn === undefined), 120], ['Organizaciones fuera de la lista', T(ORG, (a) => !a.enLista), 50],
      ['CC', T(['CC']), 60], ['NIT', T(['NIT']), 30], ['RADICADO', T(['RADICADO']), 45], ['RADICADO_ADMIN', T(['RADICADO_ADMIN']), 8],
      ['TELEFONO', T(['TELEFONO']), 50], ['CORREO', T(['CORREO']), 40], ['DIRECCION', T(['DIRECCION']), 40], ['BARRIO', T(['BARRIO']), 12],
      ['TI', T(['TI']), 6], ['CE, PPT, PEP, PASAPORTE, DOCUMENTO', T(['CE', 'PPT', 'PEP', 'PASAPORTE', 'DOCUMENTO']), 12], ['TP', T(['TP']), 8], ['PLACA', T(['PLACA']), 12],
      ['MATRICULA', T(['MATRICULA']), 10], ['CUENTA + TARJETA', T(['CUENTA', 'TARJETA']), 20], ['HC', T(['HC']), 15], ['AFILIACION', T(['AFILIACION']), 15],
      ['FECHA', T(['FECHA']), 150], ['VALOR', T(['VALOR']), 60], ['MUNICIPIO', T(['MUNICIPIO']), 30], ['DEPARTAMENTO', T(['DEPARTAMENTO']), 10],
      ['CARGO', T(['CARGO']), 15], ['DIAGNOSTICO', T(['DIAGNOSTICO']), 12], ['HECHO_LLAMATIVO', T(['HECHO_LLAMATIVO']), 8], ['MENOR', T(['MENOR']), 8],
      ['Negativos (F30 + F31 + F53)', anns.filter((a) => a.es_negativo_esperado && !a.caracteristicas.includes('F32')).length, 105],
      ['Citas con radicado (F32)', anns.filter((a) => a.es_negativo_esperado && a.caracteristicas.includes('F32')).length, 6],
      ['Despachos (F54)', F('F54').filter((a) => ORG.includes(a.tipo)).length, 12],
    ];
  };
  const casos = filas();
  for (const [nombre, obtenido, minimo] of casos) {
    it(`T-CO-02 ${nombre}: ${obtenido} ≥ ${minimo}`, () => { expect(obtenido).toBeGreaterThanOrEqual(minimo); });
  }

  it('T-CO-02 al menos 3 nombres incompletos en la lista del caso (F44)', () => {
    let n = 0;
    for (const g of todos) {
      for (const e of g.entidades) {
        if (e.tipo !== 'PERSONA' || !e.enLista) continue;
        const nombre = e.canonico.replace(/^LISTA:/, '');
        const maxPal = Math.max(...g.anotaciones.filter((a) => a.entidad === e.id && a.tipo === 'PERSONA').map((a) => a.texto.split(/\s+/).length));
        if (maxPal > nombre.split(/\s+/).length) n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('T-CO-02 todos los .docx y .pdf declaran metadatos ficticios (F48)', () => {
    for (const g of todos) if (g.fuente !== 'txt') expect(g.esperado.metadatos.length, `${g.docId} metadatos`).toBeGreaterThan(0);
  });

  it('T-CO-02 cada documento medible tiene entre 2 y 6 entidades de la lista y roles válidos', () => {
    for (const g of todos) {
      if (g.docId === 'C04') continue;
      expect(g.listaDelCaso.length, `${g.docId} lista`).toBeGreaterThanOrEqual(2);
      expect(g.listaDelCaso.length, `${g.docId} lista`).toBeLessThanOrEqual(6);
      for (const l of g.listaDelCaso) expect(ROLES as readonly string[]).toContain(l.role);
    }
  });
});

// ---------- T-CO-03 ----------
describe('corpus · T-CO-03 validez estructural', () => {
  it('T-CO-03 los NIT valida pasan el DV y los invalida lo incumplen', () => {
    const nit = positivas.filter((a) => a.tipo === 'NIT');
    for (const a of nit) {
      const m = /^(.*?)\s*-\s*(\d)$/.exec(a.texto);
      expect(m, `${a.id} tiene DV`).not.toBeNull();
      const base = digitos(m?.[1] ?? ''); const dv = Number(m?.[2]);
      if (a.estructura === 'valida') expect(dvNit(base), `${a.id} ${a.texto}`).toBe(dv);
      else { expect(a.estructura).toBe('invalida'); expect(dvNit(base), `${a.id} ${a.texto}`).not.toBe(dv); }
    }
    expect(nit.filter((a) => a.estructura === 'invalida').length).toBeGreaterThanOrEqual(5);
  });

  it('T-CO-03 las tarjetas valida pasan Luhn y las invalida no (≥ 2)', () => {
    const t = positivas.filter((a) => a.tipo === 'TARJETA');
    for (const a of t) expect(luhn(digitos(a.texto)), `${a.id} ${a.texto}`).toBe(a.estructura === 'valida');
    expect(t.filter((a) => a.estructura === 'invalida').length).toBeGreaterThanOrEqual(2);
  });

  it('T-CO-03 radicados válidos con DANE en la DIVIPOLA y año entre 1990 y el actual; inválidos a propósito fallan', () => {
    const r = positivas.filter((a) => a.tipo === 'RADICADO');
    for (const a of r) {
      const d = digitos(a.texto);
      if (a.estructura === 'valida') expect(radicadoOk(d), `${a.id} ${a.texto}`).toBe(true);
      else expect(radicadoOk(d), `${a.id} ${a.texto}`).toBe(false);
    }
    const inv = r.filter((a) => a.estructura === 'invalida');
    const daneMal = inv.filter((a) => { const d = digitos(a.texto); return !DANE.has((d.length === 22 ? '0' + d : d).slice(0, 5)); });
    const anio1985 = inv.filter((a) => { const d = digitos(a.texto); return Number((d.length === 22 ? '0' + d : d).slice(12, 16)) === 1985; });
    expect(daneMal.length, 'radicados con DANE inexistente').toBeGreaterThanOrEqual(2);
    expect(anio1985.length, 'radicado con año 1985').toBeGreaterThanOrEqual(1);
    expect(r.filter((a) => a.caracteristicas.includes('F05')).every((a) => digitos(a.texto).length === 21)).toBe(true);
    expect(new Set(r.map((a) => digitos(a.texto).length))).toContain(22);
  });

  it('T-CO-03 teléfonos valida pasan el plan de numeración; ≥ 2 con indicativo 603 son inválidos', () => {
    const tel = positivas.filter((a) => a.tipo === 'TELEFONO');
    let i603 = 0;
    for (const a of tel) {
      let d = digitos(a.texto.replace(/\s*Ext\.?\s*\d+$/i, ''));
      if (d.startsWith('0057')) d = d.slice(4); else if (a.texto.startsWith('+57') || a.texto.startsWith('(+57)')) d = d.slice(2);
      if (d.length === 7) { expect(a.estructura).toBe('valida'); continue; }
      expect(d.length, `${a.id} ${a.texto}`).toBe(10);
      if (a.estructura === 'valida') expect(telOk(d), `${a.id} ${a.texto}`).toBe(true);
      else { expect(telOk(d), `${a.id} ${a.texto}`).toBe(false); if (d.startsWith('603')) i603++; }
    }
    expect(i603).toBeGreaterThanOrEqual(2);
  });

  it('T-CO-03 ≥ 2 «cédulas» de 9 dígitos marcadas inválidas', () => {
    const c = positivas.filter((a) => a.tipo === 'CC' && digitos(a.texto).length === 9);
    expect(c.length).toBeGreaterThanOrEqual(2);
    for (const a of c) expect(a.estructura).toBe('invalida');
    for (const a of positivas.filter((x) => x.tipo === 'CC' && digitos(x.texto).length !== 9)) expect(a.estructura).toBe('valida');
  });

  it('T-CO-03 los correos valida tienen forma de correo', () => {
    for (const a of positivas.filter((x) => x.tipo === 'CORREO')) expect(a.texto, a.id).toMatch(/^[\w.+-]+@[\w-]+(\.[\w-]+)*\.test$/i);
  });
});

// ---------- T-CO-04 ----------
describe('corpus · T-CO-04 datos ficticios evidentes', () => {
  const TOKENS = /(ficticio|ficticia|ejemplo|prueba)/i;
  const archivos = (dir: string, ext: RegExp): string[] => {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...archivos(p, ext)); else if (ext.test(e.name)) out.push(p);
    }
    return out;
  };

  it('T-CO-04 0 correos fuera de .test en corpus/**, tests/unit/** y tests/fixtures/**', () => {
    // Un correo completo termina en un TLD de ≥ 2 letras; «ana@ejemplo.t» (caso negativo de las reglas) no lo es.
    const ER = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
    const malos: string[] = [];
    const rutas = [...archivos(CORPUS, /\.(txt|json)$/), ...archivos(join(RAIZ, 'tests', 'unit'), /\.ts$/), ...archivos(join(RAIZ, 'tests', 'fixtures'), /\.(txt|json|ts|mjs)$/)];
    for (const r of rutas) {
      if (r.endsWith('MANIFIESTO.json')) continue;
      for (const m of readFileSync(r, 'utf8').match(ER) ?? []) if (!/\.test$/i.test(m)) malos.push(`${r.slice(RAIZ.length)}: ${m}`);
    }
    expect(malos).toEqual([]);
  });

  it('T-CO-04 0 nombres de persona sin token marcador (Ficticio, Ficticia, Ejemplo, Prueba)', () => {
    const sinToken: string[] = [];
    for (const g of todos) {
      const porEntidad = new Map<string, GoldAnn[]>();
      for (const a of g.anotaciones) if (a.tipo === 'PERSONA' && !a.es_negativo_esperado) { const l = porEntidad.get(a.entidad) ?? []; l.push(a); porEntidad.set(a.entidad, l); }
      for (const [ent, l] of porEntidad) {
        // las variantes (iniciales, nombre de pila, apodo) heredan el token de la mención completa de su entidad
        if (!l.some((a) => TOKENS.test(a.texto))) sinToken.push(`${g.docId} ${ent} ${l[0]?.texto}`);
        for (const a of l) if (!TOKENS.test(a.texto) && !a.caracteristicas.includes('F44')) sinToken.push(`${g.docId} ${a.id} ${a.texto}`);
      }
    }
    expect(sinToken).toEqual([]);
  });

  it('T-CO-04 las organizaciones y los despachos llevan token marcador o son geografía pública', () => {
    const malas: string[] = [];
    for (const a of positivas) {
      if (!ORG.includes(a.tipo) || a.estructura !== 'no_aplica') continue;
      if (a.caracteristicas.includes('F54')) continue;               // «Juzgado 999 … de Soacha»: despacho con municipio real
      if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(a.texto)) continue;                // sigla («ESF», «CESA»)
      if (!TOKENS.test(a.texto)) malas.push(`${a.docId} ${a.id} ${a.texto}`);
    }
    expect(malas).toEqual([]);
  });

  it('T-CO-04 0 radicados con despacho fuera de 900–999 (salvo los inválidos a propósito)', () => {
    for (const a of positivas.filter((x) => x.tipo === 'RADICADO')) {
      if (a.estructura === 'invalida') continue;
      let d = digitos(a.texto); if (d.length === 22) d = '0' + d;
      expect(Number(d.slice(9, 12)), `${a.id} ${a.texto}`).toBeGreaterThanOrEqual(900);
      expect(Number(d.slice(9, 12)), `${a.id} ${a.texto}`).toBeLessThanOrEqual(999);
    }
    for (const a of anns.filter((x) => x.es_negativo_esperado && x.tipo === 'RADICADO')) {
      const d = digitos(a.texto);
      expect(Number(d.slice(9, 12)), `${a.id} ${a.texto}`).toBeGreaterThanOrEqual(900);
    }
  });

  it('T-CO-04 0 teléfonos o cédulas sin el patrón de ceros', () => {
    for (const a of positivas.filter((x) => x.tipo === 'TELEFONO')) {
      let d = digitos(a.texto.replace(/\s*Ext\.?\s*\d+$/i, ''));
      if (d.startsWith('0057')) d = d.slice(4); else if (a.texto.startsWith('+57') || a.texto.startsWith('(+57)')) d = d.slice(2);
      const resto = d.length === 10 ? d.slice(3) : d;
      expect(resto.startsWith('000'), `${a.id} ${a.texto}`).toBe(true);
    }
    for (const a of positivas.filter((x) => ['CC', 'TI', 'HC'].includes(x.tipo))) {
      if (a.tipo === 'HC' && !/^\d{6}$/.test(a.texto)) { /* HC con el número de la cédula: mismo patrón */ }
      expect(digitos(a.texto), `${a.id} ${a.texto}`).toContain('000');
    }
  });

  it('T-CO-04 0 coincidencias con la lista negra de números de entidades reales (si el integrador la entregó)', () => {
    const rutas = [join(RAIZ, 'tests', 'fixtures', 'lista-negra-numeros.txt'), join(CORPUS, 'lista-negra-numeros.txt')];
    const ruta = rutas.find((r) => existsSync(r));
    if (!ruta) return; // la lista la mantiene el integrador (puede pasarse a H-0)
    const negra = readFileSync(ruta, 'utf8').split(/\r?\n/).map((l) => digitos(l)).filter((l) => l.length >= 7);
    for (const a of positivas) for (const n of negra) expect(digitos(a.texto), `${a.id}`).not.toBe(n);
  });
});

// ---------- T-CO-05 ----------
describe('corpus · T-CO-05 partes y rasgos de cada formato', () => {
  const partesDe = (id: string, kind: string): number => (textos.get(id)?.partes ?? []).filter((p) => p.kind === kind).length;
  const bloques = (id: string): Array<{ tipo: string; variante?: string; instr?: string }> => (textos.get(id)?.estructura ?? []).flatMap((e) => e.bloques);
  const tiene = (id: string, tipo: string, variante?: string): boolean => bloques(id).some((b) => b.tipo === tipo && (variante === undefined || b.variante === variante));
  const hay = (id: string): boolean => IDS.includes(id);

  it('T-CO-05 los .docx contienen las partes que declara 10.1.2', () => {
    if (hay('C01')) { expect(partesDe('C01', 'encabezado')).toBe(2); expect(partesDe('C01', 'pie')).toBe(1); expect(partesDe('C01', 'nota_pie')).toBe(2); expect(partesDe('C01', 'comentario')).toBe(1); expect(tiene('C01', 'tabla')).toBe(true); }
    if (hay('C02')) { expect(tiene('C02', 'eliminado')).toBe(true); expect(tiene('C02', 'insertado')).toBe(true); expect(tiene('C02', 'cuadro_texto', 'choice_fallback')).toBe(true); expect(partesDe('C02', 'nota_final')).toBe(1); }
    if (hay('C06')) { expect(partesDe('C06', 'nota_pie')).toBe(2); expect(tiene('C06', 'campo')).toBe(true); expect(bloques('C06').some((b) => b.instr?.startsWith('MERGEFIELD'))).toBe(true); expect(bloques('C06').some((b) => b.instr?.startsWith('HYPERLINK'))).toBe(true); expect(tiene('C06', 'control_contenido')).toBe(true); }
    if (hay('C13')) { expect(partesDe('C13', 'encabezado')).toBe(1); expect(tiene('C13', 'eliminado')).toBe(true); expect(tiene('C13', 'insertado')).toBe(true); }
    if (hay('C16')) { expect(partesDe('C16', 'encabezado')).toBe(1); expect(tiene('C16', 'tabla')).toBe(true); }
    if (hay('C17')) { expect(partesDe('C17', 'encabezado')).toBe(1); expect(partesDe('C17', 'pie')).toBe(1); expect(tiene('C17', 'cuadro_texto', 'choice_fallback')).toBe(true); }
    if (hay('C18')) { expect(partesDe('C18', 'pie')).toBe(1); expect(partesDe('C18', 'nota_pie')).toBe(1); expect(partesDe('C18', 'comentario')).toBe(1); }
    if (hay('C27')) { expect(partesDe('C27', 'encabezado')).toBe(1); expect(tiene('C27', 'tabla')).toBe(true); expect(tiene('C27', 'control_contenido')).toBe(true); }
    if (hay('C28')) { expect(tiene('C28', 'cuadro_texto', 'choice')).toBe(true); expect(partesDe('C28', 'comentario')).toBe(1); expect(golds.get('C28')?.esperado.metadatos).toContain('propiedades_personalizadas'); }
  });

  it('T-CO-05 los .txt de tabla usan tabuladores (C30)', () => {
    if (!hay('C30')) return;
    expect(textos.get('C30')?.partes[0]?.texto).toContain('\t');
  });

  it('T-CO-05 C04 es escaneado: sin partes de texto, con error PDF_SIN_CAPA_TEXTO y sin operadores de texto', () => {
    if (!hay('C04')) return;
    const g = golds.get('C04') as Gold;
    expect(g.esperado.error).toBe('PDF_SIN_CAPA_TEXTO');
    expect(g.esperado.partes).toEqual([]);
    expect(g.esperado.advertencias).toContain('PAGINA_SIN_TEXTO');
    expect(textos.get('C04')?.partes).toEqual([]);
    expect((textos.get('C04')?.paginasEscaneadas ?? []).length).toBeGreaterThanOrEqual(3);
    const bin = join(CORPUS, 'docs', 'C04.pdf');
    if (existsSync(bin)) {
      const s = readFileSync(bin).toString('latin1');
      expect(/\bBT\b/.test(s) || /\bTj\b/.test(s)).toBe(false);
      expect(s).toContain('/DCTDecode');
    }
  });

  it('T-CO-05 C03 tiene anotación de PDF con teléfono; C20 tiene dos columnas y aviso de orden de lectura', () => {
    if (hay('C03')) {
      const an = (textos.get('C03')?.partes ?? []).filter((p) => p.kind === 'anotacion_pdf');
      expect(an.length).toBeGreaterThanOrEqual(1);
      expect(golds.get('C03')?.anotaciones.some((a) => a.parte.kind === 'anotacion_pdf' && a.tipo === 'TELEFONO')).toBe(true);
      expect(golds.get('C03')?.esperado.metadatos).toContain('pdf_autores_anotaciones');
      const bin = join(CORPUS, 'docs', 'C03.pdf');
      if (existsSync(bin)) expect(readFileSync(bin).toString('latin1')).toContain('/Contents');
    }
    if (hay('C20')) {
      expect(textos.get('C20')?.pdf?.dosColumnas).toBe(true);
      expect(golds.get('C20')?.esperado.advertencias).toContain('ORDEN_LECTURA_PDF');
    }
  });

  it('T-CO-05 los .docx y .pdf agregados por PG-2 (si existen) traen metadatos ficticios', () => {
    for (const id of IDS) {
      const g = golds.get(id) as Gold;
      if (g.fuente === 'txt') continue;
      const bin = join(CORPUS, 'docs', `${id}.${g.fuente}`);
      if (!existsSync(bin)) continue;
      const s = readFileSync(bin).toString('latin1');
      if (g.fuente === 'pdf') expect(s).toMatch(/Autor|Author/);
      expect(g.esperado.metadatos.length).toBeGreaterThan(0);
    }
  });
});

// ---------- T-GO-01 ----------
describe('corpus · T-GO-01 comprobaciones automáticas del gold', () => {
  const RE_ID_ANN = /^C(0[1-9]|[12][0-9]|30)-A\d{3}$/;
  const RE_ID_ENT = /^C(0[1-9]|[12][0-9]|30)-E\d{2,3}$/;
  const RE_DOC = /^C(0[1-9]|[12][0-9]|30)$/;
  const TIPOS: readonly string[] = DATA_TYPES;
  const BANDERAS: readonly string[] = FLAG_TYPES;
  const CAMPOS = ['formato', 'v', 'docId', 'tipoDocumento', 'fuente', 'archivo', 'conjunto', 'semilla', 'esperado', 'listaDelCaso', 'entidades', 'anotaciones', 'revision'];
  const CAMPOS_ANN = ['id', 'docId', 'parte', 'start', 'end', 'texto', 'tipo', 'entidad', 'debe_generalizarse', 'es_negativo_esperado', 'estructura', 'enLista', 'rotulado', 'caracteristicas'];
  const GENERALIZACIONES = ['FECHA_A_MES_ANIO', 'FECHA_NACIMIENTO_A_RANGO_EDAD', 'EDAD_A_RANGO', 'ROTULO_DOCUMENTO_A_GENERICO', 'MUNICIPIO_A_DEPARTAMENTO', 'DESPACHO_A_GENERICO', 'CARGO_A_GENERICO', 'DIAGNOSTICO_A_GENERICO', 'HECHO_A_GENERICO', 'MENOR_A_GENERICO'];
  const CLASES = ['exacta', 'sin_tildes', 'mayusculas', 'apellidos', 'apellido_suelto', 'nombre_suelto', 'iniciales', 'posesivo', 'razon_social_sin_sufijo', 'sigla'];
  const KINDS = ['encabezado', 'cuerpo', 'pie', 'nota_pie', 'nota_final', 'comentario', 'anotacion_pdf', 'pagina_pdf'];

  it('T-GO-01 campos, enumeraciones e identificadores de los archivos gold', () => {
    for (const g of todos) {
      for (const c of CAMPOS) expect(g, `${g.docId} campo ${c}`).toHaveProperty(c);
      expect(g.v).toBe(1); expect(g.docId).toMatch(RE_DOC);
      expect(['tutela_salud', 'derecho_peticion', 'contrato', 'correo_cliente', 'acta']).toContain(g.tipoDocumento);
      expect(['txt', 'docx', 'pdf']).toContain(g.fuente); expect(['desarrollo', 'reserva']).toContain(g.conjunto);
      expect(['borrador', 'revisado', 'adjudicado']).toContain(g.revision.estado);
      for (const e of g.entidades) {
        expect(e.id).toMatch(RE_ID_ENT); expect(TIPOS).toContain(e.tipo); if (e.rol) expect(ROLES as readonly string[]).toContain(e.rol);
        expect(typeof e.canonico).toBe('string'); expect(e.canonico.length).toBeGreaterThan(0);
      }
      for (const a of g.anotaciones) {
        for (const c of CAMPOS_ANN) expect(a, `${a.id} campo ${c}`).toHaveProperty(c);
        expect(a.id).toMatch(RE_ID_ANN); expect(a.docId).toBe(g.docId); expect(a.id.startsWith(g.docId + '-')).toBe(true);
        expect(TIPOS).toContain(a.tipo); if (a.rol) expect(ROLES as readonly string[]).toContain(a.rol);
        expect(KINDS).toContain(a.parte.kind); expect(['valida', 'invalida', 'no_aplica']).toContain(a.estructura);
        if (a.generalizacion) expect(GENERALIZACIONES).toContain(a.generalizacion);
        if (a.claseVariante) expect(CLASES).toContain(a.claseVariante);
        if (a.bandera_esperada) expect(BANDERAS).toContain(a.bandera_esperada);
        for (const f of a.caracteristicas) expect(f).toMatch(/^F\d\d$/);
      }
      const ids = g.anotaciones.map((a) => a.id); expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('T-GO-01 textoParte.slice(start, end) === texto, sin espacios ni puntuación en los bordes', () => {
    for (const g of todos) {
      const t = textos.get(g.docId) as TextoJson;
      for (const a of g.anotaciones) {
        const p = t.partes.find((x) => x.kind === a.parte.kind && x.index === a.parte.index && x.page === a.parte.page);
        expect(p, `${a.id} parte`).toBeDefined();
        const txt = (p as { texto: string }).texto;
        expect(a.start, a.id).toBeGreaterThanOrEqual(0); expect(a.end, a.id).toBeGreaterThan(a.start); expect(a.end, a.id).toBeLessThanOrEqual(txt.length);
        expect(txt.slice(a.start, a.end), a.id).toBe(a.texto);
        // el paréntesis del indicativo («(601) 000 0001») y el de cierre de «(2026)» forman parte del dato (10.2.2)
        const inicio = a.tipo === 'TELEFONO' ? /^[\s.,;:)¿?¡!]/ : /^[\s.,;:()¿?¡!]/;
        expect(inicio.test(a.texto) || /[\s,;:(¿?¡!]$/.test(a.texto), `${a.id} «${a.texto}» con espacio o puntuación en el borde`).toBe(false);
        // un punto final solo se admite si forma parte de una sigla o abreviatura («S.A.S.», «Ltda.»)
        if (a.texto.endsWith('.')) expect(/(?:S\.A\.S|S\.A|Ltda|E\.S\.E|E\.S\.P|P\.H|S\. en C|E\.P\.S|D\.C|T\.I)\.$|^(?:[A-ZÁÉÍÓÚÑ]\. ?)+$/i.test(a.texto), `${a.id} «${a.texto}»`).toBe(true);
      }
    }
  });

  it('T-GO-01 entidades: toda anotación apunta a una existente, mismoTitular simétrico, canónicos únicos', () => {
    for (const g of todos) {
      const porId = new Map(g.entidades.map((e) => [e.id, e]));
      const canon = new Map<string, string>();
      for (const e of g.entidades) {
        expect(canon.has(e.canonico), `${g.docId} canónico repetido ${e.canonico}`).toBe(false); canon.set(e.canonico, e.id);
        for (const o of e.mismoTitular) { const eo = porId.get(o); expect(eo, `${e.id} → ${o}`).toBeDefined(); expect(eo?.mismoTitular).toContain(e.id); expect(o).not.toBe(e.id); }
      }
      for (const a of g.anotaciones) expect(porId.has(a.entidad), `${a.id} → ${a.entidad}`).toBe(true);
      const usadas = new Set(g.anotaciones.map((a) => a.entidad));
      for (const e of g.entidades) expect(usadas.has(e.id), `${e.id} sin menciones`).toBe(true);
    }
  });

  it('T-GO-01 dos anotaciones positivas no se solapan sin contenidaEn', () => {
    for (const g of todos) {
      const porParte = new Map<string, GoldAnn[]>();
      for (const a of g.anotaciones) { const k = `${a.parte.kind}/${a.parte.index}/${a.parte.page ?? 0}`; const l = porParte.get(k) ?? []; l.push(a); porParte.set(k, l); }
      for (const l of porParte.values()) {
        const ord = l.filter((a) => !a.es_negativo_esperado).sort((x, y) => x.start - y.start || y.end - x.end);
        for (let i = 0; i < ord.length; i++) for (let j = i + 1; j < ord.length; j++) {
          const x = ord[i] as GoldAnn; const y = ord[j] as GoldAnn;
          if (y.start >= x.end) break;
          expect(y.contenidaEn === x.id || x.contenidaEn === y.id, `${g.docId}: ${x.id} («${x.texto}») y ${y.id} («${y.texto}») se solapan`).toBe(true);
        }
      }
    }
  });

  it('T-GO-01 bandera_esperada, cita con radicado (F32) y datos indirectos con debe_generalizarse', () => {
    for (const a of anns) {
      if (a.bandera_esperada && !a.es_negativo_esperado) expect(['CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR']).toContain(a.bandera_esperada);
      if (a.es_negativo_esperado && a.bandera_esperada) expect(a.bandera_esperada).toBe('CITA_JURISPRUDENCIAL');
      if (a.caracteristicas.includes('F32')) { expect(a.bandera_esperada, a.id).toBe('CITA_JURISPRUDENCIAL'); expect(a.es_negativo_esperado).toBe(true); }
      if (['CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR'].includes(a.tipo)) expect(a.debe_generalizarse, `${a.id} ${a.tipo}`).toBe(true);
      if (a.tipo === 'MUNICIPIO') expect(a.generalizacion).toBe('MUNICIPIO_A_DEPARTAMENTO');
      if (a.caracteristicas.includes('F54') && ORG.includes(a.tipo)) { expect(a.generalizacion).toBe('DESPACHO_A_GENERICO'); expect(a.debe_generalizarse).toBe(true); }
      if (a.caracteristicas.includes('F47')) expect(a.debe_generalizarse).toBe(true);
    }
    for (const g of todos) {
      const porId = new Map(g.anotaciones.map((a) => [a.id, a]));
      for (const a of g.anotaciones) if (a.contenidaEn) {
        const o = porId.get(a.contenidaEn) as GoldAnn;
        expect(o, `${a.id} contenidaEn`).toBeDefined();
        expect(o.parte).toEqual(a.parte); expect(o.start).toBeLessThanOrEqual(a.start); expect(o.end).toBeGreaterThanOrEqual(a.end);
      }
    }
  });

  it('T-GO-01 enLista: la entidad está en listaDelCaso y la anotación coincide con la entidad', () => {
    for (const g of todos) {
      const nombres = new Set(g.listaDelCaso.map((l) => l.name));
      const porId = new Map(g.entidades.map((e) => [e.id, e]));
      for (const a of g.anotaciones) {
        const e = porId.get(a.entidad) as GoldEnt;
        if (a.enLista) { expect(e.enLista, a.id).toBe(true); expect(e.canonico.startsWith('LISTA:'), a.id).toBe(true); expect(nombres.has(e.canonico.slice(6)), `${a.id} ${e.canonico}`).toBe(true); }
        else expect(e.canonico.startsWith('LISTA:'), a.id).toBe(false);
      }
      for (const e of g.entidades) if (e.enLista) expect(nombres.has(e.canonico.replace(/^LISTA:/, '')), `${e.id}`).toBe(true);
    }
  });

  it('T-GO-01 el estado de revisión es válido y un borrador no trae cambios', () => {
    for (const g of todos) { expect(['borrador', 'revisado', 'adjudicado']).toContain(g.revision.estado); if (g.revision.estado === 'borrador') { expect(g.revision.discrepancias).toBe(0); expect(g.revision.cambios).toEqual([]); } }
  });
});
