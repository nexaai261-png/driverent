-- =====================================================
-- DriveRent: skema database Supabase
-- Cara pakai: Supabase > SQL Editor > New query > tempel semua isi file ini > Run.
-- Aman dijalankan ulang (memakai IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================

-- ---------- 1. TABEL ----------
create table if not exists public.cars (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 3 and 80),
  type        text not null check (type in ('City Car','MPV','SUV','Sedan')),
  seat        int  not null check (seat between 1 and 20),
  price       int  not null check (price > 0),
  trans       text not null default 'Manual',
  fuel        text not null default 'Bensin',
  color       text not null default '#4a6fa5',
  description text not null default '',
  status      text not null default 'available' check (status in ('available','rented','unavailable')),
  img         text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.bookings (
  id              text primary key,
  customer_id     text   not null,
  customer_name   text   not null,
  phone           text   not null,
  email           text   not null,
  car_id          bigint references public.cars(id) on delete set null,
  car             text   not null,
  start_date      date   not null,
  end_date        date   not null,
  duration        int    not null check (duration > 0),
  price_per_day   int    not null,
  additional_cost int    not null default 0,
  total           int    not null,
  addons          text[] not null default '{}',
  addon_labels    text[] not null default '{}',
  status          text   not null default 'created'
                  check (status in ('created','processing','approved','ongoing','completed','rejected')),
  history         jsonb  not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists bookings_created_idx on public.bookings (created_at desc);
create index if not exists bookings_car_idx on public.bookings (car_id);

-- ---------- 2. KEAMANAN (Row Level Security) ----------
alter table public.cars enable row level security;
alter table public.bookings enable row level security;

-- Mobil: siapa pun boleh melihat, hanya admin (user yang login) boleh mengubah.
drop policy if exists cars_read on public.cars;
create policy cars_read on public.cars for select to anon, authenticated using (true);
drop policy if exists cars_admin on public.cars;
create policy cars_admin on public.cars for all to authenticated using (true) with check (true);

-- Pemesanan: HANYA admin. Pelanggan tidak punya akses langsung ke tabel ini;
-- mereka memakai fungsi create_booking() dan get_bookings() di bawah.
drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings for all to authenticated using (true) with check (true);
revoke all on public.bookings from anon;

-- ---------- 3. ATURAN STATUS (dijaga di server, bukan hanya di tampilan) ----------
create or replace function public.bookings_before_update()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'created'    and new.status = 'processing')
      or (old.status = 'processing' and new.status in ('approved','rejected'))
      or (old.status = 'approved'   and new.status = 'ongoing')
      or (old.status = 'ongoing'    and new.status = 'completed')
    ) then
      raise exception 'Perubahan status tidak valid: % ke %', old.status, new.status;
    end if;
    new.history := coalesce(old.history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status', new.status, 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint));
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_before_update on public.bookings;
create trigger trg_bookings_before_update before update on public.bookings
  for each row execute function public.bookings_before_update();

-- Status mobil mengikuti pesanan: "Disewa" saat ada pesanan berlangsung, kembali "Tersedia" setelahnya.
-- Mobil yang diset admin menjadi "Tidak Tersedia" tidak disentuh.
create or replace function public.sync_car_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  cid := case when tg_op = 'DELETE' then old.car_id else new.car_id end;
  if cid is null then return null; end if;
  if exists (select 1 from public.bookings where car_id = cid and status = 'ongoing') then
    update public.cars set status = 'rented' where id = cid and status = 'available';
  else
    update public.cars set status = 'available' where id = cid and status = 'rented';
  end if;
  return null;
end $$;

drop trigger if exists trg_bookings_sync_car on public.bookings;
create trigger trg_bookings_sync_car after insert or delete or update of status on public.bookings
  for each row execute function public.sync_car_status();

-- ---------- 4. FUNGSI UNTUK PELANGGAN ----------
-- Membuat pesanan. Harga dan total dihitung ulang di server sehingga tidak bisa dimanipulasi dari browser.
create or replace function public.create_booking(
  p_name text, p_phone text, p_email text, p_car_id bigint,
  p_start date, p_end date, p_addons text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_car    public.cars;
  v_days   int;
  v_extra  int := 0;
  v_labels text[] := '{}';
  v_id     text;
  v_try    int := 0;
  v_phone  text;
  v_total  int;
  v_today  date := (now() at time zone 'Asia/Jakarta')::date;
  a        text;
begin
  p_name  := btrim(coalesce(p_name, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_email := btrim(coalesce(p_email, ''));

  if char_length(p_name) < 3 or char_length(p_name) > 100 then
    raise exception 'Nama minimal 3 karakter.';
  end if;
  if regexp_replace(p_phone, '[\s-]', '', 'g') !~ '^(\+62|62|0)8[0-9]{7,12}$' then
    raise exception 'Nomor HP tidak valid (contoh 08123456789).';
  end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p_email) > 150 then
    raise exception 'Format email tidak valid.';
  end if;

  select * into v_car from public.cars where id = p_car_id;
  if not found then raise exception 'Mobil tidak ditemukan.'; end if;
  if v_car.status = 'unavailable' then raise exception 'Mobil ini sedang tidak tersedia.'; end if;

  if p_start is null or p_end is null or p_start < v_today then
    raise exception 'Tanggal mulai tidak boleh sebelum hari ini.';
  end if;
  if p_end < p_start then raise exception 'Tanggal selesai harus setelah tanggal mulai.'; end if;
  v_days := greatest(1, p_end - p_start);
  if v_days > 90 then raise exception 'Lama sewa maksimal 90 hari.'; end if;

  -- Layanan tambahan (sama dengan tarif di tampilan)
  p_addons := array(select distinct x from unnest(coalesce(p_addons, '{}')) as x order by x);
  foreach a in array p_addons loop
    if a = 'shuttle' then
      v_extra := v_extra + 50000;           v_labels := v_labels || 'Antar jemput mobil'::text;
    elsif a = 'driver' then
      v_extra := v_extra + 250000 * v_days; v_labels := v_labels || 'Sopir'::text;
    elsif a = 'insurance' then
      v_extra := v_extra + 40000 * v_days;  v_labels := v_labels || 'Asuransi tambahan'::text;
    else
      raise exception 'Layanan tambahan tidak dikenal.';
    end if;
  end loop;
  v_total := v_car.price * v_days + v_extra;

  -- Nomor pesanan acak, mis. DR-4827
  loop
    v_id := 'DR-' || (floor(random() * 9000) + 1000)::int::text;
    exit when not exists (select 1 from public.bookings where id = v_id);
    v_try := v_try + 1;
    if v_try > 200 then raise exception 'Gagal membuat nomor pemesanan, coba lagi.'; end if;
  end loop;

  v_phone := regexp_replace(p_phone, '\D', '', 'g');
  if v_phone like '62%' then v_phone := '0' || substr(v_phone, 3); end if;

  insert into public.bookings
    (id, customer_id, customer_name, phone, email, car_id, car, start_date, end_date, duration,
     price_per_day, additional_cost, total, addons, addon_labels, status, history)
  values
    (v_id, v_phone, p_name, p_phone, p_email, v_car.id, v_car.name, p_start, p_end, v_days,
     v_car.price, v_extra, v_total, p_addons, v_labels, 'created',
     jsonb_build_array(jsonb_build_object('status', 'created',
       'at', (extract(epoch from clock_timestamp()) * 1000)::bigint)));

  return jsonb_build_object('id', v_id, 'car', v_car.name, 'duration', v_days,
                            'additional_cost', v_extra, 'total', v_total);
end $$;

-- Cek status berdasarkan nomor pesanan. Hanya mengembalikan data non-pribadi
-- (tanpa nama, nomor HP, atau email).
create or replace function public.get_bookings(p_ids text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'car', b.car, 'car_id', b.car_id, 'duration', b.duration, 'total', b.total,
           'status', b.status, 'history', b.history,
           'start_date', b.start_date, 'end_date', b.end_date) order by b.created_at desc), '[]'::jsonb)
  from public.bookings b
  where b.id in (select upper(btrim(x)) from unnest(p_ids[1:20]) as x);
$$;

revoke all on function public.create_booking(text, text, text, bigint, date, date, text[]) from public;
revoke all on function public.get_bookings(text[]) from public;
grant execute on function public.create_booking(text, text, text, bigint, date, date, text[]) to anon, authenticated;
grant execute on function public.get_bookings(text[]) to anon, authenticated;

-- ---------- 5. DATA AWAL MOBIL (hanya jika tabel masih kosong) ----------
insert into public.cars (name, type, seat, price, trans, fuel, color, description)
select * from (values
  ('Toyota Avanza',   'MPV',      7, 350000, 'Manual',   'Bensin', '#4a6fa5', 'MPV keluarga yang irit dan lega, cocok untuk perjalanan bersama keluarga.'),
  ('Honda Brio',      'City Car', 5, 300000, 'Otomatis', 'Bensin', '#d9822b', 'City car lincah dan hemat, ideal untuk mobilitas dalam kota.'),
  ('Toyota Innova',   'MPV',      7, 550000, 'Otomatis', 'Diesel', '#3d4657', 'MPV premium dengan kabin nyaman untuk perjalanan jarak jauh.'),
  ('Honda Civic',     'Sedan',    5, 750000, 'Otomatis', 'Bensin', '#8b1e2d', 'Sedan sporty dan elegan untuk acara bisnis maupun perjalanan santai.'),
  ('Toyota Fortuner', 'SUV',      7, 900000, 'Otomatis', 'Diesel', '#1d2433', 'SUV tangguh dengan performa kuat untuk segala medan.')
) as v(name, type, seat, price, trans, fuel, color, description)
where not exists (select 1 from public.cars);
