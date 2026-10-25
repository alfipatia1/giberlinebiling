// Pendaftaran Fungsi Global agar selalu bisa dipanggil oleh tombol HTML
window.openEditSales = function(id, agentId, voucherId, qty, agentName, voucherName) {
    document.getElementById('editSaleId').value = id;
    document.getElementById('editSaleAgentId').value = agentId;
    document.getElementById('editSaleVoucherId').value = voucherId;
    document.getElementById('editSaleOldQty').value = qty;
    
    document.getElementById('editSaleAgentName').value = agentName;
    document.getElementById('editSaleVoucherName').value = voucherName;
    document.getElementById('editSaleJumlah').value = qty;
    
    openModal('editSalesModal');
};

window.updateSales = async function() {
    try {
        const id = document.getElementById('editSaleId').value;
        const agentId = document.getElementById('editSaleAgentId').value;
        const voucherId = document.getElementById('editSaleVoucherId').value;
        const oldQty = Number(document.getElementById('editSaleOldQty').value);
        const newQty = Number(document.getElementById('editSaleJumlah').value);

        if (newQty <= 0) { toast('Kuantitas terjual harus lebih dari 0!'); return; }

        const { data: vData, error: vErr } = await supabaseClient.from('vouchers').select('*').eq('id', voucherId).single();
        if (vErr || !vData) throw new Error("Gagal memuat harga voucher master.");

        const selisih = newQty - oldQty;

        const { data: stxData } = await supabaseClient.from('stock').select('*').eq('agent_id', agentId).eq('voucher_id', voucherId).maybeSingle();
        let currentStock = stxData ? Number(stxData.jumlah || 0) : 0;
        
        if (selisih > 0 && currentStock < selisih) {
            throw new Error(`Stok warung tidak mencukupi! Sisa stok saat ini hanya: ${currentStock} Pcs.`);
        }

        const totalOmzet = Number(vData.harga) * newQty;
        const totalDist = Number(vData.distributor) * newQty;
        const totalRes = Number(vData.reseller) * newQty;
        const totalAgen = Number(vData.agen) * newQty;

        const { error: updErr } = await supabaseClient.from('sales').update({
            jumlah: newQty, total: totalOmzet, distributor: totalDist, reseller: totalRes, agen: totalAgen
        }).eq('id', id);
        
        if (updErr) throw new Error(updErr.message);

        const newStock = currentStock - selisih;
        if (stxData) {
            await supabaseClient.from('stock').update({ jumlah: newStock, updated: new Date().toISOString() }).eq('id', stxData.id);
        }

        closeModal('editSalesModal');
        toast('Data penjualan berhasil diperbarui! Stok otomatis disesuaikan.');
        
        await loadSales();
        await loadStock();
        await loadDashboard();
    } catch (err) {
        toast(err.message);
    }
};

window.deleteSales = async function(id, agentId, voucherId, qty) {
    const konfirmasi = confirm(`Yakin ingin menghapus penjualan ini?\n\nSebanyak ${qty} Pcs voucher akan langsung DIKEMBALIKAN ke stok warung.`);
    if (!konfirmasi) return;

    try {
        const { error: delErr } = await supabaseClient.from('sales').delete().eq('id', id);
        if (delErr) throw new Error(delErr.message);

        const { data: stxData } = await supabaseClient.from('stock').select('*').eq('agent_id', agentId).eq('voucher_id', voucherId).maybeSingle();
        
        if (stxData) {
            await supabaseClient.from('stock').update({ jumlah: Number(stxData.jumlah || 0) + qty, updated: new Date().toISOString() }).eq('id', stxData.id);
        } else {
            await supabaseClient.from('stock').insert([{
                agent_id: agentId, voucher_id: voucherId, jumlah: qty, updated: new Date().toISOString()
            }]);
        }

        toast('Penjualan dihapus. Stok berhasil dikembalikan.');
        await loadSales();
        await loadStock();
        await loadDashboard();
    } catch (err) {
        toast(err.message);
    }
};

// Variabel Pagination Piutang Pelanggan
let piutangCustomerData = [];
let filteredPiutangCustomerData = [];
let currentPiutangCustomerPage = 1;
const piutangCustomerItemsPerPage = 10;

// Fungsi Render Tabel dengan Pagination
window.renderPiutangCustomerTable = function() {
  const bodyCust = document.getElementById('piutangCustomerBody');
  const paginationContainer = document.getElementById('piutangCustomerPagination');
  if (!bodyCust) return;

  const totalItems = filteredPiutangCustomerData.length;
  const totalPages = Math.ceil(totalItems / piutangCustomerItemsPerPage);

  if (currentPiutangCustomerPage > totalPages && totalPages > 0) currentPiutangCustomerPage = totalPages;

  const startIndex = (currentPiutangCustomerPage - 1) * piutangCustomerItemsPerPage;
  const endIndex = startIndex + piutangCustomerItemsPerPage;
  const currentData = filteredPiutangCustomerData.slice(startIndex, endIndex);
  const period = getCurrentBillingPeriod();

  if (currentData.length > 0) {
    bodyCust.innerHTML = currentData.map(r => `
      <tr data-search="${esc((r.nama + ' ' + r.jenis + ' ' + r.kontak).toLowerCase())}">
        <td style="font-weight:800;">${esc(r.nama)}</td>
        <td>${esc(r.jenis)}</td>
        <td>${rupiah(r.harga)}</td>
        <td>${rupiah(r.paid)}</td>
        <td style="font-weight:900;color:#dc2626;">${rupiah(r.sisa)}</td>
        <td>Tgl ${esc(r.tempo)}</td>
        <td><span style="background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:900;">BELUM LUNAS</span></td>
        <td style="text-align:right;"><button class="btn btn-success" style="padding:5px 10px;font-size:11px;" onclick="openCustomerPayModal('${r.id}','${esc(r.nama)}',${r.sisa})">💰 Bayar</button></td>
      </tr>`).join('');
  } else {
    bodyCust.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#16a34a;font-weight:800;">🎉 Tidak ada pelanggan yang memiliki piutang pada ${period}.</td></tr>`;
  }

  // Render Tombol Pagination
  if (paginationContainer) {
    if (totalPages > 1) {
      let btnHtml = `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changePiutangCustomerPage(${currentPiutangCustomerPage - 1})" ${currentPiutangCustomerPage === 1 ? 'disabled' : ''}>&laquo; Prev</button>`;
      
      for (let i = 1; i <= totalPages; i++) {
        if (i === currentPiutangCustomerPage) {
          btnHtml += `<button class="btn btn-primary" style="padding:5px 10px;font-size:12px;" disabled>${i}</button>`;
        } else {
          btnHtml += `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changePiutangCustomerPage(${i})">${i}</button>`;
        }
      }

      btnHtml += `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changePiutangCustomerPage(${currentPiutangCustomerPage + 1})" ${currentPiutangCustomerPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
      
      paginationContainer.innerHTML = btnHtml;
      paginationContainer.style.display = 'flex';
    } else {
      paginationContainer.innerHTML = '';
      paginationContainer.style.display = 'none';
    }
  }
};

window.changePiutangCustomerPage = function(page) {
  currentPiutangCustomerPage = page;
  renderPiutangCustomerTable();
};

window.filterPiutangCustomer = function() {
  const q = (document.getElementById('searchPiutangCustomer')?.value || '').toLowerCase();
  filteredPiutangCustomerData = piutangCustomerData.filter(r => {
    const searchStr = (r.nama + ' ' + r.jenis + ' ' + r.kontak).toLowerCase();
    return searchStr.includes(q);
  });
  currentPiutangCustomerPage = 1; // Kembali ke halaman 1 saat mencari
  renderPiutangCustomerTable();
};

// ==========================================
// VARIABEL & FUNGSI PAGINATION PELANGGAN
// ==========================================
let customerDataArray = [];
let filteredCustomerData = [];
let currentCustomerPage = 1;
const customersPerPage = 10;

window.renderCustomerTable = function() {
  const tbody = document.getElementById('customerTableBody');
  const paginationContainer = document.getElementById('customerPagination');
  if (!tbody) return;

  const totalItems = filteredCustomerData.length;
  const totalPages = Math.ceil(totalItems / customersPerPage);

  if (currentCustomerPage > totalPages && totalPages > 0) currentCustomerPage = totalPages;

  const startIndex = (currentCustomerPage - 1) * customersPerPage;
  const endIndex = startIndex + customersPerPage;
  const currentData = filteredCustomerData.slice(startIndex, endIndex);

  if (currentData.length > 0) {
    tbody.innerHTML = currentData.map(c => {
      return `<tr style="background:white;transition:background .2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
        <td style="padding:12px 18px;font-weight:800;color:#0f172a;">👤 ${esc(c.nama)}</td>
        <td style="padding:12px 18px;"><span style="padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;${c.badgeStyle}">${c.icon} ${esc(c.jenis)}</span></td>
        <td style="padding:12px 18px;font-weight:900;color:#16a34a;">${rupiah(c.harga)}</td>
        <td style="padding:12px 18px;font-weight:700;color:#475569;">${rupiah(c.paid)}</td>
        <td style="padding:12px 18px;font-weight:900;color:${c.lunas ? '#16a34a' : '#dc2626'};">${rupiah(c.sisa)}</td>
        <td style="padding:12px 18px;font-weight:700;color:#475569;">Tgl ${esc(c.tempo)}</td>
        <td style="padding:12px 18px;">${c.statusBadge}</td>
        <td style="padding:12px 18px;text-align:right;white-space:nowrap;">
          ${c.detailBtn}
          ${c.editBtn}
          ${c.payBtn}
          <button class="btn btn-danger" style="padding:5px 10px;font-size:11px;" onclick="deleteData('customer','${c.id}','${esc(c.nama)}')">🗑️ Hapus</button>
        </td>
      </tr>`;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan='8' style='text-align:center;padding:20px;color:#64748b;'>Belum ada data pelanggan atau tidak ditemukan.</td></tr>`;
  }

  // Render Tombol Pagination
  if (paginationContainer) {
    if (totalPages > 1) {
      let btnHtml = `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changeCustomerPage(${currentCustomerPage - 1})" ${currentCustomerPage === 1 ? 'disabled' : ''}>&laquo; Prev</button>`;
      
      for (let i = 1; i <= totalPages; i++) {
        if (i === currentCustomerPage) {
          btnHtml += `<button class="btn btn-primary" style="padding:5px 10px;font-size:12px;" disabled>${i}</button>`;
        } else {
          btnHtml += `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changeCustomerPage(${i})">${i}</button>`;
        }
      }

      btnHtml += `<button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="changeCustomerPage(${currentCustomerPage + 1})" ${currentCustomerPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
      
      paginationContainer.innerHTML = btnHtml;
      paginationContainer.style.display = 'flex';
    } else {
      paginationContainer.innerHTML = '';
      paginationContainer.style.display = 'none';
    }
  }
};

window.changeCustomerPage = function(page) {
  currentCustomerPage = page;
  renderCustomerTable();
};

  function updateHarga() {
    const selectElement = document.getElementById('custJenis');
    const hargaInput = document.getElementById('custHarga');
    
    // Mengambil nilai atribut data-price dari opsi yang sedang dipilih
    const selectedPrice = selectElement.options[selectElement.selectedIndex].getAttribute('data-price');
    
    // Memasukkan harga ke kolom input Tarif per Bulan
    if(selectedPrice) {
      hargaInput.value = selectedPrice;
    }
  }

  // Opsi Tambahan: Panggil fungsi updateHarga saat modal atau halaman dimuat 
  // agar harga default (Star 10 Mbps) langsung terisi otomatis sejak awal
  document.addEventListener("DOMContentLoaded", function() {
    updateHarga();
  });

function updateEditHarga() {
    const selectElement = document.getElementById('editCustJenis');
    const hargaInput = document.getElementById('editCustHarga');
    
    // Mengambil nilai atribut data-price dari opsi yang sedang dipilih
    const selectedPrice = selectElement.options[selectElement.selectedIndex].getAttribute('data-price');
    
    // Memasukkan harga ke kolom input Tarif per Bulan
    if(selectedPrice) {
      hargaInput.value = selectedPrice;
    }
  }

(function() {
  function jalankanJam() {
    var now = new Date();
    
    // Format Tanggal & Jam
    var dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    
    // Ambil nama admin
    var currentUser = localStorage.getItem("billing_admin_user") || "Admin";
    
    // Eksekusi ke HTML
    var greetEl = document.getElementById('adminGreeting');
    if (greetEl) greetEl.innerHTML = "Halo, <span>" + currentUser + "</span>! 👋";
    
    var clockEl = document.getElementById('realtimeClock');
    if (clockEl) clockEl.innerHTML = "🕒 " + dateStr + "<br/>⏳ " + timeStr + " WIB";
    
    var mobileClockEl = document.getElementById('mobileRealtimeClock');
    if (mobileClockEl) mobileClockEl.innerHTML = "Halo, " + currentUser + "! | 🕒 " + timeStr;
  }

  // Jalankan langsung sekali, lalu ulangi setiap 1 detik
  jalankanJam();
  setInterval(jalankanJam, 1000);
})();

// ==========================================
// FITUR MODE SIANG/MALAM (DARK MODE)
// ==========================================
function toggleTheme() {
  const body = document.body;
  const btn = document.getElementById('themeToggle');
  
  // Toggle class dark-mode pada body
  body.classList.toggle('dark-mode');
  
  // Simpan preferensi dan ubah ikon
  if (body.classList.contains('dark-mode')) {
    localStorage.setItem('giberline_theme', 'dark');
    if(btn) btn.innerHTML = '☀️'; // Ikon matahari untuk kembali ke mode terang
  } else {
    localStorage.setItem('giberline_theme', 'light');
    if(btn) btn.innerHTML = '🌙'; // Ikon bulan untuk beralih ke mode gelap
  }
}

// Cek preferensi tema saat halaman pertama kali dimuat
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('giberline_theme');
  const btn = document.getElementById('themeToggle');
  
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    if(btn) btn.innerHTML = '☀️';
  }
});

(function(){
  function toNum(v){ return Math.max(0, Number(v || 0)); }

  async function hitungWajibSetorTambahan(){
    try {
      const sales = await api('sales') || [];
      const payments = await api('payments') || [];
      const distributorPayments = await api('distributorPayments') || [];

      let omzet = 0;
      let keuntunganWarung = 0;
      let keuntunganReseller = 0;
      let setoranWarung = 0;
      let setoranDistributor = 0;

      sales.forEach(s => {
        omzet += toNum(s.total || s.TOTAL);
        keuntunganWarung += toNum(s.agen || s.AGEN);
        keuntunganReseller += toNum(s.reseller || s.RESELLER);
      });

      payments.forEach(p => {
        setoranWarung += toNum(p.jumlah || p.JUMLAH);
      });

      distributorPayments.forEach(p => {
        setoranDistributor += toNum(p.jumlah || p.JUMLAH);
      });

      const wajibWarungKeReseller = Math.max(0, omzet - keuntunganWarung);
      const wajibResellerKeDistributor = Math.max(0, omzet - keuntunganWarung - keuntunganReseller);

      const sisaWarungKeReseller = Math.max(0, wajibWarungKeReseller - setoranWarung);
      const sisaResellerKeDistributor = Math.max(0, wajibResellerKeDistributor - setoranDistributor);

      window.giberlineWajibSetor = {
        omzet,
        keuntunganWarung,
        keuntunganReseller,
        wajibWarungKeReseller,
        wajibResellerKeDistributor,
        setoranWarung,
        setoranDistributor,
        sisaWarungKeReseller,
        sisaResellerKeDistributor
      };

      const wajibEl = document.getElementById('dWajibSetor');
      if (wajibEl) {
        wajibEl.textContent = rupiah(wajibWarungKeReseller);
        const label = wajibEl.parentElement && wajibEl.parentElement.querySelector('.dash-label');
        if (label) label.textContent = 'Wajib Setor Warung → Reseller';
      }

      const distributorEl = document.getElementById('dWajibSetorDistributor');
      if (distributorEl) distributorEl.textContent = rupiah(wajibResellerKeDistributor);

      const sisaWarungEl = document.getElementById('dSisaSetorWarung');
      if (sisaWarungEl) sisaWarungEl.textContent = sisaWarungKeReseller === 0 ? 'LUNAS (Rp0)' : rupiah(sisaWarungKeReseller);

      const sisaDistributorEl = document.getElementById('dSisaSetorDistributor');
      if (sisaDistributorEl) sisaDistributorEl.textContent = sisaResellerKeDistributor === 0 ? 'LUNAS (Rp0)' : rupiah(sisaResellerKeDistributor);

      const detailEl = document.getElementById('giberlineWajibSetorDetail');
      if (detailEl) {
        detailEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
            <div><div style="font-size:10px;color:#64748b;font-weight:800;">OMZET</div><div style="font-size:17px;font-weight:900;">${rupiah(omzet)}</div></div>
            <div><div style="font-size:10px;color:#64748b;font-weight:800;">KEUNTUNGAN WARUNG</div><div style="font-size:17px;font-weight:900;color:#15803d;">${rupiah(keuntunganWarung)}</div></div>
            <div><div style="font-size:10px;color:#64748b;font-weight:800;">KEUNTUNGAN RESELLER</div><div style="font-size:17px;font-weight:900;color:#7e22ce;">${rupiah(keuntunganReseller)}</div></div>
          </div>
        `;
      }

    } catch(e) {
      console.warn('Perhitungan wajib setor tambahan gagal:', e);
    }
  }

  function tambahKartuWajibSetor(){
    if (document.getElementById('dWajibSetorDistributor')) return;

    const wajibEl = document.getElementById('dWajibSetor');
    if (!wajibEl) return;

    const card = wajibEl.closest('.dash-card');
    if (!card || !card.parentElement) return;

    const newCard = document.createElement('div');
    newCard.className = 'dash-card';
    newCard.innerHTML = `
      <div class="dash-icon" style="background:#fff7ed;color:#ea580c;">🚚</div>
      <div class="dash-info">
        <div class="dash-label">Wajib Setor Reseller → Distributor</div>
        <div class="dash-value" id="dWajibSetorDistributor">Rp0</div>
      </div>
    `;
    card.parentElement.insertBefore(newCard, card.nextSibling);

    const detail = document.createElement('div');
    detail.id = 'giberlineWajibSetorDetail';
    detail.style.cssText = 'background:white;border:1px solid #e2e8f0;border-radius:14px;padding:15px;margin:0 0 20px;';
    detail.innerHTML = '<div style="font-size:12px;color:#64748b;font-weight:800;">Perhitungan wajib setor</div>';

    const grid = card.parentElement;
    if (grid.parentElement) grid.parentElement.insertBefore(detail, grid.nextSibling);

    const sisaCard = document.createElement('div');
    sisaCard.className = 'dash-card';
    sisaCard.innerHTML = `
      <div class="dash-icon" style="background:#fef2f2;color:#dc2626;">⏳</div>
      <div class="dash-info">
        <div class="dash-label">Sisa Setoran Warung → Reseller</div>
        <div class="dash-value" id="dSisaSetorWarung">Rp0</div>
      </div>
    `;
    grid.appendChild(sisaCard);

    const sisaDistroCard = document.createElement('div');
    sisaDistroCard.className = 'dash-card';
    sisaDistroCard.innerHTML = `
      <div class="dash-icon" style="background:#fef2f2;color:#dc2626;">⏳</div>
      <div class="dash-info">
        <div class="dash-label">Sisa Setoran Reseller → Distributor</div>
        <div class="dash-value" id="dSisaSetorDistributor">Rp0</div>
      </div>
    `;
    grid.appendChild(sisaDistroCard);
  }

  function pasangPerbaikanDashboard(){
    tambahKartuWajibSetor();
    hitungWajibSetorTambahan();
  }

  if (typeof loadDashboard === 'function') {
    const __giberlineOriginalLoadDashboard = loadDashboard;
    window.loadDashboard = async function(){
      await __giberlineOriginalLoadDashboard.apply(this, arguments);
      pasangPerbaikanDashboard();
    };
  }

  if (typeof loadDetailedReport === 'function') {
    const __giberlineOriginalLoadDetailedReport = loadDetailedReport;
    window.loadDetailedReport = async function(){
      await __giberlineOriginalLoadDetailedReport.apply(this, arguments);
      try {
        const agentId = document.getElementById('reportFilterAgent')?.value;
        if (!agentId) return;
        const r = await api('agentReport', {agentId: agentId});
        let omzet = 0, warung = 0, reseller = 0;
        (r.laporanPerTanggal || []).forEach(d => {
          omzet += toNum(d.omzet);
          warung += toNum(d.agen);
          (d.rincian || []).forEach(v => { reseller += toNum(v.reseller); });
        });
        const wajibWarung = Math.max(0, omzet - warung);
        const wajibDistributor = Math.max(0, omzet - warung - reseller);

        const old = document.getElementById('rWajibSetor');
        if (old) old.textContent = rupiah(wajibWarung);

        let el = document.getElementById('rWajibSetorDistributor');
        if (!el && old) {
          const parent = old.closest('.card');
          if (parent && parent.parentElement) {
            const wrap = document.createElement('div');
            wrap.className = 'card';
            wrap.style.cssText = 'background:#fff7ed;border-top:4px solid #ea580c;padding:15px;';
            wrap.innerHTML = '<div class="card-label" style="color:#9a3412;">WAJIB SETOR RESELLER → DISTRIBUTOR</div><div class="card-value" id="rWajibSetorDistributor" style="color:#c2410c;">Rp0</div>';
            parent.parentElement.insertBefore(wrap, parent.nextSibling);
            el = document.getElementById('rWajibSetorDistributor');
          }
        }
        if (el) el.textContent = rupiah(wajibDistributor);
      } catch(e) {
        console.warn('Perhitungan wajib setor laporan gagal:', e);
      }
    };
  }
})();

/* =========================================================
   PEMISAHAN SETOR PUSAT
   1. HASIL PENJUALAN WARUNG / AGEN
   2. HASIL TAGIHAN BULANAN
========================================================= */

window.setorPusatJenis = 'penjualan_agen';


function switchSetorPusat(jenis) {

  window.setorPusatJenis = jenis;

  const modeEl = document.getElementById('setorPusatMode');
  const btnPenjualan = document.getElementById('btnSetorPenjualan');
  const btnBulanan = document.getElementById('btnSetorBulanan');

  if (jenis === 'tagihan_bulanan') {

    if (modeEl) {
      modeEl.textContent = 'Hasil Tagihan Bulanan';
    }

    if (btnPenjualan) {
      btnPenjualan.className = 'btn btn-secondary';
    }

    if (btnBulanan) {
      btnBulanan.className = 'btn btn-primary';
    }

  } else {

    window.setorPusatJenis = 'penjualan_agen';

    if (modeEl) {
      modeEl.textContent = 'Hasil Penjualan Warung / Agen';
    }

    if (btnPenjualan) {
      btnPenjualan.className = 'btn btn-primary';
    }

    if (btnBulanan) {
      btnBulanan.className = 'btn btn-secondary';
    }
  }

  const modalTitle = document.querySelector('#distroModal .modal-head h2');

  if (modalTitle) {
    modalTitle.textContent =
      jenis === 'tagihan_bulanan'
        ? 'Catat Setoran Tagihan Bulanan'
        : 'Catat Setoran Hasil Penjualan Warung / Agen';
  }

  loadDistributorPayments();
}


/* =========================================================
   LOAD SETOR PUSAT
   MENAMPILKAN HANYA JENIS YANG DIPILIH
========================================================= */

const __loadDistributorPaymentsBase = loadDistributorPayments;

loadDistributorPayments = async function() {

  await __loadDistributorPaymentsBase();

  const tbody = document.getElementById('distroTableBody');

  if (!tbody) return;

  const jenis =
    window.setorPusatJenis || 'penjualan_agen';

  let total = 0;

  Array.from(tbody.querySelectorAll('tr')).forEach(row => {

    const rowJenis =
      row.getAttribute('data-jenis-setoran') ||
      'penjualan_agen';

    if (rowJenis === jenis) {

      row.style.display = '';

      const nominalCell = row.cells[2];

      if (nominalCell) {
        const angka = nominalCell.textContent
          .replace(/[^\d]/g, '');

        total += Number(angka || 0);
      }

    } else {

      row.style.display = 'none';

    }

  });

  setText('totSetorDistro', rupiah(total));

};


window.openEditCustomer = function(id, nama, jenis, harga, tempo, kontak, alamat, tunggakan) {
    document.getElementById('editCustId').value = id;
    document.getElementById('editCustNama').value = nama;
    document.getElementById('editCustJenis').value = jenis;
    document.getElementById('editCustHarga').value = harga;
    document.getElementById('editCustTempo').value = tempo !== '-' ? tempo : '';
    document.getElementById('editCustKontak').value = kontak !== '-' ? kontak : '';
    document.getElementById('editCustAlamat').value = alamat !== '-' ? alamat : '';
    document.getElementById('editCustTunggakan').value = tunggakan;
    
    openModal('editCustomerModal');
};

window.updateCustomer = async function() {
    try {
        const id = document.getElementById('editCustId').value;
        const nama = document.getElementById('editCustNama').value;
        const jenis = document.getElementById('editCustJenis').value;
        const harga = Number(document.getElementById('editCustHarga').value);
        const tempo = Number(document.getElementById('editCustTempo').value);
        const kontak = document.getElementById('editCustKontak').value;
        const alamat = document.getElementById('editCustAlamat').value;
        const tunggakan = Number(document.getElementById('editCustTunggakan').value);

        if (!nama || !harga) {
            toast('Nama dan Tarif per bulan wajib diisi!');
            return;
        }

        const { error } = await supabaseClient.from('customers').update({
            nama: nama,
            jenis: jenis,
            harga: harga,
            jatuh_tempo: tempo,
            kontak: kontak,
            alamat: alamat,
            tunggakan: tunggakan
        }).eq('id', id);

        if (error) throw new Error(error.message);

        closeModal('editCustomerModal');
        toast('Data pelanggan & tunggakan berhasil diperbarui!');
        await loadCustomers();
        await loadDashboard();
    } catch (err) {
        toast(err.message);
    }
};

// 0. INISIALISASI SUPABASE KLIEN DI ATAS (AGAR SIAP DIAKSES)
const SUPABASE_URL = "https://ybwjadmggvrfmkrlkcog.supabase.co";
const SUPABASE_KEY = "sb_publishable_DfAYPfWJ_Ct5o1KVTZHavg_8O5vdSsG";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyTy9TKv59M7ZlTJSk--2CGJPke-pEDgQvIgUVeQ2WFkVjAH24NgHSmgNU8yRmr3V0/exec";
const TOKEN_KEY = "billing_admin_token";
const USER_KEY  = "billing_admin_user";

let agents = [];
let vouchers = [];
let stock = [];
let sales = [];
let payments = [];

// 1. FUNGSI API UTAMA SUPABASE & LOGIN APPS SCRIPT
async function api(action, params = {}) {
  if (action === 'login' || action === 'logout' || action === 'session') {
     return await apiAppsScript(action, params);
  }

  try {
    let result = null;

    switch (action) {
		case 'updatePayment':
        const { error: errUpdPay } = await supabaseClient
          .from('payments')
          .update({
              jumlah: Number(params.jumlah),
              keterangan: params.keterangan
          })
          .eq('id', params.id);
        if (errUpdPay) throw new Error(errUpdPay.message);
        result = { success: true };
        break;

      case 'deletePayment':
        const { error: errDelPay } = await supabaseClient
          .from('payments')
          .delete()
          .eq('id', params.id);
        if (errDelPay) throw new Error(errDelPay.message);
        result = { success: true };
        break;

		case 'updateStock': {
        const { error: errEditStock } = await supabaseClient
          .from('stock')
          .update({ 
             jumlah: Number(params.jumlah), 
             updated: new Date().toISOString() 
          })
          .eq('id', params.id);
        if (errEditStock) throw new Error(errEditStock.message);
        result = { success: true };
        break;
      }

      case 'dashboard':
        const { data: ags } = await supabaseClient.from('agents').select('*');
        const { data: vcs } = await supabaseClient.from('vouchers').select('*');
        const { data: stx } = await supabaseClient.from('stock').select('*');
        const { data: sls } = await supabaseClient.from('sales').select('*');
        const { data: pym } = await supabaseClient.from('payments').select('*');
        // TAMBAHAN: Tarik data setoran pusat
        const { data: dDP } = await supabaseClient.from('distributor_payments').select('*');
        
        let totalStock = 0, totalSold = 0, omzet = 0, distributor = 0, reseller = 0, agen = 0, dibayar = 0, totalSetorPusat = 0;
        let agentStatsMap = {};
        
        ags.forEach(a => { agentStatsMap[a.id] = { nama: a.nama_warung, stok: 0, terjualPcs: 0, omzet: 0 }; });
        stx.forEach(item => { totalStock += Number(item.jumlah || 0); if(agentStatsMap[item.agent_id]) agentStatsMap[item.agent_id].stok += Number(item.jumlah || 0); });
        sls.forEach(item => {
           // Mendukung pembacaan huruf kecil maupun huruf besar dari database
           totalSold += Number(item.jumlah || item.JUMLAH || 0);
           omzet += Number(item.total || item.TOTAL || 0);
           distributor += Number(item.distributor || item.DISTRIBUTOR || 0);
           reseller += Number(item.reseller || item.RESELLER || 0);
           agen += Number(item.agen || item.AGEN || 0);
           
           const agId = item.agent_id || item.AGENT_ID;
           if(agentStatsMap[agId]) {
              agentStatsMap[agId].terjualPcs += Number(item.jumlah || item.JUMLAH || 0);
              agentStatsMap[agId].omzet += Number(item.total || item.TOTAL || 0);
           }
        });
        pym.forEach(item => { dibayar += Number(item.jumlah || 0); });
        
        // Hitung akumulasi uang yang sudah disetorkan ke pusat
        if (dDP) {
   dDP.forEach(dp => {

      const jenisSetoran =
        dp.jenis_setoran ||
        dp.JENIS_SETORAN ||
        'penjualan_agen';

      if (jenisSetoran === 'penjualan_agen') {
         totalSetorPusat += Number(
           dp.jumlah || dp.JUMLAH || 0
         );
      }

   });
}
        
 		result = {
          warung: ags.length,
          jenisVoucher: vcs.length,
          stok: totalStock,
          terjual: totalSold,
          omzet: omzet,
          wajibSetor: Math.max(0, (omzet - agen) - dibayar), 
          distributor: distributor, 
          
          // UBAH BARIS INI: Pastikan rumusnya Omzet - Agen - Reseller
          sisaSetorDistributor: Math.max(0, (omzet - agen - reseller) - totalSetorPusat),
          
          reseller: reseller,
          agen: agen,
          dibayar: dibayar,
          piutang: Math.max(0, (omzet - agen) - dibayar),
          agentStats: Object.values(agentStatsMap).sort((a,b) => b.terjualPcs - a.terjualPcs)
        };
        break;
	  case 'distributorPayments':
        const { data: dDPExtract } = await supabaseClient.from('distributor_payments').select('*');
        result = dDPExtract || [];
        break;

      case 'addDistributorPayment':
        const { error: errDP } = await supabaseClient.from('distributor_payments').insert([{
           jumlah: Number(params.jumlah),
			jenis_setoran: window.setorPusatJenis || 'penjualan_agen',
           keterangan: params.keterangan || 'Setoran rutin',
           tanggal: new Date().toISOString()
        }]);
        if (errDP) throw new Error(errDP.message);
        result = { success: true };
        break;

      case 'vouchers':
        const { data: dV } = await supabaseClient.from('vouchers').select('*');
        result = dV || [];
        break;

      case 'agents':
        const { data: dA } = await supabaseClient.from('agents').select('*');
        result = dA || [];
        break;

      case 'stock':
        const { data: dS } = await supabaseClient.from('stock').select('*');
        result = dS || [];
        break;

      case 'sales':
        const { data: dSl } = await supabaseClient.from('sales').select('*');
        result = dSl || [];
        break;

      case 'payments':
        const { data: dP } = await supabaseClient.from('payments').select('*');
        result = dP || [];
        break;

      case 'customers':
        const { data: dC } = await supabaseClient.from('customers').select('*');
        result = dC || [];
        break;

      case 'customerPayments':
        const { data: dCP } = await supabaseClient.from('customer_payments').select('*');
        result = dCP || [];
        break;

      case 'addCustomer':
        const { error: errC } = await supabaseClient.from('customers').insert([{
           nama: params.nama,
           jenis: params.jenis || 'Rumahan',
           harga: Number(params.harga),
           jatuh_tempo: Number(params.tempo),
           kontak: params.kontak,
           alamat: params.alamat,
           status: 'AKTIF'
        }]);
        if (errC) throw new Error(errC.message);
        result = { success: true };
        break;

      case 'addCustomerPayment':
        const { error: errCP } = await supabaseClient.from('customer_payments').insert([{
           customer_id: params.customerId,
           jumlah: Number(params.jumlah),
           bulan: params.bulan,
           keterangan: params.keterangan || 'Iuran bulanan'
        }]);
        if (errCP) throw new Error(errCP.message);
        result = { success: true };
        break;

    case 'updateDistroPayment':
        const { error: errUpdDP } = await supabaseClient
          .from('distributor_payments')
          .update({
             jumlah: Number(params.jumlah),
             keterangan: params.keterangan
          })
          .eq('id', params.id);
        if (errUpdDP) throw new Error(errUpdDP.message);
        result = { success: true };
        break;

      case 'deleteDistroPayment':
        const { error: errDelDP } = await supabaseClient
          .from('distributor_payments')
          .delete()
          .eq('id', params.id);
        if (errDelDP) throw new Error(errDelDP.message);
        result = { success: true };
        break;

      case 'addAgent':
        const { error: errA } = await supabaseClient.from('agents').insert([{
           nama_warung: params.nama,
           pemilik: params.pemilik,
           hp: params.hp,
           alamat: params.alamat,
           status: 'AKTIF'
        }]);
        if (errA) throw new Error(errA.message);
        result = { success: true };
        break;

      case 'addVoucher':
        const { error: errV } = await supabaseClient.from('vouchers').insert([{
           nama: params.nama,
           harga: Number(params.harga),
           distributor: Number(params.distributor),
           reseller: Number(params.reseller),
           agen: Number(params.agen),
           status: 'AKTIF'
        }]);
        if (errV) throw new Error(errV.message);
        result = { success: true };
        break;

      case 'deleteAgent':
        await supabaseClient.from('agents').delete().eq('id', params.id);
        result = { success: true };
        break;

      case 'deleteVoucher':
        await supabaseClient.from('vouchers').delete().eq('id', params.id);
        result = { success: true };
        break;

      case 'deleteCustomer':
        await supabaseClient.from('customers').delete().eq('id', params.id);
        result = { success: true };
        break;
	
case 'addStock': {
        // 1. Cek apakah stok untuk agen dan voucher ini sudah ada
        const { data: existingStock, error: errCheck } = await supabaseClient
          .from('stock')
          .select('*')
          .eq('agent_id', params.agentId)
          .eq('voucher_id', params.voucherId)
          .maybeSingle(); // Menggunakan maybeSingle agar tidak error jika data kosong

        if (errCheck) throw new Error(errCheck.message);

        if (existingStock) {
          // 2. Jika sudah ada, akumulasi jumlah stoknya
          const accumulatedQty = Number(existingStock.jumlah || 0) + Number(params.jumlah);
          
          const { error: errUpdate } = await supabaseClient
            .from('stock')
            .update({ 
               jumlah: accumulatedQty, 
               updated: new Date().toISOString() 
            })
            .eq('id', existingStock.id); // Update berdasarkan ID baris yang sudah ada

          if (errUpdate) throw new Error(errUpdate.message);
        } else {
          // 3. Jika belum ada, lakukan insert sebagai baris baru
          const { error: errInsert } = await supabaseClient
            .from('stock')
            .insert([{
               agent_id: params.agentId,
               voucher_id: params.voucherId,
               jumlah: Number(params.jumlah),
               updated: new Date().toISOString()
            }]);

          if (errInsert) throw new Error(errInsert.message);
        }
        
        result = { success: true };
        break;
      }
case 'sell':
        // Cek stok agen terlebih dahulu
        const { data: stxData } = await supabaseClient
          .from('stock')
          .select('*')
          .eq('agent_id', params.agentId)
          .eq('voucher_id', params.voucherId)
          .single();

        const currentQty = stxData ? Number(stxData.jumlah || 0) : 0;
        const sellQty = Number(params.jumlah || 0);

        if (currentQty < sellQty) {
          throw new Error("Stok tidak mencukupi! Sisa stok saat ini: " + currentQty);
        }

        // Ambil data detail harga & bagi hasil voucher
        const { data: vData } = await supabaseClient
          .from('vouchers')
          .select('*')
          .eq('id', params.voucherId)
          .single();

        if (!vData) throw new Error("Voucher tidak ditemukan.");

        const hargaSatuan = Number(vData.harga || 0);
        const totalOmzet = hargaSatuan * sellQty;
        const totalDistributor = Number(vData.distributor || 0) * sellQty;
        const totalReseller = Number(vData.reseller || 0) * sellQty;
        const totalAgen = Number(vData.agen || 0) * sellQty;

        // Catat ke tabel sales
        const { error: errSell } = await supabaseClient.from('sales').insert([{
           agent_id: params.agentId,
           voucher_id: params.voucherId,
           jumlah: sellQty,
           harga: hargaSatuan,
           total: totalOmzet,
           distributor: totalDistributor,
           reseller: totalReseller,
           agen: totalAgen,
           tanggal: new Date().toISOString()
        }]);
        if (errSell) throw new Error(errSell.message);

        // Kurangi stok di tabel stock
        const sisaStokBaru = currentQty - sellQty;
        const { error: errUpdStock } = await supabaseClient
          .from('stock')
          .update({ jumlah: sisaStokBaru, updated: new Date().toISOString() })
          .eq('id', stxData.id);

        if (errUpdStock) throw new Error(errUpdStock.message);

        result = { success: true, sisaStok: sisaStokBaru };
        break;

      case 'payment': {
        // Validasi setoran agen agar tidak pernah membuat piutang menjadi minus.
        const paymentAmount = Number(params.jumlah);
        if (!params.agentId) throw new Error('Warung / agen wajib dipilih.');
        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
          throw new Error('Jumlah pembayaran harus lebih dari 0.');
        }

        const { data: salesForPayment, error: salesPaymentError } = await supabaseClient
          .from('sales')
          .select('total, agen, distributor, reseller')
          .eq('agent_id', params.agentId);
        if (salesPaymentError) throw new Error(salesPaymentError.message);

        const { data: paymentsForAgent, error: paymentsAgentError } = await supabaseClient
          .from('payments')
          .select('jumlah')
          .eq('agent_id', params.agentId);
        if (paymentsAgentError) throw new Error(paymentsAgentError.message);

        // Wajib setor agen = omzet dikurangi hak agen.
        const totalWajibAgen = (salesForPayment || []).reduce((sum, s) => {
          const total = Number(s.total || 0);
          const agen = Number(s.agen || 0);
          return sum + Math.max(0, total - agen);
        }, 0);

        const totalSudahBayarAgen = (paymentsForAgent || []).reduce(
          (sum, p) => sum + Math.max(0, Number(p.jumlah || 0)), 0
        );

        // Sisa selalu minimal 0. Jika sudah lunas, jangan menerima setoran tambahan.
        const sisaTagihanAgen = Math.max(0, totalWajibAgen - totalSudahBayarAgen);
        if (sisaTagihanAgen <= 0) {
          throw new Error('Setoran warung ini sudah LUNAS (Rp0). Tidak ada tagihan yang perlu disetor.');
        }
        if (paymentAmount > sisaTagihanAgen) {
          throw new Error('Jumlah setoran melebihi sisa tagihan. Maksimal setoran: ' + sisaTagihanAgen.toLocaleString('id-ID') + '.');
        }

        const { error: errPym } = await supabaseClient.from('payments').insert([{
           agent_id: params.agentId,
           jumlah: paymentAmount,
           keterangan: params.keterangan || 'Setoran penjualan',
           tanggal: new Date().toISOString()
        }]);
        if (errPym) throw new Error(errPym.message);

        const sisaSetelahBayar = Math.max(0, sisaTagihanAgen - paymentAmount);
        result = {
          success: true,
          lunas: sisaSetelahBayar === 0,
          sisaTagihan: sisaSetelahBayar
        };
        break;
      }
case 'agentReport':
        const { data: slsRep } = await supabaseClient
          .from('sales')
          .select('*')
          .eq('agent_id', params.agentId);

        const { data: pymRep } = await supabaseClient
          .from('payments')
          .select('*')
          .eq('agent_id', params.agentId);

        const { data: vcsRep } = await supabaseClient.from('vouchers').select('*');

        let totalOmzetRep = 0;
        let totalDibayarRep = 0;
        let dateMapRep = {};

        if (slsRep) {
           slsRep.forEach(s => {
              totalOmzetRep += Number(s.total || s.TOTAL || 0);
              const rawDate = s.tanggal || s.TANGGAL;
              const dObj = new Date(rawDate);
              const dateKey = isNaN(dObj) ? "Tanggal Lain" : dObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

              if (!dateMapRep[dateKey]) {
                 dateMapRep[dateKey] = { tanggal: dateKey, omzet: 0, agen: 0, rincian: [] };
              }
              
              dateMapRep[dateKey].omzet += Number(s.total || s.TOTAL || 0);
              dateMapRep[dateKey].agen += Number(s.agen || s.AGEN || 0);

              const vObj = vcsRep.find(v => String(v.id || v.ID) === String(s.voucher_id || s.VOUCHER_ID));
              dateMapRep[dateKey].rincian.push({
                 nama: vObj ? (vObj.nama || vObj.NAMA) : 'Voucher Terhapus',
                 jumlah: Number(s.jumlah || s.JUMLAH || 0),
                 harga: Number(s.harga || s.HARGA || 0),
                 total: Number(s.total || s.TOTAL || 0),
                 distributor: Number(s.distributor || s.DISTRIBUTOR || 0),
                 reseller: Number(s.reseller || s.RESELLER || 0),
                 agen: Number(s.agen || s.AGEN || 0)
              });
           });
        }

        if (pymRep) {
           pymRep.forEach(p => {
              totalDibayarRep += Number(p.jumlah || p.JUMLAH || 0);
           });
        }

        result = {
           totalOmzet: totalOmzetRep,
           totalDibayar: totalDibayarRep,
           laporanPerTanggal: Object.values(dateMapRep)
        };
        break;

      default:
        throw new Error("Aksi tidak dikenal: " + action);
    }

    return result;
  } catch (error) {
    throw new Error(error.message || "Terjadi kesalahan koneksi database.");
  }
}

// Fungsi Cerdas: Menghitung ulang saldo secara kronologis (dari awal sampai akhir)
// Berguna jika ada transaksi masa lalu yang diedit atau dihapus.
async function recalculateSaldo() {
  const { data, error } = await supabaseClient
    .from('catatan_keuangan')
    .select('*')
    .order('tanggal', { ascending: true }) // Urutkan dari yang paling lama
    .order('id', { ascending: true });
    
  if (error) return;

  let currentSaldo = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    currentSaldo += (Number(row.debit) - Number(row.kredit));
    
    // Update ke database hanya jika saldo di database salah/berubah
    if (Number(row.saldo) !== currentSaldo) {
      await supabaseClient
        .from('catatan_keuangan')
        .update({ saldo: currentSaldo })
        .eq('id', row.id);
    }
  }
}

// Memuat Data Keuangan
async function loadKeuangan() {
  try {
    // CARA RESMI SUPABASE: Mengambil ID user langsung dari mesin
    const { data: authData } = await supabaseClient.auth.getUser();
    const currentUserId = authData?.user?.id;

    const { data: kas, error } = await supabaseClient
      .from('catatan_keuangan')
      .select('*')
      .eq('user_id', currentUserId) // Filter pengunci data
      .order('tanggal', { ascending: true })
      .order('id', { ascending: true });
      
    if (error) throw new Error(error.message);

    const tbody = document.getElementById("kasTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!kas || kas.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:20px; color:#64748b;'>Belum ada catatan keuangan.</td></tr>";
      document.getElementById("kasSaldoAkhir").textContent = "Rp0";
      return;
    }

    let saldoTerakhir = 0;
    
    kas.slice().reverse().forEach(k => {
      if (saldoTerakhir === 0) saldoTerakhir = k.saldo;
      
      tbody.innerHTML += `
        <tr style="background: white;">
          <td style="padding: 12px 18px;">📅 ${formatDate(k.tanggal)}</td>
          <td style="padding: 12px 18px; font-weight: 700;">${esc(k.catatan)}</td>
          <td style="padding: 12px 18px; text-align: right; color: #16a34a; font-weight: 800;">${k.debit > 0 ? rupiah(k.debit) : '-'}</td>
          <td style="padding: 12px 18px; text-align: right; color: #dc2626; font-weight: 800;">${k.kredit > 0 ? rupiah(k.kredit) : '-'}</td>
          <td style="padding: 12px 18px; text-align: right; font-weight: 900; color: #1e40af;">${rupiah(k.saldo)}</td>
          <td style="padding: 12px 18px; text-align: right; white-space: nowrap;">
            <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 11px; margin-right: 4px;" onclick="openEditKas('${k.id}', '${k.tanggal}', ${k.debit}, ${k.kredit}, '${esc(k.catatan)}')">✏️ Edit</button>
            <button class="btn btn-danger" style="padding: 5px 10px; font-size: 11px;" onclick="deleteKas('${k.id}')">🗑️ Hapus</button>
          </td>
        </tr>`;
    });

    document.getElementById("kasSaldoAkhir").textContent = rupiah(saldoTerakhir);
  } catch (error) { toast(error.message); }
}

// Menyimpan Transaksi Keuangan Baru
async function saveKas() {
  try {
    let tglInput = document.getElementById("kasTanggal").value;
    const jenis = document.getElementById("kasJenis").value;
    const nominal = Number(document.getElementById("kasNominal").value);
    const catatan = document.getElementById("kasCatatan").value.trim();

    if (nominal <= 0 || !catatan) {
      toast("Nominal dan catatan wajib diisi!"); return;
    }

    // CARA RESMI SUPABASE: Ambil ID user saat menyimpan data
    const { data: authData } = await supabaseClient.auth.getUser();
    const currentUserId = authData?.user?.id;

    let tglFix = tglInput ? new Date(tglInput).toISOString() : new Date().toISOString();
    let debit = jenis === 'debit' ? nominal : 0;
    let kredit = jenis === 'kredit' ? nominal : 0;

    await supabaseClient.from('catatan_keuangan').insert([{
      tanggal: tglFix, 
      debit: debit, 
      kredit: kredit, 
      catatan: catatan, 
      saldo: 0,
      user_id: currentUserId // Menyimpan kepemilikan data
    }]);

    closeModal("kasModal");
    toast("Mengkalkulasi saldo...");
    
    document.getElementById("kasTanggal").value = '';
    document.getElementById("kasNominal").value = '';
    document.getElementById("kasCatatan").value = '';
    
    await recalculateSaldo(); 
    await loadKeuangan();     
    toast("Catatan kas berhasil disimpan!");
  } catch (error) { toast(error.message); }
}

// Membuka Modal Edit Kas
function openEditKas(id, tanggal, debit, kredit, catatan) {
  document.getElementById('editKasId').value = id;
  
  // Format tanggal dari database ke input type="datetime-local" (YYYY-MM-DDTHH:mm)
  const d = new Date(tanggal);
  const localDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  document.getElementById('editKasTanggal').value = localDate;
  
  document.getElementById('editKasJenis').value = debit > 0 ? 'debit' : 'kredit';
  document.getElementById('editKasNominal').value = debit > 0 ? debit : kredit;
  document.getElementById('editKasCatatan').value = catatan;
  
  openModal('editKasModal');
}

// Menyimpan Perubahan Edit
async function updateKas() {
  try {
    const id = document.getElementById('editKasId').value;
    const tglInput = document.getElementById('editKasTanggal').value;
    const jenis = document.getElementById('editKasJenis').value;
    const nominal = Number(document.getElementById('editKasNominal').value);
    const catatan = document.getElementById('editKasCatatan').value.trim();

    if (nominal <= 0 || !catatan || !tglInput) {
      toast("Data tidak boleh ada yang kosong!"); return;
    }

    let tglFix = new Date(tglInput).toISOString();
    let debit = jenis === 'debit' ? nominal : 0;
    let kredit = jenis === 'kredit' ? nominal : 0;

    await supabaseClient.from('catatan_keuangan')
      .update({ tanggal: tglFix, debit, kredit, catatan })
      .eq('id', id);

    closeModal('editKasModal');
    toast("Mengkalkulasi saldo ulang...");
    
    await recalculateSaldo();
    await loadKeuangan();
    toast("Catatan kas berhasil diperbarui!");
  } catch (error) { toast(error.message); }
}

// Menghapus Transaksi
async function deleteKas(id) {
  const konfirmasi = confirm("Yakin ingin menghapus transaksi ini? Saldo akan dikalkulasi ulang secara otomatis.");
  if (!konfirmasi) return;

  try {
    await supabaseClient.from('catatan_keuangan').delete().eq('id', id);
    toast("Mengkalkulasi saldo ulang...");
    await recalculateSaldo();
    await loadKeuangan();
    toast("Transaksi berhasil dihapus!");
  } catch (error) { toast(error.message); }
}

// Pemicu saat menu navigasi diklik
const __giberlineOriginalShowPage = showPage;
window.showPage = function(id, button) {
  __giberlineOriginalShowPage(id, button);
  if (id === "keuangan") loadKeuangan();
};

// 2. FUNGSI KHUSUS KOMUNIKASI KE APPS SCRIPT (UNTUK LOGIN)
async function apiAppsScript(action, params = {}) {
  const body = new URLSearchParams();
  body.append("action", action);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) body.append("token", token);

  Object.keys(params || {}).forEach(key => {
    const value = params[key];
    if (value !== undefined && value !== null) body.append(key, String(value));
  });

  let response;
  try {
    response = await fetch(APP_SCRIPT_URL + "?_=" + Date.now(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
      cache: "no-store",
      redirect: "follow"
    });
  } catch (error) {
    throw new Error("Tidak dapat menghubungi server login.");
  }

  if (!response.ok) throw new Error("HTTP error: " + response.status);

  let data;
  try { data = await response.json(); } catch (error) { throw new Error("Respons login bukan JSON."); }

  if (!data || data.success !== true) {
    const message = data && data.error ? data.error : "Terjadi kesalahan.";
    if (message === "SESSION_EXPIRED" || message === "AKSES_DITOLAK") {
      forceLogout();
      throw new Error("Sesi login telah berakhir.");
    }
    throw new Error(message);
  }
  return data.data;
}

// 3. LOGIKA OTENTIKASI MULTI-USER DENGAN SUPABASE AUTH
async function loginAdmin() {
  const emailEl = document.getElementById("loginUsername"); // Sekarang menggunakan Email
  const passwordEl = document.getElementById("loginPassword");
  const button = document.getElementById("loginButton");
  const errorEl = document.getElementById("loginError");

  const email = String(emailEl.value || "").trim();
  const password = String(passwordEl.value || "");
  errorEl.textContent = "";

  if (!email || !password) {
    errorEl.textContent = "Email dan password wajib diisi.";
    return;
  }

  button.disabled = true;
  button.textContent = "MEMERIKSA...";

  try {
    // Menggunakan Supabase Auth bawaan (Bukan tabel admins lagi)
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      throw new Error("Email atau password salah.");
    }

    // Simpan email user untuk disapa di Dashboard
    localStorage.setItem(USER_KEY, data.user.email);

    document.body.classList.add("auth-ready");
    document.body.classList.remove("auth-locked");

    await checkConnection();
    await loadDashboard();
    toast("Login berhasil.");
  } catch (error) {
    errorEl.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "MASUK";
  }
}

async function restoreSession() {
  // Mengecek apakah masih ada sesi aktif di Supabase
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  
  if (!session) { 
    forceLogout(); 
    return false; 
  }
  
  localStorage.setItem(USER_KEY, session.user.email);
  document.body.classList.add("auth-ready");
  document.body.classList.remove("auth-locked");
  return true;
}

// Fungsi Logout yang dioptimalkan
async function logoutAdmin() {
  try {
    // 1. Keluarkan user dari sistem Supabase Auth
    await supabaseClient.auth.signOut();
  } catch (error) {
    console.log("Error logout supabase:", error);
  }
  
  // 2. Hapus sesi lokal di browser (fungsi bawaan aplikasi)
  forceLogout();
  
  // 3. Muat ulang halaman agar tampilan kembali ke layar login 100% bersih
  window.location.reload();
}

function rupiah(value) {
  return "Rp" + Number(value || 0).toLocaleString("id-ID");
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + 
         d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = String(message || "");
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showPage(id, button) {
  const page = document.getElementById(id);
  if (!page) return;

  document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
  page.classList.add("active");

  document.querySelectorAll(".menu button").forEach(x => x.classList.remove("active"));
  if (button) button.classList.add("active");

  const titles = {
    dashboard: "Dashboard",
    agents: "DAFTAR RESELLER (WARUNG)",
    vouchers: "MASTER VOUCHER",
    stock: "KELOLA STOK VOUCHER",
    sales: "PEJUALAN",
    payments: "PEMBAYARAN",
    reports: "LAPORAN DETAIL RESELLER",
    customers: "PELANGGAN BULANAN",
    piutang: "DAFTAR PIUTANG",
	notes: "CATATAN KEUANGAN PRIBADI",
  };

  const title = document.getElementById("pageTitle");
  if (title) title.textContent = titles[id] || "Dashboard";

  if (id === "dashboard") loadDashboard();
  if (id === "agents") loadAgents();
  if (id === "vouchers") loadVouchers();
  if (id === "stock") loadStock();
  if (id === "sales") loadSales();
  if (id === "payments") loadPayments();
  if (id === "customers") loadCustomers();
  if (id === "piutang") loadPiutang();
  if (id === "notes") loadNotesPage();
if (id === "reports") {
    setupReportPage(); 
    loadDetailedReport(); // <-- Otomatis rekap seluruh agen saat menu laporan dibuka
  }
  if (id === "distributor") loadDistributorPayments(); 
  if (id === 'settings') {loadVouchers();
  }

  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");
}

async function checkConnection() {
  const el = document.getElementById("connection");
  if (!el) return;
  try {
    await api("dashboard");
    el.textContent = "● Database Terkoneksi";
    el.classList.remove("off");
  } catch (error) {
    el.textContent = "● Koneksi gagal";
    el.classList.add("off");
    if (localStorage.getItem(TOKEN_KEY)) toast(error.message);
  }
}

// Variabel penyimpan grafik agar tidak menumpuk saat di-refresh
window.trendChartInstance = null;
window.voucherChartInstance = null;

async function loadDashboard() {
  try {
    const d = await api("dashboard");
    let sales = [], vouchers = [], paymentsData = [], agentsData = [];
    try {
       sales = await api("sales");
       vouchers = await api("vouchers");
       paymentsData = await api("payments");
       agentsData = await api("agents");
    } catch(e) { console.log("Gagal memuat data pendukung"); }

// Update Baris 1
    document.getElementById("dOmzetValue").textContent = rupiah(d.omzet);
    document.getElementById("dStockValue").textContent = d.stok + " Pcs";
    document.getElementById("dSoldValue").textContent = d.terjual + " Pcs";
    
    // Update Baris 2 (Pembagian Hak)
    document.getElementById("dWajibSetorValue").textContent = rupiah(d.wajibSetor);
    document.getElementById("dResellerValue").textContent = rupiah(d.reseller);
    document.getElementById("dAgenValue").textContent = rupiah(d.agen);

    // Logika Khusus Sisa Setor Pusat (Warna berubah jika lunas)
    const sisaDistro = Number(d.sisaSetorDistributor || 0);
    const elDistro = document.getElementById("dDistributorValue");
    if (elDistro) {
       if (sisaDistro <= 0) {
          elDistro.textContent = "LUNAS (Rp0)";
          elDistro.className = "card-value text-green";
       } else {
          elDistro.textContent = rupiah(sisaDistro);
          elDistro.className = "card-value text-orange";
       }
    }
    
    // Sinkronisasi Piutang
    let customerReceivable = 0;
    try {
      const customers = await api("customers");
      const customerPayments = await api("customerPayments");
      const period = getCurrentBillingPeriod();
      customers.forEach(c => {
        const id = c.ID || c.id;
        const harga = Math.max(0, Number(c.HARGA || c.harga || 0));
        const paid = customerPayments.filter(p => String(p.CUSTOMER_ID || p.customer_id || p.customerId) === String(id) && String(p.BULAN || p.bulan || '').trim().toLowerCase() === period.toLowerCase())
          .reduce((sum,p) => sum + Math.max(0, Number(p.JUMLAH || p.jumlah || 0)), 0);
        if (harga - paid > 0) customerReceivable += (harga - paid);
      });
    } catch(e) {}
    const totalReceivable = Math.max(0, Number(d.piutang || 0)) + customerReceivable;
    document.getElementById("dPiutangValue").textContent = rupiah(totalReceivable);

    // Render Grafik
    if (typeof Chart !== 'undefined') renderDashboardCharts(sales, vouchers);

    // Render Top 5 Agen
    const topContainer = document.getElementById("topAgentsList");
    if (topContainer && d.agentStats) {
       topContainer.innerHTML = "";
       d.agentStats.slice(0, 5).forEach((a, idx) => {
          topContainer.innerHTML += `
            <div class="list-item">
              <div class="item-left">
                <span style="font-size:12px; color:#94a3b8; font-weight:700; width:15px;">${idx + 1}</span>
                <div class="item-icon">👤</div>
                <div><div class="item-name">${esc(a.nama)}</div><div class="item-sub">${a.terjualPcs} Pcs</div></div>
              </div>
              <div class="item-right">
                <div class="item-val">${rupiah(a.omzet)}</div>
                <div style="font-size:10px; color:#10b981;">Progress</div>
              </div>
            </div>`;
       });
    }

    // Render 5 Pembayaran Terakhir
    const recContainer = document.getElementById("recentPaymentsList");
    if (recContainer && paymentsData) {
       recContainer.innerHTML = "";
       paymentsData.slice(-5).reverse().forEach(p => {
          const ag = agentsData.find(a => String(a.id || a.ID) === String(p.agent_id || p.AGENT_ID));
          const agName = ag ? (ag.nama_warung || ag.NAMA_WARUNG) : "Warung Dihapus";
          recContainer.innerHTML += `
            <div class="list-item">
              <div class="item-left">
                <div class="item-icon">🏪</div>
                <div>
                  <div class="item-name">${esc(agName)} <span class="item-badge">Verified</span></div>
                  <div class="item-sub">${formatDate(p.tanggal || p.TANGGAL)}</div>
                </div>
              </div>
              <div class="item-right">
                <div class="item-val text-green">${rupiah(p.jumlah || p.JUMLAH)}</div>
              </div>
            </div>`;
       });
    }
  } catch (error) { toast(error.message); }
}
async function changePasswordSettings() {
  const oldPw = document.getElementById('setOldPassword').value;
  const newPw = document.getElementById('setNewPassword').value;
  const confirmPw = document.getElementById('setConfirmPassword').value;
  
  const currentUser = localStorage.getItem(USER_KEY);

  if (!oldPw || !newPw || !confirmPw) {
    toast("Semua kolom kata sandi wajib diisi!");
    return;
  }

  if (newPw !== confirmPw) {
    toast("Kata sandi baru dan konfirmasi tidak cocok!");
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('admins')
      .select('*')
      .eq('username', currentUser)
      .eq('password', oldPw)
      .single();

    if (error || !data) {
      toast("Kata sandi saat ini salah!");
      return;
    }

    const { error: errUpdate } = await supabaseClient
      .from('admins')
      .update({ password: newPw })
      .eq('username', currentUser);

    if (errUpdate) throw new Error(errUpdate.message);

    toast("Kata sandi berhasil diubah!");
    
    // Bersihkan form setelah berhasil
    document.getElementById('setOldPassword').value = '';
    document.getElementById('setNewPassword').value = '';
    document.getElementById('setConfirmPassword').value = '';

  } catch (err) {
    toast(err.message || "Terjadi kesalahan saat mengganti kata sandi.");
  }
}
function renderDashboardCharts(sales, vouchers) {
  const ctxTrend = document.getElementById('trendChart');
  const ctxVoucher = document.getElementById('voucherChart');
  if(!ctxTrend || !ctxVoucher) return;

  if (window.trendChartInstance) window.trendChartInstance.destroy();
  if (window.voucherChartInstance) window.voucherChartInstance.destroy();

  const last7Days = [];
  const omzet7Days = [0, 0, 0, 0, 0, 0, 0];
  
  for(let i = 6; i >= 0; i--) {
     const d = new Date();
     d.setDate(d.getDate() - i);
     last7Days.push(d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
  }

  if(sales && sales.length > 0) {
     sales.forEach(s => {
        const d = new Date(s.tanggal || s.TANGGAL);
        if(!isNaN(d)) {
           const tglStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
           const idx = last7Days.indexOf(tglStr);
           if(idx !== -1) omzet7Days[idx] += Number(s.total || s.TOTAL || 0);
        }
     });
  }

  const chartContext = ctxTrend.getContext('2d');
  let gradient = chartContext.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(15, 23, 42, 0.15)');
  gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');

  window.trendChartInstance = new Chart(ctxTrend, {
     type: 'line',
     data: {
        labels: last7Days,
        datasets: [{
           label: 'Total Omzet (Rp)',
           data: omzet7Days,
           borderColor: '#0f172a',
           backgroundColor: gradient,
           borderWidth: 3, fill: true, tension: 0.4,
           pointBackgroundColor: '#ffffff',
           pointBorderColor: '#0f172a',
           pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
        }]
     },
     options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
       scales: {
         x: { grid: { display: false }, border: { display: false } },
         y: { grid: { color: '#f1f5f9', borderDash: [5, 5] }, border: { display: false } }
       }
     }
  });

  const voucherCount = {};
  if(sales && sales.length > 0) {
     sales.forEach(s => {
        const vId = s.voucher_id || s.VOUCHER_ID;
        voucherCount[vId] = (voucherCount[vId] || 0) + Number(s.jumlah || s.JUMLAH || 0);
     });
  }

  const vLabels = []; const vData = [];
  const bgColors = ['#0f172a', '#10b981', '#64748b', '#3b82f6', '#f43f5e'];

  Object.keys(voucherCount).forEach(vId => {
     const v = vouchers.find(vx => String(vx.id || vx.ID) === String(vId));
     vLabels.push(v ? (v.nama || v.NAMA) : 'Dihapus');
     vData.push(voucherCount[vId]);
  });

  window.voucherChartInstance = new Chart(ctxVoucher, {
     type: 'doughnut',
     data: {
        labels: vLabels.length > 0 ? vLabels : ['Belum ada data'],
        datasets: [{
           data: vData.length > 0 ? vData : [1],
           backgroundColor: vData.length > 0 ? bgColors.slice(0, vLabels.length) : ['#f1f5f9'],
           borderWidth: 4, borderColor: '#ffffff'
        }]
     },
     options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } } } }
  });
}

async function loadDashboard() {
  try {
    const d = await api("dashboard");
    let sales = [], vouchers = [], paymentsData = [], agentsData = [];
    try {
       sales = await api("sales");
       vouchers = await api("vouchers");
       paymentsData = await api("payments");
       agentsData = await api("agents");
    } catch(e) { console.log("Gagal memuat data pendukung"); }

    // 1. Update 4 Kartu Ringkasan Atas
    document.getElementById("dOmzetValue").textContent = rupiah(d.omzet);
    document.getElementById("dStockValue").textContent = d.stok + " Pcs";
    document.getElementById("dSoldValue").textContent = d.terjual + " Pcs";
    
    // Hitung Piutang Pelanggan + Agen
    let customerReceivable = 0;
    try {
      const customers = await api("customers");
      const customerPayments = await api("customerPayments");
      const period = getCurrentBillingPeriod();
      customers.forEach(c => {
        const id = c.ID || c.id;
        const harga = Math.max(0, Number(c.HARGA || c.harga || 0));
        const paid = customerPayments.filter(p => String(p.CUSTOMER_ID || p.customer_id || p.customerId) === String(id) && String(p.BULAN || p.bulan || '').trim().toLowerCase() === period.toLowerCase())
          .reduce((sum,p) => sum + Math.max(0, Number(p.JUMLAH || p.jumlah || 0)), 0);
        if (harga - paid > 0) customerReceivable += (harga - paid);
      });
    } catch(e) {}
    
    const totalReceivable = Math.max(0, Number(d.piutang || 0)) + customerReceivable;
    document.getElementById("dPiutangValue").textContent = rupiah(totalReceivable);

    // 2. Update 4 Kartu Rincian Hak
    document.getElementById("dWajibSetorValue").textContent = rupiah(d.wajibSetor);
    document.getElementById("dResellerValue").textContent = rupiah(d.reseller);
    document.getElementById("dAgenValue").textContent = rupiah(d.agen);

    const sisaDistro = Number(d.sisaSetorDistributor || 0);
    const elDistro = document.getElementById("dDistributorValue");
    if (elDistro) {
       if (sisaDistro <= 0) {
          elDistro.textContent = "LUNAS (Rp0)";
          elDistro.className = "card-value text-green";
       } else {
          elDistro.textContent = rupiah(sisaDistro);
          elDistro.className = "card-value text-orange";
       }
    }

    // 3. Render Grafik
    if (typeof Chart !== 'undefined') renderDashboardCharts(sales, vouchers);

    // 4. Render Daftar Top 5 Agen
    const topContainer = document.getElementById("topAgentsList");
    if (topContainer && d.agentStats) {
       topContainer.innerHTML = "";
       if (d.agentStats.length === 0) {
          topContainer.innerHTML = "<p style='color:#64748b; text-align:center; padding: 20px;'>Belum ada data performa agen.</p>";
       } else {
          d.agentStats.slice(0, 5).forEach((a, idx) => {
             const progressWidth = Math.min(100, (a.terjualPcs / (d.agentStats[0].terjualPcs || 1)) * 100);
             topContainer.innerHTML += `
               <div class="list-item">
                 <div class="item-left">
                   <span style="font-size:12px; color:#94a3b8; font-weight:700; width:15px;">${idx + 1}</span>
                   <div class="item-icon">👤</div>
                   <div><div class="item-name">${esc(a.nama)}</div><div class="item-sub">${a.terjualPcs} Pcs</div></div>
                 </div>
                 <div class="item-right">
                   <div class="item-val">${rupiah(a.omzet)}</div>
                   <div style="width: 80px; height: 4px; background: #f1f5f9; border-radius: 2px; margin-top: 6px; margin-left: auto;">
                      <div style="width: ${progressWidth}%; height: 100%; background: #10b981; border-radius: 2px;"></div>
                   </div>
                 </div>
               </div>`;
          });
       }
    }

    // 5. Render 5 Pembayaran Terakhir
    const recContainer = document.getElementById("recentPaymentsList");
    if (recContainer && paymentsData) {
       recContainer.innerHTML = "";
       if (paymentsData.length === 0) {
          recContainer.innerHTML = "<p style='color:#64748b; text-align:center; padding: 20px;'>Belum ada riwayat pembayaran.</p>";
       } else {
          paymentsData.slice(-5).reverse().forEach(p => {
             const ag = agentsData.find(a => String(a.id || a.ID) === String(p.agent_id || p.AGENT_ID));
             const agName = ag ? (ag.nama_warung || ag.NAMA_WARUNG) : "Warung Dihapus";
             recContainer.innerHTML += `
               <div class="list-item">
                 <div class="item-left">
                   <div class="item-icon">🏪</div>
                   <div>
                     <div class="item-name">${esc(agName)} <span class="item-badge">Verified</span></div>
                     <div class="item-sub">${formatDate(p.tanggal || p.TANGGAL)}</div>
                   </div>
                 </div>
                 <div class="item-right">
                   <div class="item-val text-green">${rupiah(p.jumlah || p.JUMLAH)}</div>
                 </div>
               </div>`;
          });
       }
    }
  } catch (error) { toast(error.message); }
}
// Fungsi untuk membuka dan menutup Accordion
function toggleAccordion(element) {
  // Tutup semua accordion lain yang sedang terbuka (Opsional, agar rapi)
  const allItems = document.querySelectorAll('.accordion-item');
  const currentItem = element.parentElement;
  
  allItems.forEach(item => {
    if (item !== currentItem) {
      item.classList.remove('active');
    }
  });

  // Buka/Tutup accordion yang diklik
  currentItem.classList.toggle('active');
}

async function loadAgents() {
  try {
    // 1. Panggil semua tabel yang saling berkaitan
    const agData = await api("agents"); 
    const stxData = await api("stock") || [];
    const slsData = await api("sales") || [];
    const vData = await api("vouchers") || [];

    const container = document.getElementById("agentListContainer");
    if (!container) return;
    
    container.innerHTML = "";

    if (!agData || agData.length === 0) {
      container.innerHTML = "<div style='text-align:center; padding:30px; color:#64748b; background:white; border-radius:12px; border: 1px solid #e2e8f0;'>Belum ada data warung terdaftar.</div>";
      return;
    }

    agData.slice().reverse().forEach(a => {
      // Data Dasar Profil Warung
      const aId = a.id || a.ID;
      const aNama = a.nama_warung || a.NAMA_WARUNG || a.nama || '-';
      const aPemilik = a.pemilik || a.PEMILIK || '-';
      const aAlamat = a.alamat || a.ALAMAT || '-';
      const aHp = a.hp || a.HP || a.nomor_hp || a.NOMOR_HP || a.no_hp || '-';

      // 2. KALKULASI OTOMATIS (Mencari stok & penjualan khusus warung ini)
      let aStok = 0;
      let aTerjual = 0;
      let rincianArray = [];

      // Hitung Sisa Stok & Susun Rincian
      const agentStocks = stxData.filter(s => String(s.agent_id || s.AGENT_ID) === String(aId));
      agentStocks.forEach(s => {
         const qty = Number(s.jumlah || s.JUMLAH || 0);
         if (qty > 0) {
             aStok += qty;
             // Cari nama voucher berdasarkan ID-nya
             const vObj = vData.find(v => String(v.id || v.ID) === String(s.voucher_id || s.VOUCHER_ID));
             const vNama = vObj ? (vObj.nama || vObj.NAMA) : 'Voucher Tidak Dikenal';
             
             // Masukkan ke daftar rincian
             rincianArray.push(`• ${esc(vNama)} : <strong style='color:#16a34a;'>${qty} Pcs</strong>`);
         }
      });
      // Gabungkan rincian menjadi satu teks ke bawah, atau tampilkan pesan jika kosong
      const aRincian = rincianArray.length > 0 ? rincianArray.join('<br/>') : '<i style="color:#94a3b8;">Belum ada stok voucher yang dititipkan.</i>';

      // Hitung Total Voucher Terjual
      const agentSales = slsData.filter(s => String(s.agent_id || s.AGENT_ID) === String(aId));
      agentSales.forEach(s => {
         aTerjual += Number(s.jumlah || s.JUMLAH || 0);
      });

      // 3. CETAK KE LAYAR (Tampilan HTML Accordion)
      container.innerHTML += `
        <div class="accordion-item">
          <div class="accordion-header" onclick="toggleAccordion(this)">
            <div class="accordion-title">🏪 ${esc(aNama)}</div>
            <div style="font-size: 12px; font-weight: 700; color: #2563eb; margin-right: 10px; margin-left: auto;">
              Stok: ${aStok}
            </div>
            <div class="accordion-icon">▼</div>
          </div>
          
          <div class="accordion-body">
            <!-- Statistik Stok & Terjual -->
            <div class="agent-stats">
               <div class="agent-stat-box">
                  <div class="agent-stat-label">Sisa Stok</div>
                  <div class="agent-stat-value blue">${aStok} <span style="font-size: 10px; color: #94a3b8;">Pcs</span></div>
               </div>
               <div class="agent-stat-box">
                  <div class="agent-stat-label">Voucher Terjual</div>
                  <div class="agent-stat-value green">${aTerjual} <span style="font-size: 10px; color: #94a3b8;">Pcs</span></div>
               </div>
            </div>

            <!-- Rincian Stok -->
            <div style="margin-bottom: 15px; padding: 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
              <strong style="font-size: 11px; color: #64748b; text-transform: uppercase;">Isi Titipan Stok:</strong>
              <div style="font-size: 13px; color: #0f172a; margin-top: 8px; line-height: 1.6;">
                ${aRincian}
              </div>
            </div>

            <!-- Detail Kontak -->
            <div class="agent-details">
              <div><strong>Pemilik</strong>: ${esc(aPemilik)}</div>
              <div><strong>No. HP</strong>: ${esc(aHp)}</div>
              <div><strong>Alamat</strong>: ${esc(aAlamat)}</div>
            </div>
            
<div class="agent-actions">
  <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="openEditAgentModal('${aId}', '${esc(aNama)}', '${esc(aPemilik)}', '${esc(aAlamat)}', '${esc(aHp)}')">✏️ Edit</button>
  <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="deleteData('agent', '${aId}', '${esc(aNama)}')">🗑️ Hapus</button>
</div>
          </div>
        </div>
      `;
    });
  } catch (error) { 
    console.error(error);
    toast("Gagal memuat data warung."); 
  }
}
async function loadVouchers() {
  try {
    // Memanggil data voucher dari Supabase (Pastikan 'vouchers' sesuai dengan nama kasus/case di fungsi api Anda)
    const vData = await api("vouchers"); 
    const tbody = document.getElementById("voucherTableBody");
    
    // Jika tabel tidak ditemukan di HTML, hentikan proses agar tidak error
    if (!tbody) return; 

    // Kosongkan isi tabel sebelum memasukkan data baru
    tbody.innerHTML = "";

    // Jika data kosong
    if (!vData || vData.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3' style='text-align: center; color: #64748b; padding: 20px;'>Belum ada data jenis voucher.</td></tr>";
      return;
    }

    // Masukkan data ke dalam tabel
    vData.forEach(v => {
      // Menyesuaikan penamaan kolom (huruf besar/kecil) dari database Anda
      const vId = v.id || v.ID;
      const vNama = v.nama || v.nama_voucher || v.NAMA || '-';
      const vHarga = Number(v.harga || v.harga_jual || v.HARGA || 0);

      tbody.innerHTML += `
        <tr style="background: white;">
          <td style="font-weight: 600; color: #0f172a;">🎟️ ${esc(vNama)}</td>
          <td style="color: #16a34a; font-weight: 900;">${rupiah(vHarga)}</td>
          <td style="text-align: right; white-space: nowrap;">
			<button class="btn btn-secondary" style="padding: 5px 10px; font-size: 11px; margin-right: 4px;" onclick="openEditVoucher('${v.id || v.ID}', '${esc(v.nama || v.NAMA)}', ${v.harga || v.HARGA})">✏️ Edit</button>
             <button class="btn btn-danger" style="padding: 5px 10px; font-size: 11px;" onclick="deleteData('voucher', '${vId}', '${esc(vNama)}')">🗑️ Hapus</button>
          </td>
        </tr>
      `;
    });
  } catch (error) {
    console.error("Gagal memuat voucher:", error);
    toast("Gagal memuat data voucher.");
  }
}

async function loadStock() {
  try {
    agents = await api("agents");
    vouchers = await api("vouchers");
    stock = await api("stock");
    const container = document.getElementById("stockCardsContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!agents || agents.length === 0) {
      container.innerHTML = "<p style='color:#64748b; text-align:center; grid-column:1/-1;'>Belum ada data warung.</p>";
      return;
    }

    agents.forEach(agent => {
      const currentAgentStocks = stock.filter(s => String(s.agent_id || s.AGENT_ID) === String(agent.id || agent.ID));
      let totalPcsWarung = 0, stockListHtml = "", lastUpdated = "-";

      if (currentAgentStocks.length > 0) {
        currentAgentStocks.forEach(s => {
          const voucher = vouchers.find(v => String(v.id || v.ID) === String(s.voucher_id || s.VOUCHER_ID));
          const qty = Number(s.jumlah || s.JUMLAH || 0);
          totalPcsWarung += qty;
          const upTime = s.updated || s.UPDATED;
          if (upTime && upTime > lastUpdated) lastUpdated = formatDate(upTime);

          const sId = s.id || s.ID;
          const agentName = agent.nama_warung || agent.NAMA_WARUNG || agent.nama || 'Warung';
          const voucherName = voucher ? (voucher.nama || voucher.NAMA) : 'Voucher';

          stockListHtml += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 10px 14px; border-radius: 10px; margin-bottom: 5px;">
               <span style="font-size: 13px; font-weight: 700; color: #334155;">🎟️ ${esc(voucherName)}</span>
               <div style="display: flex; align-items: center; gap: 8px;">
                 <span style="background: #eff6ff; color: #1d4ed8; padding: 4px 10px; border-radius: 8px; font-size: 13px; font-weight: 900;">${qty} Pcs</span>
                 <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; border: 1px solid #cbd5e1;" onclick="openEditStockModal('${sId}', '${esc(agentName)}', '${esc(voucherName)}', ${qty})">✏️ Edit</button>
               </div>
            </div>`;

        });
      } else {
        stockListHtml = `<p style="color: #94a3b8; font-size: 12px; font-style: italic; text-align: center; padding: 10px;">Tidak ada stok.</p>`;
      }

      container.innerHTML += `
        <div style="background: white; border-radius: 16px; padding: 20px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 14px;">
           <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
              <div>
                 <h3 style="margin: 0 0 2px 0; font-size: 16px; color: #0f172a; font-weight: 800;">🏪 ${esc(agent.nama_warung || agent.NAMA_WARUNG)}</h3>
                 <span style="font-size: 11px; color: #64748b;">Pemilik: ${esc(agent.pemilik || agent.PEMILIK || '-')}</span>
              </div>
              <div style="text-align: right;">
                 <span style="font-size: 10px; color: #64748b; font-weight: 700; display: block;">TOTAL STOK</span>
                 <span style="font-size: 15px; font-weight: 900; color: #16a34a;">${totalPcsWarung} Pcs</span>
              </div>
           </div>
           <div style="display: flex; flex-direction: column; gap: 8px;">${stockListHtml}</div>
           <div style="display: flex; justify-content: space-between; border-top: 1px solid #f1f5f9; padding-top: 10px; margin-top: auto; font-size: 11px; color: #94a3b8;">
              <span>Pembaruan:</span><strong>${lastUpdated}</strong>
           </div>
        </div>`;
    });
  } catch (error) { toast(error.message); }
}

function toggleAgentSales(groupId) {
  const rows = document.querySelectorAll('.group-' + groupId);
  const icon = document.getElementById('icon-' + groupId);
  let isHidden = false;

  rows.forEach(row => {
    if (row.style.display === 'none') {
      row.style.display = 'table-row';
      isHidden = false;
    } else {
      row.style.display = 'none';
      isHidden = true;
    }
  });
  if (icon) icon.textContent = isHidden ? '▶' : '▼';
}

async function loadSales() {
  try {
    agents = await api("agents");
    vouchers = await api("vouchers");
    sales = await api("sales");

    const container = document.getElementById("salesTableContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!sales || sales.length === 0) {
      container.innerHTML = "<p style='color:#64748b; text-align:center; padding:30px;'>Belum ada riwayat penjualan.</p>";
      return;
    }

    const sortedSales = sales.slice().reverse();
    const dateGroups = {};

    sortedSales.forEach(s => {
      const tglData = s.TANGGAL || s.tanggal || s.created_at; 
      const d = new Date(tglData);
      const dateStr = isNaN(d) ? "Tanggal Tidak Valid" : d.toLocaleDateString('id-ID', {day: '2-digit', month: 'long', year: 'numeric'});
      const agentId = String(s.AGENT_ID || s.agent_id || s.agentId);

      if (!dateGroups[dateStr]) dateGroups[dateStr] = {};
      if (!dateGroups[dateStr][agentId]) dateGroups[dateStr][agentId] = [];
      dateGroups[dateStr][agentId].push(s);
    });

    let finalHtml = "";

    for (let date in dateGroups) {
      let dailyQty = 0, dailyOmzet = 0, dailyDistributor = 0, dailyReseller = 0, dailyAgen = 0;
      let cleanDateId = date.replace(/[^a-zA-Z0-9]/g, '');

      finalHtml += `
        <div style="margin-bottom: 25px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #f8fafc; padding: 12px 18px; border-bottom: 1px solid #e2e8f0; font-weight: 800; color: #0f172a; font-size: 14px;">
            📅 <span>${date}</span>
          </div>
          <div class="table-wrap" style="padding: 0;">
            <table>
              <thead>
                <tr style="background: white;">
                  <th style="text-align: left;">Nama Warung / Rincian</th>
                  <th style="text-align: center;">Kuantitas</th>
                  <th style="text-align: right;">Total Omzet</th>
                  <th style="text-align: right;">Aksi</th>
                </tr>
              </thead>
              <tbody>`;

      for (let agentId in dateGroups[date]) {
        const agent = agents.find(a => String(a.ID || a.id) === agentId);
        const agentName = agent ? (agent.NAMA_WARUNG || agent.nama_warung || agent.nama) : 'Warung Dihapus';
        const groupId = cleanDateId + '_' + agentId;

        let agentQty = 0, agentOmzet = 0, agentDistributor = 0, agentReseller = 0, agentAgen = 0;

        dateGroups[date][agentId].forEach(s => {
           agentQty += Number(s.JUMLAH ?? s.jumlah ?? 0);
           agentOmzet += Number(s.TOTAL ?? s.total ?? 0);
           agentDistributor += Number(s.DISTRIBUTOR ?? s.distributor ?? 0);
           agentReseller += Number(s.RESELLER ?? s.reseller ?? 0);
           agentAgen += Number(s.AGEN ?? s.agen ?? 0);
        });

        dailyQty += agentQty;
        dailyOmzet += agentOmzet;
        dailyDistributor += agentDistributor;
        dailyReseller += agentReseller;
        dailyAgen += agentAgen;
        
        let wajibSetorAgen = agentOmzet - agentAgen;

        finalHtml += `
                <tr style="cursor: pointer;" onclick="toggleAgentSales('${groupId}')">
                  <td colspan="4" style="padding: 12px 18px; border-bottom: 1px solid #cbd5e1; background: #fafaf9; font-weight: 800; color: #1e40af; font-size: 13px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                       <span style="display: flex; align-items: center; gap: 8px;">
                          <span id="icon-${groupId}" style="color: #64748b; font-size: 10px;">▼</span> 
                          🏪 ${esc(agentName)}
                       </span>
                       <span style="font-size: 12px; color: #475569; font-weight: 700;">
                          ${agentQty} Pcs | <strong style="color: #16a34a;">${rupiah(agentOmzet)}</strong>
                       </span>
                    </div>
                  </td>
                </tr>`;

        dateGroups[date][agentId].forEach(s => {
          const sId = s.ID || s.id;
          const vId = s.VOUCHER_ID || s.voucher_id || s.voucherId;
          const voucher = vouchers.find(v => String(v.ID || v.id) === String(vId));
          const vNama = voucher ? (voucher.NAMA || voucher.nama) : 'Voucher Terhapus';
          const vJumlah = s.JUMLAH ?? s.jumlah ?? 0;
          const vTotal = s.TOTAL ?? s.total ?? 0;

          finalHtml += `
                <tr class="group-${groupId}" style="background: white;">
                  <td style="padding: 12px 18px 12px 40px; border-bottom: 1px solid #f1f5f9; color: #475569; font-weight: 600;">
                    🎟️ ${esc(vNama)}
                  </td>
                  <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-weight: 800; color: #2563eb; text-align: center;">
                    ${vJumlah} Pcs
                  </td>
                  <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-weight: 900; color: #16a34a; text-align: right;">
                    ${rupiah(vTotal)}
                  </td>
                  <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; text-align: right; white-space: nowrap;">
                    <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 10px; margin-right: 4px;" onclick="openEditSales('${sId}', '${agentId}', '${vId}', ${vJumlah}, '${esc(agentName)}', '${esc(vNama)}')">✏️ Edit</button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 10px;" onclick="deleteSales('${sId}', '${agentId}', '${vId}', ${vJumlah})">🗑️ Hapus</button>
                  </td>
                </tr>`;
        });

        finalHtml += `
                <tr class="group-${groupId}" style="background: #f8fafc;">
                  <td colspan="4" style="padding: 12px 18px 12px 40px; border-bottom: 2px solid #e2e8f0;">
                    <div style="display: flex; gap: 20px; font-size: 11px; color: #64748b;">
                       <span>Distributor: <strong style="color:#9a3412">${rupiah(agentDistributor)}</strong></span>
                       <span>Reseller: <strong style="color:#6b21a8">${rupiah(agentReseller)}</strong></span>
                       <span>Agen: <strong style="color:#166534">${rupiah(agentAgen)}</strong></span>
                       <span style="border-left: 2px solid #cbd5e1; padding-left: 15px; color: #0f172a;">Wajib Setor: <strong style="color:#2563eb">${rupiah(wajibSetorAgen)}</strong></span>
                    </div>
                  </td>
                </tr>`;
      }
      
      let totalSetoranTanggal = dailyOmzet - dailyAgen;

      finalHtml += `
              </tbody>
              <tfoot>
                <tr style="background: #f1f5f9; border-top: 2px solid #cbd5e1;">
                  <td colspan="4" style="padding: 18px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                      <span style="font-size: 13px; font-weight: 900; color: #0f172a; text-transform: uppercase;">📈 GRAND TOTAL KESELURUHAN</span>
                      <div style="text-align: right;">
                        <span style="font-size: 14px; font-weight: 900; color: #2563eb; margin-right: 15px;">Total Terjual: ${dailyQty} Pcs</span>
                        <span style="font-size: 16px; font-weight: 900; color: #0f172a;">Total Omzet: ${rupiah(dailyOmzet)}</span>
                      </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                      <div style="background: white; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                        <div style="font-size: 10px; font-weight: 800; color: #c2410c; margin-bottom: 4px;">TOTAL DISTRIBUTOR</div>
                        <div style="font-size: 15px; font-weight: 900; color: #9a3412;">${rupiah(dailyDistributor)}</div>
                      </div>
                      <div style="background: white; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                        <div style="font-size: 10px; font-weight: 800; color: #7e22ce; margin-bottom: 4px;">TOTAL RESELLER</div>
                        <div style="font-size: 15px; font-weight: 900; color: #6b21a8;">${rupiah(dailyReseller)}</div>
                      </div>
                      <div style="background: white; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                        <div style="font-size: 10px; font-weight: 800; color: #15803d; margin-bottom: 4px;">TOTAL AGEN</div>
                        <div style="font-size: 15px; font-weight: 900; color: #166534;">${rupiah(dailyAgen)}</div>
                      </div>
                      <div style="background: #eff6ff; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #bfdbfe;">
                        <div style="font-size: 10px; font-weight: 800; color: #1e40af; margin-bottom: 4px;">SETORAN AGEN (KE ANDA)</div>
                        <div style="font-size: 15px; font-weight: 900; color: #1d4ed8;">${rupiah(totalSetoranTanggal)}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
    }
    container.innerHTML = finalHtml;
  } catch (error) { toast(error.message); }
}

async function loadPayments() {
  try {
    agents = await api("agents");
    payments = await api("payments");
    const d = await api("dashboard");

    setText("payTotalMasuk", rupiah(d.dibayar));
    setText("payDistributor", rupiah(d.distributor));
    setText("payReseller", rupiah(d.reseller));

    const tbody = document.getElementById("paymentTable");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!payments || payments.length === 0) {
       // Kolom diubah menjadi 5 karena ada kolom Aksi
       tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:30px; color:#64748b;'>Belum ada data pembayaran.</td></tr>";
       return;
    }

    payments.slice().reverse().forEach(p => {
      const agent = agents.find(a => String(a.id || a.ID) === String(p.agent_id || p.AGENT_ID));
      const pId = p.id || p.ID;
      const agNama = agent ? (agent.nama_warung || agent.NAMA_WARUNG) : "Warung Dihapus";
      const ket = p.keterangan || p.KETERANGAN || '-';
      const jml = p.jumlah || p.JUMLAH || 0;

      tbody.innerHTML += `
        <tr class="payment-row" style="background: white;">
          <td style="padding: 12px 18px;"><span style="background: #f1f5f9; padding: 6px 10px; border-radius: 6px; font-size: 12px;">📅 ${formatDate(p.tanggal || p.TANGGAL)}</span></td>
          <td style="padding: 12px 18px; font-weight: 800; color: #1e40af;">🏪 ${esc(agNama)}</td>
          <td style="padding: 12px 18px; color: #64748b; font-style: italic;">${esc(ket)}</td>
          <td style="padding: 12px 18px; font-weight: 900; color: #16a34a; text-align: right; font-size: 16px;">${rupiah(jml)}</td>
          <td style="padding: 12px 18px; text-align: right; white-space: nowrap;">
             <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 11px; margin-right: 4px;" onclick="openEditPaymentModal('${pId}', '${esc(agNama)}', ${jml}, '${esc(ket)}')">✏️ Edit</button>
             <button class="btn btn-danger" style="padding: 5px 10px; font-size: 11px;" onclick="deleteData('payment', '${pId}', 'Setoran ${esc(agNama)}')">🗑️ Hapus</button>
          </td>
        </tr>`;
    });
  } catch (error) { toast(error.message); }
}

// Fungsi untuk membuka Modal Edit Pembayaran
function openEditPaymentModal(id, agentName, jumlah, keterangan) {
  document.getElementById('editPaymentId').value = id;
  document.getElementById('editPaymentAgentName').value = agentName;
  document.getElementById('editPaymentJumlah').value = jumlah;
  document.getElementById('editPaymentKeterangan').value = keterangan !== '-' ? keterangan : '';
  openModal('editPaymentModal');
}

// Fungsi untuk menyimpan Edit Pembayaran
async function updatePayment() {
  try {
    await api("updatePayment", {
      id: document.getElementById("editPaymentId").value,
      jumlah: document.getElementById("editPaymentJumlah").value,
      keterangan: document.getElementById("editPaymentKeterangan").value
    });
    closeModal("editPaymentModal");
    toast("Pembayaran berhasil diperbarui");
    await loadPayments();
    await loadDashboard();
    if (document.getElementById('piutang')?.classList.contains('active')) await loadPiutang();
  } catch (error) { toast(error.message); }
}

/* ==================================================
   LOAD CUSTOMERS (STATUS LUNAS, REKAP NAMA & NOMINAL)
================================================== */
async function loadCustomers() {
  try {
    const customers = await api("customers");
    let payments = [];
    try { payments = await api("customerPayments"); } catch (e) { console.log("Belum ada riwayat pembayaran"); }
    const tbody = document.getElementById("customerTableBody");
    if (!tbody) return;
    
    if (!customers || customers.length === 0) {
      tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;padding:20px;color:#64748b;'>Belum ada data pelanggan bulanan.</td></tr>";
      const r=document.getElementById("rekapPelangganContainer"); if(r) r.style.display="none";
      return;
    }
    
    const currentBulan = getCurrentBillingPeriod();
    let countLunas=0, countBelum=0, uangLunas=0, uangBelum=0, listLunas=[], listBelum=[];
    
    // Reset Data Array
    customerDataArray = [];
    
    customers.forEach(c => {
      const cId = c.ID || c.id, cNama = c.NAMA || c.nama || "-", cJenis = c.JENIS || c.jenis || "Rumahan";
      const cHarga = Math.max(0, Number(c.HARGA || c.harga || 0)), cTempo = c.JATUH_TEMPO || c.jatuh_tempo || c.tempo || "-";
      const cKontak = c.KONTAK || c.kontak || "-", cAlamat = c.ALAMAT || c.alamat || "-";
      
      const tunggakanVal = Number(c.TUNGGAKAN || c.tunggakan || 0);
      const totalTagihan = tunggakanVal > 1 ? (cHarga * tunggakanVal) : cHarga;

      const paid = payments.filter(p => String(p.CUSTOMER_ID || p.customer_id || p.customerId) === String(cId) && String(p.BULAN || p.bulan || "").trim().toLowerCase() === currentBulan.toLowerCase()).reduce((sum, p) => sum + Math.max(0, Number(p.JUMLAH || p.jumlah || 0)), 0);
      
      const sisa = Math.max(0, totalTagihan - paid); 
      const lunas = sisa === 0;
      
      const isRumahan = String(cJenis).toLowerCase().includes('rumah');
      const badgeStyle = isRumahan ? "background:#eff6ff;color:#1d4ed8;" : "background:#fff7ed;color:#c2410c;"; 
      const icon = isRumahan ? "🏠" : "🎟️";
      
      if(lunas){
        countLunas++; uangLunas += totalTagihan; listLunas.push(cNama);
      } else {
        countBelum++; uangBelum += sisa; listBelum.push(cNama);
      }
      
      let textSisa = rupiah(sisa);
      if (tunggakanVal > 1 && !lunas) {
          textSisa = `${rupiah(sisa)} (${tunggakanVal} Bln)`;
      }

      const statusBadge = lunas 
        ? `<span style="background:#dcfce7;color:#166534;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:900;">✅ LUNAS</span>` 
        : `<span style="background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:900;">⚠️ SISA ${textSisa}</span>`;

      const payBtn = lunas
        ? `<button class="btn btn-secondary" style="padding:5px 10px;font-size:11px;" disabled>Lunas</button>`
        : `<button class="btn btn-success" style="padding:5px 10px;font-size:11px;margin-right:4px;" onclick="openCustomerPayModal('${cId}', '${esc(cNama)}', ${sisa})">💰 Bayar</button>`;

      const detailBtn = `<button class="btn btn-primary" style="padding:5px 10px;font-size:11px;margin-right:4px;" onclick="openCustomerDetailModal('${cId}')">👤 Detail</button>`;

      const safeNama = encodeURIComponent(cNama);
      const safeJenis = encodeURIComponent(cJenis);
      const safeTempo = encodeURIComponent(cTempo);
      const safeKontak = encodeURIComponent(cKontak);
      const safeAlamat = encodeURIComponent(cAlamat);

      const editBtn = `<button class="btn btn-secondary" style="padding:5px 10px;font-size:11px;margin-right:4px;" onclick="openEditCustomer('${cId}', decodeURIComponent('${safeNama}'), decodeURIComponent('${safeJenis}'), ${cHarga}, decodeURIComponent('${safeTempo}'), decodeURIComponent('${safeKontak}'), decodeURIComponent('${safeAlamat}'), ${tunggakanVal})">✏️ Edit</button>`;

      // Masukkan ke Array
      customerDataArray.push({
        id: cId, nama: cNama, jenis: cJenis, harga: cHarga, paid: paid, sisa: sisa, tempo: cTempo,
        lunas: lunas, badgeStyle: badgeStyle, icon: icon, statusBadge: statusBadge, 
        payBtn: payBtn, detailBtn: detailBtn, editBtn: editBtn
      });
    });

    // Inisialisasi Tampilan Pagination Awal
    filteredCustomerData = [...customerDataArray];
    currentCustomerPage = 1;
    renderCustomerTable();

    // Set Data Rekap
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set("rekapBulanTitle",currentBulan);set("countLunas",countLunas+" Orang");set("countBelum",countBelum+" Orang");set("uangLunas",rupiah(uangLunas));set("uangBelum",rupiah(uangBelum));
    const fmtList=(arr,bg,text)=>arr.length?arr.map(n=>`<span style="background:${bg};color:${text};padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;">👤 ${esc(n)}</span>`).join(''):`<span style="color:#64748b;font-size:12px;font-style:italic;">Tidak ada</span>`;
    
    set("listLunasContainer",""); const ll=document.getElementById("listLunasContainer");if(ll)ll.innerHTML=fmtList(listLunas,'#dcfce7','#166534');
    const lb=document.getElementById("listBelumContainer");if(lb)lb.innerHTML=fmtList(listBelum,'#fee2e2','#991b1b');
    const rp=document.getElementById("rekapPelangganContainer");if(rp)rp.style.display="block";
    
    await loadCustomerPayments();
  } catch(error){ toast(error.message); }
}

function getCurrentBillingPeriod(){
  const months=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const now=new Date(); return months[now.getMonth()]+' '+now.getFullYear();
}

async function loadPiutang() {
  try {
    // 1. Ambil data satu per satu agar jika ada 1 tabel kosong, yang lain tidak ikut error
    let customers = [], customerPayments = [], agents = [], sales = [], payments = [];
    
    try { customers = await api('customers'); } catch(e) {}
    try { customerPayments = await api('customerPayments'); } catch(e) {}
    try { agents = await api('agents'); } catch(e) {}
    try { sales = await api('sales'); } catch(e) {}
    try { payments = await api('payments'); } catch(e) {}
    
    // --- PROSES 1: PIUTANG PELANGGAN BULANAN ---
    const period = getCurrentBillingPeriod();
    const rowsCustomer = []; 
    let totalCustomer = 0;
    
    (customers || []).forEach(c => {
      const id = c.ID || c.id;
      const nama = c.NAMA || c.nama || '-';
      const jenis = c.JENIS || c.jenis || 'Rumahan';
      const harga = Math.max(0, Number(c.HARGA || c.harga || 0));
      const tempo = c.JATUH_TEMPO || c.jatuh_tempo || c.tempo || '-';
      const kontak = c.KONTAK || c.kontak || '';
      
      const paid = (customerPayments || [])
        .filter(p => String(p.CUSTOMER_ID || p.customer_id || p.customerId) === String(id) 
                  && String(p.BULAN || p.bulan || '').trim().toLowerCase() === period.toLowerCase())
        .reduce((sum, p) => sum + Math.max(0, Number(p.JUMLAH || p.jumlah || 0)), 0);
        
      const sisa = Math.max(0, harga - paid); 
      if (sisa > 0) {
        totalCustomer += sisa; 
        rowsCustomer.push({ id, nama, jenis, harga, paid, sisa, tempo, kontak });
      }
    });
    
    // Simpan ke variabel global untuk pagination
    piutangCustomerData = rowsCustomer;
    filteredPiutangCustomerData = rowsCustomer;
    currentPiutangCustomerPage = 1;
    renderPiutangCustomerTable();


    // --- PROSES 2: PIUTANG SETORAN WARUNG (PRESISI PER-AGEN) ---
    const rowsAgent = [];
    let totalAgent = 0;
    
    (agents || []).forEach(a => {
       const id = a.id || a.ID;
       const nama = a.nama_warung || a.NAMA_WARUNG || a.nama || '-';
       const pemilik = a.pemilik || a.PEMILIK || '-';
       
       // Hitung Wajib Setor (Total Omzet - Hak Agen) KHUSUS WARUNG INI
       const agentSales = (sales || []).filter(s => String(s.agent_id || s.AGENT_ID) === String(id));
       let wajibSetor = 0;
       agentSales.forEach(s => {
          const omzet = Number(s.total || s.TOTAL || 0);
          const hakAgen = Number(s.agen || s.AGEN || 0);
          wajibSetor += Math.max(0, omzet - hakAgen);
       });
       
       // Hitung Total Uang yang Sudah Disetor KHUSUS WARUNG INI
       const agentPayments = (payments || []).filter(p => String(p.agent_id || p.AGENT_ID) === String(id));
       let sudahDisetor = 0;
       agentPayments.forEach(p => {
          sudahDisetor += Number(p.jumlah || p.JUMLAH || 0);
       });
       
       const sisa = Math.max(0, wajibSetor - sudahDisetor);
       if (sisa > 0) { 
         totalAgent += sisa;
         rowsAgent.push({ id, nama, pemilik, wajibSetor, sudahDisetor, sisa });
       }
    });
    
    const bodyAgent = document.getElementById('piutangAgentBody');
    if (bodyAgent) {
       bodyAgent.innerHTML = rowsAgent.length ? rowsAgent.map(r => `
         <tr data-search="${esc((r.nama + ' ' + r.pemilik).toLowerCase())}">
           <td style="font-weight:800; color:#1e40af;">🏪 ${esc(r.nama)}</td>
           <td>${esc(r.pemilik)}</td>
           <td>${rupiah(r.wajibSetor)}</td>
           <td>${rupiah(r.sudahDisetor)}</td>
           <td style="font-weight:900;color:#ea580c;">${rupiah(r.sisa)}</td>
           <td><span style="background:#fff7ed;color:#c2410c;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:900;">BELUM SETOR</span></td>
           <td style="text-align:right;"><button class="btn btn-primary" style="padding:5px 10px;font-size:11px;" onclick="openPaymentModal(); setTimeout(()=>document.getElementById('paymentAgent').value='${r.id}', 300);">📝 Catat Setoran</button></td>
         </tr>`).join('') 
         : `<tr><td colspan="7" style="text-align:center;padding:30px;color:#16a34a;font-weight:800;">🎉 Semua warung sudah melunasi setorannya.</td></tr>`;
    }

    // --- PROSES 3: UPDATE ANGKA DI KARTU PIUTANG ---
    const pPiutangCustomer = document.getElementById('pPiutangCustomer');
    if(pPiutangCustomer) pPiutangCustomer.textContent = rupiah(totalCustomer);
    
    const pPiutangCustomerMeta = document.getElementById('pPiutangCustomerMeta');
    if(pPiutangCustomerMeta) pPiutangCustomerMeta.textContent = rowsCustomer.length + ' pelanggan';
    
    const pPiutangPeriod = document.getElementById('pPiutangPeriod');
    if(pPiutangPeriod) pPiutangPeriod.textContent = period;
    
    const pPiutangAgent = document.getElementById('pPiutangAgent');
    if(pPiutangAgent) pPiutangAgent.textContent = rupiah(totalAgent);
    
    const pPiutangAgentMeta = document.getElementById('pPiutangAgentMeta');
    if(pPiutangAgentMeta) pPiutangAgentMeta.textContent = rowsAgent.length + ' warung menunggak';
    
    const pPiutangTotal = document.getElementById('pPiutangTotal');
    if(pPiutangTotal) pPiutangTotal.textContent = rupiah(totalCustomer + totalAgent);
    
    const pPiutangTotalMeta = document.getElementById('pPiutangTotalMeta');
    if(pPiutangTotalMeta) pPiutangTotalMeta.textContent = (rowsCustomer.length + rowsAgent.length) + ' tagihan aktif';

  } catch (e) {
    toast(e.message);
  }
}
function filterPiutangAgent() {
  const q = (document.getElementById('searchPiutangAgent')?.value || '').toLowerCase();
  document.querySelectorAll('#piutangAgentBody tr').forEach(tr => {
    const s = tr.getAttribute('data-search') || tr.textContent.toLowerCase();
    tr.style.display = s.includes(q) ? '' : 'none';
  });
}

/* ==================================================
   LOAD CUSTOMER PAYMENTS (TABEL RIWAYAT)
================================================== */
async function loadCustomerPayments() {
  try {
    const customers = await api("customers");
    const payments = await api("customerPayments");
    const tbody = document.getElementById("customerPaymentTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!payments || payments.length === 0) {
      // colspan diubah menjadi 6 untuk menyesuaikan tambahan kolom Aksi
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:20px; color:#64748b; font-style:italic;'>Belum ada riwayat pembayaran iuran.</td></tr>";
      return;
    }

    payments.slice().reverse().forEach(p => {
      const pId = p.id || p.ID; // Mengambil ID dari baris pembayaran
      const cId = p.customer_id || p.CUSTOMER_ID;
      const cust = customers.find(c => String(c.id || c.ID) === String(cId));
      const custName = cust ? (cust.nama || cust.NAMA) : "Pelanggan Dihapus";

      tbody.innerHTML += `
        <tr style="background: white; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9;"><span style="background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-size: 12px;">📅 ${formatDate(p.tanggal || p.TANGGAL)}</span></td>
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-weight: 800; color: #1e40af;">👤 ${esc(custName)}</td>
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9;"><span style="background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">🗓️ ${esc(p.bulan || p.BULAN)}</span></td>
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-style: italic;">${esc(p.keterangan || p.KETERANGAN || '-')}</td>
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-weight: 900; color: #16a34a; text-align: right; font-size: 15px;">${rupiah(p.jumlah || p.JUMLAH)}</td>
          <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; text-align: right; white-space: nowrap;">
            <button class="btn btn-danger" style="padding:5px 10px; font-size:11px;" onclick="deleteData('customerPayments', '${pId}', 'Riwayat a/n ${esc(custName)}')">🗑️ Hapus</button>
          </td>
        </tr>`;
    });
  } catch (error) {
    toast(error.message);
  }
}

async function saveCustomer() {
  try {
    await api("addCustomer", {
      nama: document.getElementById("custNama").value,
      jenis: document.getElementById("custJenis").value,
      harga: document.getElementById("custHarga").value,
      tempo: document.getElementById("custTempo").value,
      kontak: document.getElementById("custKontak").value,
      alamat: document.getElementById("custAlamat").value
    });

    closeModal("customerModal");
    toast("Pelanggan bulanan berhasil ditambahkan");
    document.getElementById("custNama").value = '';
    document.getElementById("custHarga").value = '';
    document.getElementById("custTempo").value = '';
    await loadCustomers();
  } catch (error) { toast(error.message); }
}

function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add("show"); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove("show"); }

async function saveAgent() {
  try {
    await api("addAgent", {
      nama: document.getElementById("agentNama").value,
      pemilik: document.getElementById("agentPemilik").value,
      hp: document.getElementById("agentHP").value,
      alamat: document.getElementById("agentAlamat").value
    });
    
    // closeModal dihapus agar pop-up tidak tertutup otomatis
    // closeModal("agentModal"); 
    
    toast("Warung berhasil ditambahkan");
    
    // Kosongkan seluruh kolom input form warung
    document.getElementById("agentNama").value = '';
    document.getElementById("agentPemilik").value = '';
    document.getElementById("agentHP").value = '';
    document.getElementById("agentAlamat").value = '';
    
    // Arahkan kursor kembali ke input nama warung untuk input berikutnya
    document.getElementById("agentNama").focus();
    
    await loadAgents();
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

async function saveVoucher() {
  try {
    const harga = Number(document.getElementById("voucherHarga").value);
    const distributor = Number(document.getElementById("voucherDistributor").value);
    const reseller = Number(document.getElementById("voucherReseller").value);
    const agen = Number(document.getElementById("voucherAgen").value);

    if (!harga || harga <= 0) { toast("Harga voucher harus lebih dari 0"); return; }
    if (distributor + reseller + agen !== harga) { toast("Bagi hasil harus sama dengan harga voucher"); return; }

    await api("addVoucher", {
      nama: document.getElementById("voucherNama").value,
      harga: harga, distributor: distributor, reseller: reseller, agen: agen
    });
    closeModal("voucherModal");
    toast("Voucher berhasil ditambahkan");
    await loadVouchers();
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

async function openStockModal() {
  try { await loadSelectData(); openModal("stockModal"); } catch (error) { toast(error.message); }
}

function fillSelect(id, data, valueKey, textKey) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih --</option>';
  data.forEach(x => { 
    const vVal = x[valueKey] || x[valueKey.toLowerCase()] || x[valueKey.toUpperCase()];
    const vTxt = x[textKey] || x[textKey.toLowerCase()] || x[textKey.toUpperCase()];
    select.innerHTML += `<option value="${esc(vVal)}">${esc(vTxt)}</option>`; 
  });
}

async function loadSelectData() {
  agents = await api("agents");
  vouchers = await api("vouchers");
  fillSelect("stockAgent", agents, "id", "nama_warung");
  fillSelect("salesAgent", agents, "id", "nama_warung");
  fillSelect("paymentAgent", agents, "id", "nama_warung");
  fillSelect("stockVoucher", vouchers, "id", "nama");
  fillSelect("salesVoucher", vouchers, "id", "nama");
}

async function saveStock() {
  try {
    await api("addStock", {
      agentId: document.getElementById("stockAgent").value,
      voucherId: document.getElementById("stockVoucher").value,
      jumlah: document.getElementById("stockJumlah").value,
      keterangan: "Titip voucher"
    });
    
    // closeModal dihapus agar popup tidak hilang saat mencatat terus menerus
    // closeModal("stockModal"); 
    
    toast("Stok berhasil ditambahkan");
    
    // Kosongkan form pilihan voucher dan jumlah saja
    document.getElementById("stockVoucher").value = '';
    document.getElementById("stockJumlah").value = '';
    
    // Arahkan kursor langsung ke pilihan voucher agar siap diinput lagi
    document.getElementById("stockVoucher").focus();
    
    await loadStock();
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

function openEditStockModal(id, agentName, voucherName, jumlah) {
  document.getElementById('editStockId').value = id;
  document.getElementById('editStockAgent').value = agentName;
  document.getElementById('editStockVoucher').value = voucherName;
  document.getElementById('editStockJumlah').value = jumlah;
  openModal('editStockModal');
}

async function updateStock() {
  try {
    const id = document.getElementById('editStockId').value;
    const jumlah = document.getElementById('editStockJumlah').value;
    
    if (jumlah === '' || jumlah < 0) {
      toast("Jumlah stok tidak valid!");
      return;
    }

    await api("updateStock", {
      id: id,
      jumlah: jumlah
    });

    closeModal("editStockModal");
    toast("Stok voucher di warung berhasil diperbarui");
    
    await loadStock();
    await loadDashboard();
  } catch (error) { 
    toast(error.message); 
  }
}

async function openSalesModal() {
  try { await loadSelectData(); openModal("salesModal"); } catch (error) { toast(error.message); }
}

async function saveSale() {
  try {
    const result = await api("sell", {
      agentId: document.getElementById("salesAgent").value,
      voucherId: document.getElementById("salesVoucher").value,
      jumlah: document.getElementById("salesJumlah").value
    });
    
    // Mematikan closeModal agar popup tidak tertutup otomatis
    // closeModal("salesModal"); 
    
    toast("Penjualan berhasil. Sisa stok: " + (result.sisaStok ?? 0));
    
    // Mengosongkan form voucher dan jumlah saja, nama Warung tetap dipertahankan
    document.getElementById("salesVoucher").value = '';
    document.getElementById("salesJumlah").value = '';
    
    // Mengembalikan fokus/kursor ke pilihan voucher
    document.getElementById("salesVoucher").focus();
    
    await loadSales();
    await loadStock();
    await loadDashboard();
  } catch (error) { 
    toast(error.message); 
  }
}
// 1. FUNGSI MEMBUKA MODAL & MENGHITUNG TUNGGAKAN OTOMATIS
async function openPaymentModal() {
  document.getElementById("paymentJumlah").value = "";
  document.getElementById("paymentKeterangan").value = "";
  
  const selectAgent = document.getElementById("paymentAgent");
  selectAgent.innerHTML = "<option value=''>⏳ Mencari warung yang belum setor...</option>";

  openModal("paymentModal");

  try {
    const agents = await api("agents");
    const sales = await api("sales");
    const payments = await api("payments");

    let htmlOptions = "<option value=''>-- Pilih Warung --</option>";
    let adaTunggakan = false;

    agents.forEach(a => {
      const id = a.id || a.ID;
      const nama = a.nama_warung || a.NAMA_WARUNG || a.nama || '-';

      let wajibSetor = 0;
      (sales || []).filter(s => String(s.agent_id || s.AGENT_ID) === String(id)).forEach(s => {
        wajibSetor += Math.max(0, Number(s.total || s.TOTAL || 0) - Number(s.agen || s.AGEN || 0));
      });

      let sudahDisetor = 0;
      (payments || []).filter(p => String(p.agent_id || p.AGENT_ID) === String(id)).forEach(p => {
        sudahDisetor += Number(p.jumlah || p.JUMLAH || 0);
      });

      const sisa = Math.max(0, wajibSetor - sudahDisetor);
      
      if (sisa > 0) {
        adaTunggakan = true;
        htmlOptions += `<option value="${id}" data-sisa="${sisa}">🏪 ${esc(nama)} (Kurang: Rp${sisa.toLocaleString('id-ID')})</option>`;
      }
    });

    if (!adaTunggakan) {
      selectAgent.innerHTML = "<option value=''>🎉 Semua warung sudah LUNAS</option>";
    } else {
      selectAgent.innerHTML = htmlOptions;
    }
  } catch (error) {
    selectAgent.innerHTML = "<option value=''>❌ Gagal memuat data</option>";
    toast("Gagal memuat tagihan: " + error.message);
  }
}

// 2. FUNGSI AUTO-FILL SAAT DROPDOWN DIPILIH
function autoFillPayment() {
  const select = document.getElementById("paymentAgent");
  const inputJumlah = document.getElementById("paymentJumlah");
  const inputKet = document.getElementById("paymentKeterangan");

  if (select.selectedIndex > 0) {
    const option = select.options[select.selectedIndex];
    const sisa = option.getAttribute("data-sisa");
    
    if (sisa) {
        inputJumlah.value = sisa;
        inputKet.value = "Setoran penjualan";
    }
  } else {
    inputJumlah.value = "";
    inputKet.value = "";
  }
}


async function savePayment() {
  const btnSubmit = document.querySelector('#paymentModal .btn-success');
  const originalText = btnSubmit.textContent;
  
  btnSubmit.textContent = "Menyimpan...";
  btnSubmit.disabled = true;

  try {
    const agentVal = document.getElementById("paymentAgent").value;
    const jumlahVal = document.getElementById("paymentJumlah").value;

    if (!agentVal) throw new Error("Silakan pilih warung terlebih dahulu.");
    if (!jumlahVal || jumlahVal <= 0) throw new Error("Jumlah pembayaran harus lebih dari 0.");

    const result = await api("payment", {
      agentId: agentVal,
      jumlah: jumlahVal,
      keterangan: document.getElementById("paymentKeterangan").value || "Setoran penjualan"
    });
    
    // PERINTAH CLOSE MODAL SUDAH DIHAPUS SEPENUHNYA DI SINI
    
    toast(result.lunas ? "Pembayaran berhasil — LUNAS (Rp0)" : "Pembayaran dicatat. Sisa: Rp" + Number(result.sisaTagihan || 0).toLocaleString("id-ID"));
    
    // Muat ulang data tabel di latar belakang
    await loadPayments();
    await loadDashboard();
    if (document.getElementById('piutang')?.classList.contains('active')) {
      await loadPiutang();
    }

    // Refresh pilihan dropdown warung agar sisa tagihan terupdate otomatis
    await openPaymentModal();
    document.getElementById("paymentAgent").focus();

  } catch (error) { 
    toast(error.message); 
  } finally {
    btnSubmit.textContent = originalText;
    btnSubmit.disabled = false;
  }
}

// ADDED: Fungsi Distributor Payment yang hilang
async function loadDistributorPayments() {

  try {

    const data = await api("distributorPayments");

    const tbody =
      document.getElementById("distroTableBody");

    if (!tbody) return;


    tbody.innerHTML = "";


    const jenisAktif =
      window.setorPusatJenis || "penjualan_agen";


    let total = 0;


    /*
     * Hanya data dengan jenis yang sedang dipilih
     */
    const dataFiltered = (data || []).filter(function(d) {

      const jenis =
        d.jenis_setoran ||
        d.JENIS_SETORAN ||
        "penjualan_agen";

      return jenis === jenisAktif;

    });


    if (dataFiltered.length === 0) {

      tbody.innerHTML = `
        <tr>

          <td
            colspan="4"
            style="text-align:center;
                   color:#64748b;
                   padding:20px;">

            Belum ada data setoran
            ${
              jenisAktif === "tagihan_bulanan"
                ? "tagihan bulanan"
                : "hasil penjualan warung / agen"
            }.

          </td>

        </tr>
      `;

      setText("totSetorDistro", "Rp0");

      return;

    }


    dataFiltered
      .slice()
      .reverse()
      .forEach(function(d) {


        const dId =
          d.id ||
          d.ID;


        const dTgl =
          formatDate(
            d.tanggal ||
            d.TANGGAL
          );


        const dKet =
          d.keterangan ||
          d.KETERANGAN ||
          "-";


        const dJml =
          Number(
            d.jumlah ||
            d.JUMLAH ||
            0
          );


        total += dJml;


        tbody.innerHTML += `

          <tr
            style="background:white;"
            data-jenis-setoran="${
              d.jenis_setoran ||
              d.JENIS_SETORAN ||
              "penjualan_agen"
            }">


            <td
              style="padding:12px 18px;">

              <span
                style="background:#f1f5f9;
                       padding:6px 10px;
                       border-radius:6px;
                       font-size:12px;">

                📅 ${dTgl}

              </span>

            </td>


            <td
              style="padding:12px 18px;
                     color:#64748b;
                     font-style:italic;">

              ${esc(dKet)}

            </td>


            <td
              style="padding:12px 18px;
                     font-weight:900;
                     color:#ea580c;
                     font-size:15px;">

              ${rupiah(dJml)}

            </td>


            <td
              style="padding:12px 18px;
                     text-align:right;
                     white-space:nowrap;">

              <button
                class="btn btn-secondary"
                style="padding:5px 10px;
                       font-size:11px;
                       margin-right:4px;"
                onclick="openEditDistroModal(
                  '${dId}',
                  ${dJml},
                  '${esc(dKet)}'
                )">

                ✏️ Edit

              </button>


              <button
                class="btn btn-danger"
                style="padding:5px 10px;
                       font-size:11px;"
                onclick="deleteData(
                  'distributorPayment',
                  '${dId}',
                  'Catatan Setoran'
                )">

                🗑️ Hapus

              </button>

            </td>

          </tr>

        `;

      });


    setText(
      "totSetorDistro",
      rupiah(total)
    );


    /*
     * Pastikan filter pencarian/date
     * tetap berjalan
     */
    if (typeof filterDistributor === "function") {

      filterDistributor();

    }


  } catch (error) {

    console.error(
      "loadDistributorPayments:",
      error
    );

    toast(error.message);

  }

}

function openEditDistroModal(id, jumlah, keterangan) {
  document.getElementById('editDistroId').value = id;
  document.getElementById('editDistroJumlah').value = jumlah;
  document.getElementById('editDistroKeterangan').value = keterangan !== '-' ? keterangan : '';
  openModal('editDistroModal');
}

async function saveDistroPayment() {
  try {
    const jumlah = Number(document.getElementById("distroJumlah").value);
    const keterangan = document.getElementById("distroKeterangan").value.trim();

    if (!jumlah || jumlah <= 0) {
      toast("Nominal setoran harus diisi.");
      return;
    }

    const jenisSetoran = window.setorPusatJenis || "penjualan_agen";

    await api("addDistributorPayment", {
        jumlah: jumlah,
        keterangan: keterangan || (jenisSetoran === "tagihan_bulanan" ? "Setoran hasil tagihan bulanan" : "Setoran hasil penjualan warung / agen"),
        jenis_setoran: jenisSetoran
    });

    // PERINTAH CLOSE MODAL SUDAH DIHAPUS SEPENUHNYA DI SINI

    toast(jenisSetoran === "tagihan_bulanan" ? "Setoran tagihan bulanan berhasil disimpan." : "Setoran hasil penjualan warung / agen berhasil disimpan.");

    // Kosongkan form dan kembalikan kursor ke input jumlah
    document.getElementById("distroJumlah").value = "";
    document.getElementById("distroKeterangan").value = "";
    document.getElementById("distroJumlah").focus();

    await loadDistributorPayments();
    await loadDashboard();

  } catch (error) {
    console.error("saveDistroPayment:", error);
    toast(error.message);
  }
}

async function updateDistroPayment() {

  try {

    const id =
      document.getElementById(
        "editDistroId"
      ).value;


    const jumlah =
      Number(
        document.getElementById(
          "editDistroJumlah"
        ).value
      );


    const keterangan =
      document.getElementById(
        "editDistroKeterangan"
      ).value.trim();


    if (!id) {

      toast(
        "ID setoran tidak ditemukan."
      );

      return;

    }


    if (!jumlah || jumlah <= 0) {

      toast(
        "Nominal setoran harus diisi."
      );

      return;

    }


    await api(
      "updateDistroPayment",
      {

        id: id,

        jumlah: jumlah,

        keterangan:
          keterangan ||
          "Setoran pusat"

      }
    );


    closeModal(
      "editDistroModal"
    );


    toast(
      "Catatan setoran berhasil diperbarui."
    );


    await loadDistributorPayments();

    await loadDashboard();


  } catch (error) {

    console.error(
      "updateDistroPayment:",
      error
    );

    toast(error.message);

  }

}
window.setorPusatJenis =
  "penjualan_agen";


function switchSetorPusat(jenis) {

  if (
    jenis !== "penjualan_agen" &&
    jenis !== "tagihan_bulanan"
  ) {

    jenis = "penjualan_agen";

  }


  window.setorPusatJenis =
    jenis;


  const modeEl =
    document.getElementById(
      "setorPusatMode"
    );


  const btnPenjualan =
    document.getElementById(
      "btnSetorPenjualan"
    );


  const btnBulanan =
    document.getElementById(
      "btnSetorBulanan"
    );


  const modalTitle =
    document.getElementById(
      "distroModalTitle"
    );


  const totalLabel =
    document.getElementById(
      "labelTotalSetorPusat"
    );


  if (
    jenis ===
    "tagihan_bulanan"
  ) {


    if (modeEl) {

      modeEl.textContent =
        "Hasil Tagihan Bulanan";

    }


    if (btnPenjualan) {

      btnPenjualan.className =
        "btn btn-secondary";

    }


    if (btnBulanan) {

      btnBulanan.className =
        "btn btn-primary";

    }


    if (modalTitle) {

      modalTitle.textContent =
        "Catat Setoran Hasil Tagihan Bulanan";

    }


    if (totalLabel) {

      totalLabel.textContent =
        "TOTAL SUDAH DI SETORKAN";

    }


  } else {


    if (modeEl) {

      modeEl.textContent =
        "Hasil Penjualan Warung / Agen";

    }


    if (btnPenjualan) {

      btnPenjualan.className =
        "btn btn-primary";

    }


    if (btnBulanan) {

      btnBulanan.className =
        "btn btn-secondary";

    }


    if (modalTitle) {

      modalTitle.textContent =
        "Catat Setoran Hasil Penjualan Warung / Agen";

    }


    if (totalLabel) {

      totalLabel.textContent =
        "TOTAL HASIL PENJUALAN WARUNG / AGEN";

    }

  }


  loadDistributorPayments();

}


async function openSetorPusatModal() {
  const jenis = window.setorPusatJenis || "penjualan_agen";
  switchSetorPusat(jenis);

  const inputJumlah = document.getElementById("distroJumlah");
  const inputKet = document.getElementById("distroKeterangan");

  // Kosongkan dan tampilkan modal langsung agar terasa responsif
  inputJumlah.value = "";
  inputKet.value = "";
  openModal("distroModal");

  if (jenis === "penjualan_agen") {
    // Ubah tulisan bayangan saat sistem sedang menghitung
    inputJumlah.placeholder = "Menghitung sisa setor pusat...";
    
    try {
      // Tarik perhitungan dari dashboard (sudah ada rumus sisaSetorDistributor)
      const d = await api("dashboard");
      const sisaSetor = Math.max(0, Number(d.sisaSetorDistributor || 0));
      
      if (sisaSetor > 0) {
        inputJumlah.value = sisaSetor;
        inputKet.value = "Setoran hasil penjualan warung / agen";
      } else {
        inputJumlah.placeholder = "Semua sudah lunas (Rp0)";
      }
    } catch (error) {
      inputJumlah.placeholder = "Gagal memuat otomatis. Isi manual.";
      console.error(error);
    }
  } else {
    // Mode tagihan bulanan dikembalikan normal
    inputJumlah.placeholder = "Contoh: 1500000";
    inputKet.placeholder = "Contoh: Setoran tagihan bulanan";
  }
}

async function deleteData(type, id, name) {
  let pesanKonfirmasi = `Apakah Anda yakin ingin menghapus ${name}?`;
  if (type === 'agent') {
    pesanKonfirmasi = `Apakah Anda yakin ingin menghapus ${name}?\n\nSemua riwayat terkait warung ini akan ikut terhapus secara permanen!`;
  }

  const confirmed = await showCustomConfirm(
    "Konfirmasi Hapus Data",
    pesanKonfirmasi,
    true,
    false
  );

  if (!confirmed) return;
  
  try {
    if (type === 'agent') {
      try {
         await supabaseClient.from('stock').delete().eq('AGENT_ID', id);
         await supabaseClient.from('stock').delete().eq('agent_id', id); 
         await supabaseClient.from('sales').delete().eq('AGENT_ID', id);
         await supabaseClient.from('sales').delete().eq('agent_id', id); 
         await supabaseClient.from('payments').delete().eq('AGENT_ID', id);
         await supabaseClient.from('payments').delete().eq('agent_id', id); 
      } catch (err) { 
         console.log("Catatan: Terjadi kendala saat menghapus data relasi di Supabase", err); 
      }
      
      await api('deleteAgent', { id: id });
      toast(`Warung ${name} beserta seluruh riwayatnya berhasil dihapus.`);
      
      await loadAgents();
      await loadStock();
      await loadSales();
      await loadPayments();
      
    } else if (type === 'voucher') {
      await api('deleteVoucher', { id: id });
      toast(`Voucher ${name} berhasil dihapus.`);
      await loadVouchers();

    } else if (type === 'payment') {
      await api('deletePayment', { id: id });
      toast(`Data pembayaran berhasil dihapus.`);
      await loadPayments();
      if (document.getElementById('piutang')?.classList.contains('active')) await loadPiutang();

    } else if (type === 'customer') {
      await api('deleteCustomer', { id: id });
      toast(`Pelanggan ${name} berhasil dihapus.`);
      await loadCustomers();

    } else if (type === 'distributorPayment') {
      await api('deleteDistroPayment', { id: id });
      toast(`Catatan setoran berhasil dihapus.`);
      await loadDistributorPayments();

    } else if (type === 'customerPayments') {
      // --- PERBAIKAN: Menggunakan nama tabel asli 'customer_payments' ---
      const { error } = await supabaseClient
        .from('customer_payments') 
        .delete()
        .eq('id', id); // Mencoba kolom id (huruf kecil)
      
      if (error) {
        // Jika gagal karena masalah huruf besar/kecil, coba kolom ID (huruf besar)
        const { error: err2 } = await supabaseClient
          .from('customer_payments')
          .delete()
          .eq('ID', id);
          
        if (err2) throw err2; // Jika tetap gagal, lemparkan error aslinya
      }
      
      toast(`Riwayat berhasil dihapus.`);
      await loadCustomerPayments(); 
      await loadCustomers(); // Update tampilan tabel utama agar Sisa Tagihan berubah
    }
    
    await loadDashboard();
    
  } catch (error) { 
    // Memunculkan pesan error asli jika masih ada kendala
    alert("Gagal menghapus! Pesan error: " + error.message);
    toast("Gagal menghapus data."); 
  }
}

/* ==================================================
   FITUR PENCARIAN & FILTER TAMBAHAN
   Tidak mengubah fungsi API/data yang sudah ada.
================================================== */
function normalizeSearch(value) {
  return String(value ?? '').toLowerCase().trim();
}

function filterContainerChildren(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;
  const q = normalizeSearch(input.value);
  Array.from(container.children).forEach(el => {
    const text = normalizeSearch(el.textContent);
    el.style.display = !q || text.includes(q) ? '' : 'none';
  });
}
function filterAgents() { filterContainerChildren('agentListContainer', 'searchAgents'); }
function filterStock() { filterContainerChildren('stockCardsContainer', 'searchStock'); }
function filterVouchers() {
  const input=document.getElementById('searchVouchers'), tbody=document.getElementById('voucherTableBody');
  if(!input||!tbody)return; const q=normalizeSearch(input.value);
  Array.from(tbody.querySelectorAll('tr')).forEach(r=>r.style.display=!q||normalizeSearch(r.textContent).includes(q)?'':'none');
}
function parseDisplayedDate(value) {
  const m=String(value||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m)return null; const d=new Date(Number(m[3]),Number(m[2])-1,Number(m[1])); return isNaN(d.getTime())?null:d;
}
function inDateRange(value,fromValue,toValue){
  if(!fromValue&&!toValue)return true; const d=parseDisplayedDate(value); if(!d)return true; d.setHours(0,0,0,0);
  if(fromValue&&d<new Date(fromValue+'T00:00:00'))return false;
  if(toValue&&d>new Date(toValue+'T23:59:59'))return false; return true;
}
function filterTableRows(tbodyId,searchId,fromId,toId){
  const tbody=document.getElementById(tbodyId), input=document.getElementById(searchId); if(!tbody||!input)return;
  const q=normalizeSearch(input.value), from=document.getElementById(fromId), to=document.getElementById(toId), fv=from?from.value:'', tv=to?to.value:'';
  Array.from(tbody.querySelectorAll('tr')).forEach(row=>{
    const text=normalizeSearch(row.textContent), dateCell=row.cells&&row.cells.length?row.cells[0].textContent:'';
    row.style.display=(!q||text.includes(q))&&inDateRange(dateCell,fv,tv)?'':'none';
  });
}
function filterPayments(){filterTableRows('paymentTable','searchPayments','paymentDateFrom','paymentDateTo');}
function filterDistributor(){filterTableRows('distroTableBody','searchDistributor','distributorDateFrom','distributorDateTo');}
function filterCustomerPayments(){
  const tbody=document.getElementById('customerPaymentTable'), input=document.getElementById('searchCustomerPayments'); if(!tbody||!input)return;
  const q=normalizeSearch(input.value), from=document.getElementById('customerPaymentDateFrom'), to=document.getElementById('customerPaymentDateTo'), period=document.getElementById('customerPaymentPeriodFilter');
  const fv=from?from.value:'', tv=to?to.value:'', pv=normalizeSearch(period?period.value:'');
  Array.from(tbody.querySelectorAll('tr')).forEach(row=>{
    const text=normalizeSearch(row.textContent), dateCell=row.cells&&row.cells.length?row.cells[0].textContent:'', periodCell=row.cells&&row.cells.length>2?row.cells[2].textContent:'';
    row.style.display=(!q||text.includes(q))&&(!pv||normalizeSearch(periodCell)===pv)&&inDateRange(dateCell,fv,tv)?'':'none';
  });
}
function populateCustomerPaymentPeriods(){
  const select=document.getElementById('customerPaymentPeriodFilter'), tbody=document.getElementById('customerPaymentTable'); if(!select||!tbody)return;
  const current=select.value, periods=[];
  Array.from(tbody.querySelectorAll('tr')).forEach(row=>{if(row.cells&&row.cells.length>2){const v=String(row.cells[2].textContent||'').trim();if(v&&!periods.includes(v))periods.push(v);}});
  select.innerHTML='<option value="">Semua Periode</option>'+periods.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
  if(periods.includes(current))select.value=current;
}
window.filterCustomers = function() {
  const q = (document.getElementById('searchCustomers')?.value || '').toLowerCase();
  const status = document.getElementById('customerStatusFilter');
  const sv = (status ? status.value : '').toLowerCase();

  // Memfilter dari array sumber
  filteredCustomerData = customerDataArray.filter(c => {
    const textToSearch = (c.nama + ' ' + c.jenis + ' ' + c.tempo + ' ' + c.harga).toLowerCase();
    const matchesQuery = !q || textToSearch.includes(q);
    
    let matchesStatus = true;
    if (sv === 'lunas') matchesStatus = c.lunas;
    if (sv === 'belum') matchesStatus = !c.lunas;

    return matchesQuery && matchesStatus;
  });

  // Tampilkan ke halaman pertama hasil pencarian
  currentCustomerPage = 1; 
  renderCustomerTable();
};
function filterSales(){
  const container=document.getElementById('salesTableContainer'), input=document.getElementById('searchSales'); if(!container||!input)return;
  const q=normalizeSearch(input.value), from=document.getElementById('salesDateFrom'), to=document.getElementById('salesDateTo'), fv=from?from.value:'', tv=to?to.value:'';
  Array.from(container.children).forEach(group=>group.style.display=(!q||normalizeSearch(group.textContent).includes(q))&&inDateRange(group.textContent,fv,tv)?'':'none');
}
function clearSalesFilter(){['searchSales','salesDateFrom','salesDateTo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});filterSales();}
function clearPaymentFilter(){['searchPayments','paymentDateFrom','paymentDateTo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});filterPayments();}
function clearDistributorFilter(){['searchDistributor','distributorDateFrom','distributorDateTo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});filterDistributor();}
function clearCustomerFilter(){const a=document.getElementById('searchCustomers');if(a)a.value='';const b=document.getElementById('customerStatusFilter');if(b)b.value='';filterCustomers();}
function clearCustomerPaymentFilter(){['searchCustomerPayments','customerPaymentDateFrom','customerPaymentDateTo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});const p=document.getElementById('customerPaymentPeriodFilter');if(p)p.value='';filterCustomerPayments();}

const __searchOriginalLoadAgents=loadAgents; loadAgents=async function(){await __searchOriginalLoadAgents();filterAgents();};
const __searchOriginalLoadVouchers=loadVouchers; loadVouchers=async function(){await __searchOriginalLoadVouchers();filterVouchers();};
const __searchOriginalLoadStock=loadStock; loadStock=async function(){await __searchOriginalLoadStock();filterStock();};
const __searchOriginalLoadSales=loadSales; loadSales=async function(){await __searchOriginalLoadSales();filterSales();};
const __searchOriginalLoadPayments=loadPayments; loadPayments=async function(){await __searchOriginalLoadPayments();filterPayments();};
const __searchOriginalLoadDistributorPayments=loadDistributorPayments; loadDistributorPayments=async function(){await __searchOriginalLoadDistributorPayments();filterDistributor();};
const __searchOriginalLoadCustomerPayments=loadCustomerPayments; loadCustomerPayments=async function(){await __searchOriginalLoadCustomerPayments();populateCustomerPaymentPeriods();filterCustomerPayments();};
const __searchOriginalLoadCustomers=loadCustomers; loadCustomers=async function(){await __searchOriginalLoadCustomers();filterCustomers();};

async function resetAllDatabase() {
  const confirmed = await showCustomConfirm(
    "Zona Berbahaya: Reset Database",
    "Anda akan menghapus SELURUH data operasional di dalam database.\n\nTindakan ini tidak dapat dibatalkan!",
    true,
    false
  );

  if (!confirmed) return;
  
  // Konfirmasi lapis kedua menggunakan input teks modern
  const promptVal = await showCustomConfirm(
    "Konfirmasi Keamanan",
    "Ketik kata 'RESET' di bawah ini untuk mengonfirmasi penghapusan total:",
    true,
    true
  );

  if (promptVal !== "RESET") {
    toast("Proses reset dibatalkan. Kata konfirmasi tidak sesuai.");
    return;
  }

  try {
    toast("Sedang membersihkan database...");

    // 1. Hapus semua tabel anak (transaksi/histori) terlebih dahulu
    // Menggunakan .not('id', 'is', null) agar kompatibel dengan semua jenis tipe ID
    await supabaseClient.from('stock').delete().not('id', 'is', null);
    await supabaseClient.from('sales').delete().not('id', 'is', null);
    await supabaseClient.from('payments').delete().not('id', 'is', null);
    await supabaseClient.from('customer_payments').delete().not('id', 'is', null);
    await supabaseClient.from('distributor_payments').delete().not('id', 'is', null); // Tabel ini yang sebelumnya terlewat
    
    // 2. Hapus tabel induk (master data)
    await supabaseClient.from('customers').delete().not('id', 'is', null);
    await supabaseClient.from('agents').delete().not('id', 'is', null);
    await supabaseClient.from('vouchers').delete().not('id', 'is', null);

    toast("Semua data berhasil dibersihkan!");
    
    // Refresh halaman setelah 1.5 detik untuk memastikan seluruh tampilan UI kembali kosong
    setTimeout(() => {
      window.location.reload();
    }, 1500);
    
  } catch (error) {
    console.error(error);
    toast("Terjadi kesalahan saat mereset database: " + error.message);
  }
}

async function setupReportPage() {
  try {
    agents = await api("agents");
    fillSelect("reportFilterAgent", agents, "id", "nama_warung");
  } catch(e) {}
}

async function loadDetailedReport() {
  const agentId = document.getElementById("reportFilterAgent").value;
  const container = document.getElementById('laporanPerTanggalContainer');
  
  container.innerHTML = '<p style="text-align:center; color:#2563eb; font-weight:bold; padding:20px;">Sedang memuat data laporan...</p>';

  try {
    const [agentsData, salesData, paymentsData, vouchersData] = await Promise.all([
      api("agents"),
      api("sales"),
      api("payments"),
      api("vouchers")
    ]);

    let filteredSales = salesData || [];
    let filteredPayments = paymentsData || [];

    if (agentId) {
      filteredSales = filteredSales.filter(s => String(s.agent_id || s.AGENT_ID) === String(agentId));
      filteredPayments = filteredPayments.filter(p => String(p.agent_id || p.AGENT_ID) === String(agentId));
    }

    let totalOmzetRep = 0;
    let totalDibayarRep = 0;
    let dateMapRep = {};

    // Pengelompokan Data: Tanggal -> Warung -> Daftar Transaksi
    filteredSales.forEach(s => {
      const omzet = Number(s.total || s.TOTAL || 0);
      const agenHak = Number(s.agen || s.AGEN || 0);
      totalOmzetRep += omzet;

      const rawDate = s.tanggal || s.TANGGAL;
      const dObj = new Date(rawDate);
      const dateKey = isNaN(dObj) ? "Tanggal Lain" : dObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

      if (!dateMapRep[dateKey]) {
         dateMapRep[dateKey] = {}; // Map untuk menampung per warung
      }

      const agentObj = agentsData.find(a => String(a.id || a.ID) === String(s.agent_id || s.AGENT_ID));
      const agentName = agentObj ? (agentObj.nama_warung || agentObj.NAMA_WARUNG) : 'Warung Lain';

      if (!dateMapRep[dateKey][agentName]) {
         dateMapRep[dateKey][agentName] = { omzet: 0, agen: 0, rincian: [] };
      }
      
      dateMapRep[dateKey][agentName].omzet += omzet;
      dateMapRep[dateKey][agentName].agen += agenHak;

      const vObj = vouchersData.find(v => String(v.id || v.ID) === String(s.voucher_id || s.VOUCHER_ID));

      dateMapRep[dateKey][agentName].rincian.push({
         nama: vObj ? (vObj.nama || vObj.NAMA) : 'Voucher Terhapus',
         jumlah: Number(s.jumlah || s.JUMLAH || 0),
         harga: Number(s.harga || s.HARGA || 0),
         total: omzet,
         distributor: Number(s.distributor || s.DISTRIBUTOR || 0),
         reseller: Number(s.reseller || s.RESELLER || 0),
         agen: agenHak
      });
    });

    filteredPayments.forEach(p => {
       totalDibayarRep += Number(p.jumlah || p.JUMLAH || 0);
    });

    // Hitung rincian global hak keuangan
    let totalAgenGlobal = 0;
    let totalDistributorGlobal = 0;
    let totalResellerGlobal = 0;

    Object.values(dateMapRep).forEach(agentsObj => {
       Object.values(agentsObj).forEach(agentData => {
           totalAgenGlobal += agentData.agen;
           agentData.rincian.forEach(v => {
               totalDistributorGlobal += Number(v.distributor || 0);
               totalResellerGlobal += Number(v.reseller || 0);
           });
       });
    });
    
    const totalWajibSetor = totalOmzetRep - totalAgenGlobal; 
    const sisaPiutangRiil = Math.max(0, totalWajibSetor - totalDibayarRep);
    
    // Terapkan angka ke kartu atas (UI)
    setText('rOmzet', rupiah(totalOmzetRep));
    setText('rGlobalAgen', rupiah(totalAgenGlobal));
    setText('rGlobalReseller', rupiah(totalResellerGlobal));
    setText('rGlobalDistributor', rupiah(totalDistributorGlobal));
    setText('rWajibSetor', rupiah(totalWajibSetor));
    setText('rPiutang', sisaPiutangRiil === 0 ? 'LUNAS (Rp0)' : rupiah(sisaPiutangRiil));
    
    container.innerHTML = "";
    if (Object.keys(dateMapRep).length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#64748b; padding:20px;">Belum ada data penjualan untuk kriteria ini.</p>';
        return;
    }

    // Render Tampilan Berkelompok (1 Kartu per Tanggal -> Berisi Daftar Warung)
    for (let tanggal in dateMapRep) {
        let tanggalOmzetTotal = 0;
        let tanggalSetorTotal = 0;
        let warungCardsHtml = "";

        for (let warungName in dateMapRep[tanggal]) {
            const agentData = dateMapRep[tanggal][warungName];
            const setoranWarung = agentData.omzet - agentData.agen;
            tanggalOmzetTotal += agentData.omzet;
            tanggalSetorTotal += setoranWarung;

            let rowsHtml = "";
            let sumJumlah = 0, sumOmzet = 0, sumDist = 0, sumRes = 0, sumAg = 0;

            agentData.rincian.forEach(v => {
                sumJumlah += v.jumlah;
                sumOmzet += v.total;
                sumDist += v.distributor;
                sumRes += v.reseller;
                sumAg += v.agen;

                rowsHtml += `
                    <tr>
                      <td><strong>${esc(v.nama)}</strong></td>
                      <td>${v.jumlah} Pcs &times; ${rupiah(v.harga)}</td>
                      <td><strong>${rupiah(v.total)}</strong></td>
                      <td style="color:#c2410c; font-weight:bold;">${rupiah(v.distributor)}</td>
                      <td style="color:#7e22ce; font-weight:bold;">${rupiah(v.reseller)}</td>
                      <td style="color:#15803d; font-weight:bold;">${rupiah(v.agen)}</td>
                    </tr>`;
            });

            // Sub-kartu untuk masing-masing warung di tanggal tersebut
            // Sub-kartu menggunakan Accordion Buka-Tutup
            warungCardsHtml += `
            <div class="report-accordion-item">
               <div class="report-accordion-header" onclick="toggleReportAccordion(this)">
                  <div style="display:flex; align-items:center; gap:10px;">
                     <span class="report-accordion-icon">▼</span>
                     <strong style="font-size:14px; color:#1e40af;">🏪 ${esc(warungName)}</strong>
                  </div>
                  <span style="font-size:12px; font-weight:700; color:#16a34a;">Omzet: ${rupiah(agentData.omzet)}</span>
               </div>
               
               <div class="report-accordion-body">
                 <div class='table-wrap'>
                   <table>
                     <thead>
                       <tr>
                         <th>Voucher</th>
                         <th>Kuantitas × Harga</th>
                         <th>Total Omzet</th>
                         <th>Setor Pusat</th>
                         <th>Hak Reseller</th>
                         <th>Hak Agen</th>
                       </tr>
                     </thead>
                     <tbody>
                       ${rowsHtml}
                     </tbody>
                     <tfoot>
                       <tr style="background: #ffffff; font-weight: bold; border-top: 1px solid #e2e8f0;">
                         <td style="padding: 8px; text-align: right; color: #0f172a;">Subtotal:</td>
                         <td style="padding: 8px; color: #2563eb;">${sumJumlah} Pcs</td>
                         <td style="padding: 8px; color: #0f172a;">${rupiah(sumOmzet)}</td>
                         <td style="padding: 8px; color: #c2410c;">${rupiah(sumDist)}</td>
                         <td style="padding: 8px; color: #7e22ce;">${rupiah(sumRes)}</td>
                         <td style="padding: 8px; color: #15803d;">${rupiah(sumAg)}</td>
                       </tr>
                     </tfoot>
                   </table>
                 </div>
               </div>
            </div>`;
        }

        let html = `
        <div class="report-date-card" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:15px; margin-bottom:25px;">
          <div class="report-date-head" style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px dashed #cbd5e1; padding-bottom:12px; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
              <h3 style="margin:0; font-size:16px; color:#0f172a;">📅 Tanggal: ${tanggal}</h3>
              <div class="report-date-summary" style="display:flex; gap:10px;">
                 <span style="background:#f1f5f9; padding:6px 12px; border-radius:8px; font-weight:800; font-size:14px;">Total Omzet: ${rupiah(tanggalOmzetTotal)}</span>
                 <span style="background:#dbeafe; color:#1d4ed8; padding:6px 12px; border-radius:8px; font-weight:800; font-size:14px;">Total Setor: ${rupiah(tanggalSetorTotal)}</span>
              </div>
          </div>
          <div>
             ${warungCardsHtml}
          </div>
        </div>`;
        
        container.innerHTML += html;
    }

  } catch (error) { 
    toast(error.message); 
    container.innerHTML = '<p style="text-align:center; color:#dc2626; padding:20px;">Gagal memuat data laporan.</p>';
  }
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? "");
}

/* =========================================================
   PROFIL & RIWAYAT PELANGGAN
========================================================= */

async function openCustomerDetailModal(customerId) {

  try {

    openModal("customerDetailModal");

    const setDetail = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "-";
    };

    setDetail("detailCustomerNama", "Memuat data...");
    setDetail("detailCustomerStatus", "Memuat...");
    setDetail("detailCustomerJenis", "-");
    setDetail("detailCustomerTarif", "Rp0");
    setDetail("detailCustomerTempo", "-");
    setDetail("detailCustomerKontak", "-");
    setDetail("detailCustomerAlamat", "-");
    setDetail("detailCustomerPeriode", "-");
    setDetail("detailBillAmount", "Rp0");
    setDetail("detailBillPaid", "Rp0");
    setDetail("detailBillRemaining", "Rp0");
    setDetail("detailHistoryCount", "Memuat...");

    const historyBody =
      document.getElementById("detailPaymentHistory");

    if (historyBody) {
      historyBody.innerHTML = `
        <tr>
          <td colspan="4"
              style="text-align:center;padding:25px;color:#64748b;">
            Memuat riwayat pembayaran...
          </td>
        </tr>
      `;
    }

    /* ==============================
       AMBIL DATA PELANGGAN
    ============================== */

    const { data: customer, error: customerError } =
      await supabaseClient
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();

    if (customerError) {
      throw new Error(customerError.message);
    }

    if (!customer) {
      throw new Error("Data pelanggan tidak ditemukan.");
    }

    /* ==============================
       AMBIL RIWAYAT PEMBAYARAN
    ============================== */

    const { data: payments, error: paymentError } =
  await supabaseClient
    .from("customer_payments")
    .select("*")
    .eq("customer_id", customerId);
    if (paymentError) {
      throw new Error(paymentError.message);
    }

    const daftarPembayaran = payments || [];

    /* ==============================
       NORMALISASI DATA PELANGGAN
    ============================== */

    const nama =
      customer.NAMA ||
      customer.nama ||
      "-";

    const jenis =
      customer.JENIS ||
      customer.jenis ||
      "Rumahan";

    const harga =
      Math.max(
        0,
        Number(
          customer.HARGA ||
          customer.harga ||
          0
        )
      );

    const tempo =
      customer.JATUH_TEMPO ??
      customer.jatuh_tempo ??
      customer.tempo ??
      "-";

    const kontak =
      customer.KONTAK ||
      customer.kontak ||
      "";

    const alamat =
      customer.ALAMAT ||
      customer.alamat ||
      "-";

    const status =
      customer.STATUS ||
      customer.status ||
      "AKTIF";

    /* ==============================
       TAMPILKAN DATA
    ============================== */

    setDetail(
      "detailCustomerNama",
      nama
    );

    setDetail(
      "detailCustomerJenis",
      jenis
    );

    setDetail(
      "detailCustomerTarif",
      rupiah(harga)
    );

    setDetail(
      "detailCustomerTempo",
      tempo === "-"
        ? "-"
        : "Tanggal " + tempo
    );

    setDetail(
      "detailCustomerKontak",
      kontak || "-"
    );

    setDetail(
      "detailCustomerAlamat",
      alamat
    );

    setDetail(
      "detailCustomerStatus",
      status === "AKTIF"
        ? "🟢 Pelanggan Aktif"
        : "⚪ " + status
    );

    /* ==============================
       PERIODE BULAN BERJALAN
    ============================== */

    const periode =
      getCurrentBillingPeriod();

    setDetail(
      "detailCustomerPeriode",
      periode
    );

    /* ==============================
       HITUNG PEMBAYARAN BULAN INI
    ============================== */

    const paidBulanIni =
      daftarPembayaran
        .filter(p => {

          const pCustomerId =
            p.CUSTOMER_ID ??
            p.customer_id ??
            p.customerId;

          const pBulan =
            p.BULAN ??
            p.bulan ??
            "";

          return (
            String(pCustomerId) ===
              String(customerId) &&
            String(pBulan)
              .trim()
              .toLowerCase() ===
              periode
                .trim()
                .toLowerCase()
          );

        })
        .reduce((total, p) => {

          const jumlah =
            Number(
              p.JUMLAH ??
              p.jumlah ??
              0
            );

          return total +
            Math.max(0, jumlah);

        }, 0);

    /* ==============================
       SISA TAGIHAN
    ============================== */

    const sisa =
      Math.max(
        0,
        harga - paidBulanIni
      );

    setDetail(
      "detailBillAmount",
      rupiah(harga)
    );

    setDetail(
      "detailBillPaid",
      rupiah(paidBulanIni)
    );

    setDetail(
      "detailBillRemaining",
      rupiah(sisa)
    );

    /* ==============================
       STATUS TAGIHAN
    ============================== */

    const billStatus =
      document.getElementById(
        "detailCustomerBillStatus"
      );

    if (billStatus) {

      if (sisa <= 0) {

        billStatus.innerHTML = `
          <span style="
            background:#dcfce7;
            color:#166534;
            padding:7px 12px;
            border-radius:8px;
            font-size:12px;
            font-weight:900;
          ">
            ✓ LUNAS
          </span>
        `;

      } else if (paidBulanIni > 0) {

        billStatus.innerHTML = `
          <span style="
            background:#fef3c7;
            color:#92400e;
            padding:7px 12px;
            border-radius:8px;
            font-size:12px;
            font-weight:900;
          ">
            ⚠ BAYAR SEBAGIAN
          </span>
        `;

      } else {

        billStatus.innerHTML = `
          <span style="
            background:#fee2e2;
            color:#991b1b;
            padding:7px 12px;
            border-radius:8px;
            font-size:12px;
            font-weight:900;
          ">
            ✕ BELUM BAYAR
          </span>
        `;

      }

    }

    /* ==============================
       TOMBOL BAYAR
    ============================== */

    const bayarBtn =
      document.getElementById(
        "detailBayarBtn"
      );

    if (bayarBtn) {

      if (sisa > 0) {

        bayarBtn.style.display =
          "inline-flex";

        bayarBtn.onclick = function() {

          closeModal(
            "customerDetailModal"
          );

          openCustomerPayModal(
            customerId,
            nama,
            sisa
          );

        };

      } else {

        bayarBtn.style.display =
          "none";

      }

    }

    /* ==============================
       TOMBOL WHATSAPP
    ============================== */

    const waBtn =
      document.getElementById(
        "detailWhatsappBtn"
      );

    if (waBtn) {

      if (kontak && sisa > 0) {

        waBtn.style.display =
          "inline-flex";

        waBtn.onclick = function() {

          let nomor =
            String(kontak)
              .replace(/\D/g, "");

          if (nomor.startsWith("0")) {

            nomor =
              "62" +
              nomor.substring(1);

          }

          const pesan =
            `Halo Bpk/Ibu, ${nama}, kami mengingatkan bahwa ` +
            `tagihan layanan internet bulan ${periode} ` +
            `sebesar ${rupiah(sisa)} belum lunas. ` +
            `Mohon melakukan pembayaran, agar internetanya makin nyaman dan lancar. ` +
            `Terima kasih.`;

          window.open(
            "https://wa.me/" +
            nomor +
            "?text=" +
            encodeURIComponent(pesan),
            "_blank"
          );

        };

      } else {

        waBtn.style.display =
          "none";

      }

    }

    /* ==============================
       RIWAYAT PEMBAYARAN
    ============================== */

    setDetail(
      "detailHistoryCount",
      daftarPembayaran.length +
      " transaksi"
    );

    if (!historyBody) {
      return;
    }

    if (daftarPembayaran.length === 0) {

      historyBody.innerHTML = `
        <tr>
          <td colspan="4"
              style="
                text-align:center;
                padding:30px;
                color:#64748b;
              ">
            Belum ada riwayat pembayaran.
          </td>
        </tr>
      `;

    } else {

      historyBody.innerHTML =
        daftarPembayaran
          .map(p => {

            const tanggal =
              p.created_at
                ? new Date(
                    p.created_at
                  ).toLocaleDateString(
                    "id-ID",
                    {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric"
                    }
                  )
                : "-";

            const bulan =
              p.BULAN ||
              p.bulan ||
              "-";

            const keterangan =
              p.KETERANGAN ||
              p.keterangan ||
              "-";

            const jumlah =
              Math.max(
                0,
                Number(
                  p.JUMLAH ??
                  p.jumlah ??
                  0
                )
              );

            return `
              <tr>

                <td>
                  ${esc(tanggal)}
                </td>

                <td>
                  <span style="
                    background:#eff6ff;
                    color:#1d4ed8;
                    padding:4px 8px;
                    border-radius:6px;
                    font-size:11px;
                    font-weight:800;
                  ">
                    ${esc(bulan)}
                  </span>
                </td>

                <td>
                  ${esc(keterangan)}
                </td>

                <td style="
                  text-align:right;
                  font-weight:900;
                  color:#16a34a;
                ">
                  ${rupiah(jumlah)}
                </td>

              </tr>
            `;

          })
          .join("");

    }

  } catch (error) {

    console.error(
      "Gagal membuka profil pelanggan:",
      error
    );

    toast(
      "Gagal memuat profil pelanggan: " +
      error.message
    );

    closeModal(
      "customerDetailModal"
    );

  }

}

function openCustomerPayModal(id, nama, harga) {
  document.getElementById("payCustId").value = id;
  document.getElementById("payCustNama").value = nama;
  document.getElementById("payCustJumlah").value = Math.max(0, Number(harga) || 0);
  
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const now = new Date();
  document.getElementById("payCustBulan").value = months[now.getMonth()] + " " + now.getFullYear();

  openModal("customerPayModal");
}

async function saveCustomerPayment() {
  try {
    await api("addCustomerPayment", {
      customerId: document.getElementById("payCustId").value,
      bulan: document.getElementById("payCustBulan").value,
      jumlah: document.getElementById("payCustJumlah").value,
      keterangan: document.getElementById("payCustKeterangan").value
    });

    closeModal("customerPayModal");
    toast("Pembayaran iuran pelanggan berhasil dicatat!");
    await loadCustomers();
    await loadDashboard();
    if (document.getElementById('piutang')?.classList.contains('active')) await loadPiutang();
  } catch (error) {
    toast(error.message);
  }
}

// --- FUNGSI MEMBUKA MODAL EDIT VOUCHER ---
function openEditVoucher(id, nama, harga, distributor, reseller, agen) {
  document.getElementById('editVoucherId').value = id;
  document.getElementById('editVoucherNama').value = nama;
  document.getElementById('editVoucherHarga').value = harga;
  document.getElementById('editVoucherDistributor').value = distributor;
  document.getElementById('editVoucherReseller').value = reseller;
  document.getElementById('editVoucherAgen').value = agen;
  openModal('editVoucherModal');
}

// --- FUNGSI MENYIMPAN PERUBAHAN VOUCHER ---
async function updateVoucher() {
  try {
    const id = document.getElementById('editVoucherId').value;
    const nama = document.getElementById('editVoucherNama').value.trim();
    const harga = Number(document.getElementById('editVoucherHarga').value);
    const distributor = Number(document.getElementById('editVoucherDistributor').value);
    const reseller = Number(document.getElementById('editVoucherReseller').value);
    const agen = Number(document.getElementById('editVoucherAgen').value);

    if (!nama || harga <= 0) {
      toast("Nama dan harga voucher harus diisi dengan benar!"); 
      return;
    }
    
    // Validasi tambahan agar sinkron dengan saat "Tambah"
    if (distributor + reseller + agen !== harga) { 
      toast("Bagi hasil harus sama dengan harga voucher"); 
      return; 
    }

    // Mengupdate data ke Supabase langsung
    const { error } = await supabaseClient
      .from('vouchers')
      .update({ nama: nama, harga: harga, distributor: distributor, reseller: reseller, agen: agen })
      .eq('id', id);

    // Fallback jika ternyata kolom database pakai huruf besar
    if (error) {
      const { error: err2 } = await supabaseClient
        .from('vouchers')
        .update({ NAMA: nama, HARGA: harga, DISTRIBUTOR: distributor, RESELLER: reseller, AGEN: agen })
        .eq('ID', id);
      if (err2) throw err2;
    }

    closeModal('editVoucherModal');
    toast("Voucher berhasil diperbarui!");
    
    // Refresh tabel otomatis
    await loadVouchers(); 
  } catch (error) { 
    toast("Gagal mengupdate voucher: " + error.message); 
  }
}

function showCustomConfirm(title, message, isDanger = true, requiresInput = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customConfirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const iconEl = document.getElementById('confirmIcon');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const inputWrapper = document.getElementById('confirmInputWrapper');
    const inputEl = document.getElementById('confirmPromptInput');

    titleEl.textContent = title;
    msgEl.textContent = message;
    iconEl.textContent = isDanger ? '⚠️' : '💡';
    
    okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
    okBtn.textContent = isDanger ? 'Ya, Hapus' : 'Ya, Lanjutkan';

    if (requiresInput) {
      inputWrapper.style.display = 'block';
      inputEl.value = '';
    } else {
      inputWrapper.style.display = 'none';
    }

    modal.classList.add('show');
    if (requiresInput) inputEl.focus();

    // Bersihkan event listener lama agar tidak menumpuk
    const newOkBtn = okBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newOkBtn.addEventListener('click', () => {
      modal.classList.remove('show');
      if (requiresInput) {
        resolve(inputEl.value);
      } else {
        resolve(true);
      }
    });

    newCancelBtn.addEventListener('click', () => {
      modal.classList.remove('show');
      resolve(requiresInput ? null : false);
    });
  });
}

// Fungsi untuk memunculkan modal edit dan mengisi datanya
function openEditAgentModal(id, nama, pemilik, alamat, hp) {
  document.getElementById('editAgentId').value = id;
  document.getElementById('editAgentNama').value = nama !== '-' ? nama : '';
  document.getElementById('editAgentPemilik').value = pemilik !== '-' ? pemilik : '';
  document.getElementById('editAgentAlamat').value = alamat !== '-' ? alamat : '';
  document.getElementById('editAgentHP').value = hp !== '-' ? hp : '';
  openModal('editAgentModal');
}

// Fungsi untuk menyimpan perubahan ke Supabase
async function updateAgent() {
  try {
    const id = document.getElementById("editAgentId").value;
    const nama = document.getElementById("editAgentNama").value;
    const pemilik = document.getElementById("editAgentPemilik").value;
    const hp = document.getElementById("editAgentHP").value;
    const alamat = document.getElementById("editAgentAlamat").value;

    // Perintah update ke Supabase
    const { error: errUpdA } = await supabaseClient
      .from('agents')
      .update({
         nama_warung: nama,
         pemilik: pemilik,
         hp: hp,
         alamat: alamat
      })
      .eq('id', id);

    if (errUpdA) throw new Error(errUpdA.message);

    closeModal("editAgentModal");
    toast("Data warung berhasil diperbarui");
    await loadAgents(); // Memuat ulang daftar warung
    await loadDashboard();
  } catch (error) { 
    toast(error.message); 
  }
}

function toggleReportAccordion(headerElement) {
  const item = headerElement.parentElement;
  item.classList.toggle('active');
}
