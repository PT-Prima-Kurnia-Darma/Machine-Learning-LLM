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
const model = 'gemini-2.5-flash';
9
// --- Initialize VertexAI Client (Done once per instance lifecycle) ---
const vertex_ai = new VertexAI({ project, location });

const generativeModel = vertex_ai.getGenerativeModel({
    model,
    safetySettings: [{ 
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT', 
        threshold: 'BLOCK_ONLY_HIGH' 
    }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0, responseMimeType: 'application/json' },
});

// --- In-Memory Cache for Knowledge Files ---
const knowledgeCache = {};

// --- Constants ---
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions ---

/**
 * Loads all knowledge files from disk into the memory cache on server startup.
 * This is a one-time operation to maximize performance on subsequent requests.
 */
async function loadAllKnowledge() {
    console.log('🚀 Pre-loading all knowledge files into memory cache...');
    try {
        const files = await fs.readdir(KNOWLEDGE_DIR);
        for (const file of files) {
            if (path.extname(file) === '.txt') {
                const equipmentKey = path.basename(file, 'Knowledge.txt').toLowerCase();
                const filePath = path.join(KNOWLEDGE_DIR, file);
                const content = await fs.readFile(filePath, 'utf-8');
                knowledgeCache[equipmentKey] = content;
                console.log(`- Cached: ${equipmentKey}`);
            }
        }
        console.log('✅ Knowledge cache successfully loaded.');
    } catch (error) {
        console.error('❌ FATAL: Failed to load knowledge base. The server will stop.', error);
        process.exit(1); // Exit if critical data can't be loaded.
    }
}

/**
 * Gets knowledge instantly from the in-memory cache.
 * This function is synchronous and extremely fast.
 */
function getKnowledgePrompt(equipmentType) {
    const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
    
    const knowledge = knowledgeCache[equipmentKey];
    if (!knowledge) {
        throw new Error(`Knowledge base not found in cache for: ${equipmentType}. Searched key: ${equipmentKey}`);
    }
    return knowledge;
}

/**
 * Summarizes inspection findings from the input data object.
 * (Your original logic, unchanged)
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
 * (Your original logic, unchanged)
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
    // This new step loads all knowledge before the server starts listening for requests.
    await loadAllKnowledge();

    const server = Hapi.server({ port: process.env.PORT || 3000, host: '0.0.0.0' });

    server.route({
        method: 'POST',
        path: '/LLM-generate',
        handler: async (request, h) => {
            try {
                const inspectionInput = request.payload;
                // This call is now instantaneous as it reads from memory.
                const regulations = getKnowledgePrompt(inspectionInput.equipmentType);
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
    console.log(`Server running on ${server.info.uri}`);
    console.log(`Using Project: ${project} in Region: ${location}`);
    console.log(`Using Model: ${model}`);
};

// Graceful shutdown logic
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    // server.stop is not available in Hapi, so we just exit.
    // In a real production app with database connections, you would close them here.
    process.exit(0);
});

process.on('unhandledRejection', (err) => {
    console.error('An unhandled promise rejection occurred:', err);
    process.exit(1);
});

init();