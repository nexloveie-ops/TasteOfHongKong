import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin';
import { createAppError } from '../middleware/errorHandler';
import { getJwtSecret, JwtPayload } from '../middleware/auth';

const router = Router();

/**
 * POST /api/auth/login
 * Validates username/password and returns a JWT token.
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw createAppError('VALIDATION_ERROR', 'Username and password are required');
    }

    const admin = await Admin.findOne({ username });
    if (!admin) {
      throw createAppError('UNAUTHORIZED', 'Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      throw createAppError('UNAUTHORIZED', 'Invalid credentials');
    }

    const payload: JwtPayload = {
      userId: admin._id.toString(),
      username: admin.username,
      role: admin.role as JwtPayload['role'],
    };

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '8h' });

    res.json({
      token,
      user: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
