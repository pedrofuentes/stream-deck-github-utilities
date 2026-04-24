/**
 * Tests for buildEditorOpenUrl helper (src/utils/editor-open.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";

import { buildEditorOpenUrl } from "../../src/utils/editor-open";

describe("buildEditorOpenUrl", () => {
	it("returns null when no workspace path is known", () => {
		expect(buildEditorOpenUrl({})).toBeNull();
		expect(buildEditorOpenUrl({ sourceApp: "Cursor" })).toBeNull();
	});

	it("returns a cursor:// URL when sourceApp indicates Cursor", () => {
		expect(
			buildEditorOpenUrl({ workspacePath: "/Users/you/proj", sourceApp: "Cursor" }),
		).toBe("cursor://file/Users/you/proj");
	});

	it("returns a vscode:// URL when sourceApp indicates VS Code", () => {
		expect(
			buildEditorOpenUrl({ workspacePath: "/Users/you/proj", sourceApp: "Visual Studio Code" }),
		).toBe("vscode://file/Users/you/proj");
	});

	it("defaults to vscode:// when sourceApp is missing", () => {
		expect(
			buildEditorOpenUrl({ workspacePath: "/Users/you/proj" }),
		).toBe("vscode://file/Users/you/proj");
	});

	it("matches Cursor case-insensitively", () => {
		expect(
			buildEditorOpenUrl({ workspacePath: "/w/x", sourceApp: "cursor" }),
		).toMatch(/^cursor:\/\//);
	});

	it("percent-encodes path segments with spaces and special chars, preserving slashes", () => {
		expect(
			buildEditorOpenUrl({ workspacePath: "/Users/x/Pro ject #1", sourceApp: "Cursor" }),
		).toBe("cursor://file/Users/x/Pro%20ject%20%231");
	});
});
