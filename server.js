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
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
                // PASTIKAN BARIS INI MENGGUNAKAN "inspectionReportJson"
                const { inspectionReportJson } = request.payload;

                if (!inspectionReportJson) {
                    // Pesan error ini sekarang dalam Bahasa Inggris
                    return h.response({ status: 'failure', message: 'Request body must include "inspectionReportJson".' }).code(400);
                }

                const promptFileName = 'elevator.txt';
                const promptFilePath = path.join(__dirname, 'k3_knowledge', promptFileName);
                
                let promptTemplate = '';
                try {
                    promptTemplate = await fs.readFile(promptFilePath, 'utf8');
                    console.log(`Successfully loaded prompt template from: ${promptFileName}`);
                } catch (fileError) {
                    console.error(`Failed to load prompt file: ${promptFileName}.`);
                    return h.response({ status: 'failure', message: `Prompt template "${promptFileName}" not found.` }).code(500);
                }

                const reportDataString = typeof inspectionReportJson === 'string' 
                    ? inspectionReportJson 
                    : JSON.stringify(inspectionReportJson, null, 2);

                const finalPrompt = promptTemplate.replace('### **[DATA_LAPORAN_JSON]:**', `### **[DATA_LAPORAN_JSON]:**\n${reportDataString}`);
                
                console.log('Sending final prompt to Gemini...');
                const result = await model.generateContent(finalPrompt);
                const aiResponse = await result.response;
                const reportText = aiResponse.text();
                
                console.log('Successfully received text report from Gemini.');

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