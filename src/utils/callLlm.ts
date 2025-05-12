import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config() // Load .env file

const apiKey = process.env.GOOGLE_API_KEY
const debugLlmApi = process.env.DEBUG_LLM_API === 'true'

if (!apiKey) {
  console.warn(
    'Warning: GOOGLE_API_KEY environment variable not set. LLM calls will fail.'
  )
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

const model = genAI
  ? genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL_NAME || 'gemini-2.5-pro-exp-03-25', // Or specify the exact version you used e.g., "gemini-2.5-pro-exp-03-25"
      // See https://ai.google.dev/docs/safety_setting_gemini for safety settings
      // safetySettings: [
      //   {
      //     category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      //     threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      //   },
      // ],
    })
  : null

// Basic implementation using Google Generative AI
export async function callLlm(prompt: string, debug = debugLlmApi): Promise<string> {
  if (!model) {
    throw new Error(
      'Generative AI client not initialized. Check GOOGLE_API_KEY.'
    )
  }

  if (debug) {
    console.debug('===== LLM REQUEST =====')
    console.debug(prompt)
    console.debug('======================')
  }

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()
    
    if (debug) {
      console.debug('===== LLM RESPONSE =====')
      console.debug(text)
      console.debug('=======================')
    }
    
    return text || ''
  } catch (error) {
    console.error('Error calling LLM (Google Generative AI):', error)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`LLM API call failed: ${message}`)
  }
}

// New function to get the stream of the result and wait for it to end
export async function callLlmStream(prompt: string, debug = debugLlmApi): Promise<string> {
  if (!model) {
    throw new Error(
      'Generative AI client not initialized. Check GOOGLE_API_KEY.'
    );
  }

  if (debug) {
    console.debug('===== LLM STREAM REQUEST =====')
    console.debug(prompt)
    console.debug('============================')
  }

  try {
    const result = await model.generateContentStream(prompt);
    let text = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      text += chunkText;
      if (debug) {
        console.debug('===== LLM STREAM CHUNK =====')
        console.debug(chunkText)
        console.debug('===========================')
      }
    }
    
    if (debug) {
      console.debug('===== LLM STREAM COMPLETE RESPONSE =====')
      console.debug(text)
      console.debug('=====================================')
    }
    
    return text;
  } catch (error) {
    console.error('Error calling LLM stream (Google Generative AI):', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM API stream call failed: ${message}`);
  }
}
