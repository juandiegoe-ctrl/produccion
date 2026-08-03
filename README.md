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
