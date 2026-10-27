// Second half of the split IDE decoration domain — near-identical to the
// interfaces in ide-editor.ts, so the app↔app mode must cluster them.
export interface DecorationRenderOptionsBase {
	isWholeLine: boolean;
	rangeBehavior: string;
	overviewRulerLane: number;
	overviewRulerColor: string;
	cursorColor: string;
	backgroundColor: string;
	outlineColor: string;
	borderColor: string;
	borderStyle: string;
	borderRadius: string;
	afterClassName: string;
	hoverMessage: string;
}

export interface DecorationInstanceRenderOptions extends DecorationRenderOptionsBase {
	before?: string;
	after?: string;
}

export interface Disposable {
	dispose(): void;
}
