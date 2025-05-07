import { Node } from 'pocketflow';
import { SharedMemory, Questionnaire } from '../types';

export class ScratchInitializer extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<null> {
    // No special prep needed for scratch initialization
    return null
  }

  async exec(prepRes: null): Promise<Questionnaire> {
    console.log("Initializing new survey from scratch...")
    // Create a minimal valid Questionnaire object
    const scratchSurvey: Questionnaire = {
      id: null,
      name: "New Survey from Bot",
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
  }

  async post(shared: SharedMemory, prepRes: null, execRes: Questionnaire | Error): Promise<string> {
    if (execRes instanceof Error) {
      shared.errorMessage = `Scratch initialization failed: ${execRes.message}`
      return "error" // Transition to ErrorHandler node
    } else {
      // Store the Questionnaire in shared memory
      shared.surveyJson = execRes
      // For scratch initialization, set activeVoxcoSurveyId to null
      shared.activeVoxcoSurveyId = null
      shared.errorMessage = null // Clear any previous error
      console.log("Survey initialized successfully from scratch.")
      return "default" // Transition to ChatAgent node
    }
  }
} 