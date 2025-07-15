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
const location = process.env.GCP_LOCATION;
const model = 'gemini-2.5-flash';

// --- Initialize VertexAI Client ---
// The library automatically finds credentials from the GOOGLE_APPLICATION_CREDENTIALS env variable.
const vertex_ai = new VertexAI({ project, location });

// Initialize the Generative Model with configuration
const generativeModel = vertex_ai.getGenerativeModel({
    model,
    safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.5, responseMimeType: 'application/json' },
});

// --- Constants ---
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions ---

/**
 * REVERTED: Reads a specific knowledge base file based on equipment type.
 * @param {string} equipmentType
 * @returns {Promise<string>}
 */
async function getKnowledgePrompt(equipmentType) {
    // Extracts the first word (e.g., "Eskalator") to find the corresponding file.
    const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
    const filePath = path.join(KNOWLEDGE_DIR, `${equipmentKey}Knowledge.txt`);
    console.log(`Attempting to load specific knowledge file: ${filePath}`);
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        throw new Error(`Knowledge base file not found for: ${equipmentType}. Expected file at: ${filePath}`);
    }
}

/**
 * Traverses inspection data and summarizes items that failed.
 * @param {object} inspectionDataObject
 * @returns {string}
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
 * Creates the final prompt for the AI.
 * @param {string} regulations
 * @param {string} findingsSummary
 * @param {object} generalData
 * @returns {string}
 */
function createFinalPrompt(regulations, findingsSummary, generalData) {
    return `
You are a senior OHS (K3) inspection expert.

INSPECTION CONTEXT:
- Equipment Type: ${generalData.safetyObjectTypeAndNumber}
- Inspection Date: ${generalData.inspectionDate}
- Purpose: ${generalData.examinationType}

RELEVANT SAFETY REGULATIONS & STANDARDS (Reference):
---
${regulations}
---

FIELD FINDINGS SUMMARY:
---
${findingsSummary}
---

YOUR TASK:
Based on the comparison between FIELD FINDINGS and the RELEVANT REGULATIONS, create a conclusion and recommendation in Indonesian.
1.  **Conclusion (Kesimpulan)**: Determine if the equipment is "LAIK" (Pass) or "TIDAK LAIK" (Fail). The "LAIK" status is only given if ALL findings meet the standard. If even one item fails, the status is "TIDAK LAIK".
2.  **Recommendation (Rekomendasi)**:
    * If the conclusion is "TIDAK LAIK": The string MUST begin with the exact phrase "STOP OPERASIONAL\\n", followed by a numbered list of repair actions in Indonesian.
    * If the conclusion is "LAIK": Provide a routine maintenance recommendation in Indonesian.

Provide the answer ONLY in the following JSON format, without any extra words or explanation.
{
  "conclusion": "string",
  "recommendation": "string"
}
`;
}

/**
 * Initializes and starts the Hapi server.
 */
const init = async () => {
    // Initialize Hapi Server
    const server = Hapi.server({ port: 3000, host: 'localhost' });

    server.route({
        method: 'POST',
        path: '/LLM-generate',
        handler: async (request, h) => {
            try {
                const inspectionInput = request.payload;
                
                // RE-ADDED: Load only the relevant knowledge file for this request.
                const regulations = await getKnowledgePrompt(inspectionInput.equipmentType);
                
                const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
                const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.generalData);

                const result = await generativeModel.generateContent(finalPrompt);
                const response = result.response;

                if (
                    !response.candidates || response.candidates.length === 0 ||
                    !response.candidates[0].content || !response.candidates[0].content.parts ||
                    response.candidates[0].content.parts.length === 0
                ) {
                    console.error('Invalid or blocked response from AI.');
                    console.log('Full response from AI:', JSON.stringify(response, null, 2));
                    throw new Error('Response from AI was empty, blocked, or invalid.');
                }

                const llmResultObject = JSON.parse(response.candidates[0].content.parts[0].text);
                return h.response(llmResultObject).code(200);

            } catch (error) {
                console.error('Error in server handler:', error);
                return h.response({
                    message: 'Internal Server Error when calling Vertex AI.',
                    error: error.message,
                    details: error.details || 'No additional details.'
                }).code(500);
            }
        },
    });

    await server.start();
    console.log(`Using Project: ${project}`);
    console.log(`Contacting Location/Region: ${location}`);
    console.log(`Using Model: ${model}`);
    console.log('Server running on %s', server.info.uri);
};

// Gracefully handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('An unhandled promise rejection occurred:', err);
    process.exit(1);
});

// Start the server
init();