import { Flow } from 'pocketflow'
import {
  InitializeSurvey,
  ChatAgent,
  SaveToVoxco,
  ErrorHandler,
} from './nodes'
import { SharedMemory } from './types'

export function createSurveyBotFlow(): Flow<SharedMemory> {
  // 1. Create node instances
  const initNode = new InitializeSurvey()
  const agentNode = new ChatAgent()
  const saveNode = new SaveToVoxco()
  const errorNode = new ErrorHandler()

  // 2. Connect nodes based on the design diagram
  
  // Initialization transitions
  initNode.on('default', agentNode) // On success, go to chat agent
  initNode.on('error', errorNode)   // On error, go to error handler

  // Chat Agent transitions
  agentNode.on('modify_survey', agentNode) // Loop back on modification
  agentNode.on('save_survey', saveNode)   // Go to save node
  // agentNode.on("exit", ???); // Exit is handled by the main loop in index.ts returning 'exit'
  agentNode.on('error', errorNode)       // Go to error handler on agent error

  // Save node transitions
  saveNode.on('default', agentNode) // On success, go back to chat agent
  saveNode.on('error', errorNode)   // On error, go to error handler

  // Error handler transition
  errorNode.on('default', agentNode) // After handling error, always go back to chat agent

  // 3. Create the flow starting with the initialization node
  // Note: The flow execution might be managed differently in index.ts 
  // if interactive input is needed between agent loops.
  const surveyBotFlow = new Flow<SharedMemory>(initNode)

  // Optional: If the framework requires explicit registration of all nodes 
  // involved in the flow, add them here. This depends on the pocketflow API.
  // surveyBotFlow.addNode(agentNode);
  // surveyBotFlow.addNode(saveNode);
  // surveyBotFlow.addNode(errorNode);

  return surveyBotFlow
}
