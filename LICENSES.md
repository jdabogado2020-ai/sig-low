# Licencias y créditos de terceros

Este archivo reúne los avisos de las licencias de los componentes de terceros que Sig-Low incluye o usa. Se corresponde con la pantalla «Créditos y licencias» (dentro de «Acerca de» en la aplicación), que no tiene casilla de aceptación.

- **Licencia del código de Sig-Low:** Apache License 2.0 (archivo `LICENSE`; avisos en `NOTICE`). Cubre solo el código fuente de este repositorio. No concede el uso del nombre «Sig-Low» como marca (sección 6 de la licencia).
- **Qué no cubre:** el manual y el curso de Sig-Low no forman parte de este repositorio y conservan todos los derechos reservados.
- **De dónde salen los datos de este archivo:** versiones de `package.json` y `package-lock.json`; textos de licencia de `node_modules/*/LICENSE` (copiados sin cambios, salvo donde se dice lo contrario); huellas y commits de los modelos de `h0/huellas.txt` (H0-5, H0-6 y H0-8, verificadas el 29-oct-2026); fecha de corte y fuente de la DIVIPOLA de H0-8. Lo que no se pudo comprobar queda marcado **[VERIFICAR]** y se reúne en la sección 8; según el plan (DoD-27), una licencia sin comprobar bloquea el cierre.

## 1. Resumen de lo que llega a quien usa Sig-Low

| Componente | Versión | Licencia | Cómo se usa | Texto de la licencia |
|---|---|---|---|---|
| GLiNER-X large (`knowledgator/gliner-x-large`, cuantizado a 8 bits) | commit `4a4437f4` | Apache-2.0 | Modelo principal; se descarga aparte, no está en el repositorio | sección 2 y `LICENSE` |
| GLiNER-X base (`knowledgator/gliner-x-base`, cuantizado a 8 bits) | commit `a6c7a8fb` | Apache-2.0 | Modelo de respaldo; se descarga aparte | sección 2 y `LICENSE` |
| mT5-large y mT5-base de Google (modelos base de GLiNER-X, con el tokenizador `tokenizer.json`) | los de los commits anteriores | Apache-2.0 | Base de los dos modelos; el tokenizador viaja con ellos | sección 2 y `LICENSE` |
| Código incorporado de `@piighost/ner-web` (en `src/core/ner/gliner/`) | 0.3.0 | MIT | Parte del código fuente de Sig-Low, con modificaciones | sección 3 |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | Lee `tokenizer.json` del modelo; va en el build | `LICENSE` y sección 4.2 |
| `onnxruntime-web` (solo `ort-wasm-simd-threaded.mjs` y `.wasm`, y el cargador de JavaScript) | 1.31.0-dev.20260914-8d85527a0 | MIT | Ejecuta el modelo en el navegador; va en el build | sección 4.1 |
| `pdfjs-dist` (pdf.js, versión legacy) | 6.4.299 | Apache-2.0 | Lee el texto de los PDF; va en el build | `LICENSE` y sección 4.2 |
| core-js (dentro de pdf.js) | 3.50.0 | MIT | Reemplazos de funciones del lenguaje que pdf.js lleva en su paquete; va en el build | sección 4.1 |
| Preact | 10.29.8 | MIT | Interfaz; va en el build | sección 4.1 |
| fflate | 0.8.3 | MIT | Lectura y escritura de ZIP (`.docx`); va en el build | sección 4.1 |
| `@xmldom/xmldom` | 0.9.12 | MIT | Lectura de XML (`.docx`); va en el build | sección 4.1 |
| DIVIPOLA del DANE (`data/divipola.json`, adaptación) | corte 2024-12-30 | CC BY-SA 4.0 | Municipio a departamento y código DANE de radicados | sección 5 |
| Listas del proyecto (`cargos`, `diagnosticos`, `cie10-patron`, `llamativos`, `menores`, frases comunes) | del repositorio | Apache-2.0 (propias) | Banderas, sugerencias y control de la frase de paso | sección 5 |

Todo lo demás de `npm ls --omit=dev --all` está en la sección 6 con su licencia. Las herramientas de construcción y de pruebas no se distribuyen (sección 7).

## 2. Modelos de reconocimiento de entidades

Los modelos no están en este repositorio. La aplicación los descarga una sola vez desde su propio alojamiento, los parte en trozos de hasta 24 MiB, verifica su SHA-256 contra `public/models/<id>/manifest.json` y los guarda en el navegador de quien los usa.

| | GLiNER-X large (principal) | GLiNER-X base (respaldo) |
|---|---|---|
| Repositorio de origen | `knowledgator/gliner-x-large` | `knowledgator/gliner-x-base` |
| Autor | Knowledgator | Knowledgator |
| Commit | `4a4437f439a78d67c87781b42e8c45373d2adcb0` | `a6c7a8fbfe2066c68d12c0480418504fde6d91d1` |
| Licencia del modelo | Apache-2.0 | Apache-2.0 |
| Modelo base | `google/mt5-large`, Apache-2.0 | `google/mt5-base`, Apache-2.0 |
| `onnx/model_quantized.onnx` | 610.122.400 B, SHA-256 `90a7d3b8bf985da65748f0b1972bd6696bab34f375f23ad4f4a60ac14842ad2c` | 302.646.302 B, SHA-256 `9850feb5ecd7ccfa3e4f1802b7c7d404f1b357cb7b6198cc014fb441e91ace43` |
| `tokenizer.json` (vocabulario de mT5) | 16.350.298 B, SHA-256 `644a91650f64b0fe5974cefcd293bafa754f014f8f72503ae7940ae652d22b2f` | 16.335.050 B, SHA-256 `619d3790cf59a0e50afdf04239db19093568fbd8d806963e35d54a8fb71d099c` |
| `tokenizer_config.json` | SHA-256 `b7502927c4693c1c7234d1267dcd422fcc2d7597c51abfe3913fedc1a0f766e6` | SHA-256 `08540ea44a5b8bf6a155e89902698c642d623657996c6e4d898236b159589404` |
| `gliner_config.json` | SHA-256 `aaecd24d06655755d7289322eec153c0dce93830ad21b6fc82a8ff8f5dc39f60` | SHA-256 `70bdc897e45538685f79309af9dc97e5d35eeee3f2c385db75d5865689613c14` |

Las huellas son las de `h0/huellas.txt`; coinciden con el SHA-256 de Git LFS publicado por el repositorio de origen y con la sección 4.2 del plan técnico. El texto de la Licencia Apache 2.0 aplicable a estos modelos y a sus modelos base es el del archivo `LICENSE` de este repositorio.

**Pendientes de los modelos (bloquean el cierre, ver sección 8):**

- La licencia de los **datos de entrenamiento** de GLiNER-X no está declarada: el conjunto sintético de Knowledgator no trae licencia ni ficha. El modelo y su base sí declaran Apache-2.0. La confirmación escrita del autor se pide antes de vender el producto [VERIFICAR con Knowledgator].
- **Archivo NOTICE y ficha del modelo.** La descarga de H-0 guardó el ONNX, los tokenizadores y las configuraciones; no guardó la ficha ni el `LICENSE`/`NOTICE` del repositorio de origen. Comprobado el 1-nov-2026 en los listados de archivos de los repositorios de origen: ni `knowledgator/gliner-x-large` (commit `4a4437f…`) ni `knowledgator/gliner-x-base` (commit `a6c7a8f…`), ni `google/mt5-large` ni `google/mt5-base` (rama `main`) tienen un archivo `NOTICE` ni `LICENSE`; declaran Apache-2.0 solo en los metadatos de la ficha. No hay `NOTICE` que reproducir; el texto de la Licencia Apache 2.0 es el del archivo `LICENSE` de este repositorio.

## 3. Código incorporado: `@piighost/ner-web`

Cuatro archivos de `src/core/ner/gliner/` derivan de la versión 0.3.0 del paquete npm `@piighost/ner-web` (repositorio `https://github.com/Athroniaeth/piighost-browser`), de licencia MIT. Se copiaron al repositorio, en lugar de depender del paquete, y llevan su aviso MIT en la cabecera de cada archivo.

| Archivo de Sig-Low | Deriva de (en `@piighost/ner-web` 0.3.0) | Modificación |
|---|---|---|
| `decoder.ts` | `src/gliner/decoder.js` (`decodeSpanLevel`, `greedySelect`) | TypeScript; `spanCandidatesFromLogits` y `decodeSpans` (umbral inclusivo, sin solapes, anchura máxima 12); se retiran el modo por token y el anidado |
| `processor.ts` | `src/gliner/processor.js` (`encode`, `buildSpans`) | TypeScript; codificación por ventana de palabras; prompt de las tres etiquetas; sin token inicial en mT5 |
| `splitter.ts` | `src/splitter.js` | TypeScript; patrón con marcas combinantes; invisibles dentro de la palabra |
| `tokenizer.ts` | `src/gliner/processor.js` (`measureSpecialTokens`) | TypeScript; **parche para tokenizadores basados en mT5** (solo `</s>` al final, sin token inicial); lector de `tokenizer.json` con `@huggingface/tokenizers` |

Los demás archivos de `src/core/ner/gliner/` (`index.ts`, `errors.ts`, `offsets.ts`, `run.ts`, `types.ts`, `windows.ts`) son código propio de Sig-Low.

Texto de la licencia de ese código (el de la cabecera de cada archivo):

```text
MIT License

Copyright (c) 2025 Athroniaeth

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. Textos de las licencias de los componentes del build

### 4.1 MIT

**Preact 10.29.8**

```text
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**fflate 0.8.3**

```text
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**@xmldom/xmldom 0.9.12**

```text
Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors
Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

**onnxruntime-web 1.31.0-dev.20260914-8d85527a0**

El paquete npm no incluye un archivo de licencia; el aviso es el que lleva el propio archivo `ort.wasm.min.mjs` («Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License»). El texto siguiente es el del `LICENSE` del repositorio de onnxruntime (`microsoft/onnxruntime`, rama principal), comparado el 1-nov-2026: coincide con el titular y el cuerpo de la licencia MIT.

```text
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**core-js 3.50.0 (dentro de `pdfjs-dist`)**

`node_modules` no incluye el `LICENSE` de core-js: pdf.js lo lleva empaquetado y declara en su propio código el titular, la licencia y la dirección del texto (`pdf.mjs`: «© 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io)»; licencia en `https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE`; MIT). El texto siguiente es el del `LICENSE` de la etiqueta v3.50.0 de core-js, consultado el 1-nov-2026 (los dos avisos de derechos de autor van en líneas separadas, como en el original).

```text
Copyright (c) 2013–2025 Denis Pushkarev (zloirock.ru)
Copyright (c) 2025–2026 CoreJS Company (core-js.io)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### 4.2 Apache-2.0

Los componentes siguientes están bajo la Licencia Apache 2.0, cuyo texto completo es el del archivo `LICENSE` de este repositorio (el mismo que traen `long` y `flatbuffers` en `node_modules`, byte por byte; el de `@huggingface/tokenizers` solo difiere en una línea en blanco inicial):

- **pdf.js (`pdfjs-dist` 6.4.299, versión legacy).** Copyright 2024 Mozilla Foundation (cabecera de `legacy/build/pdf.mjs`). Aviso de licencia incluido en el paquete:

  > Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  No se incluyen los recursos opcionales de pdf.js (fuentes estándar, cmaps ni wasm), que tienen otras licencias.
- **@huggingface/tokenizers 0.2.0.** Autor: Hugging Face. El paquete trae el texto completo de la Licencia Apache 2.0 sin línea de derechos de autor propia.
- **GLiNER-X large, GLiNER-X base y mT5** (sección 2).

Archivos `NOTICE` de estos componentes: `pdfjs-dist` y `@huggingface/tokenizers` no incluyen un archivo `NOTICE` en su paquete npm (comprobado en `node_modules`). Los de los modelos: ver sección 2.

## 5. Datos y listas

**DIVIPOLA, división político-administrativa de Colombia (`data/divipola.json`).**

- Fuente: Departamento Administrativo Nacional de Estadística (DANE), publicada en datos.gov.co, conjunto `gdxc-w37w` («DIVIPOLA – Códigos municipios»), corte 2024-12-30. CSV de origen: 1.122 filas.
- Licencia: Creative Commons Atribución-CompartirIgual 4.0 Internacional (CC BY-SA 4.0), `https://creativecommons.org/licenses/by-sa/4.0/`.
- Cambios: `data/divipola.json` es una adaptación (recorte de columnas y reorganización para la búsqueda) del CSV de origen. Se distribuye aparte bajo la misma licencia, CC BY-SA 4.0 (compartir igual): quien redistribuya ese archivo o una adaptación suya debe atribuir al DANE, indicar los cambios y usar la misma licencia.
- Alcance: la licencia CC BY-SA 4.0 cubre ese archivo de datos y sus adaptaciones. No se extiende al código de Sig-Low ni a la aplicación.

**Listas propias.** `data/cargos.json`, `data/diagnosticos.json`, `data/cie10-patron.json`, `data/llamativos.json` y `data/menores.json` son redacción propia del proyecto, sin copiar catálogos de terceros (de la CIE-10 solo se usa el patrón del código). La **lista de frases comunes** que rechaza frases de paso previsibles es de redacción propia, sin datos de terceros (se mantiene en `src/vault/crypto.ts` hasta que se mueva a `data/frases-comunes.json`). Todas van bajo la licencia del código (Apache-2.0).

## 6. Resto del árbol de producción (`npm ls --omit=dev --all`)

Dependencias transitivas de las anteriores. Según la búsqueda que hizo DOC-1 en el build local (`dist/assets/*.js`), no aparecen en el build; P0-5 y P0-6 repiten la comprobación sobre el build publicado.

| Paquete | Versión | Licencia | Es dependencia de |
|---|---|---|---|
| onnxruntime-common | 1.31.0-dev.20260911-2a43ec07e | MIT | onnxruntime-web |
| flatbuffers | 25.9.23 | Apache-2.0 | onnxruntime-web |
| guid-typescript | 1.0.9 | ISC | onnxruntime-web |
| long | 5.3.2 | Apache-2.0 | onnxruntime-web |
| platform | 1.3.6 | MIT | onnxruntime-web |
| protobufjs | 7.6.6 | BSD-3-Clause | onnxruntime-web |
| @protobufjs/aspromise, base64, codegen, eventemitter, fetch, float, path, pool, utf8 | 1.1.2, 1.1.2, 2.0.5, 1.1.1, 1.1.1, 1.0.2, 1.1.2, 1.1.0, 1.1.2 | BSD-3-Clause | protobufjs |
| @types/node | 26.6.6 | MIT | protobufjs |
| undici-types | 8.9.0 | MIT | @types/node |
| @napi-rs/canvas y sus binarios por plataforma (12 paquetes, versión 1.0.13) | 1.0.13 | MIT | pdfjs-dist (dependencia opcional para Node; el navegador no la usa) |

`guid-typescript` no incluye archivo de licencia; la licencia ISC es la que declara su `package.json`. Texto de BSD-3-Clause de `protobufjs` y de `@protobufjs/*` (el mismo en los nueve paquetes):

```text
Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## 7. Herramientas de construcción y pruebas (no se distribuyen)

Vite 8.3.5 (MIT), TypeScript 6.0.3 (Apache-2.0), ESLint 10.13.0 y typescript-eslint 8.72.0 (MIT), Vitest 5.0.5 (MIT), Playwright 1.64.1 (Apache-2.0) y sus dependencias. No forman parte del build ni de lo que se publica. El aviso de TypeScript se conserva en «Créditos y licencias» porque el plan lo incluye entre los componentes Apache-2.0.

## 8. Pendientes (cada uno bloquea el cierre hasta resolverse)

| # | Pendiente | Quién |
|---|---|---|
| 1 | Licencia de los datos de entrenamiento de GLiNER-X: confirmación escrita de Knowledgator [VERIFICAR]. | Dueño |
| 2 | ~~Archivo `NOTICE` y ficha de cada repositorio de modelo.~~ Resuelto (DOC-4, 1-nov-2026): los repositorios de GLiNER-X (large y base) y de mT5 (large y base) no tienen `NOTICE` ni `LICENSE`; declaran Apache-2.0 en la ficha (sección 2). | Integrador |
| 3 | ~~Texto de la licencia de core-js 3.50.0 y de onnxruntime.~~ Resuelto (DOC-4, 1-nov-2026): los textos de la sección 4.1 son los del `LICENSE` de la etiqueta v3.50.0 de core-js y del repositorio de onnxruntime. | Integrador |
| 4 | ~~Titular y año del aviso de derechos de autor de `LICENSE`/`NOTICE`.~~ Resuelto por el dueño (D-08, 31-oct-2026): «Copyright 2026 Juan David Vergara Melo». | Dueño |
| 5 | Revisión legal de las obligaciones de esta lista (Apache-2.0 con NOTICE, MIT, CC BY-SA 4.0 y licencia de los datos de los modelos). | Dueño |
| 6 | Repetir `npm ls --omit=dev --all` contra el `package-lock.json` de la etiqueta `v1.0.0` y comparar con la sección 6. Avance (DOC-4, 1-nov-2026): las 35 entradas de producción del `package-lock.json` de esta rama coinciden en nombre y versión con las secciones 3, 4 y 6, y `npm ls --omit=dev --depth=0` da los mismos seis paquetes directos; falta repetirlo sobre la etiqueta. | Integrador (P0-5) |

## 9. Cómo se comprobó este archivo

- Versiones y licencias declaradas: `package.json`, `package-lock.json` y `node_modules/<paquete>/package.json`.
- Textos: `node_modules/<paquete>/LICENSE`; el de la Licencia Apache 2.0 de `LICENSE` es el de `long` y `flatbuffers` (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, con un salto de línea inicial menos en `LICENSE`).
- Modelos y datos: `h0/huellas.txt` (H0-5, H0-6 y H0-8).
- Código incorporado: cabeceras de `src/core/ner/gliner/*.ts`.
