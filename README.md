# Producción Estona

Portal independiente para `produccion.estona.co`.

## Funcionalidades actuales

- 214 órdenes importadas desde proyectos en estado `PAGO ANTICIPO`.
- Ítems históricos importados desde la hoja `PRODUCCION`.
- OP con:
  - Cliente
  - Producto
  - Fecha de inicio
  - Fecha de entrega
- Ítems con:
  - Código automático
  - Descripción
  - Dimensiones
  - Colores
  - Comentarios
  - Estado: MOLDE, FUNDIR, PULIR, ALISTAR, ENTREGADO
- Edición, duplicado y eliminación de ítems.
- Documento imprimible de la OP.
- Historial de cambios.

## Publicación

1. Crea un repositorio nuevo, por ejemplo `produccion-estona`.
2. Sube el contenido de esta carpeta.
3. Importa el repositorio en Vercel.
4. En Vercel agrega el dominio `produccion.estona.co`.
5. En GoDaddy crea el CNAME `produccion` con el valor indicado por Vercel.

## Importante

Esta versión todavía usa `localStorage` para guardar cambios en cada navegador.
El siguiente paso es conectar Supabase para compartir datos entre usuarios.


## Actualización v4

- Fecha de inicio tomada de la fecha de pago del anticipo.
- Fecha de entrega tomada de la entrega estimada.
- Ítems importados desde PRODUCCION.
- Nueva clave de almacenamiento para forzar la recarga de datos.

## Mezclas por ítem

En una orden, abre **Mezclas → Crear mezcla**. Define nombre, cemento blanco/gris,
color de ambas arenas y, para cada grano utilizado, color/referencia, tamaño y porcentaje.
Cada receta pertenece únicamente a la orden donde se crea. En **Ítems**, selecciona una mezcla; la asignación
se guarda automáticamente. **Generar dosificación** consulta la receta guardada y calcula
las cantidades con el peso actual del ítem.

Se conserva `DOSAGE_BASE`: por cada 100 kg de elemento, 31 kg de cemento,
19,4 kg de arena gruesa, 29,1 kg de arena fina, 6,9 kg de agua, 700 ml de
superplastificante y 8,4 kg de carbonato. Los granos se **suman** como porcentaje
del peso del elemento, sin reducir arenas. El total distingue kg y ml.
Los registros anteriores de fundidas siguen disponibles en la pestaña Mezclas.

La ampliación de base de datos está documentada en `db/mezclas.sql` (aplicada en
Supabase con el nombre `add_production_mixtures_and_item_assignment`). Conserva
los permisos de producción y añade RLS a las recetas de producción.

Verificación de cálculo y validaciones: `node --test tests/mezclas.test.cjs`.

Las mezclas incluyen dos pigmentos opcionales, cada uno con nombre/color libre y
porcentaje estimado sobre el cemento o modo **A ojo según color**. El segundo modo
muestra la indicación sin inventar un peso; el resultado presenta un subtotal de
las cantidades calculadas. Las recetas anteriores funcionan sin pigmentos.
La ampliación está en `db/mezclas-pigmentos.sql`, aplicada como
`add_two_optional_mixture_pigments`.

## Registro de dosificaciones por ítem

Al generar una dosificación, **Kg a fabricar** se puede cambiar sin modificar el
peso del ítem. Las cantidades se recalculan con ese valor. **Guardar** guarda
fecha, kg, ítem, mezcla y una copia de la receta y cantidades usadas en **Registros de mezclas**, dentro de la pestaña **Mezclas**. Los registros conservan los pigmentos
«a ojo» y no cambian al editar una receta. El identificador del registro evita
crear duplicados al reintentar un guardado cuya respuesta se interrumpió.

Los registros históricos siguen disponibles; los registros creados desde ítems
se consultan como una copia fija de la dosificación utilizada. La ampliación
`db/dosificacion-items.sql` se aplicó como
`save_item_dosage_batches_with_recipe_snapshots`.

La dosificación se abre en un panel a la izquierda. **Guardar** registra la mezcla
y cierra el panel; **X** o Escape lo cierran sin guardar.

Crear y editar recetas, consultar dosificaciones guardadas y crear o editar
registros manuales usan el mismo panel izquierdo. Al cerrarlo, los formularios
vuelven a su ubicación oculta sin ampliar los listados.

El documento de la OP muestra la mezcla asignada a cada ítem y un cuadro
**Mezclas** antes de Observaciones. El cuadro incluye una sola vez cada receta
utilizada en esa orden, con cemento, arenas, granos (color, tamaño y porcentaje)
y pigmentos (porcentaje sobre cemento o «a ojo»). Se actualiza al asignar o editar
una mezcla y al abrir el documento; la impresión espera a que estén disponibles
las recetas asignadas.

Las mezclas están vinculadas por `orden_id`: nombres como **MESAS** pueden
repetirse en órdenes distintas. El listado, los selectores, la edición, la
dosificación y el PDF consultan solo las recetas de la orden abierta. Las claves
foráneas impiden asignar una mezcla a ítems o registros de otra orden. La mezcla
existente se vinculó a la única orden que la utilizaba, conservando asignaciones
y registros. Cambio de base de datos: `db/mezclas-por-orden.sql`, aplicado como
`scope_production_mixtures_to_their_order`.

La información general de cada orden incluye **Observaciones**, disponibles
también al crearla. Se guardan automáticamente al editar y se imprimen después
del cuadro de mezclas, conservando los saltos de línea y permitiendo varias
páginas. Columna añadida mediante `db/observaciones-orden.sql`, aplicada como
`add_general_production_order_observations`.

El cemento se reparte entre **blanco (%)** y **gris (%)**, sumando 100%. El
editor calcula automáticamente el porcentaje complementario. La cantidad total
de cemento de la receta base se conserva y el pigmento se calcula sobre esa
cantidad total. La dosificación y el cuadro de mezclas impreso omiten cualquier
cemento al 0%. Las recetas anteriores mantienen el color que tenían, ahora al
100%. Esquema: `db/cementos-mezcla.sql`, aplicado como
`add_white_and_gray_cement_blend_percentages`.

## Avances con confirmación

El rol **PRODUCCION_LECTURA** solicita el siguiente avance desde la flecha junto
al estado del ítem. El estado real se conserva hasta que un **ADMINISTRADOR**
revise y confirme la solicitud en **Avances pendientes** o desde la propia ficha.
Rechazar no cambia el ítem. Si el estado cambió o la orden se cerró, la solicitud
se marca desactualizada y no se aplica. Cada ítem admite una sola solicitud
pendiente; se conservan solicitante, revisor, fechas y comentario de revisión.

El permiso de lectura del usuario no cambia: no obtiene acceso directo para
modificar estados. La aprobación y el cambio de estado son una transacción y
usan los disparadores existentes de historial y etapas. El usuario de consulta no solicita el cierre final del
ítem. La cola se actualiza por
Realtime y también incluye un botón Actualizar.

SQL: `db/solicitudes-avance.sql` y `db/solicitudes-avance-revision.sql`, aplicados
como `add_item_advance_requests_with_admin_confirmation` y
`reject_already_reviewed_advance_requests`. Verificación transaccional con
ambos roles y reversión de los datos de prueba: `tests/avances.integration.sql`.

## Modelos 3D opcionales por ítem

El botón **3D** abre un visor para subir o consultar un archivo GLB versión 2
(máximo 25 MB). El visor siempre muestra caras claras y aristas oscuras,
omitiendo las diagonales coplanares. Permite girar, acercar y pulsar una arista
para resaltar el segmento y mostrar su longitud en centímetros. Se mide el
segmento seleccionado, no se unen automáticamente varios segmentos de un borde.
La medida incluye las transformaciones y escalas de los nodos del GLB y usa
la unidad estándar de glTF (metros); comprueba la escala exportada con una
medida conocida antes de usarla en fabricación. «Quitar medida» limpia la selección.
La vista usa Three.js 0.172.0, cargado desde `cdn.jsdelivr.net` al abrir el modelo.
Las cotas o anotaciones originales de SketchUp no se recrean automáticamente.

Los modelos usan el bucket existente `planos-produccion`, separados de las
referencias en `<orden_id>/<item_id>/modelos-3d/`. No requieren columnas nuevas.
El bucket debe admitir `model/gltf-binary`, el tamaño del archivo y las
operaciones de listar, subir y eliminar conforme a los permisos del usuario.
El visor utiliza el acceso público del bucket, igual que las referencias actuales.
Al reemplazar un modelo, primero se guarda el nuevo y luego se elimina el anterior.
Un rechazo de permisos o de tipo de archivo se muestra en la ventana; no se
modifican automáticamente las políticas de Supabase.

Si la subida indica `mime type model/gltf-binary is not supported`, ejecuta
`db/modelos-3d.sql` en el SQL Editor del proyecto Supabase. Añade ese formato sin
reemplazar los existentes ni modificar las políticas o los límites de tamaño.
Después vuelve a subir el GLB desde el botón 3D; no hace falta redesplegar el portal.

## Nuevos usuarios de Producción

Pendiente de aplicar con acceso administrativo a Supabase:

1. Ejecutar `db/usuarios-produccion.sql` en SQL Editor. Añade un bloqueo de
   escrituras para los usuarios cuyo `app_metadata.production_view_only` sea
   `true`; conserva las reglas existentes para los demás usuarios. Incluye
   tablas de producción, perfiles y archivos del bucket `planos-produccion`.
2. Ejecutar `python3 scripts/crear-usuarios-produccion.py` desde un equipo de
   confianza. Solicita la clave administrativa y la contraseña inicial sin
   mostrarlas ni guardarlas; usa HTTPS con verificación TLS. No enviar esas
   claves por chat ni incorporarlas al repositorio.
3. El script crea `produccion@estona.co` (Miguel) y `jeancarlos@estona.co` con
   el rol existente `PRODUCCION`. Crea Jhonathan, Juan Gabriel, Alex, Sebastián,
   Víctor e Iván como `PRODUCCION_LECTURA` con la restricción adicional de solo
   visor. No envía correos ni cambia cuentas ya existentes; informa cuáles
   requieren revisión. Verifica cada perfil y revierte solo la cuenta nueva
   si falla su configuración.
4. Comprobar el inicio de sesión con una cuenta de cada tipo. Producción puede
   generar dosificaciones y registrar avances; los visores pueden consultar,
   filtrar e imprimir, sin solicitar avances ni escribir datos o archivos.

La contraseña no está incluida en estos archivos. La creación real de cuentas
requiere ejecutar esos pasos; publicar el frontend por sí solo no las crea.

Alternativa sin ejecutar Python: crear las ocho cuentas en Supabase
**Authentication → Users → Add user**, con la contraseña elegida y el correo
confirmado. Luego ejecutar `db/usuarios-produccion.sql` y
`db/asignar-usuarios-produccion.sql`, en ese orden. El segundo archivo asigna
los perfiles y la restricción de visor; no contiene ni cambia contraseñas y
rechaza modificar cuentas administradoras. Si falta una cuenta, revierte toda
la asignación. Los usuarios deben iniciar una sesión nueva después de la
asignación para que la interfaz reciba los permisos actualizados.

## Actividades compartidas entre usuarios

Ejecutar `db/actividades-compartidas.sql` en SQL Editor después de la configuración
de usuarios. Crea la selección compartida, los textos adicionales por fecha y
los permisos: todas las cuentas activas de Producción pueden consultar; solo
`ADMINISTRADOR` y `PRODUCCION` pueden editar, excluyendo las cuentas de solo visor.
Las selecciones conservan prioridad entre días y se retiran mediante un trigger
al confirmar el avance del ítem. Cada etapa mantiene su grupo en pantalla y PDF.

Después de aplicar el SQL y desplegar, abrir el botón de fecha desde el navegador
que tenía los ítems marcados y pulsar **Compartir mi selección anterior**. La
importación es explícita, conserva el orden, no duplica selecciones existentes y
no borra la copia local si falla. Se omiten ítems que ya avanzaron o se cerraron.
Las nuevas selecciones y actividades adicionales se guardan en Supabase; no hay
un modo local silencioso si faltan las tablas. Realtime sincroniza cambios y una
consulta cada 15 segundos mantiene la actualización si falla el canal.

Verificación de SQL en PostgreSQL 16 aislado: cargar
`tests/fixtures/actividades-base.sql`, `db/usuarios-produccion.sql`,
`db/actividades-compartidas.sql` y `tests/actividades-compartidas.integration.sql`.
Los archivos de tests usan usuarios ficticios y nunca deben ejecutarse sobre la
base de producción. Incluyen permisos, prioridad, idempotencia, órdenes cerradas,
texto compartido y retirada del pendiente por avance.
