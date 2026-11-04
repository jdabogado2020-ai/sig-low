// Registro de pantallas (8.1). Cada tarea PC-n sustituye su entrada por su componente; las que aún no existen
// muestran solo el título (marcador de A2: PC-2 a PC-6 reemplazaron estas entradas; con PC-6 solo queda `sin_sw`, que arma App).
import type { ComponentType } from 'preact';
import { Inicio } from './Inicio.tsx';
import { Listo } from './Listo.tsx';
import { BandaResiduos } from './listo/BandaResiduos.tsx';
import { Boveda } from './Boveda.tsx';
import { ListaCaso } from './ListaCaso.tsx';
import { Procesando } from './Procesando.tsx';
import { Reinsercion } from './Reinsercion.tsx';
import { RevisionBase } from './review/base/RevisionBase.tsx';
import { VistaPrevia } from './vista/VistaPrevia.tsx';
import { useShell, type Screen } from './estado.ts';
import { NOMBRE_PANTALLA } from './Armazon.tsx';
import { t } from './mensajes.ts';

function PantallaPendiente() {
  const { screen } = useShell();
  return <h1 tabIndex={-1}>{t(NOMBRE_PANTALLA[screen])}</h1>;
}

/** Revisión dato por dato (PC-3; F3: «Revisar dato por dato» desde la vista previa) con la banda de residuos incorporados de Listo (8.2.6, PC-5) encima: aparece solo al volver de Listo con hallazgos. */
function RevisionConResiduos() {
  return (
    <>
      <BandaResiduos />
      <RevisionBase />
    </>
  );
}

export const PANTALLAS: Partial<Record<Screen, ComponentType>> = {
  inicio: Inicio,
  lista: ListaCaso,
  entrada: Inicio,           // F2: la carga vive en Inicio («Cargar documento»)
  procesando: Procesando,
  revision: VistaPrevia,     // F3: la vista previa editable (D-24)
  detalle: RevisionConResiduos,   // F3: «Revisar dato por dato», la revisión de la v1.0
  listo: Listo,
  reinsercion: Reinsercion,
  boveda: Boveda,
};

export function componenteDe(pantalla: Screen): ComponentType {
  return PANTALLAS[pantalla] ?? PantallaPendiente;
}
