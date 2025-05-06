import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config() // Load .env file

const apiKey = process.env.GOOGLE_API_KEY

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
export async function callLlm(prompt: string): Promise<string> {
  if (!model) {
    throw new Error(
      'Generative AI client not initialized. Check GOOGLE_API_KEY.'
    )
  }

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()
    return text || ''
  } catch (error) {
    console.error('Error calling LLM (Google Generative AI):', error)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`LLM API call failed: ${message}`)
  }
}
