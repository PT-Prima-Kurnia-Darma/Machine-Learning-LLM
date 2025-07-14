'use strict';

// Core dependencies
const Hapi = require('@hapi/hapi');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

// Constants
const KNOWLEDGE_DIR = path.join(__dirname, 'k3_knowledge');
const BACKEND_API_URL = process.env.BACKEND_API_URL;

// Find and read the relevant knowledge file based on equipment type.
async function getKnowledgePrompt(equipmentType) {
  // Use first word, lowercase, to match the knowledge filename.
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

// Summarize inspection findings, focusing only on items where status is false.
function summarizeInspectionFindings(inspectionDataObject) {
  let findings = [];

  // Recursive function to traverse the nested findings object.
  function traverse(obj, path) {
    for (const key in obj) {
      const currentPath = path ? `${path} -> ${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Check if it's a result object (has 'result' and 'status' properties).
        if ('result' in obj[key] && 'status' in obj[key]) {
          // Only record the finding if status is false.
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

// Create the final, structured prompt to be sent to the LLM.
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
2.  **Recommendation**: Provide a clear list of actionable repair items ONLY for the findings that did not meet the standard. If all items are compliant, recommend routine maintenance.

Provide the answer ONLY in the following JSON format, without any extra words or explanation. DO NOT add markdown \`\`\`json.

{
  "conclusion": "string",
  "recommendation": "string"
}
`;
}

// Initialize and start the Hapi server.
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
        // 1. Receive the full inspection data from the request payload.
        const inspectionInput = request.payload;

        // 2. Extract key info and get the relevant knowledge prompt.
        const equipmentType = inspectionInput.equipmentType;
        const regulations = await getKnowledgePrompt(equipmentType);
        const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);

        // 3. Construct the final prompt for the LLM.
        const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.generalData);
        console.log('--- FINAL PROMPT SENT TO BACKEND ---');
        console.log(finalPrompt);
        console.log('------------------------------------');

        // 4. Call the Backend API (which in turn calls the Gemini API).
        const responseFromBackend = await axios.post(BACKEND_API_URL, {
          prompt: finalPrompt,
        });
        
        // 5. Process the response from the backend.
        // The backend API returns { "text": "..." }, where 'text' is a JSON string.
        const llmResultString = responseFromBackend.data.text;
        console.log('--- RAW STRING RECEIVED FROM BACKEND ---');
        console.log(llmResultString);
        console.log('----------------------------------------');

        // Parse the JSON string into a JavaScript object.
        const llmResultObject = JSON.parse(llmResultString);

        // 6. Return the final parsed object as the response.
        return h.response(llmResultObject).code(200);

      } catch (error) {
        console.error('Error in server handler:', error.message);
        if (error.response) {
            console.error('Error data from backend:', error.response.data);
        }
        return h.response({ message: 'Internal Server Error', error: error.message }).code(500);
      }
    },
  });

  await server.start();
  console.log('Server running on %s', server.info.uri);
};

// Gracefully handle unhandled promise rejections.
process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

init();