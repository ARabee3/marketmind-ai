import { HttpStatus } from '@nestjs/common';
import { ContentException } from './content.exception';

describe('ContentException', () => {
  describe('constructor', () => {
    it('should create exception with required fields', () => {
      const exception = new ContentException(
        'CONTENT_NOT_FOUND',
        'Content not found',
        HttpStatus.NOT_FOUND,
      );

      expect(exception.code).toBe('CONTENT_NOT_FOUND');
      expect(exception.message).toBe('Content not found');
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(exception.retryable).toBe(false);
      expect(exception.details).toEqual({});
      expect(exception.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should create exception with retryable flag', () => {
      const exception = new ContentException(
        'CONTENT_PROVIDER_ERROR',
        'AI service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );

      expect(exception.retryable).toBe(true);
    });

    it('should create exception with details', () => {
      const details = {
        field: 'contentId',
        value: '123',
      };

      const exception = new ContentException(
        'CONTENT_VALIDATION_ERROR',
        'Invalid content',
        HttpStatus.BAD_REQUEST,
        false,
        details,
      );

      expect(exception.details).toEqual(details);
    });

    it('should default to BAD_REQUEST status', () => {
      const exception = new ContentException(
        'CONTENT_ERROR',
        'Error occurred',
      );

      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should default retryable to false', () => {
      const exception = new ContentException(
        'CONTENT_ERROR',
        'Error occurred',
      );

      expect(exception.retryable).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return ErrorEnvelope shape', () => {
      const exception = new ContentException(
        'CONTENT_NOT_FOUND',
        'Content not found',
        HttpStatus.NOT_FOUND,
        false,
        { field: 'id' },
      );

      const json = exception.toJSON();

      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('code', 'CONTENT_NOT_FOUND');
      expect(json.error).toHaveProperty('message', 'Content not found');
      expect(json.error).toHaveProperty('request_id', exception.requestId);
      expect(json.error).toHaveProperty('retryable', false);
      expect(json.error).toHaveProperty('details', { field: 'id' });
    });

    it('should include request_id as UUID', () => {
      const exception = new ContentException(
        'CONTENT_ERROR',
        'Error',
      );

      const json = exception.toJSON();

      expect(json.error.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('should preserve retryable flag', () => {
      const exception = new ContentException(
        'CONTENT_PROVIDER_ERROR',
        'Provider error',
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );

      const json = exception.toJSON();

      expect(json.error.retryable).toBe(true);
    });
  });

  describe('name', () => {
    it('should have correct name', () => {
      const exception = new ContentException(
        'CONTENT_ERROR',
        'Error',
      );

      expect(exception.name).toBe('ContentException');
    });
  });
});
