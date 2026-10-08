# DriveRent (versi Supabase)

Website rental mobil dengan database online. Website pelanggan dan panel admin berada di satu proyek
dan membaca data yang sama dari perangkat mana pun.

```
driverent-supabase/
├── index.html, style.css, script.js   website pelanggan
├── config.js                          isi URL dan kunci Supabase (langkah 4)
├── admin/                             panel admin (admin-login.html, admin.html, config.js, ...)
└── supabase/schema.sql                tabel, aturan keamanan, dan fungsi database
```

Alamat setelah online:
- Pelanggan: `https://namadomain.com`
- Admin: `https://namadomain.com/admin/admin-login.html`

## Cara pasang

### 1. Buat project Supabase (gratis)
1. Daftar di https://supabase.com lalu klik **New project**.
2. Isi nama (mis. `driverent`), buat **Database Password** dan simpan, pilih region **Singapore**, lalu **Create**.
3. Tunggu sekitar 2 menit sampai project siap.

### 2. Buat tabel dan aturan keamanan
1. Buka **SQL Editor** > **New query**.
2. Buka file `supabase/schema.sql`, salin semua isinya, tempel, lalu klik **Run**.
3. Harus muncul "Success". Di **Table Editor** akan ada tabel `cars` (5 mobil awal) dan `bookings` (kosong).

File ini aman dijalankan ulang.

### 3. Buat akun admin
1. Buka **Authentication** > **Users** > **Add user** > **Create new user**.
2. Isi email dan password yang kuat, centang **Auto Confirm User**, lalu simpan.
3. **Penting:** matikan pendaftaran umum supaya orang lain tidak bisa membuat akun sendiri. Buka
   **Authentication** > **Sign In / Providers** (di versi lama: **Providers** > **Email**), lalu matikan
   **Allow new users to sign up**.

Semua akun yang bisa login dianggap admin. Karena pendaftaran dimatikan, hanya akun yang kamu buat yang ada.

### 4. Hubungkan website ke Supabase
1. Buka **Project Settings** > **API** (atau **API Keys**).
2. Salin **Project URL** dan kunci **anon / public** (atau **publishable**).
3. Buka `config.js` dan ganti dua nilai itu. **Lakukan juga di `admin/config.js` dengan nilai yang sama:**

```js
window.DR_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

Kunci anon memang untuk dipasang di browser dan aman ada di GitHub, karena data dilindungi aturan di
`schema.sql`. **Jangan pernah** memasukkan kunci `service_role` atau `secret`.

### 5. Uji di komputer sebelum online
Buka folder di VS Code, pasang ekstensi **Live Server**, klik kanan `index.html` > **Open with Live Server**.
Jangan buka dengan klik dua kali file (alamat `file://`), karena login admin bisa gagal.
Lalu ikuti daftar uji di bawah.

### 6. Taruh di GitHub
Cara paling mudah lewat web:
1. Di https://github.com klik **New repository**, beri nama `driverent`, lalu **Create repository**.
2. Klik **uploading an existing file**, lalu seret **isi** folder `driverent-supabase`
   (`index.html`, `config.js`, folder `admin`, dan seterusnya), bukan file zip-nya.
3. Klik **Commit changes**.

Cara lewat terminal:
```
cd driverent-supabase
git init
git add .
git commit -m "DriveRent"
git branch -M main
git remote add origin https://github.com/USERNAME/driverent.git
git push -u origin main
```

Pastikan `index.html` ada di halaman utama repo, bukan di dalam sub-folder.

### 7. Online lewat Vercel
1. Di https://vercel.com klik **Add New** > **Project**, lalu pilih repo `driverent`.
2. **Framework Preset** pilih **Other**. Kosongkan Build Command dan Output Directory. Klik **Deploy**.
3. Untuk domain: **Settings** > **Domains** > masukkan domainmu, lalu atur DNS sesuai nilai yang
   ditampilkan Vercel (biasanya record A atau CNAME di tempat kamu membeli domain).

Setiap `git push` ke GitHub akan memperbarui website otomatis.

## Memasang website pelanggan dan admin terpisah (opsional)

Karena data ada di database, admin boleh punya alamat sendiri, mis. `admin.namadomain.com`.
Cukup satu repo GitHub dan dua project di Vercel:

1. **Project pelanggan:** Import repo, **Root Directory** biarkan kosong (`./`). Domain: `namadomain.com`.
2. **Project admin:** Import **repo yang sama** sekali lagi, klik **Edit** di **Root Directory**, pilih folder `admin`. Domain: `admin.namadomain.com`.
3. Di project admin, halaman login ada di `admin.namadomain.com/admin-login.html`.
   Supaya alamat utama langsung menampilkan login, tambahkan file `admin/vercel.json`:
   ```json
   { "redirects": [{ "source": "/", "destination": "/admin-login.html" }] }
   ```
4. Isi `ADMIN_URL` dan `SITE_URL` di kedua `config.js` agar tautan "Login admin" di footer website dan
   tombol "Lihat Website" di admin menuju alamat yang benar. Atau hapus tautan "Login admin" dari footer
   `index.html` jika alamat admin ingin kamu rahasiakan.

Di Supabase tidak ada yang perlu diubah. Keduanya memakai project dan akun admin yang sama.
Folder `admin` juga tetap boleh ikut terpasang di website utama, jadi jika tidak dipisah pun tetap jalan.

## Daftar uji
- [ ] `/` menampilkan 5 mobil.
- [ ] Buat pesanan lewat Form Peminjaman > Konfirmasi. Muncul nomor pesanan (mis. `DR-4827`).
- [ ] `/admin/admin-login.html` login berhasil. Pesanan baru muncul dengan badge di sidebar.
- [ ] Klik Lihat Detail > Proses Pesanan > Ya. Di HP pelanggan, halaman Status ikut berubah dalam sekitar 5 detik.
- [ ] Lanjutkan Setujui, Mulai Sewa, Selesaikan Sewa. Status mobil otomatis menjadi Disewa lalu Tersedia.
- [ ] Buka `/admin/admin.html` tanpa login. Harus diarahkan ke halaman login.
- [ ] Setelah selesai uji, hapus pesanan uji lewat Pengaturan > Hapus semua pesanan.

## Cara kerja keamanan
- Pelanggan **tidak bisa membaca** tabel pemesanan. Mereka hanya memakai dua fungsi: `create_booking`
  (membuat pesanan) dan `get_bookings` (cek status). Fungsi cek status hanya mengembalikan data non-pribadi
  (tanpa nama, nomor HP, email).
- Harga dan total **dihitung ulang di server**, jadi tidak bisa dimanipulasi dari browser.
- Urutan status dijaga di database: tidak bisa melompat, apa pun yang dikirim dari browser.
- Hanya admin yang login yang bisa mengubah mobil dan pesanan.

## Batasan dan saran
- **Spam:** siapa pun bisa membuat pesanan lewat form. Untuk dipakai sungguhan, tambahkan CAPTCHA
  (mis. Cloudflare Turnstile) atau pembatasan jumlah permintaan.
- **Nomor pesanan 4 digit** (sesuai contoh). Karena status hanya menampilkan data non-pribadi, risikonya kecil.
  Untuk skala besar, perpanjang nomor di fungsi `create_booking`.
- **Tabrakan jadwal belum dicek.** Mobil yang sama bisa dipesan di tanggal yang bertumpuk. Admin yang menyaring
  saat menyetujui.
- **Pembayaran belum ada.**
- **Paket gratis Supabase** menjeda project yang tidak aktif seminggu. Buka dashboard Supabase untuk mengaktifkannya lagi.
- **Foto mobil** diisi lewat URL (kolom "URL foto" di halaman Mobil).

## Jika ada masalah
| Gejala | Penyebab dan solusi |
|---|---|
| Banner "Website belum terhubung ke database" | `config.js` belum diisi atau salah salin. |
| Daftar mobil kosong atau "Gagal memuat" | `schema.sql` belum dijalankan, atau URL/kunci salah. |
| Login admin selalu "Email atau password salah" | Akun belum dibuat atau belum dicentang Auto Confirm User. |
| Muncul "Anda tidak punya izin" di admin | Sesi habis. Keluar lalu login lagi. |
| Pesanan gagal dengan pesan merah | Baca pesannya, itu validasi dari server (mis. tanggal, nomor HP, mobil tidak tersedia). |
