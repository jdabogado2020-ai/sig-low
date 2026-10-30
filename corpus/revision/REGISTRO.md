# Registro de revisión del gold (RG · 10.2.4, pasos R1 y R2)

Revisor R, sesión distinta de la que generó el corpus. Corpus revisado: 30 documentos (20 de desarrollo y 10 de reserva), rama `t/PG-1b-corpus-reserva`.
No se leyó el generador ni las entradas de bitácora de PG-1a y PG-1b. R1 y R2 trabajaron sobre el texto canónico esperado de cada parte
(`corpus/gold/Cnn.texto.json`), porque los binarios .docx y .pdf los agrega PG-2 y todavía no están en la rama.
Fuera de alcance de este registro: R3 (adjudicación) y R4 (congelamiento), que son del integrador. El gold no se modificó: las correcciones
propuestas están en `R2/propuestas.json` y las aplica G en las plantillas (el JSON del gold no se edita a mano), al regenerar en R3.

## R1 · revisión ciega (T-GO-03)

Las 8 anotaciones se hicieron a mano desde cero (`R1/espec/Cnn.txt`, convertidas a tramos por `herramientas/r1-anotar.mjs`) y se
confirmaron en el commit `RG: anotaciones R1 a ciegas` antes de abrir el gold. Comparación con `herramientas/r1-comparar.mjs`:
coincidencia si IoU ≥ 0,5, misma parte y mismo grupo de tipo (negativos: solo IoU; despachos: solo IoU). F1 = 2·TP / (|R1| + |gold|).

Selección: ≥ 1 por tipo (tutela C07, petición C14 y C15, contrato C19 y C21, correo C23 y C26, acta C29), ≥ 2 por formato
(.txt C21, C23, C26; .docx C07, C14, C19; .pdf C15, C29), 7 de reserva.

| Doc | Tipo · formato · conjunto | Coinciden / R1 / gold | F1 (todas) | F1 (positivas medidas) | ≥ 0,95 |
|---|---|---|---|---|---|
| C07 | tutela · docx · reserva | 224 / 228 / 235 | 0,9676 | 0,9661 | sí |
| C14 | petición · docx · reserva | 94 / 94 / 97 | 0,9843 | 0,9811 | sí |
| C15 | petición · pdf · reserva | 66 / 66 / 67 | 0,9925 | 0,9912 | sí |
| C19 | contrato · docx · reserva | 106 / 107 / 108 | 0,9860 | 1,0000 | sí |
| C21 | contrato · txt · reserva | 97 / 97 / 99 | 0,9898 | 0,9882 | sí |
| C23 | correo · txt · desarrollo | 43 / 43 / 43 | 1,0000 | 1,0000 | sí |
| C26 | correo · txt · reserva | 36 / 36 / 37 | 0,9863 | 0,9859 | sí |
| C29 | acta · pdf · reserva | 116 / 116 / 116 | 1,0000 | 1,0000 | sí |

**T-GO-03: F1 mínimo por documento = 0,9676 (C07) ≥ 0,95. Cumple.** Detalle de cada tramo discrepante: `R1/comparacion.json`.

### Discrepancias de R1 (25 tramos: 5 solo del revisor, 20 solo del gold) y su naturaleza

| Naturaleza | Tramos | Resolución propuesta |
|---|---|---|
| Omisión del revisor; el gold es correcto | C07-A052, A120, A122, A183 (IPS «Fundación Hospital Ejemplo», el revisor solo anotó la forma en mayúsculas); C14-A076 (dirección de notificaciones); C19-A008 (cargo «representante legal»); C21-A025 (llave Bre-B), C21-A067 (municipio «Sogamoso» tras «municipio de»); C26-A017 («Ejemplo Martínez» en la línea `Para:`) | Ninguna: el gold está bien. |
| Límites distintos; el gold sigue 10.2.2 | C07-A061, A131, A218 («6 años de edad» entero frente a «6 años»); C07-A081 y A082 (vereda como `DIRECCION` y «Bucaramanga» aparte como `MUNICIPIO`; el revisor anotó la vía entera); C19-A017 (el gold anota «rector» y la sigla TEFI aparte como `EMPRESA`; el revisor «rector de TEFI», 4 tramos del revisor C07-R059, R079, R126, R211 y C19-R016) | Ninguna. El gold es coherente con el resto de sus cargos («directora regional», «gerente general»). |
| Convención del gold sin error demostrado | C07-A015, A215 (`MENOR` sobre el rótulo «T.I.»; 7 casos de «T.I.» y 5 de «NIP» en todo el gold, regla F50); C14-A028, A053 y C15-A043 (`AFILIACION` sobre «contrato 000000nnn») | Ninguna propuesta; ver «Observaciones para R3». |

R1 no demostró ninguna omisión ni ningún error de tipo en el gold. Observación sobre el propio R1: la omisión que sí existe (conjuntos
residenciales, abajo) la compartieron el gold y el revisor en R1; la encontró el barrido de R2.

## R2 · barrido de omisiones (T-GO-04)

`herramientas/r2-candidatos.mjs` recorre los 30 documentos con todas las anotaciones del gold (positivas, negativas, indirectas y de despacho)
y lista como candidato cualquier tramo sin solape con una anotación que cumpla alguna de estas reglas:
(a) ≥ 2 palabras con mayúscula inicial, (b) grupo de ≥ 5 dígitos, (c) `@`, (d) el dato que sigue a una palabra de rótulo de la sección 7;
y, como ampliación del revisor, (e) el token marcador de ficción (Ficticio/a, Ejemplo, Prueba), (f) dinero, (g) fechas (cifras, letras, romanos),
(h) municipios y departamentos de `data/divipola.json`, (i) apodos y tratamientos, (j) vías, edades, iniciales y «el/la menor», (k) siglas definidas entre paréntesis,
(l) cargos, diagnósticos y hechos llamativos de los catálogos de `data/` (listas del producto; no se lee el generador). Prueba de sensibilidad: se quitó en memoria
1 de cada 4 anotaciones positivas no anidadas de los 30 documentos (815 que ninguna otra anotación seguía cubriendo) y el barrido señaló 781 (95,8 %); las 34 que
no señaló son sobre todo siglas de IPS, `MENOR` sobre el rótulo «T.I.»/«NIP» y términos de diagnóstico. Una pasada aparte, con el patrón de CIE-10 y con todas las
siglas en mayúsculas sin anotar, solo halló rótulos y encabezados (PBX, NIT, CIIU, CUI, CUPS, HC, MIPRES, NUIP, UVT, DANE, EPS).

Resultado: 445 candidatos (130 textos distintos): 307 de mayúsculas, 84 de rótulo, 44 del marcador, 8 de iniciales («E. S. D.»), 2 de cargo; 0 de dígitos, `@`, dinero,
fechas, municipios, departamentos, apodos, tratamientos, vías, edades, siglas, diagnósticos, hechos llamativos y menores. Cada uno tiene decisión en `R2/decisiones.json`
(137 entradas con su motivo): **436 apariciones «no es dato» y 9 «omisión»** (8 tramos distintos). `node corpus/revision/herramientas/r2-candidatos.mjs --decisiones`
termina con código 0 y «candidatos sin decisión: 0».

**T-GO-04: 0 candidatos sin decisión. Cumple.**

### Correcciones propuestas al gold (omisiones confirmadas)

Todas son un mismo hallazgo: el nombre del conjunto residencial tras el rótulo «conjunto residencial» no está anotado. R-BAR-01 (7.7) incluye
«conjunto residencial» entre los rótulos de `BARRIO` y la característica F15 cuenta los barrios rotulados; el tramo no es complemento de una dirección
anotada, así que no lo cubre ninguna anotación. Si no se corrige, la medición cuenta como falso positivo lo que el motor detecta bien.

| Doc | Parte | start–end | Texto | Propuesta |
|---|---|---|---|---|
| C10 | cuerpo 1 | 1951–1967 | Reserva Ficticia | agregar `BARRIO`, `rotulado: true`, F15 |
| C11 | cuerpo 1 | 1137–1155 | Torres del Ejemplo | agregar `BARRIO`, `rotulado: true`, F15 |
| C12 | cuerpo 1 | 1956–1972 | Portal de Prueba | agregar `BARRIO`, `rotulado: true`, F15 |
| C13 | cuerpo 1 | 2269–2287 | Altos de la Prueba | agregar `BARRIO`, `rotulado: true`, F15 |
| C13 | cuerpo 1 | 3940–3959 | Mirador del Ejemplo | agregar `BARRIO`, `rotulado: true`, F15 |
| C14 | cuerpo 1 | 2862–2880 | Torres del Ejemplo | agregar `BARRIO`, `rotulado: true`, F15 |
| C15 | pagina_pdf 1 (p1) | 696–714 | Torres del Ejemplo | agregar `BARRIO`, `rotulado: true`, F15 (el rótulo parte «conjunto» y «residencial» en dos líneas) |
| C20 | pagina_pdf 1 (p1) | 949–967 | Torres del⏎Ejemplo | agregar `BARRIO`, `rotulado: false`, F15; aquí el rótulo es solo «conjunto», que R-BAR-01 no reconoce: es una brecha de la regla (10.4.3) más que un error del gold; R3 decide si lo anota |

Los offsets son sobre el texto canónico de la parte (`Cnn.texto.json`) y están en `R2/propuestas.json` con el resto de campos de `GoldAnnotation` que no dependen del generador.
Al agregar, cada una necesita su `GoldEntity` (`BARRIO:<nombre>`), su id `Cnn-Annn` y el aumento de `revision.cambios`; las pruebas T-CO-02 (mínimo F15 = 12) y T-GO-01 siguen cumpliéndose.

## Observaciones para R3 (no son correcciones demostradas)

1. `AFILIACION` sobre «contrato 000000nnn»: 12 anotaciones en ≥ 7 documentos (C10–C16 …), con `rotulado: true` y F19. Ninguna regla del plan reconoce «contrato» como rótulo
   de afiliación (`L.AFIL_F`, `ROT-SALUD`) ni de radicado administrativo (`L.RADA_F`, `L.RADA_D`). Es un dato real de un servicio contratado, así que conviene mantenerlo;
   decidir si se tipifica `RADICADO_ADMIN` o se deja como brecha de regla en 10.4.3.
2. `MENOR` se anota sobre el rótulo «T.I.» y «NIP», además de la anotación `TI`. Es la convención de F50; el motor deberá producir la bandera `MENOR` sobre el rótulo.
3. Los 30 gold siguen en `revision.estado: 'borrador'`; R3 los pasa a `adjudicado`.
4. No se pudieron revisar contra los binarios `esperado.advertencias`, `esperado.metadatos` ni los rasgos de formato (comentarios, cambios controlados, metadatos, anotaciones PDF) hasta que PG-2 los agregue;
   sí se revisó el texto de las partes `comentario`, `nota_final` y `anotacion_pdf`.

## Cómo repetirlo

```
node corpus/revision/herramientas/r1-anotar.mjs C07 C14 C15 C19 C21 C23 C26 C29
node corpus/revision/herramientas/r1-comparar.mjs C07 C14 C15 C19 C21 C23 C26 C29
node corpus/revision/herramientas/r2-candidatos.mjs --decisiones
node corpus/revision/herramientas/r2-decidir.mjs
```
