# Guía de TI para despachos que usan Sig-Low

Esta guía es para el área de sistemas (TI) de un despacho u organización. Reúne los ajustes del navegador y del sistema que reducen la exposición del texto que se ve en pantalla mientras se usa Sig-Low, y cómo verificar cada versión que se publica.

> **Es solo documentación de despliegue. Nunca aparece en la interfaz de la aplicación.**
>
> **Lo marcado [VERIFICAR] sigue abierto.** No se confirmó el nombre exacto, el valor o la existencia de esa política o ajuste en la documentación vigente del fabricante. TI debe comprobarlo en la documentación de la versión de navegador y de sistema que tenga instalada antes de aplicarlo, y no darlo por hecho. Las políticas con estado «Verificado» llevan la dirección de la documentación consultada.

## 1. Qué hace Sig-Low y hasta dónde llega esta guía

Sig-Low es un sitio estático que corre por completo en el navegador de cada persona. El texto de los documentos se procesa en el equipo; la aplicación no tiene servidor propio que lo reciba, y el alojamiento solo ve la dirección IP, la hora y la ruta de los archivos estáticos que se descargan.

Lo que esta guía **sí** cubre: funciones del navegador y del sistema que pueden leer o enviar lo que se muestra en la página y que la página no puede apagar sola (corrector ortográfico en la nube, predicción de texto, traducción, asistentes de IA integrados en el navegador, extensiones, informes de fallos, historial del portapapeles, sincronización).

Lo que **no** cubre ni la aplicación ni esta guía: ver la sección 8 («Lo que la aplicación no puede impedir»). Estos ajustes reducen la exposición, no la eliminan.

## 2. Dirección oficial y distribución

- La dirección oficial es `https://sig-low.vergarameloabogado.site`. Distribúyala a los usuarios como **marcador**; no distribuya copias de Sig-Low en otros servidores ni acepte direcciones recibidas por correo o mensajes.
- Sig-Low necesita contexto seguro (`https://`) y funciona sin conexión después de la primera carga, gracias a un service worker. Una directiva de empresa que borre los datos del sitio al cerrar el navegador (cookies y datos de sitio) eliminaría la tabla guardada y el modo sin conexión: vea la política de excepción de datos de sitio (fila 16 de la sección 4).
- Una versión nueva se aplica sola la próxima vez que se abre Sig-Low con todas sus pestañas cerradas. Para decidir cuándo aprobar una versión, repita la verificación de la sección 6 con la lista de las notas de la versión.

## 3. Perfil de navegador dedicado

Es la medida principal: las extensiones, la sesión y la sincronización son **por perfil**, y un perfil limpio conserva la tabla cifrada y el modo sin conexión. Si TI no puede aplicar políticas, el usuario puede configurar este perfil (ver también `docs/guia-abogado.md`).

| Ajuste | Chrome | Edge |
|---|---|---|
| Sin sesión ni sincronización | Perfil nuevo, «continuar sin cuenta» | Perfil nuevo sin cuenta |
| Sin extensiones | Ninguna | Ninguna |
| Corrector local | «Básico» | «Básico» |
| Sin predicción de texto | No aplica | Apagar «Usar predicción de texto» |
| Sin oferta de traducción | Apagarla | Apagar «Ofrecer traducir páginas…» |
| Asistentes de IA del navegador | En `chrome://settings/ai/gemini`, apagar «Share current tab by default» | Apagar «Allow Copilot to read context clues on the web» |
| Búsqueda en la página | No aplica | Apagar «Include related matches in Find on page» |
| Informes de fallos | Apagar «Ayudar a mejorar las funciones y el rendimiento de Chrome» | Sin datos de diagnóstico opcionales |
| Gestor de contraseñas | No guardar la frase de paso | No guardar la frase de paso |
| Instalar como aplicación (opcional) | Mejora la conservación del almacenamiento (verificado) | [VERIFICAR] |

Los nombres de los ajustes de la interfaz del navegador cambian entre versiones; compruebe el nombre exacto en la versión instalada.

**Ventana privada.** Sirve solo para copiar el texto reinsertado, porque lo copiado desde allí no entra al historial del portapapeles de Windows [VERIFICAR, T-PV-21]. Es preferible descargar el texto. Si hay que copiarlo: exportar el archivo `.siglow`; con conexión, abrir Sig-Low en una ventana privada; importar, reinsertar y copiar; cerrar la ventana, que borra la tabla y la caché. El trabajo diario y la demostración sin conexión van en ventana normal.

## 4. Políticas de navegador y de sistema

La columna «Reduce» remite a la lista de vectores de privacidad del proyecto (V-nn). El estado es el de la investigación del proyecto (corte 2026-10-22), salvo las filas con «Verificado 2026-11-01», que se comprobaron ese día en la página del fabricante que se cita. Las filas con sufijo «b» separan el ajuste de Chrome, que sigue sin comprobar, del de Edge, ya comprobado.

| # | Reduce | Ámbito | Política o ajuste | Valor | Estado |
|---|---|---|---|---|---|
| 1 | V-25 | Chrome | `SpellCheckServiceEnabled` | `false` (el corrector básico es local) | Verificado (https://support.google.com/chrome/a/answer/13616585) |
| 2 | V-25 | Edge ≥ 105 | `MicrosoftEditorProofingEnabled` | `false` | Verificado (https://learn.microsoft.com/en-us/microsoft-edge/privacy-whitepaper/) |
| 3 | V-26 | Edge | `TextPredictionEnabled` | `false` (queda activa si no se configura) | Verificado (misma fuente) |
| 4 | V-28 | Chrome | `GeminiSettings` | El valor que la deshabilita (el valor `0` la permite y es el predeterminado) | Nombre verificado; **valor [VERIFICAR]** |
| 5 | V-28 | Chrome | `HelpMeWriteSettings` | Deshabilitada | Nombre verificado (https://support.google.com/chrome/a/answer/14533935); **valor [VERIFICAR]** |
| 6 | V-28 | Edge ≥ 130, perfiles con Entra | `EdgeEntraCopilotPageContext` | Deshabilitada (no cubre cuentas personales) | Verificado (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/edgeentracopilotpagecontext) |
| 7 | V-28 | Edge, cuenta personal | Acceso del asistente al contenido de la página | Deshabilitado | **Política no encontrada [VERIFICAR]**; use el ajuste del perfil (sección 3) |
| 8 | V-27 | Chrome | `TranslateEnabled` | `false` | Documentación [VERIFICAR] |
| 9 | V-27 | Edge | `TranslateEnabled` | `false` (apaga todas las funciones de traducción integradas; no se aplica a perfiles con cuenta Microsoft) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/translateenabled) |
| 10 | V-24 | Chrome y Edge | `ExtensionSettings` → `runtime_blocked_hosts` | `["*://<host-de-sig-low>"]` (máximo 100 patrones, sin ruta): las extensiones no inyectan, no leen cookies ni modifican peticiones en ese host | Verificado (https://support.google.com/chrome/a/answer/9867568) |
| 11 | V-29 | Edge | «Coincidencias relacionadas» en Buscar en la página | Apagada | Ajuste verificado; **política [VERIFICAR]** |
| 12 | V-30 | Chrome | `MetricsReportingEnabled` | `false` | [VERIFICAR] |
| 13 | V-30 | Edge | `DiagnosticData` | `1` (solo datos requeridos, sin opcionales; `0` apaga todo pero Microsoft no lo recomienda y `2` envía los opcionales) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/diagnosticdata) |
| 14 | V-31 | Edge | `SyncDisabled` (perfil dedicado) | `true` (el usuario no puede activar la sincronización; no se aplica a perfiles con cuenta Microsoft) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/syncdisabled) |
| 14b | V-31 | Chrome | `SyncDisabled` o `SyncTypesListDisabled` (perfil dedicado) | Sin sincronización | [VERIFICAR] |
| 15 | V-19 | Edge | `PasswordManagerEnabled` (perfil dedicado) | `false` (opcional; impide guardar contraseñas nuevas, no borra las guardadas) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/passwordmanagerenabled) |
| 15b | V-19 | Chrome | `PasswordManagerEnabled` (perfil dedicado) | `false` (opcional) | [VERIFICAR] |
| 16 | V-13 | Edge | `CookiesAllowedForUrls` con `https://sig-low.vergarameloabogado.site`; para que no se borren los datos del sitio al cerrar el navegador, `SaveCookiesOnExit` | Permitir el host de Sig-Low | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/cookiesallowedforurls; esa página remite a `SaveCookiesOnExit` para excluir cookies del borrado al salir) |
| 16b | V-13 | Chrome | Excepción de datos de sitio (p. ej., `CookiesAllowedForUrls`) | Permitir el host de Sig-Low | [VERIFICAR] |
| 17 | V-33 | Edge | `InPrivateModeAvailability` | `0` (InPrivate disponible; es el valor predeterminado; `1` lo deshabilita y `2` lo fuerza) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/inprivatemodeavailability) |
| 17b | V-33 | Chrome | `IncognitoModeAvailability` | Disponible (para copiar el texto reinsertado) | [VERIFICAR] |
| 18 | Rendimiento | Edge | Modo de seguridad mejorada (sección 5) | `EnhanceSecurityModeBypassListDomains` con `sig-low.vergarameloabogado.site` (dominio, sin esquema ni ruta), o seguir sin el modelo | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/enhancesecuritymodebypasslistdomains: lista de cadenas, Windows y macOS desde Edge 98). Que Edge con la seguridad mejorada activa cargue el modelo con la excepción se comprueba con T-ED-01 |
| 19 | V-33 | Windows | `AllowClipboardHistory`, `AllowCrossDeviceClipboard` | Deshabilitados | Ajuste verificado (Configuración > Sistema > Portapapeles; Win+V guarda hasta 25 elementos); **políticas [VERIFICAR]** |
| 20 | V-34 | Windows | Recall: `AllowRecallEnablement` y `DisableAIDataAnalysis` | `AllowRecallEnablement` = `0` (Recall no está disponible; quita el componente) y `DisableAIDataAnalysis` = `1` (no se guardan capturas para Recall) | Verificado 2026-11-01 (https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-windowsai; en dispositivos administrados Recall viene desactivado por defecto) |
| 21 | V-33 | macOS e iOS | Handoff (Portapapeles universal) | Desactivado | Activo por defecto (verificado); **clave [VERIFICAR]** |
| 22 | V-17, V-23 | Windows y macOS | Cifrado de disco (BitLocker, FileVault) | Activo | **Cobertura de memoria virtual e hibernación [VERIFICAR]** |
| 23 | V-35 | Sistema | Bloqueo automático de sesión | Según la política del despacho | Recomendación general |
| 24 | V-32 | Chrome | Nivel de Safe Browsing («Navegación segura») | Decisión de TI; si mantiene el nivel mejorado, documentarlo como riesgo aceptado | Comportamiento verificado; **política [VERIFICAR]** |
| 25 | V-49 | Chrome | `LensOverlaySettings`, `LensRegionSearchEnabled` | Deshabilitadas | **[VERIFICAR nombres y valores]** |
| 26 | V-49 | Edge | Minimenú de selección, búsqueda visual, «Leer en voz alta» en línea | Apagados | **[VERIFICAR políticas]** |

### 4.1 Los seis temas principales

Si TI solo puede aplicar algunas políticas, estas son las que corresponden a lo que más texto expone:

1. **Corrector ortográfico en la nube:** filas 1 y 2 (y «Básico» en el perfil).
2. **Predicción de texto:** fila 3.
3. **Traducción de la página:** filas 8 y 9. La aplicación ya marca la página como no traducible, lo que evita la oferta automática en navegadores basados en Chromium, pero no impide la traducción manual.
4. **Asistentes de IA integrados que leen la página:** filas 4 a 7 y 25 a 26. Ninguna técnica web impide que un asistente lea la pestaña cuando el usuario lo invoca; las políticas y el perfil sin sesión reducen que lo haga.
5. **Extensiones:** fila 10. Es la medida más importante después del perfil dedicado, porque una extensión con permiso sobre el sitio lee y modifica la página desde un mundo aislado, y la política de seguridad de contenido de la aplicación no la gobierna.
6. **Modo de seguridad mejorada de Edge:** fila 18 y sección 5.

### 4.2 Ejemplo de bloqueo de extensiones (fila 10)

Estructura de la política `ExtensionSettings` (valor JSON). Confirme el nombre de la clave y el formato en la página del fabricante de la fila 10 antes de aplicarlo:

```json
{
  "*": {
    "runtime_blocked_hosts": ["*://sig-low.vergarameloabogado.site"]
  }
}
```

Use el host oficial real (sin ruta). Si ya existe una política `ExtensionSettings` en su organización, agregue la clave a la existente en lugar de crear otra.

## 5. Modo de seguridad mejorada de Edge

El modo de seguridad mejorada de Edge desactiva el compilador JIT y ejecuta WebAssembly con un intérprete, con menor rendimiento (https://learn.microsoft.com/deployedge/microsoft-edge-security-browse-safer). En el nivel «Equilibrado» se aplica a sitios poco visitados, como un Sig-Low recién publicado.

Efecto sobre Sig-Low: el modelo de apoyo corre en WebAssembly. Con el modo activo, el modelo puede cargar mucho más lento o no cargar; las reglas y la lista del caso funcionan igual.

Medición del proyecto (equipo de referencia; informe en `docs/informe-medicion.md`): el modo «Estricto» de Edge **no se activó** en la medición (es un ajuste de seguridad del navegador de quien mide) y se usó como aproximación el indicador `--js-flags=--jitless`, en Edge 156 y en Chromium 156. Con ese indicador el navegador **no define `WebAssembly`**: el modelo no puede cargar, la aplicación responde con un error en 5 a 10 segundos y no se cuelga. Lo que haga Edge con el modo real puede diferir de esa aproximación [VERIFICAR con la seguridad mejorada activa].

Qué puede hacer TI:

- **Opción recomendada:** agregar `sig-low.vergarameloabogado.site` a la lista de sitios exceptuados del modo de seguridad mejorada, por política (fila 18). La política es `EnhanceSecurityModeBypassListDomains` (lista de cadenas con el dominio, sin esquema ni ruta; ejemplo `sig-low.vergarameloabogado.site`), comprobada en la página del fabricante citada en la fila 18.
- **Alternativa:** dejar el modo activo y usar Sig-Low sin el modelo (solo reglas y lista del caso). El abogado ve el aviso de que el modelo no está disponible y lee todo el texto con más cuidado.

## 6. Lista de comprobación del despliegue

| # | Paso | Quién |
|---|---|---|
| 1 | Distribuir la dirección oficial como marcador; no publicar copias en otros servidores. | TI |
| 2 | Tras cada publicación de una versión nueva, verificarla por fuera: `node scripts/verificar-despliegue.mjs <url> <lista>` con la lista de las notas de la versión (ver 6.1). «Acerca de» en la aplicación es solo informativo. | TI |
| 3 | Aplicar la sección 4 o configurar el perfil de la sección 3. | TI o usuario |
| 4 | Abrir con conexión, esperar «Lista para funcionar sin conexión», activar el modo avión, recargar y procesar un documento ficticio. | TI o usuario |
| 5 | Opcional: pestaña Red de las herramientas de desarrollo, sin peticiones fuera del service worker. | TI |
| 6 | Modelo en Edge con seguridad mejorada: excepción (fila 18) o uso sin el modelo. | TI |
| 7 | Definir dónde se guardan los archivos `.siglow` (carpeta del asunto, según el protocolo de uso de IA del despacho) y quién los custodia. | Abogado responsable |

### 6.1 Verificación externa de una versión (`scripts/verificar-despliegue.mjs`)

El script se ejecuta con Node, sin dependencias, desde una copia del repositorio en el equipo de TI. No envía ningún dato del despacho: solo descarga archivos públicos de la dirección oficial.

```bash
node scripts/verificar-despliegue.mjs https://sig-low.vergarameloabogado.site SHA256SUMS
```

- Descarga `/` y cada archivo del precache publicado y compara su SHA-256 con la lista de las notas de la versión (`SHA256SUMS`, con el formato de `sha256sum`).
- Sale con código 0 cuando todo coincide (T-RD-07); cualquier diferencia debe tratarse como versión no aprobada.
- Tome la lista **de las notas de la versión publicadas con la etiqueta firmada**, no de la propia dirección que verifica.
- Qué demuestra: que lo publicado es lo mismo que lo construido y firmado. Lo calcula una herramienta externa a la aplicación, por eso vale; los códigos de «Acerca de» los calcula el código en ejecución y solo informan.

- Además comprueba las cabeceras de la sección 3.6 del plan (las de `public/_headers`) y el tipo MIME de cada archivo, que no haya `Set-Cookie` ni `/cdn-cgi/` en el HTML, y que el precache publicado sea el de la lista (ni un archivo de más ni de menos). Una redirección cuenta como diferencia. Código de salida 2: argumentos o lista incorrectos (no se pidió nada a la red).
- Sin la opción `--todo` no se descargan los trozos del modelo (cientos de MB); con ella sí, y se comparan con la lista. Opciones completas y formato de la lista: `docs/despliegue.md`, sección 5.4.

## 7. Equipo y sistema

- **Cifrado de disco** (BitLocker en Windows, FileVault en macOS): activo. Reduce la exposición de lo que el sistema escribe a disco (memoria virtual, hibernación); si cubre esos archivos en su configuración está por verificar (fila 22).
- **Historial del portapapeles** (Windows, Win+V): deshabilitarlo (fila 19) o limpiar el historial después del trabajo. Lo copiado desde una ventana normal puede quedar en él.
- **Recall** (Windows): comprobar que está deshabilitado (fila 20).
- **Handoff** (macOS e iOS): desactivado (fila 21).
- **Bloqueo de sesión:** automático, según la política del despacho (fila 23). Sig-Low además bloquea su propia sesión a los 15 minutos de inactividad, con aviso.
- **Cerrar el navegador al terminar** el trabajo: la aplicación vacía su estado en memoria al bloquearse, pero el sistema puede conservar restos en memoria o disco.

## 8. Lo que la aplicación no puede impedir

| # | Límite | Qué puede hacer TI o el usuario |
|---|---|---|
| L-1 | Asistentes de IA del navegador que leen la pestaña al invocarlos: no existe mecanismo web para impedirlo. | No invocarlos con Sig-Low abierto; perfil sin sesión; políticas (sección 4). |
| L-2 | Extensiones con permiso sobre el sitio: la política de seguridad de contenido no las rige y la página no las detecta. | Perfil sin extensiones; `runtime_blocked_hosts` (fila 10). |
| L-3 | Capturas, pantalla compartida, grabaciones y personas que miran. | No compartir pantalla; pausar capturas; bloquear la sesión. |
| L-4 | Historial del portapapeles y su nube en ventana normal. | Desactivarlo; descargar el texto reinsertado o copiarlo en ventana privada. |
| L-5 | Funciones del navegador que no respetan los atributos de la página (predicción, traducción manual, corrector en la nube de Edge) y buscar, traducir o leer en voz alta una selección desde menús o atajos. | Ajustes del perfil o políticas. |
| L-6 | Informes de fallos del navegador con memoria. | Desactivarlos. |
| L-7 | Restos en memoria y disco: cadenas no borrables, claves sin puesta a cero verificable, IndexedDB que no sobrescribe, memoria virtual. Todo lo guardado va cifrado. | Cifrado de disco; cerrar el navegador al terminar. |
| L-8 | Reidentificación por datos indirectos y datos que nadie detectó. Las sugerencias no bloquean la copia: si no se aplican, el dato indirecto queda, y el informe las cuenta como «sin decidir». | Prueba final del protocolo del despacho; leer todo el texto antes de copiar. |
| L-9 | Lo que la herramienta de IA hace con el texto: ocurre fuera del equipo. | Matriz de herramientas autorizadas y contrato de transmisión. |
| L-10 | Equipo comprometido o administrador malintencionado: controla el navegador entero. | Protección del equipo a cargo de TI. |
| L-11 | Versión alterada publicada desde la cuenta del alojamiento, o copia no oficial: la versión nueva se aplica sola al abrir Sig-Low con todas sus pestañas cerradas y no hay firma del editor verificable por el navegador. | Dirección oficial; verificación externa de cada versión (sección 6.1). |

## 9. Pendientes de esta guía

Siguen sin confirmar las filas de la sección 4 que aún llevan [VERIFICAR]: 4, 5, 7, 8, 11, 12, 14b, 15b, 16b, 17b, 19, 21, 22, 24, 25 y 26 (casi todas, ajustes de Chrome, de Windows y de macOS), el ajuste de Edge de «Instalar como aplicación» (sección 3), la comprobación con el modo real de Edge (sección 5) y el comportamiento de la ventana privada frente al historial del portapapeles (T-PV-21). Las filas 9, 13, 14, 15, 16, 17, 18 y 20 se comprobaron el 2026-11-01 en la página del fabricante citada, y el subdominio oficial ya está publicado y responde por HTTPS. Las opciones de `scripts/verificar-despliegue.mjs` (6.1) ya están confirmadas con el script (T-PV-15). Ninguna debe aplicarse en producción sin esa comprobación.
