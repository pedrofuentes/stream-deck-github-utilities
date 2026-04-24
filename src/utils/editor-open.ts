/**
 * Build an open-URL for the Active Repo action's press handler.
 *
 * Both Cursor and VS Code implement `vscode://file/<absolute-path>`. Cursor
 * also registers its own `cursor://` scheme, which we prefer when the bridge
 * file tells us Cursor wrote it — that way pressing the button reopens the
 * workspace in Cursor rather than kicking focus over to stock VS Code.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

export interface BuildEditorOpenUrlOptions {
	workspacePath?: string;
	sourceApp?: string;
}

export function buildEditorOpenUrl(options: BuildEditorOpenUrlOptions): string | null {
	if (!options.workspacePath) return null;

	const fileUrlPath = encodePathForFileUrl(options.workspacePath);
	const prefersCursor = (options.sourceApp ?? "").toLowerCase().includes("cursor");
	const scheme = prefersCursor ? "cursor" : "vscode";
	return `${scheme}://file${fileUrlPath}`;
}

function encodePathForFileUrl(absolutePath: string): string {
	return absolutePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
