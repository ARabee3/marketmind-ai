import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ContentExceptionFilter } from './content-exception.filter';
import { ContentException } from './content.exception';

describe('ContentExceptionFilter', () => {
  let filter: ContentExceptionFilter;
  let mockResponse: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new ContentExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  describe('catch', () => {
    it('should return proper HTTP status and JSON response', () => {
      const exception = new ContentException(
        'CONTENT_NOT_FOUND',
        'Content not found',
        HttpStatus.NOT_FOUND,
        false,
        { field: 'id' },
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'CONTENT_NOT_FOUND',
          message: 'Content not found',
          request_id: exception.requestId,
          retryable: false,
          details: { field: 'id' },
        },
      });
    });

    it('should handle retryable errors', () => {
      const exception = new ContentException(
        'CONTENT_PROVIDER_ERROR',
        'AI service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'CONTENT_PROVIDER_ERROR',
          message: 'AI service unavailable',
          request_id: exception.requestId,
          retryable: true,
          details: {},
        },
      });
    });

    it('should handle validation errors with details', () => {
      const exception = new ContentException(
        'CONTENT_VALIDATION_ERROR',
        'Invalid input',
        HttpStatus.BAD_REQUEST,
        false,
        {
          field: 'title',
          constraints: { minLength: 'Title must be at least 3 characters' },
        },
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'CONTENT_VALIDATION_ERROR',
          message: 'Invalid input',
          request_id: exception.requestId,
          retryable: false,
          details: {
            field: 'title',
            constraints: { minLength: 'Title must be at least 3 characters' },
          },
        },
      });
    });

    it('should use exception toJSON method', () => {
      const exception = new ContentException(
        'CONTENT_ERROR',
        'Error occurred',
      );

      const toJSONSpy = jest.spyOn(exception, 'toJSON');

      filter.catch(exception, mockHost);

      expect(toJSONSpy).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(exception.toJSON());
    });

    it('should handle different HTTP statuses', () => {
      const statuses = [
        HttpStatus.BAD_REQUEST,
        HttpStatus.UNAUTHORIZED,
        HttpStatus.FORBIDDEN,
        HttpStatus.NOT_FOUND,
        HttpStatus.CONFLICT,
        HttpStatus.INTERNAL_SERVER_ERROR,
        HttpStatus.SERVICE_UNAVAILABLE,
      ];

      statuses.forEach((status) => {
        const exception = new ContentException(
          'CONTENT_ERROR',
          'Error',
          status,
        );

        filter.catch(exception, mockHost);

        expect(mockResponse.status).toHaveBeenCalledWith(status);
      });
    });
  });
});
