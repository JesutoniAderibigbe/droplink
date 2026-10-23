# Decisions

Ambiguous choices made while building DropLink, with the reasoning. Newest at the bottom.

## Scaffold

- **Project lives in `droplink/`** inside Downloads, because the Downloads folder was not empty.
- **Local Supabase ports are 553xx** (API 55321, DB 55322, Studio 55323, Mailpit 55324) instead of
  the 543xx defaults, because another local Supabase project on this machine already uses those.
- **Supabase is proxied through the Vite dev server.** The browser calls `https://<LAN-IP>:5173/auth/v1`,
  `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1`, and Vite forwards to local Supabase.
  This avoids mixed content (HTTPS page to HTTP Supabase) and means the phone needs only one
  trusted certificate. Enabled with `VITE_SUPABASE_URL=same-origin`.
- **HTTPS in dev:** uses mkcert certificates from `./certs` if present, otherwise
  `@vitejs/plugin-basic-ssl` (self-signed). Self-signed is fine on the laptop, but Android Chrome will
  not register a service worker over an untrusted certificate, so phone testing needs mkcert.
