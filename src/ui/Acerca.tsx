// «Acerca de» y «Créditos y licencias» (8.2.11): <dialog> abierto desde el pie, sin ruta.
import { useEffect, useState } from 'preact/hooks';
import { Dialogo } from './dialogo.tsx';
import { actualizar, useShell } from './estado.ts';
import { calcularHuellas, DIRECCION_OFICIAL, type Huellas } from './huellas.ts';
import { GRUPOS_LICENCIAS } from './licencias.ts';
import { ROTULOS, t, X } from './mensajes.ts';

const lista = (ids: ReadonlyArray<`M-${number}`>) => (
  <ul>
    {ids.map((id) => <li key={id}>{t(id)}</li>)}
  </ul>
);

function Acerca({ huellas }: { huellas: Huellas | null }) {
  const sinCache = t('M-154');
  return (
    <>
      <section aria-labelledby="ac-que">
        <h3 id="ac-que">{t('M-131')}</h3>
        <p>{t('M-01')}</p>
        {lista(['M-132', 'M-133', 'M-134', 'M-135'])}
      </section>
      <section aria-labelledby="ac-aviso" data-prueba="acerca-aviso">
        <h3 id="ac-aviso">{t('M-1901')}</h3>
        <p>{t('M-1902')}</p>
        <p>{t('M-1903')}</p>
        <p>{t('M-1904')}</p>
      </section>
      <section aria-labelledby="ac-no">
        <h3 id="ac-no">{t('M-136')}</h3>
        {lista(['M-137', 'M-138', 'M-139', 'M-140', 'M-141', 'M-142', 'M-143', 'M-144', 'M-145', 'M-146'])}
        <p>{t('M-147')}</p>
      </section>
      <section>
        <p>{t('M-148')}</p>
      </section>
      <section aria-labelledby="ac-version">
        <h3 id="ac-version">{t('M-149', { version: __SIGLOW_VERSION__ })}</h3>
        <p data-prueba="acerca-index">{t('M-150', { sha: huellas?.indexHtml ?? sinCache })}</p>
        <p data-prueba="acerca-precache">{t('M-151', { sha: huellas?.precache ?? sinCache })}</p>
        <p>{t('M-152')}</p>
        <p data-prueba="acerca-direccion">{t('M-153', { direccion: DIRECCION_OFICIAL })}</p>
      </section>
    </>
  );
}

function Creditos() {
  return (
    <div class="creditos" data-prueba="creditos">
      {GRUPOS_LICENCIAS.map((g) => (
        <section key={g.titulo} aria-label={g.titulo}>
          <h3>{g.titulo}</h3>
          {g.intro ? <p>{g.intro}</p> : null}
          {g.avisos.map((a) => (
            <article key={a.componente} class="aviso-licencia">
              <h4>
                {a.componente}
                {a.version ? ` ${a.version}` : ''}
                {' · '}
                {a.licencia}
              </h4>
              {a.aviso.map((p, i) => <p key={i}>{p}</p>)}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export function DialogosAcerca() {
  const { dialog } = useShell();
  const [huellas, setHuellas] = useState<Huellas | null>(null);
  useEffect(() => {
    if (dialog !== 'acerca') return;
    let vivo = true;
    void calcularHuellas().then((h) => { if (vivo) setHuellas(h); });
    return () => { vivo = false; };
  }, [dialog]);
  const cerrar = (): void => { actualizar({ dialog: null }); };
  return (
    <>
      <Dialogo abierto={dialog === 'acerca'} titulo={t('M-130')} onCerrar={cerrar} clase="ancho">
        <Acerca huellas={huellas} />
        <div class="acciones">
          <button type="button" class="secundario" onClick={() => { actualizar({ dialog: 'creditos' }); }}>{t('M-155')}</button>
          <button type="button" onClick={cerrar}>{t(X.cerrar)}</button>
        </div>
      </Dialogo>
      <Dialogo abierto={dialog === 'creditos'} titulo={t(ROTULOS.creditos_y_licencias)} onCerrar={cerrar} clase="ancho">
        <Creditos />
        <div class="acciones">
          <button type="button" onClick={cerrar}>{t(X.cerrar)}</button>
        </div>
      </Dialogo>
    </>
  );
}
