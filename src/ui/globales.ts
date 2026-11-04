// Manejadores globales (8.2.1, 8.7): soltar archivos, Ctrl+S, Ctrl+F / F3 e impresión.
// Se registran antes del primer render y valen en todas las pantallas (también `sin_sw`).
import { useEffect, useState } from 'preact/hooks';
import { obtener } from './estado.ts';
import { t, type MessageId, type MsgParam } from './mensajes.ts';
import { ATRIBUTO_PROPIO, vigilarExtensiones } from './extensiones.ts';

/** Marca la zona de soltar de Entrada (PC-2): el resto del documento ignora los archivos soltados. */
export const ATRIBUTO_ZONA_SOLTAR = 'data-zona-soltar';

export interface AvisoGlobal { id: MessageId; params?: Readonly<Record<string, MsgParam>> }
let aviso: AvisoGlobal | null = null;
let temporizador: ReturnType<typeof setTimeout> | undefined;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

/** Aviso breve en la región viva del armazón (M-125, M-126…); desaparece solo. */
export function mostrarAvisoGlobal(id: MessageId, params?: Readonly<Record<string, MsgParam>>, ms = 10_000): void {
  aviso = params ? { id, params } : { id };
  avisar();
  if (temporizador !== undefined) clearTimeout(temporizador);
  temporizador = setTimeout(() => { aviso = null; avisar(); }, ms);
}
export function ocultarAvisoGlobal(): void {
  aviso = null;
  avisar();
}
export function useAvisoGlobal(): AvisoGlobal | null {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return aviso;
}

let busqueda: (() => void) | null = null;
/** La pantalla (Revisión, Listo, Reinserción) registra su búsqueda propia; devuelve la baja. */
export function registrarBusqueda(abrir: () => void): () => void {
  busqueda = abrir;
  return () => { if (busqueda === abrir) busqueda = null; };
}

// F3: «Revisar dato por dato» (`detalle`) es la Revisión de la v1.0, con su búsqueda propia (V-29).
const PANTALLAS_CON_BUSQUEDA = new Set(['revision', 'detalle', 'listo', 'reinsercion']);

function dentroDeZona(e: Event): boolean {
  const o = e.target;
  return o instanceof Element && o.closest(`[${ATRIBUTO_ZONA_SOLTAR}]`) !== null;
}

let registrado = false;
/** Idempotente. Devuelve la baja (pruebas). */
export function registrarManejadoresGlobales(): () => void {
  if (registrado) return () => undefined;
  registrado = true;
  const alArrastrar = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer && !dentroDeZona(e)) e.dataTransfer.dropEffect = 'none';
  };
  const alSoltar = (e: DragEvent): void => {
    // El navegador no debe abrir el archivo en la pestaña: su nombre iría a la URL, al título y al historial (V-05, V-37).
    e.preventDefault();
  };
  const alTeclear = (e: KeyboardEvent): void => {
    const tecla = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && tecla === 's') {
      e.preventDefault();
      mostrarAvisoGlobal('M-125');
      return;
    }
    const buscar = ((e.ctrlKey || e.metaKey) && tecla === 'f') || e.key === 'F3';
    if (buscar && busqueda !== null && PANTALLAS_CON_BUSQUEDA.has(obtener().screen)) {
      e.preventDefault();
      busqueda();
    }
  };
  addEventListener('dragover', alArrastrar, true);
  addEventListener('drop', alSoltar, true);
  addEventListener('keydown', alTeclear);
  // Impresión: se oculta todo salvo un párrafo con M-126 (el CSS está en base.css). Se crea con la API de DOM.
  const p = document.createElement('p');
  p.className = 'solo-impresion';
  p.setAttribute(ATRIBUTO_PROPIO, '');   // F8: nodo propio fuera de #app (no es de una extensión)
  p.textContent = t('M-126');
  document.body.appendChild(p);
  // F8 (v1.1.1): aviso si una extensión cuelga un nodo de la página (solo presencia; ver extensiones.ts).
  const dejarDeVigilar = vigilarExtensiones();
  return () => {
    dejarDeVigilar();
    removeEventListener('dragover', alArrastrar, true);
    removeEventListener('drop', alSoltar, true);
    removeEventListener('keydown', alTeclear);
    p.remove();
    registrado = false;
  };
}
