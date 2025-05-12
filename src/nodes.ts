import { Node } from 'pocketflow'
import { callLlm, callLlmStream } from './utils/callLlm'
import { QASharedStore } from './types'
import PromptSync from 'prompt-sync'
import { SharedMemory, Questionnaire } from "./types"
import {
  voxcoApiAuthenticate,
  voxcoApiCreateSurvey,
  voxcoApiImportSurvey,
  voxcoApiSaveSurvey,
} from "./utils/voxcoApi"
import { readWordDocument } from "./utils/readWord"
import { applyPatch, Operation } from 'fast-json-patch'
import Ajv from "ajv"
import addFormats from "ajv-formats"
import questionnaireSchema from '../data/questionnare-schema.json'
import * as fs from 'fs'

const prompt = PromptSync()
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateSchema = ajv.compile(questionnaireSchema)



// --- InitializeSurvey Node --- 

interface InitPrepResult {
  type: 'scratch' | 'api' | 'word' | null
  source?: string | Buffer | number | null
  credentials?: { username: string, password: string }
  surveyName?: string | null
}

export class InitializeSurvey extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<InitPrepResult> {
    if (!shared.initializationType) {
      throw new Error("Initialization type not set in shared memory.")
    }
    if ((shared.initializationType === 'api' || shared.initializationType === 'word') && !shared.initializationSource) {
       throw new Error(`Initialization source not set for type '${shared.initializationType}'.`)
    }
    if (shared.initializationType === 'api' && !shared.voxcoCredentials) {
       throw new Error(`Voxco credentials not set for type 'api'.`)
    }
    
    return {
      type: shared.initializationType,
      source: shared.initializationSource,
      credentials: shared.voxcoCredentials,
      surveyName: shared.surveyName
    }
  }

  async exec(prepRes: InitPrepResult): Promise<Questionnaire | Error> {
    try {
      switch (prepRes.type) {
        case 'scratch':
          console.log("Initializing new survey from scratch...")
          // Create a minimal valid Questionnaire object
          const scratchSurvey: Questionnaire = {
            id: null,
            name: prepRes.surveyName || "New Survey from Bot",
            version: 1,
            useS2: false,
            settings: {},
            languages: ["en"],
            defaultLanguage: "en",
            blocks: [],
            choiceLists: [],
            translatedTexts: { en: {} },
            theme: {}
          }
          return scratchSurvey

        case 'api':
          console.log(`Importing survey from Voxco API (ID: ${prepRes.source})...`)
          if (!prepRes.credentials) throw new Error("Missing credentials for API import")
          if (typeof prepRes.source !== 'number') throw new Error("Invalid Survey ID for API import")
          
          const apiToken = await voxcoApiAuthenticate(prepRes.credentials)
          const importedSurvey = await voxcoApiImportSurvey(prepRes.source, apiToken)
          console.log(`Successfully imported survey: ${importedSurvey.name}`)
          return importedSurvey

        case 'word':
          console.log(`Initializing survey from Word document: ${prepRes.source}...`)
          if (!prepRes.source || (typeof prepRes.source !== 'string' && !Buffer.isBuffer(prepRes.source))) {
            throw new Error('Invalid source for Word document import.')
          }
          const wordText = await readWordDocument(prepRes.source)
          console.log("Word document read, generating initial structure with LLM...")
          // Call LLM to convert text to JSON structure
          const prompt = `You are an AI assistant that STRICTLY outputs a single, valid, complete, and parsable JSON object.
Your entire response MUST be ONLY the JSON object. Do not include any other text, explanations, or markdown formatting.

Convert the following survey text extracted from a Word document into a valid Voxco Questionnaire JSON structure, adhering strictly to the JSON schema provided below.

Voxco Questionnaire JSON Schema:
\`\`\`json
${JSON.stringify(questionnaireSchema, null, 2)}
\`\`\`

Key requirements for the JSON output based on the schema:
1.  The entire output must be a single JSON object starting with '{' and ending with '}'.
2.  There MUST NOT be any 'id' field.
3.  Ensure all strings are properly escaped.
4.  All properties and nested structures must conform to the types and constraints defined in the schema above.

If the Voxco Questionnaire JSON schema is complex, ensure all nested structures, arrays, and objects are correctly formatted and complete according to the schema.

Survey Text to Convert:
${wordText}

JSON Output:`
          const llmResponseRaw = await callLlmStream(prompt)
          let llmResponse = llmResponseRaw.trim();

          // Attempt to strip markdown fences if present
          const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            llmResponse = jsonMatch[1].trim();
          } else {
            // Fallback: if it doesn't have fences but isn't a valid JSON object start/end, it might be an error or plain text.
            // However, for this specific prompt, we expect JSON. If it's not wrapped, we'll let JSON.parse try and fail.
          }
          
          try {
             const wordSurvey: Questionnaire = JSON.parse(llmResponse)
             // Basic validation or use AJV here too if needed
             if (!wordSurvey || typeof wordSurvey.version !== 'number') {
                throw new Error('LLM did not return a valid JSON structure.')
             }
             wordSurvey.id = null
             if (!wordSurvey.name) wordSurvey.name = "Survey from Word"
             console.log("Successfully generated initial structure from Word.")
             return wordSurvey
          } catch (parseError) {
             console.error("Failed to parse LLM response for Word import:", llmResponse, parseError)
             const errorFileName = `llm_response_error_${Date.now()}.txt`
             try {
                fs.writeFileSync(errorFileName, llmResponse)
                throw new Error(`LLM response for Word import was not valid JSON. Raw response saved to ${errorFileName}.`)
             } catch (fileError) {
                console.error(`Failed to write LLM response to ${errorFileName}:`, fileError)
                throw new Error("LLM response for Word import was not valid JSON. Additionally, failed to save the raw response to a file.")
             }
          }

        default:
          throw new Error(`Unsupported initialization type: ${prepRes.type}`)
      }
    } catch (error) {
        console.error("Error during survey initialization:", error)
        return error instanceof Error ? error : new Error(String(error))
    }
  }

  async post(shared: SharedMemory, prepRes: InitPrepResult, execRes: Questionnaire | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `Initialization failed: ${execRes.message}`
      return "error" // Transition to ErrorHandler node
    } else {
      shared.surveyJson = execRes
      shared.errorMessage = null // Clear any previous error
      console.log("Survey initialized successfully.")
      
      // If imported from API, store the Voxco Survey ID
      if (prepRes.type === 'api' && typeof prepRes.source === 'number') {
        shared.voxcoSurveyId = prepRes.source
        console.log(`Stored Voxco Survey ID: ${shared.voxcoSurveyId}`)
      } else {
        // Ensure it's null for scratch, word, or if API import somehow lacked an ID
        shared.voxcoSurveyId = null
      }
      
      return "default" // Transition to ChatAgent node
    }
  }
}

// --- ChatAgent Node --- 

interface AgentPrepResult {
  userMessage: string
  currentSurveyJson: Questionnaire | null
}

interface AgentExecResult {
  action: 'modify_survey' | 'save_survey' | 'exit' | 'display_response' | 'error'
  patch?: Operation[]
  errorMessage?: string
  content?: string // Added for display_response
}

export class ChatAgent extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<AgentPrepResult> {
     if (!shared.currentUserMessage) {
       // This might happen on the first run after initialization
       // We can perhaps synthesize a first message or handle it in exec
       console.log("ChatAgent: No user message found, awaiting input.")
       // Or throw an error if a message is always expected here
       // throw new Error("currentUserMessage is missing in shared memory for ChatAgent")
       return { userMessage: "", currentSurveyJson: shared.surveyJson || null }
     }
     if (!shared.surveyJson) {
        throw new Error("Survey JSON is missing in shared memory for ChatAgent")
     }
    // TODO: Implement more sophisticated context preparation if needed (e.g., summarizing survey)
    return {
      userMessage: shared.currentUserMessage,
      currentSurveyJson: shared.surveyJson,
    }
  }

  async exec(prepRes: AgentPrepResult): Promise<AgentExecResult> {
    if (!prepRes.userMessage) {
      // If prep allowed no message, just wait for the next loop
      return { action: 'modify_survey' } // Loop back immediately to wait for input
    }

    // Basic intent check before LLM call for simple commands
    const lowerCaseMessage = prepRes.userMessage.toLowerCase().trim()
    if (lowerCaseMessage === 'save') {
      return { action: 'save_survey' }
    }
    if (lowerCaseMessage === 'exit' || lowerCaseMessage === 'quit') {
      return { action: 'exit' }
    }

    try {
      // Prepare prompt for LLM
      const prompt = `User wants to interact with a Voxco survey design assistant.
Current Survey JSON: ${JSON.stringify(prepRes.currentSurveyJson, null, 2)}
Schema of the Survey JSON: ${JSON.stringify(questionnaireSchema, null, 2)}
User message: "${prepRes.userMessage}"

Analyze the user message. Determine the intent: modify the survey, save the survey, display information about the survey, or exit.
If modifying, generate a JSON Patch (RFC 6902) array to apply the change to the survey JSON. Ensure the patch is valid and targets existing paths where appropriate (unless adding). **IMPORTANT: When adding or modifying elements, DO NOT include properties with null values. Completely omit any property that would be null or empty instead of explicitly setting it to null.** For example, don't include 'rows' at all instead of setting 'rows: null'. The system will handle ID generation, so always omit 'id' fields in new elements.
If displaying information (e.g., showing the current structure, answering a question about it), generate a text response for the user.
If saving or exiting, respond with the action only.

Output ONLY a JSON object containing the 'action' and associated data.
Possible actions: 'modify_survey', 'save_survey', 'exit', 'display_response'.

Examples:
{ "action": "modify_survey", "patch": [ { "op": "replace", "path": "/name", "value": "New Survey Name" } ] }
{ "action": "save_survey" }
{ "action": "exit" }
{ "action": "display_response", "content": "The survey currently has 5 questions in 2 blocks." }
 `
 
      const llmResponse = await callLlm(prompt)
      let result: AgentExecResult
      let jsonStringToParse = llmResponse.trim();
      // console.debug("LLM response:", llmResponse)
      // Attempt to strip markdown fences if present
      const jsonMatch = jsonStringToParse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonStringToParse = jsonMatch[1].trim();
      } else {
         // Fallback: sometimes LLMs might just output JSON without fences
         // Check if it looks like a JSON object before attempting parse
         if (!jsonStringToParse.startsWith('{') || !jsonStringToParse.endsWith('}')) {
             console.error("LLM response does not appear to be JSON and lacks markdown fences:", llmResponse)
             // Maybe try to handle as plain text display? Or return error.
             // For now, let's try treating it as a display response if it's not JSON-like.
             // If it was *supposed* to be JSON, the validation below will fail.
             if (!['modify_survey', 'save_survey', 'exit'].includes(jsonStringToParse.toLowerCase())) {
                  // Assuming it's free text if it doesn't look like JSON or a simple action
                 return { action: 'display_response', content: llmResponse };
             }
             // Else, it might be a simple action string like 'save', let parsing fail naturally
         }
      }


      try {
        result = JSON.parse(jsonStringToParse)
      } catch (parseError) {
        console.error("Failed to parse LLM response in ChatAgent:", llmResponse, `(Tried parsing: ${jsonStringToParse})`, parseError)
        // If parsing fails, maybe treat the original llmResponse as a display message?
        // This avoids looping on errors if the LLM consistently fails to provide valid JSON.
        return { action: 'display_response', content: `Assistant response could not be processed as a command. Raw response: ${llmResponse}` }
        // Alternatively, return a specific error:
        // return { action: 'error', errorMessage: `LLM response could not be parsed as valid JSON command. Raw response: ${llmResponse}` }
      }
      
      // Validate LLM response structure
      if (!result || !['modify_survey', 'save_survey', 'exit', 'display_response'].includes(result.action)) {
          console.error("Invalid action received from LLM:", result)
          return { action: 'error', errorMessage: "LLM returned an invalid action." }
      }
      if (result.action === 'modify_survey' && !Array.isArray(result.patch)) {
          console.error("Missing or invalid patch received from LLM for modify action:", result)
          return { action: 'error', errorMessage: "LLM returned modify action without a valid patch." }
      }
      if (result.action === 'display_response' && typeof result.content !== 'string') {
          console.error("Missing or invalid content received from LLM for display action:", result)
          return { action: 'error', errorMessage: "LLM returned display action without valid content." }
      }
 
      return result

    } catch (error) {
      console.error("Error during ChatAgent execution:", error)
      const message = error instanceof Error ? error.message : String(error)
      return { action: 'error', errorMessage: `ChatAgent failed: ${message}` }
    }
  }

  async post(shared: SharedMemory, prepRes: AgentPrepResult, execRes: AgentExecResult): Promise<string> {
    shared.currentUserMessage = null // Clear message after processing
    // Clear any previous display response at the start of each interaction
    shared.displayResponse = null;

    if (execRes.action === 'error') {
      shared.errorMessage = execRes.errorMessage || "Unknown error in ChatAgent."
      return "error"
    }

    if (execRes.action === 'modify_survey') {
      if (!execRes.patch || !shared.surveyJson) {
         shared.errorMessage = "Modification failed: Patch or survey JSON missing."
         console.error("Modify action returned from LLM exec, but patch or surveyJson missing in post.")
         return "error"
      }
      try {
        // IMPORTANT: Apply patch to a clone to validate before committing
        const clonedSurvey = JSON.parse(JSON.stringify(shared.surveyJson))
        
        // First check that the patch is valid by itself
        try {
          const patchResult = applyPatch(clonedSurvey, execRes.patch)
          
          // Check if patching introduced errors (applyPatch might return errors or just modify in place)
          // We rely on schema validation primarily
          if (!patchResult || !patchResult.newDocument) {
             throw new Error("JSON patch application failed internally.")
          }
          
          // Validate the *result* against the schema
          const isValid = validateSchema(patchResult.newDocument)
          if (!isValid) {
            console.error("Schema validation failed after applying patch:", validateSchema.errors)
            
            // Format validation errors in a more user-friendly way
            const formattedErrors = validateSchema.errors?.map(err => {
              const path = err.instancePath || '';
              const message = err.message || 'Unknown validation error';
              const keyword = err.keyword || '';
              const params = err.params ? JSON.stringify(err.params) : '';
              
              return `- ${path}: ${message} (${keyword} ${params})`;
            }).join('\n');
            
            // Provide specific validation errors back to the user/LLM if possible
            shared.errorMessage = `Modification failed: Survey JSON validation error. Please fix the following issues:\n${formattedErrors}`;
            // Store validation errors for display in UI
            shared.displayResponse = `The changes couldn't be applied because of validation errors:\n${formattedErrors}`;
            
            // Optional: Inform user via console
            console.log(`Modification rejected: JSON validation failed. Errors: ${formattedErrors}`);
            
            // We loop back to the agent without changing the survey
            return "modify_survey" 
          }
          
          // If patch and validation successful, update the shared state
          shared.surveyJson = patchResult.newDocument as Questionnaire
          shared.errorMessage = null // Clear error on success
          console.log("Survey successfully modified.")
          return "modify_survey" // Loop back for next user message
        } catch (patchError) {
          // Handle specific patch errors
          console.error("Error applying JSON patch:", patchError)
          
          // Format specific patch error details
          let errorDetails = '';
          if (patchError instanceof Error) {
            // Special handling for JsonPatchError which might have additional details
            if ('operation' in patchError) {
              const opDetails = (patchError as any).operation;
              errorDetails = `\nFailed operation: ${JSON.stringify(opDetails, null, 2)}`;
            }
          }
          
          const message = patchError instanceof Error ? patchError.message : String(patchError)
          shared.errorMessage = `Modification failed: ${message}${errorDetails}`;
          // Also set display response for better UI feedback
          shared.displayResponse = `Failed to apply the changes: ${message}${errorDetails}`;
          // Don't transition to error node, just report via errorMessage and loop
          console.log(`Modification rejected: Error applying patch - ${message}${errorDetails}`)
          return "modify_survey" // Loop back to agent
        }
      } catch (processingError) {
        console.error("Error in patch processing or validation:", processingError)
        const message = processingError instanceof Error ? processingError.message : String(processingError)
        shared.errorMessage = `Modification failed: ${message}`;
        shared.displayResponse = `Error processing your request: ${message}`;
        return "modify_survey" // Loop back to agent
      }
    }

    if (execRes.action === 'display_response') {
      if (execRes.content) {
         console.log("\nAssistant Response:\n---\n", execRes.content, "\n---")
         // Store the display response in shared memory
         shared.displayResponse = execRes.content;
      }
      return "modify_survey" // Loop back to agent for next user input
    }

    // For save_survey or exit, just return the action string
    return execRes.action
  }
}

// --- SaveToVoxco Node --- 

interface SavePrepResult {
  surveyJson: Questionnaire
  credentials: { username: string, password: string }
  currentVoxcoSurveyId: number | null
}

export class SaveToVoxco extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<SavePrepResult> {
    if (!shared.surveyJson) {
      throw new Error("Cannot save: surveyJson is missing from shared memory.")
    }
     if (!shared.voxcoCredentials) {
       throw new Error(`Cannot save: Voxco credentials not set.`)
    }
    // We pass the current voxcoSurveyId from shared memory
    return {
      surveyJson: shared.surveyJson,
      credentials: shared.voxcoCredentials,
      currentVoxcoSurveyId: shared.voxcoSurveyId
    }
  }

  async exec(prepRes: SavePrepResult): Promise<number | Error> { // Returns survey ID on success
    const surveyToSave = prepRes.surveyJson
    const credentials = prepRes.credentials
    const currentId = prepRes.currentVoxcoSurveyId

    if (!prepRes.surveyJson) {
      return new Error("Cannot save, survey JSON is missing.")
    }
    if (!prepRes.credentials) {
        return new Error("Cannot save, Voxco credentials are missing.")
    }

    try {
        const token = await voxcoApiAuthenticate(credentials)
        let surveyIdToSave: number;

        if (currentId === null) {
            // First save for a new survey
            console.log("Creating new survey on Voxco platform...")
            const surveyName = surveyToSave.name || "Untitled Survey from Bot";
            const createResult = await voxcoApiCreateSurvey(surveyName, token)
            
            if (typeof createResult.surveyId !== 'number') {
                throw new Error(`Failed to get valid survey ID from create survey response: ${JSON.stringify(createResult)}`)
            }
            surveyIdToSave = createResult.surveyId;

            console.log(`New survey created with ID: ${surveyIdToSave}. Now saving content...`)
        } else {
            // Update existing survey
            surveyIdToSave = currentId;
            console.log(`Updating existing survey with ID: ${surveyIdToSave} on Voxco platform...`)
        }
        
        // Perform the save/update operation
        await voxcoApiSaveSurvey(surveyIdToSave, surveyToSave, token)
        console.log(`Survey content (ID: ${surveyIdToSave}) saved successfully.`)    
        return surveyIdToSave // Return the ID used for saving

    } catch (error) {
        console.error("Error during SaveToVoxco execution:", error)
        return error instanceof Error ? error : new Error(String(error))
    }
  }

  async post(shared: SharedMemory, prepRes: SavePrepResult, execRes: number | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `Save failed: ${execRes.message}`
      shared.saveStatus = false
      return "error"
    } else {
       // execRes is the saved survey ID (number)
       const savedSurveyId = execRes
       shared.saveStatus = true
       shared.voxcoSurveyId = savedSurveyId // Update shared memory with the definitive ID

      shared.errorMessage = null
      console.log(`SaveToVoxco finished successfully. Survey ID ${savedSurveyId} is stored.`)
      return "default" // Or maybe back to agent? Depends on desired flow after save.
    }
  }
}

// --- ErrorHandler Node --- 

export class ErrorHandler extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<string> {
    return shared.errorMessage || "An unknown error occurred."
  }

  async exec(errorMessage: string): Promise<void> {
    // Format and display the error to the user
    console.error("\n--- An Error Occurred ---")
    console.error(errorMessage)
    console.error("-------------------------")
    // Could potentially log the full error stack trace elsewhere
  }

  async post(shared: SharedMemory, prepRes: string, execRes: void): Promise<string> {
    // Clear the error message after handling
    shared.errorMessage = null
    // Always transition back to the ChatAgent to allow the user to continue or exit
    return "default" 
  }
}
