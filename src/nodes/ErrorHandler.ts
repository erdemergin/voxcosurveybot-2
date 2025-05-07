import { Node } from 'pocketflow';
import { SharedMemory } from '../types';

export class ErrorHandler extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<string> {
    return shared.errorMessage || "Unknown error occurred";
  }

  async exec(errorMessage: string): Promise<string> {
    console.error("Error handled:", errorMessage);
    return `Error handled: ${errorMessage}`;
  }

  async post(shared: SharedMemory, prepRes: string, execRes: string): Promise<string> {
    // Log the error and update shared memory with a user-friendly message
    console.log("Error handled and logged");
    shared.currentUserMessage = "There was an error processing your request. Let me know if you'd like to try again.";
    return "default"; // Return to main flow or another appropriate action
  }
} 