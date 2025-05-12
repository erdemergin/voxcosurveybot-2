# Survey Design Assistant

An AI-powered assistant for designing Voxco surveys.

## Features

- Create surveys from scratch or import from Voxco API
- Import surveys from Word documents
- Modify surveys using natural language instructions
- Save surveys back to Voxco
- Export surveys as JSON files

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file based on `.env.example` with your Voxco credentials:
   ```
   VOXCO_USERNAME=your_username
   VOXCO_PASSWORD=your_password
   OPENAI_API_KEY=your_openai_api_key
   ```

## Running the Application

### API Server

Run the API server with:

```
npm run dev
```

The API will be available at http://localhost:3000

### Web Client

Run the client server with:

```
npm run client
```

The web interface will be available at http://localhost:8080

### Run Both Together

Run both API and client servers together with:

```
npm run dev:all
```

## API Endpoints

### Initialize Survey

```
POST /api/initialize
```

Request body:
```json
{
  "initializationType": "scratch|api|word",
  "initializationSource": "survey_id_or_file_path", // Optional
  "username": "voxco_username",
  "password": "voxco_password"
}
```

Response:
```json
{
  "message": "Survey initialized successfully",
  "survey": { /* Survey JSON */ },
  "sessionId": "unique_session_id"
}
```

### Process Chat Messages

```
POST /api/chat
```

Request body:
```json
{
  "sessionId": "session_id",
  "message": "Add a multiple choice question about favorite colors"
}
```

Response:
```json
{
  "message": "Changes applied successfully",
  "survey": { /* Updated Survey JSON */ },
  "sessionId": "session_id"
}
```

### Save Survey to Voxco

```
POST /api/save
```

Request body:
```json
{
  "sessionId": "session_id"
}
```

Response:
```json
{
  "message": "Survey saved successfully",
  "saveStatus": "status_message",
  "survey": { /* Survey JSON */ },
  "sessionId": "session_id"
}
```

### Get Current Survey State

```
GET /api/survey?sessionId=session_id
```

Response:
```json
{
  "survey": { /* Survey JSON */ },
  "sessionId": "session_id"
}
```

### Export Survey to JSON File

```
POST /api/export
```

Request body:
```json
{
  "sessionId": "session_id"
}
```

Response:
```json
{
  "message": "Survey exported successfully",
  "fileName": "survey_123_timestamp.json",
  "filePath": "/output/survey_123_timestamp.json",
  "sessionId": "session_id"
}
```

## Using the Web Interface

1. Open http://localhost:8080 in your browser
2. Initialize a survey by selecting the type and entering credentials
3. Use natural language to modify your survey
4. Save to Voxco or export as JSON when finished
