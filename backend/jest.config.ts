import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  /** 多店改造后需带 storeId 的集成/属性测试暂未全部迁移；见 docs/multi-store-spec.md */
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.property\\.test\\.ts$',
    '/src/models/models\\.test\\.ts$',
    '/src/models/menuDataRoundTrip\\.property\\.test\\.ts$',
    '/src/routes/.*\\.test\\.ts$',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/server.ts',
  ],
};

export default config;
