import dotenv from 'dotenv';
dotenv.config(); // Load .env variables

import { SharedMemory } from "./types";
import { createSurveyBotFlow } from "./flow";
import { InitializerRouter } from "./nodes/InitializerRouter"; 
import { ScratchInitializer } from "./nodes/ScratchInitializer";
import { ApiInitializer } from "./nodes/ApiInitializer";
import { WordDocumentInitializer } from "./nodes/WordDocumentInitializer";
import { ChatAgent } from "./nodes/ChatAgent"; 
import { SaveToVoxco } from "./nodes/SaveToVoxco";
import { ErrorHandler } from "./nodes/ErrorHandler";
import { ParseWordToSurveyNode } from "./nodes/ParseWordToSurveyNode";
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

    let initializationSource: string | number | null | 
        { type: 'new_voxco', surveyName: string } | 
        { type: 'api_voxco', surveyId: number } | 
        { type: 'local_scratch' } = null;

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
        let filePath = null;
        while (filePath === null) {
            const path = prompt("Enter the path to the Word document (.docx): ").trim();
            try {
                await fs.access(path);
                filePath = path;
            } catch (err) {
                console.log(`Error: File not found or inaccessible at path: ${path}`);
            }
        }
        
        // Ask about the base survey for Word import
        let baseChoice = null;
        while (baseChoice === null) {
            const choice = prompt("Import Word document into: (1) New Voxco survey, (2) Existing Voxco survey, (3) Local scratch survey [1/2/3]: ").trim();
            if (choice === '1') {
                const surveyName = prompt("Enter name for the new survey: ").trim();
                if (surveyName) {
                    initializationSource = {
                        type: 'new_voxco' as const,
                        surveyName
                    };
                    baseChoice = choice;
                } else {
                    console.log("Survey name cannot be empty.");
                }
            } else if (choice === '2') {
                const surveyIdStr = prompt("Enter the existing Voxco Survey ID: ").trim();
                const surveyId = parseInt(surveyIdStr, 10);
                if (!isNaN(surveyId) && surveyId > 0) {
                    initializationSource = {
                        type: 'api_voxco' as const,
                        surveyId
                    };
                    baseChoice = choice;
                } else {
                    console.log("Invalid Survey ID. Please enter a positive number.");
                }
            } else if (choice === '3') {
                initializationSource = {
                    type: 'local_scratch' as const
                };
                baseChoice = choice;
            } else {
                console.log("Invalid choice.");
            }
        }
        
        // For Word documents, we need to store both the import config and the file path
        // Store the file path in initializationSource
        const wordFilePath = filePath;
        // We'll save the original object temporarily
        const importConfig = initializationSource;
        // Then set initializationSource to the file path
        initializationSource = wordFilePath;
        
        // We'll store the import config in shared directly when setting up shared memory
        return {
            initializationType,
            initializationSource,
            wordDocumentText: null, // Initialize for future use
            voxcoCredentials: await getCredentials(initializationType, importConfig),
            wordImportBaseDetails: importConfig
        };
    }

    return {
        initializationType,
        initializationSource,
        voxcoCredentials: await getCredentials(initializationType, initializationSource)
    };
}

// Helper function to get credentials
async function getCredentials(
    initType: 'scratch' | 'api' | 'word' | null,
    source: any
): Promise<{ username: string, password: string } | undefined> {
    // Get Credentials (using environment variables first, then prompt)
    let username = process.env.VOXCO_USERNAME;
    let password = process.env.VOXCO_PASSWORD;

    // If using Voxco API or importing Word into Voxco, we need credentials
    const needsCredentials = initType === 'api' || 
                            (initType === 'word' && 
                             source && 
                             typeof source === 'object' &&
                             (source.type === 'new_voxco' || source.type === 'api_voxco'));

    if (needsCredentials) {
        if (!username) {
            username = prompt("Enter Voxco Username: ");
        }
        if (!password) {
            password = prompt("Enter Voxco Password: ", { echo: '*' });
        }

        if (!username || !password) {
            throw new Error("Voxco credentials are required for this operation.");
        }
        
        return { username, password };
    }
    
    return undefined;
}

// Main application logic
async function main(): Promise<void> {
    try {
        const initialConfig = await getInitialSetup();

        // Initialize shared memory based on args
        const shared: SharedMemory = {
            initializationType: initialConfig.initializationType || null,
            initializationSource: initialConfig.initializationSource,
            voxcoCredentials: initialConfig.voxcoCredentials,
            wordDocumentText: initialConfig.wordDocumentText,
            activeVoxcoSurveyId: null, // Survey ID for Voxco operations
            surveyJson: null,
            currentUserMessage: null,
            saveStatus: null,
            errorMessage: null,
            wordImportBaseDetails: initialConfig.wordImportBaseDetails
        };

        // Create node instances (needed for manual execution loop)
        const routerNode = new InitializerRouter();
        const scratchNode = new ScratchInitializer();
        const apiNode = new ApiInitializer();
        const wordNode = new WordDocumentInitializer();
        const parseWordNode = new ParseWordToSurveyNode();
        const agentNode = new ChatAgent();
        const saveNode = new SaveToVoxco();
        const errorNode = new ErrorHandler();

        console.log("\nRouting initialization process...");
        // First use the router to determine which initializer to use
        let initializerType = await routerNode.run(shared);
        
        // Run the appropriate initializer based on type
        let nextAction;
        if (initializerType === 'scratch') {
            console.log("\nInitializing survey from scratch...");
            nextAction = await scratchNode.run(shared);
        } else if (initializerType === 'api') {
            console.log("\nInitializing survey from Voxco API...");
            nextAction = await apiNode.run(shared);
        } else if (initializerType === 'word') {
            console.log("\nInitializing survey from Word document...");
            nextAction = await wordNode.run(shared);
            
            // Handle word parsing if needed
            if (nextAction === 'word_ready_for_parsing') {
                console.log("\nParsing Word document...");
                nextAction = await parseWordNode.run(shared);
            }
        } else if (initializerType === 'error') {
            nextAction = 'error';
        } else {
            throw new Error(`Unknown initialization type: ${initializerType}`);
        }

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

            // If action is 'default' (from Init, ParseWord, Save, Error) or 'modify_survey' (from Agent loop)
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
             const finalFileName = `output/survey_${shared.activeVoxcoSurveyId || 'local'}_final.json`;
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
