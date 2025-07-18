'use strict';

// Core dependencies
const Hapi = require('@hapi/hapi');
const fs = require('fs/promises');
const path = require('path');
const { VertexAI } = require('@google-cloud/vertexai');

// Load environment variables from .env file
require('dotenv').config();

// --- Project & Model Configuration ---
const project = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION; // Should be 'asia-southeast1'
const model = 'gemini-2.5-flash'; // Model updated as requested

// --- Initialize VertexAI Client ---
const vertex_ai = new VertexAI({ project, location });
const generativeModel = vertex_ai.getGenerativeModel({
    model,
    safetySettings: [{ 
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT', 
        threshold: 'BLOCK_ONLY_HIGH' 
    }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0, responseMimeType: 'application/json' },
});

// --- Constants ---
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions ---

/**
 * Finds and reads a knowledge file from disk based on the equipment type.
 */
async function getKnowledgeFromFile(equipmentType) {
    const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
    console.log(`🔍 Searching for knowledge file with key: '${equipmentKey}'`);

    try {
        const allFiles = await fs.readdir(KNOWLEDGE_DIR);

        const matchingFile = allFiles.find(file => 
            file.toLowerCase().startsWith(equipmentKey) && path.extname(file).toLowerCase() === '.txt'
        );

        if (!matchingFile) {
            throw new Error(`Knowledge base not found for: ${equipmentType}. No file found starting with key: '${equipmentKey}'`);
        }

        const filePath = path.join(KNOWLEDGE_DIR, matchingFile);
        console.log(`✅ Found matching file. Reading: ${filePath}`);
        
        const content = await fs.readFile(filePath, 'utf-8');
        return content;

    } catch (error) {
        console.error("Error inside getKnowledgeFromFile:", error.message);
        throw error;
    }
}

/**
 * Summarizes inspection findings from the input data object.
 */
function summarizeInspectionFindings(inspectionDataObject) {
    let findings = [];
    function traverse(obj, path) {
        for (const key in obj) {
            const currentPath = path ? `${path} -> ${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                if ('result' in obj[key] && 'status' in obj[key] && obj[key].status === false) {
                    findings.push(`- ${currentPath.replace(/result$/i, '')}: ${obj[key].result}`);
                } else {
                    traverse(obj[key], currentPath);
                }
            }
        }
    }
    traverse(inspectionDataObject, '');
    if (findings.length === 0) {
        return 'All inspected items meet the standards and are in good condition.';
    }
    return 'Found several items that do not meet the standards:\n' + findings.join('\n');
}

/**
 * Creates the final, detailed prompt to be sent to the AI.
 * --- THIS IS THE FINAL VERSION WITH NO LENGTH RESTRICTIONS ---
 */
function createFinalPrompt(regulations, findingsSummary, generalData) {
    return `
You are a senior OHS (K3) inspection expert. Your task is to conduct a thorough analysis of an inspection report and provide a comprehensive, unrestricted conclusion and set of recommendations based on a provided knowledge base. Do not summarize or shorten your reasoning.

---
[BUKU_PENGETAHUAN_K3]:
${regulations}
---
[DATA_TEMUAN_LAPANGAN]:
${findingsSummary}
---

## TUGAS ANDA:
1.  Lakukan analisis mendalam untuk setiap komponen dari [DATA_TEMUAN_LAPANGAN].
2.  Bandingkan setiap temuan secara cermat dengan semua standar yang relevan di dalam [BUKU_PENGETAHUAN_K3].
3.  Buatlah output dalam format JSON yang telah ditentukan di bawah tanpa ada batasan panjang.

### Aturan Output JSON:

#### 1. "conclusion" (Kesimpulan):
* Jika [DATA_TEMUAN_LAPANGAN] berisi satu atau lebih temuan, nilai "conclusion" HARUS "TIDAK LAIK".
* Jika [DATA_TEMUAN_LAPANGAN] menyatakan semua item dalam kondisi baik, nilai "conclusion" HARUS "LAIK".

#### 2. "recommendation" (Rekomendasi):
* **Jika kesimpulan "TIDAK LAIK":**
    * Buat daftar rekomendasi dalam bentuk array of strings.
    * Rekomendasi pertama HARUS selalu: "1. STOP OPERASIONAL".
    * Untuk setiap temuan di [DATA_TEMUAN_LAPANGAN], buat satu "Rekomendasi Wajib" yang komprehensif, berdasarkan analisis dari [BUKU_PENGETAHUAN_K3].
    * **PENTING**: Urutkan rekomendasi (setelah "STOP OPERASIONAL") berdasarkan tingkat risiko bahaya, dari yang paling Kritis ke risiko yang lebih rendah.
    * **INSTRUKSI DETAIL**: Setiap string rekomendasi HARUS **menjelaskan secara rinci justifikasinya**. Uraikan dengan lengkap standar mana yang dilanggar dari [BUKU_PENGETAHUAN_K3], dan jelaskan potensi bahaya atau konsekuensi kegagalan jika tidak segera diperbaiki. Berikan penjelasan selengkap mungkin.

* **Jika kesimpulan "LAIK":**
    * Berikan satu rekomendasi tunggal untuk perawatan rutin dalam array, dengan penjelasan mengenai pentingnya perawatan tersebut. Contoh: ["1. Lanjutkan program perawatan rutin sesuai jadwal pabrikan untuk menjaga kondisi prima peralatan, memastikan keselamatan operator, dan memperpanjang umur pakai unit."].

Sajikan output HANYA dalam format JSON di bawah ini, tanpa teks atau penjelasan tambahan di luar format tersebut.
{
  "conclusion": "string",
  "recommendation": ["string", "string", "..."]
}
`;
}


/**
 * Initializes and starts the Hapi server.
 */
const init = async () => {
    const server = Hapi.server({ port: process.env.PORT || 3000, host: '0.0.0.0' });

    server.route({
        method: 'POST',
        path: '/LLM-generate',
        handler: async (request, h) => {
            try {
                const inspectionInput = request.payload;
                const regulations = await getKnowledgeFromFile(inspectionInput.equipmentType);
                const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
                const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.generalData);
                const result = await generativeModel.generateContent(finalPrompt);
                const response = result.response;

                if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts || response.candidates[0].content.parts.length === 0 ) {
                    console.error('Invalid or blocked response from AI:', JSON.stringify(response, null, 2));
                    throw new Error('Response from AI was empty, blocked, or invalid.');
                }
                
                const rawText = response.candidates[0].content.parts[0].text;
                const startIndex = rawText.indexOf('{');
                const endIndex = rawText.lastIndexOf('}');
                
                if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                    throw new Error('Could not find a valid JSON object in the AI response.');
                }
                const jsonString = rawText.substring(startIndex, endIndex + 1);
                const llmResultObject = JSON.parse(jsonString);
                
                return h.response(llmResultObject).code(200);
            } catch (error) {
                console.error('Error in server handler:', error);
                return h.response({
                    message: 'Internal Server Error.',
                    error: error.message,
                }).code(500);
            }
        },
    });

    await server.start();
    console.log(`✅ Server running on ${server.info.uri}`);
    console.log(`Using Project: ${project} in Region: ${location}`);
    console.log(`Using Model: ${model}`);
};

// Graceful shutdown logic
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    process.exit(0);
});

process.on('unhandledRejection', (err) => {
    console.error('An unhandled promise rejection occurred:', err);
    process.exit(1);
});

init();