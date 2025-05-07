import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from "../types"
import { callLlm } from '../utils/callLlm';
import { applyPatch, Operation } from 'fast-json-patch'
import questionnaireSchema from '../../data/questionnare-schema.json'
import Ajv from "ajv"
import addFormats from "ajv-formats"
import PromptSync from 'prompt-sync'

const prompt = PromptSync()
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateSchema = ajv.compile(questionnaireSchema)

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
If modifying, generate a JSON Patch (RFC 6902) array to apply the change to the survey JSON. Ensure the patch is valid and targets existing paths where appropriate (unless adding). **IMPORTANT: When adding new elements (like blocks, questions, choices), DO NOT generate an 'id' field. Leave it out or set it to null.** The system will handle ID generation.
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
          // Provide specific validation errors back to the user/LLM if possible
          const validationErrors = ajv.errorsText(validateSchema.errors)
          shared.errorMessage = `Modification failed: Resulting survey is invalid. Errors: ${validationErrors}`
          // Optional: Inform user via console
          console.log(`Modification rejected: Resulting survey is invalid. Errors: ${validationErrors}`)
          // We loop back to the agent without changing the survey
          return "modify_survey" 
        }

        // If patch and validation successful, update the shared state
        shared.surveyJson = patchResult.newDocument as Questionnaire
        shared.errorMessage = null // Clear error on success
        console.log("Survey successfully modified.")
        return "modify_survey" // Loop back for next user message

      } catch (patchError) {
        console.error("Error applying JSON patch or validating result:", patchError)
        const message = patchError instanceof Error ? patchError.message : String(patchError)
        shared.errorMessage = `Modification failed: ${message}`
        // Don't transition to error node, just report via errorMessage and loop
        console.log(`Modification rejected: Error applying patch - ${message}`)
        return "modify_survey" // Loop back to agent
      }
    }

    if (execRes.action === 'display_response') {
      if (execRes.content) {
         console.log("\nAssistant Response:\n---\n", execRes.content, "\n---")
      }
      return "modify_survey" // Loop back to agent for next user input
    }

    // For save_survey or exit, just return the action string
    return execRes.action
  }
}
