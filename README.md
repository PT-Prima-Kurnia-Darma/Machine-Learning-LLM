# Generator Inspeksi K3 Berbasis VertexAI

![Node.js](https://img.shields.io/badge/Node.js-21.7.2-339933?style=for-the-badge&logo=node.js)
![Hapi.js](https://img.shields.io/badge/Hapi.js-Framework-orange?style=for-the-badge&logo=hapi)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)
![Vertex AI](https://img.shields.io/badge/Vertex_AI-Gemini_2.5-blueviolet?style=for-the-badge&logo=google-cloud)

## Deskripsi Proyek

Proyek ini merupakan implementasi layanan *backend* yang memiliki fungsionalitas untuk melakukan analisis dan penyusunan laporan inspeksi K3 (Keselamatan dan Kesehatan Kerja) secara otomatis. Sistem dirancang untuk menerima data masukan berformat JSON, memprosesnya menggunakan model bahasa skala besar (*Large Language Model*), dan menghasilkan laporan akhir yang terstruktur, mencakup kesimpulan kelayakan dan rekomendasi teknis.

## Arsitektur dan Landasan Teknologi

Solusi ini dikembangkan dengan mengadopsi arsitektur **Retrieval-Augmented Generation (RAG)**. Pendekatan ini dipilih untuk memastikan bahwa output yang dihasilkan oleh model AI tidak hanya koheren secara linguistik, tetapi juga akurat secara faktual berdasarkan basis pengetahuan yang relevan.

Komponen teknologi utama yang digunakan adalah sebagai berikut:

1.  **Layanan *Backend***: Diimplementasikan menggunakan **Node.js** (v18.x) dengan *framework* **Hapi.js**. Arsitektur ini menyediakan *endpoint* API yang robusta dan efisien untuk menangani permintaan dari klien.

2.  **Model *Generative AI***: Memanfaatkan model **Gemini 1.5 Flash**, salah satu model fondasi terbaru dari Google, yang diakses melalui platform *Managed AI* **Google Cloud Vertex AI**.

3.  ***Retrieval-Augmented Generation* (RAG)**: Arsitektur RAG pada proyek ini terdiri dari tiga tahapan utama:
    * **Tahap *Retrieval* (Akuisisi Data)**: Sistem secara dinamis mengakuisisi dokumen basis pengetahuan (misalnya, regulasi atau standar operasional prosedur) dari direktori lokal `k3_knowledge/`. Proses ini dipicu oleh atribut `equipmentType` pada *payload* permintaan.
    * **Tahap *Augmented* (Augmentasi Konteks)**: Informasi yang telah diakuisisi dari basis pengetahuan tersebut kemudian diintegrasikan ke dalam sebuah *prompt* yang dirancang secara spesifik. *Prompt* ini juga berisi data temuan inspeksi dari klien.
    * **Tahap *Generation* (Generasi Teks)**: *Prompt* yang telah diperkaya dengan konteks tersebut kemudian dikirimkan ke model Gemini. Model memanfaatkan informasi tambahan ini untuk menghasilkan teks keluaran (kesimpulan dan rekomendasi) yang presisi dan relevan dengan konteks inspeksi.

## Alur Kerja Sistem

Proses operasional sistem, mulai dari penerimaan permintaan hingga pengiriman respons, mengikuti alur kerja berikut:

1.  **Inisiasi Permintaan**: Klien menginisiasi permintaan `POST` ke *endpoint* `/llm-generate` dengan menyertakan *payload* JSON yang memuat data inspeksi.
2.  **Akuisisi Pengetahuan**: Berdasarkan nilai `equipmentType` dari *payload*, sistem melakukan akuisisi konten dari berkas `.txt` yang bersesuaian di dalam direktori `k3_knowledge/`.
3.  **Agregasi Temuan**: Sistem memproses objek `inspectionAndTesting` dari *payload* untuk mengidentifikasi dan meringkas temuan-temuan yang tidak memenuhi standar (`status: false`).
4.  **Rekayasa *Prompt***: Sebuah *prompt* dinamis direkayasa, mengombinasikan instruksi, basis pengetahuan yang telah diakuisisi, ringkasan temuan, dan aturan format keluaran.
5.  **Inferensi Model AI**: *Prompt* final dikirimkan ke *endpoint* model Gemini 1.5 Flash melalui Vertex AI SDK untuk proses inferensi.
6.  **Penyajian Respons**: Model menghasilkan respons berformat JSON yang divalidasi dan kemudian dikirimkan kembali kepada klien dengan kode status `200 OK`.

## Struktur Direktori Proyek

```
.
├── k3_knowledge/
│   ├── eskalator.txt      # Basis pengetahuan untuk jenis peralatan Eskalator
│   └── forklift.txt       # Basis pengetahuan untuk jenis peralatan Forklift
├── .env.example           # Templat untuk konfigurasi variabel lingkungan
├── .gitignore
├── package.json
├── README.md
└── server.js              # Logika inti aplikasi, routing, dan handler
```

## Panduan Instalasi dan Konfigurasi

Untuk menjalankan layanan ini pada lingkungan lokal, ikuti prosedur di bawah ini.

1.  **Kloning Repositori**
    Lakukan kloning terhadap repositori proyek dari GitHub.
    ```bash
    git clone [https://github.com/PT-Prima-Kurnia-Darma/Machine-Learning-LLM.git](https://github.com/PT-Prima-Kurnia-Darma/Machine-Learning-LLM.git)
    cd Machine-Learning-LLM
    ```

2.  **Instalasi Dependensi**
    Instal seluruh dependensi yang tercantum dalam `package.json`.
    ```bash
    npm install
    ```

3.  **Autentikasi Google Cloud**
    Pastikan Google Cloud CLI telah terinstal dan terautentikasi. Lakukan konfigurasi *Application Default Credentials* (ADC).
    ```bash
    gcloud auth application-default login
    ```

4.  **Konfigurasi Variabel Lingkungan**
    Duplikasi berkas `.env.example` menjadi `.env`.
    ```bash
    cp .env.example .env
    ```
    Selanjutnya, modifikasi berkas `.env` dan masukkan nilai yang sesuai.
    ```
    GCP_PROJECT_ID="proyek-google-cloud-anda"
    GCP_LOCATION="asia-southeast1"
    PORT=3000
    ```

5.  **Menjalankan Layanan**
    Inisiasi server Node.js.
    ```bash
    node server.js
    ```
    Layanan akan aktif dan dapat diakses pada `http://localhost:3000`.

## Dokumentasi API

### POST `/llm-generate`

Titik akhir (*endpoint*) ini berfungsi untuk memproses data inspeksi dan menghasilkan laporan.

-   **Metode**: `POST`
-   **Header**: `Content-Type: application/json`
-   **Badan Permintaan (*Body*)**: Objek JSON

**Contoh *Payload* Permintaan:**
```json
{
    "equipmentType": "Eskalator Penumpang",
    "generalData": {
        "location": "Gedung A, Lantai 2"
    },
    "inspectionAndTesting": {
        "visualCheck": {
            "handrail": { "result": "Baik", "status": true },
            "steps": { "result": "Baik", "status": true }
        },
        "functionTest": {
            "emergencyStop": { "result": "Berfungsi normal", "status": true },
            "brake": { "result": "Tidak berfungsi", "status": false, "notes": "Rem darurat gagal saat diuji." }
        }
    }
}
```

**Contoh Respons (Status: TIDAK LAYAK):**
```json
{
    "conclusion": "Berdasarkan hasil pemeriksaan dan pengujian, ditemukan beberapa ketidaksesuaian pada Eskalator Penumpang yang menyebabkannya dinyatakan TIDAK LAYAK dan memerlukan perbaikan segera.",
    "recommendation": [
        "1. STOP OPERASIONAL untuk mencegah risiko kecelakaan.",
        "2. Segera perbaiki rem darurat yang tidak berfungsi untuk mencegah kegagalan total saat terjadi masalah, sesuai standar keselamatan."
    ]
}
```

## Ekstensibilitas Basis Pengetahuan

Sistem ini dirancang untuk dapat diperluas guna mendukung jenis peralatan baru. Untuk menambahkan basis pengetahuan, buat sebuah berkas `.txt` baru di dalam direktori `k3_knowledge/`.

-   **Penamaan Berkas**: Nama berkas harus diawali dengan kata kunci utama dari jenis peralatan (dalam format *lowercase*). Contoh: untuk peralatan "Crane Darat", nama berkas yang valid adalah `crane.txt`.
-   **Isi Berkas**: Berkas harus berisi himpunan standar, regulasi, dan informasi teknis relevan yang akan digunakan oleh model AI sebagai referensi kontekstual.

---
Dokumentasi ini disusun oleh Tim Machine Learning PT. Prima Kurnia Darma.