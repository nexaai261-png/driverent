/* =====================================================
   DriveRent Admin (versi Supabase)
   - Login memakai Supabase Auth (akun dibuat di dashboard Supabase).
   - Data pesanan dan mobil ada di database, sama dengan yang dibaca website pelanggan.
   - Aturan perubahan status dijaga juga di server (trigger di schema.sql).
   ===================================================== */
(function () {
  "use strict";

  /* ---------- Koneksi Supabase (isi di ../config.js) ---------- */
  const CFG = window.DR_CONFIG || {};
  const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/^ISI_/.test(CFG.SUPABASE_URL) && !/^ISI_/.test(CFG.SUPABASE_ANON_KEY));
  const sb = (CONFIGURED && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

  /* ---------- Konstanta ---------- */
  // Status internal -> label yang tampil
  const STATUS_LABEL = {
    created: "Pesanan Dibuat", processing: "Sedang Diproses", approved: "Disetujui",
    ongoing: "Sedang Berlangsung", completed: "Selesai", rejected: "Ditolak"
  };
  const FLOW = ["created", "processing", "approved", "ongoing", "completed"];
  const CONFIRMED = ["approved", "ongoing", "completed"]; // dihitung sebagai pendapatan
  const CAR_STATUS = { available: "Tersedia", rented: "Disewa", unavailable: "Tidak Tersedia" };
  const TYPES = ["City Car", "MPV", "SUV", "Sedan"];

  // Aksi yang boleh dilakukan di tiap status (status tidak boleh melompat)
  const ACTIONS = {
    created: [{ to: "processing", label: "Proses Pesanan", cls: "gold" }],
    processing: [{ to: "approved", label: "Setujui Pesanan", cls: "gold" }, { to: "rejected", label: "Tolak Pesanan", cls: "danger-o" }],
    approved: [{ to: "ongoing", label: "Mulai Sewa", cls: "gold" }],
    ongoing: [{ to: "completed", label: "Selesaikan Sewa", cls: "gold" }],
    completed: [],
    rejected: []
  };

  const ADDONS = [
    { id: "shuttle", label: "Antar jemput mobil", cost: 50000, perDay: false },
    { id: "driver", label: "Sopir", cost: 250000, perDay: true },
    { id: "insurance", label: "Asuransi tambahan", cost: 40000, perDay: true }
  ];

  const DEFAULT_CARS = [
    { name: "Toyota Avanza", type: "MPV", seat: 7, price: 350000, trans: "Manual", fuel: "Bensin", color: "#4a6fa5", description: "MPV keluarga yang irit dan lega, cocok untuk perjalanan bersama keluarga." },
    { name: "Honda Brio", type: "City Car", seat: 5, price: 300000, trans: "Otomatis", fuel: "Bensin", color: "#d9822b", description: "City car lincah dan hemat, ideal untuk mobilitas dalam kota." },
    { name: "Toyota Innova", type: "MPV", seat: 7, price: 550000, trans: "Otomatis", fuel: "Diesel", color: "#3d4657", description: "MPV premium dengan kabin nyaman untuk perjalanan jarak jauh." },
    { name: "Honda Civic", type: "Sedan", seat: 5, price: 750000, trans: "Otomatis", fuel: "Bensin", color: "#8b1e2d", description: "Sedan sporty dan elegan untuk acara bisnis maupun perjalanan santai." },
    { name: "Toyota Fortuner", type: "SUV", seat: 7, price: 900000, trans: "Otomatis", fuel: "Diesel", color: "#1d2433", description: "SUV tangguh dengan performa kuat untuk segala medan." }
  ];
  const COLORS = ["#4a6fa5", "#d9822b", "#3d4657", "#8b1e2d", "#1d2433", "#2f7d6b", "#6b4fa0"];

  const TITLES = {
    dashboard: "Dashboard", orders: "Pemesanan", "order-detail": "Detail Pesanan", cars: "Mobil",
    customers: "Pelanggan", status: "Status Peminjaman", reports: "Laporan", settings: "Pengaturan"
  };

  /* ---------- Utilitas ---------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rp = n => "Rp" + Number(n || 0).toLocaleString("id-ID");
  const fmtShort = d => d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const fmtLong = d => d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
  const fmtDateTime = ts => new Date(ts).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const localDate = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const phoneKey = s => { let p = String(s || "").replace(/\D/g, ""); if (p.indexOf("62") === 0) p = "0" + p.slice(2); return p; };
  const intlPhone = s => { const k = phoneKey(s); return k.charAt(0) === "0" ? "62" + k.slice(1) : k; };
  const badge = s => '<span class="st st-' + esc(s) + '">' + esc(STATUS_LABEL[s] || s) + "</span>";
  const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  function errText(e) {
    const m = (e && e.message) || "";
    if (/fetch|network|load failed/i.test(m)) return "Tidak dapat terhubung ke server. Periksa koneksi internet.";
    if (e && (e.code === "42501" || /permission denied|row-level security/i.test(m))) return "Anda tidak punya izin. Silakan login ulang.";
    return m || "Terjadi kesalahan.";
  }

  // Gambar mobil: URL milik admin, atau ilustrasi SVG bawaan
  function carSvg(color) {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f3f5f9'/><stop offset='1' stop-color='#d3d9e5'/></linearGradient></defs><rect width='400' height='200' fill='url(#g)'/><ellipse cx='200' cy='172' rx='150' ry='9' fill='#000' opacity='.15'/><path d='M46 146Q48 114 78 108L118 84Q134 70 160 70H246Q274 72 290 92L324 104Q356 110 356 138V152H46Z' fill='" + color + "'/><path d='M130 92L150 78H196V104H118ZM206 78H246Q262 82 274 104H206Z' fill='#cfe6f7'/><rect x='340' y='120' width='16' height='8' rx='3' fill='#ffe9a8'/><circle cx='118' cy='152' r='25' fill='#151515'/><circle cx='118' cy='152' r='11' fill='#bfc4cc'/><circle cx='288' cy='152' r='25' fill='#151515'/><circle cx='288' cy='152' r='11' fill='#bfc4cc'/></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  window.carSvg = carSvg; // dipakai atribut onerror pada <img>
  const carImage = c => c.img || carSvg(c.color || "#4a6fa5");

  /* ---------- Data dari database (disimpan sebagai cache di memori) ---------- */
  const DB = { bookings: [], cars: [] };
  const bookings = () => DB.bookings;
  const cars = () => DB.cars;
  let lastRaw = "";
  let knownIds = new Set();

  const mapBooking = r => ({
    id: r.id, customerId: r.customer_id, customerName: r.customer_name, phone: r.phone, email: r.email,
    carId: r.car_id, car: r.car, startDate: r.start_date, endDate: r.end_date, duration: r.duration,
    pricePerDay: r.price_per_day, additionalCost: r.additional_cost, total: r.total,
    addons: r.addons || [], addonLabels: r.addon_labels || [], status: r.status,
    history: r.history || [], createdAt: Date.parse(r.created_at)
  });
  const mapCar = r => ({
    id: Number(r.id), name: r.name, type: r.type, seat: r.seat, price: r.price, trans: r.trans,
    fuel: r.fuel, color: r.color, desc: r.description, status: r.status, img: r.img
  });

  // Ambil ulang semua data. Mengembalikan true jika ada yang berubah sejak pengambilan terakhir.
  async function refresh() {
    const res = await Promise.all([
      sb.from("bookings").select("*").order("created_at", { ascending: false }),
      sb.from("cars").select("*").order("id")
    ]);
    if (res[0].error) throw res[0].error;
    if (res[1].error) throw res[1].error;
    const raw = JSON.stringify([res[0].data, res[1].data]);
    const changed = raw !== lastRaw;
    lastRaw = raw;
    DB.bookings = res[0].data.map(mapBooking);
    DB.cars = res[1].data.map(mapCar);
    return changed;
  }
  // Dipanggil setelah admin mengubah data: segarkan data dan tampilan (bukan pesanan baru)
  async function afterChange() {
    try { await refresh(); } catch (e) { toast(esc(errText(e)), "error"); }
    knownIds = new Set(bookings().map(b => b.id));
    renderCurrent();
  }
  // Jalankan aksi async dan tampilkan error bila gagal
  async function guarded(fn) {
    try { return await fn(); } catch (e) { toast(esc(errText(e)), "error"); return false; }
  }

  /* ---------- Toast ---------- */
  function toast(html, type, opt) {
    opt = opt || {};
    const el = document.createElement("div");
    el.className = "toast " + (type || "info") + (opt.onClick ? " click" : "");
    el.innerHTML = html;
    if (opt.onClick) el.addEventListener("click", () => { opt.onClick(); el.remove(); });
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), opt.duration || 4200);
  }

  /* ---------- Modal ---------- */
  function openModal(title, bodyHtml, actions) {
    $("#mTitle").textContent = title;
    $("#mBody").innerHTML = bodyHtml;
    const box = $("#mActions");
    box.innerHTML = "";
    actions.forEach(a => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.cls || "ghost dark");
      b.textContent = a.label;
      b.addEventListener("click", () => { if (a.onClick && a.onClick() === false) return; closeModal(); });
      box.appendChild(b);
    });
    $("#modal").hidden = false;
    document.body.classList.add("modal-open");
    const first = $("#mBody input,#mBody select") || box.querySelector(".gold,.danger") || box.lastChild;
    if (first) first.focus();
  }
  function closeModal() { $("#modal").hidden = true; document.body.classList.remove("modal-open"); }
  function confirmModal(title, message, yesLabel, onYes, danger) {
    openModal(title, "<p>" + esc(message) + "</p>", [
      { label: "Tidak", cls: "ghost dark" },
      { label: yesLabel, cls: danger ? "danger" : "gold", onClick: onYes }
    ]);
  }

  /* ---------- Data contoh (hanya untuk uji coba) ---------- */
  function buildDemo() {
    const now = Date.now(), H = 3600000, D = 86400000;
    const people = {
      stanley: { name: "Stanley", phone: "081234560001", email: "stanley@example.com" },
      rina: { name: "Rina Putri", phone: "081234560002", email: "rina.putri@example.com" },
      budi: { name: "Budi Santoso", phone: "081234560003", email: "budi.santoso@example.com" },
      dewi: { name: "Dewi Lestari", phone: "081234560004", email: "dewi.lestari@example.com" },
      andi: { name: "Andi Pratama", phone: "081234560005", email: "andi.pratama@example.com" },
      maya: { name: "Maya Sari", phone: "081234560006", email: "maya.sari@example.com" }
    };
    function mk(id, who, carName, start, end, days, addonIds, status, createdAt) {
      const p = people[who];
      const live = cars().find(c => c.name === carName);
      const def = DEFAULT_CARS.find(c => c.name === carName);
      const price = live ? live.price : def.price;
      const extra = addonIds.reduce((t, a) => { const x = ADDONS.find(i => i.id === a); return t + x.cost * (x.perDay ? days : 1); }, 0);
      const seq = status === "rejected" ? ["created", "processing", "rejected"] : FLOW.slice(0, FLOW.indexOf(status) + 1);
      return {
        id: id, customer_id: phoneKey(p.phone), customer_name: p.name, phone: p.phone, email: p.email,
        car_id: live ? live.id : null, car: carName, start_date: start, end_date: end, duration: days,
        price_per_day: price, additional_cost: extra, total: price * days + extra,
        addons: addonIds, addon_labels: addonIds.map(a => ADDONS.find(i => i.id === a).label),
        status: status, created_at: new Date(createdAt).toISOString(),
        history: seq.map((s, i) => ({ status: s, at: Math.min(now, createdAt + i * 2 * H) }))
      };
    }
    return [
      mk("DR-4827", "stanley", "Honda Civic", "2026-10-10", "2026-10-26", 16, ["shuttle", "insurance"], "processing", now - 40 * 60000),
      mk("DR-5130", "rina", "Toyota Avanza", localDate(3), localDate(6), 3, [], "created", now - 20 * 60000),
      mk("DR-5131", "budi", "Toyota Fortuner", localDate(5), localDate(9), 4, ["driver"], "created", now - 5 * 60000),
      mk("DR-4790", "dewi", "Toyota Innova", localDate(1), localDate(6), 5, ["shuttle"], "approved", now - D),
      mk("DR-4755", "andi", "Honda Brio", localDate(-2), localDate(2), 4, [], "ongoing", now - 3 * D),
      mk("DR-4701", "maya", "Toyota Avanza", localDate(-14), localDate(-11), 3, ["driver", "insurance"], "completed", now - 16 * D),
      mk("DR-4688", "stanley", "Honda Brio", localDate(-24), localDate(-22), 2, [], "completed", now - 26 * D),
      mk("DR-4650", "budi", "Honda Civic", localDate(-9), localDate(-6), 3, [], "rejected", now - 9 * D)
    ];
  }

  /* ---------- State ---------- */
  let current = "dashboard";
  let currentOrder = null;
  let reportRange = "all";

  /* ---------- Navigasi ---------- */
  function showPage(name, arg) {
    if (name === "order-detail") currentOrder = arg;
    current = name;
    $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
    const navKey = name === "order-detail" ? "orders" : name;
    $$("#sideNav a").forEach(a => a.classList.toggle("active", a.dataset.page === navKey));
    $("#pageTitle").textContent = TITLES[name] || "";
    closeSidebar();
    $("#bellPanel").hidden = true;
    window.scrollTo(0, 0);
    renderCurrent();
  }
  function renderCurrent() {
    updateBadges();
    switch (current) {
      case "dashboard": renderDashboard(); break;
      case "orders": renderOrders(); break;
      case "order-detail": renderDetail(); break;
      case "cars": renderCars(); break;
      case "customers": renderCustomers(); break;
      case "status": renderBoard(); break;
      case "reports": renderReports(); break;
      case "settings": renderSettings(); break;
    }
  }
  function openSidebar() { $("#sidebar").classList.add("open"); $("#overlay").classList.add("show"); }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("show"); }

  /* ---------- Badge sidebar & lonceng ---------- */
  function updateBadges() {
    const fresh = bookings().filter(b => b.status === "created").sort(byNewest);
    const n = fresh.length;
    [$("#badgeOrders"), $("#bellCount")].forEach(el => { el.textContent = n; el.hidden = n === 0; });
    $("#bellPanel").innerHTML = "<h4>Pesanan baru</h4>" + (n ? fresh.slice(0, 5).map(b =>
      '<button class="bitem" data-open="' + esc(b.id) + '">&#128276; Pesanan baru ' + esc(b.id) + "<br>" + esc(b.car) + "<br>" + esc(b.customerName) + "<br><em>Menunggu diproses</em></button>"
    ).join("") : '<div class="empty">Tidak ada pesanan baru.</div>');
  }
  function notifyNew(b) {
    toast("&#128276; <b>Pesanan baru " + esc(b.id) + "</b><br>" + esc(b.car) + "<br>" + esc(b.customerName) + "<br>Menunggu diproses", "info",
      { duration: 8000, onClick: () => showPage("order-detail", b.id) });
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    const all = bookings();
    const cnt = s => all.filter(b => b.status === s).length;
    const rej = cnt("rejected");
    const items = [
      ["Total Pesanan", all.length, rej ? "termasuk " + rej + " ditolak" : "", "", ""],
      ["Pesanan Baru", cnt("created"), "menunggu diproses", "created", "s-created"],
      ["Sedang Diproses", cnt("processing"), "", "processing", "s-processing"],
      ["Disetujui", cnt("approved"), "", "approved", "s-approved"],
      ["Sedang Berlangsung", cnt("ongoing"), "", "ongoing", "s-ongoing"],
      ["Selesai", cnt("completed"), "", "completed", "s-completed"]
    ];
    $("#stats").innerHTML = items.map(i =>
      '<button class="stat ' + i[4] + '" data-stat="' + i[3] + '"><small>' + i[0] + "</small><b>" + i[1] + "</b><em>" + i[2] + "</em></button>").join("");
    const recent = all.slice().sort(byNewest).slice(0, 5);
    $("#recentBody").innerHTML = recent.length ? recent.map(b =>
      "<tr><td><b>" + esc(b.id) + "</b></td><td>" + esc(b.customerName) + "</td><td>" + esc(b.car) + "</td><td>" + fmtShort(b.startDate) +
      "</td><td>" + esc(b.duration) + " hari</td><td>" + rp(b.total) + "</td><td>" + badge(b.status) +
      '</td><td><button class="btn ghost dark sm" data-open="' + esc(b.id) + '">Detail</button></td></tr>').join("")
      : '<tr><td colspan="8" class="empty">Belum ada pesanan. Pesanan dari website pelanggan akan muncul di sini.</td></tr>';
  }

  /* ---------- Daftar pemesanan ---------- */
  function renderOrders() {
    const q = $("#oSearch").value.trim().toLowerCase(), st = $("#oFilter").value, qd = q.replace(/\D/g, "");
    const list = bookings().filter(b => {
      if (st && b.status !== st) return false;
      if (!q) return true;
      return String(b.id).toLowerCase().indexOf(q) > -1 || String(b.customerName).toLowerCase().indexOf(q) > -1 ||
        String(b.phone).toLowerCase().indexOf(q) > -1 || (qd.length > 0 && String(b.phone).replace(/\D/g, "").indexOf(qd) > -1);
    }).sort(byNewest);
    $("#oCount").textContent = list.length + " pesanan ditemukan";
    $("#ordersBody").innerHTML = list.length ? list.map((b, i) =>
      "<tr><td>" + (i + 1) + "</td><td><b>" + esc(b.id) + "</b></td><td>" + esc(b.customerName) + "</td><td>" + esc(b.car) +
      "</td><td>" + fmtShort(b.startDate) + "</td><td>" + fmtShort(b.endDate) + "</td><td>" + rp(b.total) + "</td><td>" + badge(b.status) +
      '</td><td><button class="btn ghost dark sm" data-open="' + esc(b.id) + '">Lihat Detail</button></td></tr>').join("")
      : '<tr><td colspan="9" class="empty">Tidak ada pesanan yang cocok. Ubah kata kunci atau filter status.</td></tr>';
  }

  /* ---------- Detail pesanan ---------- */
  const tli = (cls, mark, label) => '<li class="' + cls + '"><i>' + mark + "</i>" + esc(label) + "</li>";
  function timelineHTML(b) {
    if (b.status === "rejected") {
      return '<ul class="tl">' + tli("done", "&#10003;", "Pesanan Dibuat") + tli("done", "&#10003;", "Sedang Diproses") + tli("rejected", "&#10005;", "Pesanan Ditolak") + "</ul>";
    }
    const idx = FLOW.indexOf(b.status);
    return '<ul class="tl">' + FLOW.map((k, i) => {
      let cls = "todo", mark = "&#9675;";
      if (i < idx || (i === idx && k === "completed")) { cls = "done"; mark = "&#10003;"; }
      else if (i === idx) { cls = "active"; mark = "&#10003;"; }
      return tli(cls, mark, STATUS_LABEL[k]);
    }).join("") + "</ul>";
  }
  function actionsHTML(b) {
    if (b.status === "completed") return '<div class="done-msg">Pesanan Selesai &#10003;</div>';
    if (b.status === "rejected") return '<div class="done-msg bad">Pesanan Ditolak</div>';
    return (ACTIONS[b.status] || []).map(a =>
      '<button class="btn ' + a.cls + '" data-act="status" data-id="' + esc(b.id) + '" data-to="' + a.to + '">' + a.label + "</button>").join("");
  }
  function renderDetail() {
    const b = bookings().find(x => x.id === currentOrder);
    const box = $("#detailBox");
    if (!b) { box.innerHTML = '<div class="card empty">Pesanan tidak ditemukan. Kembali ke daftar pemesanan.</div>'; return; }
    const extras = (b.addonLabels && b.addonLabels.length) ? b.addonLabels.join(", ") : "Tidak ada";
    const hist = (b.history || []).slice().reverse().map(h => "<li><b>" + esc(STATUS_LABEL[h.status] || h.status) + "</b><span>" + fmtDateTime(h.at) + "</span></li>").join("");
    box.innerHTML =
      '<div class="detail-grid"><div class="card pad">' +
      '<div class="d-head"><div><small class="muted">Nomor Pesanan</small><h2>' + esc(b.id) + "</h2></div>" + badge(b.status) + "</div>" +
      "<h3>Data Pelanggan</h3><dl class=\"dl\"><dt>Nama</dt><dd>" + esc(b.customerName) + "</dd><dt>Nomor HP</dt><dd>" + esc(b.phone) +
      ' <a class="wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(intlPhone(b.phone)) + '">WhatsApp</a></dd><dt>Email</dt><dd>' + esc(b.email || "-") + "</dd></dl>" +
      "<h3>Data Rental</h3><dl class=\"dl\"><dt>Mobil</dt><dd>" + esc(b.car) + "</dd><dt>Tanggal Mulai</dt><dd>" + fmtLong(b.startDate) +
      "</dd><dt>Tanggal Selesai</dt><dd>" + fmtLong(b.endDate) + "</dd><dt>Lama Sewa</dt><dd>" + esc(b.duration) + " hari</dd><dt>Harga per hari</dt><dd>" + rp(b.pricePerDay) +
      "</dd><dt>Layanan tambahan</dt><dd>" + esc(extras) + "</dd><dt>Biaya tambahan</dt><dd>" + rp(b.additionalCost) + '</dd><dt>Total</dt><dd class="total">' + rp(b.total) + "</dd></dl>" +
      "</div><div class=\"card pad\"><h3>Status Pesanan</h3>" + timelineHTML(b) + '<div class="actions">' + actionsHTML(b) + "</div>" +
      "<h3>Riwayat</h3><ul class=\"hist\">" + (hist || "<li>Belum ada riwayat.</li>") + "</ul></div></div>";
  }

  /* ---------- Perubahan status (fitur utama) ---------- */
  function askChange(id, to) {
    const reject = to === "rejected";
    confirmModal(
      "Konfirmasi Perubahan Status",
      reject ? "Apakah Anda yakin ingin menolak pesanan " + id + '? Pelanggan akan melihat status "Ditolak" dan tindakan ini tidak dapat dibatalkan.'
        : "Apakah Anda yakin ingin mengubah status " + id + ' menjadi "' + STATUS_LABEL[to] + '"?',
      reject ? "Ya, Tolak Pesanan" : "Ya, Ubah Status",
      () => { changeStatus(id, to); }, reject);
  }
  function changeStatus(id, to) {
    return guarded(async () => {
      const b = bookings().find(x => x.id === id);
      if (!b) { toast("Pesanan tidak ditemukan.", "error"); return false; }
      // Hanya transisi berurutan yang diizinkan (server juga memeriksa)
      if (!(ACTIONS[b.status] || []).some(a => a.to === to)) {
        toast("Perubahan tidak valid. Status saat ini: " + esc(STATUS_LABEL[b.status]) + ".", "error");
        renderCurrent();
        return false;
      }
      // .eq("status", b.status): jika admin lain sudah mengubahnya lebih dulu, tidak ada baris yang berubah
      const res = await sb.from("bookings").update({ status: to }).eq("id", id).eq("status", b.status).select("id");
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) {
        toast("Status pesanan ini sudah berubah di tempat lain. Data diperbarui.", "error");
        await afterChange();
        return false;
      }
      toast("<b>" + esc(id) + "</b> kini berstatus " + esc(STATUS_LABEL[to]) + ".", "success");
      await afterChange();
      return true;
    });
  }

  /* ---------- Mobil ---------- */
  function renderCars() {
    const list = cars();
    $("#adminCars").innerHTML = list.length ? list.map(c => {
      const opts = Object.keys(CAR_STATUS).map(k => '<option value="' + k + '"' + (c.status === k ? " selected" : "") + ">" + CAR_STATUS[k] + "</option>").join("");
      return '<article class="card acar"><div class="imgbox"><img src="' + esc(carImage(c)) + '" alt="' + esc(c.name) + '" onerror="this.onerror=null;this.src=carSvg(\'#4a6fa5\')">' +
        '<span class="st cs-' + esc(c.status) + '">' + esc(CAR_STATUS[c.status] || c.status) + "</span></div>" +
        '<div class="body"><h3>' + esc(c.name) + '</h3><p class="muted">' + esc(c.type) + " &bull; " + esc(c.seat) + ' orang</p><div class="price">' + rp(c.price) + "<small>/hari</small></div>" +
        '<div class="field"><label for="cs' + c.id + '">Status mobil</label><select id="cs' + c.id + '" data-car-status="' + c.id + '">' + opts + "</select></div>" +
        '<div class="row"><button class="btn ghost dark sm" data-act="car-edit" data-id="' + c.id + '">Edit</button><button class="btn danger-o sm" data-act="car-del" data-id="' + c.id + '">Hapus</button></div></div></article>';
    }).join("") : '<div class="card empty" style="grid-column:1/-1">Belum ada mobil. Klik "Tambah Mobil" untuk menambahkan.</div>';
  }
  function setCarStatus(id, status) {
    const c = cars().find(x => x.id === Number(id));
    if (!c || !CAR_STATUS[status]) return;
    guarded(async () => {
      const res = await sb.from("cars").update({ status: status }).eq("id", c.id);
      if (res.error) throw res.error;
      toast(esc(c.name) + " sekarang " + esc(CAR_STATUS[status]) + ".", "success");
      await afterChange();
    }).then(ok => { if (ok === false) afterChange(); });
  }
  function saveCar(c, d) {
    return guarded(async () => {
      const row = { name: d.name, type: d.type, seat: d.seat, price: d.price, trans: d.trans, fuel: d.fuel, status: d.status, img: d.img, description: d.desc };
      let res;
      if (c) res = await sb.from("cars").update(row).eq("id", c.id);
      else { row.color = COLORS[cars().length % COLORS.length]; res = await sb.from("cars").insert(row); }
      if (res.error) throw res.error;
      toast(esc(d.name) + (c ? " berhasil diperbarui." : " berhasil ditambahkan."), "success");
      await afterChange();
    });
  }
  function carForm(id) {
    const c = id ? cars().find(x => x.id === Number(id)) : null;
    const v = c || { name: "", type: "MPV", seat: 5, price: "", trans: "Manual", fuel: "Bensin", status: "available", img: "", desc: "" };
    const sel = (opts, cur) => opts.map(o => '<option' + (o === cur ? " selected" : "") + ">" + o + "</option>").join("");
    const stOpts = Object.keys(CAR_STATUS).map(k => '<option value="' + k + '"' + (v.status === k ? " selected" : "") + ">" + CAR_STATUS[k] + "</option>").join("");
    const html = '<form id="carForm" novalidate>' +
      '<div class="field"><label for="cf_name">Nama mobil</label><input id="cf_name" maxlength="80" value="' + esc(v.name) + '"><small class="err"></small></div>' +
      '<div class="two"><div class="field"><label for="cf_type">Jenis</label><select id="cf_type">' + sel(TYPES, v.type) + '</select></div>' +
      '<div class="field"><label for="cf_seat">Kapasitas (orang)</label><input id="cf_seat" type="number" min="1" max="20" value="' + esc(v.seat) + '"><small class="err"></small></div></div>' +
      '<div class="two"><div class="field"><label for="cf_price">Harga per hari (Rp)</label><input id="cf_price" type="number" min="1" value="' + esc(v.price) + '"><small class="err"></small></div>' +
      '<div class="field"><label for="cf_status">Status</label><select id="cf_status">' + stOpts + "</select></div></div>" +
      '<div class="two"><div class="field"><label for="cf_trans">Transmisi</label><select id="cf_trans">' + sel(["Manual", "Otomatis"], v.trans) + "</select></div>" +
      '<div class="field"><label for="cf_fuel">Bahan bakar</label><select id="cf_fuel">' + sel(["Bensin", "Diesel", "Hybrid", "Listrik"], v.fuel) + "</select></div></div>" +
      '<div class="field"><label for="cf_img">URL foto (opsional)</label><input id="cf_img" placeholder="https://..." value="' + esc(v.img) + '"><small class="err"></small></div>' +
      '<div class="field"><label for="cf_desc">Deskripsi</label><textarea id="cf_desc">' + esc(v.desc) + "</textarea></div></form>";
    const setErr = (el, msg) => { el.classList.toggle("bad", !!msg); const s = el.parentElement.querySelector(".err"); if (s) s.textContent = msg || ""; return !msg; };
    function submit() {
      const name = $("#cf_name").value.trim(), seat = Number($("#cf_seat").value), price = Number($("#cf_price").value), img = $("#cf_img").value.trim();
      const ok = [
        setErr($("#cf_name"), name.length < 3 || name.length > 80 ? "Nama mobil 3 sampai 80 karakter." : ""),
        setErr($("#cf_seat"), Number.isInteger(seat) && seat >= 1 && seat <= 20 ? "" : "Kapasitas harus 1 sampai 20 orang."),
        setErr($("#cf_price"), Number.isInteger(price) && price > 0 ? "" : "Harga harus bilangan bulat lebih dari 0."),
        setErr($("#cf_img"), !img || /^https?:\/\//i.test(img) ? "" : "URL harus diawali http:// atau https://.")
      ].every(Boolean);
      if (!ok) return false;
      saveCar(c, { name: name, type: $("#cf_type").value, seat: seat, price: price, trans: $("#cf_trans").value, fuel: $("#cf_fuel").value, status: $("#cf_status").value, img: img, desc: $("#cf_desc").value.trim() || "Mobil terawat siap disewa." });
      return true;
    }
    openModal(c ? "Edit Mobil" : "Tambah Mobil", html, [
      { label: "Batal", cls: "ghost dark" },
      { label: "Simpan", cls: "gold", onClick: () => submit() }
    ]);
    $("#carForm").addEventListener("submit", e => { e.preventDefault(); const b = $("#mActions .gold"); if (b) b.click(); });
  }
  function deleteCar(id) {
    const c = cars().find(x => x.id === Number(id));
    if (!c) return;
    const active = bookings().filter(b => b.carId === c.id && ["created", "processing", "approved", "ongoing"].indexOf(b.status) > -1).length;
    const msg = "Hapus " + c.name + "? Mobil akan hilang dari website pelanggan. Riwayat pesanan tetap tersimpan." + (active ? " Masih ada " + active + " pesanan aktif untuk mobil ini." : "");
    confirmModal("Hapus Mobil", msg, "Ya, Hapus", () => {
      guarded(async () => {
        const res = await sb.from("cars").delete().eq("id", c.id);
        if (res.error) throw res.error;
        toast(esc(c.name) + " dihapus.", "success");
        await afterChange();
      });
    }, true);
  }

  /* ---------- Pelanggan (dikelompokkan dari data pesanan, berdasarkan nomor HP) ---------- */
  function buildCustomers() {
    const map = {}, order = [];
    bookings().slice().sort(byNewest).forEach(b => {
      const k = b.customerId || phoneKey(b.phone);
      if (!map[k]) { map[k] = { id: k, name: b.customerName, phone: b.phone, email: b.email, count: 0, last: b }; order.push(k); }
      map[k].count++;
    });
    return order.map(k => map[k]);
  }
  function renderCustomers() {
    const list = buildCustomers();
    $("#customersBody").innerHTML = list.length ? list.map(c =>
      "<tr><td><b>" + esc(c.name) + "</b></td><td>" + esc(c.phone) + "</td><td>" + esc(c.email || "-") + "</td><td>" + c.count +
      '</td><td><a class="wa" style="margin:0;cursor:pointer" data-open="' + esc(c.last.id) + '">' + esc(c.last.id) + "</a> (" + fmtShort(c.last.startDate) + ")</td><td>" + badge(c.last.status) + "</td></tr>").join("")
      : '<tr><td colspan="6" class="empty">Belum ada pelanggan. Pelanggan muncul setelah membuat pemesanan.</td></tr>';
  }

  /* ---------- Papan status peminjaman ---------- */
  function renderBoard() {
    const all = bookings().slice().sort(byNewest);
    const cols = FLOW.concat(["rejected"]);
    $("#board").innerHTML = cols.map(s => {
      const items = all.filter(b => b.status === s);
      return '<div class="col"><h3>' + esc(STATUS_LABEL[s]) + '<span class="count">' + items.length + "</span></h3>" + (items.length ? items.map(b => {
        const main = (ACTIONS[b.status] || [])[0];
        return '<div class="kcard"><b>' + esc(b.id) + "</b><small>" + esc(b.customerName) + "</small><small>" + esc(b.car) + "</small><small>" + fmtShort(b.startDate) + " - " + fmtShort(b.endDate) + "</small>" +
          '<div class="row"><button class="btn ghost dark sm" data-open="' + esc(b.id) + '">Detail</button>' +
          (main ? '<button class="btn gold sm" data-act="status" data-id="' + esc(b.id) + '" data-to="' + main.to + '">' + main.label + "</button>" : "") + "</div></div>";
      }).join("") : '<div class="empty">Tidak ada pesanan</div>') + "</div>";
    }).join("");
  }

  /* ---------- Laporan ---------- */
  function inRange(ts, range) {
    if (range === "all") return true;
    const n = new Date(), start = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    if (range === "today") return ts >= start.getTime();
    if (range === "week") { start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return ts >= start.getTime(); } // minggu mulai Senin
    if (range === "month") { const d = new Date(ts); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }
    return true;
  }
  const RANGE_LABEL = { today: "Hari ini", week: "Minggu ini", month: "Bulan ini", all: "Semua periode" };
  function renderReports() {
    $$("#rangeBtns [data-range]").forEach(b => b.classList.toggle("on", b.dataset.range === reportRange));
    const list = bookings().filter(b => inRange(b.createdAt || 0, reportRange)).sort(byNewest);
    const conf = list.filter(b => CONFIRMED.indexOf(b.status) > -1);
    const revenue = conf.reduce((t, b) => t + Number(b.total || 0), 0);
    const rented = new Set(conf.map(b => b.carId || b.car)).size;
    const custs = new Set(list.map(b => b.customerId || phoneKey(b.phone))).size;
    const cards = [["Total pemesanan", list.length], ["Total pendapatan", rp(revenue)], ["Jumlah mobil disewa", rented], ["Jumlah pelanggan", custs]];
    $("#reportStats").innerHTML = cards.map(c => '<div class="stat static"><small>' + c[0] + "</small><b>" + c[1] + "</b><em></em></div>").join("");
    $("#reportNote").textContent = "Pendapatan dan jumlah mobil disewa dihitung dari pesanan berstatus Disetujui, Sedang Berlangsung, dan Selesai.";
    $("#printHead").textContent = "Laporan DriveRent - " + RANGE_LABEL[reportRange] + " (dicetak " + fmtDateTime(Date.now()) + ")";
    $("#reportBody").innerHTML = list.length ? list.map((b, i) =>
      "<tr><td>" + (i + 1) + "</td><td><b>" + esc(b.id) + "</b></td><td>" + (b.createdAt ? fmtDateTime(b.createdAt) : "-") + "</td><td>" + esc(b.customerName) +
      "</td><td>" + esc(b.car) + "</td><td>" + esc(b.duration) + " hari</td><td>" + rp(b.total) + "</td><td>" + badge(b.status) + "</td></tr>").join("")
      : '<tr><td colspan="8" class="empty">Tidak ada transaksi pada periode ini. Pilih periode lain.</td></tr>';
  }

  /* ---------- Pengaturan ---------- */
  function renderSettings() {
    $("#dataInfo").textContent = "Saat ini tersimpan " + bookings().length + " pesanan dan " + cars().length + " mobil di database.";
  }
  function deleteAllBookings() {
    return sb.from("bookings").delete().neq("id", "");
  }
  function settingAction(what) {
    if (what === "demo") {
      confirmModal("Muat data contoh", "Semua pesanan saat ini akan DIHAPUS dan diganti dengan data contoh. Lanjutkan?", "Ya, Muat Data", () => {
        guarded(async () => {
          let r = await deleteAllBookings(); if (r.error) throw r.error;
          r = await sb.from("bookings").insert(buildDemo()); if (r.error) throw r.error;
          toast("Data contoh dimuat.", "success"); await afterChange();
        });
      }, true);
    } else if (what === "clear") {
      confirmModal("Hapus semua pesanan", "Semua pesanan akan dihapus permanen. Data mobil tetap ada. Lanjutkan?", "Ya, Hapus", () => {
        guarded(async () => {
          const r = await deleteAllBookings(); if (r.error) throw r.error;
          toast("Semua pesanan dihapus.", "success"); await afterChange();
        });
      }, true);
    } else if (what === "reset") {
      confirmModal("Reset semua data", "Semua pesanan DAN data mobil akan dihapus, lalu mobil dikembalikan ke 5 mobil awal. Lanjutkan?", "Ya, Reset", () => {
        guarded(async () => {
          let r = await deleteAllBookings(); if (r.error) throw r.error;
          r = await sb.from("cars").delete().gt("id", 0); if (r.error) throw r.error;
          r = await sb.from("cars").insert(DEFAULT_CARS); if (r.error) throw r.error;
          toast("Data dikembalikan ke kondisi awal.", "success"); await afterChange();
        });
      }, true);
    }
  }

  /* ---------- Auto update (cek database berkala) ---------- */
  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const before = knownIds;
      const changed = await refresh();
      if (!changed) return;
      const bs = bookings();
      bs.filter(b => !before.has(b.id) && b.status === "created").forEach(notifyNew);
      knownIds = new Set(bs.map(b => b.id));
      renderCurrent();
    } catch (e) { /* koneksi putus sementara: coba lagi di putaran berikutnya */ }
    finally { polling = false; }
  }

  /* ---------- Event ---------- */
  document.addEventListener("click", e => {
    const t = e.target;
    let el = t.closest("[data-open]");
    if (el) { showPage("order-detail", el.dataset.open); return; }
    el = t.closest("[data-act]");
    if (el) {
      const a = el.dataset.act;
      if (a === "status") askChange(el.dataset.id, el.dataset.to);
      else if (a === "car-add") carForm(null);
      else if (a === "car-edit") carForm(el.dataset.id);
      else if (a === "car-del") deleteCar(el.dataset.id);
      else if (a === "range") { reportRange = el.dataset.range; renderReports(); }
      else if (a === "print") window.print();
      else if (a === "setting") settingAction(el.dataset.do);
      return;
    }
    el = t.closest("[data-stat]");
    if (el) { $("#oFilter").value = el.dataset.stat; $("#oSearch").value = ""; showPage("orders"); return; }
    el = t.closest("[data-page]");
    if (el) { showPage(el.dataset.page); return; }
    if (!t.closest(".bellwrap")) $("#bellPanel").hidden = true;
  });
  document.addEventListener("change", e => {
    const s = e.target.closest("[data-car-status]");
    if (s) setCarStatus(s.dataset.carStatus, s.value);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  $("#oSearch").addEventListener("input", renderOrders);
  $("#oFilter").addEventListener("change", renderOrders);
  $("#burger").addEventListener("click", openSidebar);
  $("#overlay").addEventListener("click", closeSidebar);
  $("#bell").addEventListener("click", () => { $("#bellPanel").hidden = !$("#bellPanel").hidden; });
  $("#btnLogout").addEventListener("click", async () => {
    try { await sb.auth.signOut(); } catch (e) { /* tetap keluar */ }
    location.replace("admin-login.html");
  });

  /* ---------- Mulai ---------- */
  async function start() {
    if (CFG.SITE_URL) $("#siteLink").href = CFG.SITE_URL; // alamat website pelanggan jika dipasang terpisah
    if (!sb) {
      document.body.classList.add("ready");
      $("main").innerHTML = '<div class="card pad"><h2>Belum terhubung ke database</h2><p class="muted">Isi <b>SUPABASE_URL</b> dan <b>SUPABASE_ANON_KEY</b> di file <b>config.js</b> (di folder utama), lalu muat ulang halaman ini.</p></div>';
      return;
    }
    // Wajib login: tanpa sesi, kembali ke halaman login
    const s = await sb.auth.getSession();
    if (!s.data || !s.data.session) { location.replace("admin-login.html"); return; }
    $("#adminEmail").textContent = s.data.session.user.email || "";
    sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") location.replace("admin-login.html"); });
    try { await refresh(); } catch (e) { toast(esc(errText(e)), "error", { duration: 8000 }); }
    knownIds = new Set(bookings().map(b => b.id));
    document.body.classList.add("ready");
    showPage("dashboard");
    const waiting = bookings().filter(b => b.status === "created").length;
    if (waiting) toast("&#128276; " + waiting + " pesanan baru menunggu diproses", "info", { duration: 6000, onClick: () => { $("#oFilter").value = "created"; showPage("orders"); } });
    setInterval(poll, 4000);
  }
  start();
})();
