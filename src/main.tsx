import { render } from 'preact';
import { neutralizarWebRTC } from './arranque.ts';
import { App } from './ui/App.tsx';
import { registrarServiceWorker } from './ui/sw-registro.ts';

neutralizarWebRTC();
registrarServiceWorker();
if (__SIGLOW_MEDICION__) {
  // Ranura del gancho de medición (PG-3b). Solo existe en el build --mode medicion; check-dist lo prohíbe en dist/.
  void import('./medicion/gancho.ts').then((m) => m.instalarGancho());
}
const raiz = document.getElementById('app');
if (raiz) render(<App />, raiz);
