// Fixture for the real md-prettify case: the same IDE decoration domain is
// described twice, split across two files (ide-editor.ts / ide-types.ts).
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

export interface DecorationRenderOptions extends DecorationRenderOptionsBase {
	before?: string;
	after?: string;
	dark?: string;
	light?: string;
}

export interface TextLine {
	lineNumber: number;
	text: string;
	isEmptyOrWhitespace(): boolean;
}
