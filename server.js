'use strict';

// Core dependencies
const Hapi = require('@hapi/hapi');
const fs = require('fs/promises');
const path = require('path');
// Correct import for the latest @google-cloud/aiplatform library
const { VertexAI } = require('@google-cloud/aiplatform');

// Load environment variables from .env file
require('dotenv').config();

// --- Vertex AI Client Initialization ---
// This block initializes the Vertex AI client for your project.
// It will automatically use the credentials set up via `gcloud auth application-default login`.
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'gen-lang-client-0697716223',
  location: process.env.GCP_LOCATION || 'asia-southeast2',
});
const generativeModel = vertexAI.getGenerativeModel({
  model: 'gemini-1.5-flash-001',
});

// --- Constants ---
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions ---

/**
 * Reads the relevant knowledge file based on equipment type.
 * @param {string} equipmentType
 * @returns {Promise<string>}
 */
async function getKnowledgePrompt(equipmentType) {
  const equipmentKey = equipmentType.split(' ')[0].toLowerCase();
  const filePath = path.join(KNOWLEDGE_DIR, `${equipmentKey}Knowledge.txt`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`Error: Knowledge file for "${equipmentKey}" not found at ${filePath}`);
    throw new Error(`Knowledge base for ${equipmentType} not found.`);
  }
}

/**
 * Summarizes inspection findings, focusing only on items where status is false.
 * @param {object} inspectionDataObject
 * @returns {string}
 */
function summarizeInspectionFindings(inspectionDataObject) {
  let findings = [];
  function traverse(obj, path) {
    for (const key in obj) {
      const currentPath = path ? `${path} -> ${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if ('result' in obj[key] && 'status' in obj[key]) {
          if (obj[key].status === false) {
            findings.push(`- ${currentPath.replace(/result$/i, '')}: ${obj[key].result}`);
          }
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
 * Creates the final, structured prompt to be sent to the LLM.
 * @param {string} regulations
 * @param {string} findingsSummary
 * @param {object} generalData
 * @returns {string}
 */
function createFinalPrompt(regulations, findingsSummary, generalData) {
  return `
You are a senior K3 inspection expert tasked with creating a final report.

**INSPECTION CONTEXT:**
- Equipment Type: ${generalData.safetyObjectTypeAndNumber}
- Inspection Date: ${generalData.inspectionDate}
- Purpose: ${generalData.examinationType}

**SAFETY REGULATIONS & STANDARDS (Reference):**
---
${regulations}
---

**FIELD FINDINGS SUMMARY:**
---
${findingsSummary}
---

**YOUR TASK:**
Based on the comparison between **FIELD FINDINGS** and **REGULATIONS**, create a conclusion and recommendations.
1.  **Conclusion**: Determine if the equipment is "LAIK" (Compliant) or "TIDAK LAIK" (Not Compliant). The "LAIK" status is only given if ALL findings meet the standard. If even one item fails, the status is "TIDAK LAIK".
2.  **Recommendation**: Structure the recommendation string with the following rules:
    * **If the conclusion is "TIDAK LAIK"**: The string MUST begin with the exact phrase "STOP OPERASIONAL" followed by a newline character (\\n). After that, list all necessary repair actions as a numbered list (1., 2., 3., ...), with each item on a new line.
    * **If the conclusion is "LAIK"**: The string should only contain a recommendation for routine maintenance.
    * **Example for "TIDAK LAIK" output**: "STOP OPERASIONAL\\n1. Lakukan perbaikan A.\\n2. Ganti komponen B."

Provide the answer ONLY in the following JSON format, without any extra words or explanation. DO NOT add markdown \`\`\`json.

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
  const server = Hapi.server({
    port: 3000,
    host: 'localhost',
  });

  server.route({
    method: 'POST',
    path: '/LLM-generate',
    handler: async (request, h) => {
      try {
        const inspectionInput = request.payload;
        const equipmentType = inspectionInput.equipmentType;
        const regulations = await getKnowledgePrompt(equipmentType);
        const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
        const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.generalData);

        console.log('--- FINAL PROMPT SENT TO VERTEX AI ---');
        console.log(finalPrompt);
        console.log('--------------------------------------');

        // Call the Vertex AI API
        const req = {
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
        };
        const result = await generativeModel.generateContent(req);
        const response = result.response;

        let llmResultString = response.candidates[0].content.parts[0].text;
        console.log('--- RAW STRING RECEIVED FROM VERTEX AI ---');
        console.log(llmResultString);
        console.log('------------------------------------------');

        const startIndex = llmResultString.indexOf('{');
        const endIndex = llmResultString.lastIndexOf('}');

        if (startIndex > -1 && endIndex > -1) {
          const jsonSubstring = llmResultString.substring(startIndex, endIndex + 1);
          const llmResultObject = JSON.parse(jsonSubstring);
          return h.response(llmResultObject).code(200);
        } else {
          throw new Error('No valid JSON object found in the LLM response.');
        }
      } catch (error) {
        console.error('Error in server handler:', error.message);
        if (error.response) {
          console.error('Error data from API:', error.response.data);
        }
        return h.response({ message: 'Internal Server Error', error: error.message }).code(500);
      }
    },
  });

  await server.start();
  console.log('Server running on %s', server.info.uri);
};

// Gracefully handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

init();