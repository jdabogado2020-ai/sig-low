# Guía de despliegue de Sig-Low

Esta guía describe cómo se publica una versión de Sig-Low y cómo se comprueba que lo publicado es lo construido. La hace el dueño del proyecto (o quien él designe); TI de un despacho puede repetir las comprobaciones de las secciones 5 y 6 antes de aprobar una versión.

**Alcance y reglas de esta guía**

- Sig-Low es un sitio estático: no tiene servidor propio, base de datos ni cuentas de usuario. Se aloja en Cloudflare Pages.
- La publicación es **carga directa** de la carpeta `dist/` desde el panel de Cloudflare Pages, y **solo desde una etiqueta firmada** del repositorio. No se conecta el repositorio al alojamiento, no se usa `wrangler` y el proyecto no guarda tokens.
- **Esta guía no contiene credenciales, tokens, identificadores de cuenta ni rutas de equipos personales, y no debe recibirlos.** Los pasos de cuenta (crear el proyecto, activar el segundo factor, agregar el dominio) los hace el dueño en su propio panel; aquí solo se dice qué debe quedar configurado.
- El registro de cada despliegue (fecha, etiqueta, ID del despliegue y resultado de las comprobaciones) se guarda en la carpeta `entrega/` del repositorio privado del proyecto, nunca en este repositorio público.

## 1. Qué debe existir antes (lo deja hecho el dueño)

| # | Qué | Cómo se comprueba |
|---|---|---|
| 1 | Un proyecto de Cloudflare Pages creado por **carga directa** (sin repositorio conectado). | El panel del proyecto no muestra un repositorio de origen. |
| 2 | **Web Analytics apagado** en el proyecto y ninguna función de inyección activa (ni Workers asociados al proyecto ni funciones de Pages). | Panel del proyecto; y, después de cada despliegue, ningún `/cdn-cgi/` en el HTML servido (sección 5.2). |
| 3 | Segundo factor en la cuenta del alojamiento, con llave de acceso (Windows Hello o el teléfono) o aplicación autenticadora; la cuenta de GitHub igual. Publica solo una persona. | Lo confirma el dueño; se archiva la captura sin datos de cuenta en `entrega/`. |
| 4 | El dominio personalizado `sig-low.vergarameloabogado.site` agregado al proyecto, con su certificado emitido (sección 4). | `curl -sI https://sig-low.vergarameloabogado.site/` responde sin error de certificado. |
| 5 | Una etiqueta firmada (`v1.0.0` para la primera versión) sobre el commit que se va a publicar. | `git tag -v v1.0.0` es válida y `git describe --exact-match` sobre el commit construido devuelve `v1.0.0`. |

## 2. Construir `dist/` desde la etiqueta

Todo se hace en una copia limpia del repositorio, **sin red salvo la instalación de paquetes**. El orden importa.

```bash
git fetch --tags
git tag -v v1.0.0                  # la firma debe ser válida
git switch --detach v1.0.0
git describe --exact-match         # debe imprimir v1.0.0
npm ci --ignore-scripts            # versiones exactas de package-lock.json; ningún paquete ejecuta scripts
node scripts/trocear-modelo.mjs --origen <carpeta con los modelos descargados y verificados>
npm run verify:full                # typecheck, lint, pruebas, build, check-dist, E2E completos, cero red x5 y T-IV-01
npm run build
node scripts/check-dist.mjs        # lista permitida del build y tope de 25 MiB por archivo
```

Notas:

- `scripts/trocear-modelo.mjs` parte el modelo en trozos de 8 MiB (F11: un corte de la red cuesta como mucho 8 MiB; el alojamiento admite 25 MiB por archivo) y escribe los manifiestos. Comprueba el SHA-256 de cada modelo contra las huellas fijadas (`LICENSES.md`, sección 2) y aborta si no coinciden. Los trozos no se guardan en Git (solo los manifiestos): se regeneran en cada despliegue.
- `dist/` debe contener, además de `index.html`, `sw.js`, `precache.json` y `_headers`: `assets/` (código y workers), `ort/ort-wasm-simd-threaded.{mjs,wasm}` (solo esos dos archivos), `tt-policy.js` y `models/<id>/` con el manifiesto, los trozos de `onnx/` y los dos auxiliares (`tokenizer.json` y `tokenizer_config.json`) de cada modelo: 73 trozos el principal y 37 el respaldo, según sus manifiestos (F11; antes, 25 y 13 de 24 MiB).
- Límites del alojamiento de carga directa: 25 MiB por archivo, 20.000 archivos por despliegue y, en `_headers`, 100 reglas y 2.000 caracteres por línea [VERIFICAR los límites vigentes en la documentación de Cloudflare antes de cada publicación].

### 2.1 Huellas SHA-256 de la versión

Con `dist/` ya construido, se calculan las huellas que se publicarán con la etiqueta (notas de versión) y que `scripts/verificar-despliegue.mjs` usará como lista:

```bash
( cd dist && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > SHA256SUMS
```

- El archivo `SHA256SUMS` va a `entrega/` (repositorio privado) y sus líneas, en las notas de la versión de la etiqueta.
- La huella de `index.html` (sus primeros 12 caracteres hexadecimales) debe coincidir con el valor «compilación» que muestra «Acerca de».
- «Acerca de» solo informa: lo calcula el propio código en ejecución, así que una versión alterada mostraría sus propios códigos. La comprobación válida es la externa de la sección 5.4.

## 3. Publicar por carga directa

Antes de publicar en producción se hace un **despliegue de humo** en la dirección `<proyecto>.pages.dev`, con documentos ficticios. Es solo una prueba: no es publicar, no se anuncia y se comprueba con las secciones 5 y 6 igual que producción.

1. Entrar al panel de Cloudflare Pages del proyecto (con la sesión del dueño; no se escriben credenciales en ningún archivo ni comando).
2. Crear un nuevo despliegue por **carga directa** y seleccionar la carpeta `dist/` completa (los nombres exactos de los menús pueden cambiar [VERIFICAR en el panel vigente]).
3. Para el despliegue de humo, elegir la rama de vista previa; para producción, la rama de producción.
4. Cuando termine, copiar el **ID del despliegue** que muestra el panel.
5. Registrar en `entrega/despliegues.md` (repositorio privado): fecha y hora (America/Bogota), etiqueta, dirección, ID del despliegue, origen (`dist/` de la etiqueta y su `SHA256SUMS`) y el resultado de las comprobaciones de la sección 5.

No se conecta el repositorio, no se instala `wrangler` y no se crean tokens de API. Un token filtrado publicaría código que se ejecuta sin aceptación en la sesión siguiente (sección 7).

## 4. Dominio personalizado: DNS, certificado y origen propio

El sitio vive en `sig-low.vergarameloabogado.site`, un **origen distinto** del sitio personal: no comparte almacenamiento, caché ni service worker con él, y lleva sus propias cabeceras. Nunca es una ruta del sitio personal.

1. **DNS.** El DNS de `vergarameloabogado.site` lo maneja el alojamiento del sitio personal (no Cloudflare). En él se crea el subdominio `sig-low` como un registro **CNAME** hacia la dirección `<proyecto>.pages.dev` del proyecto de Pages.
2. **Dominio en el proyecto.** En el panel de Pages, agregar `sig-low.vergarameloabogado.site` como dominio personalizado.
3. **Certificado.** Cloudflare lo emite al verificar el CNAME. Hasta que el panel lo marque como activo, no se publica nada en esa dirección.
4. **Sin funciones de zona.** Como la zona DNS no está en Cloudflare, no aplican sus inyecciones de zona (Rocket Loader, ofuscación de correo, RUM, `/cdn-cgi/`). Aun así se apagan las del proyecto (sección 1, fila 2) y se mantiene la prueba del hash del HTML servido (sección 5.3).
5. **Cookies del sitio personal.** El sitio personal no debe fijar cookies con `Domain=.vergarameloabogado.site`: llegarían también a Sig-Low. Sig-Low no usa cookies ni lee `document.cookie`, pero se comprueba:

   ```bash
   curl -sI https://<sitio-personal>/ | grep -i '^set-cookie'
   ```

   Ninguna línea debe llevar `Domain=.vergarameloabogado.site`.
6. El `*.pages.dev` del proyecto queda como respaldo y para el despliegue de humo. Quien use la herramienta usa solo la dirección oficial.

## 5. Comprobaciones después de cada despliegue

Se hacen contra el despliegue de humo y, con la misma lista, contra la dirección oficial. Sus resultados van a `entrega/` (en producción, `entrega/cabeceras.txt`).

### 5.1 Cabeceras (DoD-16)

```bash
URL=https://sig-low.vergarameloabogado.site
curl -sI "$URL/"
curl -sI "$URL/sw.js"
curl -sI "$URL/assets/<nombre-del-worker>.js"      # cualquier worker de /assets/ (ver dist/assets)
curl -sI "$URL/ort/ort-wasm-simd-threaded.wasm"
```

Cada respuesta debe traer las cabeceras de `public/_headers` (fuente de verdad; los valores de la sección 3.6 del plan técnico):

| Cabecera | Valor esperado |
|---|---|
| `Content-Security-Policy` | La política canónica `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default`, seguida, separada por coma, de la política de endurecimiento por rutas que lleva `public/_headers`. El navegador exige las dos. |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), clipboard-read=(), clipboard-write=(self), browsing-topics=(), private-state-token-issuance=(), private-state-token-redemption=(), identity-credentials-get=(), interest-cohort=()` |
| `Cache-Control` | `no-cache, no-transform` en `/`, `/index.html` y `/sw.js`; `public, max-age=31536000, immutable` en `/assets/*`. `/ort/*` no tiene regla propia [VERIFICAR el valor que aplica Cloudflare]. |
| Tipos MIME | `/ort/ort-wasm-simd-threaded.wasm` → `application/wasm`; `/ort/ort-wasm-simd-threaded.mjs` → `text/javascript` |

Ausentes: `Set-Cookie`, `Access-Control-Allow-Origin` y cualquier cabecera de analítica. Cloudflare Pages agrega por defecto `Access-Control-Allow-Origin: *`; `public/_headers` la quita con `! Access-Control-Allow-Origin`, y la comprobación debe confirmarlo [VERIFICAR en el próximo despliegue; el despliegue de espacio reservado todavía la mostraba].

`public/_headers` no repite una cabecera en dos reglas que coincidan con la misma ruta (Cloudflare unirá sus valores y el service worker se quedaría con el último); `scripts/check-dist.mjs` lo comprueba.

### 5.2 Sin inyecciones del alojamiento

```bash
curl -s "$URL/" | grep -c '/cdn-cgi/'      # debe imprimir 0
curl -sI "$URL/" | grep -i '^set-cookie'   # no debe imprimir nada
```

En el navegador, la pestaña Red de las herramientas de desarrollo no debe mostrar peticiones a otros orígenes ni a `/cdn-cgi/` (la CSP las bloquearía y la prueba de cero red las registra).

### 5.3 El HTML servido es el construido (DoD-19, parte 1)

```bash
curl -s "$URL/" | sha256sum        # debe ser igual al sha256 de dist/index.html y al de SHA256SUMS
```

### 5.4 Cada archivo desplegado coincide con el manifiesto (DoD-17 y DoD-19)

```bash
node scripts/verificar-despliegue.mjs "$URL" SHA256SUMS
```

El script (Node, sin dependencias) descarga `/` y cada entrada del precache publicado (`precache.json`) y compara su SHA-256 con la lista de la etiqueta. Sale con 0 si todo coincide. Lo corre el dueño en cada publicación y TI puede repetirlo con la lista de las notas de la versión antes de aprobar una versión (`docs/ti.md`).

Qué comprueba, en cada archivo que descarga (`/`, `/index.html`, `/sw.js`, `/precache.json` y todo el precache publicado):

- **SHA-256 y tamaño** contra la lista, y contra lo que declara el propio `precache.json` publicado. El precache publicado debe ser exactamente el de la lista: un archivo de más o de menos es una diferencia (uno ausente dejaría de verificarse).
- **Cabeceras de 3.6**: las de `public/_headers` (la fuente de verdad, no una copia en el script) y el tipo MIME por extensión; además, que no haya `Set-Cookie` ni las cabeceras que `_headers` quita con `!` (`Access-Control-Allow-Origin`).
- **Sin inyecciones**: el HTML no contiene `/cdn-cgi/`. Una redirección no se sigue: es una diferencia.

Opciones y formato:

```bash
node scripts/verificar-despliegue.mjs <url> [<lista>] [--dist <dir>] [--headers <_headers>] [--todo] [--tiempo <s>]
```

- `<url>`: `https://sig-low.vergarameloabogado.site`. Solo `https` (y `http` para `localhost`, `127.0.0.1` y `[::1]`, que es como se prueba contra `tests/e2e/server.mjs`); sin usuario, contraseña, query ni fragmento.
- `<lista>`: `SHA256SUMS` en el formato de `sha256sum` (`<hex>  ./ruta`). Sin lista, la referencia es el build local (`--dist`, por defecto `dist/`: su `precache.json`, su `sw.js` y la huella de `precache.json`), lo que usa la prueba automatizada.
- `--todo`: con lista, descarga además todos los demás archivos de la lista (los trozos del modelo, cientos de MB) y los compara. Sin `--todo` los trozos se verifican por los SHA-256 del manifiesto del modelo (DoD-39), no uno a uno.
- `--headers`: otro archivo `_headers` de referencia. `--tiempo`: segundos máximos por archivo (60 por defecto).
- Códigos de salida: **0** todo coincide; **1** alguna diferencia (cada una se imprime con su ruta): versión no aprobada; **2** argumentos o referencia incorrectos (no se toca la red).

Prueba: T-PV-15 (`tests/unit/verificar-despliegue.test.ts`, contra `tests/e2e/server.mjs` y servidores de mentira) y T-RD-07 en local (`tests/e2e/zero-network.spec.ts`). El script solo hace `GET` a la dirección dada y no envía ningún dato.

Además, `scripts/check-dist.mjs` (paso de `npm run verify`) ya comprueba sobre el build local que no hay APIs ni patrones prohibidos, que ningún archivo supera 25 MiB y que los SHA-256 de ORT son los aprobados (DoD-17); esa comprobación se repite sobre `dist/` de la etiqueta antes de cargarlo.

### 5.5 Origen distinto del sitio personal (T-PV-25)

- El certificado de `sig-low.vergarameloabogado.site` es válido y no es el del sitio personal.
- Abrir Sig-Low y el sitio personal en el mismo perfil de navegador: ninguno ve el almacenamiento, la caché ni el service worker del otro (herramientas de desarrollo, pestaña Aplicación).
- Ningún `/cdn-cgi/`, ninguna analítica y ningún `Set-Cookie` (secciones 5.1 y 5.2).

### 5.6 Modo avión

Con la versión publicada en la dirección oficial: abrir con conexión, esperar «Lista para funcionar sin conexión», activar el modo avión, recargar y procesar un documento ficticio de principio a fin.

## 6. Resumen de las comprobaciones por criterio

| Criterio | Qué se comprueba | Dónde |
|---|---|---|
| DoD-16 | Cabeceras de `/`, `/sw.js`, un worker de `/assets/` y el `.wasm` de `/ort/` en el dominio oficial | 5.1; salida en `entrega/cabeceras.txt` |
| DoD-17 | Build sin APIs ni patrones prohibidos; ningún archivo de más de 25 MiB | `check-dist` (sección 2) y 5.4 |
| DoD-19 | HTML servido igual al del build; cada archivo del precache igual a la lista de la etiqueta | 5.3 y 5.4 |
| DoD-36, DoD-52 | Dominio oficial con certificado válido, cabeceras de 3.6, sin `/cdn-cgi/` ni analítica, otro origen que el sitio personal | 4 y 5.5 |
| DoD-37, DoD-38 | Etiqueta `v1.0.0`, `SHA256SUMS` y huella de `index.html` igual a «compilación» | 1 y 2.1 |
| DoD-39 | Integridad del modelo publicado: SHA-256 del archivo reensamblado y de cada trozo igual al manifiesto | `trocear-modelo.mjs` (sección 2) y 5.4 |

## 7. Cómo se aplica una actualización

- Cada versión nueva es un despliegue nuevo hecho con las secciones 2, 3 y 5, desde su propia etiqueta firmada.
- El navegador de quien ya usa Sig-Low descarga la lista de archivos nueva en segundo plano. La versión nueva **queda en espera y se aplica sola la próxima vez que se abre Sig-Low con todas sus pestañas cerradas**, sin que nadie la acepte y sin que la página pueda impedirlo. Mientras haya una pestaña abierta, sigue la versión anterior.
- Dentro de la sesión, el aviso «Hay una versión nueva» solo permite aplicarla antes: exige guardar o exportar la tabla de correspondencia, porque aplicar la versión nueva borra la tabla que está en memoria.
- `/sw.js` no pasa por el service worker y su caché HTTP del navegador tiene un tope de 24 horas: una versión nueva puede tardar hasta un día en detectarse en un equipo que no la pida antes.
- Si la instalación de la versión nueva falla (algún archivo no coincide con su SHA-256), sigue la versión anterior.
- La caché del modelo no se toca al actualizar: el modelo no se vuelve a descargar.
- **Por qué esto exige cuidado con la cuenta del alojamiento:** quien pueda publicar en el proyecto puede publicar código que se ejecuta, sin aceptación, en la sesión siguiente de todos los usuarios, con acceso al texto en claro. Por eso hay segundo factor, publica una sola persona, se publica solo desde una etiqueta firmada y cada versión se verifica por fuera (5.4).
- Para volver a una versión anterior, se carga de nuevo el `dist/` de su etiqueta (sección 3). Los equipos que ya aplicaron la versión nueva reciben la anterior por el mismo mecanismo [VERIFICAR el comportamiento del service worker ante una versión «anterior» antes de depender de esto].
- Con cada versión, avisar a los despachos que tengan configurada la verificación externa (`docs/ti.md`) y publicar en las notas de la versión las huellas SHA-256 de `SHA256SUMS`.

## 8. Qué no hacer

- No publicar copias de Sig-Low en otras direcciones ni otros alojamientos; una copia no oficial podría ver todo lo que procesa.
- No activar Web Analytics, funciones de Pages, Workers, ni reglas de transformación del alojamiento.
- No subir a `dist/` el modelo completo en un solo archivo, ni las compilaciones `asyncify`, `jsep` o `jspi` de ORT (superan los 25 MiB).
- No guardar tokens, claves ni identificadores de cuenta en el repositorio, en `entrega/` ni en estas guías.
- No cambiar `public/_headers` sin repetir las comprobaciones de la sección 5.
