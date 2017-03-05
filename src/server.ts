'use strict';

import * as path from 'path';

import {
	IConnection,
	TextDocuments,
	TextDocument,
	createConnection,
	IPCMessageReader,
	IPCMessageWriter,
	DiagnosticSeverity,
	Diagnostic,
	Files,
	ErrorMessageTracker,
	InitializeError,
	ResponseError
} from 'vscode-languageserver';

import * as postcss from 'postcss';
import * as micromatch from 'micromatch';
import * as resolver from 'npm-module-path';

const connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
const allDocuments: TextDocuments = new TextDocuments();

// "global" settings
let workspaceFolder;
let linter;
let editorSettings;

const doiuseNotFound: string = [
	'Failed to load doiuse library.',
	`Please install doiuse in your workspace folder using \'npm install doiuse\' or \'npm install -g doiuse\' and then press Retry.`
].join('');

function makeDiagnostic(problem): Diagnostic {
	const source = problem.usage.source;
	const message: string = problem.message.replace(/<input css \d+>:\d*:\d*:\s/, '');

	const severityLevel = {
		Error: DiagnosticSeverity.Error,
		Information: DiagnosticSeverity.Information,
		Warning: DiagnosticSeverity.Warning
	};

	return {
		severity: severityLevel[editorSettings.messageLevel],
		message,
		range: {
			start: {
				line: source.start.line - 1,
				character: source.start.column - 1
			},
			end: {
				line: source.end.line - 1,
				character: source.end.column
			}
		},
		code: problem.feature,
		source: 'doiuse'
	};
}

function getErrorMessage(err, document): string {
	let errorMessage = 'unknown error';
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = err.message;
	}

	const fsPath: string = Files.uriToFilePath(document.uri);

	return `vscode-doiuse: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;
}

function validateMany(documents: TextDocument[]): void {
	const tracker = new ErrorMessageTracker();
	documents.forEach((document) => {
		try {
			validateSingle(document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
}

function validateSingle(document: TextDocument): void {
	try {
		doValidate(document);
	} catch (err) {
		connection.window.showErrorMessage(getErrorMessage(err, document));
	}
}

function getSyntax(language: string): any {
	switch (language) {
		case 'less':
			return require('postcss-less');
		case 'scss':
			return require('postcss-scss');
		case 'sass-indented':
		case 'sass':
		case 'stylus':
			return require('sugarss');
		default:
			return false;
	}
}

function doValidate(document: TextDocument): any {
	const uri = document.uri;
	const content: string = document.getText();
	const diagnostics = [];

	const lang: string = document.languageId;
	const syntax = getSyntax(lang);

	if (editorSettings.ignoreFiles.length) {
		let fsPath: string = Files.uriToFilePath(uri);
		if (workspaceFolder) {
			fsPath = path.relative(workspaceFolder, fsPath);
		}

		const match = micromatch([fsPath], editorSettings.ignoreFiles);
		if (editorSettings.ignoreFiles && match.length !== 0) {
			return diagnostics;
		}
	}

	const linterOptions = {
		browsers: editorSettings.browsers,
		ignore: editorSettings.ignore,
		onFeatureUsage: (usageInfo) => diagnostics.push(makeDiagnostic(usageInfo))
	};

	postcss(linter(linterOptions))
		.process(content, syntax && { syntax })
		.then(() => {
			connection.sendDiagnostics({ diagnostics, uri });
		});
}

// The documents manager listen for text document create, change
// and close on the connection
allDocuments.listen(connection);

// A text document has changed. Validate the document.
allDocuments.onDidChangeContent((event) => {
	if (editorSettings.run === 'onType') {
		validateSingle(event.document);
	}
});

allDocuments.onDidSave((event) => {
	if (editorSettings.run === 'onSave') {
		validateSingle(event.document);
	}
});

connection.onInitialize((params) => {
	workspaceFolder = params.rootPath;

	return resolver.resolveOne('doiuse', workspaceFolder).then((modulePath) => {
		if (modulePath === undefined) {
			throw {
				message: 'Module not found.',
				code: 'ENOENT'
			};
		}

		linter = require(modulePath);

		return {
			capabilities: {
				textDocumentSync: allDocuments.syncKind
			}
		};
	}).catch((err) => {
		// If the error is not caused by a lack of module
		if (err.code !== 'ENOENT') {
			connection.console.error(err.toString());
			return;
		}

		if (params.initializationOptions && Object.keys(params.initializationOptions).length !== 0) {
			return Promise.reject(new ResponseError<InitializeError>(99, doiuseNotFound, { retry: true }));
		}
	});
});

connection.onDidChangeConfiguration((params) => {
	editorSettings = params.settings.doiuse;

	validateMany(allDocuments.all());
});

allDocuments.onDidClose((event) => {
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.listen();
