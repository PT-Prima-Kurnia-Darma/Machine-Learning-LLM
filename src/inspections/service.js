// File: src/inspections/service.js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { VertexAI } = require('@google-cloud/vertexai');

// --- AI Configuration and Initialization ---
const gcpProject = process.env.GCP_PROJECT_ID;
const gcpLocation = process.env.GCP_LOCATION;
const modelName = 'gemini-2.5-flash';
const knowledgeDir = path.join(__dirname, "..", 'k3_knowledge');

const vertexAI = new VertexAI({ project: gcpProject, location: gcpLocation });
const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
    safetySettings: [{
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH'
    }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0, responseMimeType: 'application/json' },
});


// --- Helper Functions ---

/**
 * Reads the relevant knowledge base file based on equipment type.
 * @param {string} equipmentType - The type of equipment being inspected.
 * @returns {Promise<string>} The content of the knowledge base file.
 */
async function getKnowledgeFromFile(equipmentType) {
    const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
    const allFiles = await fs.readdir(knowledgeDir);
    const matchingFile = allFiles.find(file =>
        file.toLowerCase().startsWith(equipmentKey) && path.extname(file).toLowerCase() === '.txt'
    );

    if (!matchingFile) {
        throw new Error(`Knowledge base not found for: ${equipmentType}.`);
    }

    const filePath = path.join(knowledgeDir, matchingFile);
    return fs.readFile(filePath, 'utf-8');
}

/**
 * Traverses the inspection data to find and summarize items that failed (status: false).
 * @param {object} inspectionDataObject - The 'inspectionAndTesting' part of the input JSON.
 * @returns {string} A summary of findings.
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
 * Creates the detailed prompt for the Gemini AI model.
 * @param {string} regulations - The knowledge base content.
 * @param {string} findingsSummary - The summary of failed items.
 * @param {string} equipmentType - The type of equipment.
 * @returns {string} The complete prompt for the AI.
 */
function createFinalPrompt(regulations, findingsSummary, equipmentType) {
    // Prompt for the AI model, with a unique placeholder for the next inspection date.
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
* Each string in the array MUST start with a number followed by a period and a space (e.g., "1. ", "2. ").
* **If conclusion is "LAYAK":**
    * Generate a list of general operational and maintenance recommendations.
    * You MUST follow the style, content, and numbering of the provided example.
    * The last recommendation MUST use the placeholder '[TANGGAL_INSPEKSI_BERIKUTNYA]'.
    * **MANDATORY EXAMPLE FOR "LAYAK" CASE:**
        [
          "1. Eskalator tersebut harus dioperasikan oleh operator yang ahli dibidang Eskalator.",
          "2. Sebelum dioperasikan, operator harus memastikan bahwa semua alat perlengkapan terpasang dengan baik.",
          "3. Operator yang mengoperasikan harus yang mempunyai Lisensi dari Kementerian Ketenagakerjaan Republik Indonesia.",
          "4. Operator harus selalu mengecek/memeriksa Oli Gear box sesuai jadwal yang telah ditetapkan.",
          "5. Teknisi yang melakukan perbaikan harus mempunyai Lisensi dari Kementerian Ketenagakerjaan Republik Indonesia.",
          "6. Jika terdapat hal-hal yang mencurigakan dalam pengoperasian, operator harus segera mematikannya dan melaporkannya kepada bagian yang bertanggung jawab di perusahaan.",
          "7. Pemeriksaan/pengujian berkala berikutnya wajib dilakukan paling lambat pada tanggal [TANGGAL_INSPEKSI_BERIKUTNYA] oleh Pengawas Spesialis Keselamatan dan Kesehatan Kerja atau Ahli K3."
        ]
* **If conclusion is "TIDAK LAYAK":**
    * The first recommendation MUST be "1. STOP OPERASIONAL untuk mencegah risiko kecelakaan."
    * For each issue in [INSPECTION_FINDINGS], create a specific, formal recommendation for repair, starting with "2. ", "3. ", and so on.
    * Justify each recommendation by referencing the safety risk involved.
Provide the output ONLY in the specified JSON format, with no extra text or explanations.
`;
}

// --- Main Service Function ---

/**
 * Generates an inspection report by processing input data with an AI model.
 * @param {object} inspectionInput - The raw JSON input for the inspection.
 * @returns {Promise<object>} The final, processed report from the AI.
 */
async function generateReport(inspectionInput) {
    // 1. Prepare data and prompt for the AI
    const regulations = await getKnowledgeFromFile(inspectionInput.equipmentType);
    const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
    const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.equipmentType);

    // 2. Call the AI model
    const result = await generativeModel.generateContent(finalPrompt);
    const { response } = result;

    if (!response.candidates?.length || !response.candidates[0].content?.parts?.length) {
        throw new Error('Response from AI was empty, blocked, or invalid.');
    }

    // 3. Extract and parse the JSON response from AI
    const rawText = response.candidates[0].content.parts[0].text;
    const startIndex = rawText.indexOf('{');
    const endIndex = rawText.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        throw new Error('Could not find a valid JSON object in the AI response.');
    }

    const jsonString = rawText.substring(startIndex, endIndex + 1);
    const aiResult = JSON.parse(jsonString);

    // 4. Post-process: Calculate next inspection date from 'createdAt' if the conclusion is "LAYAK"
    if (aiResult.conclusion && aiResult.conclusion.includes("LAYAK")) {
        // Use the 'createdAt' field which is in reliable ISO 8601 format
        const inspectionDate = new Date(inspectionInput.createdAt);

        // Check if the date is valid before proceeding
        if (!isNaN(inspectionDate.getTime())) {
            // Add one year to the inspection date
            inspectionDate.setFullYear(inspectionDate.getFullYear() + 1);
            
            // Format the date to "DD MMMM YYYY" in Indonesian
            const nextInspectionDateFormatted = new Intl.DateTimeFormat('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            }).format(inspectionDate);

            // Replace the placeholder in the recommendation list
            if (aiResult.recommendation && aiResult.recommendation.length > 0) {
                const lastIndex = aiResult.recommendation.length - 1;
                aiResult.recommendation[lastIndex] = aiResult.recommendation[lastIndex]
                    .replace('[TANGGAL_INSPEKSI_BERIKUTNYA]', nextInspectionDateFormatted);
            }
        }
    }

    // 5. Return the final, processed result
    return aiResult;
}

module.exports = { generateReport };