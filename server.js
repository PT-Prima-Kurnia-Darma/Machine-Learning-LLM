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
 * Mengekstrak data dari JSON laporan dan memetakannya ke format yang dibutuhkan oleh prompt.
 * Fungsi ini disesuaikan dengan struktur JSON yang baru.
 * @param {object} reportJson - JSON lengkap dari laporan inspeksi.
 * @returns {object} - Objek yang berisi data yang siap untuk dimasukkan ke dalam prompt.
 */
const extractDataForPrompt = (reportJson) => {
    const { generalData, inspectionAndTesting } = reportJson;
    if (!generalData || !inspectionAndTesting) {
        throw new Error('Struktur "inspectionReportJson" tidak valid. "generalData" atau "inspectionAndTesting" tidak ditemukan.');
    }

    // Menggunakan optional chaining (?.) untuk mencegah error jika ada properti yang tidak ada
    return {
        ownerName: generalData?.owner?.name,
        usageLocationName: generalData?.usageLocation?.name,
        inspectionDate: generalData?.inspectionDate,
        machineMounting_status: inspectionAndTesting?.machineRoomAndMachinery?.machineMounting?.status,
        machineMounting_result: inspectionAndTesting?.machineRoomAndMachinery?.machineMounting?.result,
        mechanicalBrake_status: inspectionAndTesting?.machineRoomAndMachinery?.mechanicalBrake?.status,
        mechanicalBrake_result: inspectionAndTesting?.machineRoomAndMachinery?.mechanicalBrake?.result,
        machineRoomDoor_status: inspectionAndTesting?.machineRoomAndMachinery?.machineRoomDoor?.status,
        machineRoomDoor_result: inspectionAndTesting?.machineRoomAndMachinery?.machineRoomDoor?.result,
        fireExtinguisher_status: inspectionAndTesting?.machineRoomAndMachinery?.fireExtinguisher?.status,
        fireExtinguisher_result: inspectionAndTesting?.machineRoomAndMachinery?.fireExtinguisher?.result,
        suspensionRopes_condition_status: inspectionAndTesting?.suspensionRopesAndBelts?.condition?.status,
        suspensionRopes_condition_result: inspectionAndTesting?.suspensionRopesAndBelts?.condition?.result,
        hoistway_cleanliness_status: inspectionAndTesting?.hoistwayAndPit?.cleanliness?.status,
        hoistway_cleanliness_result: inspectionAndTesting?.hoistwayAndPit?.cleanliness?.result,
        hoistwayDoorInterlock_status: inspectionAndTesting?.hoistwayAndPit?.hoistwayDoorInterlock?.status,
        hoistwayDoorInterlock_result: inspectionAndTesting?.hoistwayAndPit?.hoistwayDoorInterlock?.result,
        floorLeveling_status: inspectionAndTesting?.hoistwayAndPit?.floorLeveling?.status,
        floorLeveling_result: inspectionAndTesting?.hoistwayAndPit?.floorLeveling?.result,
        carDoor_status: inspectionAndTesting?.car?.carDoor?.status,
        carDoor_result: inspectionAndTesting?.car?.carDoor?.result,
        emergencyLighting_status: inspectionAndTesting?.car?.emergencyLighting?.status,
        emergencyLighting_result: inspectionAndTesting?.car?.emergencyLighting?.result,
        intercom_status: inspectionAndTesting?.car?.intercom?.status,
        intercom_result: inspectionAndTesting?.car?.intercom?.result,
        backupPowerARD_status: inspectionAndTesting?.car?.backupPowerARD?.status,
        backupPowerARD_result: inspectionAndTesting?.car?.backupPowerARD?.result,
        safetyBrakeOperation_status: inspectionAndTesting?.governorAndSafetyBrake?.safetyBrakeOperation?.status,
        safetyBrakeOperation_result: inspectionAndTesting?.governorAndSafetyBrake?.safetyBrakeOperation?.result,
        limitSwitch_status: inspectionAndTesting?.governorAndSafetyBrake?.limitSwitch?.status,
        limitSwitch_result: inspectionAndTesting?.governorAndSafetyBrake?.limitSwitch?.result,
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
