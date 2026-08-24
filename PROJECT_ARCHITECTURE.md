# MirrorNovel Architecture

MirrorNovel is an AI-assisted novel writing platform. Its active product surface includes novel generation, continuation, polishing, writing personas, model configuration, and administration.

## Server

- `server/routes/auth.js`: authentication and account settings.
- `server/routes/novel.js`: novel types, generation, continuation, outline planning, chapter editing, and editorial workflows.
- `server/routes/persona.js`: writing-persona templates and AI-assisted template generation.
- `server/routes/admin.js`: user administration and model configuration.
- `server/services/aiService.js`: provider routing, prompt construction, streaming generation, and bounded chapter context.
- `server/services/novelContext.js`: persistent story context and continuity memory.

## Web Client

The Vue client provides generation, light-novel generation, continuation, polishing, bookshelf, profile, and writing-persona management. Model configuration remains available from the profile and admin areas.

## Data

Core collections are users, novels, writing personas, and story-context documents. User model configuration stores provider routes, model names, endpoints, and keys.

## Generation Flow

1. The client submits a novel type, setting, outline, optional persona, and target length.
2. The server resolves the configured model route and builds prompts from the selected type and persona.
3. Chapters stream through SSE and are saved incrementally.
4. Story-state and context services maintain continuity for later chapters.
