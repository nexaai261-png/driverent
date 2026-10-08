/* =====================================================
   DriveRent - website pelanggan (versi Supabase)
   Data mobil dan pesanan disimpan di database Supabase,
   sehingga admin dan pelanggan membaca data yang sama dari perangkat mana pun.
   ===================================================== */

/* ===== KONEKSI SUPABASE (isi di config.js) ===== */
const CFG = window.DR_CONFIG || {};
const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/^ISI_/.test(CFG.SUPABASE_URL) && !/^ISI_/.test(CFG.SUPABASE_ANON_KEY));
const sb = (CONFIGURED && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const KEY_MINE = "driverent_my_orders"; // nomor pesanan yang dibuat di browser ini (hanya nomor, bukan data pribadi)
const KEY_DRAFT = "dr_draft";

const FACILITIES = ["AC","Audio","Bluetooth","USB Charger","Airbag","Kamera parkir"];
// Tarif layanan tambahan (hanya untuk estimasi di layar; total resmi dihitung ulang oleh server)
// perDay: true = dikali lama sewa, false = biaya tetap
const ADDONS = [
  {id:"shuttle",label:"Antar jemput mobil",cost:50000,perDay:false},
  {id:"driver",label:"Sopir",cost:250000,perDay:true},
  {id:"insurance",label:"Asuransi tambahan",cost:40000,perDay:true}
];
const STATUS_LABEL = {created:"Pesanan Dibuat",processing:"Sedang Diproses",approved:"Disetujui",ongoing:"Sedang Berlangsung",completed:"Selesai",rejected:"Ditolak"};
const FLOW = ["created","processing","approved","ongoing","completed"];

/* ===== UTILITAS ===== */
const $ = s => document.querySelector(s);
const rp = n => "Rp" + Number(n).toLocaleString("id-ID");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
// Tanggal lokal (bukan UTC) agar tidak meleset sehari di zona WIB
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().split("T")[0]; };
const errMsg = e => /fetch|network|load failed/i.test((e && e.message) || "") ? "Tidak dapat terhubung ke server. Periksa koneksi internet Anda." : ((e && e.message) || "Terjadi kesalahan.");
let toastTimer;
function toast(msg, type = "success") {
  const t = $("#toast");
  t.textContent = msg; t.className = "show " + type;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = "", 4200);
}
// Gambar mobil placeholder (SVG) agar tidak bergantung pada internet
function carSvg(color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f3f5f9'/><stop offset='1' stop-color='#d3d9e5'/></linearGradient></defs><rect width='400' height='200' fill='url(#g)'/><ellipse cx='200' cy='172' rx='150' ry='9' fill='#000' opacity='.15'/><path d='M46 146Q48 114 78 108L118 84Q134 70 160 70H246Q274 72 290 92L324 104Q356 110 356 138V152H46Z' fill='${color}'/><path d='M130 92L150 78H196V104H118ZM206 78H246Q262 82 274 104H206Z' fill='#cfe6f7'/><rect x='340' y='120' width='16' height='8' rx='3' fill='#ffe9a8'/><circle cx='118' cy='152' r='25' fill='#151515'/><circle cx='118' cy='152' r='11' fill='#bfc4cc'/><circle cx='288' cy='152' r='25' fill='#151515'/><circle cx='288' cy='152' r='11' fill='#bfc4cc'/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
const carImage = c => c.img || carSvg(c.color || "#4a6fa5");

/* ===== DATA MOBIL (dari database) ===== */
const mapCar = r => ({id: Number(r.id), name: r.name, type: r.type, seat: r.seat, price: r.price, trans: r.trans, fuel: r.fuel, color: r.color, desc: r.description, status: r.status, img: r.img});
let CARS = [], carsLoaded = false, carsError = "", lastCarsRaw = "";
const getCar = id => CARS.find(c => c.id === Number(id));
async function loadCars() {
  const {data, error} = await sb.from("cars").select("*").order("id");
  if (error) throw error;
  lastCarsRaw = JSON.stringify(data);
  CARS = data.map(mapCar);
}
function showConfigError() {
  const d = document.createElement("div");
  d.className = "cfg-error";
  d.innerHTML = "<b>Website belum terhubung ke database.</b> Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di file <code>config.js</code>, lalu muat ulang halaman.";
  document.body.prepend(d);
}

/* ===== NAVIGASI HALAMAN ===== */
const navStack = [];
let current = "home";
function showPage(id, push = true) {
  if (!$("#page-" + id)) return;
  if (push && id !== current) navStack.push(current);
  current = id;
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + id));
  document.querySelectorAll("#menu a").forEach(a => a.classList.toggle("active", a.dataset.go === id));
  $("#menu").classList.remove("open");
  window.scrollTo(0, 0); // kembali ke atas
  if (id === "order") renderOrder();
  if (id === "status") renderMyOrders();
  if (id === "form") { $("#start").min = todayStr(); updateEstimate(); }
}
function goBack() { showPage(navStack.pop() || "home", false); }

// Satu event listener untuk semua tombol/tautan data-*
document.addEventListener("click", e => {
  if (e.target.closest("[data-reload]")) return init();
  const el = e.target.closest("[data-go],[data-detail],[data-rent],[data-back]");
  if (!el || el.disabled) return;
  if (el.dataset.back !== undefined) return goBack();
  if (el.dataset.detail) return showDetail(el.dataset.detail);
  if (el.dataset.rent) {
    const c = getCar(el.dataset.rent);
    if (!c || c.status === "unavailable") return toast("Mobil ini sedang tidak tersedia.", "error");
    $("#car").value = el.dataset.rent; showPage("form"); updateEstimate(); return;
  }
  showPage(el.dataset.go);
});
$("#burger").addEventListener("click", () => $("#menu").classList.toggle("open"));

/* ===== DAFTAR & CARD MOBIL ===== */
function carCard(c) {
  const off = c.status === "unavailable", rented = c.status === "rented";
  const tag = off ? '<span class="cbadge off">Tidak tersedia</span>' : rented ? '<span class="cbadge rent">Sedang disewa</span>' : "";
  return `<article class="card car${off ? " is-off" : ""}"><div class="imgbox"><img src="${esc(carImage(c))}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=carSvg('#4a6fa5')">${tag}</div>
    <div class="body"><h3>${esc(c.name)}</h3>
    <div class="tags"><span>${esc(c.type)}</span><span>${esc(c.seat)} orang</span></div>
    <div class="price">${rp(c.price)}<small>/hari</small></div>
    <div class="row"><button class="btn ghost dark" data-detail="${c.id}">Lihat Detail</button>
    <button class="btn gold" data-rent="${c.id}"${off ? " disabled" : ""}>Sewa Sekarang</button></div></div></article>`;
}
function renderCars(el, list) {
  if (carsError) { el.innerHTML = `<p class="muted">${esc(carsError)} <button class="btn ghost dark" data-reload>Coba lagi</button></p>`; return; }
  if (!carsLoaded) { el.innerHTML = "<p class='muted'>Memuat daftar mobil...</p>"; return; }
  el.innerHTML = list.length ? list.map(carCard).join("") : "<p class='muted'>Tidak ada mobil yang cocok. Ubah atau reset filter.</p>";
}

/* ===== PENCARIAN & FILTER ===== */
function runSearch(silent) {
  const name = $("#fName").value.trim().toLowerCase(), type = $("#fType").value, seat = $("#fSeat").value;
  const min = Number($("#fMin").value) || 0, max = Number($("#fMax").value) || Infinity;
  if (min > max) { if (!silent) toast("Harga minimum tidak boleh lebih besar dari maksimum.", "error"); return; }
  const res = CARS.filter(c => c.name.toLowerCase().includes(name) && (!type || c.type === type) &&
    (!seat || c.seat === Number(seat)) && c.price >= min && c.price <= max);
  $("#resultInfo").textContent = carsLoaded ? res.length + " mobil ditemukan" : "";
  renderCars($("#searchGrid"), res);
}
$("#btnSearch").addEventListener("click", () => runSearch(false));
$("#btnReset").addEventListener("click", () => {
  ["fName", "fType", "fSeat", "fMin", "fMax"].forEach(i => $("#" + i).value = ""); runSearch(false);
});
["fName", "fMin", "fMax"].forEach(i => $("#" + i).addEventListener("keydown", e => e.key === "Enter" && runSearch(false)));

/* ===== DETAIL MOBIL ===== */
let detailId = null;
function detailHTML(c) {
  const off = c.status === "unavailable";
  return `<div class="detail"><img src="${esc(carImage(c))}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=carSvg('#4a6fa5')">
    <div><h2>${esc(c.name)}</h2><div class="price">${rp(c.price)}<small>/hari</small></div>
    <div class="spec"><div><small>Jenis</small>${esc(c.type)}</div><div><small>Kapasitas</small>${esc(c.seat)} orang</div>
    <div><small>Transmisi</small>${esc(c.trans)}</div><div><small>Bahan bakar</small>${esc(c.fuel)}</div></div>
    <b>Fasilitas</b><div class="fac">${FACILITIES.map(f => `<span>${f}</span>`).join("")}</div>
    <p class="muted">${esc(c.desc)}</p>
    <button class="btn gold" data-rent="${c.id}"${off ? " disabled" : ""}>${off ? "Tidak Tersedia" : "Sewa Mobil"}</button></div></div>`;
}
function showDetail(id) {
  const c = getCar(id); if (!c) return;
  detailId = c.id;
  $("#detailBox").innerHTML = detailHTML(c);
  showPage("detail");
}

/* ===== FORM PEMINJAMAN ===== */
let draft = load(KEY_DRAFT, null);
function fillCarSelect() {
  const sel = $("#car"), prev = sel.value;
  sel.innerHTML = `<option value="">${carsLoaded ? "Pilih mobil" : "Memuat mobil..."}</option>` + CARS.map(c =>
    `<option value="${c.id}"${c.status === "unavailable" ? " disabled" : ""}>${esc(c.name)} - ${rp(c.price)}/hari${c.status === "unavailable" ? " (tidak tersedia)" : ""}</option>`).join("");
  if (prev && getCar(prev)) sel.value = prev;
}
$("#addons").innerHTML = ADDONS.map(a => `<label><input type="checkbox" value="${a.id}"> ${a.label}<small>${rp(a.cost)}${a.perDay ? "/hari" : ""}</small></label>`).join("");

function rentDays() {
  const s = $("#start").value, e = $("#end").value;
  if (!s || !e) return 0;
  const d = Math.round((new Date(e) - new Date(s)) / 86400000);
  return d < 0 ? 0 : Math.max(1, d); // minimal 1 hari
}
function calc(carId, days, addonIds) {
  const car = getCar(carId); if (!car || !days) return {base: 0, extra: 0, total: 0};
  const base = car.price * days;
  const extra = ADDONS.filter(a => addonIds.includes(a.id)).reduce((t, a) => t + a.cost * (a.perDay ? days : 1), 0);
  return {base, extra, total: base + extra};
}
const pickedAddons = () => [...document.querySelectorAll("#addons input:checked")].map(i => i.value);
function updateEstimate() {
  const d = rentDays();
  $("#days").value = d ? d + " hari" : "-";
  $("#estimate").textContent = rp(calc($("#car").value, d, pickedAddons()).total);
}
["start", "end", "car"].forEach(i => $("#" + i).addEventListener("change", updateEstimate));
$("#addons").addEventListener("change", updateEstimate);

function setErr(id, msg) {
  const f = $("#" + id); f.classList.toggle("bad", !!msg);
  const s = f.parentElement.querySelector(".err"); if (s) s.textContent = msg || "";
  return !msg;
}
$("#rentForm").addEventListener("submit", e => {
  e.preventDefault();
  const v = id => $("#" + id).value.trim(), today = todayStr();
  const car = getCar(v("car"));
  const ok = [
    setErr("name", v("name").length < 3 ? "Nama minimal 3 karakter." : ""),
    setErr("phone", /^(\+62|62|0)8\d{7,12}$/.test(v("phone").replace(/[\s-]/g, "")) ? "" : "Nomor HP tidak valid (contoh 08123456789)."),
    setErr("email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("email")) ? "" : "Format email tidak valid."),
    setErr("car", !v("car") ? "Pilih mobil terlebih dahulu." : (car && car.status === "unavailable") ? "Mobil ini sedang tidak tersedia." : ""),
    setErr("start", !v("start") ? "Pilih tanggal mulai." : v("start") < today ? "Tanggal mulai tidak boleh sebelum hari ini." : ""),
    setErr("end", !v("end") ? "Pilih tanggal selesai." : v("end") < v("start") ? "Tanggal selesai harus setelah tanggal mulai." : "")
  ].every(Boolean);
  if (!ok) return toast("Periksa kembali isian form.", "error");
  const days = rentDays(), addons = pickedAddons(), price = calc(v("car"), days, addons);
  draft = {name: v("name"), phone: v("phone"), email: v("email"), carId: Number(v("car")),
    start: v("start"), end: v("end"), days, addons, ...price};
  save(KEY_DRAFT, draft);
  toast("Data tersimpan. Periksa ringkasan pemesanan.");
  showPage("order");
});

/* ===== PEMESANAN ===== */
const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("id-ID", {day: "numeric", month: "long", year: "numeric"});
function renderOrder() {
  const box = $("#orderBox");
  const car = draft && getCar(draft.carId);
  if (!draft || !car) {
    box.innerHTML = `<div class="card pad"><p class="muted">Belum ada pemesanan. Isi form peminjaman terlebih dahulu.</p><button class="btn gold" data-go="form">Isi Form</button></div>`;
    return;
  }
  const r = (a, b) => `<div class="inv-row"><span>${a}</span><span>${esc(b)}</span></div>`;
  const extras = ADDONS.filter(a => draft.addons.includes(a.id)).map(a => a.label).join(", ") || "Tidak ada";
  box.innerHTML = `<div class="card invoice"><div class="inv-head"><small>Ringkasan pemesanan</small><h3>Booking Confirmation</h3></div>
    ${r("Nama pelanggan", draft.name)}${r("Nomor HP", draft.phone)}${r("Mobil", car.name)}
    ${r("Tanggal mulai", fmtDate(draft.start))}${r("Tanggal selesai", fmtDate(draft.end))}${r("Lama sewa", draft.days + " hari")}
    ${r("Harga per hari", rp(car.price))}${r("Layanan tambahan", extras)}${r("Biaya tambahan", rp(draft.extra))}
    <div class="inv-row inv-total"><span>Total biaya</span><span>${rp(draft.total)}</span></div>
    <div class="inv-act row"><button class="btn gold" id="btnConfirm">Konfirmasi Peminjaman</button><button class="btn ghost dark" data-go="form">Ubah Data</button></div></div>`;
  $("#btnConfirm").addEventListener("click", confirmOrder);
}
async function confirmOrder() {
  if (!draft) return;
  if (!sb) return toast("Website belum terhubung ke database.", "error");
  const btn = $("#btnConfirm");
  btn.disabled = true; btn.textContent = "Memproses...";
  // Server memvalidasi ulang semuanya dan menghitung total sendiri
  const {data, error} = await sb.rpc("create_booking", {
    p_name: draft.name, p_phone: draft.phone, p_email: draft.email, p_car_id: draft.carId,
    p_start: draft.start, p_end: draft.end, p_addons: draft.addons
  });
  if (error) {
    btn.disabled = false; btn.textContent = "Konfirmasi Peminjaman";
    return toast(errMsg(error), "error");
  }
  const id = data.id;
  const mine = load(KEY_MINE, []); mine.push(id); save(KEY_MINE, mine.slice(-20));
  statusMap[id] = "created";
  draft = null; try { localStorage.removeItem(KEY_DRAFT); } catch (e) {}
  toast("Pemesanan berhasil dibuat!", "success");
  $("#orderBox").innerHTML = `<div class="card ok"><div class="tick">&#10003;</div><h3>Pemesanan berhasil dibuat</h3>
    <p class="muted">Nomor pemesanan Anda: <b>${esc(id)}</b><br>Total biaya: ${rp(data.total)}<br>Simpan nomor ini untuk mengecek status.</p>
    <div class="row" style="justify-content:center"><button class="btn gold" id="goStatus">Cek Status</button><button class="btn ghost dark" data-go="home">Ke Beranda</button></div></div>`;
  $("#goStatus").addEventListener("click", () => { $("#orderNo").value = id; showPage("status"); checkStatus(false); });
}

/* ===== STATUS PEMINJAMAN (dibaca dari database; diubah oleh admin) ===== */
let viewingId = null;
const statusMap = {}; // nomor pesanan -> status terakhir yang diketahui
async function fetchBookings(ids) {
  const {data, error} = await sb.rpc("get_bookings", {p_ids: ids});
  if (error) throw error;
  return data || [];
}
function renderMyOrders() {
  const list = load(KEY_MINE, []).slice().reverse();
  $("#myOrders").innerHTML = list.length ? "<small class='muted'>Pesanan Anda:</small>" + list.map(x => `<button data-no="${esc(x)}">${esc(x)}</button>`).join("") : "";
}
$("#myOrders").addEventListener("click", e => { if (e.target.dataset.no) { $("#orderNo").value = e.target.dataset.no; checkStatus(false); } });
function timelineHTML(b) {
  const li = (cls, mark, label) => `<li class="${cls}"><i>${mark}</i>${label}</li>`;
  if (b.status === "rejected") {
    return `<ul class="tl">${li("done", "&#10003;", "Pesanan Dibuat")}${li("done", "&#10003;", "Sedang Diproses")}${li("rejected", "&#10005;", "Pesanan Ditolak")}</ul>`;
  }
  const idx = FLOW.indexOf(b.status);
  return `<ul class="tl">` + FLOW.map((k, i) => {
    const done = i <= idx, now = i === idx && b.status !== "completed";
    return li((done ? "done" : "") + (now ? " now" : ""), done ? "&#10003;" : "&#9675;", STATUS_LABEL[k]);
  }).join("") + `</ul>`;
}
function renderStatus(b) {
  const last = (b.history || []).slice(-1)[0];
  const upd = last ? new Date(last.at).toLocaleString("id-ID", {day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}) : "-";
  $("#statusBox").innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">
    <p><b>${esc(b.id)}</b> - ${esc(b.car)}, ${esc(b.duration)} hari (${rp(b.total)})</p>
    <p class="upd">Status: <b>${esc(STATUS_LABEL[b.status] || b.status)}</b>. Diperbarui ${upd}.</p>
    ${timelineHTML(b)}`;
}
async function checkStatus(silent) {
  const no = $("#orderNo").value.trim().toUpperCase();
  if (!no) { if (!silent) toast("Masukkan nomor pemesanan.", "error"); return; }
  if (!sb) return toast("Website belum terhubung ke database.", "error");
  const btn = $("#btnCheck"); btn.disabled = true;
  try {
    const rows = await fetchBookings([no]);
    const b = rows[0];
    if (!b) { viewingId = null; $("#statusBox").innerHTML = ""; toast("Nomor pemesanan tidak ditemukan.", "error"); return; }
    viewingId = b.id; statusMap[b.id] = b.status;
    renderStatus(b);
  } catch (e) { toast(errMsg(e), "error"); }
  finally { btn.disabled = false; }
}
$("#btnCheck").addEventListener("click", () => checkStatus(false));
$("#orderNo").addEventListener("keydown", e => e.key === "Enter" && checkStatus(false));

/* ===== AUTO UPDATE: cek database berkala ===== */
let polling = false;
async function pollUpdates() {
  if (polling || document.hidden || !sb || !carsLoaded) return;
  polling = true;
  try {
    // 1) Perubahan status pesanan milik pengguna
    const ids = new Set(load(KEY_MINE, []));
    if (viewingId) ids.add(viewingId);
    if (ids.size) {
      const rows = await fetchBookings([...ids]);
      let changed = null;
      rows.forEach(r => {
        if (statusMap[r.id] && statusMap[r.id] !== r.status) changed = r;
        statusMap[r.id] = r.status;
        if (r.id === viewingId) renderStatus(r);
      });
      if (changed) toast("Status pesanan Anda telah diperbarui. " + changed.id + ": " + STATUS_LABEL[changed.status] + ".", "success");
    }
    // 2) Perubahan data mobil oleh admin
    const {data, error} = await sb.from("cars").select("*").order("id");
    if (!error && JSON.stringify(data) !== lastCarsRaw) {
      lastCarsRaw = JSON.stringify(data);
      CARS = data.map(mapCar);
      renderAll();
      if (current === "detail") {
        const c = getCar(detailId);
        if (c) $("#detailBox").innerHTML = detailHTML(c); else showPage("cars");
      }
    }
  } catch (e) { /* koneksi putus sementara: coba lagi di putaran berikutnya */ }
  finally { polling = false; }
}
setInterval(pollUpdates, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollUpdates(); });

/* ===== INISIALISASI ===== */
function renderAll() {
  renderCars($("#popularGrid"), CARS.filter(c => c.status !== "unavailable").slice(0, 3));
  renderCars($("#carsGrid"), CARS);
  fillCarSelect();
  runSearch(true);
}
async function init() {
  carsError = "";
  renderAll();
  if (!sb) { carsError = "Daftar mobil belum dapat ditampilkan."; renderAll(); showConfigError(); return; }
  try { await loadCars(); carsLoaded = true; }
  catch (e) { carsError = "Gagal memuat daftar mobil. " + errMsg(e); }
  renderAll();
}
if (CFG.ADMIN_URL) { const al = $("#adminLink"); if (al) al.href = CFG.ADMIN_URL; } // alamat admin jika dipasang terpisah
$("#heroImg").src = carSvg("#c9a24a");
showPage("home", false);
init();
