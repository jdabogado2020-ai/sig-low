# Política de privacidad de Sig-Low

> **Borrador para revisión del dueño.** Este texto no es definitivo ni se publica hasta que el dueño, como abogado, lo apruebe por escrito. Todo lo marcado [VERIFICAR] está pendiente de confirmación.

Versión del borrador: 1 · Fecha del borrador: 30 de octubre de 2026 · Fecha de vigencia: [VERIFICAR: la fija el dueño al aprobar el texto]

## 1. Qué es Sig-Low y a quién se dirige este texto

Sig-Low es una herramienta web para abogados y despachos. Ayuda a reemplazar nombres, números de identificación, direcciones y otros datos de un documento jurídico por marcadores, antes de que la persona use el texto en otra herramienta. La dirección oficial es `sig-low.vergarameloabogado.site` [VERIFICAR: nombre exacto del subdominio al publicar].

Este texto explica qué datos trata Sig-Low, cuáles no trata, qué ve el sitio que la aloja y qué queda bajo el control de quien la usa. Está escrito conforme a la Ley 1581 de 2012 (régimen general de protección de datos personales) y a las normas que la reglamentan [VERIFICAR: normas reglamentarias vigentes al publicar].

## 2. La promesa de Sig-Low

La única promesa de Sig-Low es esta, tal como aparece en la aplicación:

> Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.

No hay otra promesa en este texto ni en la aplicación.

## 3. Qué hace la aplicación con sus documentos

1. **Procesa el documento en su navegador.** La lectura del archivo, la búsqueda de datos y la propuesta de reemplazos ocurren en su equipo. El modelo de apoyo que ayuda a detectar nombres y otros datos viaja con la aplicación y se ejecuta también en su equipo.
2. **No envía el contenido de sus documentos a ningún servidor.** Sig-Low no tiene un servidor propio que reciba documentos, textos, detecciones o tablas de correspondencia. La aplicación está construida para no abrir conexiones con ese fin, y esa conducta se comprueba con pruebas automáticas antes de cada versión.
3. **Usted aprueba cada reemplazo.** La herramienta propone y le muestra lo que puede quedar sin reemplazar; usted decide antes de copiar o descargar el resultado.
4. **No le pide datos para funcionar.** Sig-Low no pide registro, no crea cuentas y no le solicita sus datos personales.

## 4. Qué se guarda en su equipo

Sig-Low puede guardar información **solo en el navegador de su equipo**, nunca en un servidor:

| Qué | Cuándo | Cómo queda |
|---|---|---|
| La tabla de correspondencia (qué dato real corresponde a cada marcador) | Solo si usted elige guardarla | Cifrada con una frase de paso que solo usted conoce. La frase no tiene recuperación: si la olvida, la tabla se pierde. |
| El código del asunto | Si crea un asunto | Sin cifrar. Por eso la aplicación le pide un código interno (por ejemplo, PRUEBA-001) y no nombres del cliente ni de las partes. |
| Los archivos de la propia aplicación y del modelo de apoyo | Al abrirla | Se guardan en el almacenamiento del navegador para que funcione sin conexión. No contienen sus documentos. |

Sig-Low no usa cookies, no usa herramientas de analítica ni de rastreo y no instala identificadores publicitarios. Usted puede borrar lo que Sig-Low guarda desde la propia aplicación o desde los ajustes de su navegador. Si trabaja en una ventana privada, lo guardado se borra al cerrarla.

Lo que usted copie o descargue fuera de Sig-Low (el original, el texto con marcadores, el texto reinsertado, la tabla) deja de estar bajo el control de la aplicación y queda bajo su cuidado.

## 5. Qué ve el sitio que aloja Sig-Low

Toda página web, para cargarse, deja unos datos mínimos de la visita en el sitio que la sirve. Sig-Low está alojada en Cloudflare Pages, mediante carga directa de los archivos, sin funciones de servidor y sin el servicio de analítica web del proveedor.

Al cargar la aplicación, el alojamiento puede ver y registrar:

- su **dirección IP**;
- la **fecha y hora** de la solicitud;
- las **rutas de los recursos estáticos** que su navegador pide (por ejemplo, `/`, `/sw.js` o los archivos del modelo) y los datos técnicos que todo navegador envía en esas solicitudes [VERIFICAR: lista exacta de campos que registra el proveedor].

El alojamiento **no ve el contenido de sus documentos**, porque este nunca se envía. Por defecto, el proveedor agrega a sus respuestas una cabecera técnica de acceso entre orígenes (`Access-Control-Allow-Origin`); es una instrucción para el navegador y no expone contenido.

Estos registros son una consecuencia de cualquier carga web. Sig-Low no los usa para identificarlo, perfilarlo ni rastrearlo. Por prudencia, este texto los trata como datos personales (Ley 1581 de 2012, artículo 3, literal c) [VERIFICAR: criterio definitivo con asesoría legal].

[VERIFICAR: qué acceso tiene el dueño al panel del proveedor y qué plazo de retención aplica el proveedor.]

El sitio personal del dueño es otro origen: no comparte con Sig-Low almacenamiento, caché ni cookies, y Sig-Low no lee cookies.

## 6. Responsable, finalidad, conservación y transferencia

| Aspecto | Contenido |
|---|---|
| Responsable de los registros del alojamiento | [VERIFICAR: nombre completo, documento, domicilio y correo de contacto del dueño o de la persona jurídica que publica Sig-Low] |
| Encargado | Cloudflare, como proveedor del alojamiento [VERIFICAR: calidad de encargado, contrato y condiciones aplicables] |
| Finalidad | Entregar la aplicación a quien la abre y mantener el servicio. No hay finalidad comercial, de publicidad ni de perfilamiento. |
| Conservación | La que aplica el proveedor del alojamiento [VERIFICAR: plazo]. |
| Transferencia o transmisión internacional | El proveedor puede tratar los registros fuera de Colombia [VERIFICAR: ubicación y condiciones contractuales; Ley 1581 de 2012, artículos 26 y 27, y normas reglamentarias]. |
| Autorización | El uso de Sig-Low implica la carga de la página y, con ella, los registros descritos en el punto 5 [VERIFICAR: si se requiere aviso o autorización expresa y cómo se obtiene]. |

## 7. Los datos de sus documentos

Sig-Low no recibe los documentos que usted procesa. Por eso:

- quien usa Sig-Low (el abogado o el despacho) sigue siendo responsable del tratamiento de los datos personales de esos documentos, incluidos los datos sensibles y los de niñas, niños y adolescentes, y de la autorización o la base legal con que los trata [VERIFICAR: redacción con asesoría legal];
- la revisión del resultado es **responsabilidad del abogado**: Sig-Low propone y puede dejar datos sin detectar; la persona lee todo el texto antes de copiarlo;
- reemplazar nombres por marcadores es **seudonimizar**, no anonimizar: con la tabla de correspondencia, los datos siguen siendo personales, y combinados con otros datos indirectos pueden permitir identificar a una persona.

## 8. Lo que Sig-Low no puede impedir

Estas situaciones ocurren fuera de la aplicación y Sig-Low no las controla:

- asistentes de IA integrados en el navegador, extensiones, capturas y grabaciones de pantalla, personas que miran la pantalla y funciones del navegador que no respetan las indicaciones de la página;
- el historial del portapapeles y su sincronización en la nube;
- informes de fallos, memoria y disco, que pueden conservar restos de lo procesado;
- lo que haga con el texto la herramienta de IA donde usted lo pegue;
- un equipo comprometido, o una copia no oficial de Sig-Low: use solo la dirección oficial;
- las copias que usted haga fuera de la aplicación;
- la pérdida de la tabla si olvida la frase de paso o el navegador borra sus datos;
- los datos que nadie detectó y la reidentificación por datos indirectos.

Estas limitaciones, con lo que usted puede hacer frente a cada una, también se explican dentro de la aplicación, en «Acerca de».

## 9. Menores de edad

Sig-Low está dirigida a profesionales del derecho. No recoge datos de menores para sí misma. Los documentos que usted procese pueden contener datos de niñas, niños y adolescentes; el tratamiento de esos datos es responsabilidad de quien usa la herramienta (punto 7).

## 10. Derechos y contacto

Como titular de datos personales, usted puede conocer, actualizar, rectificar y suprimir sus datos, solicitar prueba de la autorización, ser informado del uso que se les da, presentar quejas ante la Superintendencia de Industria y Comercio y revocar la autorización en los casos que la ley permita (Ley 1581 de 2012, artículo 8) [VERIFICAR: alcance frente a registros que lleva un proveedor externo].

Para ejercerlos, escriba a [VERIFICAR: correo de contacto]. El responsable atenderá las consultas y los reclamos en los plazos de la ley [VERIFICAR: procedimiento y plazos].

## 11. Cambios

Este texto puede cambiar. La versión vigente es la que acompaña a la versión de Sig-Low que usted usa. Las versiones nuevas de la aplicación se aplican al abrir Sig-Low con todas sus pestañas cerradas [VERIFICAR: cómo se avisará un cambio de esta política].

## 12. Créditos y licencias

Sig-Low usa componentes de terceros con sus propias licencias. Su lista, con los avisos y las atribuciones que exigen, está en «Créditos y licencias» (dentro de «Acerca de» en la aplicación) y en el archivo `LICENSES.md` del repositorio. Las condiciones de uso de la aplicación están en los términos de uso (`docs/legal/terminos-de-uso.md`).
