# RG-r1 · Adjudicación de dos dudas del gold congelado (R4 de 10.2.4)

Origen: decisión 4 de D-06. Revisor R, sin ver las salidas del motor (ni `corpus/resultados/`, ni `metricas/`, ni `corpus/brechas.json`, ni el veredicto):
se decidió con el texto del plan (6.x, 7.x, 10.1, 10.2, 10.3.2, 10.4.1) y con el texto canónico de los documentos (`Cnn.texto.json`).
Los cambios los aplica `herramientas/rg-r1-adjudicar.mjs` (idempotente; `--comprobar` sale 1 si queda alguno pendiente), cada uno queda en
`revision.cambios` de su documento y las sumas del gold en `corpus/MANIFIESTO.json`. No se regeneró ningún documento ni texto esperado, y ningún tramo cambió.

## Duda 2 · Municipio dentro de un despacho («Juzgado … de X»)

**Decisión: solo la sugerencia del despacho. Error demostrado; se corrige.**

| Cita | Texto del plan |
|---|---|
| 6.2.1, fila `MUNICIPIO` | «generalize.ts crea una sugerencia `MUNICIPIO_A_DEPARTAMENTO` (**o** `DESPACHO_A_GENERICO` si está en el nombre de un despacho o autoridad)» |
| 7.7.3, R-MUN-05 | «El nombre de un despacho ya no es un contexto de esta regla: lo trata R-DESP-01.» |
| 7.7.3, R-DESP-01 | o1, «el nombre con el municipio generalizado (`… de un municipio de {m}`)»; 7.8.2 G-04: «Como G-01 en o1» |
| 10.2.2, fila Despacho o autoridad | «el municipio dentro va con `contenidaEn`. No entra en la exhaustividad de protección: se mide como sugerencia esperada» |
| 10.4.1, fila Municipios, despachos y autoridades | «con la sugerencia `MUNICIPIO_A_DEPARTAMENTO` **o** `DESPACHO_A_GENERICO` presente» |

Ningún patrón R-MUN-01 a R-MUN-05 toma el municipio del nombre de un despacho, y 6.2.1 da una sola sugerencia por municipio. El gold esperaba
`MUNICIPIO_A_DEPARTAMENTO` en los 81 municipios con `contenidaEn` a un despacho (80 «Juzgado …», 1 «Notaría …»): pedía una sugerencia que el plan no crea.
**Cambio:** `generalizacion` `MUNICIPIO_A_DEPARTAMENTO` → `DESPACHO_A_GENERICO` en esas 81 anotaciones `MUNICIPIO`. Se conservan tipo, tramo, entidad
(`DEP:<código>`, la de o1), `debe_generalizarse: true` y `contenidaEn`. Con eso salen de `G⁺` (10.3.2) y se miden por la sugerencia del despacho, como dice 10.2.2.
Ningún municipio libre está dentro de un nombre de despacho sin anotar (comprobado con las cabezas de R-DESP-01).
T-GO-01 exigía `MUNICIPIO_A_DEPARTAMENTO` en todo `MUNICIPIO` (regla de la prueba, no de 10.2.3): ahora exige `DESPACHO_A_GENERICO` dentro de un despacho
y `MUNICIPIO_A_DEPARTAMENTO` fuera.

## Duda 1 · Edades («N años de edad», «con N años»)

**Decisión: el plan las trata como sugerencia `EDAD_A_RANGO` y, si la persona es menor de edad, también como bandera `MENOR`; nunca como `FECHA`.**

| Cita | Texto del plan |
|---|---|
| 7.5.6, R-EDAD-01 | «No es un `DataType`: `generalize.ts` la usa para crear la sugerencia `EDAD_A_RANGO` (objetivo: tramo) y, si la edad es menor de 18 años, una bandera `MENOR` con motivo `EXPRESION_MENOR`.» |
| 7.8.2, G-06 | «Sin marcador. Edad < 18 → bandera `MENOR`.» |
| 7.7.6, fila `MENOR` | «R-MEN-01; R-EDAD-01 con edad < 18 · `EXPRESION_MENOR` · la expresión» |
| 10.1.3, F50 | «Menores: … expresiones («la menor», «hijo de 7 años»)» |
| 10.4.1, fila Banderas de datos indirectos | «`CARGO`, `DIAGNOSTICO`, `MENOR`, fecha de nacimiento y edad · ≥ 0,90 de banderas o sugerencias presentes» |
| 10.2.1 · 10.3.2 | `tipo: DataType; // positivos: el correcto` · `G⁺` = positivas con `tipo` fuera de `FLAG_TYPES` y sin `DESPACHO_A_GENERICO` |

Con `tipo: 'FECHA'`, las 32 edades entran en `G⁺` y en la fila «Fechas y valores», y piden una detección `[FECHA_n]` que el plan dice que no existe.
El error está demostrado en las 32, pero el formato solo permite corregirlo donde el plan da el tipo correcto:

- **14 edades de menores (edad < 18): se corrigen.** `tipo` `FECHA` → `MENOR` (`FlagType`: la bandera de 7.7.6 sobre la misma expresión), se agrega F50,
  y se conservan `generalizacion: 'EDAD_A_RANGO'` y `debe_generalizarse: true`. Sus 11 entidades pasan de `FECHA` a `MENOR` (canónico `FECHA:~…` → `MENOR:edad:…`).
  Sin `bandera_esperada`: 10.2.3 la prohíbe en una anotación no negativa.
- **18 edades de adultos (37, 44, 61, 78 y 81 años): no se cambian; queda la duda para el integrador.** Ningún `DataType` de 6.2 representa una edad
  (R-EDAD-01) y ninguna `FlagType` aplica a un adulto; ponerles otro tipo sería inventarlo. La corrección que el plan sí admite está en la medición, no en el gold:
  que 10.3.2 excluya de `G⁺` las anotaciones con `generalizacion: 'EDAD_A_RANGO'`, como ya excluye `DESPACHO_A_GENERICO`, y que sus entidades salgan de las filas
  por entidad y de consistencia de `FECHA`. Así se medirían solo como sugerencia, que es lo que piden 7.5.6, G-06 y 10.4.1.

## Conteo de anotaciones cambiadas

| Tipo | Campo | Antes → después | Anotaciones | Documentos |
|---|---|---|---|---|
| `MUNICIPIO` | `generalizacion` | `MUNICIPIO_A_DEPARTAMENTO` → `DESPACHO_A_GENERICO` | 81 | 28 |
| `FECHA` → `MENOR` | `tipo` y `caracteristicas` (+F50) | edad < 18 con `EDAD_A_RANGO` | 14 (11 entidades) | 8 |

Por documento (MUNICIPIO · MENOR): C01 4 · 2, C02 4 · 3, C03 4 · 1, C05 4 · 1, C06 4 · 1, C07 4 · 3, C08 4 · 1, C09 4 · 2, C10 2, C11 1, C12 2, C13 2, C14 2, C15 1,
C16 3, C17 3, C18 4, C19 3, C20 4, C21 3, C22 2, C23 1, C24 1, C25 2, C27 3, C28 4, C29 4, C30 2. Sin cambios: C04 y C26.
Totales por tipo después del cambio: `FECHA` 338 → 324 (mínimo 150), `MENOR` 43 → 57 (mínimo 8), `MUNICIPIO` 246 (165 con `MUNICIPIO_A_DEPARTAMENTO`
y 81 con `DESPACHO_A_GENERICO`), `EDAD_A_RANGO` 32 (18 `FECHA` y 14 `MENOR`).

## Para el integrador

1. Duda 1 en adultos (18 anotaciones): decidir la nota de 10.3.2 propuesta arriba o dejarlas como están.
2. 10.4.3 (S-10.4): un cambio del gold después de la primera medición pide «aprobación escrita del dueño»; D-06 no la registra.
3. El generador (privado) sigue escribiendo los valores anteriores: si el corpus se regenera, hay que volver a correr `rg-r1-adjudicar.mjs` o llevar el cambio a las plantillas.
4. Fuera de las dos dudas: las 199 anotaciones positivas de bandera (`CARGO`, `DIAGNOSTICO`, `HECHO_LLAMATIVO`, `MENOR`) traen `bandera_esperada`, que 10.2.3
   prohíbe en una anotación no negativa (T-GO-01 lo tolera). No se tocaron.
5. Repetir todas las configuraciones (R4 de 10.2.4).
