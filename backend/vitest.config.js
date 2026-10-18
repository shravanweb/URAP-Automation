import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: './test/globalSetup.js',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://urap:urap_dev_password@127.0.0.1:3307/urap_test',
      JWT_SECRET: 'test-jwt-secret-with-enough-length',
      CREDENTIALS_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      BCRYPT_ROUNDS: '4',
      CORS_ORIGIN: 'http://localhost:5173',
      STORAGE_ROOT: '../data/test-storage',
      ROBOT_ROOT: '../data/test-robot',
    },
  },
});
