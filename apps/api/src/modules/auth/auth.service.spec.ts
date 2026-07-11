
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { ActionTokenService } from './action-token.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../common/persistence/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'uuid-1234-5678-abcd';
const MOCK_EMAIL = 'test@marketmind.ai';
const MOCK_PASSWORD = 'SecurePass123';
const MOCK_FULL_NAME = 'Test Owner';
const MOCK_HASHED_PASSWORD = '$2b$12$hashedpasswordmock000000000000000000000000000000000000';
const MOCK_REFRESH_TOKEN = 'mock.refresh.token.string';
const MOCK_HASHED_REFRESH = '$2b$10$hashedrefreshtokenmock00000000000000000000000000000000';

/** A complete Prisma user record as it comes from the DB. */
const mockDbUser = {
  id: MOCK_USER_ID,
  email: MOCK_EMAIL,
  fullName: MOCK_FULL_NAME,
  password: MOCK_HASHED_PASSWORD,
  roles: [Role.OWNER] as Role[],
  refreshToken: MOCK_HASHED_REFRESH,
  isEmailVerified: false,
  lastLoginAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const mockVerifiedDbUser = {
  ...mockDbUser,
  isEmailVerified: true,
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Jest mock object that mirrors the Prisma `user` delegate.
 * Using a factory function means each test suite gets a clean mock instance.
 */
const createMockPrismaService = () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  refreshSession: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg({ user: { update: jest.fn() }, refreshSession: { deleteMany: jest.fn() } }),
  ),
});

const createMockJwtService = () => ({
  signAsync: jest.fn(),
});

const createMockActionTokenService = () => ({
  issue: jest.fn(),
  consume: jest.fn(),
});

const createMockMailService = () => ({
  sendMail: jest.fn(),
});

const createMockConfigService = () => ({
  getOrThrow: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'jwt.accessSecret': 'test-access-secret',
      'jwt.refreshSecret': 'test-refresh-secret',
    };
    if (!map[key]) throw new Error(`Missing config key: ${key}`);
    return map[key];
  }),
  get: jest.fn((key: string, fallback: unknown) => {
    const map: Record<string, unknown> = {
      'jwt.accessExpiresIn': '15m',
      'jwt.refreshExpiresIn': '7d',
      'mail.appUrl': 'http://localhost:3000',
    };
    return map[key] ?? fallback;
  }),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let actionTokenService: ReturnType<typeof createMockActionTokenService>;
  let mailService: ReturnType<typeof createMockMailService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    jwtService = createMockJwtService();
    actionTokenService = createMockActionTokenService();
    mailService = createMockMailService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: ActionTokenService, useValue: actionTokenService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // register()
  // =========================================================================

  describe('register()', () => {
    const registerDto: RegisterDto = {
      email: MOCK_EMAIL,
      fullName: MOCK_FULL_NAME,
      password: MOCK_PASSWORD,
    };

    it('should successfully register a new user and return the safe profile', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(null); // email not taken
      prisma.user.create.mockResolvedValue(mockDbUser);

      // Act
      const result = await service.register(registerDto);

      // Assert — returned object
      expect(result.id).toBe(MOCK_USER_ID);
      expect(result.email).toBe(MOCK_EMAIL);
      expect(result.fullName).toBe(MOCK_FULL_NAME);
      expect(result.roles).toEqual([Role.OWNER]);
      expect(result.isEmailVerified).toBe(false);

      // Assert — sensitive fields are stripped
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('should persist the fullName when provided', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockDbUser);

      // Act
      const result = await service.register(registerDto);

      // Assert — fullName is stored and returned
      const createData = prisma.user.create.mock.calls[0][0] as {
        data: { fullName: string };
      };
      expect(createData.data.fullName).toBe(MOCK_FULL_NAME);
      expect(result.fullName).toBe(MOCK_FULL_NAME);
    });

    it('should hash the password before persisting it', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockDbUser);

      const bcryptSpy = jest.spyOn(bcrypt, 'hash');

      // Act
      await service.register(registerDto);

      // Assert — bcrypt.hash was called with the plain-text password
      expect(bcryptSpy).toHaveBeenCalledWith(MOCK_PASSWORD, 12);
      // The created record's password must NOT be the plain-text password
      const createCall = prisma.user.create.mock.calls[0][0] as {
        data: { password: string };
      };
      expect(createCall.data.password).not.toBe(MOCK_PASSWORD);
    });

    it('should throw ConflictException when the email is already registered', async () => {
      // Arrange — simulate email already exists
      prisma.user.findUnique.mockResolvedValue({ id: MOCK_USER_ID });

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );

      // Ensure we never attempt to create the user
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on Prisma P2002 race condition', async () => {
      // Arrange — findUnique returns null (passed the check) but create
      // throws a unique constraint violation due to a concurrent request
      const { Prisma } = jest.requireActual('@prisma/client') as typeof import('@prisma/client');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        Object.assign(new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.0.0',
        })),
      );

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // =========================================================================
  // login()
  // =========================================================================

  describe('login()', () => {
    const loginDto: LoginDto = {
      email: MOCK_EMAIL,
      password: MOCK_PASSWORD,
    };

    beforeEach(() => {
      // Default: JWT signing returns predictable strings
      jwtService.signAsync
        .mockResolvedValueOnce('access.token.string')
        .mockResolvedValueOnce(MOCK_REFRESH_TOKEN);
    });

    it('should throw UnauthorizedException when email is not verified', async () => {
      // Arrange — user exists but email is not verified
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      // Act & Assert
      let error: unknown;
      try {
        await service.login(loginDto);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
    });

    it('should return an access token, raw refresh token, and user on valid credentials', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(mockVerifiedDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(mockVerifiedDbUser);

      // Act
      const result = await service.login(loginDto);

      // Assert
      expect(result.accessToken).toBe('access.token.string');
      expect(result.rawRefreshToken).toBe(MOCK_REFRESH_TOKEN);
      expect(result.user.id).toBe(MOCK_USER_ID);
      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('refreshToken');
    });

    it('should persist a hashed refresh token after successful login', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(mockVerifiedDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(mockVerifiedDbUser);

      // Act
      await service.login(loginDto);

      // Assert — update was called and the stored value is NOT the raw token
      const updateCalls = prisma.user.update.mock.calls;
      // First update call is for refreshToken hash
      const refreshTokenUpdateData = updateCalls.find(
        (call: [{ data: { refreshToken?: string } }]) =>
          call[0]?.data?.refreshToken !== undefined,
      );
      expect(refreshTokenUpdateData).toBeDefined();
      const storedHash = refreshTokenUpdateData![0].data.refreshToken as string;
      expect(storedHash).not.toBe(MOCK_REFRESH_TOKEN);
    });

    it('should throw UnauthorizedException with a generic message when user is not found', async () => {
      // Arrange — email doesn't exist in DB
      prisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw UnauthorizedException with a generic message when password is wrong', async () => {
      // Arrange — user exists but password doesn't match
      prisma.user.findUnique.mockResolvedValue(mockVerifiedDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should return the same error message for missing user vs wrong password (no enumeration)', async () => {
      // Arrange — case 1: user not found
      prisma.user.findUnique.mockResolvedValue(null);
      let error1: UnauthorizedException | null = null;
      try {
        await service.login(loginDto);
      } catch (e) {
        error1 = e as UnauthorizedException;
      }

      // Arrange — case 2: wrong password
      prisma.user.findUnique.mockResolvedValue(mockVerifiedDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      let error2: UnauthorizedException | null = null;
      try {
        await service.login(loginDto);
      } catch (e) {
        error2 = e as UnauthorizedException;
      }

      // Assert — BOTH errors have identical messages (no enumeration leak)
      expect(error1?.message).toBe('Invalid credentials');
      expect(error2?.message).toBe('Invalid credentials');
      expect(error1?.message).toBe(error2?.message);
    });

    it('should update lastLoginAt on successful login', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(mockVerifiedDbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(mockVerifiedDbUser);

      // Act
      await service.login(loginDto);

      // Assert — at least one update call contains lastLoginAt
      const lastLoginUpdateCall = prisma.user.update.mock.calls.find(
        (call: [{ data: { lastLoginAt?: Date } }]) =>
          call[0]?.data?.lastLoginAt instanceof Date,
      );
      expect(lastLoginUpdateCall).toBeDefined();
    });
  });

  // =========================================================================
  // refresh()
  // =========================================================================

  describe('refresh()', () => {
    const mockAuthUser = {
      id: MOCK_USER_ID,
      email: MOCK_EMAIL,
      roles: [Role.OWNER] as Role[],
    };

    it('should return new tokens when called with a valid authenticated user', async () => {
      // Arrange — the strategy validation already happened before this call
      jwtService.signAsync
        .mockResolvedValueOnce('new.access.token')
        .mockResolvedValueOnce('new.refresh.token');
      prisma.user.update.mockResolvedValue(mockDbUser);

      // Act
      const result = await service.refresh(mockAuthUser);

      // Assert
      expect(result.accessToken).toBe('new.access.token');
      expect(result.rawRefreshToken).toBe('new.refresh.token');
    });

    it('should update the stored refresh token hash after rotation', async () => {
      // Arrange
      jwtService.signAsync
        .mockResolvedValueOnce('new.access.token')
        .mockResolvedValueOnce('new.refresh.token');
      prisma.user.update.mockResolvedValue(mockDbUser);

      // Act
      await service.refresh(mockAuthUser);

      // Assert
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_USER_ID },
          data: expect.objectContaining({
            refreshToken: expect.any(String),
          }),
        }),
      );
    });
  });

  // =========================================================================
  // logout()
  // =========================================================================

  describe('logout()', () => {
    it('should nullify the refresh token in the database', async () => {
      // Arrange
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      // Act
      await service.logout(MOCK_USER_ID);

      // Assert
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: MOCK_USER_ID,
          refreshToken: { not: null },
        },
        data: { refreshToken: null },
      });
    });

    it('should not throw if the user is already logged out (refreshToken is null)', async () => {
      // Arrange — updateMany with count: 0 means no matching record
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      // Act & Assert — should resolve without error
      await expect(service.logout(MOCK_USER_ID)).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // getMe()
  // =========================================================================

  describe('getMe()', () => {
    it('should return the safe user profile for a valid user ID', async () => {
      // Arrange
      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      // Act
      const result = await service.getMe(MOCK_USER_ID);

      // Assert
      expect(result.id).toBe(MOCK_USER_ID);
      expect(result.email).toBe(MOCK_EMAIL);
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException if the user no longer exists', async () => {
      // Arrange — account was deleted after token was issued
      prisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getMe(MOCK_USER_ID)).rejects.toThrow(
        new UnauthorizedException('User no longer exists'),
      );
    });
  });

  // =========================================================================
  // sendVerificationEmail()
  // =========================================================================

  describe('sendVerificationEmail()', () => {
    it('should issue an EMAIL_VERIFICATION token and send a mail', async () => {
      jest.spyOn(actionTokenService, 'issue').mockResolvedValue({
        rawToken: 'abc123',
        expiresAt: new Date(),
      });

      await service.sendVerificationEmail(MOCK_USER_ID, MOCK_EMAIL);

      expect(actionTokenService.issue).toHaveBeenCalledWith(MOCK_USER_ID, 'EMAIL_VERIFICATION');
      expect(mailService.sendMail).toHaveBeenCalledWith(
        MOCK_EMAIL,
        expect.any(String),
        expect.stringContaining('abc123'),
      );
    });
  });

  // =========================================================================
  // forgotPassword()
  // =========================================================================

  describe('forgotPassword()', () => {
    it('should issue a PASSWORD_RESET token and send mail when user exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: MOCK_USER_ID, email: MOCK_EMAIL });
      jest.spyOn(actionTokenService, 'issue').mockResolvedValue({
        rawToken: 'reset-token',
        expiresAt: new Date(),
      });

      await service.forgotPassword(MOCK_EMAIL);

      expect(actionTokenService.issue).toHaveBeenCalledWith(MOCK_USER_ID, 'PASSWORD_RESET');
      expect(mailService.sendMail).toHaveBeenCalledWith(
        MOCK_EMAIL,
        expect.any(String),
        expect.stringContaining('reset-token'),
      );
    });

    it('should silently succeed when the email is unknown', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword('unknown@example.com')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // resetPassword()
  // =========================================================================

  describe('resetPassword()', () => {
    it('should consume token, hash password, update DB, and revoke sessions', async () => {
      jest.spyOn(actionTokenService, 'consume').mockResolvedValue(MOCK_USER_ID);
      prisma.user.update.mockResolvedValue(mockVerifiedDbUser);
      prisma.refreshSession.deleteMany.mockResolvedValue({ count: 1 });

      const bcryptSpy = jest.spyOn(bcrypt, 'hash');

      await service.resetPassword('valid-token', 'NewSecurePass456');

      expect(actionTokenService.consume).toHaveBeenCalledWith('valid-token', 'PASSWORD_RESET');
      expect(bcryptSpy).toHaveBeenCalledWith('NewSecurePass456', 12);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: MOCK_USER_ID },
        data: { password: expect.any(String), refreshToken: null },
      });
      // Sessions must be revoked after a successful password reset
      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: MOCK_USER_ID },
      });
    });
  });

  // =========================================================================
  // verifyEmail()
  // =========================================================================

  describe('verifyEmail()', () => {
    it('should consume EMAIL_VERIFICATION token and set isEmailVerified', async () => {
      jest.spyOn(actionTokenService, 'consume').mockResolvedValue(MOCK_USER_ID);
      prisma.user.update.mockResolvedValue(mockVerifiedDbUser);

      await service.verifyEmail('valid-token');

      expect(actionTokenService.consume).toHaveBeenCalledWith('valid-token', 'EMAIL_VERIFICATION');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: MOCK_USER_ID },
        data: { isEmailVerified: true },
      });
    });
  });
});