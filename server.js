// file: server.js
'use strict';

// Impor modul yang diperlukan
require('dotenv').config();
const Hapi = require('@hapi/hapi');
const Boom = require('@hapi/boom');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');

// --- KONFIGURASI APLIKASI ---
const config = {
    port: process.env.PORT || 3000,
    host: 'localhost',
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-1.5-flash', // Model yang lebih baru dan efisien
    },
    prompt: {
        fileName: 'elevator.txt',
        directory: 'k3_knowledge',
    }
};

// Validasi API Key saat start-up
if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY tidak ditemukan di file .env");
}

// Inisialisasi Google Generative AI
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model = genAI.getGenerativeModel({ model: config.gemini.model });

/**
 * Helper untuk mencari item inspeksi spesifik dalam struktur data laporan.
 * @param {object} inspectionData - Objek `inspectionAndTesting` dari JSON.
 * @param {string} componentName - Nama komponen yang dicari (e.g., "Rem mekanik").
 * @returns {{status: string, result: string}} - Objek berisi status dan hasil.
 */
const findInspectionItem = (inspectionData, componentName) => {
    for (const category of Object.values(inspectionData)) {
        if (Array.isArray(category)) {
            const item = category.find(i => i.component && i.component.toLowerCase() === componentName.toLowerCase());
            if (item) return { status: item.status || 'N/A', result: item.result || 'N/A' };
        }
    }
    return { status: 'Data Tidak Ditemukan', result: `Komponen "${componentName}" tidak ada dalam laporan.` };
};

/**
 * Mengekstrak data dari JSON laporan dan memetakannya ke format yang dibutuhkan oleh prompt.
 * @param {object} reportJson - JSON lengkap dari laporan inspeksi.
 * @returns {object} - Objek yang berisi data yang siap untuk dimasukkan ke dalam prompt.
 */
const extractDataForPrompt = (reportJson) => {
    const { generalData, inspectionAndTesting } = reportJson;
    if (!generalData || !inspectionAndTesting) {
        throw new Error('Struktur "inspectionReportJson" tidak valid. "generalData" atau "inspectionAndTesting" tidak ditemukan.');
    }
    
    return {
        ownerName: generalData.companyName,
        usageLocationName: generalData.usageLocation,
        inspectionDate: generalData.inspectionDate,
        machineMounting_status: findInspectionItem(inspectionAndTesting, 'Dudukan Mesin').status,
        machineMounting_result: findInspectionItem(inspectionAndTesting, 'Dudukan Mesin').result,
        mechanicalBrake_status: findInspectionItem(inspectionAndTesting, 'Rem mekanik').status,
        mechanicalBrake_result: findInspectionItem(inspectionAndTesting, 'Rem mekanik').result,
        machineRoomDoor_status: findInspectionItem(inspectionAndTesting, 'Pintu Kamar Mesin').status,
        machineRoomDoor_result: findInspectionItem(inspectionAndTesting, 'Pintu Kamar Mesin').result,
        fireExtinguisher_status: findInspectionItem(inspectionAndTesting, 'Tersedia alat pemadam api ringan').status,
        fireExtinguisher_result: findInspectionItem(inspectionAndTesting, 'Tersedia alat pemadam api ringan').result,
        suspensionRopes_condition_status: findInspectionItem(inspectionAndTesting, 'Kondisi Tali/Sabuk Penggantung').status,
        suspensionRopes_condition_result: findInspectionItem(inspectionAndTesting, 'Kondisi Tali/Sabuk Penggantung').result,
        hoistway_cleanliness_status: findInspectionItem(inspectionAndTesting, 'Ruang luncur, ruang atas dan lekuk dasar').status,
        hoistway_cleanliness_result: findInspectionItem(inspectionAndTesting, 'Ruang luncur, ruang atas dan lekuk dasar').result,
        hoistwayDoorInterlock_status: findInspectionItem(inspectionAndTesting, 'Interlock Pintu Pendaratan').status,
        hoistwayDoorInterlock_result: findInspectionItem(inspectionAndTesting, 'Interlock Pintu Pendaratan').result,
        floorLeveling_status: findInspectionItem(inspectionAndTesting, 'Kerataan lantai').status,
        floorLeveling_result: findInspectionItem(inspectionAndTesting, 'Kerataan lantai').result,
        carDoor_status: findInspectionItem(inspectionAndTesting, 'Sensor Pintu Kereta').status,
        carDoor_result: findInspectionItem(inspectionAndTesting, 'Sensor Pintu Kereta').result,
        emergencyLighting_status: findInspectionItem(inspectionAndTesting, 'Lampu Darurat').status,
        emergencyLighting_result: findInspectionItem(inspectionAndTesting, 'Lampu Darurat').result,
        intercom_status: findInspectionItem(inspectionAndTesting, 'Intercom').status,
        intercom_result: findInspectionItem(inspectionAndTesting, 'Intercom').result,
        backupPowerARD_status: findInspectionItem(inspectionAndTesting, 'ARD').status,
        backupPowerARD_result: findInspectionItem(inspectionAndTesting, 'ARD').result,
        safetyBrakeOperation_status: findInspectionItem(inspectionAndTesting, 'Rem Pengaman (Safety Gear)').status,
        safetyBrakeOperation_result: findInspectionItem(inspectionAndTesting, 'Rem Pengaman (Safety Gear)').result,
        limitSwitch_status: findInspectionItem(inspectionAndTesting, 'Saklar Lintas Batas').status,
        limitSwitch_result: findInspectionItem(inspectionAndTesting, 'Saklar Lintas Batas').result,
    };
};

/**
 * Mengisi template prompt dengan data yang diekstrak.
 * @param {string} template - String template prompt dari file .txt.
 * @param {object} data - Data yang diekstrak oleh `extractDataForPrompt`.
 * @returns {string} - Prompt yang sudah terisi lengkap.
 */
const populatePrompt = (template, data) => {
    let populatedPrompt = template;
    for (const [key, value] of Object.entries(data)) {
        // Menggunakan RegExp global (/g) untuk mengganti semua kemunculan placeholder
        populatedPrompt = populatedPrompt.replace(new RegExp(`{${key}}`, 'g'), value || 'N/A');
    }
    return populatedPrompt;
};

/**
 * Mengirim prompt ke Gemini AI dan mengembalikan hasilnya.
 * @param {string} finalPrompt - Prompt yang sudah siap dikirim.
 * @returns {Promise<string>} - Teks laporan yang dihasilkan oleh AI.
 */
const generateReportFromAi = async (finalPrompt) => {
    console.log('Mengirim prompt ke Gemini...');
    const result = await model.generateContent(finalPrompt);
    const response = await result.response;
    console.log('Berhasil menerima respons dari Gemini.');
    return response.text();
};

/**
 * Fungsi utama untuk inisialisasi dan menjalankan server Hapi.
 */
const init = async () => {
    const server = Hapi.server({
        port: config.port,
        host: config.host,
    });

    server.route({
        method: 'POST',
        path: '/generate-inspection-report',
        handler: async (request, h) => {
            try {
                const { inspectionReportJson } = request.payload;

                if (!inspectionReportJson) {
                    return Boom.badRequest('Request body harus menyertakan "inspectionReportJson".');
                }

                // 1. Muat template prompt dari file
                const promptFilePath = path.join(__dirname, config.prompt.directory, config.prompt.fileName);
                const promptTemplate = await fs.readFile(promptFilePath, 'utf8');
                
                // 2. Ekstrak dan petakan data dari JSON input
                const promptData = extractDataForPrompt(inspectionReportJson);
                
                // 3. Isi template prompt dengan data yang relevan
                const finalPrompt = populatePrompt(promptTemplate, promptData);

                // 4. Hasilkan laporan menggunakan AI
                const reportText = await generateReportFromAi(finalPrompt);

                return h.response({
                    status: 'success',
                    generated_report: reportText
                }).code(200);

            } catch (error) {
                console.error('Terjadi kesalahan fatal:', error);
                // Mengembalikan kesalahan yang lebih spesifik jika memungkinkan
                if (error.message.includes('tidak ditemukan')) {
                    return Boom.badRequest(error.message);
                }
                return Boom.internal('Terjadi kesalahan pada server.', { detail: error.message });
            }
        }
    });

    await server.start();
    console.log(`✅ Server Hapi berjalan di: ${server.info.uri}`);
    console.log(`   Endpoint Generator Laporan: POST ${server.info.uri}/generate-inspection-report`);
};

process.on('unhandledRejection', (err) => {
    console.error("Unhandled Rejection:", err);
    process.exit(1);
});

init();