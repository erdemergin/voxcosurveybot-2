import dotenv from 'dotenv';
dotenv.config(); // Load .env variables

import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { SharedMemory } from "./types";
import { 
    InitializeSurvey, 
    ChatAgent, 
    SaveToVoxco, 
    ErrorHandler 
} from "./nodes";
import fs from 'fs/promises';
import path from 'path';

// Create Express server
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Session storage - in a production app, use Redis or a database
const sessions: Record<string, {
    shared: SharedMemory,
    lastAccessed: Date
}> = {};

// Initialize node instances to be used across requests
const initNode = new InitializeSurvey();
const agentNode = new ChatAgent();
const saveNode = new SaveToVoxco();
const errorNode = new ErrorHandler();

// Session cleanup - remove sessions older than 1 hour (run every 15 minutes)
setInterval(() => {
    const now = new Date();
    Object.keys(sessions).forEach(sessionId => {
        const lastAccessed = sessions[sessionId].lastAccessed;
        if ((now.getTime() - lastAccessed.getTime()) > 3600000) { // 1 hour
            delete sessions[sessionId];
            console.log(`Session ${sessionId} expired and removed`);
        }
    });
}, 900000); // 15 minutes

// Helper function to get or create session
function getOrCreateSession(sessionId?: string): { sessionId: string, shared: SharedMemory } {
    if (sessionId && sessions[sessionId]) {
        // Update last accessed time
        sessions[sessionId].lastAccessed = new Date();
        return { sessionId, shared: sessions[sessionId].shared };
    }
    
    // Create new session
    const newSessionId = uuidv4();
    const shared: SharedMemory = {
        initializationType: null,
        initializationSource: null,
        voxcoCredentials: undefined,
        voxcoSurveyId: null, 
        surveyName: null,
        surveyJson: null,
        currentUserMessage: null,
        saveStatus: null,
        errorMessage: null,
    };
    
    sessions[newSessionId] = {
        shared,
        lastAccessed: new Date()
    };
    
    return { sessionId: newSessionId, shared };
}

// API Routes

// Initialize a new survey
app.post('/api/initialize', async function(req: Request, res: Response) {
    try {
        const { initializationType, initializationSource, username, password, surveyName } = req.body;
        const { sessionId, shared } = getOrCreateSession(req.body.sessionId);
        
        // Validate required parameters
        if (!initializationType || !username || !password) {
            return res.status(400).json({ 
                error: "Missing required parameters",
                message: "initializationType, username, and password are required" 
            });
        }

        // Update shared memory with initialization parameters
        shared.initializationType = initializationType;
        shared.initializationSource = initializationSource;
        shared.voxcoCredentials = { username, password };
        shared.surveyName = surveyName || null;
        
        // Run initialization node
        const nextAction = await initNode.run(shared);
        
        if (nextAction === 'error') {
            // Run error handler
            await errorNode.run(shared);
            return res.status(400).json({ 
                error: true,
                message: shared.errorMessage,
                sessionId
            });
        }
        
        return res.status(200).json({ 
            message: "Survey initialized successfully", 
            survey: shared.surveyJson,
            sessionId
        });
    } catch (error) {
        console.error("Error in /api/initialize:", error);
        return res.status(500).json({ 
            error: true,
            message: error instanceof Error ? error.message : "Unknown error occurred" 
        });
    }
});

// Process user messages
app.post('/api/chat', async function(req: Request, res: Response) {
    try {
        const { message, sessionId } = req.body;
        
        if (!sessionId || !sessions[sessionId]) {
            return res.status(404).json({ 
                error: true,
                message: "Session not found. Please initialize a survey first." 
            });
        }
        
        if (!message) {
            return res.status(400).json({ 
                error: true,
                message: "Message is required" 
            });
        }
        
        const { shared } = getOrCreateSession(sessionId);
        
        // Check if survey is initialized
        if (!shared.surveyJson) {
            return res.status(400).json({ 
                error: true,
                message: "Survey not initialized. Please initialize a survey first." 
            });
        }
        
        // Handle special commands
        const lowerInput = message.toLowerCase();
        if (lowerInput === 'save') {
            // Handle save request as a separate action
            return res.status(200).json({
                message: "Use the /api/save endpoint to save the survey",
                survey: shared.surveyJson,
                sessionId
            });
        }
        
        // Update shared memory with user message
        shared.currentUserMessage = message;
        
        // Run agent node
        const nextAction = await agentNode.run(shared);
        
        if (nextAction === 'error') {
            // Run error handler
            await errorNode.run(shared);
            return res.status(400).json({ 
                error: true,
                message: shared.errorMessage,
                survey: shared.surveyJson,
                sessionId
            });
        }
        
        // Return the display response if it exists, otherwise use a generic message
        const responseMessage = shared.displayResponse || "Changes applied successfully";
        
        return res.status(200).json({
            message: responseMessage,
            survey: shared.surveyJson,
            sessionId
        });
    } catch (error) {
        console.error("Error in /api/chat:", error);
        return res.status(500).json({ 
            error: true,
            message: error instanceof Error ? error.message : "Unknown error occurred" 
        });
    }
});

// Save survey to Voxco
app.post('/api/save', async function(req: Request, res: Response) {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId || !sessions[sessionId]) {
            return res.status(404).json({ 
                error: true,
                message: "Session not found. Please initialize a survey first." 
            });
        }
        
        const { shared } = getOrCreateSession(sessionId);
        
        // Check if survey is initialized
        if (!shared.surveyJson) {
            return res.status(400).json({ 
                error: true,
                message: "Survey not initialized. Please initialize a survey first." 
            });
        }
        
        // Run save node
        const nextAction = await saveNode.run(shared);
        
        if (nextAction === 'error') {
            // Run error handler
            await errorNode.run(shared);
            return res.status(400).json({ 
                error: true,
                message: shared.errorMessage,
                saveStatus: shared.saveStatus,
                sessionId
            });
        }
        
        return res.status(200).json({
            message: "Survey saved successfully",
            saveStatus: shared.saveStatus,
            survey: shared.surveyJson,
            sessionId
        });
    } catch (error) {
        console.error("Error in /api/save:", error);
        return res.status(500).json({ 
            error: true,
            message: error instanceof Error ? error.message : "Unknown error occurred" 
        });
    }
});

// Get current survey state
app.get('/api/survey', async function(req: Request, res: Response) {
    try {
        const sessionId = req.query.sessionId as string;
        
        if (!sessionId || !sessions[sessionId]) {
            return res.status(404).json({ 
                error: true,
                message: "Session not found. Please initialize a survey first." 
            });
        }
        
        const { shared } = getOrCreateSession(sessionId);
        
        return res.status(200).json({
            survey: shared.surveyJson,
            sessionId
        });
    } catch (error) {
        console.error("Error in /api/survey:", error);
        return res.status(500).json({ 
            error: true,
            message: error instanceof Error ? error.message : "Unknown error occurred" 
        });
    }
});

// Initialize survey from imported JSON
app.post('/api/initialize-json', async function(req: Request, res: Response) {
    try {
        const { surveyJson, username, password } = req.body; // Assuming credentials might be needed for session association or future use
        const { sessionId, shared } = getOrCreateSession(req.body.sessionId); // Allow existing session or create new

        if (!surveyJson) {
            return res.status(400).json({ 
                error: true,
                message: "Survey JSON content is required for import." 
            });
        }

        // Basic validation of the imported JSON (can be expanded with a schema validator)
        if (typeof surveyJson !== 'object' || surveyJson === null) {
            return res.status(400).json({
                error: true,
                message: "Invalid survey JSON format."
            });
        }

        // Update shared memory
        shared.surveyJson = surveyJson;
        shared.initializationType = 'json'; // Mark how this session was initialized
        shared.initializationSource = 'fileupload'; // Or a more descriptive source like the filename if available
        shared.surveyName = surveyJson.name || 'Imported Survey'; // Use name from JSON or a default
        
        // If credentials are provided, store them (e.g., if needed for subsequent save operations)
        if (username && password) {
            shared.voxcoCredentials = { username, password };
        }
        
        // At this point, the survey is "initialized" with the imported JSON.
        // No further node processing like initNode is needed here unless there's a specific
        // post-import processing step defined.

        return res.status(200).json({ 
            message: "Survey imported and initialized successfully", 
            survey: shared.surveyJson,
            sessionId
        });

    } catch (error) {
        console.error("Error in /api/initialize-json:", error);
        // Ensure headers aren't already sent before sending error response
        if (!res.headersSent) {
            return res.status(500).json({ 
                error: true,
                message: error instanceof Error ? error.message : "Unknown error occurred during JSON import initialization" 
            });
        }
    }
});

// Export survey to JSON file
app.post('/api/export', async function(req: Request, res: Response) {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId || !sessions[sessionId]) {
            return res.status(404).json({ 
                error: true,
                message: "Session not found. Please initialize a survey first." 
            });
        }
        
        const { shared } = getOrCreateSession(sessionId);
        
        // Check if survey is initialized
        if (!shared.surveyJson) {
            return res.status(400).json({ 
                error: true,
                message: "Survey not initialized. Please initialize a survey first." 
            });
        }
        
        // Generate file content
        const surveyContent = JSON.stringify(shared.surveyJson, null, 2);
        const finalFileName = `survey_${shared.surveyJson.id || 'local'}_${Date.now()}.json`;

        // Save to output directory (optional, can be removed if not needed elsewhere)
        const outputDir = path.join(process.cwd(), 'output');
        try {
            await fs.access(outputDir);
        } catch {
            await fs.mkdir(outputDir, { recursive: true });
        }
        const filePath = path.join(outputDir, finalFileName);
        await fs.writeFile(filePath, surveyContent);
        console.log(`Survey exported to server path: ${filePath}`); // Log server path

        // Send file content as response
        res.setHeader('Content-Disposition', `attachment; filename="${finalFileName}"`);
        res.setHeader('Content-Type', 'application/json');
        res.send(surveyContent);

        // Note: We no longer return a JSON object with filePath, 
        // as the file content is sent directly.

    } catch (error) {
        console.error("Error in /api/export:", error);
        // Ensure headers aren't already sent before sending error response
        if (!res.headersSent) {
            return res.status(500).json({ 
                error: true,
                message: error instanceof Error ? error.message : "Unknown error occurred during export" 
            });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Survey Design Assistant API running on port ${PORT}`);
});
