# Informe de medición de Sig-Low

> **Estado: parcial.** Este informe recoge todo lo que ya se midió sobre el modelo de apoyo (calibración, evaluación del principal y del respaldo, tiempos y memoria preliminares). **El producto completo (reglas, lista del caso y modelo, con la fusión corregida) todavía no cumple las filas de cierre de 10.4.1 y se mide de nuevo en P0-4; los tiempos y la memoria definitivos se miden en P0-5.** Lo que depende de esas mediciones está marcado con un hueco explícito: **[pendiente de P0-4]** o **[pendiente de P0-5]**. Ninguna cifra de esas secciones se ha estimado ni inventado.

Las cifras salen de los archivos de `metricas/` de este repositorio, en los que está cada cifra con su n; la sección 9 explica cómo recalcularlas. Los decimales llevan coma. «10.4.1» es la tabla de umbrales de cierre del plan técnico del proyecto (documento interno); sus filas están reproducidas en la sección 2, y los identificadores `PF-3`, `PF-4a`, `PF-4b`, `P0-4`, `P0-5` y `T-AB-nn` son tareas y pruebas de ese plan.

## 0. Resumen

| Tema | Estado |
|---|---|
| Calibración del umbral y de las etiquetas del modelo (PF-3) | Medida. `nerMinScore` = 0,30; `nerHighThreshold` = 0,37; etiquetas `person`, `organization`, `location`. |
| Evaluación del principal, GLiNER-X large, por vista (PF-4a) | Medida **para el modelo solo**. Cumple las dos filas de 10.4.1 «fuera de la lista» en la vista natural y personas en las tres vistas; **no cumple organizaciones en MAYÚSCULAS (0,676) ni en minúsculas (0,613)** frente a 0,80. |
| Evaluación del respaldo, GLiNER-X base, por vista (PF-4b) y comparación (T-AB-04) | Medida **para el modelo solo**. Iguala al principal en la vista natural (organizaciones: −3 puntos) y pierde hasta 19 puntos en MAYÚSCULAS y minúsculas. Informativa: no es vía de cierre (10.4.2). |
| Producto completo contra las filas de 10.4.1 (identificadores, rotulados, lista, direcciones, fechas, banderas, negativos, precisión, fatiga, consistencia, colisiones, residuos) | **[pendiente de P0-4]** |
| Tiempos de 10 páginas con 1, 4 y 8 hilos, meta de rendimiento (T-ME-04) y Edge con seguridad mejorada | Preliminares medidos en una máquina ocupada (sección 7); definitivos **[pendiente de P0-5]** |
| Memoria pico | Preliminar medida (sección 7); definitiva **[pendiente de P0-5]** |
| Brechas informativas | Las conocidas hasta hoy, en la sección 8; el registro de cierre (`corpus/brechas.json`) es **[pendiente de P0-4]** |

## 1. Qué se mide y cómo

### 1.1 Corpus y respuestas correctas

- **29 documentos medibles** del corpus ficticio, 19 de desarrollo y 10 de reserva (el trigésimo, C04, es un PDF escaneado sin capa de texto, que la aplicación rechaza). Todos los datos son inventados con nombres como «Ficticia», «Ejemplo» y «Prueba»: **el corpus es sintético y no son escritos reales**.
- Las respuestas correctas (gold) son las adjudicadas del corpus, en `corpus/gold` (commit `797987a`). Cada mención gold tiene su tipo, su posición y, para este informe, si el dato está o no en la lista del caso (`enLista`).
- La reserva se informa aparte; si en una fila su exhaustividad queda más de 0,03 por debajo de la del desarrollo, se registra la brecha «posible sobreajuste».
- **Cada cifra de este informe lleva su n** (menciones o entidades del corpus). Con n pequeño, una diferencia de uno o dos puntos no distingue un resultado de otro.

### 1.2 Medidas

- **Exhaustividad de protección por mención:** fracción de las menciones gold positivas que quedan cubiertas por una detección aceptable: que contiene todo el tramo y no se pasa por más de 12 caracteres (o la longitud del dato, si es mayor) de texto ajeno; no importa el tipo con que se detectó, porque un dato reemplazado con otro tipo no se fuga. Es la medida de las filas de cierre de 10.4.1 («Mención»).
- **Exhaustividad por entidad estricta:** fracción de las entidades cuyas menciones quedan **todas** cubiertas («Entidad»): una sola mención fugada basta para reidentificar. También se calcula la laxa (basta una mención cubierta).
- **Precisión:** fracción de las detecciones que corresponden a una mención gold del mismo tipo. **Precisión global:** la de todos los tramos del modelo (personas, organizaciones y ubicaciones). **F2:** `5·P·R / (4·P + R)`: la exhaustividad pesa cuatro veces más que la precisión (lo que se deja sin proteger pesa más que lo que se propone de más).
- Las tres etiquetas del modelo son `PER` (personas), `ORG` (organizaciones) y `LOC` (ubicaciones). «Fuera de la lista» son las menciones que la lista del caso no conoce, y por tanto solo el modelo (y las reglas) pueden detectar.

### 1.3 Vistas

La misma lectura se hace sobre tres versiones del texto, con las mismas posiciones: **natural**, **MAYÚSCULAS** y **minúsculas**. Un encabezado, una firma o un correo pegado pueden venir enteros en mayúsculas o en minúsculas, y el modelo rinde distinto. La vista es solo de medición: la aplicación no cambia el texto del usuario.

### 1.4 «Modelo solo» y «producto completo»

- **Modelo solo:** lo que detecta el modelo, sin reglas ni lista del caso. Es la comparación honesta entre modelos y es lo único que este informe reporta hoy como medido.
- **Producto completo:** reglas, lista del caso y modelo, fusionados como en la aplicación. Las filas de cierre de 10.4.1 se evalúan sobre el producto completo. En la sección 6 se explica por qué su medición está pendiente.

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
| Identificadores con patrón fuerte o validador | `CC`, `NIT`, `RADICADO`, `TELEFONO`, `CORREO` | ≥ 0,98 por tipo | ≥ 0,96 | [pendiente de P0-4] |
| Identificadores rotulados | `TI`, `CE`, `PPT`, `PEP`, `PASAPORTE`, `TP`, `DOCUMENTO`, `RADICADO_ADMIN`, `PLACA`, `MATRICULA`, `CUENTA`, `TARJETA`, `HC`, `AFILIACION` | ≥ 0,98 del grupo; 0 omisiones con `rotulado: true` | ≥ 0,96 | [pendiente de P0-4] |
| Personas y organizaciones de la lista | Menciones con `enLista: true` | ≥ 0,98; 0 omisiones en las clases `exacta`, `sin_tildes` y `mayusculas` | ≥ 0,95 | [pendiente de P0-4] |
| Personas fuera de la lista | `PERSONA` con `enLista: false` | ≥ 0,85 | ≥ 0,75 | Modelo solo: sección 4. Producto: [pendiente de P0-4] |
| Organizaciones fuera de la lista | `EMPRESA`, `EPS`, `IPS`, `ENTIDAD`, `PROVEEDOR` con `enLista: false` | ≥ 0,80 | ≥ 0,70 | Modelo solo: sección 4. Producto: [pendiente de P0-4] |
| Personas fuera de la lista, por vista | Tres filas (natural, MAYÚSCULAS, minúsculas) | ≥ 0,85 en cada vista | ≥ 0,75 | Modelo solo: sección 4. Producto: [pendiente de P0-4] |
| Organizaciones fuera de la lista, por vista | Tres filas | ≥ 0,80 en cada vista | ≥ 0,70 | Modelo solo: sección 4. Producto: [pendiente de P0-4] |
| Direcciones | `DIRECCION`, `BARRIO` | ≥ 0,95 | ≥ 0,93 | [pendiente de P0-4] |
| Fechas y valores | `FECHA`, `VALOR` | ≥ 0,95 por tipo | ≥ 0,93 | [pendiente de P0-4] |
| Municipios, despachos y autoridades | `MUNICIPIO` y despachos | ≥ 0,95 con la sugerencia presente | — | [pendiente de P0-4] |
| Banderas de datos indirectos | `CARGO`, `DIAGNOSTICO`, `MENOR`, fecha de nacimiento y edad | ≥ 0,90 | — | [pendiente de P0-4] |
| Hechos llamativos (informativa) | `HECHO_LLAMATIVO` | ≥ 0,60 | — | [pendiente de P0-4] |
| Negativos | Normas, sentencias y códigos | ≤ 0,10 con detección | — | [pendiente de P0-4] |
| Citas con radicado | Citas jurisprudenciales | 1,00 con bandera | — | [pendiente de P0-4] |
| Precisión global | Todas las detecciones | ≥ 0,70 | — | [pendiente de P0-4] |
| Fatiga (informativa) | Falsos positivos por página | ≤ 5 de media; ningún documento con más de 10 | — | [pendiente de P0-4] |
| Consistencia | Entidades con 2 o más menciones | 1,00 en identificadores, lista, fechas y valores; ≥ 0,95 en personas y organizaciones del modelo | — | [pendiente de P0-4] |
| Colisiones (informativa) | Identificadores, lista, fechas y valores, y del modelo | 0, se informa cada una | — | [pendiente de P0-4] |
| **Residuos** | Todas las menciones positivas, tras la revisión simulada | **0 en los 29 documentos** (condición dura) | — | [pendiente de P0-4] |
| Rendimiento (T-ME-04) | (a) reglas y lista; (b) GLiNER-X large | (a) ≤ 1 s por página (mediana); (b) ≤ 2 min por 10 páginas con 8 hilos o más y ≤ 4 min con 4 a 7 hilos | — | (a) [pendiente de P0-4]; (b) preliminar en la sección 7, definitivo [pendiente de P0-5] |

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

Es un valor al borde: a 0,40 la precisión es 0,911 y a 0,36 baja a 0,894. P0-4 lo confirma sobre la reserva.

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

**[pendiente de P0-4]**

La medición del producto completo contra las filas de 10.4.1 no está cerrada. En las pasadas de evaluación del modelo (PF-4a y PF-4b) se midió una versión intermedia del producto y **no cumplía las filas de personas y organizaciones fuera de la lista por vista**. La causa identificada está en la fusión, no en el modelo: la fusión descartaba o partía tramos del modelo que se solapaban con una detección de la lista, y los despachos judiciales que el modelo marca como organización quedaban solo como sugerencia. Esa corrección la hace otra tarea (PB-2-r3) y **las cifras de aquella versión intermedia no se reproducen aquí**, porque corresponden a un motor que cambió.

Quedan pendientes de P0-4, con el motor corregido, sobre los 29 documentos y con la caché de salidas de la sección 1.6:

- Las filas de la sección 2 sobre el producto completo, por tipo y por vista, con su n y la reserva aparte.
- La precisión global, la fatiga, la consistencia y las colisiones.
- Los residuos tras la revisión simulada (condición dura: 0 en los 29 documentos), con el escáner independiente.
- La confirmación de la banda `nerHighThreshold` en la reserva.
- El registro de brechas (`corpus/brechas.json`) y el veredicto.

Importante para la lectura de la sección 4: las filas de organizaciones fuera de la lista en MAYÚSCULAS y en minúsculas **no se cumplen con el modelo solo** (0,676 y 0,613 frente a 0,80). El producto completo solo las alcanzaría si las reglas y la lista aportan organizaciones que el modelo pierde. Si P0-4 no las cumple, rige la regla de cierre del plan (10.4.3 y 12.7); el respaldo y el plan B no sustituyen al principal.

## 7. Tiempos y memoria

Meta de producción (T-ME-04): reglas y lista en 1 s o menos por página (mediana); GLiNER-X large en 2 minutos o menos por 10 páginas con 8 hilos o más, y en 4 minutos o menos con 4 a 7 hilos, en el equipo de referencia.

**[pendiente de P0-5]: la cifra definitiva.** Se mide con ventana visible, equipo conectado a la corriente, ninguna otra pasada del modelo en curso y los agentes parados. Todo lo de esta sección es **preliminar y de una máquina ocupada**.

### 7.1 Latencia por ventana y memoria (PF-3, preliminar)

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

- **La meta no se pudo confirmar ni refutar.** Ninguna corrida la cumplió: con 8 hilos, la mejor (7,8 s por ventana, 207 s = 3,4 min) queda por encima de los 2 minutos, y con 4 hilos la mejor (10,4 s por ventana, 260 s = 4,3 min) queda 20 s por encima de los 4 minutos. Pero las dos fueron contendidas (5,2 y 8,7 núcleos ajenos), así que no prueban nada sobre el modelo. Sin contención se espera una latencia cercana a los 5,0 s por ventana del sondeo previo con 8 hilos (no medida aquí); como un escrito de 10 páginas son 26 ventanas y no 24, 5,0 s darían unos 131 s (cálculo, no medición): la meta de 8 hilos quedaría **en el límite o ligeramente por encima**. Es lo que P0-5 debe medir.
- La prueba automática de la meta (`tests/medicion/rendimiento.test.ts`) se salta mientras no exista una corrida con menos de un núcleo ajeno: no finge un resultado.
- El **respaldo x-base** es unas tres veces más rápido: 3,1 s por ventana con 8 hilos y 2,8 s con 4 (89 y 82 s las 26 ventanas), con la mitad de la memoria de WebAssembly.
- **Memoria:** el pico del navegador completo con el principal está entre 2.616 y 2.702 MB (WebAssembly ≈ 1.474 MB); con el respaldo, entre 1.663 y 1.807 MB (WebAssembly ≈ 812 MB). La memoria de JavaScript no se pudo medir por separado (`performance.memory` no existe en workers). **[pendiente de P0-5]: memoria pico definitiva.**
- **Carga de la sesión del principal:** de 22 a 41 s con 8 y 4 hilos (descarga desde el servidor local de pruebas, verificación SHA-256 y prueba de humo del modelo); no incluye la descarga por Internet de la primera vez (unos 626 MB), cuyo tiempo se medirá en la dirección oficial en P0-5.
- **Solape de 25 palabras:** ahorra unos 8 s por 10 páginas y pierde exhaustividad; no se adopta (sección 3.4).

### 7.2 Edge y navegador sin JIT (T-ED-01 y T-ED-02, preliminar)

| Prueba | Resultado |
|---|---|
| Edge 156 normal, 4 hilos, x-large | Carga y procesa C01 (17 ventanas, 107 s, mediana 8,2 s por ventana) y C20 (7 ventanas, 39 s, mediana 5,8 s). Carga de la sesión: 24,5 s. Pico de memoria de la familia de procesos: 2.952 MB. PBKDF2 con 600.000 iteraciones: 339, 193 y 190 ms. |
| Edge 156 con `--js-flags=--jitless`, 4 hilos | **El navegador no define `WebAssembly`**: el modelo no puede cargar. El motor responde con error (`MODELO_INTEGRIDAD`) a los 10 s y no se cuelga. PBKDF2: 481, 396 y 335 ms. |
| Chromium 156 con `--js-flags=--jitless`, 4 hilos | Igual: sin `WebAssembly`, error a los 8 s. PBKDF2: 386, 212 y 345 ms. |
| **Edge con el modo de seguridad mejorada «Estricto» activado** | **[pendiente de P0-5]**: el ajuste no se activó en la medición (es un ajuste de seguridad del navegador de quien mide); `--jitless` es solo una aproximación. No se exige la meta de rendimiento en este modo; se registra la latencia medida. |

### 7.3 Pendientes de tiempos y memoria

- **[pendiente de P0-5]** Tiempo de 10 páginas con 4 hilos y con 8 hilos, tras una ventana de calentamiento, con los agentes parados (T-ME-04 b), y confirmación de la meta.
- **[pendiente de P0-5]** Tiempos con 1 hilo para 10 páginas (hoy solo 6 ventanas) y con el respaldo.
- **[pendiente de P0-4]** Reglas y lista en 1 s o menos por página (mediana) sobre los 29 documentos (T-ME-04 a).
- **[pendiente de P0-5]** Edge con la seguridad mejorada «Estricto» activa (T-ED-01).
- **[pendiente de P0-5]** Tiempo de descarga del modelo en la dirección oficial y memoria pico definitiva.
- Las cifras de la guía del abogado (`docs/guia-abogado.md`: unos 626 MB de descarga, unos 2,7 GB de pico con el modelo completo y unos 1,7 GB con la versión reducida) coinciden con las de esta sección; deben revisarse otra vez cuando se midan los valores definitivos.

## 8. Brechas informativas y límites de validez

Las brechas de cierre (filas incumplidas del producto completo) se registran en `corpus/brechas.json` tras P0-4: **[pendiente de P0-4]**. Lo que ya se sabe, con el modelo solo:

| # | Brecha o límite | Dato |
|---|---|---|
| 1 | Organizaciones fuera de la lista en MAYÚSCULAS y minúsculas con el principal | 0,676 y 0,613 frente a 0,80 (n = 142); por entidad estricta, 0,562 y 0,466 frente a 0,70 (n = 73). Condiciona el cierre (sección 6). |
| 2 | Respaldo en organizaciones y en minúsculas | No cumple organizaciones en MAYÚSCULAS (0,641) ni ninguna fila en minúsculas (personas 0,720, organizaciones 0,521). Informativo: el respaldo no es vía de cierre. |
| 3 | Precisión de organizaciones del modelo | 0,702 en natural con x-large y 0,582 con x-base: el modelo propone muchas organizaciones que no son datos a proteger. Alimenta la fatiga de la revisión. |
| 4 | Posible sobreajuste (reserva más de 0,03 por debajo del desarrollo, modelo solo) | Ninguna en x-large. En x-base, organizaciones fuera de la lista en natural (−0,043) y en MAYÚSCULAS (−0,052), con n de 43 en la reserva. |
| 5 | Umbral y banda calibrados con una vista y 19 documentos | `nerMinScore` 0,30 y `nerHighThreshold` 0,37 salen de la vista natural de x-large sobre 19 documentos de desarrollo; el producto usa el mismo umbral para x-base y para las tres vistas. La banda 0,37 está al borde. |
| 6 | Etiquetas probadas con pocos documentos | La ventaja de las etiquetas traducidas se midió con 6 documentos en x-large. |
| 7 | Corpus sintético | Las cifras son de un corpus ficticio hecho para medir; no son escritos reales y no predicen por sí solas el comportamiento sobre escritos reales. El sondeo previo del modelo (25 fragmentos, 96 entidades) fue una muestra pequeña. |
| 8 | Máquina contendida | Los tiempos de la sección 7 se tomaron con otros procesos usando de 5 a 9 núcleos. |
| 9 | Edge con seguridad mejorada no medido en modo real | Solo se midió la aproximación sin JIT, en la que el modelo no carga. |

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

## 10. Pendientes de este informe

| # | Pendiente | Se cierra con |
|---|---|---|
| 1 | Producto completo contra las filas de 10.4.1 (sección 6 y tabla de la sección 2) | P0-4, con la fusión corregida (PB-2-r3) |
| 2 | Registro de brechas y veredicto | P0-4 |
| 3 | Reglas y lista en 1 s por página | P0-4 |
| 4 | Tiempos de 10 páginas, meta de rendimiento, memoria pico y descarga en la dirección oficial | P0-5 |
| 5 | Edge con seguridad mejorada «Estricto» activa | P0-5 |
