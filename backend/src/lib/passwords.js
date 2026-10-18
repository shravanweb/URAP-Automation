import bcrypt from 'bcryptjs';

export function hashPassword(password, rounds) {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
