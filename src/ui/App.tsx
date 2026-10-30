// Shell de la aplicación (PC-1): arranque, navegación por estado (sin rutas), armazón común y pantallas.
import './base.css';
import { useEffect } from 'preact/hooks';
import { Armazon } from './Armazon.tsx';
import { DialogosAcerca } from './Acerca.tsx';
import { iniciarArranque } from './arranque-sw.ts';
import { instalarBloqueo } from './bloqueo.ts';
import { useArranque, useShell } from './estado.ts';
import { registrarManejadoresGlobales } from './globales.ts';
import { CATALOGO } from './mensajes-catalogo.ts';
import { t, X } from './mensajes.ts';
import { componenteDe } from './pantallas.tsx';
import { SinServiceWorker } from './SinServiceWorker.tsx';

/** M-01, literal (8.5). Lo usan las pruebas de humo y de cero red vía `data-prueba="promesa"`. */
export const PROMESA = CATALOGO['M-01'] ?? '';

// Soltar archivos, Ctrl+S, Ctrl+F e impresión: antes del primer render y en todas las pantallas (8.2.1).
registrarManejadoresGlobales();

function Preparando() {
  const { swInstall } = useShell();
  return (
    <>
      <h1 tabIndex={-1}>{t(X.arranque)}</h1>
      <p data-prueba="promesa" class="promesa">{PROMESA}</p>
      {swInstall ? <p role="status">{t('M-37', { hecho: swInstall.done, total: swInstall.total })}</p> : null}
    </>
  );
}

export function App() {
  const shell = useShell();
  const arranque = useArranque();
  useEffect(() => {
    const detenerArranque = iniciarArranque();
    const detenerBloqueo = instalarBloqueo();
    return () => { detenerArranque(); detenerBloqueo(); };
  }, []);

  let contenido;
  if (shell.screen === 'sin_sw') contenido = <SinServiceWorker />;
  else if (arranque !== 'listo') contenido = <Preparando />;
  else {
    const Pantalla = componenteDe(shell.screen);
    contenido = <Pantalla />;
  }
  return (
    <>
      <Armazon pantalla={shell.screen}>{contenido}</Armazon>
      <DialogosAcerca />
    </>
  );
}
