import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '../middleware/auth.js';
import { isPostgres } from '../db/mongodb.js';
import { assistantConfigured } from '../services/assistant/groq.js';
import { answer } from '../services/assistant/chat.js';

const router = express.Router();

// Admin only. The assistant reads business data, so cashiers and riders must never reach it.
router.use(authenticate, requireRole('admin'));

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `assistant:${req.user?.id || 'unknown'}`,
  message: { error: 'too_many_requests', message: 'Too many questions. Please wait a minute and try again.' }
});

const FRIENDLY = {
  assistant_not_configured: 'The AI assistant is not set up yet. The server needs a GROQ_API_KEY.',
  assistant_requires_postgres: 'The AI assistant needs the PostgreSQL database.',
  assistant_unreachable: 'The AI service could not be reached. Please try again.',
  assistant_tool_call_failed: 'The AI had trouble reading the data. Please try again.',
  assistant_upstream_error: 'The AI service had a problem. Please try again.'
};

router.get('/status', (req, res) => {
  res.json({ configured: assistantConfigured(), database_ready: isPostgres() });
});

router.post('/chat', chatLimiter, express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    if (!assistantConfigured()) {
      return res.status(503).json({ error: 'assistant_not_configured', message: FRIENDLY.assistant_not_configured });
    }
    if (!isPostgres()) {
      return res.status(503).json({ error: 'assistant_requires_postgres', message: FRIENDLY.assistant_requires_postgres });
    }
    const result = await answer(req.body?.messages);
    res.json({ reply: result.reply });
  } catch (error) {
    if (error.status === 400 && error.code === 'invalid_request') {
      return res.status(400).json({ error: error.code, message: error.message });
    }
    if (error.code && error.code.startsWith('assistant_')) {
      const message = error.status === 429
        ? 'The AI is busy right now. Please try again in a minute.'
        : FRIENDLY[error.code] || FRIENDLY.assistant_upstream_error;
      return res.status(error.status === 429 ? 429 : 503).json({ error: error.code, message });
    }
    next(error);
  }
});

export default router;
