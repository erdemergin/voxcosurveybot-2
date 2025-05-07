import { Node } from 'pocketflow';
import { SharedMemory } from '../types';

export class InitializerRouter extends Node<SharedMemory> {
  async prep(shared: SharedMemory): Promise<string> {
    if (!shared.initializationType) {
      throw new Error("Initialization type not set in shared memory.")
    }
    return shared.initializationType
  }

  async exec(initializationType: string): Promise<string> {
    // Simply return the initialization type
    return initializationType
  }

  async post(shared: SharedMemory, prepRes: string, execRes: string): Promise<string> {
    // Return the initialization type as the action for routing
    return execRes
  }
} 