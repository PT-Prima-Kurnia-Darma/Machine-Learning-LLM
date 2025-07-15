'use strict';

// Core dependencies
const Hapi = require('@hapi/hapi');
const fs = require('fs/promises');
const path = require('path');
// --- NEW IMPORT METHOD ---
// We now use the lower-level PredictionServiceClient
const { PredictionServiceClient } = require('@google-cloud/aiplatform').v1;

// Load environment variables from .env file
require('dotenv').config();

// --- NEW CLIENT INITIALIZATION ---
// We specify the regional endpoint directly.
const clientOptions = {
  apiEndpoint: 'asia-southeast2-aiplatform.googleapis.com',
};
const predictionServiceClient = new PredictionServiceClient(clientOptions);

// --- Project Configuration ---
const project = process.env.GCP_PROJECT_ID || 'gen-lang-client-0697716223';
const location = process.env.GCP_LOCATION || 'asia-southeast2';
const model = 'gemini-1.5-flash-001';

// --- Constants ---
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');

// --- Helper Functions (No Changes) ---

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

function createFinalPrompt(regulations, findingsSummary, generalData) {
  return `
You are a senior K3 inspection expert tasked with creating a final report in Indonesian.

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
Based on the comparison between **FIELD FINDINGS** and **REGULATIONS**, create a conclusion and recommendations in **Indonesian**.
1.  **Conclusion (Kesimpulan)**: Determine if the equipment is "LAIK" or "TIDAK LAIK". The "LAIK" status is only given if ALL findings meet the standard. If even one item fails, the status is "TIDAK LAIK".
2.  **Recommendation (Rekomendasi)**: Structure the recommendation string with the following rules:
    * **If the conclusion is "TIDAK LAIK"**: The string MUST begin with the exact phrase "STOP OPERASIONAL" followed by a newline character (\\n). After that, list all necessary repair actions as a numbered list. **Write all repair actions in Indonesian.**
    * **If the conclusion is "LAIK"**: The string should contain a recommendation for routine maintenance, **written in Indonesian.** For example: "Seluruh komponen dalam kondisi baik dan laik operasi. Lakukan perawatan rutin sesuai jadwal."
    * **Example for "TIDAK LAIK" output**: "STOP OPERASIONAL\\n1. Lakukan perbaikan pada komponen A yang rusak.\\n2. Ganti segera komponen B yang tidak standar."

Provide the answer ONLY in the following JSON format, without any extra words or explanation. DO NOT add markdown \`\`\`json.

{
  "conclusion": "string",
  "recommendation": "string"
}
`;
}

// --- Server Initialization ---

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

        // --- NEW API CALL METHOD ---
        // 1. Define the full endpoint path
        const endpoint = `projects/${project}/locations/${location}/publishers/google/models/${model}`;
        
        // 2. Structure the request payload into an 'instances' array
        const instances = [{ contents: [{ role: 'user', parts: [{ text: finalPrompt }] }] }];

        // 3. Define model parameters
        const parameters = {
            candidateCount: 1,
            maxOutputTokens: 2048,
            temperature: 0.5,
        };

        // 4. Build the final request object
        const apiRequest = {
            endpoint,
            instances,
            parameters,
        };

        // 5. Call the API using the predict method
        const [response] = await predictionServiceClient.predict(apiRequest);
        
        // 6. Extract the result from a different response structure
        let llmResultString = response.predictions[0].structValue.fields.content.stringValue;

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
        console.error('Error in server handler:', error);
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