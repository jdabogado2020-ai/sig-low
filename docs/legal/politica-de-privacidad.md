# Política de privacidad de Sig-Low

Versión 1 · Fecha de vigencia: 2 de noviembre de 2026

## 1. Qué es Sig-Low y a quién se dirige este texto

Sig-Low es una herramienta web para abogados y despachos. Ayuda a reemplazar nombres, números de identificación, direcciones y otros datos de un documento jurídico por marcadores, antes de que la persona use el texto en otra herramienta. La dirección oficial es `https://sig-low.vergarameloabogado.site`.

Este texto explica qué datos trata Sig-Low, cuáles no trata, qué ve el sitio que la aloja y qué queda bajo el control de quien la usa. Está escrito conforme a la Ley 1581 de 2012 (régimen general de protección de datos personales) y a las normas que la reglamentan.

## 2. La promesa de Sig-Low

La única promesa de Sig-Low es esta, tal como aparece en la aplicación:

> Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.

No hay otra promesa en este texto ni en la aplicación.

## 3. Qué hace la aplicación con sus documentos

1. **Procesa el documento en su navegador.** La lectura del archivo, la búsqueda de datos y la propuesta de reemplazos ocurren en su equipo. El modelo de apoyo que ayuda a detectar nombres y otros datos viaja con la aplicación y se ejecuta también en su equipo.
2. **No envía el contenido de sus documentos a ningún servidor.** Sig-Low no tiene un servidor propio que reciba documentos, textos, detecciones o tablas de correspondencia. La aplicación está construida para no abrir conexiones con ese fin, y esa conducta se comprueba con pruebas automáticas antes de cada versión.
3. **Usted aprueba cada reemplazo.** La herramienta propone y le muestra lo que puede quedar sin reemplazar; usted decide antes de copiar o descargar el resultado.
4. **No le pide datos para funcionar.** Sig-Low no pide registro, no crea cuentas y no le solicita sus datos personales.

**Quién trata qué.** Tal como está construida, Sig-Low procesa los documentos solo en el navegador de quien la usa. Ni GRUPO EMPRESARIAL NEW WAY S.A.S ni el alojamiento reciben, ven ni almacenan el texto de los documentos, los datos detectados, la tabla de reemplazos ni la bóveda cifrada. Por eso la sociedad no es responsable ni encargada del tratamiento de los datos personales que contienen los documentos del usuario: el usuario (el abogado o la firma) sigue siendo el único responsable de esos datos frente a sus titulares, y de sus deberes bajo la Ley 1581 de 2012 y del secreto profesional (punto 7). Lo único que trata la sociedad, por medio de su encargado, son los registros técnicos de acceso que describen los puntos 5 y 6. Esto describe cómo funciona la aplicación; no es una promesa distinta de la del punto 2.

## 4. Qué se guarda en su equipo

Sig-Low puede guardar información **solo en el navegador de su equipo**, nunca en un servidor:

| Qué | Cuándo | Cómo queda |
|---|---|---|
| La tabla de correspondencia (qué dato real corresponde a cada marcador) | Solo si usted elige guardarla | Cifrada con una frase de paso que solo usted conoce. La frase no tiene recuperación: si la olvida, la tabla se pierde. |
| El código del asunto | Si crea un asunto | Sin cifrar. Por eso la aplicación le pide un código interno (por ejemplo, PRUEBA-001) y no nombres del cliente ni de las partes. |
| Los archivos de la propia aplicación y del modelo de apoyo | Al abrirla | Se guardan en el almacenamiento del navegador para que funcione sin conexión. No contienen sus documentos. |

Sig-Low no usa cookies, no usa herramientas de analítica ni de rastreo y no instala identificadores publicitarios. Usted puede borrar lo que Sig-Low guarda desde la propia aplicación o desde los ajustes de su navegador. Si trabaja en una ventana privada, lo guardado se borra al cerrarla.

Lo que usted copie o descargue fuera de Sig-Low (el original, el texto con marcadores, el texto reinsertado, la tabla) deja de estar bajo el control de la aplicación y queda bajo su cuidado.

## 5. Qué ve el sitio que aloja Sig-Low (aviso de privacidad)

Toda página web, para cargarse, deja unos datos mínimos de la visita en el sitio que la sirve. Sig-Low está alojada en Cloudflare Pages, mediante carga directa de los archivos, sin funciones de servidor y sin el servicio de analítica web del proveedor.

Al cargar la aplicación, el alojamiento puede ver y registrar:

- su **dirección IP**;
- la **fecha y hora** de la solicitud;
- las **rutas de los recursos estáticos** que su navegador pide (por ejemplo, `/`, `/sw.js` o los archivos del modelo) y los datos técnicos que todo navegador envía en esas solicitudes.

El alojamiento **no ve el contenido de sus documentos**, porque este nunca se envía. Por defecto, el proveedor agrega a sus respuestas una cabecera técnica de acceso entre orígenes (`Access-Control-Allow-Origin`); es una instrucción para el navegador y no expone contenido.

Estos registros son técnicos, mínimos e inevitables para entregar la página. Sig-Low no los usa para identificarlo, perfilarlo ni rastrearlo. Este texto los trata como datos personales (Ley 1581 de 2012, artículo 3, literal c) y por eso los informa mediante este aviso de privacidad, que también se muestra, en forma breve y visible, en «Acerca de» dentro de la aplicación. Quién los trata, durante cuánto tiempo y bajo qué condiciones se explica en el punto 6.

El sitio personal del dueño es otro origen: no comparte con Sig-Low almacenamiento, caché ni cookies, y Sig-Low no lee cookies.

## 6. Responsable, encargado, finalidad, conservación y transmisión

| Aspecto | Contenido |
|---|---|
| Responsable de los registros del alojamiento | Razón social: GRUPO EMPRESARIAL NEW WAY S.A.S; NIT: 901.855.061-7. Domicilio y dirección de notificación judicial: Calle 66 #59-31, Bogotá D.C., Colombia. Correo para consultas y reclamos sobre datos personales: `info@vergarameloabogado.site`. |
| Encargado del tratamiento | Cloudflare, como proveedor del alojamiento (Cloudflare Pages). Trata los registros por cuenta del responsable, como encargado del tratamiento (Ley 1581 de 2012, artículo 3, literal d), según su contrato de procesamiento de datos (Cloudflare Data Processing Addendum, «DPA») y su política de privacidad (Cloudflare Privacy Policy). |
| Finalidad | Entregar la aplicación a quien la abre y mantener el servicio. No hay finalidad comercial, de publicidad ni de perfilamiento. |
| Conservación | Cloudflare conserva estos registros durante el tiempo que determinan su política de privacidad y su contrato de procesamiento de datos, según la finalidad para la que los recoge (operación y protección de su red). No publica un plazo único para este servicio. GRUPO EMPRESARIAL NEW WAY S.A.S no conserva copia propia de estos registros. |
| Transmisión internacional | El encargado puede tratar los registros fuera de Colombia. Se informa como una transmisión de datos a un encargado, amparada en el contrato de procesamiento de datos (DPA) del proveedor, conforme a los artículos 24 y 25 del Decreto 1377 de 2013, hoy compilados en el Decreto 1074 de 2015. |
| Aviso y autorización | Los registros se informan con aviso de privacidad visible (punto 5 y «Acerca de»), y no con autorización expresa, porque son registros técnicos mínimos e inevitables para entregar la página y Sig-Low no los usa para identificar a nadie. |

## 7. Los datos de sus documentos

Sig-Low no recibe los documentos que usted procesa. Por eso:

- quien usa Sig-Low (el abogado o el despacho) sigue siendo responsable del tratamiento de los datos personales de esos documentos, incluidos los datos sensibles y los de niñas, niños y adolescentes, y de la autorización o la base legal con que los trata;
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

Como titular de datos personales, usted puede conocer, actualizar, rectificar y suprimir sus datos, solicitar prueba de la autorización cuando esta exista, ser informado del uso que se les da, presentar quejas ante la Superintendencia de Industria y Comercio y revocar la autorización en los casos que la ley permita (Ley 1581 de 2012, artículo 8).

Para ejercerlos, escriba a `info@vergarameloabogado.site`. El responsable atiende las consultas en un máximo de diez (10) días hábiles, prorrogables por cinco (5) más, y los reclamos en un máximo de quince (15) días hábiles, prorrogables por ocho (8) más (Ley 1581 de 2012, artículos 14 y 15). Los registros del alojamiento los trata el encargado por cuenta del responsable, que es quien atiende su solicitud (punto 6).

## 11. Cambios

Este texto puede cambiar. La versión vigente es la que acompaña a la versión de Sig-Low que usted usa, con su fecha de vigencia. Las versiones nuevas de la aplicación se aplican al abrir Sig-Low con todas sus pestañas cerradas, y el aviso de «Acerca de» corresponde siempre a la versión que usted tiene abierta.

## 12. Créditos y licencias

Sig-Low usa componentes de terceros con sus propias licencias. Su lista, con los avisos y las atribuciones que exigen, está en «Créditos y licencias» (dentro de «Acerca de» en la aplicación) y en el archivo `LICENSES.md` del repositorio. Las condiciones de uso de la aplicación están en los términos de uso (`docs/legal/terminos-de-uso.md`).
