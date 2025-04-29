import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { Questionnaire } from '../types'; // Import Questionnaire type

dotenv.config();

const BASE_URL = process.env.VOXCO_API_BASE_URL;

if (!BASE_URL) {
  console.warn("Warning: VOXCO_API_BASE_URL environment variable not set. Voxco API calls will fail.");
}

// --- Authentication --- 
export async function voxcoApiAuthenticate(credentials: { username: string, password: string }): Promise<string> {
  if (!BASE_URL) throw new Error("Voxco API base URL not configured.");
  if (!credentials || !credentials.username || !credentials.password) {
    throw new Error("Voxco credentials (username, password) are required for authentication.");
  }

  const url = `${BASE_URL}/authentication/user?userInfo.username=${encodeURIComponent(credentials.username)}&userInfo.password=${encodeURIComponent(credentials.password)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Authentication failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data: any = await response.json();
    if (!data || !data.Token) {
      throw new Error('Authentication successful, but token not found in response.');
    }
    return data.Token;
  } catch (error) {
    console.error('Error during Voxco authentication:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Voxco API authentication failed: ${message}`);
  }
}

// --- Create Survey --- 
export async function voxcoApiCreateSurvey(surveyName: string, token: string): Promise<{ surveyId: number, location: string }> {
  if (!BASE_URL) throw new Error("Voxco API base URL not configured.");
  const url = `${BASE_URL}/survey/create`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Client ${token}`,
      },
      body: JSON.stringify({ Name: surveyName }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Survey creation failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const locationHeader = response.headers.get('location');
    if (!locationHeader) {
      throw new Error('Survey created, but location header missing in response.');
    }

    const surveyIdMatch = locationHeader.match(/\/survey\/(\d+)/);
    if (!surveyIdMatch || !surveyIdMatch[1]) {
      throw new Error(`Survey created, but could not parse survey ID from location: ${locationHeader}`);
    }

    return {
      surveyId: parseInt(surveyIdMatch[1], 10),
      location: locationHeader,
    };
  } catch (error) {
    console.error('Error during Voxco survey creation:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Voxco API create survey failed: ${message}`);
  }
}

// --- Import/Get Survey --- 
export async function voxcoApiImportSurvey(surveyId: number, token: string): Promise<Questionnaire> {
  if (!BASE_URL) throw new Error("Voxco API base URL not configured.");
  // Updated URL might be needed if the endpoint for direct JSON export is different.
  // Assuming the current URL /survey/export/json/{surveyId} now returns JSON directly.
  const url = `${BASE_URL}/survey/export/json/${surveyId}?deployed=false&modality=Master`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json', // Explicitly accept JSON
        'Authorization': `Client ${token}`,
      },
    });

    if (!response.ok) {
       // Attempt to parse error details if the body is JSON
       let errorBody = await response.text();
       try {
         const errorJson = JSON.parse(errorBody);
         errorBody = errorJson?.message || errorJson?.error?.message || JSON.stringify(errorJson);
       } catch (e) {
         // Ignore parsing error, use the raw text
       }
       throw new Error(`Survey import failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    // Directly parse the JSON response body
    const surveyData: Questionnaire = await response.json();

    // Basic validation: Check if essential properties exist
    if (typeof surveyData.id !== 'number' || !Array.isArray(surveyData.languages)) {
      throw new Error('Parsed survey JSON lacks essential properties.');
    }
    return surveyData;

  } catch (error) {
    console.error('Error during Voxco survey import:', error);
    // Handle potential JSON parsing errors specifically if needed
    if (error instanceof SyntaxError) {
        throw new Error(`Voxco API import survey failed: Invalid JSON received from API. ${error.message}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Voxco API import survey failed: ${message}`);
  }
}

// --- Save/Update Survey --- 
export async function voxcoApiSaveSurvey(surveyId: number, surveyJson: Questionnaire, token: string): Promise<boolean> {
  if (!BASE_URL) throw new Error("Voxco API base URL not configured.");
  const url = `${BASE_URL}/survey/import/json/${surveyId}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Client ${token}`,
      },
      body: JSON.stringify(surveyJson),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Survey save failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    // Check response body for confirmation if necessary, often 2xx is enough
    // const responseData = await response.json(); 

    return true; // Indicate success
  } catch (error) {
    console.error('Error during Voxco survey save:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Voxco API save survey failed: ${message}`);
  }
} 