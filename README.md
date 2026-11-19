# Torneo COD: Black Ops II — Registro Oficial (Solo Invitación)

Página web estática (mobile-first) para el registro de participantes y escuadras (máximo 5 integrantes) del torneo de **Ingeniería en Sistemas Computacionales**, conectada a **Supabase** y publicada en **GitHub Pages**.

---

## Privacidad y acceso

* **Acceso exclusivo por enlace de invitación (`?inv=<token>`):** El token se valida únicamente del lado de PostgreSQL (`public.torneo_config`); no existe en este repositorio ni en los archivos JS. Quien abra la URL sin el enlace válido verá la pantalla bloqueada sin datos.
* **Bloqueo de buscadores:** Incluye `robots.txt` (`Disallow: /`) y etiquetas `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">`.
* **Solo nicknames públicos:** En el tablero público únicamente se muestran nombres de equipos y `nickname`. Los nombres reales, grados/grupos, números de WhatsApp y PINs quedan protegidos en PostgreSQL mediante RLS.
* **Sin código de administración en GitHub:** El panel de gestión, resolución de solicitudes, rotación de enlace de invitación y exportación a Excel vive aparte de este repositorio en una carpeta local privada.

---

## Probar en local

```bash
python3 -m http.server 8080
```

Luego abre `http://localhost:8080/?inv=TU_TOKEN_DE_INVITACION`.

---

## Despliegue en GitHub Pages

```bash
git add .
git commit -m "Actualización del registro"
git push origin main
```

En GitHub → **Settings → Pages**: rama `main`, carpeta `/ (root)`.
