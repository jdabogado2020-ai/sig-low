// Estado `sin_sw` (8.2.10, 8.3): M-35 + M-36, o M-38 sin https. Ningún campo de contenido se monta.
import { useShell } from './estado.ts';
import { t, X } from './mensajes.ts';

export function SinServiceWorker() {
  const { error } = useShell();
  const sinHttps = error?.code === 'CONTEXTO_NO_SEGURO';
  return (
    <>
      <h1 tabIndex={-1}>{t('M-35')}</h1>
      <p data-prueba="promesa" class="promesa">{t('M-01')}</p>
      <div role="alert" data-prueba="sin-sw">
        <p>{sinHttps ? t('M-38') : t('M-36')}</p>
      </div>
      {sinHttps ? null : (
        <div class="acciones">
          <button type="button" onClick={() => { location.reload(); }}>{t(X.recargar)}</button>
        </div>
      )}
    </>
  );
}
