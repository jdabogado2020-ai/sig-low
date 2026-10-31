// Registro de pantallas (8.1). Cada tarea PC-n sustituye su entrada por su componente; las que aún no existen
// muestran solo el título (marcador de A2: PC-2 a PC-6 reemplazan estas entradas).
import type { ComponentType } from 'preact';
import { Inicio } from './Inicio.tsx';
import { Entrada } from './Entrada.tsx';
import { ListaCaso } from './ListaCaso.tsx';
import { Procesando } from './Procesando.tsx';
import { RevisionBase } from './review/base/RevisionBase.tsx';
import { useShell, type Screen } from './estado.ts';
import { NOMBRE_PANTALLA } from './Armazon.tsx';
import { t } from './mensajes.ts';

function PantallaPendiente() {
  const { screen } = useShell();
  return <h1 tabIndex={-1}>{t(NOMBRE_PANTALLA[screen])}</h1>;
}

export const PANTALLAS: Partial<Record<Screen, ComponentType>> = {
  inicio: Inicio,
  lista: ListaCaso,
  entrada: Entrada,
  procesando: Procesando,
  revision: RevisionBase,
};

export function componenteDe(pantalla: Screen): ComponentType {
  return PANTALLAS[pantalla] ?? PantallaPendiente;
}
