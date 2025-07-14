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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// URL is now cleaner, using a stable model and without the API key
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent`;


// Find and read the relevant knowledge file based on equipment type.
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

// Summarize inspection findings, focusing only on items where status is false.
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
      if (!GEMINI_API_KEY) {
          return h.response({ message: 'GEMINI_API_KEY is not configured in .env file.' }).code(500);
      }
      try {
        const inspectionInput = request.payload;
        const equipmentType = inspectionInput.equipmentType;
        const regulations = await getKnowledgePrompt(equipmentType);
        const findingsSummary = summarizeInspectionFindings(inspectionInput.inspectionAndTesting);
        const finalPrompt = createFinalPrompt(regulations, findingsSummary, inspectionInput.generalData);
        
        console.log('--- FINAL PROMPT SENT TO GOOGLE ---');
        console.log(finalPrompt);
        console.log('-----------------------------------');
        
        // Call the Google Gemini API with the API key in the header.
        const responseFromGemini = await axios.post(
          GEMINI_API_URL, 
          { // Request Body
            "contents": [
              {
                "parts": [
                  {
                    "text": finalPrompt
                  }
                ]
              }
            ]
          },
          { // Axios config object with headers
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': GEMINI_API_KEY
            }
          }
        );

        let llmResultString = responseFromGemini.data.candidates[0].content.parts[0].text;
        console.log('--- RAW STRING RECEIVED FROM GOOGLE ---');
        console.log(llmResultString);
        console.log('---------------------------------------');
        
        // More robust cleaning: find the first '{' and the last '}' and extract the content.
        const startIndex = llmResultString.indexOf('{');
        const endIndex = llmResultString.lastIndexOf('}');

        if (startIndex > -1 && endIndex > -1) {
          const jsonSubstring = llmResultString.substring(startIndex, endIndex + 1);
          const llmResultObject = JSON.parse(jsonSubstring);
          return h.response(llmResultObject).code(200);
        } else {
          throw new Error("No valid JSON object found in the LLM response.");
        }

      } catch (error) {
        console.error('Error in server handler:', error.message);
        if (error.response) {
            console.error('Error data from Google API:', error.response.data.error);
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