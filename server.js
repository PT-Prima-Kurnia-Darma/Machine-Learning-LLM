'use strict';

// Core dependencies
const Hapi = require('@hapi/hapi');
const fs = require('fs/promises');
const path = require('path');
const { VertexAI } = require('@google-cloud/vertexai');

// Load environment variables from .env file
require('dotenv').config();

// --- Project & Model Configuration ---
const gcpProject = process.env.GCP_PROJECT_ID;
const gcpLocation = process.env.GCP_LOCATION; // Should be 'asia-southeast1'
const modelName = 'gemini-2.5-flash'; 

// --- Initialize VertexAI Client ---
const vertexAI = new VertexAI({ project: gcpProject, location: gcpLocation });
const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
    safetySettings: [{
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH'
    }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0.2, responseMimeType: 'application/json' },
});

// --- Constants ---
const knowledgeDir = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions ---

/**
 * Finds and reads a knowledge file from disk.
 */
async function getKnowledgeFromFile(equipmentType) {
    const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
    console.log(`🔍 Searching for knowledge file with key: '${equipmentKey}'`);

    try {
        const allFiles = await fs.readdir(knowledgeDir);
        const matchingFile = allFiles.find(file =>
            file.toLowerCase().startsWith(equipmentKey) && path.extname(file).toLowerCase() === '.txt'
        );

        if (!matchingFile) {
            throw new Error(`Knowledge base not found for: ${equipmentType}. No file found starting with key: '${equipmentKey}'`);
        }

        const filePath = path.join(knowledgeDir, matchingFile);
        console.log(`✅ Found matching file. Reading: ${filePath}`);
        
        const content = await fs.readFile(filePath, 'utf-8');
        return content;

    } catch (error) {
        console.error("Error in getKnowledgeFromFile:", error.message);
        throw error;
    }
}

/**
 * Summarizes inspection findings from the input data.
 */
function summarizeInspectionFindings(inspectionDataObject) {
    const findings = [];
    
    function traverse(obj, currentPath) {
        for (const key in obj) {
            const newPath = currentPath ? `${currentPath} -> ${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                if ('result' in obj[key] && 'status' in obj[key] && obj[key].status === false) {
                    findings.push(`- ${newPath.replace(/result$/i, '')}: ${obj[key].result}`);
                } else {
                    traverse(obj[key], newPath);
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
 * --- UPDATED PROMPT LOGIC ---
 * Creates the final, detailed prompt for the AI.
 * Instructions are in Indonesian to generate the desired Indonesian output.
 */
function createFinalPrompt(regulations, findingsSummary, equipmentType) {
    return `
Anda adalah seorang Ahli K3 (Keselamatan dan Kesehatan Kerja) senior yang membuat laporan inspeksi formal.
Tugas Anda adalah menghasilkan output JSON berdasarkan data yang diberikan.

---
[KNOWLEDGE_BASE]:
${regulations}
---
[INSPECTION_FINDINGS]:
${findingsSummary}
---
[EQUIPMENT_TYPE]:
${equipmentType}
---

## YOUR TASK:
Generate a valid JSON object ONLY. Follow the rules below VERY STRICTLY.

### JSON Output Rules:

{
  "conclusion": "string",
  "recommendation": ["string", "string", "..."]
}

### Content Rules:

#### 1. "conclusion":
* Create a formal, complete sentence summarizing the inspection result.
* The status word MUST be in all caps: **"LAYAK"** or **"TIDAK LAYAK"**.
* **If findings state 'good condition' (Laik):** The sentence must state the equipment is fit for use.
    * **Example:** "Dari hasil pemeriksaan dan pengujian terhadap ${equipmentType}, disimpulkan bahwa peralatan tersebut masih **LAYAK** dan baik (memenuhi syarat K3)."
* **If findings list issues (Tidak Laik):** The sentence must state the equipment is not fit for use and requires repair.
    * **Example:** "Berdasarkan hasil pemeriksaan dan pengujian, ditemukan beberapa ketidaksesuaian pada ${equipmentType} yang menyebabkannya dinyatakan **TIDAK LAYAK** dan memerlukan perbaikan segera."

#### 2. "recommendation":
* This must be an array of strings.
* Each string in the array MUST start with a number followed by a period and a space (e.g., "1. ", "2. ", "3. ").

* **If conclusion is "LAYAK":**
    * Generate a list of general operational and maintenance recommendations.
    * You MUST follow the style, content, and numbering of the example below.
    * The last recommendation MUST include a placeholder "dd/mm/yyyy" for the next inspection.
    * **MANDATORY EXAMPLE FOR "LAYAK" CASE:**
        [
          "1. Eskalator tersebut harus dioperasikan oleh operator yang ahli dibidang Eskalator.",
          "2. Sebelum dioperasikan, operator harus memastikan bahwa semua alat perlengkapan terpasang dengan baik.",
          "3. Operator yang mengoperasikan harus yang mempunyai Lisensi dari Kementerian Ketenagakerjaan Republik Indonesia.",
          "4. Operator harus selalu mengecek/memeriksa Oli Gear box sesuai jadwal yang telah ditetapkan.",
          "5. Teknisi yang melakukan perbaikan harus mempunyai Lisensi dari Kementerian Ketenagakerjaan Republik Indonesia.",
          "6. Jika terdapat hal-hal yang mencurigakan dalam pengoperasian, operator harus segera mematikannya dan melaporkannya kepada bagian yang bertanggung jawab di perusahaan.",
          "7. Paling lambat dd/mm/yyyy Eskalator tersebut harus dilakukan pemeriksaan/pengujian berkala oleh Pengawas Spesialis Keselamatan dan Kesehatan Kerja atau Ahli K3."
        ]

* **If conclusion is "TIDAK LAYAK":**
    * The first recommendation MUST be "1. STOP OPERASIONAL untuk mencegah risiko kecelakaan."
    * For each issue in [INSPECTION_FINDINGS], create a specific, formal recommendation for repair, starting with "2. ", "3. ", and so on.
    * Justify each recommendation by referencing the safety risk involved.
    * **Example for "TIDAK LAYAK" case:**
        [
            "1. STOP OPERASIONAL untuk mencegah risiko kecelakaan.",
            "2. Perbaiki atau perkuat struktur rangka/frame untuk memastikan integritas dan stabilitas eskalator, mencegah risiko kegagalan struktural yang dapat menyebabkan kecelakaan fatal."
        ]

Provide the output ONLY in the specified JSON format, with no extra text or explanations.
`;
}


/**
 * Initializes and starts the Hapi server.
 */
const init = async () => {
    const server = Hapi.server({ port: process.env.PORT || 3000, host: '0.0.0.0' });

    server.route({
        method: 'POST',
        path: '/LLM-generate', // Path uses kebab-case convention
        handler: async (request, h) => {
            try {
                const inspectionInput = request.payload;
                const regulations = await getKnowledgeFromFile(inspectionInput.equipmentType);
                const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
                
                // Pass equipmentType directly for use in the prompt
                const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.equipmentType);
                
                const result = await generativeModel.generateContent(finalPrompt);
                const { response } = result;

                if (!response.candidates?.length || !response.candidates[0].content?.parts?.length) {
                    console.error('Invalid or blocked response from AI:', JSON.stringify(response, null, 2));
                    throw new Error('Response from AI was empty, blocked, or invalid.');
                }
                
                const rawText = response.candidates[0].content.parts[0].text;
                const startIndex = rawText.indexOf('{');
                const endIndex = rawText.lastIndexOf('}');
                
                if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                    console.error('Could not find a valid JSON object in the AI response:', rawText);
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
    console.log(`Using Project: ${gcpProject} in Region: ${gcpLocation}`);
    console.log(`Using Model: ${modelName}`);
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