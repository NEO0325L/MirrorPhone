# Seguridad

No publiques claves, tokens, códigos de sala activos ni registros de emparejamiento en incidencias o pull requests. Si descubres una credencial expuesta, revócala en su proveedor antes de reemplazarla.

Los informes privados de vulnerabilidades están habilitados. Usa **Security → Report a vulnerability** en este repositorio. No publiques detalles explotables ni ataques contra el servidor activo en incidencias públicas.

Las claves `SESSION_SECRET` y `HF_TOKEN` pertenecen a los secretos del proveedor de alojamiento. Los tokens de prueba del código son ficticios. D1, TURN y el servicio de credenciales son servicios externos con sus propios límites y políticas.

El receptor conserva el sandbox de Chromium, impide navegación arbitraria y verifica el origen de peticiones sensibles. No ejecutes la aplicación como administrador/root para el uso normal. El kit de control Wi-Fi requiere confianza de desarrollo del iPhone; todavía es experimental y no forma parte del receptor distribuido.

No existe todavía una política de soporte de versiones de producción ni una auditoría independiente de seguridad.
