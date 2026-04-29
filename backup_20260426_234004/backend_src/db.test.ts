import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock mongoose before importing db module
jest.mock('mongoose', () => ({
  connect: jest.fn(),
}));

import mongoose from 'mongoose';
import { connectDB } from './db';

const mockedConnect = mongoose.connect as jest.MockedFunction<typeof mongoose.connect>;

describe('connectDB', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockedConnect.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw if DBCON is not set', async () => {
    delete process.env.DBCON;
    await expect(connectDB()).rejects.toThrow('环境变量 DBCON 未设置');
  });

  it('should call mongoose.connect with DBCON value', async () => {
    process.env.DBCON = 'mongodb+srv://test:pass@host/?appName=test';
    mockedConnect.mockResolvedValueOnce(mongoose);
    await connectDB();
    expect(mockedConnect).toHaveBeenCalledWith('mongodb+srv://test:pass@host/?appName=test');
  });

  it('should propagate mongoose connection errors', async () => {
    process.env.DBCON = 'mongodb+srv://test:pass@host/?appName=test';
    mockedConnect.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(connectDB()).rejects.toThrow('Connection refused');
  });
});
