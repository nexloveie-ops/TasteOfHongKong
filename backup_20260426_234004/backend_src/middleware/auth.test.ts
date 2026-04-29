import { describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, requirePermission, getJwtSecret, JwtPayload } from './auth';
import { Role } from './permissions';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '1h' });
}

const ownerPayload: JwtPayload = {
  userId: '507f1f77bcf86cd799439011',
  username: 'boss',
  role: Role.OWNER,
};

const cashierPayload: JwtPayload = {
  userId: '507f1f77bcf86cd799439012',
  username: 'cashier1',
  role: Role.CASHIER,
};

describe('authMiddleware', () => {
  it('should attach user to req when token is valid', () => {
    const token = createToken(ownerPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.username).toBe('boss');
    expect(req.user!.role).toBe(Role.OWNER);
  });

  it('should throw UNAUTHORIZED when no authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    expect(() => authMiddleware(req, res, next)).toThrow('Missing or invalid authorization token');
  });

  it('should throw UNAUTHORIZED when authorization header has wrong format', () => {
    const req = mockReq({ headers: { authorization: 'Basic abc123' } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    expect(() => authMiddleware(req, res, next)).toThrow('Missing or invalid authorization token');
  });

  it('should throw UNAUTHORIZED when token is invalid', () => {
    const req = mockReq({ headers: { authorization: 'Bearer invalid.token.here' } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    expect(() => authMiddleware(req, res, next)).toThrow('Invalid or expired token');
  });

  it('should throw UNAUTHORIZED when token is signed with wrong secret', () => {
    const token = jwt.sign(ownerPayload, 'wrong-secret');
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    expect(() => authMiddleware(req, res, next)).toThrow('Invalid or expired token');
  });
});

describe('requirePermission', () => {
  it('should call next when owner has the required permission', () => {
    const token = createToken(ownerPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    // First authenticate
    authMiddleware(req, res, next as NextFunction);

    // Then check permission
    const next2 = jest.fn();
    const middleware = requirePermission('menu:write');
    middleware(req, res, next2 as NextFunction);

    expect(next2).toHaveBeenCalled();
  });

  it('should call next when cashier has checkout permission', () => {
    const token = createToken(cashierPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next as NextFunction);

    const next2 = jest.fn();
    const middleware = requirePermission('checkout:process');
    middleware(req, res, next2 as NextFunction);

    expect(next2).toHaveBeenCalled();
  });

  it('should throw FORBIDDEN when cashier lacks menu:write permission', () => {
    const token = createToken(cashierPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next as NextFunction);

    const middleware = requirePermission('menu:write');
    expect(() => middleware(req, res, jest.fn() as NextFunction)).toThrow('Insufficient permissions');
  });

  it('should throw FORBIDDEN when cashier lacks admin permission', () => {
    const token = createToken(cashierPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next as NextFunction);

    const middleware = requirePermission('admin:users');
    expect(() => middleware(req, res, jest.fn() as NextFunction)).toThrow('Insufficient permissions');
  });

  it('should throw UNAUTHORIZED when req.user is not set', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    const middleware = requirePermission('menu:read');
    expect(() => middleware(req, res, next)).toThrow('Authentication required');
  });
});
