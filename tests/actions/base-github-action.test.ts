/**
 * Tests for BaseGitHubAction helpers — resolveEffectiveRepo and
 * syncResolvedRepoSubscription.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
	getGlobalSettings: vi.fn(),
	resolveRepoSelection: vi.fn(),
	coordinatorSubscribe: vi.fn(),
	coordinatorUnsubscribe: vi.fn(),
	watcherSetPathResolver: vi.fn(),
	watcherSubscribe: vi.fn(),
	watcherUnsubscribe: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {}
	return {
		SingletonAction,
		default: {
			settings: {
				getGlobalSettings: mocks.getGlobalSettings,
			},
			logger: {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				setLevel: vi.fn(),
			},
			ui: { sendToPropertyInspector: vi.fn() },
		},
	};
});

vi.mock("../../src/utils/active-repo-source", () => ({
	resolveRepoSelection: mocks.resolveRepoSelection,
	getDefaultBridgePath: () => "/tmp/default-bridge.json",
	activeRepoWatcher: {
		setPathResolver: mocks.watcherSetPathResolver,
		subscribe: mocks.watcherSubscribe,
		unsubscribe: mocks.watcherUnsubscribe,
	},
}));

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	GraphQLQueryCoordinator: class {
		subscribe = mocks.coordinatorSubscribe;
		unsubscribe = mocks.coordinatorUnsubscribe;
	},
}));

vi.mock("../../src/utils/repo-data-cache", () => ({
	RepoDataCache: class {},
}));

vi.mock("../../src/utils/polling-coordinator", () => ({
	PollingCoordinator: class {
		stop = vi.fn();
	},
}));

vi.mock("../../src/utils/debounced-url-opener", () => ({
	DebouncedUrlOpener: class {
		cleanup = vi.fn();
	},
}));

vi.mock("../../src/utils/pi-data-provider", () => ({
	handlePIDataRequest: vi.fn(),
}));

vi.mock("../../src/utils/github-api", () => ({
	classifyErrorLabel: vi.fn(() => "Error"),
}));

vi.mock("../../src/utils/button-renderer", () => ({
	renderErrorImage: vi.fn(() => "error-image"),
}));

vi.mock("../../src/utils/touch-strip-renderer", () => ({
	renderStripError: vi.fn(() => ({})),
}));

import { BaseGitHubAction } from "../../src/actions/base-github-action";
import type { RepoActionSettings } from "../../src/types";

// Concrete subclass for testing the abstract base
class TestAction extends BaseGitHubAction<RepoActionSettings> {
	callResolveEffectiveRepo(settings: RepoActionSettings) {
		return this.resolveEffectiveRepo(settings);
	}

	callSyncResolvedRepoSubscription(actionId: string, repo: string) {
		return this.syncResolvedRepoSubscription(actionId, repo, ["prCount"], 60);
	}

	getLastResolvedRepoMap() {
		return this.lastResolvedRepo;
	}
}

beforeEach(() => {
	Object.values(mocks).forEach((m) => m.mockReset?.());
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("BaseGitHubAction.resolveEffectiveRepo", () => {
	it("reads global settings and delegates to resolveRepoSelection with the bridgePath override", async () => {
		mocks.getGlobalSettings.mockResolvedValue({ activeRepoBridgePath: "/custom/path.json" });
		mocks.resolveRepoSelection.mockResolvedValue({ repo: "owner/repo", isSentinel: false });

		const action = new TestAction();
		const result = await action.callResolveEffectiveRepo({ repo: "owner/repo" });

		expect(mocks.resolveRepoSelection).toHaveBeenCalledWith("owner/repo", {
			bridgePath: "/custom/path.json",
		});
		expect(result).toEqual({ repo: "owner/repo", isSentinel: false });
	});

	it("passes undefined bridgePath when not configured so the utility uses the default", async () => {
		mocks.getGlobalSettings.mockResolvedValue({});
		mocks.resolveRepoSelection.mockResolvedValue(null);

		const action = new TestAction();
		await action.callResolveEffectiveRepo({});

		expect(mocks.resolveRepoSelection).toHaveBeenCalledWith(undefined, {
			bridgePath: undefined,
		});
	});
});

describe("BaseGitHubAction.syncResolvedRepoSubscription", () => {
	it("subscribes on first call without an unsubscribe (nothing to tear down)", () => {
		const action = new TestAction();
		action.callSyncResolvedRepoSubscription("a1", "owner/repo");

		expect(mocks.coordinatorUnsubscribe).not.toHaveBeenCalled();
		expect(mocks.coordinatorSubscribe).toHaveBeenCalledTimes(1);
		expect(mocks.coordinatorSubscribe).toHaveBeenCalledWith(
			expect.objectContaining({ actionId: "a1", repo: "owner/repo", fragments: ["prCount"], maxAgeSec: 60 }),
			undefined,
		);
		expect(action.getLastResolvedRepoMap().get("a1")).toBe("owner/repo");
	});

	it("re-subscribes without unsubscribe when the repo has not changed", () => {
		const action = new TestAction();
		action.callSyncResolvedRepoSubscription("a1", "owner/repo");
		mocks.coordinatorSubscribe.mockClear();
		mocks.coordinatorUnsubscribe.mockClear();

		action.callSyncResolvedRepoSubscription("a1", "owner/repo");

		expect(mocks.coordinatorUnsubscribe).not.toHaveBeenCalled();
		expect(mocks.coordinatorSubscribe).toHaveBeenCalledTimes(1);
	});

	it("does an explicit unsubscribe + subscribe when the repo changes", () => {
		const action = new TestAction();
		action.callSyncResolvedRepoSubscription("a1", "owner/repo");
		mocks.coordinatorSubscribe.mockClear();
		mocks.coordinatorUnsubscribe.mockClear();

		action.callSyncResolvedRepoSubscription("a1", "other/repo");

		expect(mocks.coordinatorUnsubscribe).toHaveBeenCalledWith("a1");
		expect(mocks.coordinatorSubscribe).toHaveBeenCalledTimes(1);
		expect(mocks.coordinatorSubscribe).toHaveBeenCalledWith(
			expect.objectContaining({ actionId: "a1", repo: "other/repo" }),
			undefined,
		);
		expect(action.getLastResolvedRepoMap().get("a1")).toBe("other/repo");
	});

	it("tracks repo per actionId independently", () => {
		const action = new TestAction();
		action.callSyncResolvedRepoSubscription("a1", "repo-a/x");
		action.callSyncResolvedRepoSubscription("a2", "repo-b/y");

		expect(action.getLastResolvedRepoMap().get("a1")).toBe("repo-a/x");
		expect(action.getLastResolvedRepoMap().get("a2")).toBe("repo-b/y");
	});
});
