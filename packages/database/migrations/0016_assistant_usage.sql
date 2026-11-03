-- The admin assistant (packages/ai/src/assistant.ts): a chat agent that reads
-- store data through permission-checked tools and proposes changes for the
-- member to confirm. Each question counts against its own daily allowance,
-- next to AI Studio's generations, on the same per-store usage row.

ALTER TABLE app.ai_usage_days
  ADD COLUMN assistant_messages integer NOT NULL DEFAULT 0 CHECK (assistant_messages >= 0);
