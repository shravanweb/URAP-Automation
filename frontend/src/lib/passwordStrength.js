// Client-side password strength hint for the sign-up form. The server enforces the real rule
// (at least 12 characters with letters and numbers); this only guides the user.
const COMMON = ['password', 'qwerty', '123456', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'urap'];

export const PASSWORD_MIN = 12;

export function passwordChecks(password = '') {
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN },
    { id: 'letter', label: 'A letter', ok: /[A-Za-z]/.test(password) },
    { id: 'number', label: 'A number', ok: /\d/.test(password) },
  ];
}

/** Returns { score 0-4, label, meetsPolicy }. */
export function passwordStrength(password = '', { email = '', name = '' } = {}) {
  if (!password) return { score: 0, label: '', meetsPolicy: false };
  const meetsPolicy = passwordChecks(password).every((check) => check.ok);
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= PASSWORD_MIN) score += 1;
  if (password.length >= 16) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) score += 1;
  const lower = password.toLowerCase();
  const personal = [email.split('@')[0], ...name.toLowerCase().split(/\s+/)].filter((part) => part && part.length >= 4);
  if (COMMON.some((word) => lower.includes(word)) || personal.some((part) => lower.includes(part.toLowerCase())) || /^(.)\1+$/.test(password)) {
    score = Math.min(score, 1);
  }
  if (!meetsPolicy) score = Math.min(score, 1);
  score = Math.max(1, Math.min(4, score));
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score], meetsPolicy };
}
