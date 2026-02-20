/**
 * Tests for the PI Data Provider (src/utils/pi-data-provider.ts).
 *
 * Mocks @elgato/streamdeck and the GitHub API datasource functions to test
 * the handlePIDataRequest orchestration logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ──────────────────────────────────────────────
// Mock @elgato/streamdeck
// ──────────────────────────────────────────────

const {
	mockGetGlobalSettings,
	mockSendToPropertyInspector,
	mockLoggerWarn,
	mockLoggerError,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockSendToPropertyInspector: vi.fn(),
	mockLoggerWarn: vi.fn(),
	mockLoggerError: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class MockSingletonAction {
		manifestId: string | undefined;
		get actions(): unknown[] {
			return [];
		}
	}

	return {
		default: {
			settings: {
				getGlobalSettings: mockGetGlobalSettings,
			},
			ui: {
				sendToPropertyInspector: mockSendToPropertyInspector,
			},
			logger: {
				setLevel: vi.fn(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: mockLoggerWarn,
				error: mockLoggerError,
			},
			connect: vi.fn(),
		},
		SingletonAction: MockSingletonAction,
		action: () => (target: unknown) => target,
	};
});

// ──────────────────────────────────────────────
// Mock GitHub API datasource functions
// ──────────────────────────────────────────────

const {
	mockValidateTokenStatus,
	mockFetchUserRepos,
	mockFetchRepoWorkflows,
	mockFetchRepoBranches,
	mockFetchRepoEnvironments,
} = vi.hoisted(() => ({
	mockValidateTokenStatus: vi.fn(),
	mockFetchUserRepos: vi.fn(),
	mockFetchRepoWorkflows: vi.fn(),
	mockFetchRepoBranches: vi.fn(),
	mockFetchRepoEnvironments: vi.fn(),
}));

vi.mock("../../src/utils/github-api", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		validateTokenStatus: mockValidateTokenStatus,
		fetchUserRepos: mockFetchUserRepos,
		fetchRepoWorkflows: mockFetchRepoWorkflows,
		fetchRepoBranches: mockFetchRepoBranches,
		fetchRepoEnvironments: mockFetchRepoEnvironments,
	};
});

import { handlePIDataRequest, PI_EVENTS } from "../../src/utils/pi-data-provider";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeGetSettings(settings: Record<string, unknown> = {}) {
	return vi.fn().mockResolvedValue(settings);
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("PI Data Provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_testtoken123" });
		mockSendToPropertyInspector.mockResolvedValue(undefined);
	});

	// ── PI_EVENTS constants ─────────────────────

	describe("PI_EVENTS", () => {
		it("has correct event names", () => {
			expect(PI_EVENTS.VALIDATE_TOKEN).toBe("validateToken");
			expect(PI_EVENTS.GET_REPOS).toBe("getRepos");
			expect(PI_EVENTS.GET_WORKFLOWS).toBe("getWorkflows");
			expect(PI_EVENTS.GET_BRANCHES).toBe("getBranches");
			expect(PI_EVENTS.GET_ENVIRONMENTS).toBe("getEnvironments");
		});
	});

	// ── validateToken event ────────────────────

	describe("validateToken event", () => {
		it("validates token using global settings", async () => {
			const result = [
				{ label: "✓ @testuser · fine-grained token", value: "valid" },
				{ label: "Check token settings for required permissions", value: "", disabled: true },
			];
			mockValidateTokenStatus.mockResolvedValue(result);

			await handlePIDataRequest("validateToken", makeGetSettings());

			expect(mockGetGlobalSettings).toHaveBeenCalled();
			expect(mockValidateTokenStatus).toHaveBeenCalledWith("ghp_testtoken123");
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "validateToken",
				items: result,
			});
		});

		it("passes undefined token when not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			mockValidateTokenStatus.mockResolvedValue([
				{ label: "Enter a GitHub token", value: "no-token" },
			]);

			await handlePIDataRequest("validateToken", makeGetSettings());

			expect(mockValidateTokenStatus).toHaveBeenCalledWith(undefined);
		});

		it("does not read action settings for validateToken", async () => {
			mockValidateTokenStatus.mockResolvedValue([]);
			const getSettings = makeGetSettings();

			await handlePIDataRequest("validateToken", getSettings);

			expect(getSettings).not.toHaveBeenCalled();
		});
	});

	// ── getRepos event ──────────────────────────

	describe("getRepos event", () => {
		it("fetches repos using token from global settings", async () => {
			const repos = [
				{ label: "owner/repo1", value: "owner/repo1" },
				{ label: "owner/repo2", value: "owner/repo2" },
			];
			mockFetchUserRepos.mockResolvedValue(repos);

			await handlePIDataRequest("getRepos", makeGetSettings());

			expect(mockGetGlobalSettings).toHaveBeenCalled();
			expect(mockFetchUserRepos).toHaveBeenCalledWith("ghp_testtoken123");
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getRepos",
				items: repos,
			});
		});

		it("passes undefined token when not set in global settings", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			mockFetchUserRepos.mockResolvedValue([
				{ label: "⚠ Enter a GitHub token first", value: "", disabled: true },
			]);

			await handlePIDataRequest("getRepos", makeGetSettings());

			expect(mockFetchUserRepos).toHaveBeenCalledWith(undefined);
		});

		it("does not read action settings for getRepos", async () => {
			mockFetchUserRepos.mockResolvedValue([]);
			const getSettings = makeGetSettings();

			await handlePIDataRequest("getRepos", getSettings);

			expect(getSettings).not.toHaveBeenCalled();
		});
	});

	// ── getWorkflows event ──────────────────────

	describe("getWorkflows event", () => {
		it("fetches workflows using repo from action settings", async () => {
			const workflows = [
				{ label: "All Workflows", value: "" },
				{ label: "CI (ci.yml)", value: "ci.yml" },
			];
			mockFetchRepoWorkflows.mockResolvedValue(workflows);

			await handlePIDataRequest("getWorkflows", makeGetSettings({ repo: "owner/repo" }));

			expect(mockFetchRepoWorkflows).toHaveBeenCalledWith("owner", "repo", "ghp_testtoken123");
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getWorkflows",
				items: workflows,
			});
		});

		it("returns 'select a repo first' when repo is not set", async () => {
			await handlePIDataRequest("getWorkflows", makeGetSettings({}));

			expect(mockFetchRepoWorkflows).not.toHaveBeenCalled();
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getWorkflows",
				items: [{ label: "⚠ Select a repository first", value: "", disabled: true }],
			});
		});

		it("returns 'select a repo first' when repo is invalid format", async () => {
			await handlePIDataRequest("getWorkflows", makeGetSettings({ repo: "invalid" }));

			expect(mockFetchRepoWorkflows).not.toHaveBeenCalled();
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getWorkflows",
				items: [{ label: "⚠ Select a repository first", value: "", disabled: true }],
			});
		});
	});

	// ── getBranches event ───────────────────────

	describe("getBranches event", () => {
		it("fetches branches using repo from action settings", async () => {
			const branches = [
				{ label: "All Branches", value: "" },
				{ label: "main", value: "main" },
			];
			mockFetchRepoBranches.mockResolvedValue(branches);

			await handlePIDataRequest("getBranches", makeGetSettings({ repo: "owner/repo" }));

			expect(mockFetchRepoBranches).toHaveBeenCalledWith("owner", "repo", "ghp_testtoken123");
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getBranches",
				items: branches,
			});
		});

		it("returns 'select a repo first' when repo is empty", async () => {
			await handlePIDataRequest("getBranches", makeGetSettings({ repo: "" }));

			expect(mockFetchRepoBranches).not.toHaveBeenCalled();
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getBranches",
				items: [{ label: "⚠ Select a repository first", value: "", disabled: true }],
			});
		});
	});

	// ── getEnvironments event ───────────────────

	describe("getEnvironments event", () => {
		it("fetches environments using repo from action settings", async () => {
			const envs = [
				{ label: "All Environments", value: "" },
				{ label: "production", value: "production" },
			];
			mockFetchRepoEnvironments.mockResolvedValue(envs);

			await handlePIDataRequest("getEnvironments", makeGetSettings({ repo: "owner/repo" }));

			expect(mockFetchRepoEnvironments).toHaveBeenCalledWith("owner", "repo", "ghp_testtoken123");
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getEnvironments",
				items: envs,
			});
		});

		it("returns 'select a repo first' when no repo setting", async () => {
			await handlePIDataRequest("getEnvironments", makeGetSettings());

			expect(mockFetchRepoEnvironments).not.toHaveBeenCalled();
		});
	});

	// ── Unknown events ──────────────────────────

	describe("unknown events", () => {
		it("logs a warning and sends error items for unknown events", async () => {
			await handlePIDataRequest("unknownEvent", makeGetSettings());

			expect(mockLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining("unknownEvent"),
			);
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "unknownEvent",
				items: [{ label: "⚠ Unknown request", value: "", disabled: true }],
			});
		});

		it("does not fetch any data for unknown events", async () => {
			await handlePIDataRequest("badEvent", makeGetSettings());

			expect(mockFetchUserRepos).not.toHaveBeenCalled();
			expect(mockFetchRepoWorkflows).not.toHaveBeenCalled();
			expect(mockFetchRepoBranches).not.toHaveBeenCalled();
			expect(mockFetchRepoEnvironments).not.toHaveBeenCalled();
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("catches errors and sends error item to PI", async () => {
			mockFetchUserRepos.mockRejectedValue(new Error("Network error"));

			await handlePIDataRequest("getRepos", makeGetSettings());

			expect(mockLoggerError).toHaveBeenCalledWith(
				expect.stringContaining("Network error"),
			);
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getRepos",
				items: [{ label: "⚠ Error loading data", value: "", disabled: true }],
			});
		});

		it("handles non-Error exceptions (string throw)", async () => {
			mockFetchUserRepos.mockRejectedValue("string error");

			await handlePIDataRequest("getRepos", makeGetSettings());

			expect(mockLoggerError).toHaveBeenCalledWith(
				expect.stringContaining("Unknown error"),
			);
			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getRepos",
				items: [{ label: "⚠ Error loading data", value: "", disabled: true }],
			});
		});

		it("catches errors from getActionSettings callback", async () => {
			const badGetSettings = vi.fn().mockRejectedValue(new Error("Settings unavailable"));

			await handlePIDataRequest("getWorkflows", badGetSettings);

			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getWorkflows",
				items: [{ label: "⚠ Error loading data", value: "", disabled: true }],
			});
		});

		it("catches errors from global settings fetch", async () => {
			mockGetGlobalSettings.mockRejectedValue(new Error("Stream Deck error"));

			await handlePIDataRequest("getRepos", makeGetSettings());

			expect(mockSendToPropertyInspector).toHaveBeenCalledWith({
				event: "getRepos",
				items: [{ label: "⚠ Error loading data", value: "", disabled: true }],
			});
		});
	});

	// ── Integration-style: event → response flow ─

	describe("event response flow", () => {
		it("responds with the correct event name in the response", async () => {
			mockFetchUserRepos.mockResolvedValue([]);
			await handlePIDataRequest("getRepos", makeGetSettings());

			const call = mockSendToPropertyInspector.mock.calls[0][0];
			expect(call.event).toBe("getRepos");
		});

		it("responds with items array (even if empty)", async () => {
			mockFetchUserRepos.mockResolvedValue([]);
			await handlePIDataRequest("getRepos", makeGetSettings());

			const call = mockSendToPropertyInspector.mock.calls[0][0];
			expect(Array.isArray(call.items)).toBe(true);
		});

		it("passes correct owner/repo for each secondary event", async () => {
			const getSettings = makeGetSettings({ repo: "my-org/my-app" });

			mockFetchRepoWorkflows.mockResolvedValue([]);
			mockFetchRepoBranches.mockResolvedValue([]);
			mockFetchRepoEnvironments.mockResolvedValue([]);

			await handlePIDataRequest("getWorkflows", getSettings);
			await handlePIDataRequest("getBranches", getSettings);
			await handlePIDataRequest("getEnvironments", getSettings);

			expect(mockFetchRepoWorkflows).toHaveBeenCalledWith("my-org", "my-app", "ghp_testtoken123");
			expect(mockFetchRepoBranches).toHaveBeenCalledWith("my-org", "my-app", "ghp_testtoken123");
			expect(mockFetchRepoEnvironments).toHaveBeenCalledWith("my-org", "my-app", "ghp_testtoken123");
		});
	});
});
