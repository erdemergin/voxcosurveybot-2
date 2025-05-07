import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from '../types';
import { callLlm } from '../utils/callLlm';
import { applyPatch, Operation } from 'fast-json-patch';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import questionnaireSchema from '../../data/questionnare-schema.json';

// Configure Ajv for schema validation
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateSchema = ajv.compile(questionnaireSchema);

interface ParseWordPrepResult {
  baseSurvey: Questionnaire;
  wordText: string;
}

interface SurveyChunk {
  type: 'block' | 'question' | 'other';
  content: string;
  context?: string;
  metadata?: Record<string, any>;
}

export class ParseWordToSurveyNode extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<ParseWordPrepResult> {
    if (!shared.surveyJson) {
      throw new Error("Base survey JSON is missing in shared memory for ParseWordToSurveyNode")
    }
    if (!shared.wordDocumentText) {
      throw new Error("Word document text is missing in shared memory for ParseWordToSurveyNode")
    }

    return {
      baseSurvey: shared.surveyJson,
      wordText: shared.wordDocumentText
    }
  }

  async exec(prepRes: ParseWordPrepResult): Promise<Questionnaire | Error> {
    try {
      console.log("Parsing Word document into structured chunks...")
      
      // Step 1: Parse the Word document text into logical chunks using LLM
      const chunkingPrompt = `You are an AI assistant that helps parse survey documents into structured chunks.
Your task is to analyze the following survey document text and separate it into logical chunks representing survey blocks and questions.

Survey Text:
${prepRes.wordText}

For each identified chunk, output a valid JSON object with the following properties:
- type: "block" for section headers or groups, "question" for individual questions, "other" for metadata or instructions
- content: the actual text of the chunk
- context: any parent or hierarchical information useful for understanding this chunk
- metadata: any additional useful information like question type, choices, etc.

Output the results as a single JSON array of these chunk objects. Ensure the JSON is valid and parseable.
The output MUST be a valid JSON array starting with '[' and ending with ']'.

Example output format:
[
  {
    "type": "block",
    "content": "Section 1: Demographics",
    "context": "root",
    "metadata": { "level": 1 }
  },
  {
    "type": "question",
    "content": "What is your age?",
    "context": "Section 1: Demographics",
    "metadata": { "questionType": "numeric" }
  }
]`

      const chunksResponse = await callLlm(chunkingPrompt)
      let chunks: SurveyChunk[]
      
      try {
        // Extract JSON array from response if wrapped in code blocks
        console.debug("LLM response:", chunksResponse)
        const jsonMatch = chunksResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, chunksResponse]
        const jsonText = jsonMatch[1].trim()
        
        chunks = JSON.parse(jsonText)
        console.log(`Successfully parsed ${chunks.length} chunks from Word document`)
      } catch (parseError) {
        console.error("Failed to parse chunks from LLM response:", parseError)
        throw new Error("Failed to parse survey chunks from Word document")
      }

      // Step 2: Process each chunk into JSON Patch operations
      let currentSurvey = { ...prepRes.baseSurvey } // Create a copy to apply patches to
      let allErrors = []
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        console.log(`Processing chunk ${i+1}/${chunks.length}: ${chunk.type} - ${chunk.content.substring(0, 30)}...`)
        
        // Generate JSON Patch operation for this chunk
        const patchPrompt = `You are an AI assistant that converts survey chunk text into JSON Patch operations (RFC 6902).
Your task is to generate JSON Patch operations that would incorporate this chunk into a Voxco survey JSON structure.

Current Survey JSON State:
${JSON.stringify(currentSurvey, null, 2)}

Survey Schema:
${JSON.stringify(questionnaireSchema, null, 2)}

Chunk to Process:
${JSON.stringify(chunk, null, 2)}

Generate a valid JSON Patch array that would add this chunk to the survey. Follow these guidelines:
1. If this is a block, it should typically be added to the 'blocks' array
2. If this is a question, it should typically be added to the most appropriate block's 'questions' array
3. DO NOT generate an 'id' field for new elements (leave it out or set to null)
4. Ensure all paths are valid for the current survey state
5. Make sure the resulting JSON will conform to the schema

The output MUST ONLY be a valid JSON Patch array starting with '[' and ending with ']'.

Example output format:
[
  {
    "op": "add",
    "path": "/blocks/-",
    "value": {
      "name": "Demographics",
      "questions": []
    }
  }
]`

        const patchResponse = await callLlm(patchPrompt)
        let patchOperations: Operation[]
        
        try {
          // Extract JSON array from response if wrapped in code blocks
          const jsonMatch = patchResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, patchResponse]
          const jsonText = jsonMatch[1].trim()
          
          patchOperations = JSON.parse(jsonText)
        } catch (parseError) {
          console.error(`Failed to parse patch operations for chunk ${i+1}:`, parseError)
          allErrors.push(`Failed to parse patch for chunk ${i+1}: ${chunk.content.substring(0, 50)}...`)
          continue // Skip this chunk and try the next one
        }
        
        // Apply patch to current survey state
        try {
          const result = applyPatch({ ...currentSurvey }, patchOperations)
          
          // Validate the patched survey against schema
          const isValid = validateSchema(result.newDocument)
          
          if (isValid) {
            currentSurvey = result.newDocument
            console.log(`Successfully applied patch for chunk ${i+1}`)
          } else {
            console.error(`Schema validation failed for chunk ${i+1}:`, validateSchema.errors)
            allErrors.push(`Schema validation failed for chunk ${i+1}: ${chunk.content.substring(0, 50)}...`)
            // Continue with next chunk using the previous valid state
          }
        } catch (patchError) {
          console.error(`Failed to apply patch for chunk ${i+1}:`, patchError)
          allErrors.push(`Failed to apply patch for chunk ${i+1}: ${chunk.content.substring(0, 50)}...`)
          // Continue with next chunk using the previous valid state
        }
      }
      
      if (allErrors.length > 0) {
        console.warn(`Completed with ${allErrors.length} errors:`)
        allErrors.forEach((err, i) => console.warn(`${i+1}. ${err}`))
      }
      
      return currentSurvey
    } catch (error) {
      console.error("Error during Word document parsing:", error)
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  async post(shared: SharedMemory, prepRes: ParseWordPrepResult, execRes: Questionnaire | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `Word document parsing failed: ${execRes.message}`
      return "error" // Transition to ErrorHandler node
    } else {
      shared.surveyJson = execRes
      shared.wordDocumentText = null // Clear Word text as it's been processed
      shared.errorMessage = null // Clear any previous error
      console.log("Word document successfully parsed and integrated into survey structure.")
      
      // Add a helpful message for the next user interaction
      shared.currentUserMessage = "The Word document has been processed and its content integrated into the survey. Please review and continue editing."
      
      return "default" // Transition to ChatAgent node
    }
  }
} 