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
Las recetas se comparten entre órdenes. En **Ítems**, selecciona una mezcla; la asignación
se guarda automáticamente. **Generar dosificación** consulta la receta guardada y calcula
las cantidades con el peso actual del ítem.

Se conserva `DOSAGE_BASE`: por cada 100 kg de elemento, 31 kg de cemento,
19,4 kg de arena gruesa, 29,1 kg de arena fina, 6,9 kg de agua, 700 ml de
superplastificante y 8,4 kg de carbonato. Los granos se **suman** como porcentaje
del peso del elemento, sin reducir arenas. El total distingue kg y ml.
Los registros anteriores de fundidas siguen disponibles en la pestaña Mezclas.

La ampliación de base de datos está documentada en `db/mezclas.sql` (aplicada en
Supabase con el nombre `add_production_mixtures_and_item_assignment`). Conserva
los permisos de producción y añade RLS a las recetas compartidas.

Verificación de cálculo y validaciones: `node --test tests/mezclas.test.cjs`.
