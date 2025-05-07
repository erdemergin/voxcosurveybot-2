import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from '../types';
import { readWordDocument } from '../utils/readWord';
import { voxcoApiAuthenticate, voxcoApiCreateSurvey, voxcoApiImportSurvey } from '../utils/voxcoApi';

export class WordDocumentInitializer extends Node<SharedMemory> {
  // Add class property to store the created survey ID
  private createdVoxcoSurveyId: number | null = null;

  async prep(shared: SharedMemory): Promise<{ 
    source: string | Buffer, 
    credentials?: { username: string, password: string },
    config: { type: 'new_voxco', surveyName: string } | { type: 'api_voxco', surveyId: number } | { type: 'local_scratch' }
  }> {
    if (!shared.initializationSource) {
      throw new Error("Initialization source (Word document) not set.")
    }
    
    // Extract the Word document path/content
    const wordSource = shared.initializationSource;
    if (typeof wordSource !== 'string' && !Buffer.isBuffer(wordSource)) {
      throw new Error('Invalid source for Word document import.')
    }
    
    // The import configuration should also be in initializationSource
    // TypeScript can't automatically infer this, so we need to check at runtime
    const importConfig = shared.initializationSource;
    if (!importConfig || typeof importConfig !== 'object' || 
        !('type' in importConfig) || 
        !(importConfig.type === 'new_voxco' || 
          importConfig.type === 'api_voxco' || 
          importConfig.type === 'local_scratch')) {
      throw new Error("Word import configuration not set correctly in initializationSource.")
    }
    
    // Check if we need credentials
    if ((importConfig.type === 'new_voxco' || 
        importConfig.type === 'api_voxco') && 
        !shared.voxcoCredentials) {
      throw new Error(`Voxco credentials not set for ${importConfig.type} import.`)
    }
    
    return {
      source: wordSource,
      credentials: shared.voxcoCredentials,
      config: importConfig
    }
  }

  async exec(prepRes: {
    source: string | Buffer,
    credentials?: { username: string, password: string },
    config: { type: 'new_voxco', surveyName: string } | { type: 'api_voxco', surveyId: number } | { type: 'local_scratch' }
  }): Promise<{ baseSurvey: Questionnaire, textFromWord: string } | Error> {
    try {
      console.log(`Initializing survey from Word document...`)
      
      // Establish base survey based on import configuration
      let baseSurvey: Questionnaire;
      
      if (prepRes.config.type === 'new_voxco') {
        // Create a new survey on Voxco
        if (!prepRes.credentials) throw new Error("Missing credentials for Voxco operations")
        console.log(`Creating new survey "${prepRes.config.surveyName}" on Voxco...`)
        const token = await voxcoApiAuthenticate(prepRes.credentials)
        const createResult = await voxcoApiCreateSurvey(prepRes.config.surveyName, token)
        
        // Store the Voxco survey ID in the class property
        this.createdVoxcoSurveyId = createResult.surveyId;
        
        // Create a minimal survey with a null ID (separate from Voxco surveyId)
        baseSurvey = {
          id: null, // Keep Questionnaire.id null or separate from Voxco survey ID
          name: prepRes.config.surveyName,
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
      } else if (prepRes.config.type === 'api_voxco') {
        // Import existing survey from Voxco
        if (!prepRes.credentials) throw new Error("Missing credentials for Voxco operations")
        console.log(`Importing existing survey (ID: ${prepRes.config.surveyId}) as base for Word import...`)
        const token = await voxcoApiAuthenticate(prepRes.credentials)
        baseSurvey = await voxcoApiImportSurvey(prepRes.config.surveyId, token)
        // Store Voxco survey ID in the class property
        this.createdVoxcoSurveyId = prepRes.config.surveyId;
      } else if (prepRes.config.type === 'local_scratch') {
        // Create a local scratch survey
        console.log("Creating local scratch survey as base for Word import...")
        baseSurvey = {
          id: null,
          name: "Survey from Word",
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
      } else {
        throw new Error("Invalid or missing import configuration")
      }
      
      // Read Word document
      const wordText = await readWordDocument(prepRes.source)
      console.log("Word document read successfully")
      
      // Return both the base survey and the Word document text
      return { 
        baseSurvey, 
        textFromWord: wordText
      }
    } catch (error) {
      console.error("Error during Word document initialization:", error)
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  async post(shared: SharedMemory, prepRes: any, execRes: { baseSurvey: Questionnaire, textFromWord: string } | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `Word document initialization failed: ${execRes.message}`
      return "error" // Transition to ErrorHandler node
    } else {
      // Store the base survey and word document text
      shared.surveyJson = execRes.baseSurvey
      shared.wordDocumentText = execRes.textFromWord
      
      // Set Voxco Survey ID based on initialization type
      if (prepRes.config?.type === 'api_voxco' && 'surveyId' in prepRes.config) {
        // For existing Voxco surveys, use surveyId from import config
        shared.activeVoxcoSurveyId = prepRes.config.surveyId
      } else if (prepRes.config?.type === 'new_voxco') {
        // For new Voxco surveys created in the exec method
        // Access our class property where we stored the survey ID
        shared.activeVoxcoSurveyId = this.createdVoxcoSurveyId
      } else {
        // For local scratch, there is no Voxco ID
        shared.activeVoxcoSurveyId = null
      }
      
      shared.errorMessage = null // Clear any previous error
      console.log("Base survey established and Word document read. Ready for parsing.")
      return "word_ready_for_parsing" // Transition to ParseWordToSurveyNode
    }
  }
} 