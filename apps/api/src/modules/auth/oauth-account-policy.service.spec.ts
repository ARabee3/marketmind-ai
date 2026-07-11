import { Test, TestingModule } from "@nestjs/testing";
import { Role, Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";

import { PrismaService } from "../../common/persistence/prisma.service";
import { AuthService, SafeUser } from "./auth.service";
import {
  FederatedIdentityConflictError,
  FederatedIdentityService,
} from "./federated-identity.service";
import { GoogleProfile } from "./google-oauth.client";
import {
  OAuthAccountPolicyService,
  OAuthSignInResult,
} from "./oauth-account-policy.service";
import { OAuthException } from "./exceptions/oauth.exception";

const mockProfile: GoogleProfile = {
  providerSubject: "google-sub-123",
  email: "owner@example.com",
  emailVerified: true,
  displayName: "Test Owner",
  avatarUrl: "https://example.com/avatar.png",
  rawProfile: { sub: "google-sub-123", email: "owner@example.com" },
};

const mockSafeUser: SafeUser = {
  id: "user-1",
  email: "owner@example.com",
  fullName: "Test Owner",
  roles: [Role.OWNER],
  isEmailVerified: true,
  lastLoginAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const mockDbUser = {
  ...mockSafeUser,
  password: "hashed-password",
  refreshToken: null,
};

describe("OAuthAccountPolicyService", () => {
  let service: OAuthAccountPolicyService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let federatedIdentity: {
    findByProvider: jest.Mock;
    findOrCreate: jest.Mock;
  };
  let authService: {
    issueTokensForUser: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    federatedIdentity = {
      findByProvider: jest.fn(),
      findOrCreate: jest.fn(),
    };

    authService = {
      issueTokensForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthAccountPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: FederatedIdentityService, useValue: federatedIdentity },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<OAuthAccountPolicyService>(OAuthAccountPolicyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const expectTokenResult = (result: OAuthSignInResult, isNew: boolean) => {
    expect(result.user).toEqual(mockSafeUser);
    expect(result.isNew).toBe(isNew);
    expect(result.accessToken).toBe("access-token");
    expect(result.rawRefreshToken).toBe("raw-refresh-token");
  };

  describe("signInWithGoogle()", () => {
    beforeEach(() => {
      authService.issueTokensForUser.mockResolvedValue({
        accessToken: "access-token",
        rawRefreshToken: "raw-refresh-token",
        user: mockSafeUser,
      });
    });

    it("signs in a returning identity without creating a new account", async () => {
      federatedIdentity.findByProvider.mockResolvedValue({
        id: "fi-1",
        userId: "user-1",
      });
      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      const result = await service.signInWithGoogle(mockProfile);

      expectTokenResult(result, false);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(federatedIdentity.findOrCreate).not.toHaveBeenCalled();
    });

    it("creates a new verified owner when no identity or email exists", async () => {
      federatedIdentity.findByProvider.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockDbUser);
      federatedIdentity.findOrCreate.mockResolvedValue({
        id: "fi-new",
        userId: "user-1",
        isNew: true,
      });
      jest.spyOn(bcrypt, "hash").mockResolvedValue("random-hash" as never);

      const result = await service.signInWithGoogle(mockProfile);

      expectTokenResult(result, true);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "owner@example.com",
          fullName: "Test Owner",
          isEmailVerified: true,
          password: "random-hash",
        }),
      });
      expect(federatedIdentity.findOrCreate).toHaveBeenCalledWith({
        userId: "user-1",
        provider: "google",
        providerSubject: "google-sub-123",
        email: "owner@example.com",
        displayName: "Test Owner",
        avatarUrl: "https://example.com/avatar.png",
        rawProfile: mockProfile.rawProfile,
      });
    });

    it("rejects same-email password accounts without linking", async () => {
      federatedIdentity.findByProvider.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      await expect(service.signInWithGoogle(mockProfile)).rejects.toMatchObject({
        code: "OAUTH_EMAIL_ALREADY_USED_PASSWORD",
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(federatedIdentity.findOrCreate).not.toHaveBeenCalled();
    });

    it("throws OAUTH_PROVIDER_ERROR when linked user is missing", async () => {
      federatedIdentity.findByProvider.mockResolvedValue({
        id: "fi-1",
        userId: "user-1",
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.signInWithGoogle(mockProfile)).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("resolves race condition when another request created the identity", async () => {
      federatedIdentity.findByProvider.mockResolvedValueOnce(null);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(mockDbUser);
      federatedIdentity.findOrCreate.mockRejectedValue(
        new FederatedIdentityConflictError("google", "google-sub-123"),
      );
      federatedIdentity.findByProvider.mockResolvedValueOnce({
        id: "fi-1",
        userId: "user-1",
      });
      prisma.user.findUnique.mockResolvedValueOnce(mockDbUser);

      const result = await service.signInWithGoogle(mockProfile);

      expectTokenResult(result, false);
    });

    it("re-throws unexpected identity creation errors", async () => {
      federatedIdentity.findByProvider.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockDbUser);
      federatedIdentity.findOrCreate.mockRejectedValue(new Error("DB down"));

      await expect(service.signInWithGoogle(mockProfile)).rejects.toThrow(
        "DB down",
      );
    });

    it("uses null fullName when Google profile has no name", async () => {
      federatedIdentity.findByProvider.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...mockDbUser,
        fullName: null,
      });
      federatedIdentity.findOrCreate.mockResolvedValue({
        id: "fi-new",
        userId: "user-1",
        isNew: true,
      });
      jest.spyOn(bcrypt, "hash").mockResolvedValue("random-hash" as never);

      const profile: GoogleProfile = { ...mockProfile, displayName: undefined };
      await service.signInWithGoogle(profile);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fullName: null,
        }),
      });
    });
  });
});
