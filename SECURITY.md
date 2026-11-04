# Seguridad

No publiques claves, tokens, códigos de sala activos ni registros de emparejamiento en incidencias o pull requests. Si descubres una credencial expuesta, revócala en su proveedor antes de reemplazarla.

Usa la opción privada **Report a vulnerability** del repositorio si está disponible. Si no está habilitada, solicita al mantenedor un canal privado mediante una incidencia sin detalles explotables; no publiques un ataque contra el servidor activo.

Las claves `SESSION_SECRET` y `HF_TOKEN` pertenecen a los secretos del proveedor de alojamiento. Los tokens de prueba del código son ficticios. D1, TURN y el servicio de credenciales son servicios externos con sus propios límites y políticas.

El receptor conserva el sandbox de Chromium, impide navegación arbitraria y verifica el origen de peticiones sensibles. No ejecutes la aplicación como administrador/root para el uso normal. El kit de control Wi-Fi requiere confianza de desarrollo del iPhone; todavía es experimental y no forma parte del receptor distribuido.

No existe todavía una política de soporte de versiones de producción ni una auditoría independiente de seguridad.
