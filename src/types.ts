export interface QASharedStore {
  question?: string
  answer?: string
}

// Based on data/questionnare-schema.json and design doc
// Represents the structure defined in data/questionnare-schema.json
// It's complex, so we define it conceptually here with its top-level keys.
// For detailed sub-structures (like Settings, Blocks, Questions, etc.), 
// refer directly to the data/questionnare-schema.json file.
export interface Questionnaire {
  _v?: string; // Schema version
  _d?: string; // Modification date
  id?: number | null; // Survey ID (use `id` instead of `Id`)
  name?: string | null; // Survey name (use `name` instead of `Name`)
  version?: number; // Survey version (use `version` instead of `Version`)
  useS2?: boolean;
  settings?: Record<string, any>; // Global survey settings object
  languages?: string[]; // Array of language codes
  defaultLanguage?: string | null;
  blocks?: any[]; // Array of Block objects
  choiceLists?: any[]; // Array of ChoiceList arrays
  questionStyles?: any[]; // Array of custom styles
  shortcuts?: any[]; // Array of shortcuts
  randomizations?: any[]; // Array of global randomizations
  columns?: Record<string, any>; // Column definitions object
  surveyProperties?: Record<string, any>; // Additional survey properties
  translatedTexts?: Record<string, Record<string, string>>; // System messages translations
  theme?: Record<string, any>; // Theme object
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SharedMemory {
  // --- Initialization Data ---
  initializationType: 'scratch' | 'api' | 'word' | null;
  initializationSource?: string | Buffer | number | null; // File path, buffer, or Voxco Survey ID
  voxcoCredentials?: { username: string, password: string }; // Raw credentials obtained via prompt (console) or env vars (production)
  voxcoSurveyId: number | null; // Explicit ID of the survey on Voxco platform

  // --- Core Survey Data ---
  surveyJson?: Questionnaire | null; // The main survey object being built/modified

  // --- Chat Agent State ---
  currentUserMessage?: string | null; // The latest message from the user
  displayResponse?: string | null; // Response from LLM that should be displayed to the user
  // Optional: Keep track of chat history if needed for context, manage its size
  // chatHistory?: ChatMessage[]; 

  // --- Output State ---
  saveStatus?: boolean | string | null; // Result from SaveToVoxco node
  errorMessage?: string | null; // To store any errors encountered
}
