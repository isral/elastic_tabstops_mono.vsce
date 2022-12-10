import * as v from 'vscode'

const configuration = "elasticTabstopsMono"
const cfgEnable = "enable"
const cfgFixIndent = "fixedIndentation"
const cfgTimeout = "timeout"
const cfgMaxLineCount = "maxLineCount"
const cfgMaxLineLength = "maxLineLength"
const defaultFixIndent = false
const minTimeout = 5
const defaultTimeout = 25
const minMaxLineCount = 2
const defaultMaxLineCount = 4096
const minMaxLineLength = 80
const defaultMaxLineLength = 255
const lcmTab = 5 * 6 * 7 * 8

let isEnable = false
let isFixIndent = defaultFixIndent
let timeout = defaultTimeout
let maxLineCount = defaultMaxLineCount
let maxLineLength = defaultMaxLineLength
let activeEditor: v.TextEditor | undefined = undefined
let timer: NodeJS.Timer | undefined = undefined
let onDidChangeActiveTextEditor: v.Disposable | null = null
let onDidChangeTextDocument: v.Disposable | null = null
let onDidChangeTextEditorOptions: v.Disposable | null = null
let onDidCloseTextDocument: v.Disposable | null = null

export function activate(context: v.ExtensionContext) {
	v.workspace.onDidChangeConfiguration(onDidChangeConfiguration, null, context.subscriptions)
	onDidChangeConfiguration()
}

export function deactivate() {
	disable()
}

function onDidChangeConfiguration() {
	const config = v.workspace.getConfiguration(configuration)
	const oldEnable = isEnable
	isEnable = config.get<boolean>(cfgEnable) ?? false
	const oldFixIndent = isFixIndent
	isFixIndent = config.get<boolean>(cfgFixIndent) ?? defaultFixIndent
	timeout = Math.max(minTimeout, config.get<number>(cfgTimeout) ?? defaultTimeout)
	const oldMaxLineCount = maxLineCount
	maxLineCount = Math.max(minMaxLineCount, config.get<number>(cfgMaxLineCount) ?? defaultMaxLineCount)
	const oldMaxLineLength = maxLineLength
	maxLineLength = Math.max(minMaxLineLength, config.get<number>(cfgMaxLineLength) ?? defaultMaxLineLength)
	if (isEnable !== oldEnable) {
		if (isEnable) {
			enable()
		} else {
			disable()
		}
	} else if (isEnable) {
		if ((isFixIndent !== oldFixIndent) ||
			(maxLineCount !== oldMaxLineCount) || (maxLineLength !== oldMaxLineLength)) {
			activeEditor = v.window.activeTextEditor
			if (activeEditor) {
				triggerUpdateDecorations()
			}
		}
	}
}

function enable() {
	activeEditor = v.window.activeTextEditor
	if (activeEditor) {
		triggerUpdateDecorations()
	}
	onDidChangeActiveTextEditor = v.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor
		if (editor) {
			triggerUpdateDecorations()
		}
	})
	onDidChangeTextEditorOptions = v.window.onDidChangeTextEditorOptions(event => {
		if (activeEditor && event.textEditor === activeEditor) {
			triggerUpdateDecorations()
		}
	})
	onDidChangeTextDocument = v.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations()
		}
	})
	onDidCloseTextDocument = v.workspace.onDidCloseTextDocument(document => {
		for (let i = 0; i < documents.length; ++i) {
			if (documents[i].editor.document === document) {
				documents.splice(i, 1)
				return
			}
		}
	})
}

function disable() {
	if (timer) {
		clearTimeout(timer)
	}
	timer = undefined
	for (const doc of documents) {
		doc.disposeDecorations()
	}
	documents.length = 0
	onDidChangeActiveTextEditor?.dispose()
	onDidChangeActiveTextEditor = null
	onDidChangeTextEditorOptions?.dispose()
	onDidChangeTextEditorOptions = null
	onDidChangeTextDocument?.dispose()
	onDidChangeTextDocument = null
	onDidCloseTextDocument?.dispose()
	onDidCloseTextDocument = null
}

function triggerUpdateDecorations() {
	if (timer) {
		clearTimeout(timer)
	}
	timer = setTimeout(onTimer, timeout)
}

function onTimer() {
	if (!activeEditor) {
		return
	}
	for (const doc of documents) {
		if (doc.editor.document === activeEditor.document) {
			doc.updateDecorations()
			return
		}
	}
	const doc = new Editor(activeEditor)
	documents.push(doc)
	doc.updateDecorations()
}

// Elastic Tabstops =========================================================

const documents: Editor[] = []

class Decoration {
	constructor(readonly type: v.TextEditorDecorationType) { }
	readonly ranges: v.Range[] = []
}

interface IField {
	start: number
	length: number
	tabPos: number
	tabSize: number
}

class Editor {
	constructor(readonly editor: v.TextEditor) { }
	private readonly decorations: (Decoration | undefined)[] = []
	private readonly fieldss: IField[][] = []

	updateDecorations() {
		const tabMaxSize = this.editor.options.tabSize as number
		const document = this.editor.document
		const lineCount = document.lineCount
		if (lineCount > maxLineCount) {
			this.disposeDecorations()
			return
		}
		this.fieldss.push([])
		for (let lineNumber = 0; lineNumber < lineCount; ++lineNumber) {
			const line = document.lineAt(lineNumber).text
			if (line.length <= maxLineLength) {
				const fields: IField[] = []
				let i = 0, col = 0
				if (isFixIndent) {
					while (line[i] === '\t') {
						++i
						col += tabMaxSize
					}
				}
				for (let start = 0, colStart = 0; i <= line.length; ++i, ++col) {
					if ((line[i] === '\t') || (i >= line.length)) {
						const length = col - colStart
						let tabSize = 0
						while ((col + 1) % tabMaxSize !== 0) {
							++col
							++tabSize
						}
						fields.push({ start, length, tabPos: i, tabSize })
						start = i + 1
						colStart = col + 1
					}
				}
				this.fieldss.push(fields.length > 1 ? fields : [])
			} else {
				this.fieldss.push([])
			}
		}
		this.fieldss.push([])
		this.disposeDecorations()
		this.scan(0, 1, this.fieldss.length - 1)
		this.fieldss.length = 0
		if (this.decorations.length) {
			for (const editor of v.window.visibleTextEditors) {
				if (editor.document === this.editor.document)
					for (const decor of this.decorations) {
						if (decor) {
							editor.setDecorations(decor.type, decor.ranges)
						}
					}
			}
		}
	}

	disposeDecorations() {
		for (const decor of this.decorations) {
			decor?.type.dispose()
		}
		this.decorations.length = 0
	}

	private scan(level: number, lineStart: number, lineEnd: number) {
		if (lineStart >= lineEnd) {
			return
		}
		for (let i = lineStart, start = lineStart; i <= lineEnd; ++i) {
			if ((this.fieldss[i - 1].length <= level + 1) && (this.fieldss[i].length > level + 1)) {
				start = i
			} else if ((this.fieldss[i - 1].length > level + 1) && (this.fieldss[i].length <= level + 1)) {
				this.format(level, start, i)
			}
		}
	}

	private format(level: number, lineStart: number, lineEnd: number) {
		let maxLength = 0
		for (let i = lineStart; i < lineEnd; ++i) {
			const c = this.fieldss[i][level]
			maxLength = Math.max(maxLength, c.length + c.tabSize)
		}
		for (let i = lineStart; i < lineEnd; ++i) {
			const c = this.fieldss[i][level]
			if (c.length + c.tabSize !== maxLength) {
				const pad = maxLength - c.length - c.tabSize
				const key = ((pad * lcmTab) / (c.tabSize + 1)) | 0
				if (!this.decorations[key]) {
					this.decorations[key] = new Decoration(v.window.createTextEditorDecorationType({
						letterSpacing: `${key / lcmTab}ch`,
						rangeBehavior: v.DecorationRangeBehavior.ClosedClosed
					}))
				}
				const start = new v.Position(i - 1, c.tabPos)
				const end = new v.Position(i - 1, c.tabPos + 1)
				this.decorations[key]!.ranges.push(new v.Range(start, end))
			}
		}
		this.scan(level + 1, lineStart, lineEnd)
	}
}
