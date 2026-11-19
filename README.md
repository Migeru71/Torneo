# Torneo COD: Black Ops II — Registro Oficial

Página web estática (mobile-first) para el registro de participantes, escuadras (máximo 5 integrantes), solicitudes de ingreso, fusiones de equipos y panel de administración con exportación a Excel (`.xlsx`), conectada a **Supabase** y lista para publicar en **GitHub Pages**.

- **Carrera:** Ingeniería en Sistemas Computacionales
- **Arquitectura:** HTML + CSS + JavaScript puro (`@supabase/supabase-js` v2 vía CDN) + RPCs protegidas con RLS en Supabase.

---

## 1. Probar en local

Desde esta carpeta (`torneo-bo2-registro`), levanta un servidor HTTP simple:

```bash
python3 -m http.server 8080
```

Luego abre en tu navegador:
- Página pública: `http://localhost:8080`
- Panel Admin directo: `http://localhost:8080/#admin`

> **Nota:** Para pruebas en el mismo celular conectado a tu Wi-Fi local, abre `http://<tu-IP-local>:8080`.

---

## 2. Subir a GitHub y activar GitHub Pages

1. Crea un repositorio nuevo y vacío en GitHub (por ejemplo `torneo-bo2-isc`, **sin** README ni `.gitignore`).
2. Ejecuta dentro de esta carpeta (`torneo-bo2-registro`):

```bash
git add .
git commit -m "Sitio de registro Torneo COD Black Ops II ISC"
git remote add origin https://github.com/<TU_USUARIO>/<TU_REPO>.git
git push -u origin main
```

3. En GitHub, entra a tu repositorio → **Settings → Pages**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` y carpeta `/ (root)` → **Save**

En ~1 minuto quedará publicada en `https://<TU_USUARIO>.github.io/<TU_REPO>/`.
