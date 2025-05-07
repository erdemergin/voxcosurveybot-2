import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from '../types';
import { voxcoApiAuthenticate, voxcoApiImportSurvey } from '../utils/voxcoApi';

export class ApiInitializer extends Node<SharedMemory> {
  // Add class property to store the created survey ID
  private importedVoxcoSurveyId: number | null = null;

  async prep(shared: SharedMemory): Promise<{ source: number, credentials: { username: string, password: string } }> {
    if (!shared.initializationSource) {
      throw new Error("Initialization source not set for API import.")
    }
    if (!shared.voxcoCredentials) {
      throw new Error("Voxco credentials not set for API import.")
    }
    if (typeof shared.initializationSource !== 'number') {
      throw new Error("Invalid Survey ID for API import. Expected a number.")
    }
    
    return {
      source: shared.initializationSource as number,
      credentials: shared.voxcoCredentials
    }
  }

  async exec(prepRes: { source: number, credentials: { username: string, password: string } }): Promise<Questionnaire | Error> {
    try {
      console.log(`Importing survey from Voxco API (ID: ${prepRes.source})...`)
      
      const apiToken = await voxcoApiAuthenticate(prepRes.credentials)
      const importedSurvey = await voxcoApiImportSurvey(prepRes.source, apiToken)
      console.log(`Successfully imported survey: ${importedSurvey.name}`)
      
      // Store the Voxco ID in the class property
      this.importedVoxcoSurveyId = prepRes.source
      
      return importedSurvey
    } catch (error) {
      console.error("Error during API survey import:", error)
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  async post(shared: SharedMemory, prepRes: { source: number, credentials: { username: string, password: string } }, execRes: Questionnaire | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `API import failed: ${execRes.message}`
      return "error" // Transition to ErrorHandler node
    } else {
      // Store the Questionnaire in shared memory
      shared.surveyJson = execRes
      // Store the Voxco Survey ID
      shared.activeVoxcoSurveyId = this.importedVoxcoSurveyId
      shared.errorMessage = null // Clear any previous error
      console.log(`Survey imported successfully from API. Survey ID: ${shared.activeVoxcoSurveyId}`)
      return "default" // Transition to ChatAgent node
    }
  }
} 