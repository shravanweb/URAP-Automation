import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(root, '../.env') });
dotenv.config({ path: path.resolve(root, '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function credentialsKey() {
  const raw = required('CREDENTIALS_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

const SIGNUP_ROLES = ['project_manager', 'automation_developer', 'operator', 'viewer'];

function signupRole(value) {
  const role = (value || 'project_manager').trim();
  if (!SIGNUP_ROLES.includes(role)) {
    throw new Error(`SIGNUP_ROLE must be one of ${SIGNUP_ROLES.join(', ')} (administrator is not allowed for self sign-up)`);
  }
  return role;
}

// Settings for browser, desktop, and OCR steps. The robot agent uses this without the server
// secrets (DATABASE_URL, JWT_SECRET, CREDENTIALS_KEY).
export function automationConfig() {
  return {
    browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
    browserChannel: process.env.BROWSER_CHANNEL || '',
    browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 15000),
    browserAllowedHosts: (process.env.BROWSER_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
    recorderHeadless: process.env.RECORDER_HEADLESS === 'true',
    desktopDriver: process.env.DESKTOP_DRIVER || 'auto',
    desktopPowershell: process.env.DESKTOP_POWERSHELL || 'powershell.exe',
    desktopCommandTimeoutMs: Number(process.env.DESKTOP_COMMAND_TIMEOUT_MS || 60000),
    ocrCachePath: path.resolve(root, process.env.OCR_CACHE_PATH || '../data/ocr-cache'),
    ocrLangPath: process.env.OCR_LANG_PATH ? path.resolve(root, process.env.OCR_LANG_PATH) : '',
  };
}

export function loadConfig(overrides = {}) {
  const storageRoot = path.resolve(root, process.env.STORAGE_ROOT || '../data/storage');
  const robotRoot = path.resolve(root, process.env.ROBOT_ROOT || '../data/robot');
  return {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    databaseUrl: required('DATABASE_URL'),
    jwtSecret: required('JWT_SECRET'),
    jwtAccessMinutes: Number(process.env.JWT_ACCESS_MINUTES || 30),
    jwtRefreshDays: Number(process.env.JWT_REFRESH_DAYS || 7),
    credentialsKey: credentialsKey(),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    storageRoot,
    robotRoot,
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
    adminEmail: process.env.ADMIN_EMAIL || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminName: process.env.ADMIN_NAME || 'Platform Administrator',
    workerId: process.env.WORKER_ID || 'worker-1',
    workerPollMs: Number(process.env.WORKER_POLL_MS || 2000),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
    refreshRateLimitMax: Number(process.env.REFRESH_RATE_LIMIT_MAX || 60),
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    // Set to e.g. 1 or 'loopback' only when running behind a reverse proxy, so rate limits see client IPs.
    trustProxy: process.env.TRUST_PROXY || '',
    // Self-service sign-up from the public site. Each new account gets its own workspace (tenant),
    // is the administrator of that workspace only, and gets a starter project named after its
    // organization. SIGNUP_ROLE is kept for compatibility and validated (administrator is refused at
    // start-up) but no longer decides the role: nobody signs up into the Default tenant.
    allowSignup: process.env.ALLOW_SIGNUP !== 'false',
    signupRole: signupRole(process.env.SIGNUP_ROLE),
    signupRateLimitMax: Number(process.env.SIGNUP_RATE_LIMIT_MAX || 10),
    signupRateLimitWindowMs: Number(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS || 3600000),
    // Optional SMTP for account email (password reset). Leave SMTP_HOST empty to keep administrator resets.
    publicUrl: (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
    smtp: process.env.SMTP_HOST ? {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'urap@localhost',
    } : null,
    orchestrator: {
      baseUrl: process.env.ORCHESTRATOR_BASE_URL || '',
      token: process.env.ORCHESTRATOR_TOKEN || '',
      releaseKey: process.env.ORCHESTRATOR_RELEASE_KEY || '',
      organizationUnitId: process.env.ORCHESTRATOR_ORGANIZATION_UNIT_ID || '',
    },
    schemaPath: path.resolve(root, '../database/schema.sql'),
    seedPath: path.resolve(root, '../database/seed.sql'),
    migrationsPath: path.resolve(root, '../database/migrations'),
    jobStaleMinutes: Number(process.env.JOB_STALE_MINUTES || 30),
    queueItemAbandonHours: Number(process.env.QUEUE_ITEM_ABANDON_HOURS || 24),
    robotTaskTimeoutMs: Number(process.env.ROBOT_TASK_TIMEOUT_MS || 15000),
    // Default AI provider for agents (an 'AI provider' connection in a project takes precedence).
    // AI_PROVIDER: openai | azure_openai | anthropic | openai_compatible (Groq, Ollama, ...).
    // 'mock' is a deterministic provider for tests; it only works when NODE_ENV=test or AI_ALLOW_MOCK=true.
    ai: {
      provider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
      apiKey: process.env.AI_API_KEY || '',
      baseUrl: (process.env.AI_BASE_URL || '').trim(),
      model: (process.env.AI_MODEL || '').trim(),
      apiVersion: (process.env.AI_API_VERSION || '').trim(),
      allowMock: process.env.NODE_ENV === 'test' || process.env.AI_ALLOW_MOCK === 'true',
      requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || 60000),
    },
    ...automationConfig(),
    ...overrides,
  };
}

let cached;
export function config() {
  if (!cached) cached = loadConfig();
  return cached;
}

export function setConfigForTests(next) {
  cached = next;
}
