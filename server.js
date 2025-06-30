// file: server.js
'use strict';

// =================================================================
// BAGIAN 1: IMPOR MODUL YANG DIBUTUHKAN
// =================================================================
require('dotenv').config();
const Hapi = require('@hapi/hapi');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises; // Menggunakan 'fs' untuk membaca file
const path = require('path');     // Menggunakan 'path' untuk menangani path file

// =================================================================
// BAGIAN 2: INISIALISASI KLIEN GEMINI
// =================================================================
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
// Kita gunakan model 2.5 Flash yang terbaru dan efisien
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// =================================================================
// BAGIAN 3: FUNGSI UTAMA SERVER HAPI
// =================================================================
const init = async () => {
    const server = Hapi.server({
        port: 3000,
        host: 'localhost',
    });

    // --- Definisi Endpoint Generator Laporan Inspeksi ---
    server.route({
        method: 'POST',
        path: '/generate-laporan-inspeksi',
        handler: async (request, h) => {
            try {
                // 1. MENERIMA DATA DARI KLIEN (POSTMAN/APLIKASI MOBILE)
                const { jenis_inspeksi, catatan_lapangan } = request.payload;

                if (!jenis_inspeksi || !catatan_lapangan) {
                    return h.response({ status: 'gagal', pesan: 'Request body harus menyertakan "jenis_inspeksi" dan "catatan_lapangan".' }).code(400);
                }
                console.log(`Menerima permintaan untuk laporan [${jenis_inspeksi}]`);

                // 2. SELEKSI KONTEKS DINAMIS (MEMBACA FILE PENGETAHUAN)
                const direktoriPengetahuan = 'data-pengetahuan-k3';
                const namaFilePengetahuan = `${jenis_inspeksi}.txt`;
                const pathFile = path.join(__dirname, direktoriPengetahuan, namaFilePengetahuan);
                
                let konteksSpesifik = '';
                try {
                    konteksSpesifik = await fs.readFile(pathFile, 'utf8');
                    console.log(`Berhasil memuat "Buku Aturan" dari: ${namaFilePengetahuan}`);
                } catch (fileError) {
                    console.error(`Gagal memuat file pengetahuan untuk: ${jenis_inspeksi}. Pastikan file ada di folder yang benar.`);
                    return h.response({ status: 'gagal', pesan: `Jenis inspeksi "${jenis_inspeksi}" tidak valid atau file pengetahuannya tidak ditemukan.` }).code(400);
                }

                // 3. PERAKITAN PROMPT FINAL YANG CERDAS
                // Ini adalah "otak" dari sistem kita, tempat kita menggabungkan semua informasi.
                const promptFinal = `
                    PERAN: Anda adalah seorang Insinyur K3 senior yang sangat teliti dan berpengalaman.
                    TUGAS: Buat laporan inspeksi teknis berdasarkan "Catatan Lapangan" dari teknisi dan "Buku Aturan" yang saya berikan.
                    OUTPUT: Anda HARUS menghasilkan respons dalam format JSON yang valid tanpa tambahan teks lain.

                    --- BUKU ATURAN & MATRIKS KEPUTUSAN (Konteks Anda) ---
                    ${konteksSpesifik}
                    ------------------------------------------------------

                    --- CATATAN LAPANGAN (Data yang perlu dianalisis) ---
                    ${catatan_lapangan}
                    ---------------------------------------------------------

                    INSTRUKSI FINAL:
                    1. Analisis setiap poin dalam "Catatan Lapangan".
                    2. Bandingkan setiap poin dengan "Buku Aturan" untuk menentukan tingkat risiko dan rekomendasi yang sesuai.
                    3. Buatlah "ringkasan_inspeksi" yang mencerminkan kondisi keseluruhan.
                    4. Isi "temuan_kritis" hanya dengan masalah yang ditemukan. Jika tidak ada masalah, biarkan array ini kosong.
                    5. Isi "rekomendasi_tindakan" dengan saran konkret berdasarkan temuan.
                    6. Hasilkan JSON dengan struktur persis seperti ini:
                    {
                      "ringkasan_inspeksi": "...",
                      "temuan_kritis": [
                        { "poin_temuan": "...", "tingkat_risiko": "Tinggi/Sedang/Rendah/Kritis" }
                      ],
                      "rekomendasi_tindakan": [
                        "..."
                      ]
                    }
                `;

                // 4. PANGGIL GEMINI API DAN PARSING HASIL
                console.log('Mengirim prompt final ke Gemini...');
                const result = await model.generateContent(promptFinal);
                const responseFromAI = await result.response;
                let text = responseFromAI.text().replace(/```json/g, '').replace(/```/g, '').trim();
                
                const laporanJSON = JSON.parse(text);
                console.log('Berhasil menerima dan mem-parsing laporan terstruktur dari Gemini.');

                return h.response({ status: 'sukses', laporan: laporanJSON }).code(200);

            } catch (error) {
                console.error('Terjadi kesalahan fatal:', error);
                return h.response({ status: 'gagal', pesan: 'Terjadi kesalahan internal pada server. Mungkin output dari AI bukan JSON yang valid.' }).code(500);
            }
        }
    });

    await server.start();
    console.log(`✅ Server Hapi berjalan di: ${server.info.uri}`);
    console.log(`   Endpoint Generator Laporan: POST ${server.info.uri}/generate-laporan-inspeksi`);
};

process.on('unhandledRejection', (err) => {
    console.log(err); process.exit(1);
});

init();