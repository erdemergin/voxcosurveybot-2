import dotenv from 'dotenv';
dotenv.config(); // Load .env variables

import { SharedMemory } from "./types";
import { createSurveyBotFlow } from "./flow";
import { 
    InitializeSurvey, 
    ChatAgent, 
    SaveToVoxco, 
    ErrorHandler 
} from "./nodes"; // Import node classes directly for manual execution
import PromptSync from "prompt-sync";
import fs from 'fs/promises';
import path from 'path';

const prompt = PromptSync({ sigint: true }); // Allows Ctrl+C exit

// Helper function to get initial user setup
async function getInitialSetup(): Promise<Partial<SharedMemory>> {
    console.log("Welcome to the Survey Design Assistant!");

    let initializationType: 'scratch' | 'api' | 'word' | null = null;
    while (!initializationType) {
        const typeChoice = prompt("Start from (1) Scratch, (2) Voxco API, or (3) Word Doc? [1/2/3]: ").trim();
        if (typeChoice === '1') initializationType = 'scratch';
        else if (typeChoice === '2') initializationType = 'api';
        else if (typeChoice === '3') initializationType = 'word';
        else console.log("Invalid choice.");
    }

    let initializationSource: string | number | null = null;
    if (initializationType === 'api') {
        while (initializationSource === null) {
            const surveyIdStr = prompt("Enter the Voxco Survey ID to import: ").trim();
            const surveyId = parseInt(surveyIdStr, 10);
            if (!isNaN(surveyId) && surveyId > 0) {
                initializationSource = surveyId;
            } else {
                console.log("Invalid Survey ID. Please enter a positive number.");
            }
        }
    } else if (initializationType === 'word') {
        while (initializationSource === null) {
            const filePath = prompt("Enter the path to the Word document (.docx): ").trim();
            try {
                await fs.access(filePath);
                initializationSource = filePath;
            } catch (err) {
                console.log(`Error: File not found or inaccessible at path: ${filePath}`);
            }
        }
    }

    // Get Credentials (using environment variables first, then prompt)
    let username = process.env.VOXCO_USERNAME;
    let password = process.env.VOXCO_PASSWORD;

    if (!username) {
        username = prompt("Enter Voxco Username: ", { echo: '*' });
    }
    if (!password) {
        password = prompt("Enter Voxco Password: ", { echo: '*' });
    }

    if (!username || !password) {
        throw new Error("Voxco credentials are required.");
    }

    return {
        initializationType,
        initializationSource,
        voxcoCredentials: { username, password }
    };
}

// Main application logic
async function main(): Promise<void> {
    try {
        const initialConfig = await getInitialSetup();

        // Initialize shared memory
        const shared: SharedMemory = {
            initializationType: initialConfig.initializationType || null,
            initializationSource: initialConfig.initializationSource,
            voxcoCredentials: initialConfig.voxcoCredentials,
            surveyJson: null,
            currentUserMessage: null,
            saveStatus: null,
            errorMessage: null,
        };

        // Create node instances (needed for manual execution loop)
        const initNode = new InitializeSurvey();
        const agentNode = new ChatAgent();
        const saveNode = new SaveToVoxco();
        const errorNode = new ErrorHandler();

        console.log("\nInitializing survey...");
        let nextAction = await initNode.run(shared); // Run initialization

        // Main interaction loop
        console.log("\nEnter your instructions to modify the survey (e.g., 'Add a question', 'Change the survey name to X', 'Save', 'Exit').");

        while (nextAction !== 'exit') {
            if (nextAction === 'error') {
                // Run error handler and get its default action back
                await errorNode.run(shared);
                nextAction = "default"; // Error handler always returns to agent loop
            }

            if (nextAction === 'save_survey') {
                console.log("\nSaving survey to Voxco...");
                nextAction = await saveNode.run(shared); // Run save, returns default or error
                if(nextAction === 'default') {
                     console.log("Save process completed. You can continue editing or type 'Exit'.");
                }
                continue; // Go back to start of loop to handle save result (error or default)
            }

            // If action is 'default' (from Init, Save, Error) or 'modify_survey' (from Agent loop)
            // We need user input to proceed with the ChatAgent
            const userInput = prompt("> ").trim();

            if (!userInput) continue; // Ignore empty input

            const lowerInput = userInput.toLowerCase();
            if (lowerInput === 'exit' || lowerInput === 'quit') {
                nextAction = 'exit';
                continue; // Exit the loop
            }

            // Update shared memory with user message and run agent
            shared.currentUserMessage = userInput;
            nextAction = await agentNode.run(shared);
        }

        console.log("\nExiting Survey Design Assistant.");
        if (shared.surveyJson) {
            console.log("Final survey state:");
            console.log(JSON.stringify(shared.surveyJson, null, 2));
            // Optionally save to a local file on exit
             const finalFileName = `survey_${shared.surveyJson.id || 'local'}_final.json`;
             await fs.writeFile(finalFileName, JSON.stringify(shared.surveyJson, null, 2));
             console.log(`Final survey JSON also saved locally to: ${finalFileName}`);
        }

    } catch (error) {
        console.error("\n--- Critical Error Occurred ---");
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error:", message);
        if (error instanceof Error && error.stack) {
             console.error("Stack Trace:", error.stack);
        }
        console.error("------------------------------");
        process.exit(1); // Exit with error code
    }
}

// Run the main function
main();
