import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('./models-lzfood', () => ({
  registerLZFoodModels: jest.fn(() => ({})),
  ensureLZFoodIndexes: jest.fn().mockImplementation(async () => {}),
}));

jest.mock('mongoose', () => ({
  connect: jest.fn(),
}));

import mongoose from 'mongoose';
import { connectDB } from './db';

const mockedConnect = mongoose.connect as jest.MockedFunction<typeof mongoose.connect>;

describe('connectDB', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockedConnect.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw if no DB URI is set', async () => {
    delete process.env.DBCON;
    delete process.env.LZFOOD_DBCON;
    await expect(connectDB()).rejects.toThrow('环境变量 DBCON 或 LZFOOD_DBCON 至少设置其一');
  });

  it('should call mongoose.connect with DBCON value', async () => {
    process.env.DBCON = 'mongodb+srv://test:pass@host/?appName=test';
    delete process.env.LZFOOD_DBCON;
    mockedConnect.mockResolvedValueOnce(mongoose as unknown as typeof mongoose);
    await connectDB();
    expect(mockedConnect).toHaveBeenCalledWith('mongodb+srv://test:pass@host/?appName=test');
  });

  it('should prefer LZFOOD_DBCON when set', async () => {
    process.env.LZFOOD_DBCON = 'mongodb+srv://lz:food@host/?appName=LZ';
    process.env.DBCON = 'mongodb+srv://other@host/';
    mockedConnect.mockResolvedValueOnce(mongoose as unknown as typeof mongoose);
    await connectDB();
    expect(mockedConnect).toHaveBeenCalledWith('mongodb+srv://lz:food@host/?appName=LZ');
  });

  it('should propagate mongoose connection errors', async () => {
    process.env.DBCON = 'mongodb+srv://test:pass@host/?appName=test';
    mockedConnect.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(connectDB()).rejects.toThrow('Connection refused');
  });
});
