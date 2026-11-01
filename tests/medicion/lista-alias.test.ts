// T-ME-02 · los alias de la lista del caso del corpus (CORPUS-1, D-16, S-10.4).
// El abogado conoce formas que el motor no puede derivar (el apodo «Fercho», la sigla «AGEX»): las agrega como variantes manuales
// (6.5, 7.9.4, «Agregar variante» de la vista previa). `listaDelCaso[].alias` del gold las trae y el arnés las pasa a `caselist.ts`.
// Corpus sintético y ficticio (10.1.5) para la mecánica; el corpus real para comprobar que cada alias aprobado se encuentra.
import { describe, expect, it } from 'vitest';
import { searchCaseList } from '../../src/core/caselist.ts';
import type { CaseEntity, Part } from '../../src/core/types.ts';
import type { GoldDocument } from '../../scripts/metrics.ts';
import { armarDocumento, cargarCorpus, idsSecuenciales, variantesDeAlias } from './lib/corpus.ts';

type GoldConLista = GoldDocument & { listaDelCaso: Array<{ name: string; role: string; alias?: string[] }>; esperado: { partes: [] } };

const TEXTO = 'Dice el correo que el negocio es de Fercho con Distribuidora Ejemplo, y que AGEX responde por la entrega.';

function documento(lista: GoldConLista['listaDelCaso']) {
  const gold = { docId: 'C01', conjunto: 'desarrollo', entidades: [], anotaciones: [], listaDelCaso: lista, esperado: { partes: [] } } as unknown as GoldConLista;
  return armarDocumento(gold, { docId: 'C01', partes: [{ kind: 'cuerpo', index: 1, texto: TEXTO }] }, idsSecuenciales(1));
}

const LISTA = [
  { name: 'Nicolás Ficticio Gómez', role: 'CLIENTE', alias: ['Fercho'] },
  { name: 'Agroindustrias Ejemplo S.A.', role: 'EMPRESA', alias: ['AGEX'] },
];

describe('T-ME-02 · alias de la lista del caso en el arnés (D-16)', () => {
  it('T-ME-02 un alias es una variante manual de clase exacta, confianza alta y activa; sin vacíos ni repetidos', () => {
    expect(variantesDeAlias(['  Fercho ', 'Fercho', '', '   '])).toEqual([
      { text: 'Fercho', class: 'exacta', confidence: 'alta', enabled: true, origin: 'manual' },
    ]);
    expect(variantesDeAlias(undefined)).toEqual([]);
  });

  it('T-ME-02 el arnés pasa los alias a la lista del caso y refreshVariants los conserva junto a las generadas', () => {
    const d = documento(LISTA);
    const nicolas = d.caseList[0] as CaseEntity;
    const manuales = nicolas.variants.filter((v) => v.origin === 'manual').map((v) => v.text);
    expect(manuales).toEqual(['Fercho']);
    expect(nicolas.variants.some((v) => v.origin === 'generada' && v.class === 'exacta' && v.text === 'Nicolás Ficticio Gómez')).toBe(true);
    expect((d.caseList[1] as CaseEntity).variants.filter((v) => v.origin === 'manual').map((v) => v.text)).toEqual(['AGEX']);
  });

  it('T-ME-02 con el alias, «Fercho» y «AGEX» son menciones de la lista de su entidad; sin él, el motor no las liga', () => {
    const con = documento(LISTA);
    const part = con.doc.parts[0] as Part;
    const halladas = searchCaseList(part, con.caseList);
    const de = (texto: string) => halladas.find((h) => part.text.slice(h.start, h.end) === texto);
    expect(de('Fercho')).toMatchObject({ caseEntityId: (con.caseList[0] as CaseEntity).id, source: 'lista', confidence: 'alta', canonicalKey: `LISTA:${(con.caseList[0] as CaseEntity).id}` });
    expect(de('AGEX')).toMatchObject({ caseEntityId: (con.caseList[1] as CaseEntity).id, source: 'lista', confidence: 'alta' });

    const sin = documento(LISTA.map(({ name, role }) => ({ name, role })));
    const partSin = sin.doc.parts[0] as Part;
    const textos = searchCaseList(partSin, sin.caseList).map((h) => partSin.text.slice(h.start, h.end));
    expect(textos).not.toContain('Fercho');
    expect(textos).not.toContain('AGEX');
  });
});

describe('T-ME-02 · alias aprobados del corpus (D-16)', () => {
  const corpus = cargarCorpus('todo');
  const conAlias = corpus.filter((c) => (c.gold as unknown as GoldConLista).listaDelCaso.some((l) => (l.alias ?? []).length > 0));

  it('T-ME-02 los documentos del corpus con alias son los aprobados por el dueño', () => {
    expect(conAlias.map((c) => c.docId).sort()).toEqual(['C06', 'C11', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22']);
  });

  it('T-ME-02 cada mención gold de un alias la encuentra la lista, con la entidad del gold, en la posición del gold', () => {
    for (const c of conAlias) {
      const lista = (c.gold as unknown as GoldConLista).listaDelCaso;
      const alias = new Map<string, number>(); // alias → índice de la entrada en la lista
      lista.forEach((l, i) => { for (const a of l.alias ?? []) alias.set(a, i); });
      for (const a of c.gold.anotaciones) {
        const i = alias.get(a.texto);
        if (i === undefined) continue;
        const clave = `${a.parte.kind}|${a.parte.index}|${a.parte.page ?? ''}`;
        const part = c.doc.parts.find((p) => c.claveDe.get(p.id) !== undefined && p.kind === a.parte.kind && p.index === a.parte.index) as Part;
        expect(part, `${a.id} parte ${clave}`).toBeDefined();
        const h = searchCaseList(part, c.caseList).find((x) => x.start === a.start && x.end === a.end);
        expect(h, `${a.id} «alias»`).toBeDefined();
        expect(h?.caseEntityId, `${a.id} entidad`).toBe((c.caseList[i] as CaseEntity).id);
      }
    }
  });
});
