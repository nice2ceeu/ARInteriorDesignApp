import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { getDatabase } from '../db/database.js';
import { randomUUID as uuidv4 } from 'node:crypto';

const router = express.Router();

// All project routes use optional auth
router.use(optionalAuth);

/**
 * GET /api/v1/projects
 * Get user's projects
 */
router.get('/', async (req, res, next) => {
  try {
    const db = getDatabase();
    const userId = req.user?.id;

    if (!userId) {
      return res.json({
        projects: [],
        message: 'No user authenticated. Sign in to see your projects.',
      });
    }

    // Get user's projects from database
    let projects;
    try {
      projects = db.prepare(`
        SELECT 
          id, 
          name, 
          description, 
          room_type, 
          style, 
          mood, 
          layout_data,
          created_at, 
          updated_at 
        FROM projects 
        WHERE user_id = ? 
        ORDER BY updated_at DESC
      `).all(userId);
    } catch (dbError) {
      console.error('[Projects] Database error:', dbError);
      return res.status(500).json({ error: 'Database error', message: 'Failed to query projects' });
    }

    // Parse layout_data with error handling
    const parsedProjects = projects.map(project => {
      let layoutData = null;
      if (project.layout_data) {
        try {
          layoutData = JSON.parse(project.layout_data);
        } catch (parseError) {
          console.error('[Projects] Failed to parse layout_data for project:', project.id, parseError);
          // Continue with null layout_data instead of failing the entire request
        }
      }
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        room_type: project.room_type,
        style: project.style,
        mood: project.mood,
        layout_data: layoutData,
        created_at: project.created_at,
        updated_at: project.updated_at,
      };
    });

    res.json({
      projects: parsedProjects,
      count: parsedProjects.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/projects
 * Create a new project
 */
router.post('/', async (req, res, next) => {
  try {
    const db = getDatabase();
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to create projects' });
    }

    const { name, description, room_type, style, mood, layout_data } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const projectId = `project-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const now = new Date().toISOString();

    // Insert project into database
    try {
      // Validate and stringify layout_data
      let layoutDataString = null;
      if (layout_data) {
        try {
          layoutDataString = JSON.stringify(layout_data);
        } catch (stringifyError) {
          return res.status(400).json({ 
            error: 'Invalid layout_data format',
            message: 'layout_data must be valid JSON-serializable object'
          });
        }
      }

      db.prepare(`
        INSERT INTO projects (id, user_id, name, description, room_type, style, mood, layout_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId,
        userId,
        name.trim(),
        description || null,
        room_type || null,
        style || null,
        mood || null,
        layoutDataString,
        now,
        now
      );
    } catch (dbError) {
      console.error('[Projects] Database error:', dbError);
      return res.status(500).json({ error: 'Database error', message: 'Failed to create project' });
    }

    res.status(201).json({
      id: projectId,
      name: name.trim(),
      description: description || null,
      room_type: room_type || null,
      style: style || null,
      mood: mood || null,
      layout_data: layout_data || null,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

