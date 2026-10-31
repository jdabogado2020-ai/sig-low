import './guard.ts'; // Primer import: la guardia de 5.2.1 se instala antes que cualquier otro módulo (PD-2-r1).
import { render } from 'preact';
import { readPdf } from './io/pdf-read.ts';
import { App } from './ui/App.tsx';
import { modeloPuerto } from './ui/modelo-puerto.ts';
import { nerPuerto } from './ui/ner-puerto.ts';
import { instalarPuertos } from './ui/servicios.ts';
import { registrarServiceWorker } from './ui/sw-registro.ts';

// PE-4-r2: el lector de PDF (pdf.js se importa de forma dinámica al leer el primer PDF; su worker es un archivo propio del mismo origen).
instalarPuertos({ pdf: readPdf });
// PF-2: entrega del modelo (descarga a pedido, respaldo automático) y worker `ner` (acuerdo F-13 de la tarjeta).
instalarPuertos({ modelo: modeloPuerto, ner: nerPuerto });
registrarServiceWorker();
if (__SIGLOW_MEDICION__) {
  // Ranura del gancho de medición (PG-3b). Solo existe en el build --mode medicion; check-dist lo prohíbe en dist/.
  void import('./medicion/gancho.ts').then((m) => m.instalarGancho());
}
const raiz = document.getElementById('app');
if (raiz) render(<App />, raiz);
