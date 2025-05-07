import { Flow } from 'pocketflow'
import {
  InitializerRouter,
  ScratchInitializer,
  ApiInitializer,
  WordDocumentInitializer,
  ParseWordToSurveyNode,
  ChatAgent,
  SaveToVoxco,
  ErrorHandler,
} from './nodes'
import { SharedMemory } from './types'

export function createSurveyBotFlow(): Flow<SharedMemory> {
  // 1. Create node instances
  const routerNode = new InitializerRouter()
  const scratchNode = new ScratchInitializer()
  const apiNode = new ApiInitializer()
  const wordNode = new WordDocumentInitializer()
  const parseWordNode = new ParseWordToSurveyNode()
  const agentNode = new ChatAgent()
  const saveNode = new SaveToVoxco()
  const errorNode = new ErrorHandler()

  // 2. Connect nodes based on the design diagram
  
  // Initialization routing
  routerNode.on('scratch', scratchNode)   // Route to scratch initializer
  routerNode.on('api', apiNode)           // Route to API initializer
  routerNode.on('word', wordNode)         // Route to word document initializer
  routerNode.on('error', errorNode)       // On error, go to error handler

  // Initializer transitions
  scratchNode.on('default', agentNode)    // After scratch init, go to chat agent
  scratchNode.on('error', errorNode)      // On error, go to error handler
  
  apiNode.on('default', agentNode)        // After API init, go to chat agent
  apiNode.on('error', errorNode)          // On error, go to error handler
  
  wordNode.on('word_ready_for_parsing', parseWordNode) // For word import, go to parsing node
  wordNode.on('error', errorNode)         // On error, go to error handler

  // Word parsing transitions
  parseWordNode.on('default', agentNode)  // After successful parsing, go to chat agent
  parseWordNode.on('error', errorNode)    // On parsing error, go to error handler

  // Chat Agent transitions
  agentNode.on('modify_survey', agentNode) // Loop back on modification
  agentNode.on('save_survey', saveNode)   // Go to save node
  // agentNode.on("exit", ???);           // Exit is handled by the main loop in index.ts returning 'exit'
  agentNode.on('error', errorNode)        // Go to error handler on agent error

  // Save node transitions
  saveNode.on('default', agentNode)       // On success, go back to chat agent
  saveNode.on('error', errorNode)         // On error, go to error handler

  // Error handler transition
  errorNode.on('default', agentNode)      // After handling error, always go back to chat agent

  // 3. Create the flow starting with the initialization router
  const surveyBotFlow = new Flow<SharedMemory>(routerNode)

  return surveyBotFlow
}
