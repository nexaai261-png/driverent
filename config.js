/* =====================================================
   Konfigurasi Supabase
   Isi dengan data dari: Supabase > Project Settings > API
   - SUPABASE_URL      : "Project URL"
   - SUPABASE_ANON_KEY : kunci "anon / public" (atau "publishable")

   Kunci ini MEMANG untuk dipasang di browser dan aman ada di GitHub,
   karena yang melindungi data adalah aturan RLS di schema.sql.
   JANGAN PERNAH memasukkan kunci "service_role" / "secret" ke file ini.

   File ini ada DUA: config.js (website pelanggan) dan admin/config.js (admin).
   Isi keduanya dengan nilai yang SAMA.

   Opsional, hanya jika website dan admin dipasang di alamat berbeda:
   - ADMIN_URL : alamat halaman login admin, mis. "https://admin.namadomain.com/admin-login.html"
   - SITE_URL  : alamat website pelanggan,   mis. "https://namadomain.com"
   ===================================================== */
window.DR_CONFIG = {
  SUPABASE_URL: "ISI_PROJECT_URL_KAMU",
  SUPABASE_ANON_KEY: "ISI_ANON_KEY_KAMU",
  ADMIN_URL: "",
  SITE_URL: ""
};
