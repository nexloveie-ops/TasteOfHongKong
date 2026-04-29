import { describe, it, expect } from '@jest/globals';
import { createAppError, errorHandler, AppError } from './errorHandler';
import { Request, Response, NextFunction } from 'express';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('createAppError', () => {
  it('should create error with correct code and status', () => {
    const err = createAppError('NOT_FOUND', 'Resource not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found');
    expect(err.details).toBeUndefined();
  });

  it('should include details when provided', () => {
    const err = createAppError('VALIDATION_ERROR', 'Invalid input', { field: 'name' });
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'name' });
  });

  it('should map business error codes to correct status', () => {
    expect(createAppError('ITEM_SOLD_OUT', 'sold out').statusCode).toBe(409);
    expect(createAppError('ORDER_NOT_MODIFIABLE', 'locked').statusCode).toBe(409);
    expect(createAppError('CATEGORY_HAS_ITEMS', 'has items').statusCode).toBe(409);
    expect(createAppError('PAYMENT_AMOUNT_MISMATCH', 'mismatch').statusCode).toBe(400);
    expect(createAppError('INVALID_FILE_FORMAT', 'bad format').statusCode).toBe(400);
    expect(createAppError('UNAUTHORIZED', 'no auth').statusCode).toBe(401);
    expect(createAppError('FORBIDDEN', 'no access').statusCode).toBe(403);
  });

  it('should default to 500 for unknown codes', () => {
    const err = createAppError('UNKNOWN_CODE', 'something');
    expect(err.statusCode).toBe(500);
  });
});

describe('errorHandler middleware', () => {
  const req = {} as Request;
  const next = jest.fn() as NextFunction;

  it('should respond with unified error format', () => {
    const res = mockRes();
    const err = createAppError('NOT_FOUND', 'Order not found', { orderId: '123' });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Order not found',
        details: { orderId: '123' },
      },
    });
  });

  it('should default to 500 and INTERNAL_ERROR for plain errors', () => {
    const res = mockRes();
    const err: AppError = new Error('unexpected');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'unexpected',
        details: {},
      },
    });
  });

  it('should handle validation errors with 400 status', () => {
    const res = mockRes();
    const err = createAppError('VALIDATION_ERROR', 'Name is required', { field: 'name' });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Name is required',
        details: { field: 'name' },
      },
    });
  });
});
