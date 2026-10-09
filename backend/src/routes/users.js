import express from 'express';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';
import { isMongoDBConnected } from '../db/mongodb.js';
import {
  findUserByEmail,
  findUserById,
  verifyPassword,
  createUser
} from '../data/hardcodedUsers.js';

const router = express.Router();

import { createToken } from '../services/tokenService.js';

/**
 * POST /api/v1/users/signup
 * Register a new user (using MongoDB)
 */
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Password must be at least 6 characters',
      });
    }

    // Use MongoDB if connected, otherwise fallback to hardcoded users
    if (isMongoDBConnected()) {
      // Check if user already exists in MongoDB
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'An account with this email already exists',
        });
      }

      // Create new user in MongoDB
      const user = new User({
        email: email.toLowerCase(),
        password, // Will be hashed by pre-save hook
        name: name || undefined,
      });

      await user.save();

      // Generate JWT token
      const token = await createToken({ userId: user._id.toString(), email: user.email });

      res.status(201).json({
        message: 'User created successfully',
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        token,
      });
    } else {
      // Fallback to hardcoded users if MongoDB is not connected
      const existingUser = findUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'An account with this email already exists',
        });
      }

      const user = createUser(email, password, name);
      const token = await createToken({ userId: user.id, email: user.email });

      res.status(201).json({
        message: 'User created successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        token,
      });
    }
  } catch (error) {
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'An account with this email already exists',
      });
    }
    next(error);
  }
});

/**
 * POST /api/v1/users/login
 * Login user and get JWT token (using MongoDB)
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required',
      });
    }

    // Use MongoDB if connected, otherwise fallback to hardcoded users
    if (isMongoDBConnected()) {
      // Find user in MongoDB (include password for comparison)
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

      if (!user) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password',
        });
      }

      // Verify password using bcrypt
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password',
        });
      }

      // Generate JWT token
      const token = await createToken({ userId: user._id.toString(), email: user.email });

      res.json({
        message: 'Login successful',
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        token,
      });
    } else {
      // Fallback to hardcoded users if MongoDB is not connected
      const user = findUserByEmail(email);

      if (!user) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password',
        });
      }

      const isPasswordValid = verifyPassword(user, password);
      if (!isPasswordValid) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password',
        });
      }

      const token = await createToken({ userId: user.id, email: user.email });

      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        token,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/users/:id
 * Update user profile
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const updateId = req.params.id;
    const updates = req.body;

    // Authorization check
    if (userId !== updateId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update your own profile',
      });
    }

    // Validation: prevent updating sensitive fields directly via this endpoint
    const allowedUpdates = ['name', 'bio', 'phoneNumber', 'avatar', 'preferences', 'email', 'password'];
    const invalidUpdates = Object.keys(updates).filter(key => !allowedUpdates.includes(key));

    if (invalidUpdates.length > 0) {
      return res.status(400).json({
        error: 'Invalid updates',
        message: `Invalid fields: ${invalidUpdates.join(', ')}`,
      });
    }

    // Special validation for password if present
    if (updates.password && updates.password.length < 6) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Password must be at least 6 characters',
      });
    }

    // Use MongoDB if connected
    if (isMongoDBConnected()) {
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist',
        });
      }

      // Check email uniqueness if email is being updated
      if (updates.email && updates.email !== user.email) {
        const existingUser = await User.findOne({ email: updates.email.toLowerCase() });
        if (existingUser) {
          return res.status(409).json({
            error: 'Email in use',
            message: 'This email is already taken',
          });
        }
      }

      // Apply updates
      Object.keys(updates).forEach(key => {
        user[key] = updates[key];
      });

      await user.save();

      res.json({
        message: 'Profile updated successfully',
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          bio: user.bio,
          phoneNumber: user.phoneNumber,
          avatar: user.avatar,
          preferences: user.preferences,
          updatedAt: user.updatedAt,
        }
      });
    } else {
      // Fallback for hardcoded users (in-memory update)
      const user = findUserById(userId);

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist',
        });
      }

      // Simple in-memory update
      if (updates.name) user.name = updates.name;
      // Note: hardcodedUsers.js structure implies simple objects, may not have all new fields supported in fallback

      res.json({
        message: 'Profile updated successfully (In-Memory)',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/users/me
 * Get current user profile (using MongoDB)
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Use MongoDB if connected, otherwise fallback to hardcoded users
    if (isMongoDBConnected()) {
      // Get user from MongoDB
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist',
        });
      }

      res.json({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        avatar: user.avatar,
        preferences: user.preferences,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } else {
      // Fallback to hardcoded users if MongoDB is not connected
      const user = findUserById(userId);

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist',
        });
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;

