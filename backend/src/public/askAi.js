// Public "Ask AI" for the landing page: answers questions about URAP with the server-configured
// AI provider (AI_* env), and falls back to a small built-in FAQ when AI is not configured or the
// provider fails. Never returns provider errors or keys to the caller.
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { chat as providerChat, resolveProvider } from '../agent/providers.js';

export const MAX_QUESTION = 500;

export const SYSTEM_PROMPT = `You are the assistant on the public website of URAP (Universal RPA Automation Platform).
Answer questions about URAP and business automation only. Be concise: 2-5 short sentences or a few bullets, plain text.
URAP features:
- Studio: a visual workflow designer (drag activities, recorder, Playwright codegen import), versions and publishing, templates (invoice extraction, web table scraping, Excel/CSV cleanup, and more).
- Robots: native server workers run web (Chromium), document, Excel/CSV, email, and API steps; UiPath robots or the URAP robot agent run desktop steps; hybrid mode mixes both.
- Orchestrator: jobs and runs with retries, schedules, queues, logs, artifacts, and metrics.
- Action Center: human-in-the-loop approval, form, and validation tasks that pause and resume a job; reviewers can correct extracted values.
- Document Understanding: OCR plus invoice, receipt, and purchase order field extraction with confidence scores and review.
- Agents, apps, cases and BPMN flows; connections (databases, email, APIs, AI providers: OpenAI, Azure OpenAI, Anthropic, OpenAI-compatible).
- Roles: administrator, project manager, developer, operator, reviewer, viewer; projects, audit logs, and encrypted credentials.
If a question is off topic, say briefly that you can only help with URAP and automation. Never invent prices or customer names; suggest "Contact us" for pricing and "Try URAP free" to get started.`;

const SUGGEST = 'Want to see it on your own process? Use "Try URAP free" to get started, or "Contact us" to talk to the team.';

export const FAQ = [
  { key: 'finance', words: ['finance', 'financial', 'invoice', 'accounts payable', 'bank', 'reconcil'],
    answer: 'For finance teams, URAP reads invoices and receipts with Document Understanding (invoice number, dates, vendor, totals, tax), sends low-confidence fields to Action Center for a quick human check, and writes the results to CSV, Excel, or your ERP through web or API steps. Reconciliation and report jobs can run on a schedule in Orchestrator.' },
  { key: 'healthcare', words: ['health', 'hospital', 'patient', 'clinic', 'claim', 'medical'],
    answer: 'In healthcare, URAP automates claims intake, referral and lab document extraction, and portal data entry. Documents are read with OCR, staff review exceptions in Action Center, and every run is logged for audit. Access is controlled with roles, and credentials are stored encrypted.' },
  { key: 'manufacturing', words: ['manufactur', 'supply', 'inventory', 'purchase order', 'factory', 'erp'],
    answer: 'For manufacturing, URAP extracts purchase orders, syncs inventory and order data between ERP screens, spreadsheets, and supplier portals, and runs these jobs on schedules or queues. Desktop ERP steps can run on UiPath or URAP robots while web and file steps run on server workers.' },
  { key: 'hr', words: ['hr', 'human resources', 'onboarding', 'employee', 'payroll', 'public sector', 'government', 'citizen'],
    answer: 'For HR and public sector teams, URAP automates onboarding forms, employee data updates across portals, and document checks. Approvals and validations go to Action Center so a person signs off, and audit logs record who did what for compliance.' },
  { key: 'start', words: ['start', 'begin', 'how do i', 'getting started', 'first', 'template'],
    answer: 'Start in Studio with a template (for example "Extract invoice fields into a CSV"), set its inputs, validate, and publish. Then run it from the Workflow library or schedule it in Orchestrator, and watch each job and its steps live.' },
  { key: 'robots', words: ['robot', 'uipath', 'desktop', 'attended', 'unattended', 'worker'],
    answer: 'URAP runs web, document, file, and API steps on its own server workers. Desktop steps run on a UiPath robot or the URAP robot agent on a machine you choose, and hybrid workflows hand those steps off automatically.' },
  { key: 'ai', words: ['ai', 'agent', 'llm', 'openai', 'anthropic', 'gpt', 'model'],
    answer: 'URAP agents use an AI provider you connect (OpenAI, Azure OpenAI, Anthropic, or an OpenAI-compatible endpoint). Agents can call tools such as looking up jobs or starting workflows, and their actions are logged; keys are stored encrypted and never shown.' },
  { key: 'actions', words: ['action center', 'approval', 'human', 'review', 'task', 'validation'],
    answer: 'Action Center brings people into automations: a workflow can pause on an approval, form, or validation task, a reviewer checks or corrects the values (for example extracted invoice fields), and the job resumes with their decision.' },
  { key: 'documents', words: ['document', 'ocr', 'pdf', 'extract', 'receipt', 'scan'],
    answer: 'Document Understanding reads PDFs and images with OCR and extracts invoice, receipt, and purchase order fields with confidence scores. Low-confidence or missing fields go to Action Center for review before the data is saved.' },
  { key: 'orchestrator', words: ['orchestrator', 'schedule', 'queue', 'monitor', 'job', 'run'],
    answer: 'Orchestrator runs and monitors every job: retries, schedules, queues, live step logs, artifacts, and metrics, so you can see what each robot did and when.' },
  { key: 'pricing', words: ['price', 'pricing', 'cost', 'license', 'plan', 'trial', 'free'],
    answer: 'You can try URAP free with the "Try URAP free" button. For pricing and licensing for your team, please use "Contact us".' },
];

const GENERAL = 'URAP is an automation platform: design workflows in Studio, run them on robots (server workers, UiPath, or the URAP agent), monitor every job in Orchestrator, and bring people in through Action Center. Document Understanding extracts data from invoices and other documents.';

/** Built-in answer used when AI is unavailable. */
export function fallbackAnswer(question, topic) {
  const text = String(question || '').toLowerCase();
  const byTopic = topic && FAQ.find((item) => item.key === topic);
  const byWord = FAQ.find((item) => item.words.some((word) => (word.length <= 3 ? new RegExp(`\\b${word}\\b`).test(text) : text.includes(word))));
  const hit = byTopic || byWord;
  return `${hit ? hit.answer : GENERAL} ${SUGGEST}`;
}

const body = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION),
  topic: z.enum(FAQ.map((item) => item.key)).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(8).optional().default([]),
});

export function registerPublicAsk(app, { pool, cfg, chat = providerChat, logger = console }) {
  const limit = rateLimit({
    windowMs: cfg.publicAskWindowMs ?? 60000,
    limit: cfg.publicAskMax ?? (cfg.env === 'test' ? 1000 : 12),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'You are asking quickly. Please wait a minute and try again.' } }),
  });

  app.post('/api/public/ask', limit, async (req, res) => {
    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: `Please ask a question of 1 to ${MAX_QUESTION} characters.` } });
    }
    const { question, topic, history } = parsed.data;
    let settings = null;
    try { settings = await resolveProvider(pool, cfg, {}); } catch { settings = null; }
    if (settings) {
      try {
        const result = await chat({ ...settings, timeoutMs: Math.min(settings.timeoutMs || 20000, 20000) }, {
          model: settings.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history.slice(-6), { role: 'user', content: question }],
          tools: [],
          temperature: 0.3,
          maxTokens: 350,
        });
        const answer = String(result?.content || '').trim();
        if (answer) return res.json({ data: { answer: answer.slice(0, 2500), source: 'ai' } });
      } catch (error) {
        logger.warn?.(`public ask: AI provider unavailable (${error.code || 'error'}), using built-in answer`);
      }
    }
    return res.json({ data: { answer: fallbackAnswer(question, topic), source: 'fallback' } });
  });
}
