// file: server.js
'use strict';

require('dotenv').config();
const Hapi = require('@hapi/hapi');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    throw new Error("GEMINI_API_KEY not found in .env file");
}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const init = async () => {
    const server = Hapi.server({
        port: 3000,
        host: 'localhost',
    });

    server.route({
        method: 'POST',
        path: '/generate-inspection-report',
        handler: async (request, h) => {
            try {
                // KEY CHANGE 1: Menerima 'inspectionType' dan 'inspectionReportJson' dari payload
                const { inspectionType, inspectionReportJson } = request.payload;

                // KEY CHANGE 2: Validasi input baru, pastikan keduanya ada
                if (!inspectionType || !inspectionReportJson) {
                    return h.response({ status: 'failure', message: 'Request body must include "inspectionType" and "inspectionReportJson".' }).code(400);
                }

                // KEY CHANGE 3: Nama file dibuat dinamis berdasarkan inspectionType
                // Contoh: inspectionType "elevator" akan menjadi "elevator.txt"
                const promptFileName = `${inspectionType}.txt`;
                const promptFilePath = path.join(__dirname, 'k3_knowledge', promptFileName);
                
                let promptTemplate = '';
                try {
                    promptTemplate = await fs.readFile(promptFilePath, 'utf8');
                    console.log(`Successfully loaded prompt template from: ${promptFileName}`);
                } catch (fileError) {
                    console.error(`Failed to load prompt file: ${promptFileName}.`);
                    // Memberikan pesan error yang jelas jika file untuk tipe inspeksi itu tidak ada
                    return h.response({ status: 'failure', message: `Prompt template for "${inspectionType}" not found at ${promptFileName}.` }).code(404);
                }

                // Proses selanjutnya sama, tidak ada perubahan
                const reportDataString = JSON.stringify(inspectionReportJson, null, 2);
                const finalPrompt = promptTemplate.replace('### **[DATA_LAPORAN_JSON]:**', `### **[DATA_LAPORAN_JSON]:**\n${reportDataString}`);
                
                console.log('Sending final prompt to Gemini...');
                const result = await model.generateContent(finalPrompt);
                const aiResponse = await result.response;
                const reportText = aiResponse.text();
                
                console.log(`Successfully generated report for inspection type: ${inspectionType}`);

                return h.response({ status: 'success', generated_report: reportText }).code(200);

            } catch (error) {
                console.error('A fatal error occurred:', error);
                return h.response({ status: 'failure', message: 'An internal server error occurred.', detail: error.message }).code(500);
            }
        }
    });

    await server.start();
    console.log(`✅ Hapi server running at: ${server.info.uri}`);
    console.log(`   Report Generator Endpoint: POST ${server.info.uri}/generate-inspection-report`);
};

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

init();