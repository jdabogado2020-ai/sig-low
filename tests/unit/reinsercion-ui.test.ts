// Pantalla Reinserción (PC-6): lógica de la interfaz sin DOM. T-RI-10 (parte de unidad: tabla bloqueada, marcador de otro asunto,
// aviso y puerta de la copia, texto reinsertado fuera de todo almacenamiento) e INV-N02, INV-N04 e INV-N05 sobre el almacén de la pantalla.
// Las E2E de la pantalla están en tests/e2e/reinsercion.spec.ts. Solo datos ficticios evidentes (10.1.5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReinsertion, findMarkersWith } from '../../src/core/reinsert';
import type {
  AsuntoId, DocId, IdSource, MappingEntry, MappingTable, MarkerMatch, ReinsertionDecision, ReinsertionInput,
} from '../../src/core/types';
import { MARKER_FAMILIES, MARKER_LABEL } from '../../src/core/types';
import {
  actualizarReinsercion, buscarMarcadores, decidir, decidirGrupo, elegirOrigen, escribirRespuesta, obtenerReinsercion, reconocerFaltantes,
} from '../../src/ui/reinsercion/almacen';
import {
  agruparPorMarcador, buscarEnTexto, construirLineas, entradaDe, origenDe, pendientesDeDecision, reemplazoDe, reinsercionDisponible,
  subcadena, tramosReales,
} from '../../src/ui/reinsercion/modelo';
import { copiarConDatosReales, copiarSeleccionReal, descargarConDatosReales } from '../../src/ui/reinsercion/salida';
import { vaciarEstadoM } from '../../src/ui/sesion';

// El estado de la pantalla es de módulo: cada prueba parte vacío.
beforeEach(() => { vaciarEstadoM(); });

const D1 = 'doc_00000000000000000000000000000001' as DocId;
const D2 = 'doc_00000000000000000000000000000002' as DocId;

function entrada(marker: string, display: string, doc: DocId): MappingEntry {
  const etiqueta = /^\[(.+)_\d+\]$/u.exec(marker)?.[1] as string;
  const family = MARKER_FAMILIES.find((f) => MARKER_LABEL[f] === etiqueta) as MappingEntry['family'];
  return {
    marker, family, type: 'PERSONA', canonicalKey: `K:${marker}`, display, originals: [display],
    firstSeen: { docId: doc, partKind: 'cuerpo', partOrder: 0, start: 0 }, documents: [doc], sameHolderAs: [],
  };
}
// Tabla de 10.7 (asunto PRUEBA-REI-01).
const TABLA: MappingTable = {
  asuntoId: 'asu_00000000000000000000000000000001' as AsuntoId, counters: {},
  entries: Object.fromEntries([
    ['[DEMANDANTE_1]', 'Ana Ficticia Rojas', D1], ['[CC_1]', '1.000.000.017', D1], ['[DIRECCIÓN_1]', 'Calle 00 n.º 00-00', D1],
    ['[EPS_1]', 'EPS Salud Ficticia S.A.', D1], ['[DOCUMENTO_1]', '1.000.000.025', D2],
  ].map(([m, d, doc]) => [m as string, entrada(m as string, d as string, doc as DocId)])),
  documents: [
    { docId: D1, label: 'Documento 1', source: 'docx', processedAt: '2026-10-30T10:00:00.000Z' },
    { docId: D2, label: 'Documento 2', source: 'pegado', processedAt: '2026-10-30T11:00:00.000Z' },
  ],
};

function seqIds(): IdSource {
  let n = 1;
  return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` };
}
const entrar = (response: string, expectedFrom: DocId | null = D1): ReinsertionInput => entradaDe(response, TABLA, expectedFrom);
const buscar = (response: string, expectedFrom: DocId | null = D1): MarkerMatch[] => findMarkersWith(entrar(response, expectedFrom), seqIds());
const dec = (m: MarkerMatch, action: ReinsertionDecision['action'], text?: string): ReinsertionDecision =>
  text === undefined ? { matchId: m.id, action } : { matchId: m.id, action, text };

// ---------------------------------------------------------------------------------------------

describe('T-RI-10 la reinserción exige la tabla abierta', () => {
  it('con la tabla bloqueada (o sin asunto) la reinserción no está disponible', () => {
    expect(reinsercionDisponible(true, TABLA)).toBe(true);
    expect(reinsercionDisponible(true, null)).toBe(false);
    expect(reinsercionDisponible(false, TABLA)).toBe(false);
    expect(reinsercionDisponible(false, null)).toBe(false);
  });

  it('el documento de origen solo existe si está en la tabla; "No sé o son varios" es null (M-93)', () => {
    expect(origenDe('', TABLA)).toBeNull();
    expect(origenDe(D1, TABLA)).toBe(D1);
    expect(origenDe('doc_ffffffffffffffffffffffffffffffff', TABLA)).toBeNull();
  });
});

describe('INV-N02 la pantalla ofrece cada alerta una a una y solo el resultado completo es ready', () => {
  const TEXTO = '[DEMANDANTE 1] y [CC_1] con [TESTIGO_3] y Demandante 1.';

  it('INV-N02 los alterados y los desconocidos sin decisión son los pendientes; los exactos no piden nada', () => {
    const ms = buscar(TEXTO);
    expect(ms.map((m) => `${m.found}|${m.kind}`)).toEqual(['[DEMANDANTE 1]|alterado', '[CC_1]|exacto', '[TESTIGO_3]|desconocido', 'Demandante 1|alterado']);
    expect(pendientesDeDecision(ms, {}).map((m) => m.found)).toEqual(['[DEMANDANTE 1]', '[TESTIGO_3]', 'Demandante 1']);
  });

  it('un desconocido nunca admite "reemplazar" como decisión válida (INV-N01); "dejar" y "editar" sí', () => {
    const ms = buscar(TEXTO);
    const desconocido = ms.find((m) => m.kind === 'desconocido') as MarkerMatch;
    expect(pendientesDeDecision(ms, { [desconocido.id]: dec(desconocido, 'reemplazar') }).includes(desconocido)).toBe(true);
    expect(pendientesDeDecision(ms, { [desconocido.id]: dec(desconocido, 'dejar') }).includes(desconocido)).toBe(false);
    expect(pendientesDeDecision(ms, { [desconocido.id]: dec(desconocido, 'editar', 'otro texto') }).includes(desconocido)).toBe(false);
  });

  it('ready ⇔ todas las decisiones y los faltantes reconocidos: coincide con el núcleo en cada paso', () => {
    const input = entrar('[DEMANDANTE 1] y [TESTIGO_3].');           // [CC_1], [DIRECCIÓN_1] y [EPS_1] son del documento: faltantes
    const ms = findMarkersWith(input, seqIds());
    const [alterado, desconocido] = ms as [MarkerMatch, MarkerMatch];
    let ds: Record<string, ReinsertionDecision> = {};
    expect(buildReinsertion(input, ms, ds, false).ready).toBe(false);
    ds = { [alterado.id]: dec(alterado, 'reemplazar') };
    expect(buildReinsertion(input, ms, ds, false).ready).toBe(false);
    ds = { ...ds, [desconocido.id]: dec(desconocido, 'dejar') };
    expect(pendientesDeDecision(ms, ds)).toEqual([]);
    expect(buildReinsertion(input, ms, ds, false).ready).toBe(false);   // faltan reconocer los faltantes
    const r = buildReinsertion(input, ms, ds, true);
    expect(r.ready).toBe(true);
    expect(r.alerts.missing.length).toBeGreaterThan(0);
  });

  it('el almacén de la pantalla decide uno a uno, por grupo de un mismo marcador y reconoce los faltantes', () => {
    escribirRespuesta('[DEMANDANTE 1] y Demandante 1 y [TESTIGO_3].');
    elegirOrigen(D1, TABLA);
    buscarMarcadores(TABLA);
    let e = obtenerReinsercion();
    expect(e.matches?.map((m) => m.kind)).toEqual(['alterado', 'alterado', 'desconocido']);
    expect(e.resultado?.ready).toBe(false);
    const [a1, a2, d] = e.matches as [MarkerMatch, MarkerMatch, MarkerMatch];
    decidir(a1.id, 'reemplazar');
    expect(obtenerReinsercion().resultado?.ready).toBe(false);
    decidirGrupo([a1.id, a2.id], 'dejar');                            // las dos apariciones del mismo marcador
    expect(obtenerReinsercion().decisiones[a2.id]?.action).toBe('dejar');
    decidirGrupo([d.id], 'reemplazar');                               // un desconocido ignora "reemplazar" en grupo
    expect(obtenerReinsercion().decisiones[d.id]).toBeUndefined();
    decidir(d.id, 'editar', 'el testigo');
    e = obtenerReinsercion();
    expect(e.resultado?.ready).toBe(false);                           // [CC_1] etc. faltan: hay que reconocerlos
    reconocerFaltantes(true);
    e = obtenerReinsercion();
    expect(e.resultado?.ready).toBe(true);
    expect(e.resultado?.text).toBe('[DEMANDANTE 1] y Demandante 1 y el testigo.');
  });
});

describe('datos reales resaltados (8.4.4): los tramos salen del modelo y se verifican contra el texto', () => {
  const textoDe = (r: { text: string }, rs: Array<{ start: number; end: number }>): string[] => rs.map((x) => r.text.slice(x.start, x.end));

  it('los reemplazos por display son datos reales; lo que se deja como está o se edita no lo es', () => {
    const input = entrar('[DEMANDANTE_1] con [CC_1] y [EPS_1] y [TESTIGO_9] y [DIRECCION_1].');
    const ms = findMarkersWith(input, seqIds());
    const [, , , desconocido, alterado] = ms as [MarkerMatch, MarkerMatch, MarkerMatch, MarkerMatch, MarkerMatch];
    const exactoEps = ms[2] as MarkerMatch;
    const ds = { [desconocido.id]: dec(desconocido, 'editar', 'el testigo'), [alterado.id]: dec(alterado, 'reemplazar'), [exactoEps.id]: dec(exactoEps, 'dejar') };
    const r = buildReinsertion(input, ms, ds, true);
    expect(r.text).toBe('Ana Ficticia Rojas con 1.000.000.017 y [EPS_1] y el testigo y Calle 00 n.º 00-00.');
    const reales = tramosReales(input, r);
    expect(reales).not.toBeNull();
    expect(textoDe(r, reales ?? [])).toEqual(['Ana Ficticia Rojas', '1.000.000.017', 'Calle 00 n.º 00-00']);
  });

  it("un alterado con sufijo pegado reemplaza y conserva el sufijo dentro del tramo ([DEMANDANTE_1]'s)", () => {
    const input = entrar("[DEMANDANTE_1]'s voto.");
    const ms = findMarkersWith(input, seqIds());
    const m = ms[0] as MarkerMatch;
    expect(m.kind).toBe('alterado');
    const r = buildReinsertion(input, ms, { [m.id]: dec(m, 'reemplazar') }, true);
    expect(r.text).toBe("Ana Ficticia Rojas's voto.");
    expect(textoDe(r, tramosReales(input, r) ?? [])).toEqual(["Ana Ficticia Rojas's"]);
    expect(reemplazoDe(TABLA, m, dec(m, 'reemplazar'))).toEqual({ texto: "Ana Ficticia Rojas's", real: true });
  });

  it('si el tramo no coincide con lo que construyó el núcleo, no se resalta nada (null) en lugar de resaltar mal', () => {
    const input = entrar('[DEMANDANTE_1] y [CC_1].');
    const ms = findMarkersWith(input, seqIds());
    const r = buildReinsertion(input, ms, {}, true);
    expect(tramosReales(input, r)).not.toBeNull();
    expect(tramosReales(input, { ...r, text: r.text + ' extra' })).toBeNull();
    expect(tramosReales(input, { ...r, text: r.text.replace('Ana', 'Eva') })).toBeNull();
  });

  it('[CC_1][CC_1] consecutivos: dos tramos reales contiguos (INV-N03)', () => {
    const input = entrar('[CC_1][CC_1]');
    const ms = findMarkersWith(input, seqIds());
    const r = buildReinsertion(input, ms, {}, true);
    expect(r.text).toBe('1.000.000.0171.000.000.017');
    expect(tramosReales(input, r)).toEqual([{ start: 0, end: 13 }, { start: 13, end: 26 }]);
  });
});

describe('vista del resultado: líneas, trozos, coincidencias y copia desde el modelo', () => {
  it('las líneas reconstruyen el texto sin perder ni inventar nada y cada trozo lleva su posición global', () => {
    const texto = 'Señora Ana Ficticia Rojas,\n\ncédula 1.000.000.017.\nFin';
    const reales = [{ start: 7, end: 25 }, { start: 35, end: 48 }];
    const lineas = construirLineas(texto, reales, [{ start: 42, end: 45, actual: true }]);
    const rec = lineas.map((l) => {
      let s = '';
      let pos = l.g0;
      for (const z of l.trozos) { expect(z.g).toBe(pos); s += z.texto; pos += z.texto.length; }
      return s;
    }).join('\n');
    expect(rec).toBe(texto);
    const trozos = lineas.flatMap((l) => l.trozos);
    // La coincidencia de la búsqueda parte el segundo dato real en trozos; juntos son el dato completo.
    expect(trozos.filter((z) => z.real).map((z) => z.texto).join('|')).toBe('Ana Ficticia Rojas|1.000.0|00.|017');
    const actual = trozos.filter((z) => z.actual);
    expect(actual.map((z) => z.texto)).toEqual(['00.']);
    expect(actual[0]?.real).toBe(true);                               // la coincidencia cae dentro de un dato real
    expect(lineas.map((l) => l.trozos.length === 0)).toEqual([false, true, false, false]);
  });

  it('la búsqueda propia ignora tildes y mayúsculas y devuelve posiciones del texto original', () => {
    const texto = 'Dirección: Calle 00. DIRECCION de notificación.';
    const { coincidencias } = buscarEnTexto(texto, 'direccion');
    expect(coincidencias.map((c) => texto.slice(c.start, c.end))).toEqual(['Dirección', 'DIRECCION']);
    expect(buscarEnTexto(texto, 'd').coincidencias).toEqual([]);      // menos de 2 caracteres no busca
    expect(subcadena(texto, 9, 0)).toBe('Dirección');
  });

  it('agruparPorMarcador junta las apariciones de un mismo marcador, en orden, sin mezclar marcadores', () => {
    const ms = buscar('[DEMANDANTE 1], [CC 1], Demandante 1 y [CC 1]');
    const g = agruparPorMarcador(ms.filter((m) => m.kind === 'alterado'));
    expect(g.map((x) => `${x.marcador}:${x.matches.length}`)).toEqual(['[DEMANDANTE_1]:2', '[CC_1]:2']);
  });
});

describe('INV-N04 el texto reinsertado vive solo en memoria y se vacía', () => {
  it('INV-N04 vaciarEstadoM (bloqueo, «Cerrar asunto», «Borrar todo», pagehide) borra la respuesta y el resultado con datos reales', () => {
    escribirRespuesta('[DEMANDANTE_1] presentó la tutela contra [EPS_1].');
    buscarMarcadores(TABLA);
    const antes = obtenerReinsercion();
    expect(antes.resultado?.ready).toBe(true);
    expect(antes.resultado?.text).toBe('Ana Ficticia Rojas presentó la tutela contra EPS Salud Ficticia S.A.');   // sin «S.A..» (PB-4-r1)
    vaciarEstadoM();
    const despues = obtenerReinsercion();
    expect(despues.respuesta).toBe('');
    expect(despues.resultado).toBeNull();
    expect(despues.matches).toBeNull();
    expect(JSON.stringify(despues)).not.toContain('Ficticia');
  });

  it('editar la respuesta invalida lo encontrado y cambiar el origen recalcula los faltantes sin tocar las decisiones', () => {
    escribirRespuesta('[DEMANDANTE_1].');
    elegirOrigen(D1, TABLA);
    buscarMarcadores(TABLA);
    expect(obtenerReinsercion().resultado?.alerts.missing.sort()).toEqual(['[CC_1]', '[DIRECCIÓN_1]', '[EPS_1]']);
    elegirOrigen('', TABLA);
    expect(obtenerReinsercion().resultado?.alerts.missing).toEqual([]);
    escribirRespuesta('[DEMANDANTE_1]. Otra');
    expect(obtenerReinsercion().matches).toBeNull();
    expect(obtenerReinsercion().resultado).toBeNull();
    vaciarEstadoM();
  });
});

describe('INV-N05 copiar o descargar el texto reinsertado exige ready', () => {
  const escribir = vi.fn<(t: string) => Promise<void>>(() => Promise.resolve());
  const ancla = { href: '', download: '', rel: '', hidden: false, click: vi.fn(), remove: vi.fn() };
  const crear = vi.fn(() => ancla);

  beforeEach(() => {
    escribir.mockClear();
    crear.mockClear();
    ancla.click.mockClear();
    vi.stubGlobal('navigator', { clipboard: { writeText: escribir } });
    vi.stubGlobal('document', { createElement: crear, body: { append: vi.fn() } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vaciarEstadoM();
  });

  it('INV-N05 con alertas sin decidir no se copia ni se descarga nada, aunque se invoque la acción', () => {
    escribirRespuesta('[DEMANDANTE 1] presentó la tutela.');
    buscarMarcadores(TABLA);
    expect(obtenerReinsercion().resultado?.ready).toBe(false);
    copiarConDatosReales();
    descargarConDatosReales();
    expect(escribir).not.toHaveBeenCalled();
    expect(crear).not.toHaveBeenCalled();
    const evento = { preventDefault: vi.fn(), clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;
    copiarSeleccionReal(evento, 'Ana');
    expect(evento.preventDefault).toHaveBeenCalled();
    expect(evento.clipboardData?.setData).not.toHaveBeenCalled();
  });

  it('con ready, copiar escribe el texto con datos reales y Ctrl + C escribe solo text/plain; ambos dejan M-124', async () => {
    escribirRespuesta('[DEMANDANTE_1] presentó la tutela contra [EPS_1].');
    buscarMarcadores(TABLA);
    copiarConDatosReales();
    expect(escribir).toHaveBeenCalledWith('Ana Ficticia Rojas presentó la tutela contra EPS Salud Ficticia S.A.');
    await Promise.resolve();
    await Promise.resolve();
    expect(obtenerReinsercion().avisos.map((a) => a.id)).toEqual(['M-124']);
    expect(obtenerReinsercion().copiado).toBe(true);
    actualizarReinsercion({ avisos: [] });
    const setData = vi.fn();
    copiarSeleccionReal({ preventDefault: vi.fn(), clipboardData: { setData } } as unknown as ClipboardEvent, 'Ana Ficticia');
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Ana Ficticia');
    expect(obtenerReinsercion().avisos.map((a) => a.id)).toEqual(['M-124']);
  });

  it('si el navegador no deja copiar, el texto queda en el área de respaldo (M-87) y no en otro sitio', async () => {
    escribir.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    escribirRespuesta('[DEMANDANTE_1] firmó.');
    buscarMarcadores(TABLA);
    copiarConDatosReales();
    await Promise.resolve();
    await Promise.resolve();
    const e = obtenerReinsercion();
    expect(e.respaldo).toBe('Ana Ficticia Rojas firmó.');
    expect(e.avisos.map((a) => a.id)).toEqual(['M-87']);
    expect(JSON.stringify(e.avisos)).not.toContain('NotAllowed');
  });
});
