# Informe de medición de Sig-Low

> **Estado: final (v1.0.0, 2 de noviembre de 2026).** Este informe recoge la medición de cierre del producto completo (reglas, lista del caso y modelo, 29 documentos, tres vistas: veredicto **CIERRA**, 0 brechas de cierre abiertas), la calibración y la evaluación del modelo de apoyo, y los tiempos y la memoria de la medición final de rendimiento (P0-5). Cada cifra sale de un archivo de resultados (`corpus/resultados/`, `corpus/brechas.json`) o de métricas (`metricas/`), y se cita. Lo que no se midió en v1.0.0 está dicho como «no medido en v1.0.0», con su motivo (secciones 7.4 y 10). Ninguna cifra se ha estimado ni inventado. Lo que este informe no dice: que el sistema funcione igual con escritos reales, que la banda de 0,37 esté confirmada ni que la reserva sea una prueba ciega (secciones 6.3 y 8).

Las cifras salen de los archivos de `metricas/` de este repositorio, en los que está cada cifra con su n; la sección 9 explica cómo recalcularlas. Los decimales llevan coma. «10.4.1» es la tabla de umbrales de cierre del plan técnico del proyecto (documento interno); sus filas están reproducidas en la sección 2, y los identificadores `PF-3`, `PF-4a`, `PF-4b`, `P0-4`, `P0-5` y `T-AB-nn` son tareas y pruebas de ese plan.

## 0. Resumen

| Tema | Estado |
|---|---|
| Calibración del umbral y de las etiquetas del modelo (PF-3) | Medida. `nerMinScore` = 0,30; `nerHighThreshold` = 0,37; etiquetas `person`, `organization`, `location`. |
| Evaluación del principal, GLiNER-X large, por vista (PF-4a) | Medida **para el modelo solo**. Cumple las dos filas de 10.4.1 «fuera de la lista» en la vista natural y personas en las tres vistas; **no cumple organizaciones en MAYÚSCULAS (0,676) ni en minúsculas (0,613)** frente a 0,80. |
| Evaluación del respaldo, GLiNER-X base, por vista (PF-4b) y comparación (T-AB-04) | Medida **para el modelo solo**. Iguala al principal en la vista natural (organizaciones: −3 puntos) y pierde hasta 19 puntos en MAYÚSCULAS y minúsculas. Informativa: no es vía de cierre (10.4.2). |
| Producto completo contra las filas de 10.4.1 (identificadores, rotulados, lista, direcciones, fechas, banderas, negativos, precisión, fatiga, consistencia, colisiones, residuos) | Medido (sección 6). **Veredicto CIERRA**: todas las filas de cierre cumplen sobre los 29 documentos, con 0 residuos tras la revisión simulada. La precisión de organizaciones y la lectura de la reserva tienen límites declarados (secciones 6.3 y 8). |
| Tiempos de 10 páginas y meta de rendimiento (T-ME-04, D-20) | Medidos con 4, 8, 12 y 16 hilos (sección 7.1): 186, 158 y 160, 115 y 113 s por 10 páginas; **cumplen la meta vigente (D-20)**, que el dueño cambió el 2 de noviembre de 2026 (la anterior no se cumplía con 8 hilos). Edge con «Estricto»: no medido en v1.0.0. |
| Memoria pico | Medida: de 2.427 a 2.702 MB del navegador completo con el principal (sección 7.1). Con el respaldo: solo la cifra de la sección 7.2. |
| Brechas | `corpus/brechas.json`: 33 registros, 32 cerrados y 1 abierto, informativo (posible sobreajuste de `TELEFONO` en la reserva); 0 brechas de cierre (sección 8). |

## 1. Qué se mide y cómo

### 1.1 Corpus y respuestas correctas

- **29 documentos medibles** del corpus ficticio, 19 de desarrollo y 10 de reserva (el trigésimo, C04, es un PDF escaneado sin capa de texto, que la aplicación rechaza). Todos los datos son inventados con nombres como «Ficticia», «Ejemplo» y «Prueba»: **el corpus es sintético y no son escritos reales**.
- Las respuestas correctas (gold) son las adjudicadas del corpus, en `corpus/gold` (commit `797987a`). Cada mención gold tiene su tipo, su posición y, para este informe, si el dato está o no en la lista del caso (`enLista`).
- La reserva se informa aparte; si en una fila su exhaustividad queda más de 0,03 por debajo de la del desarrollo, se registra la brecha «posible sobreajuste». **Desde la tanda 3 la reserva no es una prueba ciega** (D-10, 31 de octubre de 2026): `corpus/brechas.json` trae sus ids y los ajustes pudieron mirar las menciones de la reserva que fallaban, con la condición de que cada corrección fuera una regla general y nunca un caso puntual. La reserva sirvió para ajustar; por eso sus cifras no se leen como una medición independiente.
- El gold de la sección 6 es el final: el adjudicado más los cambios aprobados por el dueño y registrados en `revision.cambios` (D-06: 81 `MUNICIPIO` dentro de un despacho pasan a `DESPACHO_A_GENERICO` y 14 edades de menores pasan de `FECHA` a `MENOR`, y las 18 edades de adultos salen de la cuenta de exhaustividad y se miden en la fila de banderas; D-17: «Doña Gloria» de C24 es otra persona fuera de la lista), más los alias de la lista del caso aprobados por el dueño (D-16 y D-17). Las secciones 3 a 5 conservan las cifras tal como se midieron en PF-3, PF-4a y PF-4b; la confirmación del umbral con el gold final está en `metricas/calibracion-reserva.json` (sección 3.2).
- **Cada cifra de este informe lleva su n** (menciones o entidades del corpus). Con n pequeño, una diferencia de uno o dos puntos no distingue un resultado de otro.

### 1.2 Medidas

- **Exhaustividad de protección por mención:** fracción de las menciones gold positivas que quedan cubiertas por una detección aceptable: que contiene todo el tramo y no se pasa por más de 12 caracteres (o la longitud del dato, si es mayor) de texto ajeno; no importa el tipo con que se detectó, porque un dato reemplazado con otro tipo no se fuga. Es la medida de las filas de cierre de 10.4.1 («Mención»).
- **Exhaustividad por entidad estricta:** fracción de las entidades cuyas menciones quedan **todas** cubiertas («Entidad»): una sola mención fugada basta para reidentificar. También se calcula la laxa (basta una mención cubierta).
- **Precisión:** fracción de las detecciones que corresponden a una mención gold del mismo tipo. **Precisión global:** la de todos los tramos del modelo (personas, organizaciones y ubicaciones). **F2:** `5·P·R / (4·P + R)`: la exhaustividad pesa cuatro veces más que la precisión (lo que se deja sin proteger pesa más que lo que se propone de más).
- Las tres etiquetas del modelo son `PER` (personas), `ORG` (organizaciones) y `LOC` (ubicaciones). «Fuera de la lista» son las menciones que la lista del caso no conoce, y por tanto solo el modelo (y las reglas) pueden detectar.

### 1.3 Vistas

La misma lectura se hace sobre tres versiones del texto, con las mismas posiciones: **natural**, **MAYÚSCULAS** y **minúsculas**. Un encabezado, una firma o un correo pegado pueden venir enteros en mayúsculas o en minúsculas, y el modelo rinde distinto. La vista es solo de medición: la aplicación no cambia el texto del usuario.

### 1.4 «Modelo solo» y «producto completo»

- **Modelo solo:** lo que detecta el modelo, sin reglas ni lista del caso. Es la comparación honesta entre modelos y es lo que miden las secciones 3 a 5.
- **Producto completo:** reglas, lista del caso y modelo, fusionados como en la aplicación. Las filas de cierre de 10.4.1 se evalúan sobre el producto completo. Su medición de cierre está en la sección 6.

### 1.5 Condiciones de las pasadas del modelo

| Parámetro | Valor |
|---|---|
| Modelos | GLiNER-X large (principal) y GLiNER-X base (respaldo), cuantizados a 8 bits; huellas y commits en `LICENSES.md` |
| Motor | Código propio de Sig-Low sobre ONNX Runtime Web 1.31.0-dev.20260914-8d85527a0, sin Transformers.js |
| Ventana | 512 tokens; solape de 37 palabras; tramos de hasta 12 palabras |
| Etiquetas | `person`, `organization`, `location` |
| Piso de proposición (`nerMinScore`) | 0,30 |
| Banda `media` (`nerHighThreshold`) | 0,37 |
| Equipo de referencia | AMD Ryzen 7 5700U (8 núcleos, 16 hilos), 15,3 GB de memoria, Windows 11 |
| Navegador de las pasadas | Chromium 156 de Playwright 1.64.1; Edge 156 para las pruebas de Edge |
| Hilos de las pasadas de evaluación | 8 |

### 1.6 Cachés de salidas y su verificación

Una pasada completa del modelo tarda varios minutos por vista. Por eso las salidas por ventana (posiciones, etiquetas y puntajes, nunca texto) se guardan en `metricas/modelo-<id>-vistas.json`, atadas por huella al texto exacto de cada documento, a la vista, al ONNX y al código del motor. El umbral y el cálculo de las filas se pueden cambiar sin repetir la pasada.

La caché se verifica contra una pasada nueva (T-AB-06): se vuelven a pasar C22, C10 y C13 y se comparan tramos y puntajes con tolerancia de 1e-4. Resultado: **reproduce con diferencia máxima de puntaje 0** en las vistas natural (13 ventanas, 361 tramos en x-large) y MAYÚSCULAS (16 ventanas, 496 tramos). Para x-base se verificaron las tres vistas (13, 16 y 13 ventanas; 542, 971 y 813 tramos), también con diferencia máxima 0.

### 1.7 Reglas de honestidad

No se baja un umbral, no se edita el gold sin la adjudicación documentada, no se sacan documentos tras ver los resultados y no se mide solo sobre desarrollo para «hacer pasar» una fila. Si una fila de cierre queda incumplida, se registra en `corpus/brechas.json` y rige la regla de cierre del plan (10.4.3 y 12.7): no se publica.

## 2. Filas de 10.4.1 y dónde está cada una

Se evalúa sobre los 29 documentos, con el modelo principal y el umbral y las etiquetas de la sección 3. Todas las filas son de cierre salvo las marcadas «informativa».

| Grupo | Tipos | Mención | Entidad | Estado |
|---|---|---|---|---|
| Identificadores con patrón fuerte o validador | `CC`, `NIT`, `RADICADO`, `TELEFONO`, `CORREO` | ≥ 0,98 por tipo | ≥ 0,96 | **Cumple.** Mención, vista natural: `CC` 1,000 (n 105), `NIT` 1,000 (73), `RADICADO` 1,000 (89), `TELEFONO` 0,985 (137), `CORREO` 1,000 (117). Entidad estricta: 1,000 en todos salvo `TELEFONO` 0,977. Igual en las tres vistas. |
| Identificadores rotulados | `TI`, `CE`, `PPT`, `PEP`, `PASAPORTE`, `TP`, `DOCUMENTO`, `RADICADO_ADMIN`, `PLACA`, `MATRICULA`, `CUENTA`, `TARJETA`, `HC`, `AFILIACION` | ≥ 0,98 del grupo; 0 omisiones con `rotulado: true` | ≥ 0,96 | **Cumple.** Grupo: mención 1,000 (n 378), entidad 1,000; con rótulo, 378 de 378 (0 omisiones). Igual en las tres vistas. |
| Personas y organizaciones de la lista | Menciones con `enLista: true` | ≥ 0,98; 0 omisiones en las clases `exacta`, `sin_tildes` y `mayusculas` | ≥ 0,95 | **Cumple.** Natural: mención 0,998 (n 808), entidad 0,979; MAYÚSCULAS y minúsculas: 0,996 y 0,969. Clases `exacta`, `sin_tildes` y `mayusculas` (las fuertes): 300 de 300, 0 omisiones. |
| Personas fuera de la lista | `PERSONA` con `enLista: false` | ≥ 0,85 | ≥ 0,75 | **Cumple (producto).** Natural: mención 0,985 (n 272), entidad 0,971. Modelo solo: sección 4. |
| Organizaciones fuera de la lista | `EMPRESA`, `EPS`, `IPS`, `ENTIDAD`, `PROVEEDOR` con `enLista: false` | ≥ 0,80 | ≥ 0,70 | **Cumple (producto).** Natural: mención 1,000 (n 142), entidad 1,000. Modelo solo: sección 4. |
| Personas fuera de la lista, por vista | Tres filas (natural, MAYÚSCULAS, minúsculas) | ≥ 0,85 en cada vista | ≥ 0,75 | **Cumple las tres.** Mención (entidad estricta), n 272: natural 0,985 (0,971); MAYÚSCULAS 0,915 (0,846); minúsculas 0,915 (0,846). |
| Organizaciones fuera de la lista, por vista | Tres filas | ≥ 0,80 en cada vista | ≥ 0,70 | **Cumple las tres.** Mención (entidad estricta), n 142: natural 1,000 (1,000); MAYÚSCULAS 0,838 (0,753); minúsculas 0,838 (0,753). Con el modelo solo no se cumplían (sección 4): las reglas y la lista aportan lo que el modelo pierde. |
| Direcciones | `DIRECCION`, `BARRIO` | ≥ 0,95 | ≥ 0,93 | **Cumple.** Natural: mención 0,996 (n 227), entidad 0,994; MAYÚSCULAS y minúsculas: 0,991 y 0,988. |
| Fechas y valores | `FECHA`, `VALOR` | ≥ 0,95 por tipo | ≥ 0,93 | **Cumple.** `FECHA` 1,000 (n 306), `VALOR` 1,000 (177); entidad 1,000 en ambas. Igual en las tres vistas. |
| Municipios, despachos y autoridades | `MUNICIPIO` y despachos | ≥ 0,95 con la sugerencia presente | — | **Cumple.** Sugerencia de municipio a departamento presente en 159 de 165 (0,964); de despacho a genérico, 162 de 162. |
| Banderas de datos indirectos | `CARGO`, `DIAGNOSTICO`, `MENOR`, fecha de nacimiento y edad | ≥ 0,90 | — | **Cumple.** 239 de 239 (1,000): `CARGO` 84/84, `DIAGNOSTICO` 45/45, `MENOR` 57/57, fecha de nacimiento 35/35, edad 18/18. Las 18 edades de adultos cuentan aquí (D-06). |
| Hechos llamativos (informativa) | `HECHO_LLAMATIVO` | ≥ 0,60 | — | **No alcanza la meta informativa: 5 de 27 (0,185).** Brecha informativa conocida (D-12): ampliar la lista sería ajustarla al corpus plantilla. No bloquea el cierre. |
| Negativos | Normas, sentencias y códigos | ≤ 0,10 con detección | — | **Cumple.** Natural: 9 de 283 con detección (0,032); MAYÚSCULAS y minúsculas: 11 de 283 (0,039). |
| Citas con radicado | Citas jurisprudenciales | 1,00 con bandera | — | **Cumple.** 10 de 10 con bandera, en las tres vistas. |
| Precisión global | Todas las detecciones | ≥ 0,70 | — | **Cumple.** Natural 0,946 (3.004 detecciones, 161 falsas); MAYÚSCULAS y minúsculas 0,936. |
| Fatiga (informativa) | Falsos positivos por página | ≤ 5 de media; ningún documento con más de 10 | — | **Cumple.** Natural: 2,35 por página de media (68,65 páginas), máximo por documento 6,00; MAYÚSCULAS y minúsculas: 2,78 y 7,67. |
| Consistencia | Entidades con 2 o más menciones | 1,00 en identificadores, lista, fechas y valores; ≥ 0,95 en personas y organizaciones del modelo | — | **Cumple (vista natural, la que evalúa el veredicto).** Identificadores 172 de 172, lista 92 de 92, fechas y valores 60 de 60, modelo 106 de 109 (0,972). Informativo: en MAYÚSCULAS y minúsculas la lista da 91 de 92 y el modelo 93 de 95 (0,979). |
| Colisiones (informativa) | Identificadores, lista, fechas y valores, y del modelo | 0, se informa cada una | — | **Cumple las duras: 0** (identificadores, lista, fechas y valores). **Del modelo, informativas:** natural 2 (7 menciones afectadas: C01-A046, C01-A052, C01-A113, C01-A118, C15-A003, C15-A020 y C15-A043), MAYÚSCULAS y minúsculas 1 cada una (3 menciones: C15-A003, C15-A020 y C15-A043). El revisor las separa con «separar mención». |
| **Residuos** | Todas las menciones positivas, tras la revisión simulada | **0 en los 29 documentos** (condición dura) | — | **Cumple: 0 residuos en los 29 documentos, en las tres vistas**, contado por dato (D-14, sección 6.3). La primera vuelta de revisión simulada dejó 38 (natural), 76 (MAYÚSCULAS) y 76 (minúsculas); la última, 0 en las tres. Concordancia con el escáner independiente (`residue.ts`): sí. |
| Rendimiento (T-ME-04) | (a) reglas y lista; (b) GLiNER-X large | Meta vigente (D-20, 2 de noviembre de 2026): (a) ≤ 1 s por página; (b) ≤ 15 s por página con 12 hilos o más y ≤ 20 s con 4 a 11 hilos. Meta anterior (plan A.11): (a) ≤ 1 s por página (mediana); (b) ≤ 2 min por 10 páginas con 8 hilos o más y ≤ 4 min con 4 a 7 hilos | — | **(a) Cumple en Node, no medido en el navegador:** mediana de 35 ms por página sobre los 29 documentos (sección 7.1). **(b) Cumple la meta vigente** con 4, 8, 12 y 16 hilos (sección 7.1); **con la meta anterior no cumplía con 8 hilos** (158 y 160 s frente a 120 s). |

## 3. Calibración del modelo (PF-3)

Se calibró con las salidas de x-large sobre 19 documentos de desarrollo con la vista natural (813 menciones de PER y ORG; 182 de LOC en esos documentos). La **precisión global** de esta tabla es la de todos los tramos del modelo (PER, ORG y LOC).

### 3.1 Piso de proposición (`nerMinScore`)

| Umbral (`nerMinScore`) | Precisión global | Exhaustividad PER+ORG | Precisión PER+ORG | F2 PER+ORG | Exh. PER | Exh. ORG | Exh. LOC |
|---|---|---|---|---|---|---|---|
| 0,20 | 0,788 | 0,968 | 0,763 | 0,919 | 0,989 | 0,923 | 0,984 |
| 0,25 | 0,826 | 0,961 | 0,802 | 0,924 | 0,980 | 0,920 | 0,984 |
| **0,30** | 0,861 | 0,943 | 0,842 | 0,921 | 0,962 | 0,904 | 0,978 |
| 0,40 | 0,911 | 0,883 | 0,896 | 0,886 | 0,888 | 0,874 | 0,945 |
| 0,50 | 0,917 | 0,803 | 0,903 | 0,821 | 0,784 | 0,843 | 0,841 |
| 0,60 | 0,926 | 0,684 | 0,917 | 0,721 | 0,659 | 0,736 | 0,599 |

Criterio (T-AB-03): el umbral de mayor F2 de PER y ORG entre los que dejan la precisión global en 0,70 o más. Se elige **0,30**. Los umbrales 0,20 y 0,25 (fuera de la rejilla de 0,30 a 0,60) dan una F2 de 0,919 y 0,924: la F2 es plana entre 0,20 y 0,30, así que 0,30 no pierde nada relevante.

### 3.2 Banda `media` (`nerHighThreshold`)

El valor inicial de 0,90 casi no se usa: **solo 3 de los 1.236 tramos del modelo llegan a 0,90**, porque los puntajes de x-large se concentran por debajo de 0,8. Se fija en **0,37**, el valor más bajo de la rejilla en que los tramos del modelo alcanzan una precisión de 0,90.

| `nerHighThreshold` | Tramos del modelo con puntaje mayor o igual | Verdaderos | Precisión |
|---|---|---|---|
| 0,30 | 1.236 | 1.064 | 0,8608 |
| 0,36 | 1.081 | 966 | 0,8936 |
| **0,37** | 1.063 | 957 | 0,9003 |
| 0,38 | 1.053 | 952 | 0,9041 |
| 0,40 | 1.006 | 916 | 0,9105 |
| 0,90 | 3 | 3 | 1,0000 |

Es un valor al borde: a 0,40 la precisión es 0,911 y a 0,36 baja a 0,894.

**Confirmación sobre la reserva (`metricas/calibracion-reserva.json`, recalculada con el gold final, 10 documentos de reserva):**

- **`nerMinScore` = 0,30: confirmado** (`confirmaUmbral: true`). La reserva elige el mismo piso por la misma regla (mayor F2 de PER y ORG con precisión global ≥ 0,70): precisión global 0,829 y F2 0,911 en la reserva, frente a 0,866 y 0,928 en el desarrollo.
- **`nerHighThreshold` = 0,37: NO confirmado** (`confirmaBanda: false`; `confirmada: false` en el archivo). Con el gold final, el desarrollo ya da 0,898 de precisión en 0,37 (por debajo del 0,90 exigido a la banda; el desarrollo elegiría 0,38, con 0,902) y la reserva elegiría 0,44 (precisión 0,900); en 0,37 la reserva da 0,859. La banda separa solo `media` de `baja` y no cambia la cobertura. **Se mantiene en 0,37 por decisión del integrador (D-06): cambiarla porque la reserva elige otra cosa sería ajustar con la reserva. Queda sin confirmar y así se declara.**

### 3.3 Etiquetas

Se mantienen `person`, `organization` y `location`. Se probaron tres variantes con el mejor umbral de cada una (entre 0,15 y 0,60, con precisión global de 0,70 o más):

| Modelo | Documentos | Etiquetas | Mejor umbral | F2 PER+ORG | Precisión global | Exh. LOC |
|---|---|---|---|---|---|---|
| x-large | 6 | `person`, `organization`, `location` (en inglés) | 0,25 | 0,924 | 0,829 | 0,980 |
| x-large | 6 | traducidas al español | 0,25 | 0,932 | 0,802 | 0,980 |
| x-large | 6 | las nueve (inglesas, traducidas y mixtas) | 0,25 | 0,929 | 0,788 | 0,882 |
| x-base | 19 | `person`, `organization`, `location` (en inglés) | 0,40 | 0,902 | 0,841 | 0,962 |
| x-base | 19 | traducidas al español | 0,40 | 0,905 | 0,822 | 0,945 |
| x-base | 19 | las nueve (inglesas, traducidas y mixtas) | 0,40 | 0,900 | 0,847 | 0,918 |

Las etiquetas traducidas al español suben la exhaustividad de PER+ORG de uno a dos puntos en x-large (6 documentos) pero con menos precisión, y no se repiten en x-base (19 documentos: F2 0,902 frente a 0,905). Las nueve etiquetas bajan la exhaustividad de ubicaciones (0,980 a 0,882 en x-large) y no suben la de PER+ORG en x-base. La ventaja de las traducidas es pequeña y viene de una muestra de 6 documentos: no justifica reabrir el motor congelado y queda anotada como candidata para la medición con más documentos (P0-4).

### 3.4 Solape entre ventanas

| Solape entre ventanas | Ventanas | Menciones PER+ORG cubiertas (de 813) | Exhaustividad | F2 |
|---|---|---|---|---|
| 37 palabras (adoptado) | 132 | 767 | 0,9434 | 0,921 |
| 25 palabras | 127 | 765 | 0,9410 | 0,917 |

Con 25 palabras hay 3,8 % menos de ventanas pero se cubren 2 menciones menos de PER+ORG. **No se adopta**; el solape queda en 37 palabras.

## 4. Principal: GLiNER-X large (PF-4a)

Pasada de los 29 documentos en las tres vistas (19 de desarrollo y 10 de reserva), con `nerMinScore` 0,30 y `nerHighThreshold` 0,37. **Las cifras son del modelo solo**; el producto completo está en la sección 6.

### 4.1 Las dos filas de 10.4.1 «fuera de la lista», por vista

| Fila (n menciones, n entidades) | Vista | Cubiertas | Exhaustividad por mención | Umbral | Entidad estricta | Umbral | Estado |
|---|---|---|---|---|---|---|---|
| Personas fuera de la lista (271, 135) | natural | 263 | 0,970 | ≥ 0,85 | 0,948 | ≥ 0,75 | cumple |
| Organizaciones fuera de la lista (142, 73) | natural | 133 | 0,937 | ≥ 0,80 | 0,932 | ≥ 0,70 | cumple |
| Personas fuera de la lista (271, 135) | MAYÚSCULAS | 248 | 0,915 | ≥ 0,85 | 0,837 | ≥ 0,75 | cumple |
| Organizaciones fuera de la lista (142, 73) | MAYÚSCULAS | 96 | 0,676 | ≥ 0,80 | 0,562 | ≥ 0,70 | **no cumple** |
| Personas fuera de la lista (271, 135) | minúsculas | 245 | 0,904 | ≥ 0,85 | 0,822 | ≥ 0,75 | cumple |
| Organizaciones fuera de la lista (142, 73) | minúsculas | 87 | 0,613 | ≥ 0,80 | 0,466 | ≥ 0,70 | **no cumple** |

Lectura: el modelo solo cumple personas fuera de la lista en las tres vistas. En organizaciones cumple en la vista natural (0,937) y **queda muy por debajo de 0,80 en MAYÚSCULAS (0,676) y en minúsculas (0,613)**: la exhaustividad de organizaciones cae 26 a 32 puntos con respecto al texto natural. El sondeo previo del modelo (25 fragmentos, 96 entidades de todos los tipos) había dado 0,97 en natural, 0,91 en MAYÚSCULAS y 0,93 en minúsculas; ese sondeo era una muestra pequeña y mezclaba tipos, y no anticipaba esta caída en organizaciones.

### 4.2 Todas las menciones, por etiqueta y vista

| Etiqueta (n) | natural | MAYÚSCULAS | minúsculas | Caída en MAYÚSCULAS | Caída en minúsculas | Precisión en natural |
|---|---|---|---|---|---|---|
| PER (836) | 0,953 | 0,916 | 0,890 | −0,037 | −0,063 | 0,967 |
| ORG (386) | 0,920 | 0,728 | 0,725 | −0,192 | −0,194 | 0,702 |
| LOC (277) | 0,978 | 0,935 | 0,939 | −0,043 | −0,040 | 0,952 |

La precisión de organizaciones es la más baja (0,702 en natural): el modelo propone muchas organizaciones que no están en el gold (siglas, genéricos como «la EPS» o «el Juzgado», despachos). La revisión del abogado absorbe esas propuestas, pero cuentan para la fatiga (sección 8).

### 4.3 Desarrollo y reserva (modelo solo)

| Fila | Vista | Desarrollo (n) | Reserva (n) | Diferencia (reserva − desarrollo) |
|---|---|---|---|---|
| Personas fuera de la lista | natural | 0,972 (176) | 0,968 (95) | −0,003 |
| Personas fuera de la lista | MAYÚSCULAS | 0,898 (176) | 0,947 (95) | +0,050 |
| Personas fuera de la lista | minúsculas | 0,898 (176) | 0,916 (95) | +0,018 |
| Organizaciones fuera de la lista | natural | 0,919 (99) | 0,977 (43) | +0,058 |
| Organizaciones fuera de la lista | MAYÚSCULAS | 0,636 (99) | 0,767 (43) | +0,131 |
| Organizaciones fuera de la lista | minúsculas | 0,606 (99) | 0,628 (43) | +0,022 |

Ninguna de estas filas del modelo solo tiene la reserva más de 0,03 por debajo del desarrollo.

## 5. Respaldo: GLiNER-X base (PF-4b) y comparación con el principal (T-AB-04)

El respaldo es un camino **en ejecución** para equipos con poca memoria (menos de 8 GB que informa el navegador), sin cuota o con la descarga del principal fallida (10.4.2). **No es vía de cierre**: para cerrar, el principal tiene que cumplir todas las filas. Esta sección es informativa. Mismas condiciones que la sección 4: mismo código del motor, mismo tokenizador, las mismas ventanas por vista que x-large y los mismos umbrales.

### 5.1 Las dos filas «fuera de la lista», por vista (modelo solo)

| Fila (n menciones, n entidades) | Vista | Cubiertas | Exhaustividad por mención | Umbral | Entidad estricta | Umbral | Estado |
|---|---|---|---|---|---|---|---|
| Personas fuera de la lista (271, 135) | natural | 265 | 0,978 | ≥ 0,85 | 0,956 | ≥ 0,75 | cumple |
| Organizaciones fuera de la lista (142, 73) | natural | 133 | 0,937 | ≥ 0,80 | 0,890 | ≥ 0,70 | cumple |
| Personas fuera de la lista (271, 135) | MAYÚSCULAS | 239 | 0,882 | ≥ 0,85 | 0,807 | ≥ 0,75 | cumple |
| Organizaciones fuera de la lista (142, 73) | MAYÚSCULAS | 91 | 0,641 | ≥ 0,80 | 0,521 | ≥ 0,70 | **no cumple** |
| Personas fuera de la lista (271, 135) | minúsculas | 195 | 0,720 | ≥ 0,85 | 0,533 | ≥ 0,75 | **no cumple** |
| Organizaciones fuera de la lista (142, 73) | minúsculas | 74 | 0,521 | ≥ 0,80 | 0,356 | ≥ 0,70 | **no cumple** |

### 5.2 Todas las menciones, por etiqueta y vista (modelo solo)

| Etiqueta (n) | natural | MAYÚSCULAS | minúsculas | Caída en MAYÚSCULAS | Caída en minúsculas | Precisión en natural |
|---|---|---|---|---|---|---|
| PER (836) | 0,971 | 0,874 | 0,805 | −0,097 | −0,166 | 0,871 |
| ORG (386) | 0,889 | 0,671 | 0,637 | −0,218 | −0,251 | 0,582 |
| LOC (277) | 0,971 | 0,838 | 0,935 | −0,134 | −0,036 | 0,953 |

### 5.3 Diferencia frente al principal (modelo solo)

Todas las menciones:

| Vista | Etiqueta | n | x-large | x-base | Diferencia (x-base − x-large) |
|---|---|---|---|---|---|
| natural | PER | 836 | 0,953 | 0,971 | +0,018 |
| natural | ORG | 386 | 0,920 | 0,889 | −0,031 |
| natural | LOC | 277 | 0,978 | 0,971 | −0,007 |
| MAYÚSCULAS | PER | 836 | 0,916 | 0,874 | −0,042 |
| MAYÚSCULAS | ORG | 386 | 0,728 | 0,671 | −0,057 |
| MAYÚSCULAS | LOC | 277 | 0,935 | 0,838 | −0,097 |
| minúsculas | PER | 836 | 0,890 | 0,805 | −0,085 |
| minúsculas | ORG | 386 | 0,725 | 0,637 | −0,088 |
| minúsculas | LOC | 277 | 0,939 | 0,935 | −0,004 |

Las dos filas de 10.4.1 «fuera de la lista»:

| Vista | Fila | n | x-large | x-base | Diferencia | Umbral de 10.4.1 |
|---|---|---|---|---|---|---|
| natural | Personas fuera de la lista | 271 | 0,970 | 0,978 | +0,007 | 0,85 |
| natural | Organizaciones fuera de la lista | 142 | 0,937 | 0,937 | +0,000 | 0,80 |
| MAYÚSCULAS | Personas fuera de la lista | 271 | 0,915 | 0,882 | −0,033 | 0,85 |
| MAYÚSCULAS | Organizaciones fuera de la lista | 142 | 0,676 | 0,641 | −0,035 | 0,80 |
| minúsculas | Personas fuera de la lista | 271 | 0,904 | 0,720 | −0,185 | 0,85 |
| minúsculas | Organizaciones fuera de la lista | 142 | 0,613 | 0,521 | −0,092 | 0,80 |

Caída frente a la vista natural, por modelo:

| Modelo | Etiqueta | natural | MAYÚSCULAS | minúsculas | Caída en MAYÚSCULAS | Caída en minúsculas |
|---|---|---|---|---|---|---|
| x-large | PER | 0,953 | 0,916 | 0,890 | −0,037 | −0,063 |
| x-large | ORG | 0,920 | 0,728 | 0,725 | −0,192 | −0,194 |
| x-large | LOC | 0,978 | 0,935 | 0,939 | −0,043 | −0,040 |
| x-base | PER | 0,971 | 0,874 | 0,805 | −0,097 | −0,166 |
| x-base | ORG | 0,889 | 0,671 | 0,637 | −0,218 | −0,251 |
| x-base | LOC | 0,971 | 0,838 | 0,935 | −0,134 | −0,036 |

Lectura:

- En la **vista natural**, x-base iguala a x-large en personas (+0,018) y ubicaciones (−0,007) y queda tres puntos por debajo en organizaciones (−0,031).
- En **MAYÚSCULAS**, x-base pierde de 4 a 10 puntos (personas −0,042, organizaciones −0,057, ubicaciones −0,097).
- En **minúsculas**, pierde de 8 a 9 puntos en personas (−0,085) y organizaciones (−0,088) y casi nada en ubicaciones (−0,004). En personas fuera de la lista la diferencia es de −0,185 (0,720 frente a 0,904).
- x-base pierde más que x-large al pasar de texto natural a MAYÚSCULAS o a minúsculas (por ejemplo, personas −0,097 y −0,166 frente a −0,037 y −0,063). Esto sustenta el aviso al usuario de que **el respaldo es más débil con texto en MAYÚSCULAS o en minúsculas**, justo el de muchos oficios escaneados, y la indicación de leer todo con más cuidado cuando se usa.
- La precisión de x-base es menor que la de x-large (organizaciones en natural: 0,582 frente a 0,702): propone más de lo que debe.

### 5.4 Desarrollo y reserva (modelo solo)

| Fila | Vista | Desarrollo (n) | Reserva (n) | Diferencia (reserva − desarrollo) |
|---|---|---|---|---|
| Personas fuera de la lista | natural | 0,977 (176) | 0,979 (95) | +0,002 |
| Personas fuera de la lista | MAYÚSCULAS | 0,886 (176) | 0,874 (95) | −0,013 |
| Personas fuera de la lista | minúsculas | 0,727 (176) | 0,705 (95) | −0,022 |
| Organizaciones fuera de la lista | natural | 0,949 (99) | 0,907 (43) | −0,043 (posible sobreajuste) |
| Organizaciones fuera de la lista | MAYÚSCULAS | 0,657 (99) | 0,605 (43) | −0,052 (posible sobreajuste) |
| Organizaciones fuera de la lista | minúsculas | 0,505 (99) | 0,558 (43) | +0,053 |

Con n de 43 a 99 menciones en organizaciones, las dos marcas de posible sobreajuste son cifras flojas: se informan, no se interpretan.

## 6. Producto completo (reglas, lista del caso y modelo)

**Veredicto de 10.4.1: CIERRA.** Todas las filas de cierre cumplen sobre los 29 documentos con GLiNER-X large, en las tres vistas, con 8 hilos; 0 brechas de cierre abiertas.

Fuentes: los diez informes de la medición final (commit `784479e`), `corpus/resultados/20261101-1956-sin-modelo-natural-8h.json`, `20261101-1956-x-large-natural-8h.json`, `20261101-1957-x-large-mayusculas-8h.json`, `20261101-1957-x-large-minusculas-8h.json` (corpus completo) y los seis de `20261101-1958` y `20261101-1959` (desarrollo y reserva por vista); el registro `corpus/brechas.json`; y los registros de la corrida (`medir-cierre1.log` y `veredicto-cierre1.log`, que se guardan fuera del repositorio). Las filas de la sección 2 llevan el valor medido de cada una. Cada corrida fue sobre el producto completo con el motor corregido (fusión de PB-2-r3 y las tandas posteriores), no sobre la versión intermedia que PF-4a y PF-4b midieron y cuyas cifras no se reproducen.

### 6.1 Lo que aporta cada capa

- **Reglas y lista sin modelo** (vista natural, 29 documentos): mención global 0,766 (2.320 de 3.027); personas fuera de la lista 0,048 y organizaciones fuera de la lista 0,007. Sin el modelo no se cumple, y esa corrida no cuenta como cierre (10.4.2).
- **Con GLiNER-X large** (vista natural): mención global 0,932 (2.822 de 3.027); personas fuera de la lista 0,985 y organizaciones fuera de la lista 1,000. En MAYÚSCULAS y minúsculas, 0,915 y 0,838. Las filas de organizaciones en esas dos vistas, que con el modelo solo no se cumplían (0,676 y 0,613), cumplen con el producto completo (0,838): las reglas, la lista y la restauración de mayúsculas antes del modelo (PF-3-r1, D-06) aportan lo que el modelo pierde.

### 6.2 La reserva, aparte (exhaustividad por mención, x-large; desarrollo contra reserva)

| Fila | Vista | Desarrollo (n) | Reserva (n) | Reserva − desarrollo |
|---|---|---|---|---|
| `CC` | natural | 1,000 (70) | 1,000 (35) | 0,000 |
| `TELEFONO` | natural | 1,000 (93) | 0,955 (44) | −0,045 (posible sobreajuste; brecha informativa abierta) |
| `RADICADO`, `NIT`, `CORREO`, rotulados, fechas, valores, organizaciones fuera de la lista | natural | 1,000 | 1,000 | 0,000 |
| Lista | natural | 0,998 (537) | 0,996 (271) | −0,002 |
| Personas fuera de la lista | natural | 0,989 (177) | 0,979 (95) | −0,010 |
| Direcciones | natural | 1,000 (155) | 0,986 (72) | −0,014 |
| Personas fuera de la lista | MAYÚSCULAS y minúsculas | 0,910 (177) | 0,926 (95) | +0,017 |
| Organizaciones fuera de la lista | MAYÚSCULAS y minúsculas | 0,818 (99) | 0,884 (43) | +0,066 |

Ninguna fila de reserva queda más de 0,03 por debajo del desarrollo salvo `TELEFONO` (−0,045, n 44). **La reserva no es ciega** (D-10): desde la tanda 3 los ajustes pudieron mirar sus menciones fallidas, así que estas cifras no prueban cómo se comporta el sistema con escritos nuevos.

### 6.3 Lo que este cierre no dice

- **La reserva no es una prueba ciega** (D-10, 1.1). Sirvió para ajustar reglas generales.
- **La banda de 0,37 no está confirmada** (sección 3.2): se mantiene por decisión del integrador (D-06).
- **El corpus es sintético** (sección 8): el cierre se mide sobre escritos ficticios hechos para medir; no predice por sí solo el comportamiento con escritos reales.
- **Los residuos se cuentan por dato** (D-14, M-60): lo que el motor conoce, o lo que la lista genera (iniciales, siglas, alias), no puede quedar en la salida, y nunca cuenta como «protegido» ni como «omisión». Con la lectura literal anterior la medición daba 109 residuos en el corte de D-14; con la definición por dato da 0. La definición **queda señalada para el dueño, que puede revertirla.** En esta medición, las omisiones que la lectura literal habría contado como residuo son 4 (natural), 5 (MAYÚSCULAS) y 5 (minúsculas).
- **Datos de entrada y gold cambiados por decisión del dueño** (S-10.4): D-16 agregó alias a la lista del caso de los documentos de prueba («Fercho», AGEX, CESA, FESA, COPSA, TEFI, DIPRU y SEPRU, cada uno de su persona u organización de la lista) y dejó el gold sin tocar; D-17 añadió los nombres completos de C18 y C21 como alias y cambió en el gold a «Doña Gloria» (C24-A007) a otra persona fuera de la lista. Cada cambio queda en `revision.cambios`. Por D-16, una variante compartida por dos o más personas de la lista queda pendiente y ambigua, con decisión obligatoria del revisor que bloquea la exportación; el oráculo de la medición la resuelve como un revisor que lee el contexto, lo que no mide el comportamiento de una persona real.
- **Riesgo declarado (D-12, AJ-4):** la precisión de las reglas R-CAR-03 (cargo junto a un nombre o en una celda) y R-DIAG-02 (término tras un giro de diagnóstico) **no está medida más allá del corpus sintético**. Son banderas que decide el revisor, no reemplazos, y no movieron ninguna detección ni negativo en la medición; su tasa de falsas alarmas en escritos reales se desconoce.
- **Precisión de organizaciones:** la fila de organizaciones fuera de la lista cumple en exhaustividad, pero el producto propone muchas organizaciones de más: precisión 0,573 en la vista natural (112 falsas de 262) y 0,516 en MAYÚSCULAS y minúsculas. Es la fatiga de la revisión; la precisión global cumple (0,946 y 0,936).
- **Duda de gold abierta para el dueño (S-10.4):** C29-A008, «jueza titular del despacho». S-7.8 excluía a los jueces; D-16 hizo que llevaran bandera de cargo. El gold la anota como `CARGO` y se midió sin cambiarlo.

## 7. Tiempos y memoria

**La meta de rendimiento cambió por decisión del dueño (D-20, 2 de noviembre de 2026).**

- **Meta anterior (plan A.11, T-ME-04):** reglas y lista en 1 s o menos por página (mediana); GLiNER-X large en 2 minutos o menos por 10 páginas con 8 hilos o más, y en 4 minutos o menos con 4 a 7 hilos. **Con esa meta, la medición de P0-5 no cumplía con 8 hilos** (158 y 160 s frente a 120 s; con 12 y 16 hilos, 150 y 136 s en la primera medición, también por encima). El integrador lo registró en D-20 y el dueño decidió.
- **Meta vigente (D-20, aprobada por el dueño el 2 de noviembre de 2026):** «reglas y lista en 1 s o menos por página; el modelo GLiNER-X large en 15 s o menos por página con 12 hilos o más, y en 20 s o menos con 4 a 11 hilos, con resultados progresivos y tiempo estimado visibles. Acelerar con la tarjeta gráfica queda para la v1.1.» La aplicación usa ahora todos los hilos lógicos del equipo, entre 4 y 16 (antes eran siempre 4); eso no cambia lo que se detecta.
- **Fórmula por página:** tiempo por página = tiempo total del escrito de prueba ÷ 10 páginas. El escrito de prueba son 5.000 palabras de corpus (≈ 10 páginas), que equivalen a 26 ventanas de 512 tokens; la meta vigente es entonces 150 s por 10 páginas con 12 hilos o más y 200 s con 4 a 11 hilos (`META_MS` en `tests/medicion/rendimiento.test.ts`).

La medición final (P0-5) se hizo con ventana visible, equipo conectado a la corriente, ninguna otra pasada del modelo en curso y los agentes del proyecto parados. Equipo de referencia: AMD Ryzen 7 5700U, 16 hilos lógicos, 15 GB; Chromium 156; modelo principal.

### 7.1 Medición final de rendimiento (P0-5, T-ME-04)

| Hilos | Archivo (`metricas/`) | Total de las 26 ventanas | Por página | Meta vigente | Resultado | Mediana por ventana | p90 | Carga de la sesión | WebAssembly | Pico del navegador | Condición |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | `latencia-x-large-chromium-p05.json` | 186 s (186.480 ms) | 18,6 s | ≤ 20 s | **Cumple** | 7,2 s | 7,7 s | 20,9 s | 1.474 MB | 2.649 MB | Con carga ajena del equipo |
| 8 | `latencia-x-large-chromium-p05.json` | 158 s (157.860 ms) | 15,8 s | ≤ 20 s | **Cumple** | 6,1 s | 6,6 s | 20,9 s | 1.475 MB | 2.555 MB | Con carga ajena del equipo |
| 8 | `latencia-x-large-chromium-p05b.json` | 160 s (159.912 ms) | 16,0 s | ≤ 20 s | **Cumple** | 6,3 s | 6,5 s | 19,6 s | 1.475 MB | 2.561 MB | Con carga ajena del equipo |
| 12 | `latencia-x-large-chromium-p05c.json` | 115 s (115.093 ms) | 11,5 s | ≤ 15 s | **Cumple** | 4,3 s | 5,6 s | 29,8 s | 1.475 MB | 2.427 MB | Equipo en reposo |
| 16 | `latencia-x-large-chromium-p05c.json` | 113 s (112.688 ms) | 11,3 s | ≤ 15 s | **Cumple** | 4,4 s | 4,7 s | 14,7 s | 1.476 MB | 2.673 MB | Equipo en reposo |

- **La medición con el equipo en reposo da 113 s con 16 hilos** (115 s con 12). Las corridas de 12 y 16 hilos que cita D-20 (150 y 136 s) se hicieron con el equipo ocupado y se remidieron en reposo: el archivo `latencia-x-large-chromium-p05c.json` es la versión remedida y la que vale. Las de 4 y 8 hilos se hicieron con carga ajena del equipo y **no se remidieron en reposo**; cumplen la meta aun así.
- El campo `nucleosAjenos` de los archivos (de 2,3 a 11,9) cuenta como ajeno al propio navegador de la prueba (D-20): es un defecto de la métrica, no carga real, y por eso la prueba no lo usa para elegir la corrida.
- La carga de la sesión (de 14,7 a 29,8 s) es la del servidor local de pruebas, con verificación SHA-256 y prueba de humo; no incluye la descarga por Internet.
- **Memoria pico definitiva con el principal:** de 2.427 a 2.673 MB del navegador completo en estas cinco corridas, y hasta 2.702 MB en las corridas previas de 7.2; WebAssembly de 1.474 a 1.476 MB. Es coherente con «unos 2,7 GB» de la guía del abogado.
- **Proyección para expedientes (cálculo, no medición):** con 60 a 70 páginas, a 11,3 s por página (16 hilos) salen unos 11 a 13 minutos, y a 18,6 s por página (4 hilos), unos 19 a 22 minutos. Los resultados de reglas y lista salen primero y los del modelo, de forma progresiva (D-20).
- **Reglas y lista (meta vigente: ≤ 1 s por página):** medidas en Node, no en el navegador, sobre los 29 documentos (68,65 páginas), sin modelo: mediana de 35 ms por página, p90 de 63 ms, máximo por documento de 510 ms por página (`tiempos[].reglasMs` de `corpus/resultados/20261101-1956-sin-modelo-natural-8h.json`). Cumple con margen en esa medición; **la medición en el navegador, con el motor completo en un trabajador, no se hizo por separado en v1.0.0** (7.4).
- La prueba `tests/medicion/rendimiento.test.ts` exige la meta vigente sobre estas corridas (4, 8 y 16 hilos como mínimo).

### 7.2 Corridas previas: latencia por ventana y memoria (PF-3, máquina ocupada)

Conservadas como historia: se hicieron antes de P0-5, con la máquina ocupada y bajo la meta anterior. No son la cifra de v1.0.0; la de v1.0.0 es la 7.1.

Un escrito real de 5.000 palabras de corpus (≈ 10 páginas) equivale a **26 ventanas** de 512 tokens (no 24: x-large tokeniza unas 192 palabras útiles por ventana en estos textos jurídicos). La «mediana por ventana» y el «p90» son de las ventanas medidas tras una de calentamiento; el «tiempo total medido» es el de las 26 ventanas. Con 1 hilo se midieron solo 6 ventanas. «Núcleos ajenos» es la cantidad de núcleos que usaban otros procesos durante la corrida. «Pico del navegador» es la suma del pico de la familia de procesos del navegador; «WebAssembly» es la memoria de WebAssembly del modelo.

| Modelo | Hilos | Corrida | Ventanas | Carga de la sesión | Mediana por ventana | p90 | Tiempo total medido | Núcleos ajenos | WebAssembly | Pico del navegador |
|---|---|---|---|---|---|---|---|---|---|---|
| x-large | 8 | A (muy contendida) | 26 | 41,0 s | 11,7 s | 17,0 s | 367 s (6,1 min) | sin medir | 1.475 MB | 2.676 MB |
| x-large | 8 | B (menos contendida) | 26 | 22,4 s | 7,8 s | 9,9 s | 207 s (3,4 min) | 5,2 | 1.475 MB | 2.702 MB |
| x-large | 4 | A (muy contendida) | 26 | 40,3 s | 13,7 s | 15,5 s | 324 s (5,4 min) | sin medir | 1.474 MB | 2.616 MB |
| x-large | 4 | B (menos contendida) | 26 | 34,8 s | 10,4 s | 11,7 s | 260 s (4,3 min) | 8,7 | 1.474 MB | 2.691 MB |
| x-large | 1 | A (muy contendida) | 6 | 68,4 s | 31,2 s | 39,9 s | 177 s (6 ventanas) | sin medir | 1.473 MB | 2.641 MB |
| x-base | 8 | A | 26 | 13,0 s | 3,1 s | 5,0 s | 89 s (1,5 min) | sin medir | 813 MB | 1.663 MB |
| x-base | 4 | A | 26 | 10,3 s | 2,8 s | 4,4 s | 82 s (1,4 min) | sin medir | 812 MB | 1.804 MB |
| x-base | 1 | A | 6 | 26,6 s | 10,4 s | 16,1 s | 67 s (6 ventanas) | sin medir | 811 MB | 1.807 MB |

Durante estas corridas había otros procesos usando de 5 a 9 núcleos (pasadas de pruebas de otros trabajos, grabación de pantalla): **las latencias son de una máquina contendida**, no de la medición en silencio. Lectura:

- **Estas corridas no confirmaron ni refutaron la meta anterior:** con 8 hilos, la mejor (7,8 s por ventana, 207 s = 3,4 min) quedó por encima de los 2 minutos de entonces, y con 4 hilos la mejor (10,4 s por ventana, 260 s = 4,3 min) quedó 20 s por encima de los 4 minutos. Las dos fueron contendidas (5,2 y 8,7 núcleos ajenos). La medición que vale es la 7.1, con otra máquina libre y otra meta (D-20).
- El **respaldo x-base** es unas tres veces más rápido: 3,1 s por ventana con 8 hilos y 2,8 s con 4 (89 y 82 s las 26 ventanas), con la mitad de la memoria de WebAssembly.
- **Memoria:** el pico del navegador completo con el principal está entre 2.616 y 2.702 MB (WebAssembly ≈ 1.474 MB); con el respaldo, entre 1.663 y 1.807 MB (WebAssembly ≈ 812 MB). La memoria de JavaScript no se pudo medir por separado (`performance.memory` no existe en workers). La cifra definitiva del principal es la de 7.1 (hasta 2.702 MB en todas las corridas).
- **Carga de la sesión del principal:** de 22 a 41 s con 8 y 4 hilos (descarga desde el servidor local de pruebas, verificación SHA-256 y prueba de humo del modelo); no incluye la descarga por Internet de la primera vez (unos 626 MB), cuyo tiempo **no se midió en v1.0.0** (7.4).
- **Solape de 25 palabras:** ahorra unos 8 s por 10 páginas y pierde exhaustividad; no se adopta (sección 3.4).

### 7.3 Edge y navegador sin JIT (T-ED-01 y T-ED-02)

| Prueba | Resultado |
|---|---|
| Edge 156 normal, 4 hilos, x-large | Carga y procesa C01 (17 ventanas, 107 s, mediana 8,2 s por ventana) y C20 (7 ventanas, 39 s, mediana 5,8 s). Carga de la sesión: 24,5 s. Pico de memoria de la familia de procesos: 2.952 MB. PBKDF2 con 600.000 iteraciones: 339, 193 y 190 ms. |
| Edge 156 con `--js-flags=--jitless`, 4 hilos | **El navegador no define `WebAssembly`**: el modelo no puede cargar. El motor responde con error (`MODELO_INTEGRIDAD`) a los 10 s y no se cuelga. PBKDF2: 481, 396 y 335 ms. |
| Chromium 156 con `--js-flags=--jitless`, 4 hilos | Igual: sin `WebAssembly`, error a los 8 s. PBKDF2: 386, 212 y 345 ms. |
| **Edge con el modo de seguridad mejorada «Estricto» activado** | **No medido en v1.0.0.** Motivo: el ajuste no se activó en la medición (es un ajuste de seguridad del navegador de quien mide y no se cambió); `--jitless` es solo una aproximación, y con ella el modelo no carga y el motor responde con error controlado. No se exige la meta de rendimiento en este modo. Queda declarado a quien use Edge con «Estricto»: la aplicación puede no cargar el modelo. |

### 7.4 No medido en v1.0.0

Lo siguiente no se midió. No es un pendiente de este informe: es lo que queda fuera de la medición de v1.0.0, con su motivo.

| Qué | Motivo |
|---|---|
| Edge con la seguridad mejorada «Estricto» activa (T-ED-01) | El ajuste es de seguridad del navegador de quien mide y no se activó; la aproximación sin JIT no carga el modelo (7.3). |
| Tiempo de descarga del modelo desde la dirección oficial (unos 626 MB) | La medición se hizo con el servidor local de pruebas, antes de publicar; la descarga por Internet depende de la conexión de cada persona. |
| Tiempos con 1 hilo para 10 páginas, y con el respaldo en P0-5 | La aplicación usa entre 4 y 16 hilos (D-20); 1 hilo no es una configuración del producto. Del respaldo solo existen las corridas de 7.2 (máquina ocupada). |
| Reglas y lista por página en el navegador | Solo se midieron en Node (7.1: mediana de 35 ms por página); no se midieron por separado dentro del navegador. |
| 4 y 8 hilos con el equipo en reposo | Se midieron con carga ajena del equipo; no se repitieron. Cumplen la meta vigente así. |
| Memoria de JavaScript por separado | `performance.memory` no existe en workers; solo hay el pico del navegador completo. |

Las cifras de la guía del abogado (`docs/guia-abogado.md`: unos 626 MB de descarga, unos 2,7 GB de pico con el modelo completo y unos 1,7 GB con la versión reducida) coinciden con las de esta sección para el modelo completo (hasta 2.702 MB); la de la versión reducida está dentro del rango de 7.2 (de 1.663 a 1.807 MB), medido en una máquina ocupada y no repetido en P0-5.

## 8. Brechas informativas y límites de validez

`corpus/brechas.json` trae 33 registros: **32 cerrados y 1 abierto**. El abierto es informativo (`POSIBLE_SOBREAJUSTE:TELEFONO`, vista natural: la reserva da 0,9545 frente a 0,97 del desarrollo, con n 44, tarea PA-3-r1; ids C15-A014 y C29-A071 entre los afectados; `cierre: false`). **No hay ninguna brecha de cierre abierta.** Los límites de validez que quedan, algunos con el modelo solo y otros del producto completo:

| # | Brecha o límite | Dato |
|---|---|---|
| 1 | Organizaciones fuera de la lista en MAYÚSCULAS y minúsculas con el principal | 0,676 y 0,613 frente a 0,80 (n = 142); por entidad estricta, 0,562 y 0,466 frente a 0,70 (n = 73). Con el producto completo cumplen (0,838 y 0,753, sección 6): el cierre depende de las reglas, la lista y la restauración de mayúsculas, no del modelo solo. |
| 2 | Respaldo en organizaciones y en minúsculas | No cumple organizaciones en MAYÚSCULAS (0,641) ni ninguna fila en minúsculas (personas 0,720, organizaciones 0,521). Informativo: el respaldo no es vía de cierre. |
| 3 | Precisión de organizaciones del modelo | 0,702 en natural con x-large y 0,582 con x-base: el modelo propone muchas organizaciones que no son datos a proteger. Alimenta la fatiga de la revisión. |
| 4 | Posible sobreajuste (reserva más de 0,03 por debajo del desarrollo, modelo solo) | Ninguna en x-large. En x-base, organizaciones fuera de la lista en natural (−0,043) y en MAYÚSCULAS (−0,052), con n de 43 en la reserva. |
| 5 | Umbral y banda calibrados con una vista y 19 documentos | `nerMinScore` 0,30 y `nerHighThreshold` 0,37 salen de la vista natural de x-large sobre 19 documentos de desarrollo; el producto usa el mismo umbral para x-base y para las tres vistas. La banda 0,37 está al borde. **La reserva confirma el piso de 0,30 pero no la banda de 0,37** (sección 3.2): queda sin confirmar. |
| 6 | Etiquetas probadas con pocos documentos | La ventaja de las etiquetas traducidas se midió con 6 documentos en x-large. |
| 7 | Corpus sintético | Las cifras son de un corpus ficticio hecho para medir; no son escritos reales y no predicen por sí solas el comportamiento sobre escritos reales. El sondeo previo del modelo (25 fragmentos, 96 entidades) fue una muestra pequeña. |
| 8 | Máquina contendida en parte de los tiempos | Las corridas previas (7.2) y las de 4 y 8 hilos de P0-5 (7.1) se tomaron con carga ajena del equipo; las de 12 y 16 hilos, con el equipo en reposo. |
| 9 | Edge con seguridad mejorada: no medido en v1.0.0 | Solo se midió la aproximación sin JIT, en la que el modelo no carga (7.3). |
| 10 | **La reserva no es ciega** | Desde la tanda 3 los ajustes miraron las menciones de la reserva que fallaban (D-10); sus cifras no son una prueba independiente (secciones 1.1 y 6.2). |
| 11 | **La banda de 0,37 no está confirmada** | La reserva elegiría 0,44; el desarrollo con el gold final, 0,38. Se mantiene en 0,37 (D-06, sección 3.2). El piso de 0,30 sí está confirmado. |
| 12 | **La meta de rendimiento cambió por decisión del dueño** | D-20, 2 de noviembre de 2026. Anterior: ≤ 2 min por 10 páginas con 8 hilos o más y ≤ 4 min con 4 a 7 (no se cumplía con 8 hilos: 158 y 160 s). Vigente: ≤ 15 s por página con 12 hilos o más y ≤ 20 s con 4 a 11, con resultados progresivos y tiempo estimado visibles; la tarjeta gráfica queda para v1.1 (sección 7). |
| 13 | **Riesgo: precisión de R-CAR-03 y R-DIAG-02** | No medida fuera del corpus sintético (D-12, AJ-4). Son banderas que decide el revisor. |
| 14 | Hechos llamativos (informativa) | 5 de 27 (0,185) frente a 0,60 (D-12). No bloquea el cierre. |
| 15 | Residuos contados por dato | Definición del integrador (D-14, M-60) señalada para el dueño, que puede revertirla (sección 6.3). |
| 16 | Consistencia en las vistas forzadas | La lista da 91 de 92 en MAYÚSCULAS y minúsculas (el veredicto evalúa la consistencia sobre la vista natural, donde da 92 de 92). |
| 17 | Posible sobreajuste de `TELEFONO` en la reserva | 0,955 frente a 1,000 del desarrollo (n 44); brecha informativa abierta (PA-3-r1). |
| 18 | Precisión de organizaciones en el producto | 0,573 en la vista natural y 0,516 en MAYÚSCULAS y minúsculas: la revisión verá muchas organizaciones de más (sección 6.3). |

## 9. Cómo recalcular estas cifras

Todo se ejecuta en local, sin red. Las órdenes que usan el modelo toman el candado del modelo (una sola pasada a la vez) y necesitan el modelo descargado y verificado.

```bash
# Calibración (PF-3): barre el umbral y fija la banda con la caché y el gold, sin correr el modelo
node scripts/calibrar-modelo.ts calibrar

# Evaluación por vista (PF-4a para el principal, PF-4b para el respaldo)
node scripts/evaluar-modelo.ts pasada   --modelo=x-large   # pasa el modelo por las tres vistas
node scripts/evaluar-modelo.ts verificar --modelo=x-large   # T-AB-06: la caché reproduce una pasada nueva
node scripts/evaluar-modelo.ts evaluar  --modelo=x-large   # T-AB-01: filas por vista
node scripts/evaluar-modelo.ts evaluar  --modelo=x-base    # T-AB-01 de x-base y T-AB-04 (comparación)

# Medición completa del producto y veredicto (P0-4)
npm run medir
npm run veredicto

# Pruebas que recalculan las cifras de este informe desde los archivos de metricas/
node node_modules/vitest/vitest.mjs run --config tests/medicion/vitest.config.ts
```

Archivos de `metricas/`: `calibracion-umbral.json` (sección 3), `modelo-x-large-vistas.json` y `modelo-x-base-vistas.json` (secciones 4 y 5; el segundo trae también la comparación), `etiquetas-*.json` (3.3), `solape-25-x-large-natural.json` (3.4), `latencia-*.json`, `edge-*.json` y `chromium-x-large-jitless.json` (sección 7), `calibracion-reserva.json` (confirmación del umbral y la banda en la reserva, P0-4) e `historico/pf3-x-large-natural.json` (caché natural de PF-3, 19 documentos con el texto anterior a PG-1a-r1 y PG-2-r1; histórica desde P0-4: la medición lee solo `modelo-x-large-vistas.json`).

## 10. Lo que no se midió en v1.0.0

Este informe no tiene huecos por llenar. Lo que no se midió queda dicho aquí, con su motivo; el detalle está en 7.4.

| # | No medido en v1.0.0 | Motivo |
|---|---|---|
| 1 | Edge con la seguridad mejorada «Estricto» activa (T-ED-01) | El ajuste es del navegador de quien mide y no se activó; la aproximación sin JIT no carga el modelo. |
| 2 | Tiempo de descarga del modelo en la dirección oficial | Se midió con el servidor local de pruebas, antes de publicar. |
| 3 | Reglas y lista por página dentro del navegador | Solo se midieron en Node (mediana de 35 ms por página). |
| 4 | Tiempos con 1 hilo y con el respaldo en la medición final | 1 hilo no es una configuración del producto (D-20); del respaldo solo hay las corridas de 7.2. |
| 5 | 4 y 8 hilos con el equipo en reposo | Se midieron con carga ajena; no se repitieron. |
| 6 | Precisión de R-CAR-03 y R-DIAG-02 con escritos reales | El corpus es sintético (D-12). |
