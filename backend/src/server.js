import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import routes
import layoutRoutes from './routes/layouts.js';
import projectRoutes from './routes/projects.js';
import userRoutes from './routes/users.js';
import themeRoutes from './routes/themes.js';
import imageRoutes from './routes/images.js';
import designRoutes from './routes/designs.js';
import { authenticate } from './middleware/auth.js';
import aiDesignController from './controllers/aiDesignController.js';
import ideaRoutes from './routes/ideas.js';
import trainingRoutes from './routes/training.js';
import mlRoutes from './routes/ml.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import { initDatabase } from './db/database.js';
import { connectMongoDB, disconnectMongoDB } from './db/mongodb.js';
import {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler
} from './middleware/sentry.js';

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Sentry request handler (must be first)
app.use(sentryRequestHandler());
app.use(sentryTracingHandler());

// Security middleware
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Serve static files (web view)
const publicPath = join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
  });
});

// API routes
app.use('/api/v1/layouts', layoutRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/themes', themeRoutes);
app.use('/api/v1/images', imageRoutes);
app.use('/api/v1/designs', designRoutes);
app.use('/api/v1/ideas', ideaRoutes);
app.use('/api/v1/training', trainingRoutes);
app.use('/api/v1/ml', mlRoutes);

// Floor-plan generation endpoint
app.post('/api/v1/design/generate', authenticate, aiDesignController.generateLayout);

// Root endpoint - serve web view
app.get('/', (req, res) => {
  res.sendFile(join(publicPath, 'index.html'));
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'AR Interior Design API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      layouts: '/api/v1/layouts',
      projects: '/api/v1/projects',
      users: '/api/v1/users',
      themes: '/api/v1/themes',
      images: '/api/v1/images',
      designs: '/api/v1/designs',
      ideas: '/api/v1/ideas',
      training: '/api/v1/training',
      ml: '/api/v1/ml',
    },
    webView: '/',
  });
});

// Error handling middleware (must be last)
// Sentry error handler must come before other error handlers
app.use(sentryErrorHandler());
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize databases
const db = initDatabase(); // In-memory database (for backward compatibility)

// Initialize Sentry and start server
(async () => {
  await initSentry();

  // Connect to MongoDB
  try {
    await connectMongoDB();
  } catch (error) {
    console.error('[Server] Failed to connect to MongoDB:', error.message);
    console.warn('[Server] Continuing without MongoDB connection...');
  }

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Environment: ${NODE_ENV}`);
    console.log(`🌐 Web View: http://localhost:${PORT}/`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API base: http://localhost:${PORT}/api/v1`);
  });

  // Graceful shutdown handler
  const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Closing server gracefully...`);

    server.close(async () => {
      console.log('HTTP server closed');

      // Close in-memory database connection
      if (db) {
        try {
          db.close();
          console.log('In-memory database connection closed');
        } catch (error) {
          console.error('Error closing in-memory database:', error);
        }
      }

      // Close MongoDB connection
      try {
        await disconnectMongoDB();
        console.log('MongoDB connection closed');
      } catch (error) {
        console.error('Error closing MongoDB:', error);
      }

      console.log('Graceful shutdown complete');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();

export default app;


