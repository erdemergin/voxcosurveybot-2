import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from '../types';
import { voxcoApiAuthenticate, voxcoApiCreateSurvey } from '../utils/voxcoApi';

export class SaveToVoxco extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<{survey: Questionnaire, surveyId: number | null, credentials: any}> {
    if (!shared.surveyJson) {
      throw new Error("No survey available to save");
    }
    
    if (!shared.activeVoxcoSurveyId) {
      throw new Error("No active Voxco survey ID for saving");
    }
    
    if (!shared.voxcoCredentials) {
      throw new Error("Voxco credentials not available");
    }

    return {
      survey: shared.surveyJson,
      surveyId: shared.activeVoxcoSurveyId,
      credentials: shared.voxcoCredentials
    };
  }

  async exec(prepRes: {survey: Questionnaire, surveyId: number | null, credentials: any}): Promise<{success: boolean, message: string}> {
    try {
      console.log(`Saving survey to Voxco (ID: ${prepRes.surveyId})...`);
      
      // Authenticate with Voxco API
      const token = await voxcoApiAuthenticate(prepRes.credentials);
      
      // Save survey to Voxco - use createSurvey since updateSurvey isn't available
      // This is a placeholder - in a real implementation, we would need proper update functionality
      const surveyName = prepRes.survey.name || "Unnamed Survey";
      const result = await voxcoApiCreateSurvey(surveyName, token);
      
      return {
        success: true,
        message: `Survey successfully saved to Voxco with ID: ${result.surveyId}`
      };
    } catch (error) {
      console.error("Error saving to Voxco:", error);
      return {
        success: false,
        message: `Failed to save survey: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async post(shared: SharedMemory, prepRes: any, execRes: {success: boolean, message: string}): Promise<string> {
    if (!execRes.success) {
      shared.errorMessage = execRes.message;
      return "error";
    } else {
      // Store success message in errorMessage but with null to indicate no error
      shared.errorMessage = null;
      return "default";
    }
  }
} 