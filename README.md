# Arocena: El misterio del museo

Landing de una propuesta académica. El escape room no es una actividad oficial confirmada del Museo Arocena.

## Estructura

- `public/index.html`: página que publicará Vercel.
- `index.html`: copia de la página para abrirla desde esta carpeta; el envío requiere el servidor de Vercel.
- `api/interest.js`: endpoint de registro para Vercel, sin dependencias externas.
- `supabase/migrations/202611170001_interest_registrations.sql`: esquema y función de registro ya aplicados en Supabase.
- Los tres Markdown originales son contexto local; están excluidos del respaldo Git y del despliegue.

## Estado de publicación

Sitio publicado en producción en Vercel y conectado al proyecto de Supabase `fgujnqclaknihlyjwfkz`. Respaldo de código en un repositorio privado de GitHub.

- [Abrir sitio](https://arocena-escape-room.vercel.app)
- [Repositorio privado](https://github.com/eliudcastilloh/arocena-escape-room)
- Proyecto Vercel: `prj_F7Zm9Kn60QcvDJEylVKHpWdbWJIz`, espacio `eliud5`.

El respaldo en GitHub se cargó manualmente; no hay despliegue automático configurado desde GitHub.

[Abrir Supabase](https://supabase.com/dashboard/project/fgujnqclaknihlyjwfkz)

## Configuración de Vercel

Proyecto sin framework, Node.js 22 y directorio de salida `public`. No requiere comando de build ni paquetes adicionales. Establecer estas variables del servidor antes del despliegue:

- `SUPABASE_URL`: URL del proyecto de Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable activa del proyecto.
- `RATE_LIMIT_SALT`: valor aleatorio de al menos 32 caracteres para derivar el identificador de límite de solicitudes.

No guardar valores de claves ni secretos en Git. `.env.example` documenta los nombres. Los archivos de contexto no se publican.

## Registro

El navegador envía nombre, correo y consentimiento a `/api/interest`. El servidor valida la solicitud y llama a una función restringida de Supabase. Solo responde con éxito cuando la base confirma el registro. Los correos se normalizan y no se duplican; una repetición no cambia los datos originales. El límite es de 10 solicitudes por cada 10 minutos por identificador derivado de IP. No se almacena la IP original.

Las tablas tienen RLS activo y carecen de permisos directos de lectura o escritura para visitantes. La función permite exclusivamente registrar interés. Supabase señala como informativos las tablas sin políticas y como advertencia la función `SECURITY DEFINER` accesible al rol anónimo: en este diseño el acceso directo está bloqueado y la función pública tiene validación, alcance limitado y `search_path` vacío. [Detalle del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Comprobaciones

Se comprobó en la base de datos el guardado, la deduplicación, el consentimiento obligatorio, el límite de solicitudes y la ausencia de permisos públicos para leer registros. El formulario pasó seis escenarios simulados. La prueba en el sitio publicado mostró la confirmación y se verificó el registro correspondiente en Supabase. No se detectaron errores de consola en esa prueba.

La página conserva una maqueta conceptual de zonas seleccionables; no es un modelo tridimensional con giro y zoom. El registro no envía correos automáticamente ni realiza reservas o pagos.
