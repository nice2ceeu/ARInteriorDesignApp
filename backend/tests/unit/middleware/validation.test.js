import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { validateRequest } from '../../../src/middleware/validation.js';

describe('Validation Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('validateRequest', () => {
    it('should pass validation when schema is valid', () => {
      const schema = {
        body: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: false },
        },
      };

      req.body = { name: 'Test' };
      validateRequest(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should fail validation when required field is missing', () => {
      const schema = {
        body: {
          name: { type: 'string', required: true },
        },
      };

      req.body = {};
      validateRequest(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should fail validation when type is incorrect', () => {
      const schema = {
        body: {
          age: { type: 'number', required: true },
        },
      };

      req.body = { age: 'not a number' };
      validateRequest(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
