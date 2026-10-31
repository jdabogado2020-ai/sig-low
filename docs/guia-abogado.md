# Guía del abogado para usar Sig-Low

> **Borrador para revisión del dueño.** Esta guía se publica con la versión 1.0.0 una vez el dueño la apruebe. Todo lo marcado [VERIFICAR] está pendiente de confirmación, y los tiempos todavía no son definitivos.

Sig-Low es una herramienta web que corre en el navegador de su equipo. Propone reemplazar nombres, identificaciones, direcciones y otros datos de un documento jurídico por marcadores, le muestra lo que puede quedar y le deja decidir. Su única promesa, tal como aparece en la aplicación, es:

> Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.

Esta guía le lleva desde cero hasta una prueba en modo avión. Tómese unos 30 minutos la primera vez (la descarga del modelo puede tardar más). No necesita ayuda técnica.

## Antes de empezar: lo que debe saber

- Sig-Low **propone**; usted **decide y revisa**. Puede dejar datos sin reemplazar, y la revisión del resultado es responsabilidad del abogado.
- Reemplazar nombres por marcadores es **seudonimizar**, no anonimizar: con la tabla de correspondencia, los datos siguen siendo personales. Pegue el texto solo en herramientas autorizadas por su organización.
- Lo que otros programas de su equipo hacen con lo que se ve en pantalla (asistentes de IA del navegador, extensiones, capturas, el historial del portapapeles) no lo controla Sig-Low. Los pasos de esta guía reducen ese riesgo, no lo eliminan.

## Parte 1. Prepare su navegador

### 1.1 Use la dirección oficial

Abra Sig-Low solo desde **`sig-low.vergarameloabogado.site`** [VERIFICAR: nombre exacto del subdominio al publicar]. Guárdela como marcador o favorito y entre siempre desde ahí. No use enlaces recibidos por correo o mensajes, y no use copias en otras direcciones: una copia no oficial podría ver todo lo que procesa.

La dirección debe empezar por `https://` (conexión cifrada). Sin ella, Sig-Low no funciona sin conexión ni guarda tablas, y le avisará.

### 1.2 Cree un perfil de navegador solo para Sig-Low

Un perfil es un espacio aparte del navegador, con sus propias extensiones, sesiones y ajustes. Usarlo solo para Sig-Low es la medida más importante de esta guía.

1. En Chrome o Edge, abra el menú de perfiles (arriba a la derecha, junto a la barra de direcciones) y elija **Agregar perfil** [VERIFICAR: nombre exacto en su versión].
2. Elija **continuar sin cuenta** (o sin iniciar sesión). No active la sincronización.
3. **No instale extensiones** en este perfil. Las extensiones con acceso a los sitios pueden leer lo que se muestra en la página.
4. En los ajustes del perfil, deje el corrector ortográfico en modo **básico** (el corrector «mejorado» o en línea puede enviar el texto a un servicio externo).
5. Apague la predicción de texto y la oferta de traducir páginas.
6. Apague los asistentes de IA del navegador y el uso de la pestaña actual por parte de ellos (en Edge, el asistente de la barra lateral; en Chrome, la opción de compartir la pestaña actual con el asistente) [VERIFICAR: nombre exacto del ajuste en su versión].
7. Apague el envío de informes de fallos y de datos de diagnóstico opcionales.
8. **No permita que el navegador guarde su frase de paso** en el gestor de contraseñas.
9. Use una **ventana normal**, no privada. En una ventana privada, la tabla guardada y el funcionamiento sin conexión se borran al cerrarla.

Si trabaja en un equipo de su organización, estos ajustes pueden venir ya definidos por el área de sistemas (guía de despliegue `docs/ti.md`). Pregúntele antes.

## Parte 2. Primera apertura y descarga del modelo de apoyo

### 2.1 Abra Sig-Low con conexión

Entre a la dirección oficial. La primera vez, Sig-Low prepara los archivos para funcionar sin conexión y verá el mensaje «Preparando Sig-Low para funcionar sin conexión». Espere hasta ver **«Lista para funcionar sin conexión»**.

### 2.2 Descargue el modelo de apoyo (opcional, recomendado)

El modelo de apoyo ayuda a encontrar nombres de personas, empresas y lugares que no están en la lista del caso. Sin él, Sig-Low trabaja con reglas y con la lista del caso, y el informe lo dice.

| Dato | Valor |
|---|---|
| Qué se descarga | El modelo completo ocupa **unos 626 MB** (≈ 610 MB del modelo y ≈ 16 MB del tokenizador). Se descarga **una sola vez** y queda en este navegador. |
| Tiempo de descarga | «Varios minutos» con una conexión doméstica (así lo dice la aplicación). [VERIFICAR en P0-5: tiempo medido en la dirección oficial.] |
| Memoria del navegador al usarlo | Un pico de **unos 2,7 GB** con el modelo completo y de **unos 1,7 GB** con la versión reducida. |
| Espacio libre recomendado | Más que el tamaño del modelo, por el margen del navegador [VERIFICAR en P0-5: cifra]. |

Cómo hacerlo:

1. Cree o abra un asunto (Parte 3). En el paso de la lista del caso, pulse **«Descargar modelo de apoyo (… MB)»**.
2. **Mantenga la pestaña abierta** mientras se descarga: verá «Descargando el modelo de apoyo: … de … MB», luego «Comprobando la integridad del modelo…» y, al final, «Modelo de apoyo listo en este equipo».
3. No cierre el navegador ni apague el equipo durante la descarga. Si la conexión se corta, vuelva a pulsar el botón.

**Versión reducida automática.** Si su equipo tiene poca memoria (menos de 8 GB, según informa el navegador) o poco espacio, Sig-Low usa una versión reducida del modelo y lo avisa. Esa versión encuentra menos nombres escritos en mayúsculas o en minúsculas: **revise con más cuidado**.

### 2.3 Cuánto tarda en revisar un documento

El modelo revisa el documento por bloques, mientras usted ya puede empezar a revisar con las reglas y la lista del caso. Antes de empezar, la aplicación le dice cuántos bloques son y cuánto tardará, para su equipo.

Como referencia, la meta del producto es revisar 10 páginas en **2 minutos o menos con 8 hilos de procesador o más**, y en **4 minutos o menos con 4 a 7 hilos**. Los tiempos medidos hasta ahora se tomaron con la máquina ocupada y **no son definitivos**: [VERIFICAR en P0-5: tiempos por 10 páginas con 1, 4 y 8 hilos con el modelo completo y con el reducido]. Si su navegador no permite acelerar el modelo, la aplicación avisa que será más lento.

## Parte 3. Comprobación en modo avión

Esta prueba le demuestra por sí mismo que Sig-Low funciona sin conexión. Hágala una vez, con un **documento ficticio**, nunca con uno real.

**Preparación (con conexión):**

1. Entre a Sig-Low desde la dirección oficial en su perfil dedicado y espere «Lista para funcionar sin conexión».
2. Descargue el modelo de apoyo (Parte 2) si va a usarlo.
3. Cree un documento ficticio de prueba: un texto con un nombre como «Ana Ficticia Rojas», un número como «CC 0000000000» y un correo como «prueba@ejemplo.test».
4. Cierre el navegador por completo.

**Prueba:**

1. Active el **modo avión** de su equipo (en Windows, `Win + A` y el botón «Modo avión»; en un portátil, también puede apagar el Wi‑Fi) [VERIFICAR: pasos en su sistema].
2. Abra el navegador y escriba cualquier otra dirección: debe ver una página de error de conexión. Esto confirma que no tiene Internet.
3. Abra Sig-Low desde su marcador. **Debe cargar.**
4. Cree un asunto con el código `PRUEBA-001` (un código interno, nunca nombres de clientes; el código se guarda sin cifrar). Elija **«Guardar tabla cifrada»** y escriba una frase de paso de al menos 15 caracteres.
5. Pegue el documento ficticio y pulse **Analizar**.
6. En la revisión, acepte los reemplazos propuestos, decida los pendientes y llegue a **Listo**.
7. Confirme la búsqueda de residuos (sin hallazgos) y las casillas del recordatorio. Copie el texto: debe verse con marcadores entre corchetes, como `[DEMANDANTE_1]` (agregue «Ana Ficticia Rojas; demandante» a la lista del caso).
8. Cierre el navegador, ábralo de nuevo (el modo avión sigue activo), desbloquee `PRUEBA-001` con su frase: la tabla cifrada sigue ahí.
9. Desactive el modo avión.

Si todo funcionó, Sig-Low trabaja en su equipo sin necesidad de Internet. Si algo falló, vaya a la Parte 6.

**Prueba opcional de red (para su área de sistemas):** abra las herramientas de desarrollo del navegador (`F12`), pestaña «Red», con «Conservar registro» activo; durante toda la prueba no deben aparecer peticiones a otros dominios.

## Parte 4. Uso paso a paso

1. **Inicio y asunto.** Lea el aviso inicial («Antes de empezar») y pulse «Entendido». Cree un asunto con un código interno (letras sin tilde, números, espacio, punto, guion o barra; de 1 a 40 caracteres). Elija entre **guardar la tabla cifrada** (con una frase de paso que solo usted conoce; sin recuperación si la olvida) o **no guardar** (la tabla vive solo en la memoria de la pestaña y se pierde al cerrarla).
2. **Lista del caso.** Escriba o pegue una persona u organización por línea, con su rol o clase después de punto y coma. Ejemplo ficticio: `Ana Ficticia Rojas; demandante`. Cuanto mejor sea la lista, menos dependerá del modelo.
3. **Entrada.** Pegue el texto o cargue un archivo. Sig-Low no muestra ni guarda el nombre del archivo. Revise el aviso de metadatos y de texto eliminado: el archivo original los conserva. Desmarque solo las partes que no quiera en la salida.
4. **Procesando.** Las reglas y la lista del caso terminan primero; el modelo sigue por bloques.
5. **Revisión.** Cada dato propuesto puede aceptarse, rechazarse o editarse; puede agregar reemplazos manuales por selección. Resuelva las banderas y las sugerencias (municipios, despachos, fechas, rótulos): lo «sin decidir» **queda en el texto** y el informe lo cuenta.
6. **Listo.** Para copiar se exigen: revisión completa, búsqueda de residuos sin hallazgos y la confirmación del recordatorio (punto siguiente). Puede copiar el texto, descargarlo en .txt o .docx (archivo nuevo, sin formato ni metadatos del original) y descargar el informe, que no contiene los datos originales.
7. **Antes de pegar en otra herramienta.** Haga la **prueba final**: ¿alguien que no conoce el caso podría saber de quién se trata? Pegue solo en herramientas autorizadas por su organización. Cuando termine, use «Vaciar portapapeles» (no borra el historial del portapapeles del sistema).
8. **Reinserción.** Cuando reciba la respuesta de la herramienta, péguela en la pantalla de Reinserción. Revise los marcadores alterados, desconocidos y faltantes uno por uno. El texto resultante **contiene datos reales**: no lo pegue en herramientas de IA; descárguelo mejor que copiarlo, y si debe copiarlo, hágalo desde una ventana privada. Al salir de la pantalla, ese texto se borra.
9. **Al terminar.** Exporte la tabla cifrada y guárdela en la carpeta del asunto con acceso restringido. Bloquee o cierre el asunto. Sig-Low se bloquea por inactividad y borra de la memoria el documento y la revisión; lo no guardado se pierde.

## Parte 5. Lo que nunca se pega

Aunque el texto esté revisado, **no pegue nunca en una herramienta de IA** (Sig-Low no puede detectarlo; el recordatorio de la pantalla Listo se lo pide confirmar):

- **Datos biométricos:** fotos del rostro, huellas o grabaciones de voz.
- **Documentos con reserva legal en su forma original**, como una historia clínica completa o piezas de un expediente reservado. Si hace falta, use un extracto mínimo ya anonimizado.
- **La estrategia reservada del caso:** debilidades, márgenes de negociación o la teoría del caso no revelada.
- **El texto con datos reales** que sale de la Reinserción, ni la tabla de correspondencia, ni su frase de paso.
- El archivo original del documento: conserva metadatos y texto eliminado que Sig-Low no copia a la salida.

Siga además el protocolo 04 del Kit de Política de Uso de IA: herramientas autorizadas, contrato de transmisión de datos y prueba final de reidentificación.

## Parte 6. Si algo no funciona

| Problema | Qué hacer |
|---|---|
| Aparece «Sig-Low todavía no puede recibir documentos» (**sin service worker**) | Sig-Low necesita un componente del navegador que aún no está activo. Pulse «Recargar» (si recargó con `Mayús + F5`, recargue de forma normal). Compruebe que la dirección empiece por `https://` y que sea la oficial. Si sigue, su navegador o la configuración de su organización puede estar bloqueándolo: consulte con el área de sistemas. |
| Aparece que la dirección no usa conexión cifrada | Está en una dirección que no es la oficial o sin `https://`. Cierre y abra la dirección oficial. |
| «No hay espacio suficiente en este navegador» (**cuota**) al descargar el modelo | Se borró la descarga parcial. Sig-Low probará con la versión reducida; si tampoco cabe, seguirá solo con reglas y lista del caso. Libere espacio en el disco o quite datos de sitios que no use y vuelva a intentarlo. |
| «No hay espacio suficiente para guardar la tabla» | Exporte ahora una copia cifrada de la tabla para no perderla y libere espacio. |
| El navegador podría borrar los datos de Sig-Low («no persistente») | Exporte copias cifradas de las tablas que necesite. Un uso frecuente en una ventana normal ayuda. |
| **Equipo con poca memoria** (menos de 8 GB) o «se le acabó la memoria al modelo» | Cierre otras pestañas y programas. Sig-Low usa la versión reducida o sigue con reglas y lista del caso, y el informe lo dice. En ese caso, **lea todo el documento con mucho cuidado** antes de copiar. Puede elegir «Seguir sin el modelo» (los nombres que no estén en la lista solo se encontrarán con las reglas). |
| El análisis es lento | Cierre otras aplicaciones, use un equipo con más hilos de procesador o trabaje con documentos más cortos. Mientras tanto, puede revisar los resultados de las reglas. [VERIFICAR en P0-5: tiempos de referencia.] |
| **Edge con el modo de protección mejorada** (el modelo no carga o falla) | Ese modo desactiva funciones que el modelo necesita. Pida al área de sistemas una **excepción para la dirección oficial**, o trabaje sin el modelo (reglas y lista del caso, con más cuidado). No desactive el modo para todos los sitios. [VERIFICAR: nombre exacto del ajuste y de la excepción en la versión instalada de Edge.] |
| Hay una versión nueva de Sig-Low | Se aplica sola la próxima vez que abra Sig-Low con **todas sus pestañas cerradas**. Para aplicarla ya, guarde o exporte la tabla: la página se recargará y se borrará lo que esté solo en memoria. |
| Olvidó la frase de paso | No hay recuperación. Si exportó una copia cifrada, necesita esa misma frase. Por eso conviene guardar la frase en un lugar propio y confiable, fuera del navegador. |
| El archivo no se lee (.doc antiguo, .docx con contraseña, PDF escaneado o con contraseña) | Guárdelo como .docx sin contraseña, use un PDF con texto seleccionable o pegue el texto. Sig-Low no lee imágenes. |

## Parte 7. Compruebe que es la versión oficial

1. Entre solo por la dirección oficial (Parte 1.1).
2. En el pie de la aplicación, abra **«Acerca de»**: verá el número de versión, el **código de compilación** (SHA-256 de `index.html`), el código de la lista de archivos y la dirección oficial.
3. Compárelos con los publicados en las **notas de versión** de la etiqueta `v1.0.0` en el repositorio de Sig-Low [VERIFICAR: dirección del repositorio y de las notas de versión].
4. Estos códigos los calcula la misma copia que usted está usando, así que **sirven para saber qué versión usa, no para demostrar que no fue modificada**. Esa comprobación la hace su área de sistemas, fuera del navegador, con la herramienta de verificación del despliegue y los códigos publicados.
5. La publicación de cada versión se protege con verificación en dos pasos (llave de acceso o aplicación autenticadora), pero eso no sustituye su propia comprobación de la dirección.

## Parte 8. Créditos y licencias, y privacidad

- Los componentes de terceros y sus licencias están en «Créditos y licencias» (dentro de «Acerca de») y en `LICENSES.md`.
- Qué ve el sitio que aloja Sig-Low (dirección IP, hora y rutas de los archivos que su navegador pide), qué se guarda en su equipo y sus derechos están en la política de privacidad (`docs/legal/politica-de-privacidad.md`). Las condiciones de uso están en los términos de uso (`docs/legal/terminos-de-uso.md`). Ambos textos son borradores hasta que el dueño los apruebe.

## Resumen de una página

1. Entre solo por la dirección oficial, en un perfil del navegador solo para Sig-Low: sin sesión, sin extensiones, sin asistentes de IA, en ventana normal.
2. Espere «Lista para funcionar sin conexión»; descargue el modelo de apoyo una vez (≈ 626 MB) y haga la prueba en modo avión con un documento ficticio.
3. Cree el asunto con un código interno; decida si guarda la tabla cifrada y guarde la frase fuera del navegador.
4. Lea y decida cada reemplazo; lo «sin decidir» queda en el texto.
5. Antes de pegar en otra herramienta, haga la prueba final y recuerde lo que nunca se pega.
6. Pegue solo en herramientas autorizadas. El texto reinsertado tiene datos reales: descárguelo.
7. Exporte la tabla cifrada y cierre el asunto.
