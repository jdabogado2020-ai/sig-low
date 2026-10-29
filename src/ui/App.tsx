// Shell mínimo de P0-1. PC-1 (A2) lo reemplaza: navegación, estados globales e Inicio.
export const PROMESA =
  'Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.';

export function App() {
  return (
    <main>
      <h1>Sig-Low</h1>
      <p data-prueba="promesa">{PROMESA}</p>
    </main>
  );
}
