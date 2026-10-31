import { render } from 'preact';
import { neutralizarWebRTC } from './arranque.ts';
import { readPdf } from './io/pdf-read.ts';
import { App } from './ui/App.tsx';
import { instalarPuertos } from './ui/servicios.ts';
import { registrarServiceWorker } from './ui/sw-registro.ts';

neutralizarWebRTC();
// PE-4-r2: el lector de PDF (pdf.js se importa de forma dinámica al leer el primer PDF; su worker es un archivo propio del mismo origen).
instalarPuertos({ pdf: readPdf });
registrarServiceWorker();
if (__SIGLOW_MEDICION__) {
  // Ranura del gancho de medición (PG-3b). Solo existe en el build --mode medicion; check-dist lo prohíbe en dist/.
  void import('./medicion/gancho.ts').then((m) => m.instalarGancho());
}
const raiz = document.getElementById('app');
if (raiz) render(<App />, raiz);
